from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError

from apps.trackers.models import Membership
from apps.transactions.services.splits import (
    default_split_input,
    personal_split_input,
    resolve_split_amounts,
    validate_split_users,
)

D = Decimal
pytestmark = pytest.mark.django_db


def test_percentuali_diventano_importi_a_somma_esatta():
    resolved = resolve_split_amounts(
        D("100.01"), [{"user": "a", "share_pct": D(50)}, {"user": "b", "share_pct": D(50)}]
    )
    assert sum(r["share_amount"] for r in resolved) == D("100.01")


def test_importi_esatti_producono_percentuali_informative():
    resolved = resolve_split_amounts(
        D("100.00"),
        [{"user": "a", "share_amount": D("25.00")}, {"user": "b", "share_amount": D("75.00")}],
    )
    assert [r["share_pct"] for r in resolved] == [D("25.00"), D("75.00")]


def test_forme_miste_rifiutate():
    with pytest.raises(ValidationError):
        resolve_split_amounts(
            D("10.00"),
            [{"user": "a", "share_amount": D("5.00")}, {"user": "b", "share_pct": D(50)}],
        )


def test_lista_vuota_rifiutata():
    with pytest.raises(ValidationError):
        resolve_split_amounts(D("10.00"), [])


def test_utente_duplicato_rifiutato():
    with pytest.raises(ValidationError):
        resolve_split_amounts(
            D("10.00"), [{"user": "a", "share_pct": D(50)}, {"user": "a", "share_pct": D(50)}]
        )


@pytest.mark.parametrize(
    "items",
    [
        [{"user": "a", "share_amount": D("-1.00")}, {"user": "b", "share_amount": D("11.00")}],
        [{"user": "a", "share_pct": D(-10)}, {"user": "b", "share_pct": D(110)}],
        [{"user": "a", "share_pct": D(0)}, {"user": "b", "share_pct": D(0)}],
    ],
)
def test_valori_invalidi_rifiutati(items):
    with pytest.raises(ValidationError):
        resolve_split_amounts(D("10.00"), items)


def test_quota_zero_ammessa():
    resolved = resolve_split_amounts(
        D("10.00"),
        [{"user": "a", "share_amount": D("10.00")}, {"user": "b", "share_amount": D("0.00")}],
    )
    assert resolved[1]["share_amount"] == D("0.00")


def test_default_usa_le_percentuali_del_tracker(tracker, user, partner):
    Membership.objects.filter(tracker=tracker, user=user).update(default_share_pct=D("70.00"))
    Membership.objects.filter(tracker=tracker, user=partner).update(default_share_pct=D("30.00"))
    items = default_split_input(tracker, user.pk)
    resolved = resolve_split_amounts(D("100.00"), items)
    by_user = {str(r["user"]): r["share_amount"] for r in resolved}
    assert by_user[str(user.pk)] == D("70.00")
    assert by_user[str(partner.pk)] == D("30.00")


def test_default_con_percentuali_tutte_a_zero_ripartisce_in_parti_uguali(
    tracker, user, partner
):
    Membership.objects.filter(tracker=tracker).update(default_share_pct=D("0.00"))
    resolved = resolve_split_amounts(D("100.00"), default_split_input(tracker, user.pk))
    assert sorted(r["share_amount"] for r in resolved) == [D("50.00"), D("50.00")]


def test_personale_e_cento_percento(user):
    assert personal_split_input(user.pk) == [{"user": user.pk, "share_pct": D("100.00")}]


def test_validate_split_users_blocca_gli_estranei(tracker, user, other_user):
    validate_split_users(tracker, [{"user": user.pk}])
    with pytest.raises(ValidationError):
        validate_split_users(tracker, [{"user": other_user.pk}])
