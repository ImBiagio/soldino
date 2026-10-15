"""Collegamento delle banche e sincronizzazione di saldo e movimenti (ADR 0013)."""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from types import SimpleNamespace

from django.conf import settings
from django.db import transaction as db_transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.core.money import quantize
from apps.ingestion.models import StatementImport, StatementLine
from apps.ingestion.services.scan import commit_statement, draft_line, history_categories
from apps.trackers.models import Tracker

from ..models import BankAccount, BankConnection, BankingApp, SeenBankTransaction
from .crypto import decrypt, encrypt, load_private_key
from .enablebanking import BankingError, EnableBankingClient

logger = logging.getLogger(__name__)

# Il massimo che la PSD2 concede prima di rifare l'autenticazione forte.
MAX_CONSENT = timedelta(days=180)
# Ogni giro rilegge qualche giorno gia' visto: alcune banche contabilizzano in ritardo.
OVERLAP_DAYS = 5
DEFAULT_HISTORY_DAYS = 30
# Prima il saldo contabile, poi il disponibile: e' quello che tornera' coi movimenti.
BALANCE_PREFERENCE = ["CLBD", "ITBD", "XPCD", "ITAV", "CLAV", "OPBD", "OTHR"]


def callback_url() -> str:
    """L'URL di ritorno dalla banca: va aggiunto all'applicazione Enable Banking."""
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}/banca/callback"


def client_for(app: BankingApp) -> EnableBankingClient:
    return EnableBankingClient(str(app.app_id), decrypt(app.private_key))


def require_app(user) -> BankingApp:
    app = BankingApp.objects.filter(user=user).first()
    if app is None:
        raise BankingError("Prima configura la tua applicazione Enable Banking.")
    return app


# --------------------------------------------------------------- applicazione --


def save_app(user, *, app_id: str, pem: bytes, client_class=None) -> BankingApp:
    """Verifica application ID e chiave con ``GET /application``, poi li salva."""
    key = load_private_key(pem)
    info = (client_class or EnableBankingClient)(app_id, key).application()
    redirect_urls = info.get("redirect_urls") or []
    if callback_url() not in redirect_urls:
        raise BankingError(
            f"L'applicazione non ha {callback_url()} tra gli URL di ritorno (Redirect URLs): "
            "aggiungilo nel pannello di Enable Banking e riprova."
        )
    app, _ = BankingApp.all_objects.update_or_create(
        user=user,
        defaults={
            "app_id": app_id,
            "private_key": encrypt(key),
            "name": info.get("name") or "",
            "environment": info.get("environment") or "",
            "active": bool(info.get("active")),
            "redirect_urls": redirect_urls,
            "verified_at": timezone.now(),
            "deleted_at": None,
        },
    )
    return app


# ---------------------------------------------------------------- collegamento --


def start_connection(
    user, tracker, *, aspsp_name: str, country: str, logo: str = "", max_validity: int | None = None
) -> tuple[BankConnection, str]:
    """Apre l'autorizzazione presso la banca; restituisce l'URL dove mandare l'utente."""
    app = require_app(user)
    validity = MAX_CONSENT
    if max_validity:
        validity = min(validity, timedelta(seconds=int(max_validity)))
    # Un minuto di margine: alcune banche rifiutano la scadenza massima esatta.
    valid_until = timezone.now() + validity - timedelta(minutes=1)
    connection = BankConnection.objects.create(
        user=user,
        tracker=tracker,
        aspsp_name=aspsp_name,
        aspsp_country=country,
        aspsp_logo=logo[:500],
        state=secrets.token_urlsafe(32),
    )
    try:
        auth = client_for(app).start_auth(
            aspsp_name=aspsp_name,
            country=country,
            valid_until=valid_until.isoformat(),
            state=connection.state,
            redirect_url=callback_url(),
        )
    except BankingError as exc:
        connection.status = BankConnection.Status.FAILED
        connection.error = str(exc)
        connection.save(update_fields=["status", "error", "updated_at"])
        raise
    return connection, auth["url"]


def _account_name(raw: dict) -> str:
    return (raw.get("name") or raw.get("product") or raw.get("details") or "").strip()[:140]


