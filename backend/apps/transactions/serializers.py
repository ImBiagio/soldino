from __future__ import annotations

from decimal import Decimal

from django.db import transaction as db_transaction
from django.utils.translation import gettext as _
from rest_framework import serializers

from apps.core.methods import validate_positive_amount
from apps.trackers.methods import active_member_ids, require_active_member
from apps.users.serializers import UserBriefSerializer

from .methods import create_transaction
from .models import Settlement, Transaction, TransactionSplit
from .services.splits import (
    MODE_DEFAULT,
    MODE_PERSONAL,
    default_split_input,
    personal_split_input,
    sync_splits,
    validate_split_users,
)

# Un import o una bozza di scan grandi stanno ben sotto; oltre e' un abuso.
BULK_MAX_TRANSACTIONS = 1000


class SplitInputSerializer(serializers.Serializer):
    user = serializers.UUIDField()
    share_pct = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False, allow_null=True,
        min_value=0, max_value=100,
    )
    share_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=0
    )


class SplitSerializer(serializers.ModelSerializer):
    user_detail = UserBriefSerializer(source="user", read_only=True)

    class Meta:
        model = TransactionSplit
        fields = ["id", "user", "user_detail", "share_pct", "share_amount"]
        read_only_fields = fields


class TransactionSerializer(serializers.ModelSerializer):
    splits = SplitSerializer(many=True, read_only=True)
    splits_input = SplitInputSerializer(many=True, write_only=True, required=False)
    split_mode = serializers.ChoiceField(
        choices=[MODE_PERSONAL, MODE_DEFAULT], write_only=True, required=False
    )
    paid_by_detail = UserBriefSerializer(source="paid_by", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    category_color = serializers.CharField(source="category.color", read_only=True)
    account_name = serializers.CharField(source="account.name", read_only=True)
    possible_duplicates = serializers.SerializerMethodField()

    class Meta:
        model = Transaction
        fields = [
            "id",
            "type",
            "date",
            "title",
            "merchant_normalized",
            "amount",
            "category",
            "category_name",
            "category_color",
            "account",
            "account_name",
            "paid_by",
            "paid_by_detail",
            "note",
            "source",
            "fingerprint",
            "splits",
            "splits_input",
            "split_mode",
            "possible_duplicates",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "merchant_normalized",
            "fingerprint",
            "splits",
            "possible_duplicates",
            "created_at",
        ]

    def get_possible_duplicates(self, obj) -> list[str]:
        """Segnala, non blocca: nel foglio esistono righe identiche legittime."""
        if not obj.fingerprint:
            return []
        return [
            str(pk)
            for pk in Transaction.objects.filter(
                tracker_id=obj.tracker_id, fingerprint=obj.fingerprint
            )
            .exclude(pk=obj.pk)
            .values_list("pk", flat=True)[:5]
        ]

    def validate_amount(self, value: Decimal) -> Decimal:
        return validate_positive_amount(value)

    def validate_paid_by(self, user):
        return require_active_member(
            self.context["tracker"], user, _("Chi paga deve essere un membro attivo del tracker.")
        )

    def _resolve_split_items(self, validated_data, instance=None) -> list[dict] | None:
        tracker = self.context["tracker"]
        items = validated_data.pop("splits_input", None)
        mode = validated_data.pop("split_mode", None)

        paid_by = validated_data.get("paid_by") or (instance.paid_by if instance else None)

        if items:
            return [dict(i) for i in items]
        if mode == MODE_PERSONAL:
            return personal_split_input(paid_by.pk)
        if mode == MODE_DEFAULT:
            return default_split_input(tracker, paid_by.pk)
        if instance is None:
            # Nessuna indicazione: la transazione e' personale di chi ha pagato.
            return personal_split_input(paid_by.pk)
        return None

    @db_transaction.atomic
    def create(self, validated_data):
        tracker = self.context["tracker"]
        request = self.context["request"]
        items = self._resolve_split_items(validated_data)
        validate_split_users(tracker, items)
        return create_transaction(
            tracker=tracker, created_by=request.user, splits=items, **validated_data
        )

    @db_transaction.atomic
    def update(self, instance, validated_data):
        tracker = self.context["tracker"]
        items = self._resolve_split_items(validated_data, instance)

        amount_changed = (
            "amount" in validated_data and validated_data["amount"] != instance.amount
        )
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if "title" in validated_data:
            instance.merchant_normalized = ""  # ricalcolato in save()
        instance.full_clean(exclude=["merchant_normalized", "fingerprint"])
        instance.save()

        if items is None and amount_changed:
            # L'importo e' cambiato ma non gli split: si riproporziona sugli
            # importi esistenti, non sulle percentuali arrotondate a 2 decimali
            # (333,33/666,67 riportati a 33,33%/66,67% su 1000 darebbero 333,30).
            items = [
                {"user": s.user_id, "share_pct": s.share_amount} for s in instance.splits.all()
            ]
        if items is not None:
            validate_split_users(tracker, items)
            sync_splits(instance, items)
        else:
            instance.validate_splits()
        return instance


class TransactionBulkSerializer(serializers.Serializer):
    transactions = TransactionSerializer(many=True, max_length=BULK_MAX_TRANSACTIONS)

    @db_transaction.atomic
    def create(self, validated_data):
        serializer = self.fields["transactions"].child
        return [serializer.create(dict(item)) for item in validated_data["transactions"]]


class SettlementSerializer(serializers.ModelSerializer):
    from_user_detail = UserBriefSerializer(source="from_user", read_only=True)
    to_user_detail = UserBriefSerializer(source="to_user", read_only=True)

    class Meta:
        model = Settlement
        fields = [
            "id",
            "from_user",
            "from_user_detail",
            "to_user",
            "to_user_detail",
            "amount",
            "date",
            "note",
            "created_at",
        ]
        read_only_fields = ["id", "from_user_detail", "to_user_detail", "created_at"]

    def validate(self, attrs):
        tracker = self.context["tracker"]
        from_user = attrs.get("from_user") or getattr(self.instance, "from_user", None)
        to_user = attrs.get("to_user") or getattr(self.instance, "to_user", None)
        if from_user == to_user:
            raise serializers.ValidationError(_("Il pareggio richiede due utenti diversi."))
        member_ids = active_member_ids(tracker)
        if str(from_user.pk) not in member_ids or str(to_user.pk) not in member_ids:
            raise serializers.ValidationError(_("Entrambi gli utenti devono essere membri attivi."))
        if attrs.get("amount") is not None:
            validate_positive_amount(attrs["amount"])
        return attrs
