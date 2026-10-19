from django.urls import path

from apps.core.routers import nested

from .views import (
    CategoryViewSet,
    InviteAcceptView,
    InvitePreviewView,
    MembershipViewSet,
    TrackerViewSet,
)

tracker_list = TrackerViewSet.as_view({"get": "list", "post": "create"})
tracker_detail = TrackerViewSet.as_view(
    {"get": "retrieve", "patch": "partial_update", "put": "update", "delete": "destroy"}
)

urlpatterns = [
    path("trackers", tracker_list, name="tracker-list"),
    path("trackers/<uuid:pk>", tracker_detail, name="tracker-detail"),
    path("trackers/<uuid:pk>/archive", TrackerViewSet.as_view({"post": "archive"}),
         name="tracker-archive"),
    path("trackers/<uuid:pk>/unarchive", TrackerViewSet.as_view({"post": "unarchive"}),
         name="tracker-unarchive"),
    path("trackers/<uuid:pk>/duplicate", TrackerViewSet.as_view({"post": "duplicate"}),
         name="tracker-duplicate"),
    path("trackers/<uuid:pk>/invite", TrackerViewSet.as_view({"post": "invite"}),
         name="tracker-invite"),
    path("trackers/<uuid:pk>/balances", TrackerViewSet.as_view({"get": "balances"}),
         name="tracker-balances"),
    path("trackers/<uuid:pk>/summary", TrackerViewSet.as_view({"get": "summary"}),
         name="tracker-summary"),
    path("trackers/<uuid:pk>/balance-history",
         TrackerViewSet.as_view({"get": "balance_history"}), name="tracker-balance-history"),
    path("trackers/<uuid:pk>/reconciliation",
         TrackerViewSet.as_view({"get": "reconciliation"}), name="tracker-reconciliation"),
    path("invites/<str:token>", InvitePreviewView.as_view(), name="invite-preview"),
    path("invites/<str:token>/accept", InviteAcceptView.as_view(), name="invite-accept"),
    # GET /api/trackers/{id}/members -> lista membri (piano §2.3)
    *nested(
        "members",
        MembershipViewSet,
        "membership",
        list_map={"get": "list"},
        detail_map={"patch": "partial_update", "put": "update", "delete": "destroy"},
    ),
    *nested("categories", CategoryViewSet, "category"),
]
