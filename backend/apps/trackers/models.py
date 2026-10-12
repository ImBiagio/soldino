from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from simple_history.models import HistoricalRecords

from apps.core.models import BaseModel


class Tracker(BaseModel):
    """Un contenitore di spese condiviso ("Spese coppia 2026")."""

    name = models.CharField(max_length=120)
    currency = models.CharField(max_length=3, default="EUR")
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="owned_trackers"
    )
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name

    @property
    def is_archived(self) -> bool:
        return self.archived_at is not None

    def active_members(self):
        return self.memberships.filter(status=Membership.Status.ACTIVE)


class Membership(BaseModel):
    class Role(models.TextChoices):
        OWNER = "owner", "Proprietario"
        EDITOR = "editor", "Editor"
        VIEWER = "viewer", "Sola lettura"

    class Status(models.TextChoices):
        PENDING = "pending", "Invito inviato"
        ACTIVE = "active", "Attivo"
        REVOKED = "revoked", "Revocato"

    tracker = models.ForeignKey(Tracker, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="memberships",
    )
    invited_email = models.EmailField(blank=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.EDITOR)
    default_share_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("50.00"),
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("100"))],
        help_text="Peso proposto di default negli split di gruppo, fra 0 e 100.",
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    # Il punto di partenza della riconciliazione di questa persona: quanto aveva
    # sui conti alla data ``opening_date``. Contano solo i movimenti da li' in poi.
    opening_balance = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Saldo iniziale: soldi sui conti alla data di partenza.",
    )
    opening_date = models.DateField(
        null=True,
        blank=True,
        help_text="Da quando si contano i movimenti. Vuoto = da sempre.",
    )

    history = HistoricalRecords(inherit=False)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["tracker", "user"],
                condition=models.Q(deleted_at__isnull=True, user__isnull=False),
                name="uniq_membership_tracker_user",
            ),
            models.UniqueConstraint(
                fields=["tracker", "invited_email"],
                condition=models.Q(deleted_at__isnull=True) & ~models.Q(invited_email=""),
                name="uniq_membership_tracker_email",
            ),
            models.CheckConstraint(
                condition=models.Q(user__isnull=False) | ~models.Q(invited_email=""),
                name="membership_has_user_or_email",
            ),
        ]

    def __str__(self) -> str:
        who = self.user.email if self.user_id else self.invited_email
        return f"{who} @ {self.tracker_id}"

    @property
    def display_name(self) -> str:
        if self.user_id:
            return self.user.display_name or self.user.email
        return self.invited_email


class Category(BaseModel):
    class Type(models.TextChoices):
        EXPENSE = "expense", "Spesa"
        INCOME = "income", "Entrata"

    tracker = models.ForeignKey(Tracker, on_delete=models.CASCADE, related_name="categories")
    name = models.CharField(max_length=80)
    description = models.TextField(
        blank=True,
        help_text="Descrizione operativa: e' cio' che viene passato all'LLM in fase 3.",
    )
    type = models.CharField(max_length=10, choices=Type.choices, default=Type.EXPENSE)
    # Default della palette M3: verde (primary) per le entrate, rosso (error)
    # per le uscite, gli stessi colori di importi e grafici.
    DEFAULT_COLORS = {"expense": "#ba1a1a", "income": "#1b6c2f"}
    color = models.CharField(max_length=9, default="#1b6c2f")
    icon = models.CharField(max_length=40, blank=True)
    archived = models.BooleanField(default=False)

    class Meta:
        ordering = ["type", "name"]
        verbose_name_plural = "categories"
        constraints = [
            models.UniqueConstraint(
                fields=["tracker", "name", "type"],
                condition=models.Q(deleted_at__isnull=True),
                name="uniq_category_tracker_name_type",
            )
        ]

    def __str__(self) -> str:
        return self.name