@db_transaction.atomic
def complete_connection(user, *, code: str, state: str) -> BankConnection:
    """Ritorno dalla banca: scambia il codice con la sessione e ne salva i conti."""
    connection = (
        BankConnection.objects.select_for_update()
        .filter(user=user, state=state)
        .first()
    )
    if connection is None:
        raise BankingError("Collegamento non trovato: riparti dalla sezione Banca.")
    if connection.status != BankConnection.Status.PENDING:
        return connection  # ricarica della pagina di ritorno: gia' fatto

    session = client_for(require_app(user)).create_session(code)
    connection.session_id = session.get("session_id", "")
    valid_until = parse_datetime((session.get("access") or {}).get("valid_until") or "")
    connection.valid_until = valid_until
    connection.status = BankConnection.Status.ACTIVE
    connection.error = ""
    connection.save()

    for raw in session.get("accounts") or []:
        account = BankAccount.objects.create(
            connection=connection,
            uid=raw.get("uid", ""),
            identification_hash=raw.get("identification_hash") or "",
            iban=((raw.get("account_id") or {}).get("iban") or "")[:34],
            name=_account_name(raw),
            currency=(raw.get("currency") or "EUR")[:3],
        )
        _carry_over(account)
    return connection


def _carry_over(account: BankAccount) -> None:
    """Rinnovo del consenso: lo stesso conto riprende abbinamento e impostazioni."""
    if not account.identification_hash:
        return
    previous = (
        BankAccount.objects.filter(
            connection__user=account.connection.user,
            identification_hash=account.identification_hash,
            account__isnull=False,
        )
        .exclude(connection=account.connection)
        .select_related("connection")
        .order_by("-created_at")
        .first()
    )
    if previous is None:
        return
    for field in ("account_id", "auto_commit", "sync_from", "synced_until"):
        setattr(account, field, getattr(previous, field))
    account.save()
    previous.account = None
    previous.save(update_fields=["account", "updated_at"])
    old = previous.connection
    if not old.accounts.filter(account__isnull=False).exists():
        old.status = BankConnection.Status.REPLACED
        old.save(update_fields=["status", "updated_at"])


def disconnect(connection: BankConnection) -> None:
    """Revoca la sessione presso Enable Banking (se si puo') e toglie il collegamento."""
    if connection.session_id and connection.status == BankConnection.Status.ACTIVE:
        try:
            client_for(require_app(connection.user)).delete_session(connection.session_id)
        except BankingError:
            logger.info("Sessione %s gia' chiusa o non revocabile", connection.pk)
    connection.accounts.update(account=None)
    connection.delete()


# ----------------------------------------------------------- sincronizzazione --


def _amount(raw: dict) -> Decimal | None:
    try:
        return quantize(Decimal(str((raw or {}).get("amount"))))
    except (InvalidOperation, ValueError, TypeError):
        return None


def pick_balance(balances: list[dict], currencies: tuple[str, ...] = ()) -> Decimal | None:
    """Il saldo da mostrare: prima nella valuta del conto (o del tracker), poi per tipo.

    PayPal restituisce un saldo per valuta (EUR, USD...) tutti dello stesso tipo.
    """
    same = [
        b for b in balances if (b.get("balance_amount") or {}).get("currency") in currencies
    ]
    balances = same or balances
    by_type: dict = {}
    for b in balances:
        by_type.setdefault(b.get("balance_type"), b)
    for kind in BALANCE_PREFERENCE:
        if kind in by_type:
            return _amount(by_type[kind].get("balance_amount"))
    return _amount(balances[0].get("balance_amount")) if balances else None


def external_id(tx: dict) -> str:
    """L'id del movimento presso la banca, o un'impronta stabile se non c'e'."""
    for key in ("entry_reference", "transaction_id"):
        if tx.get(key):
            return str(tx[key])[:128]
    parts = [
        tx.get("booking_date") or tx.get("value_date") or "",
        str((tx.get("transaction_amount") or {}).get("amount") or ""),
        tx.get("credit_debit_indicator") or "",
        " ".join(tx.get("remittance_information") or []),
        ((tx.get("creditor") or {}).get("name") or ""),
        ((tx.get("debtor") or {}).get("name") or ""),
    ]
    return "h:" + hashlib.sha256("|".join(parts).encode()).hexdigest()[:40]


def parse_transaction(tx: dict) -> dict | None:
    """Da movimento Enable Banking a riga: ``None`` se non e' contabilizzato o leggibile."""
    if tx.get("status") not in (None, "BOOK"):
        return None  # i PDNG cambiano ancora importo e descrizione
    raw_date = tx.get("booking_date") or tx.get("value_date") or tx.get("transaction_date")
    try:
        when = date.fromisoformat(str(raw_date)[:10])
    except ValueError:
        return None
    signed = _amount(tx.get("transaction_amount"))
    if not signed:
        return None
    indicator = tx.get("credit_debit_indicator")
    kind = "income" if indicator == "CRDT" or (indicator is None and signed > 0) else "expense"
    counterparty = (tx.get("creditor") if kind == "expense" else tx.get("debtor")) or {}
    remittance = " ".join(tx.get("remittance_information") or [])
    title = " ".join(
        (counterparty.get("name") or remittance or tx.get("note") or "Movimento").split()
    )[:255]
    return {"date": when, "title": title, "amount": abs(signed), "type": kind,
            "external_id": external_id(tx)}


