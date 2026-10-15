from __future__ import annotations

from django.conf import settings
from rest_framework import serializers

from apps.accounts.models import Account
from apps.core.methods import validate_positive_amount
from apps.trackers.methods import is_active_member
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
            "external_id",
        ]
        # Posizione e provenienza della categoria le decide il server.
        read_only_fields = [
            "id", "position", "category_source", "duplicate_of", "transaction", "external_id",
        ]

    def validate_amount(self, value):
        return validate_positive_amount(value)

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
        if paid_by and not is_active_member(tracker, paid_by):
            raise serializers.ValidationError({"paid_by": "Deve essere un membro del tracker."})
        return attrs


class LinesReplaceSerializer(serializers.Serializer):
    lines = StatementLineSerializer(many=True, max_length=1000)


class StatementImportSerializer(serializers.ModelSerializer):
    uploaded_by_detail = UserBriefSerializer(source="uploaded_by", read_only=True)
    account_name = serializers.CharField(source="account.name", read_only=True, default=None)
    lines = StatementLineSerializer(many=True, read_only=True)
    line_count = serializers.SerializerMethodField()
    has_file = serializers.SerializerMethodField()

    class Meta:
        model = StatementImport
        fields = [
            "id",
            "source",
            "filename",
            "has_file",
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
            "updated_at",
        ]
        read_only_fields = fields

    def get_line_count(self, obj) -> int:
        return obj.lines.count()

    def get_has_file(self, obj) -> bool:
        """La foto si scarica a parte (``…/file``): qui solo se c'e' ancora."""
        present = getattr(obj, "file_present", None)
        return obj.pdf is not None if present is None else present


def sniff_image(head: bytes) -> str | None:
    """Il tipo di una foto dai primi byte, non dall'estensione o dal Content-Type."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    # HEIC/HEIF (foto dell'iPhone): box "ftyp" con un brand della famiglia.
    if head[4:8] == b"ftyp" and head[8:12] in {b"heic", b"heix", b"heim", b"heis", b"mif1"}:
        return "image/heic"
    return None


class StatementUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    # Solo i file caricati a mano: le bozze della banca le crea la sincronizzazione.
    source = serializers.ChoiceField(
        choices=[
            (StatementImport.Source.SCAN, StatementImport.Source.SCAN.label),
            (StatementImport.Source.RECEIPT, StatementImport.Source.RECEIPT.label),
        ],
        default=StatementImport.Source.SCAN,
    )
    account = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.all(), required=False, allow_null=True
    )

    def validate(self, attrs):
        upload = attrs["file"]
        if upload.size > settings.STATEMENT_MAX_BYTES:
            raise serializers.ValidationError({"file": "Il file e' troppo grande (max 15 MB)."})
        head = upload.read(16)
        upload.seek(0)
        if attrs["source"] == StatementImport.Source.RECEIPT:
            mime_type = sniff_image(head)
            if mime_type is None:
                raise serializers.ValidationError(
                    {"file": "Serve una foto (JPEG, PNG, WebP o HEIC)."}
                )
        elif head.startswith(b"%PDF-"):
            mime_type = "application/pdf"
        else:
            raise serializers.ValidationError({"file": "Serve un file PDF."})
        attrs["mime_type"] = mime_type
        return attrs

    def validate_account(self, account):
        if account is not None and account.tracker_id != self.context["tracker"].pk:
            raise serializers.ValidationError("Il conto appartiene a un altro tracker.")
        return account

