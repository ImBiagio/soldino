from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone

from apps.banking.models import BankAccount, BankConnection, BankingApp, SeenBankTransaction
from apps.banking.services import sync as sync_service
from apps.banking.services.crypto import decrypt, encrypt
from apps.banking.services.enablebanking import BankingError, EnableBankingClient
from apps.banking.services.sync import callback_url, parse_transaction, pick_balance
from apps.conftest import AccountFactory, UserFactory
from apps.ingestion.models import StatementImport
from apps.transactions.models import Transaction

pytestmark = pytest.mark.django_db
D = Decimal
APP_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


@pytest.fixture(scope="module")
def pem() -> bytes:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    )


class FakeClient:
    """Enable Banking finto: registra le chiamate e risponde con dati fissi."""

    def __init__(self, app_id=APP_ID, private_key=b"", **kwargs):
        self.app_id = app_id
        self.redirect_urls = [callback_url()]
        self.balances_data = [
            {"balance_type": "ITAV", "balance_amount": {"amount": "999.00", "currency": "EUR"}},
            {"balance_type": "CLBD", "balance_amount": {"amount": "1234.56", "currency": "EUR"}},
        ]
        self.transactions_data: list[dict] = []
        self.calls: list[tuple] = []

    def application(self):
        return {"name": "Soldino", "environment": "PRODUCTION", "active": True,
                "redirect_urls": self.redirect_urls}

    def start_auth(self, **kwargs):
        self.calls.append(("auth", kwargs))
        return {"url": "https://banca.example/autorizza", "authorization_id": "x"}

    def create_session(self, code):
        self.calls.append(("session", code))
        return {
            "session_id": "sess-1",
            "access": {"valid_until": (timezone.now() + timedelta(days=180)).isoformat()},
            "accounts": [
                {"uid": "uid-1", "identification_hash": "hash-1", "name": "Conto BBVA",
                 "currency": "EUR", "account_id": {"iban": "IT60X0542811101000000123456"}},
            ],
        }

    def delete_session(self, session_id):
        self.calls.append(("delete", session_id))

    def balances(self, uid):
        return self.balances_data

    def transactions(self, uid, *, date_from):
        self.calls.append(("transactions", date_from))
        return self.transactions_data


def tx(ref, amount, indicator="DBIT", day="2026-10-10", status="BOOK", **extra):
    return {
        "entry_reference": ref,
        "transaction_amount": {"amount": amount, "currency": "EUR"},
        "credit_debit_indicator": indicator,
        "status": status,
        "booking_date": day,
        **extra,
    }


@pytest.fixture
def fake():
    client = FakeClient()
    with mock.patch.object(sync_service, "client_for", return_value=client):
        yield client


@pytest.fixture
def app(user, pem):
    return BankingApp.objects.create(user=user, app_id=APP_ID, private_key=encrypt(pem))


@pytest.fixture
def linked(user, tracker, app):
    """Un conto in banca gia' collegato e abbinato a un conto di Soldino."""
    account = AccountFactory(tracker=tracker, owner=user, name="BBVA")
    connection = BankConnection.objects.create(
        user=user, tracker=tracker, aspsp_name="BBVA", aspsp_country="IT", state="s",
        session_id="sess-1", status=BankConnection.Status.ACTIVE,
        valid_until=timezone.now() + timedelta(days=100),
    )
    return BankAccount.objects.create(
        connection=connection, uid="uid-1", identification_hash="hash-1", account=account,
        sync_from=date(2026, 10, 1),
    )


# ------------------------------------------------------------------- chiave --


def test_la_chiave_si_cifra_e_si_decifra(pem):
    token = encrypt(pem)
    assert pem not in token
    assert decrypt(token) == pem


def test_il_jwt_e_firmato_con_kid_e_audience(pem):
    client = EnableBankingClient(APP_ID, pem)
    token = client._token()
    assert jwt.get_unverified_header(token)["kid"] == APP_ID
    public = serialization.load_pem_private_key(pem, None).public_key()
    claims = jwt.decode(token, public, algorithms=["RS256"], audience="api.enablebanking.com")
    assert claims["iss"] == "enablebanking.com"
    assert claims["exp"] - claims["iat"] == 3600


