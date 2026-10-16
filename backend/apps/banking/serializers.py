from __future__ import annotations

from django.utils.translation import gettext as _
from rest_framework import serializers

from apps.accounts.models import Account

from .models import BankAccount, BankConnection, BankingApp
from .services.sync import callback_url

MAX_KEY_BYTES = 20_000


class BankingAppSerializer(serializers.ModelSerializer):
    """Mai la chiave: solo cosa serve al wizard per sapere a che punto e'."""

    class Meta:
        model = BankingApp
        fields = ["app_id", "name", "environment", "active", "redirect_urls", "verified_at"]
        read_only_fields = fields


class BankingAppUploadSerializer(serializers.Serializer):
    app_id = serializers.UUIDField()
    key = serializers.FileField()

    def validate_key(self, upload):
        if upload.size > MAX_KEY_BYTES:
            raise serializers.ValidationError(_("Il file e' troppo grande per essere una chiave."))
        return upload


class BankingStatusSerializer(serializers.Serializer):
    configured = serializers.BooleanField()
    callback_url = serializers.CharField()
    app = BankingAppSerializer(allow_null=True)


def banking_status(user) -> dict:
    app = BankingApp.objects.filter(user=user).first()
    return {
        "configured": app is not None,
        "callback_url": callback_url(),
        "app": BankingAppSerializer(app).data if app else None,
    }


class AspspSerializer(serializers.Serializer):
    name = serializers.CharField()
    country = serializers.CharField()
    logo = serializers.CharField(allow_blank=True, required=False)
    beta = serializers.BooleanField(required=False)
    maximum_consent_validity = serializers.IntegerField(required=False, allow_null=True)


class BankAccountSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source="account.name", read_only=True, default=None)
    draft = serializers.SerializerMethodField()

    class Meta:
        model = BankAccount
        fields = [
            "id",
            "name",
            "iban",
            "currency",
            "account",
            "account_name",
            "auto_commit",
            "sync_from",
            "last_synced_at",
            "synced_until",
            "last_error",
            "draft",
        ]
        read_only_fields = [
            "id", "name", "iban", "currency", "account_name", "last_synced_at",
            "synced_until", "last_error", "draft",
        ]

    def get_draft(self, obj) -> dict | None:
        """La bozza ancora da rivedere per il conto abbinato, se c'e'."""
        from apps.ingestion.models import StatementImport

        if not obj.account_id:
            return None
        draft = StatementImport.objects.filter(
            source=StatementImport.Source.BANK,
            account_id=obj.account_id,
            status=StatementImport.Status.READY,
        ).first()
        return {"id": str(draft.pk), "line_count": draft.lines.count()} if draft else None

    def validate_account(self, account: Account | None):
        if account is None:
            return None
        connection = self.instance.connection
        if account.tracker_id != connection.tracker_id:
            raise serializers.ValidationError(_("Il conto appartiene a un altro tracker."))
        if account.owner_id != connection.user_id:
            # Chi intesta il conto paga le sue righe: un conto altrui sbaglierebbe i debiti.
            raise serializers.ValidationError(_("Puoi abbinare solo un conto intestato a te."))
        taken = (
            BankAccount.objects.filter(
                account=account, connection__status=BankConnection.Status.ACTIVE
            )
            .exclude(pk=self.instance.pk)
            .exists()
        )
        if taken:
            raise serializers.ValidationError(
                _("Questo conto e' gia' abbinato a un altro conto in banca.")
            )
        return account


class BankConnectionSerializer(serializers.ModelSerializer):
    accounts = BankAccountSerializer(many=True, read_only=True)

    class Meta:
        model = BankConnection
        fields = [
            "id",
            "tracker",
            "aspsp_name",
            "aspsp_country",
            "aspsp_logo",
            "valid_until",
            "status",
            "error",
            "accounts",
            "created_at",
        ]
        read_only_fields = fields


class StartConnectionSerializer(serializers.Serializer):
    aspsp_name = serializers.CharField(max_length=120)
    country = serializers.CharField(max_length=2, default="IT")
    logo = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    max_validity = serializers.IntegerField(required=False, allow_null=True, min_value=0)


class CompleteConnectionSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=2000)
    state = serializers.CharField(max_length=64)


class SyncResultSerializer(serializers.Serializer):
    balance = serializers.DecimalField(
        max_digits=12, decimal_places=2, allow_null=True, required=False
    )
    committed = serializers.IntegerField(required=False)
    drafted = serializers.IntegerField(required=False)
    skipped = serializers.CharField(required=False)
    already_seen = serializers.IntegerField(required=False)

