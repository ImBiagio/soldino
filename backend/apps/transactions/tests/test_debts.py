from datetime import date
from decimal import Decimal

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from apps.trackers.models import Membership
from apps.transactions.models import Settlement
from apps.transactions.services.debts import compute_balances, minimize_transfers

D = Decimal
pytestmark = pytest.mark.django_db


def _member_ids(tracker):
    return list(
        tracker.memberships.filter(status=Membership.Status.ACTIVE).values_list(
            "user_id", flat=True
        )
    )


def test_spesa_personale_non_genera_debito(tracker, user, partner, make_expense):
    make_expense(tracker, paid_by=user, amount="80.00")
    balances = compute_balances(tracker.pk, _member_ids(tracker))
    assert all(b.net == D("0.00") for b in balances)
    assert minimize_transfers(balances) == []


def test_spesa_di_coppia_meta_a_testa(tracker, user, partner, make_expense):
    make_expense(
        tracker,
        paid_by=user,
        amount="100.00",
        splits=[{"user": user.pk, "share_pct": D(50)}, {"user": partner.pk, "share_pct": D(50)}],
    )
    balances = {b.user_id: b for b in compute_balances(tracker.pk, _member_ids(tracker))}
    assert balances[str(user.pk)].net == D("50.00")
    assert balances[str(partner.pk)].net == D("-50.00")

    transfers = minimize_transfers(balances.values())
    assert len(transfers) == 1
    assert transfers[0].from_user_id == str(partner.pk)
    assert transfers[0].to_user_id == str(user.pk)
    assert transfers[0].amount == D("50.00")


def test_settlement_azzera_il_debito(tracker, user, partner, make_expense):
    make_expense(
        tracker,
        paid_by=user,
        amount="100.00",
        splits=[{"user": user.pk, "share_pct": D(50)}, {"user": partner.pk, "share_pct": D(50)}],
    )
    Settlement.objects.create(
        tracker=tracker,
        from_user=partner,
        to_user=user,
        amount=D("50.00"),
        date=date(2026, 3, 20),
    )
    balances = compute_balances(tracker.pk, _member_ids(tracker))
    assert all(b.net == D("0.00") for b in balances)
    assert minimize_transfers(balances) == []


def test_le_entrate_non_toccano_il_debito(tracker, user, partner, make_expense):
    from apps.transactions.models import Transaction
    from apps.transactions.services.splits import sync_splits

    tx = Transaction.objects.create(
        tracker=tracker,
        type=Transaction.Type.INCOME,
        date=date(2026, 4, 1),
        title="Gestore dei Servizi Energetici",
        amount=D("287.50"),
        paid_by=user,
        created_by=user,
    )
    sync_splits(
        tx, [{"user": user.pk, "share_pct": D(50)}, {"user": partner.pk, "share_pct": D(50)}]
    )
    balances = compute_balances(tracker.pk, _member_ids(tracker))
    assert all(b.net == D("0.00") for b in balances)


def test_somma_dei_net_e_zero_su_scenario_misto(tracker, user, partner, make_expense):
    make_expense(
        tracker,
        paid_by=user,
        amount="33.33",
        splits=[{"user": user.pk, "share_pct": D(50)}, {"user": partner.pk, "share_pct": D(50)}],
    )
    make_expense(
        tracker,
        paid_by=partner,
        amount="0.01",
        splits=[{"user": user.pk, "share_pct": D(50)}, {"user": partner.pk, "share_pct": D(50)}],
    )
    make_expense(tracker, paid_by=partner, amount="12.00")
    balances = compute_balances(tracker.pk, _member_ids(tracker))
    assert sum(b.net for b in balances) == D("0.00")


def test_minimizzazione_con_tre_membri():
    from apps.transactions.services.debts import UserBalance

    balances = [
        UserBalance("a", D(0), D(0), D(0), D(0), D("60.00")),
        UserBalance("b", D(0), D(0), D(0), D(0), D("-25.00")),
        UserBalance("c", D(0), D(0), D(0), D(0), D("-35.00")),
    ]
    transfers = minimize_transfers(balances)
    assert len(transfers) == 2
    assert sum(t.amount for t in transfers) == D("60.00")
    assert all(t.to_user_id == "a" for t in transfers)


@settings(
    max_examples=50,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    amounts=st.lists(
        st.decimals(min_value=D("0.01"), max_value=D("5000"), places=2), min_size=1, max_size=6
    ),
    payer_is_owner=st.lists(st.booleans(), min_size=1, max_size=6),
)
def test_property_somma_net_sempre_zero(
    tracker, user, partner, make_expense, amounts, payer_is_owner
):
    from apps.transactions.models import Transaction

    Transaction.all_objects.filter(tracker=tracker).hard_delete()
    for amount, owner_pays in zip(amounts, payer_is_owner + [True] * len(amounts), strict=False):
        make_expense(
            tracker,
            paid_by=user if owner_pays else partner,
            amount=str(amount),
            splits=[
                {"user": user.pk, "share_pct": D(50)},
                {"user": partner.pk, "share_pct": D(50)},
            ],
        )
    balances = compute_balances(tracker.pk, _member_ids(tracker))
    assert sum(b.net for b in balances) == D("0.00")
