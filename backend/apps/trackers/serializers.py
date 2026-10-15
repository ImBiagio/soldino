from __future__ import annotations

from uuid import UUID

from django.contrib.auth import get_user_model
from django.db import transaction as db_transaction
from rest_framework import serializers

from apps.core.methods import validate_date_range
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
            "opening_balance",
            "opening_date",
            "status",
            "display_name",
            "created_at",
        ]
        read_only_fields = ["id", "user", "invited_email", "status", "created_at"]

    def validate_role(self, value: str) -> str:
        # Il proprietario e' uno solo, quello di ``Tracker.owner``.
        if value == Membership.Role.OWNER and getattr(self.instance, "role", None) != value:
            raise serializers.ValidationError("Il proprietario non si assegna.")
        return value


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
            "kind",
            "simplify_debts",
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
            # Stesso default di chi viene invitato: in due fa 50/50. Con 100 qui
            # la divisione "di default" usciva 66,67/33,33.
            default_share_pct="50.00",
        )
        _seed_default_categories(tracker)
        return tracker


# (nome, tipo, descrizione, colore, glifo Material Symbols)
# Colore e icona sono dati, non decorazione del client: la UI li legge da qui.
DEFAULT_CATEGORIES = [
    ("Supermarket", "expense", "Spesa alimentare, discount, alimentari",
     "#ba1a1a", "shopping_basket"),
    ("Home", "expense", "Casa: affitto, mutuo, utenze, manutenzione, arredamento",
     "#ba1a1a", "home"),
    ("Transport", "expense", "Carburante, mezzi pubblici, treni, pedaggi, manutenzione auto",
     "#ba1a1a", "directions_car"),
    ("Eating out", "expense", "Ristoranti, bar, caffe', asporto, delivery",
     "#ba1a1a", "local_bar"),
    ("Health", "expense", "Farmacia, visite mediche, esami, dentista",
     "#ba1a1a", "local_hospital"),
    ("Shopping", "expense", "Abbigliamento, elettronica, oggetti per la persona",
     "#ba1a1a", "redeem"),
    ("Subscriptions", "expense", "Abbonamenti ricorrenti: streaming, cloud, software",
     "#ba1a1a", "live_tv"),
    ("Leisure", "expense", "Cinema, viaggi, eventi, sport, hobby",
     "#ba1a1a", "beach_access"),
    ("Gifts", "expense", "Regali e donazioni", "#ba1a1a", "redeem"),
    ("Other", "expense", "Tutto cio' che non rientra altrove", "#ba1a1a", "payments"),
    ("Salary", "income", "Stipendio e compensi da lavoro", "#1b6c2f", "payments"),
    ("Refund", "income", "Rimborsi e storni", "#1b6c2f", "savings"),
    ("Other income", "income", "Altre entrate", "#1b6c2f", "payments"),
]


def _seed_default_categories(tracker: Tracker) -> None:
    Category.objects.bulk_create(
        [
            Category(
                tracker=tracker,
                name=name,
                type=type_,
                description=description,
                color=color,
                icon=icon,
            )
            for name, type_, description, color, icon in DEFAULT_CATEGORIES
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

    def create(self, validated_data):
        # Senza un colore scelto, quello del tipo: rosso uscite, verde entrate.
        if not validated_data.get("color"):
            kind = validated_data.get("type", Category.Type.EXPENSE)
            validated_data["color"] = Category.DEFAULT_COLORS[kind]
        return super().create(validated_data)


class InviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.ChoiceField(
        choices=[Membership.Role.EDITOR, Membership.Role.VIEWER], default=Membership.Role.EDITOR
    )
    default_share_pct = serializers.DecimalField(
        max_digits=5, decimal_places=2, default="50.00", min_value=0, max_value=100
    )


class SummaryQuerySerializer(serializers.Serializer):
    """Filtri del riepilogo. Valori malformati sono un 400, non un filtro ignorato."""

    year = serializers.IntegerField(required=False, min_value=1900, max_value=9999)
    month = serializers.IntegerField(required=False, min_value=1, max_value=12)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    user_id = serializers.UUIDField(required=False)
    category = serializers.CharField(required=False)

    def validate_category(self, value: str) -> str:
        if value == "none":
            return value
        try:
            return str(UUID(value))
        except ValueError:
            raise serializers.ValidationError("Categoria non valida.") from None

    def validate(self, attrs):
        validate_date_range(attrs.get("date_from"), attrs.get("date_to"))
        return attrs


class BalanceHistoryQuerySerializer(serializers.Serializer):
    date_from = serializers.DateField()
    date_to = serializers.DateField()
    user_id = serializers.UUIDField(required=False)

    def validate(self, attrs):
        validate_date_range(attrs["date_from"], attrs["date_to"])
        if (attrs["date_to"] - attrs["date_from"]).days > 366 * 3:
            raise serializers.ValidationError("Al massimo tre anni per volta.")
        return attrs
