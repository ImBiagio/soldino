from __future__ import annotations

from django.conf import settings
from django.db import transaction as db_transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.money import money_str
from apps.core.permissions import IsTrackerMember, IsTrackerOwner
from apps.core.scoping import TrackerScopedMixin
from apps.transactions.services.debts import compute_balances, minimize_transfers
from apps.transactions.services.reports import reconcile, summary
from apps.users.serializers import UserBriefSerializer

from .invites import read_invite_token, send_invite_email
from .models import Category, Membership, Tracker
from .serializers import (
    CategorySerializer,
    InviteSerializer,
    MembershipSerializer,
    SummaryQuerySerializer,
    TrackerSerializer,
)


class TrackerViewSet(TrackerScopedMixin, viewsets.ModelViewSet):
    """Isolamento: ``tracker_lookup=""`` perche' il modello *e'* il tracker."""

    serializer_class = TrackerSerializer
    permission_classes = [IsAuthenticated]
    tracker_lookup = ""
    queryset = Tracker.objects.select_related("owner").prefetch_related(
        "memberships__user"
    )

    def _require_owner(self, tracker, verb: str) -> None:
        membership = self.request.user.memberships.filter(tracker=tracker).first()
        if not membership or membership.role != Membership.Role.OWNER:
            self.permission_denied(self.request, message=f"Solo il proprietario puo' {verb}.")

    @db_transaction.atomic
    def perform_destroy(self, instance):
        """Eliminazione vera (soft delete con audit), non piu' un'archiviazione.

        Le membership vanno giu' insieme al tracker: le rotte annidate
        controllano l'appartenenza, e con le membership vive i movimenti di un
        tracker eliminato resterebbero leggibili.
        """
        self._require_owner(instance, "eliminare il tracker")
        instance.memberships.all().delete()
        instance.delete()

    @extend_schema(request=None, responses={200: TrackerSerializer})
    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        """Archiviato: resta consultabile, finisce in fondo alla lista."""
        tracker = self.get_object()
        self._require_owner(tracker, "archiviare il tracker")
        tracker.archived_at = timezone.now()
        tracker.save(update_fields=["archived_at", "updated_at"])
        return Response(self.get_serializer(tracker).data)

    @extend_schema(request=None, responses={200: TrackerSerializer})
    @action(detail=True, methods=["post"])
    def unarchive(self, request, pk=None):
        tracker = self.get_object()
        self._require_owner(tracker, "ripristinare il tracker")
        tracker.archived_at = None
        tracker.save(update_fields=["archived_at", "updated_at"])
        return Response(self.get_serializer(tracker).data)

    @extend_schema(request=InviteSerializer, responses={201: MembershipSerializer})
    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsTrackerOwner])
    def invite(self, request, pk=None):
        tracker = self.get_object()
        serializer = InviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].lower().strip()

        from django.contrib.auth import get_user_model

        user = get_user_model().objects.filter(email=email).first()

        existing = Membership.objects.filter(tracker=tracker).filter(
            models_q(user=user, invited_email=email)
        ).first()
        if existing and existing.status != Membership.Status.REVOKED:
            return Response(
                {"detail": "Questa persona e' gia' invitata o gia' membro."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        membership = Membership.objects.create(
            tracker=tracker,
            user=user,
            invited_email=email,
            role=serializer.validated_data["role"],
            default_share_pct=serializer.validated_data["default_share_pct"],
            status=Membership.Status.PENDING,
        )
        token = send_invite_email(membership, request.user.display_name or request.user.email)
        payload = MembershipSerializer(membership).data
        if settings.DEBUG:
            # In sviluppo la mail va in console: il token serve a mano.
            payload["invite_token"] = token
        return Response(payload, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated, IsTrackerMember])
    def balances(self, request, pk=None):
        tracker = self.get_object()
        memberships = list(
            tracker.memberships.filter(
                status=Membership.Status.ACTIVE, user__isnull=False
            ).select_related("user")
        )
        by_id = {str(m.user_id): m for m in memberships}
        balances = compute_balances(tracker.pk, by_id.keys())
        transfers = minimize_transfers(balances)
        return Response(
            {
                "balances": [
                    {
                        "user": {
                            "id": b.user_id,
                            "display_name": by_id[b.user_id].display_name,
                            "email": by_id[b.user_id].user.email,
                        },
                        "paid": money_str(b.paid),
                        "owed": money_str(b.owed),
                        "settlements_sent": money_str(b.settlements_sent),
                        "settlements_received": money_str(b.settlements_received),
                        "net": money_str(b.net),
                    }
                    for b in balances
                ],
                "suggested_transfers": [
                    {
                        "from_user": {
                            "id": t.from_user_id,
                            "display_name": by_id[t.from_user_id].display_name,
                        },
                        "to_user": {
                            "id": t.to_user_id,
                            "display_name": by_id[t.to_user_id].display_name,
                        },
                        "amount": money_str(t.amount),
                    }
                    for t in transfers
                ],
            }
        )

    @extend_schema(parameters=[SummaryQuerySerializer])
    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated, IsTrackerMember])
    def summary(self, request, pk=None):
        tracker = self.get_object()

        params = SummaryQuerySerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        return Response(summary(tracker.pk, **params.validated_data))

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated, IsTrackerMember])
    def reconciliation(self, request, pk=None):
        tracker = self.get_object()
        total, people = reconcile(tracker.pk)
        return Response(
            {
                **total.as_dict(),
                "people": [
                    {
                        "user": UserBriefSerializer(membership.user).data,
                        "opening_date": membership.opening_date,
                        **result.as_dict(),
                    }
                    for membership, result in people
                ],
            }
        )