def _open_draft(bank_account: BankAccount) -> StatementImport:
    """La bozza ancora da rivedere del conto, o una nuova: una sola per conto."""
    account = bank_account.account
    draft = StatementImport.objects.filter(
        source=StatementImport.Source.BANK, account=account, status=StatementImport.Status.READY
    ).first()
    if draft:
        return draft
    return _new_import(bank_account)


def _new_import(bank_account: BankAccount) -> StatementImport:
    account = bank_account.account
    return StatementImport.objects.create(
        tracker=account.tracker,
        source=StatementImport.Source.BANK,
        uploaded_by=bank_account.connection.user,
        filename=f"{bank_account.connection.aspsp_name} · {account.name}"[:255],
        account=account,
        default_payer=account.owner,
        status=StatementImport.Status.READY,
    )


def _append(statement: StatementImport, rows: list[dict], history) -> None:
    start = (statement.lines.order_by("-position").values_list("position", flat=True).first()
             or 0) + 1
    lines = [
        draft_line(
            statement,
            position=start + i,
            when=row["date"],
            title=row["title"],
            amount=row["amount"],
            kind=row["type"],
            history=history,
            external_id=row["external_id"],
        )
        for i, row in enumerate(rows)
    ]
    StatementLine.objects.bulk_create(lines)
    dates = [row["date"] for row in rows]
    statement.period_start = min([*dates, *filter(None, [statement.period_start])])
    statement.period_end = max([*dates, *filter(None, [statement.period_end])])
    statement.save(update_fields=["period_start", "period_end", "updated_at"])


def sync_account(bank_account: BankAccount, *, today: date | None = None) -> dict:
    """Un giro su un conto: saldo, movimenti nuovi, bozza o registrazione automatica."""
    today = today or timezone.localdate()
    connection = bank_account.connection
    account = bank_account.account
    if account is None:
        return {"skipped": "non abbinato"}
    if not connection.is_usable:
        bank_account.last_error = "Il consenso della banca e' scaduto: rinnova il collegamento."
        bank_account.save(update_fields=["last_error", "updated_at"])
        if connection.status == BankConnection.Status.ACTIVE:
            connection.status = BankConnection.Status.EXPIRED
            connection.save(update_fields=["status", "updated_at"])
        return {"skipped": "consenso scaduto"}

    try:
        client = client_for(require_app(connection.user))
        balance = pick_balance(
            client.balances(bank_account.uid),
            (bank_account.currency, account.tracker.currency),
        )
        if bank_account.synced_until:
            date_from = bank_account.synced_until - timedelta(days=OVERLAP_DAYS)
        else:
            date_from = bank_account.sync_from or today - timedelta(days=DEFAULT_HISTORY_DAYS)
        raw = client.transactions(bank_account.uid, date_from=date_from.isoformat())
    except BankingError as exc:
        bank_account.last_error = str(exc)
        bank_account.save(update_fields=["last_error", "updated_at"])
        if exc.session_lost:
            connection.status = BankConnection.Status.EXPIRED
            connection.save(update_fields=["status", "updated_at"])
        raise

    return _store(bank_account, balance=balance, raw=raw, date_from=date_from)


@db_transaction.atomic
def _store(bank_account: BankAccount, *, balance, raw: list[dict], date_from: date) -> dict:
    account = bank_account.account
    now = timezone.now()
    if balance is not None:
        account.current_balance = balance
        account.balance_updated_at = now
        account.save(update_fields=["current_balance", "balance_updated_at", "updated_at"])

    rows = [row for tx in raw if (row := parse_transaction(tx))]
    # Prima di sync_from non si importa nulla, anche se la banca lo restituisce.
    if bank_account.sync_from:
        rows = [row for row in rows if row["date"] >= bank_account.sync_from]
    seen = set(
        SeenBankTransaction.objects.filter(
            account=account, external_id__in=[row["external_id"] for row in rows]
        ).values_list("external_id", flat=True)
    )
    fresh, unique = [], set()
    for row in sorted(rows, key=lambda r: r["date"]):
        if row["external_id"] in seen or row["external_id"] in unique:
            continue
        unique.add(row["external_id"])
        fresh.append(row)
    SeenBankTransaction.objects.bulk_create(
        [SeenBankTransaction(account=account, external_id=row["external_id"]) for row in fresh],
        ignore_conflicts=True,
    )

    committed = drafted = 0
    if fresh:
        history = history_categories(account.tracker)
        if bank_account.auto_commit:
            committed, drafted = _auto_commit(bank_account, fresh, history)
        else:
            _append(_open_draft(bank_account), fresh, history)
            drafted = len(fresh)

    if rows:
        bank_account.synced_until = max(row["date"] for row in rows)
    bank_account.last_synced_at = now
    bank_account.last_error = ""
    bank_account.save(update_fields=["synced_until", "last_synced_at", "last_error", "updated_at"])
    return {
        "balance": balance,
        "committed": committed,
        "drafted": drafted,
        # Letti dalla banca ma gia' visti prima: non tornano in bozza.
        "already_seen": len(rows) - len(fresh),
    }


