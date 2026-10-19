from __future__ import annotations

from django.utils.translation import gettext as _
from rest_framework import serializers

from apps.trackers.methods import require_active_member
from apps.transactions.serializers import SplitInputSerializer
from apps.users.serializers import UserBriefSerializer

from .models import Account, PendingItem


def validate_member_owner(serializer, user):
    """Conti e BTA di un non membro sfuggirebbero alla riconciliazione per persona."""
    return require_active_member(serializer.context["tracker"], user)


class AccountSerializer(serializers.ModelSerializer):
    owner_detail = UserBriefSerializer(source="owner", read_only=True)

    class Meta:
        model = Account
        fields = [
            "id",
            "name",
            "owner",
            "owner_detail",
            "kind",
            "current_balance",
            "balance_updated_at",
            "include_in_totals",
            "created_at",
        ]
        read_only_fields = ["id", "owner_detail", "balance_updated_at", "created_at"]

    def validate_owner(self, user):
        return validate_member_owner(self, user)

    def validate(self, attrs):
        # Il vincolo del DB, ma con un 400 leggibile invece di un errore di integrita'.
        name = attrs.get("name", getattr(self.instance, "name", None))
        owner = attrs.get("owner", getattr(self.instance, "owner", None))
        clash = Account.objects.filter(tracker=self.context["tracker"], owner=owner, name=name)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(
                {"name": _("Questa persona ha gia' un conto con questo nome.")}
            )
        return attrs

    def _touch_balance(self, instance, validated_data):
        from django.utils import timezone

        if "current_balance" in validated_data:
            instance.balance_updated_at = timezone.now()
        return instance

    def create(self, validated_data):
        instance = super().create(validated_data)
        self._touch_balance(instance, validated_data)
        instance.save(update_fields=["balance_updated_at"])
        return instance

    def update(self, instance, validated_data):
        changed = validated_data.get("current_balance") != instance.current_balance
        instance = super().update(instance, validated_data)
        if changed:
            self._touch_balance(instance, validated_data)
            instance.save(update_fields=["balance_updated_at"])
        return instance


class PendingItemSerializer(serializers.ModelSerializer):
    owner_detail = UserBriefSerializer(source="owner", read_only=True)

    class Meta:
        model = PendingItem
        fields = [
            "id",
            "title",
            "amount",
            "owner",
            "owner_detail",
            "expected_date",
            "status",
            "converted_transaction",
            "note",
            "created_at",
        ]
        read_only_fields = ["id", "owner_detail", "status", "converted_transaction", "created_at"]

    def validate_owner(self, user):
        return validate_member_owner(self, user)


class PendingItemConvertSerializer(serializers.Serializer):
    """Converte un BTA in transazione: il segno decide spesa o entrata."""

    date = serializers.DateField(required=False)
    account = serializers.UUIDField(required=False, allow_null=True)
    category = serializers.UUIDField(required=False, allow_null=True)
    paid_by = serializers.UUIDField(required=False, allow_null=True)
    splits = SplitInputSerializer(many=True, required=False)

    def validate_paid_by(self, user_id):
        if user_id is None:
            return None
        return require_active_member(
            self.context["tracker"],
            user_id,
            _("Chi paga deve essere un membro attivo del tracker."),
        )
