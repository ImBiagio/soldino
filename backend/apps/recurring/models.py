from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from dateutil.relativedelta import relativedelta
from dateutil.rrule import rrulestr
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.core.models import BaseModel
from apps.trackers.models import Tracker


class RecurringRule(BaseModel):
    """Ricorrenze e abbonamenti: stessa meccanica, ``is_subscription`` li separa."""

    class Frequency(models.TextChoices):
        WEEKLY = "weekly", "Settimanale"
        MONTHLY = "monthly", "Mensile"
        YEARLY = "yearly", "Annuale"
        CUSTOM = "custom", "Personalizzata (rrule)"

    tracker = models.ForeignKey(Tracker, on_delete=models.CASCADE, related_name="recurring_rules")
    type = models.CharField(max_length=10, choices=[("expense", "Spesa"), ("income", "Entrata")])
    title = models.CharField(max_length=200)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    category = models.ForeignKey(
        "trackers.Category", on_delete=models.SET_NULL, null=True, blank=True
    )
    account = models.ForeignKey(
        "accounts.Account", on_delete=models.SET_NULL, null=True, blank=True
    )
    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="recurring_rules"
    )
    frequency = models.CharField(max_length=10, choices=Frequency.choices)
    rrule = models.CharField(
        max_length=255, blank=True, help_text="Solo per frequency=custom, sintassi RFC 5545."
    )
    next_run = models.DateField(db_index=True)
    end_date = models.DateField(null=True, blank=True)
    is_subscription = models.BooleanField(default=False)
    auto_commit = models.BooleanField(
        default=False,
        help_text="Se falso la ricorrenza propone soltanto: nessuna scrittura automatica (§0.6).",
    )
    split_template = models.JSONField(
        default=list, blank=True, help_text='[{"user": "<uuid>", "share_pct": "50.00"}]'
    )
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["next_run"]
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="recurring_amount_gt_0")
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.frequency})"

    def clean(self):
        super().clean()
        if self.frequency == self.Frequency.CUSTOM and not self.rrule:
            raise ValidationError({"rrule": ["Serve una rrule per la frequenza personalizzata."]})

    def advance(self, from_date: date) -> date:
        if self.frequency == self.Frequency.WEEKLY:
            return from_date + timedelta(weeks=1)
        if self.frequency == self.Frequency.MONTHLY:
            return from_date + relativedelta(months=1)
        if self.frequency == self.Frequency.YEARLY:
            return from_date + relativedelta(years=1)
        occurrences = rrulestr(self.rrule, dtstart=from_date)
        following = occurrences.after(from_date)
        if following is None:
            raise ValidationError({"rrule": ["La rrule non produce occorrenze successive."]})
        return following.date()

    @property
    def monthly_cost(self) -> Decimal:
        """Costo mensilizzato, come le colonne Price per month del foglio."""
        factors = {
            self.Frequency.WEEKLY: Decimal("4.345"),
            self.Frequency.MONTHLY: Decimal(1),
            self.Frequency.YEARLY: Decimal(1) / Decimal(12),
        }
        factor = factors.get(self.frequency, Decimal(1))
        return (self.amount * factor).quantize(Decimal("0.01"))

    @property
    def yearly_cost(self) -> Decimal:
        return (self.monthly_cost * 12).quantize(Decimal("0.01"))
