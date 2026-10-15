"""Scan dell'estratto conto e dello scontrino: righe in bozza, approvate a mano
(ADR 0008, ADR 0014 per lo scontrino).

Niente arriva nei movimenti finche' qualcuno non preme OK: lo scan produce
``StatementLine``, il commit le trasforma in ``Transaction`` tutte insieme.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel
from apps.trackers.models import Tracker


class StatementImport(BaseModel):
    class Source(models.TextChoices):
        SCAN = "scan", "Estratto conto (PDF)"
        RECEIPT = "receipt", "Scontrino (foto)"

    class Status(models.TextChoices):
        PROCESSING = "processing", "In lettura"
        READY = "ready", "Da rivedere"
        FAILED = "failed", "Non riuscito"
        COMMITTED = "committed", "Registrato"

    tracker = models.ForeignKey(Tracker, on_delete=models.CASCADE, related_name="statements")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="statements"
    )
    # Da dove vengono le righe. Lo scontrino ne produce sempre una sola.
    source = models.CharField(max_length=8, choices=Source.choices, default=Source.SCAN)
    filename = models.CharField(max_length=255)
    # Il file caricato: il PDF dell'estratto conto o la foto dello scontrino.
    # Il PDF si cancella appena letto (contiene molto piu' dei movimenti che ci
    # interessano); la foto resta finche' la spesa non e' registrata o scartata,
    # perche' in revisione la si guarda accanto alla riga.
    pdf = models.BinaryField(null=True, blank=True, editable=False)
    mime_type = models.CharField(max_length=40, default="application/pdf")
    account = models.ForeignKey(
        "accounts.Account", on_delete=models.SET_NULL, null=True, blank=True
    )
    default_payer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PROCESSING)
    error = models.TextField(blank=True)
    model_name = models.CharField(max_length=80, blank=True)
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    committed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.filename} ({self.status})"

    @property
    def is_receipt(self) -> bool:
        return self.source == self.Source.RECEIPT


class StatementLine(BaseModel):
    class CategorySource(models.TextChoices):
        HISTORY = "history", "Dallo storico"
        AI = "ai", "Suggerita"
        MANUAL = "manual", "Scelta a mano"
        NONE = "", "Nessuna"

    class SplitMode(models.TextChoices):
        PERSONAL = "personal", "Solo di chi paga"
        DEFAULT = "default", "Divisione di default"

    statement = models.ForeignKey(StatementImport, on_delete=models.CASCADE, related_name="lines")
    position = models.PositiveIntegerField(default=0)
    date = models.DateField()
    title = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    type = models.CharField(max_length=10, choices=[("expense", "Spesa"), ("income", "Entrata")])
    category = models.ForeignKey(
        "trackers.Category", on_delete=models.SET_NULL, null=True, blank=True
    )
    category_source = models.CharField(
        max_length=10, choices=CategorySource.choices, blank=True, default=""
    )
    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    split_mode = models.CharField(
        max_length=10, choices=SplitMode.choices, default=SplitMode.PERSONAL
    )
    # Segnalato, non bloccato: nel foglio esistono righe identiche legittime.
    duplicate_of = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="statement_lines",
    )

    class Meta:
        ordering = ["position", "date"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0), name="statement_line_amount_gt_0"
            )
        ]

    def __str__(self) -> str:
        return f"{self.date} {self.title} {self.amount}"
