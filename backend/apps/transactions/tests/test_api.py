from decimal import Decimal

import pytest
from django.urls import reverse

from apps.transactions.models import Transaction

D = Decimal
pytestmark = pytest.mark.django_db


def _payload(user, **overrides):
    payload = {
        "type": "expense",
        "date": "2026-03-01",
        "title": "Esselunga Milano",
        "amount": "50.00",
        "paid_by": str(user.pk),
    }
    payload.update(overrides)
    return payload


def test_creazione_senza_split_e_personale(api, user, tracker):
    response = api(user).post(
        reverse("transaction-list", args=[tracker.pk]), _payload(user), format="json"
    )
    assert response.status_code == 201, response.data
    assert len(response.data["splits"]) == 1
    assert response.data["splits"][0]["share_amount"] == "50.00"
    assert response.data["merchant_normalized"] == "esselunga milano"


def test_split_di_default_dal_tracker(api, user, tracker, partner):
    response = api(user).post(
        reverse("transaction-list", args=[tracker.pk]),
        _payload(user, split_mode="default", amount="100.01"),
        format="json",
    )
    assert response.status_code == 201, response.data
    amounts = sorted(D(s["share_amount"]) for s in response.data["splits"])
    assert amounts == [D("50.00"), D("50.01")]


def test_importi_esatti_che_non_quadrano_sono_rifiutati(api, user, tracker, partner):
    response = api(user).post(
        reverse("transaction-list", args=[tracker.pk]),
        _payload(
            user,
            amount="100.00",
            splits_input=[
                {"user": str(user.pk), "share_amount": "60.00"},
                {"user": str(partner.pk), "share_amount": "30.00"},
            ],
        ),
        format="json",
    )
    assert response.status_code == 400
    assert "splits" in str(response.data)


def test_importi_esatti_che_quadrano_passano(api, user, tracker, partner):
    response = api(user).post(
        reverse("transaction-list", args=[tracker.pk]),
        _payload(
            user,
            amount="100.00",
            splits_input=[
                {"user": str(user.pk), "share_amount": "70.00"},
                {"user": str(partner.pk), "share_amount": "30.00"},
            ],
        ),
        format="json",
    )
    assert response.status_code == 201, response.data
    pcts = {str(s["user"]): s["share_pct"] for s in response.data["splits"]}
    assert pcts[str(user.pk)] == "70.00"


