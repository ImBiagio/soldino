"""Rotte annidate senza dipendenze extra.

``nested(prefix, viewset)`` genera le due rotte CRUD sotto
``trackers/<tracker_pk>/<prefix>``; il kwarg ``tracker_pk`` e' quello che il
mixin di isolamento si aspetta.
"""

from __future__ import annotations

from django.urls import path

LIST_MAP = {"get": "list", "post": "create"}
DETAIL_MAP = {
    "get": "retrieve",
    "put": "update",
    "patch": "partial_update",
    "delete": "destroy",
}


def nested(prefix: str, viewset, basename: str, *, list_map=None, detail_map=None):
    return [
        path(
            f"trackers/<uuid:tracker_pk>/{prefix}",
            viewset.as_view(list_map or LIST_MAP),
            name=f"{basename}-list",
        ),
        path(
            f"trackers/<uuid:tracker_pk>/{prefix}/<uuid:pk>",
            viewset.as_view(detail_map or DETAIL_MAP),
            name=f"{basename}-detail",
        ),
    ]
