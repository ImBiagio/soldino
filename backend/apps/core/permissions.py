from __future__ import annotations

from rest_framework.permissions import SAFE_METHODS, BasePermission

from .scoping import get_membership

WRITE_ROLES = {"owner", "editor"}


class IsTrackerMember(BasePermission):
    """Membro attivo per leggere; owner/editor per scrivere.

    Il tracker viene letto dal kwarg di rotta ``tracker_pk``; per le rotte non
    annidate la view espone ``get_tracker_id_for_permission(obj)``.
    """

    message = "Non hai i permessi su questo tracker."

    def has_permission(self, request, view) -> bool:
        tracker_id = view.kwargs.get("tracker_pk")
        if tracker_id is None:
            return bool(request.user and request.user.is_authenticated)
        membership = get_membership(request.user, tracker_id)
        if membership is None:
            return False
        if request.method in SAFE_METHODS:
            return True
        return membership.role in WRITE_ROLES

    def has_object_permission(self, request, view, obj) -> bool:
        tracker_id = getattr(obj, "tracker_id", None) or getattr(obj, "id", None)
        membership = get_membership(request.user, tracker_id)
        if membership is None:
            return False
        if request.method in SAFE_METHODS:
            return True
        return membership.role in WRITE_ROLES


class IsTrackerOwner(BasePermission):
    message = "Solo il proprietario del tracker puo' eseguire questa azione."

    def has_permission(self, request, view) -> bool:
        tracker_id = view.kwargs.get("tracker_pk") or view.kwargs.get("pk")
        membership = get_membership(request.user, tracker_id)
        return membership is not None and membership.role == "owner"

    def has_object_permission(self, request, view, obj) -> bool:
        tracker_id = getattr(obj, "tracker_id", None) or getattr(obj, "id", None)
        membership = get_membership(request.user, tracker_id)
        return membership is not None and membership.role == "owner"
