from django.urls import path

from apps.core.routers import nested

from .views import StatementViewSet

urlpatterns = [
    *nested(
        "statements",
        StatementViewSet,
        "statement",
        list_map={"get": "list", "post": "create"},
        detail_map={"get": "retrieve", "delete": "destroy"},
    ),
    path(
        "trackers/<uuid:tracker_pk>/statements/<uuid:pk>/lines",
        StatementViewSet.as_view({"put": "replace_lines"}),
        name="statement-lines",
    ),
    path(
        "trackers/<uuid:tracker_pk>/statements/<uuid:pk>/commit",
        StatementViewSet.as_view({"post": "commit"}),
        name="statement-commit",
    ),
    path(
        "trackers/<uuid:tracker_pk>/statements/<uuid:pk>/file",
        StatementViewSet.as_view({"get": "file"}),
        name="statement-file",
    ),
    path(
        "trackers/<uuid:tracker_pk>/statements/<uuid:pk>/retry",
        StatementViewSet.as_view({"post": "retry"}),
        name="statement-retry",
    ),
]
