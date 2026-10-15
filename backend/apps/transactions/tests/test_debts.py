from datetime import date
from decimal import Decimal

import pytest
from django.urls import reverse
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from apps.conftest import UserFactory
from apps.trackers.models import Membership
from apps.transactions.models import Settlement
from apps.transactions.services.debts import compute_balances, minimize_transfers, pairwise_debts

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


# --- semplifica debiti (ADR 0009) -------------------------------------------------


@pytest.fixture
def third(tracker, partner):
    member = UserFactory()
    Membership.objects.create(
        tracker=tracker, user=member, role=Membership.Role.EDITOR, status=Membership.Status.ACTIVE
    )
    return member


def _only(user):
    return [{"user": user.pk, "share_pct": D(100)}]


def _as_tuples(transfers):
    return {(t.from_user_id, t.to_user_id, t.amount) for t in transfers}


def test_catena_semplificata_in_un_bonifico(tracker, user, partner, third, make_expense):
    """Anna paga 30 per Bruno, Bruno paga 30 per Carla: basta che Carla dia 30 ad Anna."""
    make_expense(tracker, paid_by=user, amount="30.00", splits=_only(partner))
    make_expense(tracker, paid_by=partner, amount="30.00", splits=_only(third))
    balances = compute_balances(tracker.pk, _member_ids(tracker))

    assert _as_tuples(minimize_transfers(balances)) == {(str(third.pk), str(user.pk), D("30.00"))}
    assert _as_tuples(pairwise_debts(tracker.pk, _member_ids(tracker))) == {
        (str(partner.pk), str(user.pk), D("30.00")),
        (str(third.pk), str(partner.pk), D("30.00")),
    }


def test_per_coppia_compensa_le_spese_incrociate(tracker, user, partner, make_expense):
    make_expense(tracker, paid_by=user, amount="50.00", splits=_only(partner))
    make_expense(tracker, paid_by=partner, amount="20.00", splits=_only(user))
    assert _as_tuples(pairwise_debts(tracker.pk, _member_ids(tracker))) == {
        (str(partner.pk), str(user.pk), D("30.00"))
    }


def test_per_coppia_conta_i_pareggi(tracker, user, partner, third, make_expense):
    make_expense(tracker, paid_by=user, amount="40.00", splits=_only(partner))
    Settlement.objects.create(
        tracker=tracker, from_user=partner, to_user=user, amount=D("25.00"), date=date(2026, 3, 20)
    )
    # Un pareggio "sbagliato" (a chi non si doveva niente) diventa un credito.
    Settlement.objects.create(
        tracker=tracker, from_user=third, to_user=partner, amount=D("5.00"), date=date(2026, 3, 21)
    )
    assert _as_tuples(pairwise_debts(tracker.pk, _member_ids(tracker))) == {
        (str(partner.pk), str(user.pk), D("15.00")),
        (str(partner.pk), str(third.pk), D("5.00")),
    }


@settings(
    max_examples=40,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    expenses=st.lists(
        st.tuples(
            st.decimals(min_value=D("0.01"), max_value=D("2000"), places=2),
            st.integers(min_value=0, max_value=2),
            st.lists(st.integers(min_value=0, max_value=100), min_size=3, max_size=3).filter(
                any
            ),
        ),
        min_size=1,
        max_size=6,
    )
)
def test_property_i_due_modi_portano_allo_stesso_saldo(
    tracker, user, partner, third, make_expense, expenses
):
    """Comunque si paghi, ognuno riceve o da' esattamente il proprio saldo netto."""
    from apps.transactions.models import Transaction

    Transaction.all_objects.filter(tracker=tracker).hard_delete()
    people = [user, partner, third]
    for amount, payer, weights in expenses:
        make_expense(
            tracker,
            paid_by=people[payer],
            amount=str(amount),
            splits=[
                {"user": p.pk, "share_pct": D(w)}
                for p, w in zip(people, weights, strict=True)
            ],
        )
    balances = compute_balances(tracker.pk, _member_ids(tracker))
    pairwise = pairwise_debts(tracker.pk, _member_ids(tracker))
    for transfers in (minimize_transfers(balances), pairwise):
        for b in balances:
            flow = sum(
                (t.amount for t in transfers if t.to_user_id == b.user_id), D("0.00")
            ) - sum((t.amount for t in transfers if t.from_user_id == b.user_id), D("0.00"))
            assert flow == b.net
    assert len(minimize_transfers(balances)) <= len(people) - 1


def test_endpoint_segue_l_impostazione_del_tracker(
    api, tracker, user, partner, third, make_expense
):
    make_expense(tracker, paid_by=user, amount="30.00", splits=_only(partner))
    make_expense(tracker, paid_by=partner, amount="30.00", splits=_only(third))
    url = reverse("tracker-balances", args=[tracker.pk])

    simplified = api(user).get(url).data
    assert simplified["simplified"] is True
    assert len(simplified["suggested_transfers"]) == 1

    response = api(user).patch(
        reverse("tracker-detail", args=[tracker.pk]), {"simplify_debts": False}, format="json"
    )
    assert response.status_code == 200
    pairwise = api(user).get(url).data
    assert pairwise["simplified"] is False
    assert len(pairwise["suggested_transfers"]) == 2