def test_modifica_importo_riproporziona_gli_split(api, user, tracker, partner):
    client = api(user)
    created = client.post(
        reverse("transaction-list", args=[tracker.pk]),
        _payload(user, amount="100.00", split_mode="default"),
        format="json",
    ).data
    response = client.patch(
        reverse("transaction-detail", args=[tracker.pk, created["id"]]),
        {"amount": "80.00"},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert sum(D(s["share_amount"]) for s in response.data["splits"]) == D("80.00")


def test_importo_negativo_rifiutato(api, user, tracker):
    response = api(user).post(
        reverse("transaction-list", args=[tracker.pk]),
        _payload(user, amount="-5.00"),
        format="json",
    )
    assert response.status_code == 400


def test_duplicato_segnalato_non_bloccato(api, user, tracker):
    client = api(user)
    payload = _payload(user, title="ELEONORA FREGNI", amount="71.40")
    first = client.post(reverse("transaction-list", args=[tracker.pk]), payload, format="json")
    second = client.post(reverse("transaction-list", args=[tracker.pk]), payload, format="json")
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.data["id"] in second.data["possible_duplicates"]


def test_filtri(api, user, tracker, partner, make_expense):
    from datetime import date

    make_expense(tracker, paid_by=user, amount="10.00", tx_date=date(2026, 1, 5), title="Benzina")
    make_expense(tracker, paid_by=partner, amount="90.00", tx_date=date(2026, 6, 5), title="Aereo")
    client = api(user)
    url = reverse("transaction-list", args=[tracker.pk])

    assert client.get(url, {"date_from": "2026-06-01"}).data["count"] == 1
    assert client.get(url, {"min_amount": "50"}).data["count"] == 1
    assert client.get(url, {"q": "benz"}).data["count"] == 1
    assert client.get(url, {"paid_by": str(partner.pk)}).data["count"] == 1
    assert client.get(url, {"split_user": str(partner.pk)}).data["count"] == 1


def test_bulk(api, user, tracker):
    response = api(user).post(
        reverse("transaction-bulk", args=[tracker.pk]),
        {"transactions": [_payload(user), _payload(user, title="Altro", amount="12.34")]},
        format="json",
    )
    assert response.status_code == 201, response.data
    assert Transaction.objects.filter(tracker=tracker).count() == 2


def test_soft_delete(api, user, tracker, make_expense):
    tx = make_expense(tracker, paid_by=user)
    response = api(user).delete(reverse("transaction-detail", args=[tracker.pk, tx.pk]))
    assert response.status_code == 204
    assert not Transaction.objects.filter(pk=tx.pk).exists()
    assert Transaction.all_objects.filter(pk=tx.pk).exists()


def test_saldi_endpoint(api, user, tracker, partner, make_expense):
    make_expense(
        tracker,
        paid_by=user,
        amount="100.00",
        splits=[
            {"user": user.pk, "share_pct": D(50)},
            {"user": partner.pk, "share_pct": D(50)},
        ],
    )
    data = api(user).get(reverse("tracker-balances", args=[tracker.pk])).data
    assert sum(D(b["net"]) for b in data["balances"]) == D("0.00")
    assert data["suggested_transfers"][0]["amount"] == "50.00"


def test_riconciliazione(api, user, tracker, make_expense):
    from apps.conftest import AccountFactory, PendingItemFactory

    AccountFactory(tracker=tracker, owner=user, current_balance=D("1000.00"))
    PendingItemFactory(tracker=tracker, owner=user, amount=D("-700.00"))
    make_expense(tracker, paid_by=user, amount="100.00")

    data = api(user).get(reverse("tracker-reconciliation", args=[tracker.pk])).data
    assert data["accounts_balance"] == "1000.00"
    assert data["pending_total"] == "-700.00"
    assert data["available_balance"] == "300.00"
    assert data["transactions_balance"] == "-100.00"
    assert data["delta"] == "400.00"


def test_summary(api, user, tracker, make_expense):
    from datetime import date

    make_expense(tracker, paid_by=user, amount="30.00", tx_date=date(2026, 3, 1))
    make_expense(tracker, paid_by=user, amount="20.00", tx_date=date(2026, 4, 1))
    data = api(user).get(
        reverse("tracker-summary", args=[tracker.pk]), {"year": 2026, "month": 3}
    ).data
    assert data["total_expense"] == "30.00"
    assert data["transaction_count"] == 1


def test_gli_importi_escono_come_stringhe_mai_come_numeri_json(
    api, user, tracker, partner, make_expense
):
    """Un numero JSON e' un float: gli importi devono restare stringhe decimali."""
    make_expense(
        tracker,
        paid_by=user,
        amount="100.01",
        splits=[
            {"user": user.pk, "share_pct": D(50)},
            {"user": partner.pk, "share_pct": D(50)},
        ],
    )
    client = api(user)

    balances = client.get(reverse("tracker-balances", args=[tracker.pk])).data
    for row in balances["balances"]:
        for field in ("paid", "owed", "settlements_sent", "settlements_received", "net"):
            assert isinstance(row[field], str), field
    for transfer in balances["suggested_transfers"]:
        assert isinstance(transfer["amount"], str)

    reconciliation = client.get(reverse("tracker-reconciliation", args=[tracker.pk])).data
    for field, value in reconciliation.items():
        assert isinstance(value, str), field

    summary = client.get(reverse("tracker-summary", args=[tracker.pk])).data
    for field in ("total_expense", "total_income", "net"):
        assert isinstance(summary[field], str), field
    for row in summary["by_category"] + summary["by_user"] + summary["by_month"]:
        assert isinstance(row["total"], str)
