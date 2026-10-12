from __future__ import annotations

from django.conf import settings
from rest_framework import serializers

from apps.accounts.models import Account
from apps.trackers.models import Membership
from apps.users.serializers import UserBriefSerializer

from .models import StatementImport, StatementLine


class StatementLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = StatementLine
        fields = [
            "id",
            "position",
            "date",
            "title",
            "amount",
            "type",
            "category",
            "category_source",
            "paid_by",
            "split_mode",
            "duplicate_of",
            "transaction",
        ]
        # Posizione e provenienza della categoria le decide il server.
        read_only_fields = ["id", "position", "category_source", "duplicate_of", "transaction"]

    def validate_amount(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError("L'importo deve essere positivo.")
        return value

    def validate(self, attrs):
        tracker = self.context["tracker"]
        category = attrs.get("category")
        if category is not None:
            if category.tracker_id != tracker.pk:
                raise serializers.ValidationError({"category": "Categoria di un altro tracker."})
            if category.type != attrs.get("type"):
                raise serializers.ValidationError(
                    {"category": "La categoria e' di tipo diverso dal movimento."}
                )
        paid_by = attrs.get("paid_by")
        if paid_by and not Membership.objects.filter(
            tracker=tracker, user=paid_by, status=Membership.Status.ACTIVE
        ).exists():
            raise serializers.ValidationError({"paid_by": "Deve essere un membro del tracker."})
        return attrs


class LinesReplaceSerializer(serializers.Serializer):
    lines = StatementLineSerializer(many=True)


class StatementImportSerializer(serializers.ModelSerializer):
    uploaded_by_detail = UserBriefSerializer(source="uploaded_by", read_only=True)
    account_name = serializers.CharField(source="account.name", read_only=True, default=None)
    lines = StatementLineSerializer(many=True, read_only=True)
    line_count = serializers.SerializerMethodField()

    class Meta:
        model = StatementImport
        fields = [
            "id",
            "filename",
            "account",
            "account_name",
            "default_payer",
            "status",
            "error",
            "model_name",
            "period_start",
            "period_end",
            "committed_at",
            "uploaded_by_detail",
            "line_count",
            "lines",
            "created_at",
        ]
        read_only_fields = fields

    def get_line_count(self, obj) -> int:
        return obj.lines.count()


class StatementUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    account = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.all(), required=False, allow_null=True
    )

    def validate_file(self, upload):
        if upload.size > settings.STATEMENT_MAX_BYTES:
            raise serializers.ValidationError("Il PDF e' troppo grande (max 15 MB).")
        head = upload.read(5)
        upload.seek(0)
        if head != b"%PDF-":
            raise serializers.ValidationError("Serve un file PDF.")
        return upload

    def validate_account(self, account):
        if account is not None and account.tracker_id != self.context["tracker"].pk:
            raise serializers.ValidationError("Il conto appartiene a un altro tracker.")
        return account