def test_carica_app_verifica_e_non_restituisce_la_chiave(api, user, pem):
    with mock.patch.object(sync_service, "EnableBankingClient", FakeClient):
        response = api(user).put(
            reverse("banking-app"),
            {"app_id": APP_ID, "key": SimpleUploadedFile(f"{APP_ID}.pem", pem)},
            format="multipart",
        )
    assert response.status_code == 200, response.data
    assert response.data["configured"] is True
    assert response.data["app"]["name"] == "Soldino"
    assert "private_key" not in response.data["app"]
    saved = BankingApp.objects.get(user=user)
    assert decrypt(saved.private_key).startswith(b"-----BEGIN PRIVATE KEY-----")


def test_carica_app_rifiuta_file_che_non_e_una_chiave(api, user):
    response = api(user).put(
        reverse("banking-app"),
        {"app_id": APP_ID, "key": SimpleUploadedFile("x.pem", b"non sono una chiave")},
        format="multipart",
    )
    assert response.status_code == 400
    assert "PEM" in response.data["detail"]


def test_carica_app_pretende_l_url_di_ritorno(user, pem):
    class NoRedirect(FakeClient):
        def application(self):
            return {**super().application(), "redirect_urls": ["https://altro.example"]}

    with pytest.raises(BankingError, match="banca/callback"):
        sync_service.save_app(user, app_id=APP_ID, pem=pem, client_class=NoRedirect)
    assert not BankingApp.objects.exists()


def test_stato_senza_app(api, user):
    response = api(user).get(reverse("banking-app"))
    assert response.data == {"configured": False, "callback_url": callback_url(), "app": None}


# -------------------------------------------------------------- collegamento --


def test_collegamento_completo(api, user, tracker, app, fake):
    start = api(user).post(
        reverse("bankconnection-list", args=[tracker.pk]),
        {"aspsp_name": "BBVA", "country": "IT", "max_validity": 90 * 86400},
        format="json",
    )
    assert start.status_code == 201, start.data
    assert start.data["url"] == "https://banca.example/autorizza"
    auth = fake.calls[0][1]
    assert auth["redirect_url"] == callback_url()
    connection = BankConnection.objects.get(pk=start.data["id"])
    assert connection.status == BankConnection.Status.PENDING

    done = api(user).post(
        reverse("banking-complete"), {"code": "abc", "state": connection.state}, format="json"
    )
    assert done.status_code == 200, done.data
    assert done.data["status"] == "active"
    assert done.data["accounts"][0]["name"] == "Conto BBVA"
    assert done.data["accounts"][0]["iban"].startswith("IT60")

    # Ricaricare la pagina di ritorno non rifa' la sessione.
    again = api(user).post(
        reverse("banking-complete"), {"code": "abc", "state": connection.state}, format="json"
    )
    assert again.status_code == 200
    assert [c for c in fake.calls if c[0] == "session"] == [("session", "abc")]


def test_state_di_un_altro_utente_non_vale(api, user, other_user, tracker, app, fake):
    connection = BankConnection.objects.create(
        user=user, tracker=tracker, aspsp_name="BBVA", aspsp_country="IT", state="segreto"
    )
    response = api(other_user).post(
        reverse("banking-complete"), {"code": "abc", "state": connection.state}, format="json"
    )
    assert response.status_code == 400


def test_rinnovo_conserva_abbinamento(user, tracker, linked, fake):
    linked.auto_commit = True
    linked.save()
    new = BankConnection.objects.create(
        user=user, tracker=tracker, aspsp_name="BBVA", aspsp_country="IT", state="nuovo"
    )
    sync_service.complete_connection(user, code="c", state="nuovo")
    renewed = new.accounts.get()
    assert renewed.account_id == linked.account_id
    assert renewed.auto_commit is True
    linked.refresh_from_db()
    assert linked.account is None
    assert linked.connection.status == BankConnection.Status.REPLACED


def test_abbinare_solo_conti_propri(api, user, tracker, partner, linked):
    altrui = AccountFactory(tracker=tracker, owner=partner)
    response = api(user).patch(
        reverse("bankaccount-detail", args=[tracker.pk, linked.pk]),
        {"account": str(altrui.pk)},
        format="json",
    )
    assert response.status_code == 400
    assert "intestato a te" in str(response.data)


