from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.translation import gettext as _
from rest_framework import serializers

from apps.trackers.methods import is_active_member
from apps.transactions.services.splits import resolve_split_amounts, validate_split_users

from .models import RecurringRule
from .services import is_due


class RecurringRuleSerializer(serializers.ModelSerializer):
    monthly_cost = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    yearly_cost = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    is_due = serializers.SerializerMethodField()

    class Meta:
        model = RecurringRule
        fields = [
            "id",
            "type",
            "title",
            "amount",
            "category",
            "account",
            "paid_by",
            "frequency",
            "rrule",
            "next_run",
            "end_date",
            "is_subscription",
            "auto_commit",
            "split_template",
            "active",
            "monthly_cost",
            "yearly_cost",
            "is_due",
            "created_at",
        ]
        read_only_fields = ["id", "monthly_cost", "yearly_cost", "is_due", "created_at"]

    def get_is_due(self, obj) -> bool:
        """Calcolato col fuso del server: il client non deve indovinare che giorno e'."""
        return is_due(obj)

    def validate(self, attrs):
        tracker = self.context["tracker"]
        paid_by = attrs.get("paid_by") or getattr(self.instance, "paid_by", None)
        if paid_by and not is_active_member(tracker, paid_by):
            raise serializers.ValidationError(
                {"paid_by": _("Chi paga deve essere un membro attivo del tracker.")}
            )
        # Categoria e conto di un altro tracker esploderebbero solo all'approvazione.
        for field in ("category", "account"):
            related = attrs.get(field)
            if related is not None and related.tracker_id != tracker.pk:
                raise serializers.ValidationError({field: _("Appartiene a un altro tracker.")})

        template = attrs.get("split_template")
        if template:
            # Lo stesso controllo di una transazione vera: un template sbagliato
            # verrebbe scoperto solo all'approvazione, o di notte dal task.
            amount = attrs.get("amount") or getattr(self.instance, "amount", None)
            try:
                items = [
                    {
                        "user": item["user"],
                        "share_pct": item.get("share_pct"),
                        "share_amount": item.get("share_amount"),
                    }
                    for item in template
                ]
                validate_split_users(tracker, items)
                resolved = resolve_split_amounts(amount, items)
            except (KeyError, TypeError, ValueError, ArithmeticError):
                raise serializers.ValidationError(
                    {"split_template": _("Formato non valido: [{user, share_pct}].")}
                ) from None
            except DjangoValidationError as exc:
                raise serializers.ValidationError({"split_template": exc.messages}) from None
            # Si salvano i pesi normalizzati: l'importo puo' cambiare, la proporzione no.
            attrs["split_template"] = [
                {"user": str(r["user"]), "share_pct": str(r["share_pct"])} for r in resolved
            ]
        return attrs


class OccurrenceSerializer(serializers.Serializer):
    """Quale occorrenza si sta approvando o saltando: protegge dai doppi clic."""

    occurrence = serializers.DateField()
