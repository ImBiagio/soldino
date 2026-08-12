from django.urls import path

from apps.core.routers import nested

from .views import AccountViewSet, PendingItemViewSet

urlpatterns = [
    *nested("accounts", AccountViewSet, "account"),
    *nested("pending-items", PendingItemViewSet, "pendingitem"),
    path(
        "trackers/<uuid:tracker_pk>/pending-items/<uuid:pk>/convert",
        PendingItemViewSet.as_view({"post": "convert"}),
        name="pendingitem-convert",
    ),
]