def test_collegamenti_altrui_invisibili(api, tracker, partner, linked):
    response = api(partner).get(reverse("bankconnection-list", args=[tracker.pk]))
    assert response.status_code == 200
    assert response.data == []
    detail = api(partner).get(reverse("bankaccount-detail", args=[tracker.pk, linked.pk]))
    assert detail.status_code == 404


# ---------------------------------------------------------- sincronizzazione --


def test_parse_transaction():
    row = parse_transaction(
        tx("r1", "12.50", creditor={"name": "  ESSELUNGA   MILANO "},
           remittance_information=["PAGAMENTO POS"])
    )
    assert row["type"] == "expense"
    assert row["amount"] == D("12.50")
    assert row["title"] == "ESSELUNGA MILANO"
    assert row["date"] == date(2026, 10, 10)
    income = parse_transaction(tx("r2", "1500.00", "CRDT", debtor={"name": "ACME SPA"}))
    assert (income["type"], income["title"]) == ("income", "ACME SPA")
    assert parse_transaction(tx("r3", "5.00", status="PDNG")) is None


def test_external_id_senza_riferimento_e_stabile():
    a = tx(None, "3.00", remittance_information=["CAFFE"])
    assert parse_transaction(a)["external_id"] == parse_transaction(dict(a))["external_id"]
    assert parse_transaction(a)["external_id"].startswith("h:")


def test_saldo_contabile_prima_del_disponibile():
    assert pick_balance(FakeClient().balances_data) == D("1234.56")
    assert pick_balance([]) is None


def test_sync_aggiorna_saldo_e_crea_bozza(api, user, tracker, linked, fake):
    fake.transactions_data = [
        tx("r1", "12.50", creditor={"name": "ESSELUNGA"}),
        tx("r2", "1500.00", "CRDT", day="2026-10-05", debtor={"name": "ACME"}),
        tx("vecchio", "9.00", day="2026-09-20"),  # prima di sync_from
        tx("pending", "4.00", status="PDNG"),
    ]
    response = api(user).post(reverse("bankaccount-sync", args=[tracker.pk, linked.pk]))
    assert response.status_code == 200, response.data
    assert response.data["drafted"] == 2

    account = linked.account
    account.refresh_from_db()
    assert account.current_balance == D("1234.56")
    assert account.balance_updated_at is not None

    draft = StatementImport.objects.get(source="bank")
    assert draft.status == StatementImport.Status.READY
    assert draft.default_payer == user
    assert {line.title for line in draft.lines.all()} == {"ESSELUNGA", "ACME"}
    assert not Transaction.objects.exists()
    linked.refresh_from_db()
    assert linked.synced_until == date(2026, 10, 10)
    assert fake.calls[-1] == ("transactions", "2026-10-01")


def test_sync_successivo_allunga_la_stessa_bozza_senza_ripetere(user, tracker, linked, fake):
    fake.transactions_data = [tx("r1", "12.50")]
    sync_service.sync_account(linked)
    draft = StatementImport.objects.get(source="bank")
    # L'utente scarta la riga: al giro dopo non deve tornare.
    draft.lines.all().hard_delete()

    fake.transactions_data = [tx("r1", "12.50"), tx("r2", "7.00", day="2026-10-12")]
    result = sync_service.sync_account(linked)
    assert result["drafted"] == 1
    assert StatementImport.objects.filter(source="bank").count() == 1
    assert [line.title for line in draft.lines.all()] == ["Movimento"]
    # Riparte qualche giorno prima dell'ultima data letta.
    assert fake.calls[-1] == ("transactions", "2026-10-05")
    assert SeenBankTransaction.objects.count() == 2


def test_commit_della_bozza_registra_con_origine_banca(api, user, tracker, linked, fake):
    fake.transactions_data = [tx("r1", "12.50", creditor={"name": "ESSELUNGA"})]
    sync_service.sync_account(linked)
    draft = StatementImport.objects.get(source="bank")
    response = api(user).post(reverse("statement-commit", args=[tracker.pk, draft.pk]))
    assert response.status_code == 201, response.data
    created = Transaction.objects.get()
    assert created.source == Transaction.Source.BANK
    assert created.account == linked.account


