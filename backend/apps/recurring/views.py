from django.db import transaction as db_transaction
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsTrackerMember
from apps.core.scoping import TrackerScopedMixin
from apps.transactions.serializers import TransactionSerializer

from .models import RecurringRule
from .serializers import OccurrenceSerializer, RecurringRuleSerializer
from .services import is_due, lock_rule, skip_occurrence, write_occurrence


class RecurringRuleViewSet(TrackerScopedMixin, viewsets.ModelViewSet):
    serializer_class = RecurringRuleSerializer
    permission_classes = [IsAuthenticated, IsTrackerMember]
    queryset = RecurringRule.objects.select_related("category", "account", "paid_by")
    filterset_fields = ["type", "frequency", "is_subscription", "active"]

    def perform_create(self, serializer):
        serializer.save(tracker=self.get_tracker())

    def _locked_due_rule(self, request):
        """La regola sotto lock, oppure la Response d'errore da restituire."""
        serializer = OccurrenceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rule = lock_rule(self.get_object().pk)
        if rule.next_run != serializer.validated_data["occurrence"] or not is_due(rule):
            return None, Response(
                {"detail": "Questa occorrenza e' gia' stata gestita."},
                status=status.HTTP_409_CONFLICT,
            )
        return rule, None

    @extend_schema(request=OccurrenceSerializer, responses={201: TransactionSerializer})
    @action(detail=True, methods=["post"])
    @db_transaction.atomic
    def approve(self, request, tracker_pk=None, pk=None):
        """Scrive l'occorrenza proposta come transazione e passa alla successiva."""
        rule, error = self._locked_due_rule(request)
        if error:
            return error
        tx = write_occurrence(rule, created_by=request.user)
        context = {"request": request, "tracker": rule.tracker}
        return Response(TransactionSerializer(tx, context=context).data, status=201)

    @extend_schema(request=OccurrenceSerializer, responses={200: RecurringRuleSerializer})
    @action(detail=True, methods=["post"])
    @db_transaction.atomic
    def skip(self, request, tracker_pk=None, pk=None):
        """Salta l'occorrenza proposta senza scrivere nulla."""
        rule, error = self._locked_due_rule(request)
        if error:
            return error
        skip_occurrence(rule)
        return Response(self.get_serializer(rule).data)
