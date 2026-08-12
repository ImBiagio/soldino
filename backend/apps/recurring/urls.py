from apps.core.routers import nested

from .views import RecurringRuleViewSet

urlpatterns = [*nested("recurring-rules", RecurringRuleViewSet, "recurringrule")]