def test_registrazione_automatica_lascia_in_bozza_i_doppioni(
    user, tracker, linked, fake, make_expense
):
    make_expense(tracker, paid_by=user, amount="7.00", tx_date=date(2026, 10, 12))
    linked.auto_commit = True
    linked.save()
    fake.transactions_data = [
        tx("r1", "12.50", creditor={"name": "ESSELUNGA"}),
        tx("r2", "7.00", day="2026-10-12"),
    ]
    result = sync_service.sync_account(linked)
    assert (result["committed"], result["drafted"]) == (1, 1)
    bank_tx = Transaction.objects.get(source=Transaction.Source.BANK)
    assert bank_tx.title == "ESSELUNGA"
    assert bank_tx.created_by == user
    draft = StatementImport.objects.get(source="bank", status=StatementImport.Status.READY)
    assert draft.lines.get().duplicate_of is not None


def test_consenso_scaduto_ferma_la_sync(user, linked, fake):
    connection = linked.connection
    connection.valid_until = timezone.now() - timedelta(days=1)
    connection.save()
    assert sync_service.sync_account(linked) == {"skipped": "consenso scaduto"}
    connection.refresh_from_db()
    assert connection.status == BankConnection.Status.EXPIRED
    assert fake.calls == []


def test_sessione_persa_segna_scaduto(api, user, tracker, linked, fake):
    def lost(uid):
        raise BankingError("persa", status=403, session_lost=True)

    fake.balances = lost
    response = api(user).post(reverse("bankaccount-sync", args=[tracker.pk, linked.pk]))
    assert response.status_code == 502
    linked.refresh_from_db()
    assert linked.last_error == "persa"
    assert linked.connection.status == BankConnection.Status.EXPIRED


def test_task_programmato_salta_conti_non_abbinati(user, tracker, linked, fake):
    from apps.banking.tasks import sync_all_bank_accounts

    BankAccount.objects.create(connection=linked.connection, uid="uid-2")
    assert sync_all_bank_accounts() == {"queued": 1}


def test_scollegare_revoca_la_sessione(api, user, tracker, linked, fake):
    response = api(user).delete(
        reverse("bankconnection-detail", args=[tracker.pk, linked.connection.pk])
    )
    assert response.status_code == 204
    assert ("delete", "sess-1") in fake.calls
    linked.refresh_from_db()
    assert linked.account is None


def test_togliere_l_app_cancella_davvero_la_chiave(api, user, linked, fake):
    response = api(user).delete(reverse("banking-app"))
    assert response.status_code == 204
    assert not BankingApp.all_objects.filter(user=user).exists()


def test_utente_qualunque_non_usa_l_app_altrui(api, app, fake):
    response = api(UserFactory()).get(reverse("banking-aspsps"))
    assert response.status_code == 400


def test_errore_application_inesistente_spiegato():
    import httpx

    from apps.banking.services.enablebanking import _explain

    response = httpx.Response(403, json={"message": "Application does not exist"})
    assert "application ID" in str(_explain(response))


def test_upload_non_crea_bozze_della_banca(api, user, tracker):
    response = api(user).post(
        reverse("statement-list", args=[tracker.pk]),
        {"file": SimpleUploadedFile("e.pdf", b"%PDF-1.4 x"), "source": "bank"},
        format="multipart",
    )
    assert response.status_code == 400
    assert "source" in response.data


def test_collegamento_con_identificativi_lunghi(user, tracker, app, fake):
    """PayPal restituisce un identification_hash ben oltre i 128 caratteri."""
    long_hash = "h" * 600
    base = fake.create_session

    def session(code):
        data = base(code)
        data["accounts"][0].update(identification_hash=long_hash, uid="u" * 200)
        return data

    fake.create_session = session
    BankConnection.objects.create(
        user=user, tracker=tracker, aspsp_name="PayPal", aspsp_country="IT", state="lungo"
    )
    connection = sync_service.complete_connection(user, code="c", state="lungo")
    assert connection.accounts.get().identification_hash == long_hash


