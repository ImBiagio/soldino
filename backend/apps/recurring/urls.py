from django.urls import path

from apps.core.routers import nested

from .views import RecurringRuleViewSet

urlpatterns = [
    *nested("recurring-rules", RecurringRuleViewSet, "recurringrule"),
    path(
        "trackers/<uuid:tracker_pk>/recurring-rules/<uuid:pk>/approve",
        RecurringRuleViewSet.as_view({"post": "approve"}),
        name="recurringrule-approve",
    ),
    path(
        "trackers/<uuid:tracker_pk>/recurring-rules/<uuid:pk>/skip",
        RecurringRuleViewSet.as_view({"post": "skip"}),
        name="recurringrule-skip",
    ),
]
