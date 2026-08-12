from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.core.permissions import IsTrackerMember
from apps.core.scoping import TrackerScopedMixin

from .models import RecurringRule
from .serializers import RecurringRuleSerializer


class RecurringRuleViewSet(TrackerScopedMixin, viewsets.ModelViewSet):
    serializer_class = RecurringRuleSerializer
    permission_classes = [IsAuthenticated, IsTrackerMember]
    queryset = RecurringRule.objects.select_related("category", "account", "paid_by")
    filterset_fields = ["type", "frequency", "is_subscription", "active"]

    def perform_create(self, serializer):
        serializer.save(tracker=self.get_tracker())
