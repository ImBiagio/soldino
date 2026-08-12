from __future__ import annotations

from django.db import transaction as db_transaction
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsTrackerMember
from apps.core.scoping import TrackerScopedMixin
from apps.transactions.models import Transaction
from apps.transactions.serializers import TransactionSerializer
from apps.transactions.services.splits import personal_split_input, sync_splits

from .models import Account, PendingItem
from .serializers import AccountSerializer, PendingItemConvertSerializer, PendingItemSerializer


class AccountViewSet(TrackerScopedMixin, viewsets.ModelViewSet):
    serializer_class = AccountSerializer
    permission_classes = [IsAuthenticated, IsTrackerMember]
    queryset = Account.objects.select_related("owner")
    filterset_fields = ["kind", "include_in_totals", "owner"]

    def perform_create(self, serializer):
        serializer.save(tracker=self.get_tracker())


class PendingItemViewSet(TrackerScopedMixin, viewsets.ModelViewSet):
    serializer_class = PendingItemSerializer
    permission_classes = [IsAuthenticated, IsTrackerMember]
    queryset = PendingItem.objects.select_related("owner")
    filterset_fields = ["status", "owner"]

    def perform_create(self, serializer):
        serializer.save(tracker=self.get_tracker())

    @extend_schema(
        request=PendingItemConvertSerializer, responses={201: TransactionSerializer}
    )
    @action(detail=True, methods=["post"])
    @db_transaction.atomic
    def convert(self, request, tracker_pk=None, pk=None):
        """Da impegno a movimento reale. Il segno dell'importo decide il tipo."""
        item = self.get_object()
        if item.status != PendingItem.Status.OPEN:
            return Response(
                {"detail": "Questo elemento e' gia' stato chiuso."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = PendingItemConvertSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        paid_by_id = data.get("paid_by") or item.owner_id
        tx = Transaction(
            tracker=item.tracker,
            type=Transaction.Type.INCOME if item.amount >= 0 else Transaction.Type.EXPENSE,
            date=data.get("date") or item.expected_date or item.created_at.date(),
            title=item.title,
            amount=abs(item.amount),
            category_id=data.get("category"),
            account_id=data.get("account"),
            paid_by_id=paid_by_id,
            note=item.note,
            source=Transaction.Source.MANUAL,
            created_by=request.user,
        )
        tx.full_clean(exclude=["merchant_normalized", "fingerprint"])
        tx.save()
        sync_splits(tx, data.get("splits") or personal_split_input(paid_by_id))

        item.status = PendingItem.Status.CONVERTED
        item.converted_transaction = tx
        item.save(update_fields=["status", "converted_transaction", "updated_at"])

        return Response(
            TransactionSerializer(tx, context={"request": request, "tracker": item.tracker}).data,
            status=status.HTTP_201_CREATED,
        )
