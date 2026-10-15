"""Dalla lettura del PDF alle righe in bozza, e dalle righe ai movimenti."""

from __future__ import annotations

import logging
from collections import Counter
from datetime import date
from decimal import Decimal, InvalidOperation

from django.db import transaction as db_transaction
from django.utils import timezone

from apps.core.money import quantize
from apps.core.normalize import normalize_merchant
from apps.trackers.models import Category
from apps.transactions.models import Transaction
from apps.transactions.serializers import TransactionSerializer

from ..models import StatementImport, StatementLine
from .gemini import ExtractedStatement, ExtractionError, extract_statement

logger = logging.getLogger(__name__)


def category_catalog(tracker) -> list[dict]:
    """Quello che il modello vede delle categorie: la descrizione e' il criterio."""
    return [
        {"id": str(c.pk), "name": c.name, "type": c.type, "description": c.description}
        for c in Category.objects.filter(tracker=tracker, archived=False)
    ]


def history_categories(tracker) -> dict[tuple[str, str], str]:
    """(esercente normalizzato, tipo) -> categoria usata piu' spesso finora.

    Lo storico vince sul modello: e' una scelta che l'utente ha gia' fatto.
    """
    counts: dict[tuple[str, str], Counter] = {}
    rows = (
        Transaction.objects.filter(tracker=tracker, category__isnull=False)
        .exclude(merchant_normalized="")
        .values_list("merchant_normalized", "type", "category_id")
    )
    for merchant, kind, category_id in rows:
        counts.setdefault((merchant, kind), Counter())[str(category_id)] += 1
    return {key: counter.most_common(1)[0][0] for key, counter in counts.items()}


def _parse_date(raw: str | None) -> date | None:
    try:
        return date.fromisoformat((raw or "").strip()[:10])
    except ValueError:
        return None


def _parse_amount(raw: str) -> Decimal | None:
    try:
        value = quantize(Decimal(str(raw).replace(",", ".").replace(" ", "")))
    except (InvalidOperation, ValueError):
        return None
    value = abs(value)
    return value if value > 0 else None


def find_duplicate(tracker, *, when, amount, kind, merchant):
    """Un movimento gia' registrato con stessa data, importo e tipo.

    Non si usa solo l'impronta (che include il titolo): il titolo di una riga
    letta dal PDF raramente e' identico a quello scritto a mano o letto in un
    altro giro. A parita' di candidati vince quello con lo stesso esercente.
    Resta un avviso: due caffe' da 1,20 lo stesso giorno sono legittimi.
    """
    candidates = list(
        Transaction.objects.filter(tracker=tracker, date=when, amount=amount, type=kind)
        .values_list("pk", "merchant_normalized")[:10]
    )
    for pk, existing in candidates:
        if existing == merchant:
            return pk
    return candidates[0][0] if candidates else None


def draft_line(
    statement: StatementImport,
    *,
    position: int,
    when: date,
    title: str,
    amount: Decimal,
    kind: str,
    history: dict[tuple[str, str], str],
    suggested: str | None = None,
    valid: dict[str, str] | None = None,
    external_id: str = "",
) -> StatementLine:
    """Una riga in bozza: categoria dallo storico, poi quella suggerita, e doppioni.

    Serve allo scan e alla sincronizzazione con la banca (ADR 0013).
    """
    tracker = statement.tracker
    merchant = normalize_merchant(title)

    category_id, source = history.get((merchant, kind)), StatementLine.CategorySource.HISTORY
    if not category_id and suggested and (valid or {}).get(suggested) == kind:
        category_id, source = suggested, StatementLine.CategorySource.AI
    if not category_id:
        source = StatementLine.CategorySource.NONE

    return StatementLine(
        statement=statement,
        position=position,
        date=when,
        title=title,
        amount=amount,
        type=kind,
        category_id=category_id,
        category_source=source,
        paid_by_id=statement.default_payer_id,
        duplicate_of_id=find_duplicate(
            tracker, when=when, amount=amount, kind=kind, merchant=merchant
        ),
        external_id=external_id,
    )


def build_lines(statement: StatementImport, extracted: ExtractedStatement) -> int:
    """Trasforma la lettura in righe in bozza. Le righe illeggibili si scartano."""
    tracker = statement.tracker
    valid = {
        str(c.pk): c.type for c in Category.objects.filter(tracker=tracker, archived=False)
    }
    history = history_categories(tracker)

    lines = []
    for position, item in enumerate(extracted.lines):
        when = _parse_date(item.date)
        amount = _parse_amount(item.amount)
        title = (item.description or "").strip()[:255]
        if not when or not amount or not title:
            continue
        lines.append(
            draft_line(
                statement,
                position=position,
                when=when,
                title=title,
                amount=amount,
                kind="income" if item.direction == "in" else "expense",
                history=history,
                suggested=item.category_id,
                valid=valid,
            )
        )

    StatementLine.objects.bulk_create(lines)
    statement.period_start = _parse_date(extracted.period_start)
    statement.period_end = _parse_date(extracted.period_end)
    return len(lines)


def run_scan(statement: StatementImport, extractor=extract_statement) -> None:
    """Legge il PDF e prepara la bozza. ``extractor`` e' sostituibile nei test."""
    from django.conf import settings

    statement.model_name = settings.GEMINI_MODEL
    try:
        extracted = extractor(bytes(statement.pdf or b""), category_catalog(statement.tracker))
        with db_transaction.atomic():
            statement.lines.all().hard_delete()
            build_lines(statement, extracted)
            statement.status = StatementImport.Status.READY
            statement.error = ""
            # Letto: il PDF non serve piu' e non va tenuto.
            statement.pdf = None
            statement.save()
    except Exception as exc:
        # Mai lasciare l'import fermo su "in lettura": l'utente deve poter riprovare.
        if not isinstance(exc, ExtractionError):
            logger.exception("Scan non riuscito: %s", statement.pk)
        statement.status = StatementImport.Status.FAILED
        statement.error = (
            str(exc) if isinstance(exc, ExtractionError) else "Errore imprevisto nella lettura."
        )
        statement.save(update_fields=["status", "error", "model_name", "updated_at"])


@db_transaction.atomic
def commit_statement(statement: StatementImport, request) -> list[Transaction]:
    """OK dell'utente: ogni riga diventa un movimento, tutte o nessuna.

    ``request`` serve solo per ``request.user`` (chi registra): la registrazione
    automatica della banca passa un oggetto con il solo ``user``.
    """
    context = {"request": request, "tracker": statement.tracker}
    created = []
    for line in statement.lines.select_related("paid_by").order_by("position", "date"):
        serializer = TransactionSerializer(
            data={
                "type": line.type,
                "date": line.date.isoformat(),
                "title": line.title,
                "amount": str(line.amount),
                "category": str(line.category_id) if line.category_id else None,
                "account": str(statement.account_id) if statement.account_id else None,
                "paid_by": str(line.paid_by_id),
                "split_mode": line.split_mode,
                "source": (
                    Transaction.Source.BANK
                    if statement.source == StatementImport.Source.BANK
                    else Transaction.Source.SCAN
                ),
            },
            context=context,
        )
        serializer.is_valid(raise_exception=True)
        tx = serializer.save()
        line.transaction = tx
        line.save(update_fields=["transaction", "updated_at"])
        created.append(tx)

    statement.status = StatementImport.Status.COMMITTED
    statement.committed_at = timezone.now()
    statement.save(update_fields=["status", "committed_at", "updated_at"])
    return created
