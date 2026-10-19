from datetime import date
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.models import Account, PendingItem
from apps.conftest import AccountFactory, CategoryFactory, PendingItemFactory
from apps.recurring.models import RecurringRule
from apps.trackers.models import Category, Membership, Tracker
from apps.transactions.models import Transaction

pytestmark = pytest.mark.django_db


def _duplicate(api, user, tracker, **body):
    return api(user).post(
        reverse("tracker-duplicate", args=[tracker.pk]),
        {"name": "Spese 2027", **body},
        format="json",
    )


def test_duplica_struttura_senza_movimenti(api, user, tracker, partner, make_expense):
    tracker.kind = Tracker.Kind.GROUP
    tracker.simplify_debts = False
    tracker.save()
    food = CategoryFactory(
        tracker=tracker, name="Food", description="Cibo fuori", icon="restaurant"
    )
    CategoryFactory(tracker=tracker, name="Vecchia", archived=True)
    account = AccountFactory(tracker=tracker, owner=partner, current_balance=Decimal("812.40"))
    make_expense(tracker, paid_by=user, category=food, account=account)
    PendingItemFactory(tracker=tracker, owner=user)

    response = _duplicate(api, user, tracker)
    assert response.status_code == 201, response.data
    copy = Tracker.objects.get(pk=response.data["id"])

    assert copy.name == "Spese 2027"
    assert copy.owner == user
    assert copy.kind == Tracker.Kind.GROUP and copy.simplify_debts is False
    assert response.data["my_role"] == "owner"

    roles = dict(copy.memberships.values_list("user_id", "role"))
    assert roles == {user.pk: Membership.Role.OWNER, partner.pk: Membership.Role.EDITOR}
    assert set(copy.memberships.values_list("status", flat=True)) == {"active"}

    copied = copy.categories.get(name="Food")
    assert copied.pk != food.pk
    assert (copied.description, copied.icon) == ("Cibo fuori", "restaurant")
    assert copy.categories.get(name="Vecchia").archived is True

    copied_account = Account.objects.get(tracker=copy)
    assert copied_account.owner == partner
    assert copied_account.current_balance == Decimal("812.40")

    # I movimenti e le voci in attesa restano al tracker di partenza.
    assert not Transaction.objects.filter(tracker=copy).exists()
    assert not PendingItem.objects.filter(tracker=copy).exists()
    assert Transaction.objects.filter(tracker=tracker).count() == 1


def test_duplica_senza_membri_ne_conti(api, user, tracker, partner):
    AccountFactory(tracker=tracker, owner=user)
    response = _duplicate(api, user, tracker, members=False, accounts=False)
    assert response.status_code == 201, response.data
    copy = Tracker.objects.get(pk=response.data["id"])
    assert list(copy.memberships.values_list("user_id", flat=True)) == [user.pk]
    assert not Account.objects.filter(tracker=copy).exists()


def test_ricorrenze_ricollegate_alla_copia(api, user, tracker, partner):
    category = CategoryFactory(tracker=tracker, name="Streaming")
    account = AccountFactory(tracker=tracker, owner=user, name="Hype")
    split = [
        {"user": str(user.pk), "share_pct": "50.00"},
        {"user": str(partner.pk), "share_pct": "50.00"},
    ]
    RecurringRule.objects.create(
        tracker=tracker,
        type="expense",
        title="Netflix",
        amount=Decimal("17.99"),
        category=category,
        account=account,
        paid_by=user,
        frequency="monthly",
        next_run=date(2027, 1, 5),
        split_template=split,
    )
    RecurringRule.objects.create(
        tracker=tracker,
        type="expense",
        title="Spenta",
        amount=Decimal("5.00"),
        paid_by=user,
        frequency="monthly",
        next_run=date(2027, 1, 5),
        active=False,
    )

    # Di default le ricorrenze non si copiano: scriverebbero in due tracker.
    first = Tracker.objects.get(pk=_duplicate(api, user, tracker).data["id"])
    assert not first.recurring_rules.exists()

    response = _duplicate(api, user, tracker, recurring=True)
    copy = Tracker.objects.get(pk=response.data["id"])
    rule = copy.recurring_rules.get()
    assert rule.title == "Netflix"
    assert rule.category == copy.categories.get(name="Streaming")
    assert rule.account == Account.objects.get(tracker=copy, name="Hype")
    assert rule.split_template == split


def test_ricorrenza_divisa_con_chi_non_viene_copiato_resta_fuori(api, user, tracker, partner):
    RecurringRule.objects.create(
        tracker=tracker,
        type="expense",
        title="Affitto",
        amount=Decimal("800.00"),
        paid_by=partner,
        frequency="monthly",
        next_run=date(2027, 1, 1),
    )
    response = _duplicate(api, user, tracker, members=False, recurring=True)
    copy = Tracker.objects.get(pk=response.data["id"])
    assert not copy.recurring_rules.exists()


def test_solo_il_proprietario_duplica(api, tracker, partner, other_user):
    assert _duplicate(api, partner, tracker).status_code == 403
    assert _duplicate(api, other_user, tracker).status_code == 404
    assert Tracker.objects.count() == 1


def test_nome_obbligatorio(api, user, tracker):
    response = api(user).post(reverse("tracker-duplicate", args=[tracker.pk]), {}, format="json")
    assert response.status_code == 400
    assert "name" in response.data
    assert Category.objects.exclude(tracker=tracker).count() == 0