def _auto_commit(bank_account: BankAccount, rows: list[dict], history) -> tuple[int, int]:
    """Registra subito le righe; i possibili doppioni restano in bozza da rivedere."""
    statement = _new_import(bank_account)
    _append(statement, rows, history)
    doubtful = list(statement.lines.filter(duplicate_of__isnull=False))
    if doubtful:
        draft = _open_draft_excluding(bank_account, statement)
        start = (draft.lines.order_by("-position").values_list("position", flat=True).first()
                 or 0) + 1
        for i, line in enumerate(doubtful):
            line.statement = draft
            line.position = start + i
            line.save(update_fields=["statement", "position", "updated_at"])
        dates = [line.date for line in doubtful]
        draft.period_start = min([*dates, *filter(None, [draft.period_start])])
        draft.period_end = max([*dates, *filter(None, [draft.period_end])])
        draft.save(update_fields=["period_start", "period_end", "updated_at"])
    if statement.lines.exists():
        commit_statement(statement, SimpleNamespace(user=bank_account.connection.user))
    else:
        statement.delete(hard=True)
    return len(rows) - len(doubtful), len(doubtful)


def _open_draft_excluding(bank_account: BankAccount, current: StatementImport) -> StatementImport:
    draft = (
        StatementImport.objects.filter(
            source=StatementImport.Source.BANK,
            account=bank_account.account,
            status=StatementImport.Status.READY,
        )
        .exclude(pk=current.pk)
        .first()
    )
    return draft or _new_import(bank_account)


def syncable_accounts():
    return BankAccount.objects.filter(
        account__isnull=False,
        connection__status=BankConnection.Status.ACTIVE,
        account__tracker__archived_at__isnull=True,
    ).select_related("connection", "account", "account__tracker")


def is_due(bank_account: BankAccount, today: date) -> bool:
    """Tocca alla sincronizzazione programmata, secondo il tracker (default mensile).

    - ogni giorno: se oggi non si e' ancora letto;
    - ogni settimana: se non si e' letto da lunedi';
    - ogni mese: se non si e' letto dal primo del mese: il giro del 1° porta
      tutto il mese appena chiuso, come un estratto conto.
    "Sincronizza ora" conta come lettura: sposta il giro successivo.
    """
    if bank_account.last_synced_at is None:
        return True
    last = timezone.localdate(bank_account.last_synced_at)
    frequency = bank_account.account.tracker.bank_sync_frequency
    if frequency == Tracker.BankSync.DAILY:
        start = today
    elif frequency == Tracker.BankSync.WEEKLY:
        start = today - timedelta(days=today.weekday())
    else:
        start = today.replace(day=1)
    return last < start


def release_draft(statement: StatementImport) -> int:
    """"Scarta" su una bozza della banca: i suoi movimenti tornano al giro dopo.

    Una riga tolta dalla revisione resta ignorata per sempre; scartare tutta la
    bozza vuol dire "non adesso", non "mai". Le righe gia' registrate restano viste.
    """
    if statement.source != StatementImport.Source.BANK or statement.account_id is None:
        return 0
    ids = [
        line.external_id
        for line in statement.lines.all()
        if line.external_id and line.transaction_id is None and line.settlement_id is None
    ]
    deleted, _ = SeenBankTransaction.objects.filter(
        account_id=statement.account_id, external_id__in=ids
    ).delete()
    # I giri successivi ripartono da qualche giorno prima dell'ultima data letta:
    # senza tornare a sync_from, i movimenti piu' vecchi della bozza non
    # verrebbero piu' richiesti alla banca.
    BankAccount.objects.filter(account_id=statement.account_id).update(synced_until=None)
    return deleted
