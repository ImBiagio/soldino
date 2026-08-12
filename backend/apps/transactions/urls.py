from django.urls import path

from apps.core.routers import nested

from .views import SettlementViewSet, TransactionBulkView, TransactionViewSet

urlpatterns = [
    path(
        "trackers/<uuid:tracker_pk>/transactions/bulk",
        TransactionBulkView.as_view(),
        name="transaction-bulk",
    ),
    *nested("transactions", TransactionViewSet, "transaction"),
    *nested("settlements", SettlementViewSet, "settlement"),
]
