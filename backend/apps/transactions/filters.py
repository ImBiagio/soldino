from __future__ import annotations

import django_filters as filters
from django.db.models import Q

from .models import Transaction


class TransactionFilter(filters.FilterSet):
    date_from = filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = filters.DateFilter(field_name="date", lookup_expr="lte")
    min_amount = filters.NumberFilter(field_name="amount", lookup_expr="gte")
    max_amount = filters.NumberFilter(field_name="amount", lookup_expr="lte")
    # Chi partecipa alla spesa, non chi l'ha pagata: e' la domanda che ci si fa davvero.
    split_user = filters.UUIDFilter(field_name="splits__user_id", distinct=True)
    q = filters.CharFilter(method="filter_search")
    uncategorized = filters.BooleanFilter(method="filter_uncategorized")

    class Meta:
        model = Transaction
        fields = ["type", "category", "account", "paid_by", "source"]

    def filter_search(self, queryset, name, value):
        return queryset.filter(
            Q(title__icontains=value)
            | Q(note__icontains=value)
            | Q(merchant_normalized__icontains=value)
        )

    def filter_uncategorized(self, queryset, name, value):
        return queryset.filter(category__isnull=bool(value))
