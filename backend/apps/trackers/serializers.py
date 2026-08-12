from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import transaction as db_transaction
from rest_framework import serializers

from apps.users.serializers import UserBriefSerializer

from .models import Category, Membership, Tracker

User = get_user_model()


class MembershipSerializer(serializers.ModelSerializer):
    user = UserBriefSerializer(read_only=True)
    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = Membership
        fields = [
            "id",
            "user",
            "invited_email",
            "role",
            "default_share_pct",
            "status",
            "display_name",
            "created_at",
        ]
        read_only_fields = ["id", "user", "invited_email", "status", "created_at"]


class TrackerSerializer(serializers.ModelSerializer):
    owner = UserBriefSerializer(read_only=True)
    members = MembershipSerializer(source="memberships", many=True, read_only=True)
    my_role = serializers.SerializerMethodField()

    class Meta:
        model = Tracker
        fields = [
            "id",
            "name",
            "currency",
            "owner",
            "archived_at",
            "members",
            "my_role",
            "created_at",
        ]
        read_only_fields = ["id", "owner", "members", "my_role", "created_at"]

    def get_my_role(self, obj) -> str | None:
        user = self.context["request"].user
        for membership in obj.memberships.all():
            if membership.user_id == user.pk:
                return membership.role
        return None

    @db_transaction.atomic
    def create(self, validated_data):
        user = self.context["request"].user
        tracker = Tracker.objects.create(owner=user, **validated_data)
        Membership.objects.create(
            tracker=tracker,
            user=user,
            role=Membership.Role.OWNER,
            status=Membership.Status.ACTIVE,
            default_share_pct="100.00",
        )
        _seed_default_categories(tracker)
        return tracker


DEFAULT_CATEGORIES = [
    ("Supermarket", "expense", "Spesa alimentare, discount, alimentari"),
    ("Home", "expense", "Casa: affitto, mutuo, utenze, manutenzione, arredamento"),
    ("Transport", "expense", "Carburante, mezzi pubblici, treni, pedaggi, manutenzione auto"),
    ("Eating out", "expense", "Ristoranti, bar, caffe', asporto, delivery"),
    ("Health", "expense", "Farmacia, visite mediche, esami, dentista"),
    ("Shopping", "expense", "Abbigliamento, elettronica, oggetti per la persona"),
    ("Subscriptions", "expense", "Abbonamenti ricorrenti: streaming, cloud, software"),
    ("Leisure", "expense", "Cinema, viaggi, eventi, sport, hobby"),
    ("Gifts", "expense", "Regali e donazioni"),
    ("Other", "expense", "Tutto cio' che non rientra altrove"),
    ("Salary", "income", "Stipendio e compensi da lavoro"),
    ("Refund", "income", "Rimborsi e storni"),
    ("Other income", "income", "Altre entrate"),
]


def _seed_default_categories(tracker: Tracker) -> None:
    Category.objects.bulk_create(
        [
            Category(tracker=tracker, name=name, type=type_, description=description)
            for name, type_, description in DEFAULT_CATEGORIES
        ]
    )


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = [
            "id",
            "name",
            "description",
            "type",
            "color",
            "icon",
            "archived",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class InviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.ChoiceField(
        choices=Membership.Role.choices, default=Membership.Role.EDITOR
    )
    default_share_pct = serializers.DecimalField(
        max_digits=5, decimal_places=2, default="50.00"
    )


class InviteAcceptSerializer(serializers.Serializer):
    token = serializers.CharField()
