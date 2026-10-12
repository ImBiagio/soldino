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
    assert data["expected_balance"] == "-100.00"
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
    people = reconciliation.pop("people")
    for row in [reconciliation, *people]:
        for field, value in row.items():
            if field not in ("user", "opening_date"):
                assert isinstance(value, str), field

    summary = client.get(reverse("tracker-summary", args=[tracker.pk])).data
    for field in ("total_expense", "total_income", "net"):
        assert isinstance(summary[field], str), field
    for row in summary["by_category"] + summary["by_user"] + summary["by_month"]:
        assert isinstance(row["total"], str)


def test_tracker_creato_da_api_divide_a_meta_col_primo_invitato(api, user):
    """Il proprietario nasceva a 100 contro il 50 degli invitati: 66,67/33,33."""
    from apps.trackers.models import Membership

    from ...conftest import UserFactory

    created = api(user).post(reverse("tracker-list"), {"name": "Casa"}, format="json").data
    partner = UserFactory()
    Membership.objects.create(
        tracker_id=created["id"], user=partner, status=Membership.Status.ACTIVE
    )
    response = api(user).post(
        reverse("transaction-list", args=[created["id"]]),
        _payload(user, split_mode="default", amount="100.00"),
        format="json",
    )
    assert response.status_code == 201, response.data
    assert [s["share_amount"] for s in response.data["splits"]] == ["50.00", "50.00"]


def test_le_percentuali_salvate_sono_quelle_effettive(api, user, tracker, partner):
    response = api(user).post(
        reverse("transaction-list", args=[tracker.pk]),
        _payload(
            user,
            amount="90.00",
            splits_input=[
                {"user": str(user.pk), "share_pct": "70.00"},
                {"user": str(partner.pk), "share_pct": "70.00"},
            ],
        ),
        format="json",
    )
    assert response.status_code == 201, response.data
    assert [s["share_pct"] for s in response.data["splits"]] == ["50.00", "50.00"]
    assert [s["share_amount"] for s in response.data["splits"]] == ["45.00", "45.00"]


def test_riproporzione_sugli_importi_non_sulle_percentuali_arrotondate(
    api, user, tracker, partner
):
    client = api(user)
    created = client.post(
        reverse("transaction-list", args=[tracker.pk]),
        _payload(
            user,
            amount="1000.00",
            splits_input=[
                {"user": str(user.pk), "share_amount": "333.33"},
                {"user": str(partner.pk), "share_amount": "666.67"},
            ],
        ),
        format="json",
    ).data
    detail = reverse("transaction-detail", args=[tracker.pk, created["id"]])

    renamed = client.patch(detail, {"title": "Solo il titolo"}, format="json").data
    assert [s["share_amount"] for s in renamed["splits"]] == ["333.33", "666.67"]

    doubled = client.patch(detail, {"amount": "2000.00"}, format="json").data
    assert [s["share_amount"] for s in doubled["splits"]] == ["666.66", "1333.34"]


@pytest.mark.parametrize("pct", ["-10.00", "100.01"])
def test_percentuale_fuori_intervallo_rifiutata(api, user, tracker, partner, pct):
    response = api(user).post(
        reverse("transaction-list", args=[tracker.pk]),
        _payload(
            user,
            splits_input=[
                {"user": str(user.pk), "share_pct": pct},
                {"user": str(partner.pk), "share_pct": "50.00"},
            ],
        ),
        format="json",
    )
    assert response.status_code == 400


@pytest.mark.parametrize("pct", ["-10.00", "150.00"])
def test_peso_di_default_fuori_intervallo_rifiutato(api, user, tracker, pct):
    membership = tracker.memberships.get(user=user)
    response = api(user).patch(
        reverse("membership-detail", args=[tracker.pk, membership.pk]),
        {"default_share_pct": pct},
        format="json",
    )
    assert response.status_code == 400


def test_summary_per_persona_conta_la_quota_non_il_totale(
    api, user, tracker, partner, make_expense
):
    from datetime import date

    half = [{"user": user.pk, "share_pct": D(50)}, {"user": partner.pk, "share_pct": D(50)}]
    make_expense(tracker, paid_by=user, amount="100.00", splits=half, tx_date=date(2026, 3, 1))
    make_expense(tracker, paid_by=user, amount="40.00", tx_date=date(2026, 3, 2))
    zero = [{"user": user.pk, "share_pct": D(100)}, {"user": partner.pk, "share_pct": D(0)}]
    make_expense(tracker, paid_by=user, amount="10.00", splits=zero, tx_date=date(2026, 3, 3))

    url = reverse("tracker-summary", args=[tracker.pk])
    mine = api(user).get(url, {"user_id": str(user.pk)}).data
    theirs = api(user).get(url, {"user_id": str(partner.pk)}).data
    assert mine["total_expense"] == "100.00"
    assert mine["transaction_count"] == 3
    assert theirs["total_expense"] == "50.00"
    assert theirs["transaction_count"] == 1
    assert theirs["by_month"] == [{"month": 3, "year": 2026, "type": "expense", "total": "50.00"}]
    # by_user resta su tutto il tracker, anche filtrando per persona.
    assert {r["total"] for r in theirs["by_user"]} == {"100.00", "50.00"}


def test_summary_per_intervallo_e_categoria(api, user, tracker, make_expense):
    from datetime import date

    from ...conftest import CategoryFactory

    food = CategoryFactory(tracker=tracker, name="Spesa")
    make_expense(tracker, paid_by=user, amount="30.00", tx_date=date(2026, 1, 15), category=food)
    make_expense(tracker, paid_by=user, amount="20.00", tx_date=date(2026, 4, 1))
    url = reverse("tracker-summary", args=[tracker.pk])

    quarter = api(user).get(url, {"date_from": "2026-01-01", "date_to": "2026-03-31"}).data
    assert quarter["total_expense"] == "30.00"
    assert quarter["by_category"][0]["category_name"] == "Spesa"

    assert api(user).get(url, {"category": str(food.pk)}).data["total_expense"] == "30.00"
    assert api(user).get(url, {"category": "none"}).data["total_expense"] == "20.00"


@pytest.mark.parametrize(
    "params",
    [{"month": 13}, {"date_from": "ieri"}, {"category": "x"},
     {"date_from": "2026-05-01", "date_to": "2026-04-01"}],
)
def test_summary_filtri_malformati_sono_400(api, user, tracker, params):
    response = api(user).get(reverse("tracker-summary", args=[tracker.pk]), params)
    assert response.status_code == 400