@pytest.mark.parametrize(
    ("frequency", "last", "today", "due"),
    [
        ("monthly", date(2026, 10, 15), date(2026, 10, 31), False),
        ("monthly", date(2026, 10, 15), date(2026, 11, 1), True),
        ("weekly", date(2026, 10, 12), date(2026, 10, 18), False),  # lun -> dom
        ("weekly", date(2026, 10, 12), date(2026, 10, 19), True),
        ("daily", date(2026, 10, 15), date(2026, 10, 15), False),
        ("daily", date(2026, 10, 15), date(2026, 10, 16), True),
    ],
)
def test_frequenza_della_sincronizzazione(linked, frequency, last, today, due):
    from datetime import datetime

    from apps.banking.services.sync import is_due

    tracker = linked.account.tracker
    tracker.bank_sync_frequency = frequency
    tracker.save()
    linked.last_synced_at = timezone.make_aware(datetime(last.year, last.month, last.day, 12))
    linked.save()
    linked.refresh_from_db()
    assert is_due(linked, today) is due


def test_default_mensile_e_modificabile_dal_setup(api, user, tracker):
    assert tracker.bank_sync_frequency == "monthly"
    response = api(user).patch(
        reverse("tracker-detail", args=[tracker.pk]), {"bank_sync_frequency": "weekly"},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["bank_sync_frequency"] == "weekly"


def test_scartare_la_bozza_rimette_in_coda_i_movimenti(api, user, tracker, linked, fake):
    # Come PayPal: movimenti del 1° del mese e di meta' mese.
    fake.transactions_data = [
        tx("r1", "12.50", day="2026-10-01"),
        tx("r2", "7.00", day="2026-10-14"),
    ]
    sync_service.sync_account(linked)
    draft = StatementImport.objects.get(source="bank")
    response = api(user).delete(reverse("statement-detail", args=[tracker.pk, draft.pk]))
    assert response.status_code == 204
    assert not SeenBankTransaction.objects.exists()
    linked.refresh_from_db()
    assert linked.synced_until is None

    result = sync_service.sync_account(linked)
    # Riparte da sync_from (1/10), non da 5 giorni prima dell'ultima data letta.
    assert fake.calls[-1] == ("transactions", "2026-10-01")
    assert (result["drafted"], result["already_seen"]) == (2, 0)


def test_riga_tolta_in_revisione_resta_ignorata(api, user, tracker, linked, fake):
    fake.transactions_data = [tx("r1", "12.50"), tx("r2", "7.00", day="2026-10-12")]
    sync_service.sync_account(linked)
    draft = StatementImport.objects.get(source="bank")
    draft.lines.filter(external_id="r1").hard_delete()
    result = sync_service.sync_account(linked)
    assert (result["drafted"], result["already_seen"]) == (0, 2)


def test_saldo_nella_valuta_del_conto():
    balances = [
        {"balance_type": "XPCD", "balance_amount": {"amount": "5.00", "currency": "USD"}},
        {"balance_type": "XPCD", "balance_amount": {"amount": "12.00", "currency": "EUR"}},
    ]
    assert pick_balance(balances, ("XXX", "EUR")) == D("12.00")
    # Senza preferenze vince il primo del tipo, non l'ultimo.
    assert pick_balance(balances) == D("5.00")


def test_cambiare_la_data_di_partenza_rilegge_da_li(api, user, tracker, linked, fake):
    fake.transactions_data = [tx("r1", "12.50", day="2026-10-10")]
    sync_service.sync_account(linked)
    linked.refresh_from_db()
    assert linked.synced_until == date(2026, 10, 10)

    response = api(user).patch(
        reverse("bankaccount-detail", args=[tracker.pk, linked.pk]),
        {"sync_from": "2026-09-01"},
        format="json",
    )
    assert response.status_code == 200, response.data
    linked.refresh_from_db()
    assert linked.synced_until is None

    fake.transactions_data = [tx("vecchio", "5.00", day="2026-09-15"), tx("r1", "12.50")]
    result = sync_service.sync_account(linked)
    assert fake.calls[-1] == ("transactions", "2026-09-01")
    assert (result["drafted"], result["already_seen"]) == (1, 1)
