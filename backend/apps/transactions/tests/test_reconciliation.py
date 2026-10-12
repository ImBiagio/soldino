"""Riconciliazione per cassa (ADR 0007).

atteso = saldo iniziale + entrate incassate - spese pagate +/- pareggi
reale  = conti + BTA; delta = reale - atteso
"""

from datetime import date
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.conftest import AccountFactory, PendingItemFactory
from apps.trackers.models import Membership
from apps.transactions.models import Settlement, Transaction

D = Decimal
pytestmark = pytest.mark.django_db


def _set_opening(tracker, user, amount, since=None):
    Membership.objects.filter(tracker=tracker, user=user).update(
        opening_balance=D(amount), opening_date=since
    )


def _get(api, user, tracker):
    data = api(user).get(reverse("tracker-reconciliation", args=[tracker.pk])).data
    people = {p["user"]["id"]: p for p in data["people"]}
    return data, people


def test_spesa_condivisa_pesa_tutta_su_chi_paga(api, user, tracker, partner, make_expense):
    """Cena da 100 a meta': dal conto di chi paga escono 100, non 50."""
    _set_opening(tracker, user, "1000.00")
    _set_opening(tracker, partner, "500.00")
    half = [{"user": user.pk, "share_pct": D(50)}, {"user": partner.pk, "share_pct": D(50)}]
    make_expense(tracker, paid_by=user, amount="100.00", splits=half)
    AccountFactory(tracker=tracker, owner=user, current_balance=D("900.00"))
    AccountFactory(tracker=tracker, owner=partner, current_balance=D("500.00"))

    total, people = _get(api, user, tracker)
    mine, theirs = people[str(user.pk)], people[str(partner.pk)]
    assert mine["expected_balance"] == "900.00"
    assert mine["delta"] == "0.00"
    assert theirs["expense"] == "0.00"
    assert theirs["delta"] == "0.00"
    assert total["opening_balance"] == "1500.00"
    assert total["expected_balance"] == "1400.00"
    assert total["delta"] == "0.00"


def test_il_pareggio_sposta_soldi_veri_fra_le_persone(api, user, tracker, partner):
    _set_opening(tracker, user, "100.00")
    _set_opening(tracker, partner, "100.00")
    Settlement.objects.create(
        tracker=tracker, from_user=partner, to_user=user, amount=D("50.00"), date=date(2026, 3, 1)
    )
    AccountFactory(tracker=tracker, owner=user, current_balance=D("150.00"))
    AccountFactory(tracker=tracker, owner=partner, current_balance=D("50.00"))

    total, people = _get(api, user, tracker)
    assert people[str(user.pk)]["settlements_net"] == "50.00"
    assert people[str(partner.pk)]["settlements_net"] == "-50.00"
    assert {p["delta"] for p in people.values()} == {"0.00"}
    # Fra membri i pareggi si annullano.
    assert total["settlements_net"] == "0.00"


def test_bta_negativo_sono_soldi_ancora_da_dare(api, user, tracker, make_expense):
    """Ho 1000 sul conto ma 300 sono gia' promessi: disponibili davvero 700."""
    _set_opening(tracker, user, "700.00")
    AccountFactory(tracker=tracker, owner=user, current_balance=D("1000.00"))
    PendingItemFactory(tracker=tracker, owner=user, amount=D("-300.00"))

    _, people = _get(api, user, tracker)
    assert people[str(user.pk)]["available_balance"] == "700.00"
    assert people[str(user.pk)]["delta"] == "0.00"


def test_la_data_di_partenza_esclude_i_movimenti_precedenti(api, user, tracker, make_expense):
    _set_opening(tracker, user, "1000.00", since=date(2026, 3, 10))
    make_expense(tracker, paid_by=user, amount="400.00", tx_date=date(2026, 3, 1))
    make_expense(tracker, paid_by=user, amount="100.00", tx_date=date(2026, 3, 15))

    _, people = _get(api, user, tracker)
    assert people[str(user.pk)]["expense"] == "100.00"
    assert people[str(user.pk)]["expected_balance"] == "900.00"


