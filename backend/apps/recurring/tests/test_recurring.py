from datetime import date
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.recurring.models import RecurringRule
from apps.recurring.tasks import materialize_due_rules
from apps.transactions.models import Transaction

D = Decimal
pytestmark = pytest.mark.django_db


def _rule(tracker, user, **overrides):
    fields = {
        "tracker": tracker,
        "type": "expense",
        "title": "Netflix",
        "amount": D("17.99"),
        "paid_by": user,
        "frequency": RecurringRule.Frequency.MONTHLY,
        "next_run": date(2026, 9, 1),
    }
    fields.update(overrides)
    return RecurringRule.objects.create(**fields)


def test_il_task_non_brucia_le_proposte(tracker, user):
    """Senza auto_commit la regola resta ferma finche' qualcuno la approva."""
    rule = _rule(tracker, user)
    result = materialize_due_rules(today=date(2026, 10, 12))
    rule.refresh_from_db()
    assert rule.next_run == date(2026, 9, 1)
    assert result == {"created": 0, "failed": 0}
    assert not Transaction.objects.exists()


def test_il_task_recupera_tutte_le_occorrenze_auto(tracker, user, partner):
    split = [
        {"user": str(user.pk), "share_pct": "50"},
        {"user": str(partner.pk), "share_pct": "50"},
    ]
    rule = _rule(tracker, user, auto_commit=True, split_template=split)
    result = materialize_due_rules(today=date(2026, 10, 12))
    rule.refresh_from_db()
    assert result["created"] == 2
    assert rule.next_run == date(2026, 11, 1)
    tx = Transaction.objects.order_by("date").first()
    assert tx.source == Transaction.Source.RECURRING
    assert sorted(s.share_amount for s in tx.splits.all()) == [D("8.99"), D("9.00")]


def test_una_regola_rotta_non_ferma_le_altre(tracker, user):
    _rule(tracker, user, auto_commit=True, split_template=[{"user": "nessuno"}])
    good = _rule(tracker, user, auto_commit=True, title="Spotify")
    result = materialize_due_rules(today=date(2026, 9, 15))
    good.refresh_from_db()
    assert result == {"created": 1, "failed": 1}
    assert good.next_run == date(2026, 10, 1)


def test_approva_scrive_e_avanza(api, tracker, user):
    rule = _rule(tracker, user)
    url = reverse("recurringrule-approve", args=[tracker.pk, rule.pk])
    response = api(user).post(url, {"occurrence": "2026-09-01"}, format="json")
    assert response.status_code == 201, response.data
    assert response.data["date"] == "2026-09-01"
    assert response.data["source"] == "recurring"
    rule.refresh_from_db()
    assert rule.next_run == date(2026, 10, 1)

    again = api(user).post(url, {"occurrence": "2026-09-01"}, format="json")
    assert again.status_code == 409
    assert Transaction.objects.count() == 1


def test_salta_avanza_senza_scrivere(api, tracker, user):
    rule = _rule(tracker, user)
    response = api(user).post(
        reverse("recurringrule-skip", args=[tracker.pk, rule.pk]),
        {"occurrence": "2026-09-01"},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["next_run"] == "2026-10-01"
    assert not Transaction.objects.exists()


def test_approva_una_rrule_personalizzata(api, tracker, user):
    rule = _rule(
        tracker,
        user,
        frequency=RecurringRule.Frequency.CUSTOM,
        rrule="FREQ=MONTHLY;INTERVAL=2",
    )
    response = api(user).post(
        reverse("recurringrule-approve", args=[tracker.pk, rule.pk]),
        {"occurrence": "2026-09-01"},
        format="json",
    )
    assert response.status_code == 201, response.data
    rule.refresh_from_db()
    assert rule.next_run == date(2026, 11, 1)


def test_occorrenza_futura_non_approvabile(api, tracker, user):
    rule = _rule(tracker, user, next_run=date(2099, 1, 1))
    response = api(user).post(
        reverse("recurringrule-approve", args=[tracker.pk, rule.pk]),
        {"occurrence": "2099-01-01"},
        format="json",
    )
    assert response.status_code == 409


def _payload(user, **overrides):
    payload = {
        "type": "expense",
        "title": "Netflix",
        "amount": "17.99",
        "paid_by": str(user.pk),
        "frequency": "monthly",
        "next_run": "2026-09-01",
    }
    payload.update(overrides)
    return payload


@pytest.mark.parametrize(
    "template",
    [
        [{"user": "non-un-uuid", "share_pct": "50"}],
        [{"share_pct": "50"}],
        "testo",
    ],
)
def test_split_template_invalido_rifiutato(api, tracker, user, template):
    response = api(user).post(
        reverse("recurringrule-list", args=[tracker.pk]),
        _payload(user, split_template=template),
        format="json",
    )
    assert response.status_code == 400


def test_split_template_verso_estranei_rifiutato(api, tracker, user, other_user):
    response = api(user).post(
        reverse("recurringrule-list", args=[tracker.pk]),
        _payload(user, split_template=[{"user": str(other_user.pk), "share_pct": "100"}]),
        format="json",
    )
    assert response.status_code == 400


def test_split_template_salvato_normalizzato(api, tracker, user, partner):
    response = api(user).post(
        reverse("recurringrule-list", args=[tracker.pk]),
        _payload(
            user,
            split_template=[
                {"user": str(user.pk), "share_pct": "70"},
                {"user": str(partner.pk), "share_pct": "70"},
            ],
        ),
        format="json",
    )
    assert response.status_code == 201, response.data
    assert [i["share_pct"] for i in response.data["split_template"]] == ["50.00", "50.00"]
    assert response.data["is_due"] is True
