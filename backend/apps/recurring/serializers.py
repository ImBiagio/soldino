from rest_framework import serializers

from .models import RecurringRule


class RecurringRuleSerializer(serializers.ModelSerializer):
    monthly_cost = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    yearly_cost = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = RecurringRule
        fields = [
            "id",
            "type",
            "title",
            "amount",
            "category",
            "account",
            "paid_by",
            "frequency",
            "rrule",
            "next_run",
            "end_date",
            "is_subscription",
            "auto_commit",
            "split_template",
            "active",
            "monthly_cost",
            "yearly_cost",
            "created_at",
        ]
        read_only_fields = ["id", "monthly_cost", "yearly_cost", "created_at"]
