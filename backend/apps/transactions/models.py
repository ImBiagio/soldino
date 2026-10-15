from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from simple_history.models import HistoricalRecords

from apps.core.models import BaseModel
from apps.core.normalize import normalize_merchant, transaction_fingerprint
from apps.trackers.models import Tracker


class Transaction(BaseModel):
    """Una sola tabella per spese ed entrate (§0.1). ``amount`` e' sempre positivo."""

    class Type(models.TextChoices):
        EXPENSE = "expense", "Spesa"
        INCOME = "income", "Entrata"

    class Source(models.TextChoices):
        MANUAL = "manual", "Manuale"
        IMPORT = "import", "Import"
        SCAN = "scan", "Scan estratto conto"
        RECEIPT = "receipt", "Scontrino"
        BANK = "bank", "Open banking"
        VOICE = "voice", "Messaggio vocale"
        RECURRING = "recurring", "Ricorrenza"

    tracker = models.ForeignKey(Tracker, on_delete=models.CASCADE, related_name="transactions")
    type = models.CharField(max_length=10, choices=Type.choices, db_index=True)
    # DateField e non DateTimeField: le date del foglio hanno orari fantasma
    # che spostavano le spese di mese (§0.3).
    date = models.DateField(db_index=True)
    title = models.CharField(max_length=255)
    merchant_normalized = models.CharField(max_length=255, blank=True, db_index=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    category = models.ForeignKey(
        "trackers.Category",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
    )
    account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
    )
    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="transactions_paid"
    )
    note = models.TextField(blank=True)
    # Indicizzato ma NON unique: nel foglio esistono righe identiche legittime.
    fingerprint = models.CharField(max_length=64, blank=True, db_index=True)
    source = models.CharField(max_length=12, choices=Source.choices, default=Source.MANUAL)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="transactions_created",
    )

    history = HistoricalRecords(inherit=False, excluded_fields=["updated_at"])

    class Meta:
        ordering = ["-date", "-created_at"]
        indexes = [
            models.Index(fields=["tracker", "date"]),
            models.Index(fields=["tracker", "type", "date"]),
        ]
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="transaction_amount_gt_0")
        ]

    def __str__(self) -> str:
        return f"{self.date} {self.title} {self.amount}"

    def save(self, *args, **kwargs):
        if not self.merchant_normalized:
            self.merchant_normalized = normalize_merchant(self.title)
        self.fingerprint = transaction_fingerprint(
            tx_date=self.date,
            amount=self.amount,
            merchant_normalized=self.merchant_normalized,
            account_id=self.account_id,
        )
        super().save(*args, **kwargs)

    @property
    def splits_total(self) -> Decimal:
        return sum((s.share_amount for s in self.splits.all()), Decimal("0.00"))

    def validate_splits(self) -> None:
        """Verita' contabile: la somma delle quote e' esattamente l'importo (§2.1).

        Chiamata esplicitamente dopo aver scritto gli split, perche' a
        ``full_clean()`` la transazione potrebbe non averli ancora.
        """
        total = self.splits_total
        if total != self.amount:
            raise ValidationError(
                {
                    "splits": [
                        f"La somma delle quote ({total}) non coincide con "
                        f"l'importo ({self.amount})."
                    ]
                }
            )

    def clean(self):
        super().clean()
        if self.amount is not None and self.amount <= 0:
            raise ValidationError({"amount": ["L'importo deve essere positivo."]})
        if self.category_id and self.category.tracker_id != self.tracker_id:
            raise ValidationError({"category": ["La categoria appartiene a un altro tracker."]})
        if self.account_id and self.account.tracker_id != self.tracker_id:
            raise ValidationError({"account": ["Il conto appartiene a un altro tracker."]})
        if self.category_id and self.category.type != self.type:
            raise ValidationError(
                {"category": ["Categoria di tipo diverso dalla transazione."]}
            )


class TransactionSplit(BaseModel):
    transaction = models.ForeignKey(
        Transaction, on_delete=models.CASCADE, related_name="splits"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="transaction_splits"
    )
    share_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("0.00"),
        help_text="Informativo, per l'UI. La verita' contabile e' share_amount.",
    )
    share_amount = models.DecimalField(max_digits=12, decimal_places=2)

    history = HistoricalRecords(inherit=False, excluded_fields=["updated_at"])

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["transaction", "user"],
                condition=models.Q(deleted_at__isnull=True),
                name="uniq_split_transaction_user",
            ),
            models.CheckConstraint(
                condition=models.Q(share_amount__gte=0), name="split_share_amount_gte_0"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}: {self.share_amount}"


class Settlement(BaseModel):
    """Pareggio dei debiti. Non e' una spesa: non entra in nessuna statistica."""

    tracker = models.ForeignKey(Tracker, on_delete=models.CASCADE, related_name="settlements")
    from_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="settlements_sent"
    )
    to_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="settlements_received"
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField()
    note = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="settlements_created",
        null=True,
        blank=True,
    )

    history = HistoricalRecords(inherit=False, excluded_fields=["updated_at"])

    class Meta:
        ordering = ["-date", "-created_at"]
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="settlement_amount_gt_0"),
            models.CheckConstraint(
                condition=~models.Q(from_user=models.F("to_user")),
                name="settlement_users_differ",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.from_user_id} -> {self.to_user_id}: {self.amount}"
