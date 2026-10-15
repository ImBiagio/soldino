"""Dalla lettura del file alle righe in bozza, e dalle righe ai movimenti.

Estratto conto (PDF, tante righe) e scontrino (foto, una riga) passano dalla
stessa strada: cambiano solo il lettore e cosa si fa del file dopo.
"""

from __future__ import annotations

import logging
from collections import Counter
from datetime import date
from decimal import Decimal, InvalidOperation
from functools import partial

from django.db import transaction as db_transaction
from django.utils import timezone

from apps.core.money import quantize
from apps.core.normalize import normalize_merchant
from apps.trackers.methods import active_member_ids, active_memberships
from apps.trackers.models import Category
from apps.transactions.models import Transaction
from apps.transactions.serializers import SettlementSerializer, TransactionSerializer

from ..models import StatementImport, StatementLine
from .gemini import (
    ExtractedStatement,
    ExtractionError,
    extract_receipt,
    extract_statement,
    extract_voice,
)

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
    split_mode: str = StatementLine.SplitMode.PERSONAL,
    external_id: str = "",
    paid_by_id=None,
    to_user_id=None,
) -> StatementLine:
    """Una riga in bozza: categoria dallo storico, poi quella suggerita, e doppioni.

    Serve allo scan, allo scontrino, alla voce e alla banca (ADR 0013). Un
    pareggio (soldi dati a un altro membro) non ha categoria ne' doppioni.
    """
    tracker = statement.tracker
    merchant = normalize_merchant(title)
    paid_by_id = paid_by_id or statement.default_payer_id

    if kind == StatementLine.Type.TRANSFER:
        return StatementLine(
            statement=statement,
            position=position,
            date=when,
            title=title,
            amount=amount,
            type=kind,
            paid_by_id=paid_by_id,
            to_user_id=to_user_id,
            external_id=external_id,
        )

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
        paid_by_id=paid_by_id,
        split_mode=split_mode,
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

    # Scontrino senza data leggibile: e' di oggi, quasi sempre lo si fotografa subito.
    fallback_date = timezone.localdate() if statement.is_receipt else None
    # In un tracker per dividere le spese lo scontrino e' di tutti, di default.
    split_mode = (
        StatementLine.SplitMode.DEFAULT
        if statement.is_receipt and tracker.kind == tracker.Kind.GROUP
        else StatementLine.SplitMode.PERSONAL
    )

    members = active_member_ids(tracker)

    lines = []
    for position, item in enumerate(extracted.lines):
        when = _parse_date(item.date) or fallback_date
        amount = _parse_amount(item.amount)
        title = (item.description or "").strip()[:255]
        if not when or not amount or not title:
            continue
        # Solo la voce dice chi paga, a chi e se la spesa e' divisa: si accetta
        # un id solo se e' davvero un membro attivo.
        payer = getattr(item, "payer_id", None)
        payer = payer if payer in members else None
        to_user = getattr(item, "to_id", None)
        to_user = to_user if to_user in members and to_user != (
            payer or str(statement.default_payer_id)
        ) else None
        kind = "income" if item.direction == "in" else "expense"
        if getattr(item, "kind", None) == StatementLine.Type.TRANSFER and to_user:
            kind = StatementLine.Type.TRANSFER
        line_split = split_mode
        if getattr(item, "shared", False):
            line_split = StatementLine.SplitMode.DEFAULT
        lines.append(
            draft_line(
                statement,
                position=position,
                when=when,
                title=title,
                amount=amount,
                kind=kind,
                history=history,
                suggested=item.category_id,
                valid=valid,
                split_mode=line_split,
                paid_by_id=payer,
                to_user_id=to_user,
            )
        )

    StatementLine.objects.bulk_create(lines)
    statement.period_start = _parse_date(extracted.period_start)
    statement.period_end = _parse_date(extracted.period_end)
    return len(lines)


def voice_context(statement: StatementImport) -> dict:
    """Quello che serve a Gemini per capire "ho dato 10 euro a Maurizio"."""
    speaker = statement.uploaded_by
    return {
        "members": [
            {"id": str(m.user_id), "name": m.user.display_name or m.user.email}
            for m in active_memberships(statement.tracker).select_related("user")
        ],
        "speaker": {"id": str(speaker.pk), "name": speaker.display_name or speaker.email},
        "today": timezone.localdate(statement.created_at).isoformat(),
    }


def default_extractor(statement: StatementImport):
    if statement.is_receipt:
        return partial(extract_receipt, mime_type=statement.mime_type)
    if statement.is_voice:
        context = voice_context(statement)
        # La voce non ha file: si legge il testo trascritto.
        return lambda _file, categories: extract_voice(
            statement.transcript, categories, **context
        )
    return extract_statement


def run_scan(statement: StatementImport, extractor=None) -> None:
    """Legge il file e prepara la bozza. ``extractor`` e' sostituibile nei test."""
    from django.conf import settings

    statement.model_name = settings.GEMINI_MODEL
    read = extractor or default_extractor(statement)
    try:
        extracted = read(bytes(statement.pdf or b""), category_catalog(statement.tracker))
        # Quello che ha letto davvero: con il principale giu' e' una riserva.
        statement.model_name = getattr(extracted, "_model", "") or settings.GEMINI_MODEL
        with db_transaction.atomic():
            statement.lines.all().hard_delete()
            build_lines(statement, extracted)
            statement.status = StatementImport.Status.READY
            statement.error = ""
            # Letto: il PDF non serve piu' e non va tenuto. La foto dello
            # scontrino resta per la revisione e si cancella alla registrazione.
            if not statement.is_receipt:
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
    source = {
        StatementImport.Source.RECEIPT: Transaction.Source.RECEIPT,
        StatementImport.Source.BANK: Transaction.Source.BANK,
        StatementImport.Source.VOICE: Transaction.Source.VOICE,
    }.get(statement.source, Transaction.Source.SCAN)
    created = []
    for line in statement.lines.select_related("paid_by").order_by("position", "date"):
        if line.type == StatementLine.Type.TRANSFER:
            # Soldi dati a un altro membro: e' un pareggio, non una spesa.
            settlement = SettlementSerializer(
                data={
                    "from_user": str(line.paid_by_id),
                    "to_user": str(line.to_user_id) if line.to_user_id else None,
                    "amount": str(line.amount),
                    "date": line.date.isoformat(),
                    "note": line.title,
                },
                context=context,
            )
            settlement.is_valid(raise_exception=True)
            line.settlement = settlement.save(
                tracker=statement.tracker, created_by=request.user
            )
            line.save(update_fields=["settlement", "updated_at"])
            continue
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
                "source": source,
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
    statement.pdf = None  # la foto dello scontrino non serve piu'
    statement.save(update_fields=["status", "committed_at", "pdf", "updated_at"])
    return created