def test_entrate_incassate_contano_per_chi_incassa(api, user, tracker, partner):
    from apps.transactions.services.splits import sync_splits

    tx = Transaction.objects.create(
        tracker=tracker, type="income", date=date(2026, 3, 1), title="Stipendio",
        amount=D("2000.00"), paid_by=partner, created_by=partner,
    )
    sync_splits(tx, [{"user": partner.pk, "share_pct": D(100)}])

    _, people = _get(api, user, tracker)
    assert people[str(partner.pk)]["income"] == "2000.00"
    assert people[str(user.pk)]["income"] == "0.00"


def test_ognuno_modifica_il_proprio_saldo_iniziale(api, user, tracker, partner):
    mine = Membership.objects.get(tracker=tracker, user=partner)
    owner_membership = Membership.objects.get(tracker=tracker, user=user)
    client = api(partner)

    ok = client.patch(
        reverse("membership-detail", args=[tracker.pk, mine.pk]),
        {"opening_balance": "1234.56", "opening_date": "2026-01-01"},
        format="json",
    )
    assert ok.status_code == 200, ok.data
    assert ok.data["opening_balance"] == "1234.56"

    # Non il saldo degli altri, ne' i propri pesi di split.
    other = client.patch(
        reverse("membership-detail", args=[tracker.pk, owner_membership.pk]),
        {"opening_balance": "1.00"},
        format="json",
    )
    weight = client.patch(
        reverse("membership-detail", args=[tracker.pk, mine.pk]),
        {"default_share_pct": "90.00"},
        format="json",
    )
    assert other.status_code == 403
    assert weight.status_code == 403


def test_conto_intestato_a_un_estraneo_rifiutato(api, user, tracker, other_user):
    response = api(user).post(
        reverse("account-list", args=[tracker.pk]),
        {"name": "Conto altrui", "owner": str(other_user.pk), "current_balance": "10.00"},
        format="json",
    )
    assert response.status_code == 400


def test_curva_del_saldo_per_cassa(api, user, tracker, partner, make_expense):
    _set_opening(tracker, user, "1000.00")
    _set_opening(tracker, partner, "200.00")
    half = [{"user": user.pk, "share_pct": D(50)}, {"user": partner.pk, "share_pct": D(50)}]
    make_expense(tracker, paid_by=user, amount="100.00", splits=half, tx_date=date(2026, 3, 1))
    make_expense(tracker, paid_by=user, amount="40.00", tx_date=date(2026, 3, 3))
    Settlement.objects.create(
        tracker=tracker, from_user=partner, to_user=user, amount=D("50.00"), date=date(2026, 3, 3)
    )
    url = reverse("tracker-balance-history", args=[tracker.pk])

    mine = api(user).get(
        url, {"date_from": "2026-03-02", "date_to": "2026-03-04", "user_id": str(user.pk)}
    ).data
    # La spesa del 1/3 e' prima dell'intervallo: entra nel punto di partenza.
    assert [p["balance"] for p in mine["points"]] == ["900.00", "910.00", "910.00"]
    assert mine["points"][1]["expense"] == "40.00"

    everyone = api(user).get(url, {"date_from": "2026-03-01", "date_to": "2026-03-03"}).data
    # Il pareggio sposta soldi fra loro: sul totale non si vede.
    assert [p["balance"] for p in everyone["points"]] == ["1100.00", "1100.00", "1060.00"]
    assert everyone["end_balance"] == "1060.00"


def test_curva_del_saldo_intervallo_non_valido(api, user, tracker):
    url = reverse("tracker-balance-history", args=[tracker.pk])
    backwards = {"date_from": "2026-03-02", "date_to": "2026-03-01"}
    too_long = {"date_from": "2020-01-01", "date_to": "2026-03-01"}
    assert api(user).get(url, backwards).status_code == 400
    assert api(user).get(url, too_long).status_code == 400
