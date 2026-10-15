from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsTrackerMember
from apps.core.scoping import TrackerScopedMixin

from .filters import TransactionFilter
from .models import Settlement, Transaction
from .serializers import SettlementSerializer, TransactionBulkSerializer, TransactionSerializer


class TransactionViewSet(TrackerScopedMixin, viewsets.ModelViewSet):
    serializer_class = TransactionSerializer
    permission_classes = [IsAuthenticated, IsTrackerMember]
    filterset_class = TransactionFilter
    ordering_fields = ["date", "amount", "created_at", "title"]
    ordering = ["-date", "-created_at"]
    queryset = (
        Transaction.objects.select_related("category", "account", "paid_by")
        .prefetch_related("splits__user")
    )


class SettlementViewSet(TrackerScopedMixin, viewsets.ModelViewSet):
    serializer_class = SettlementSerializer
    permission_classes = [IsAuthenticated, IsTrackerMember]
    queryset = Settlement.objects.select_related("from_user", "to_user")
    ordering_fields = ["date", "amount"]

    def perform_create(self, serializer):
        serializer.save(tracker=self.get_tracker(), created_by=self.request.user)


class TransactionBulkView(TrackerScopedMixin, APIView):
    """Inserimento multiplo. Riusato dall'import di fase 2 dopo l'approvazione."""

    permission_classes = [IsAuthenticated, IsTrackerMember]

    @extend_schema(
        request=TransactionBulkSerializer, responses={201: TransactionSerializer(many=True)}
    )
    def post(self, request, tracker_pk=None):
        context = {"request": request, "tracker": self.get_tracker()}
        serializer = TransactionBulkSerializer(data=request.data, context=context)
        serializer.is_valid(raise_exception=True)
        created = serializer.save()
        return Response(
            TransactionSerializer(created, many=True, context=context).data,
            status=status.HTTP_201_CREATED,
        )
