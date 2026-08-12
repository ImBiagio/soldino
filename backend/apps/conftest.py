from __future__ import annotations

from datetime import date
from decimal import Decimal

import factory
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.accounts.models import Account, PendingItem
from apps.trackers.models import Category, Membership, Tracker
from apps.transactions.models import Transaction
from apps.transactions.services.splits import sync_splits

User = get_user_model()


class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = User

    email = factory.Sequence(lambda n: f"utente{n}@soldino.test")
    display_name = factory.Sequence(lambda n: f"Utente {n}")
    is_active = True

    @factory.post_generation
    def password(obj, create, extracted, **kwargs):
        obj.set_password(extracted or "password-di-prova")
        if create:
            obj.save()


class TrackerFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Tracker

    name = factory.Sequence(lambda n: f"Tracker {n}")
    owner = factory.SubFactory(UserFactory)

    @factory.post_generation
    def owner_membership(obj, create, extracted, **kwargs):
        if create:
            Membership.objects.create(
                tracker=obj,
                user=obj.owner,
                role=Membership.Role.OWNER,
                status=Membership.Status.ACTIVE,
                default_share_pct=Decimal("50.00"),
            )


class CategoryFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Category

    tracker = factory.SubFactory(TrackerFactory)
    name = factory.Sequence(lambda n: f"Categoria {n}")
    type = Category.Type.EXPENSE


class AccountFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Account

    tracker = factory.SubFactory(TrackerFactory)
    name = factory.Sequence(lambda n: f"Conto {n}")
    owner = factory.SubFactory(UserFactory)
    current_balance = Decimal("0.00")


class PendingItemFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = PendingItem

    tracker = factory.SubFactory(TrackerFactory)
    title = factory.Sequence(lambda n: f"Attesa {n}")
    amount = Decimal("100.00")
    owner = factory.SubFactory(UserFactory)


@pytest.fixture
def user(db):
    return UserFactory()


@pytest.fixture
def other_user(db):
    return UserFactory()


@pytest.fixture
def tracker(db, user):
    return TrackerFactory(owner=user)


@pytest.fixture
def partner(db, tracker):
    """Secondo membro attivo del tracker, al 50%."""
    member = UserFactory()
    Membership.objects.create(
        tracker=tracker,
        user=member,
        role=Membership.Role.EDITOR,
        status=Membership.Status.ACTIVE,
        default_share_pct=Decimal("50.00"),
    )
    Membership.objects.filter(tracker=tracker, user=tracker.owner).update(
        default_share_pct=Decimal("50.00")
    )
    return member


@pytest.fixture
def api(db):
    def _client(as_user=None):
        client = APIClient()
        if as_user is not None:
            client.force_authenticate(user=as_user)
        return client

    return _client


@pytest.fixture
def make_expense(db):
    def _make(tracker, *, paid_by, amount="100.00", splits=None, tx_date=None, **kwargs):
        tx = Transaction.objects.create(
            tracker=tracker,
            type=Transaction.Type.EXPENSE,
            date=tx_date or date(2026, 3, 15),
            title=kwargs.pop("title", "Spesa di prova"),
            amount=Decimal(amount),
            paid_by=paid_by,
            created_by=paid_by,
            **kwargs,
        )
        sync_splits(tx, splits or [{"user": paid_by.pk, "share_pct": Decimal("100.00")}])
        return tx

    return _make
