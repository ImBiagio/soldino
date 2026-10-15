from django.urls import path

from apps.core.routers import nested

from .views import (
    AspspListView,
    BankAccountViewSet,
    BankConnectionViewSet,
    BankingAppView,
    CompleteConnectionView,
)

urlpatterns = [
    path("banking/app", BankingAppView.as_view(), name="banking-app"),
    path("banking/aspsps", AspspListView.as_view(), name="banking-aspsps"),
    path("banking/complete", CompleteConnectionView.as_view(), name="banking-complete"),
    *nested(
        "bank-connections",
        BankConnectionViewSet,
        "bankconnection",
        list_map={"get": "list", "post": "create"},
        detail_map={"get": "retrieve", "delete": "destroy"},
    ),
    path(
        "trackers/<uuid:tracker_pk>/bank-accounts/<uuid:pk>",
        BankAccountViewSet.as_view({"get": "retrieve", "patch": "partial_update"}),
        name="bankaccount-detail",
    ),
    path(
        "trackers/<uuid:tracker_pk>/bank-accounts/<uuid:pk>/sync",
        BankAccountViewSet.as_view({"post": "sync"}),
        name="bankaccount-sync",
    ),
]
