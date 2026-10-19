from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.db import models
from simple_history.models import HistoricalRecords

from apps.core.models import BaseModel
from apps.trackers.models import Tracker


class Account(BaseModel):
    """Conto o strumento di pagamento (Hype, BBVA, Illimity, Cash, PayPal...)."""

    class Kind(models.TextChoices):
        BANK = "bank", "Conto corrente"
        CARD = "card", "Carta"
        CASH = "cash", "Contanti"
        WALLET = "wallet", "Wallet"

    tracker = models.ForeignKey(Tracker, on_delete=models.CASCADE, related_name="accounts")
    name = models.CharField(max_length=80)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="accounts"
    )
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.BANK)
    current_balance = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Saldo dichiarato dall'utente, non derivato dalle transazioni.",
    )
    balance_updated_at = models.DateTimeField(null=True, blank=True)
    include_in_totals = models.BooleanField(default=True)

    history = HistoricalRecords(inherit=False)

    class Meta:
        ordering = ["name"]
        constraints = [
            # Unico per persona, non per tracker: "Hype" di Anna e "Hype" di
            # Bruno sono due conti diversi.
            models.UniqueConstraint(
                fields=["tracker", "owner", "name"],
                condition=models.Q(deleted_at__isnull=True),
                name="uniq_account_tracker_owner_name",
            )
        ]

    def __str__(self) -> str:
        return self.name


class PendingItem(BaseModel):
    """Il foglio "BTA": soldi attesi o impegnati ma non ancora movimentati.

    ``amount`` puo' essere negativo (es. "Regalo Zia -700"): e' un impegno, non
    una transazione, quindi non passa dal vincolo ``amount > 0``.
    """

    class Status(models.TextChoices):
        OPEN = "open", "Aperto"
        CONVERTED = "converted", "Convertito"
        CANCELLED = "cancelled", "Annullato"

    tracker = models.ForeignKey(Tracker, on_delete=models.CASCADE, related_name="pending_items")
    title = models.CharField(max_length=200)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="pending_items"
    )
    expected_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    converted_transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="from_pending_items",
    )
    note = models.TextField(blank=True)

    class Meta:
        ordering = ["expected_date", "-created_at"]

    def __str__(self) -> str:
        return f"{self.title} ({self.amount})"
