"""Open banking con Enable Banking (ADR 0013).

Ogni utente porta la sua applicazione Enable Banking (``BankingApp``), autorizza
una banca (``BankConnection``) e abbina i conti che ne escono (``BankAccount``)
ai suoi conti di Soldino. I movimenti arrivano nella bozza dello scan.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel
from apps.trackers.models import Tracker


class BankingApp(BaseModel):
    """L'applicazione Enable Banking di un utente: application ID e chiave privata."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="banking_app"
    )
    app_id = models.UUIDField()
    # Cifrata con BANKING_ENCRYPTION_KEY: e' la chiave che firma ogni chiamata.
    private_key = models.BinaryField(editable=False)
    name = models.CharField(max_length=120, blank=True)
    environment = models.CharField(max_length=20, blank=True)
    active = models.BooleanField(default=False)
    redirect_urls = models.JSONField(default=list, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        return f"{self.name or self.app_id} ({self.user_id})"


class BankConnection(BaseModel):
    """Un'autorizzazione presso una banca: la sessione PSD2 e la sua scadenza."""

    class Status(models.TextChoices):
        PENDING = "pending", "In autorizzazione"
        ACTIVE = "active", "Attiva"
        EXPIRED = "expired", "Scaduta"
        FAILED = "failed", "Non riuscita"
        REPLACED = "replaced", "Rinnovata"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bank_connections"
    )
    # Il tracker da cui e' partito il collegamento: e' dove si torna dopo la banca.
    tracker = models.ForeignKey(
        Tracker, on_delete=models.CASCADE, related_name="bank_connections"
    )
    aspsp_name = models.CharField(max_length=120)
    aspsp_country = models.CharField(max_length=2)
    aspsp_logo = models.URLField(max_length=500, blank=True)
    state = models.CharField(max_length=64, unique=True)
    session_id = models.CharField(max_length=80, blank=True)
    valid_until = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    error = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.aspsp_name} ({self.status})"

    @property
    def is_usable(self) -> bool:
        return self.status == self.Status.ACTIVE and (
            self.valid_until is None or self.valid_until > timezone.now()
        )


class BankAccount(BaseModel):
    """Un conto della sessione, abbinato (o no) a un conto di Soldino."""

    connection = models.ForeignKey(
        BankConnection, on_delete=models.CASCADE, related_name="accounts"
    )
    # ``uid`` vale solo finche' la sessione e' autorizzata; l'hash identifica il
    # conto anche fra una sessione e l'altra (rinnovo del consenso).
    uid = models.CharField(max_length=80)
    identification_hash = models.CharField(max_length=128, blank=True, db_index=True)
    iban = models.CharField(max_length=34, blank=True)
    name = models.CharField(max_length=140, blank=True)
    currency = models.CharField(max_length=3, default="EUR")
    account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bank_links",
    )
    auto_commit = models.BooleanField(default=False)
    sync_from = models.DateField(null=True, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    # Ultima data di contabilizzazione letta: il giro successivo riparte da li'.
    synced_until = models.DateField(null=True, blank=True)
    last_error = models.TextField(blank=True)

    class Meta:
        ordering = ["connection", "name"]

    def __str__(self) -> str:
        return f"{self.name or self.iban} ({self.uid})"

    @property
    def tracker_id(self):
        """Per IsTrackerMember, che cerca il tracker sull'oggetto."""
        return self.connection.tracker_id


class SeenBankTransaction(models.Model):
    """Ogni movimento gia' letto per un conto: non torna, nemmeno se scartato."""

    account = models.ForeignKey(
        "accounts.Account", on_delete=models.CASCADE, related_name="seen_bank_transactions"
    )
    external_id = models.CharField(max_length=128)
    seen_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["account", "external_id"], name="uniq_seen_bank_transaction"
            )
        ]

    def __str__(self) -> str:
        return self.external_id
