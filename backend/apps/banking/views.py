from __future__ import annotations

from django.core.cache import cache
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsTrackerMember
from apps.core.scoping import TrackerScopedMixin

from .models import BankAccount, BankConnection, BankingApp
from .serializers import (
    AspspSerializer,
    BankAccountSerializer,
    BankConnectionSerializer,
    BankingAppUploadSerializer,
    BankingStatusSerializer,
    CompleteConnectionSerializer,
    StartConnectionSerializer,
    SyncResultSerializer,
    banking_status,
)
from .services.crypto import PrivateKeyError
from .services.enablebanking import BankingError
from .services.sync import (
    client_for,
    complete_connection,
    disconnect,
    require_app,
    save_app,
    start_connection,
    sync_account,
)

ASPSP_CACHE_SECONDS = 24 * 60 * 60


def _error(exc: Exception, code=status.HTTP_400_BAD_REQUEST) -> Response:
    return Response({"detail": str(exc)}, status=code)


class BankingAppView(APIView):
    """L'applicazione Enable Banking dell'utente: stato, caricamento della chiave, rimozione."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @property
    def throttle_scope(self):
        return "banking" if self.request.method == "PUT" else None

    @extend_schema(responses=BankingStatusSerializer)
    def get(self, request):
        return Response(banking_status(request.user))

    @extend_schema(request=BankingAppUploadSerializer, responses=BankingStatusSerializer)
    def put(self, request):
        payload = BankingAppUploadSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            save_app(
                request.user,
                app_id=str(payload.validated_data["app_id"]),
                pem=payload.validated_data["key"].read(),
            )
        except (PrivateKeyError, BankingError) as exc:
            return _error(exc)
        return Response(banking_status(request.user))

    @extend_schema(responses={204: None})
    def delete(self, request):
        """Toglie la chiave e chiude ogni collegamento dell'utente."""
        for connection in BankConnection.objects.filter(user=request.user):
            disconnect(connection)
        # Hard delete: una chiave privata non resta nel database "cancellata per finta".
        BankingApp.all_objects.filter(user=request.user).hard_delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AspspListView(APIView):
    """Le banche disponibili per l'applicazione dell'utente in un paese."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=AspspSerializer(many=True))
    def get(self, request):
        country = (request.query_params.get("country") or "IT").upper()[:2]
        try:
            app = require_app(request.user)
            key = f"banking:aspsps:{app.app_id}:{country}"
            aspsps = cache.get(key)
            if aspsps is None:
                aspsps = [
                    {
                        "name": a.get("name"),
                        "country": a.get("country"),
                        "logo": a.get("logo") or "",
                        "beta": bool(a.get("beta")),
                        "maximum_consent_validity": a.get("maximum_consent_validity"),
                    }
                    for a in client_for(app).aspsps(country)
                ]
                cache.set(key, aspsps, ASPSP_CACHE_SECONDS)
        except (PrivateKeyError, BankingError) as exc:
            return _error(exc)
        return Response(sorted(aspsps, key=lambda a: (a["name"] or "").lower()))


class CompleteConnectionView(APIView):
    """Ritorno dalla banca (pagina /banca/callback): il codice diventa una sessione."""

    permission_classes = [IsAuthenticated]
    throttle_scope = "banking"

    @extend_schema(request=CompleteConnectionSerializer, responses=BankConnectionSerializer)
    def post(self, request):
        payload = CompleteConnectionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            connection = complete_connection(request.user, **payload.validated_data)
        except (PrivateKeyError, BankingError) as exc:
            BankConnection.objects.filter(
                user=request.user,
                state=payload.validated_data["state"],
                status=BankConnection.Status.PENDING,
            ).update(status=BankConnection.Status.FAILED, error=str(exc))
            return _error(exc)
        return Response(BankConnectionSerializer(connection).data)


class BankConnectionViewSet(
    TrackerScopedMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """I collegamenti dell'utente partiti da questo tracker. Nessuno vede quelli altrui."""

    serializer_class = BankConnectionSerializer
    permission_classes = [IsAuthenticated, IsTrackerMember]
    queryset = BankConnection.objects.prefetch_related("accounts__account")
    pagination_class = None

    @property
    def throttle_scope(self):
        return "banking" if self.action == "create" else None

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(user=self.request.user)
            .exclude(status__in=[BankConnection.Status.PENDING, BankConnection.Status.FAILED])
        )

    @extend_schema(request=StartConnectionSerializer, responses={201: None})
    def create(self, request, tracker_pk=None):
        """Apre l'autorizzazione: il frontend manda l'utente all'``url`` della banca."""
        payload = StartConnectionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        try:
            connection, url = start_connection(
                request.user,
                self.get_tracker(),
                aspsp_name=data["aspsp_name"],
                country=data["country"].upper(),
                logo=data.get("logo") or "",
                max_validity=data.get("max_validity"),
            )
        except (PrivateKeyError, BankingError) as exc:
            return _error(exc)
        return Response({"id": str(connection.pk), "url": url}, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        disconnect(instance)


class BankAccountViewSet(
    TrackerScopedMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Abbinamento a un conto di Soldino, registrazione automatica, data di partenza."""

    serializer_class = BankAccountSerializer
    permission_classes = [IsAuthenticated, IsTrackerMember]
    queryset = BankAccount.objects.select_related("connection", "account")
    tracker_lookup = "connection__tracker"

    @property
    def throttle_scope(self):
        return "banking" if self.action == "sync" else None

    def get_queryset(self):
        return super().get_queryset().filter(connection__user=self.request.user)

    def perform_update(self, serializer):
        before = (serializer.instance.account_id, serializer.instance.sync_from)
        bank_account = serializer.save()
        if (bank_account.account_id, bank_account.sync_from) != before:
            # Un altro conto di Soldino o un'altra data di partenza: il giro dopo
            # riparte da sync_from, non da dove era arrivato. I movimenti gia'
            # letti non si ripetono (SeenBankTransaction).
            bank_account.synced_until = None
            bank_account.save(update_fields=["synced_until", "updated_at"])

    @extend_schema(request=None, responses=SyncResultSerializer)
    @action(detail=True, methods=["post"])
    def sync(self, request, tracker_pk=None, pk=None):
        """Sincronizza adesso (saldo e movimenti), senza aspettare il giro programmato."""
        bank_account = self.get_object()
        if bank_account.account_id is None:
            return Response(
                {"detail": "Abbina prima il conto a un conto di Soldino."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            result = sync_account(bank_account)
        except (PrivateKeyError, BankingError) as exc:
            return _error(exc, status.HTTP_502_BAD_GATEWAY)
        return Response(SyncResultSerializer(result).data)