def models_q(*, user, invited_email):
    from django.db.models import Q

    q = Q(invited_email=invited_email)
    if user is not None:
        q |= Q(user=user)
    return q


class MembershipViewSet(
    TrackerScopedMixin,
    mixins.ListModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = MembershipSerializer
    permission_classes = [IsAuthenticated, IsTrackerMember]
    queryset = Membership.objects.select_related("user", "tracker")

    def get_queryset(self):
        return super().get_queryset().exclude(status=Membership.Status.REVOKED)

    # Il saldo iniziale e' un dato personale: ognuno gestisce il proprio.
    SELF_EDITABLE = {"opening_balance", "opening_date"}

    def perform_update(self, serializer):
        membership = self.get_object()
        actor = self.get_membership()
        is_self = actor is not None and actor.pk == membership.pk
        only_own_fields = set(serializer.validated_data) <= self.SELF_EDITABLE
        if actor is None or (
            actor.role != Membership.Role.OWNER and not (is_self and only_own_fields)
        ):
            self.permission_denied(self.request, message="Solo il proprietario modifica i membri.")
        if (
            membership.role == Membership.Role.OWNER
            and serializer.validated_data.get("role", Membership.Role.OWNER)
            != Membership.Role.OWNER
        ):
            self.permission_denied(
                self.request, message="Il proprietario non puo' declassare se stesso."
            )
        serializer.save()

    def perform_destroy(self, instance):
        actor = self.get_membership()
        if actor is None or actor.role != Membership.Role.OWNER:
            self.permission_denied(self.request, message="Solo il proprietario rimuove i membri.")
        if instance.role == Membership.Role.OWNER:
            self.permission_denied(self.request, message="Il proprietario non si puo' rimuovere.")
        instance.status = Membership.Status.REVOKED
        instance.save(update_fields=["status", "updated_at"])


class CategoryViewSet(TrackerScopedMixin, viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    permission_classes = [IsAuthenticated, IsTrackerMember]
    queryset = Category.objects.all()
    filterset_fields = ["type", "archived"]

    def perform_create(self, serializer):
        serializer.save(tracker=self.get_tracker())


class InviteAcceptView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: MembershipSerializer})
    @db_transaction.atomic
    def post(self, request, token: str):
        membership_id = read_invite_token(token)
        if membership_id is None:
            return Response(
                {"detail": "Invito non valido o scaduto."}, status=status.HTTP_400_BAD_REQUEST
            )
        membership = Membership.objects.filter(pk=membership_id).select_related("tracker").first()
        if membership is None or membership.status == Membership.Status.REVOKED:
            return Response(
                {"detail": "Invito non piu' disponibile."}, status=status.HTTP_400_BAD_REQUEST
            )
        if membership.status == Membership.Status.ACTIVE:
            return Response(MembershipSerializer(membership).data)

        if membership.user_id and membership.user_id != request.user.pk:
            return Response(
                {"detail": "L'invito e' intestato a un altro utente."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not membership.user_id and membership.invited_email.lower() != request.user.email:
            return Response(
                {"detail": "L'invito e' stato inviato a un altro indirizzo email."},
                status=status.HTTP_403_FORBIDDEN,
            )

        membership.user = request.user
        membership.status = Membership.Status.ACTIVE
        membership.save(update_fields=["user", "status", "updated_at"])
        return Response(MembershipSerializer(membership).data)


class InvitePreviewView(APIView):
    """Mostra a chi non e' ancora loggato di che tracker si tratta."""

    permission_classes = [AllowAny]

    def get(self, request, token: str):
        membership_id = read_invite_token(token)
        membership = (
            Membership.objects.filter(pk=membership_id).select_related("tracker").first()
            if membership_id
            else None
        )
        if membership is None:
            return Response(
                {"detail": "Invito non valido o scaduto."}, status=status.HTTP_400_BAD_REQUEST
            )
        return Response(
            {
                "tracker_name": membership.tracker.name,
                "invited_email": membership.invited_email,
                "role": membership.role,
                "status": membership.status,
            }
        )
