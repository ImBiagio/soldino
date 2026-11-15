from __future__ import annotations

import re

from django.contrib.auth import get_user_model
from django.utils.translation import gettext as _
from rest_framework import serializers

User = get_user_model()


NAV_KEY = re.compile(r"^[a-z][a-z-]{0,29}$")
NAV_MAX_ITEMS = 30


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "display_name",
            "avatar",
            "email_verified_at",
            "nav_order",
            "language",
        ]
        # Nome ed email si cambiano su cornhub (account unico della suite):
        # qui restano menu e lingua, che sono dell'app.
        read_only_fields = ["id", "email", "display_name", "email_verified_at"]

    def validate_nav_order(self, value):
        # Le sezioni le conosce il frontend: qui basta che sia una lista corta di
        # chiavi pulite e senza doppioni.
        if not isinstance(value, list) or len(value) > NAV_MAX_ITEMS:
            raise serializers.ValidationError(_("Deve essere una lista di sezioni."))
        if not all(isinstance(key, str) and NAV_KEY.match(key) for key in value):
            raise serializers.ValidationError(_("Sezione non valida."))
        if len(set(value)) != len(value):
            raise serializers.ValidationError(_("Sezione ripetuta."))
        return value


class UserBriefSerializer(serializers.ModelSerializer):
    """Usato ovunque si mostri "chi ha pagato" / "a chi tocca"."""

    class Meta:
        model = User
        fields = ["id", "email", "display_name", "avatar"]
        read_only_fields = fields


class AuthConfigSerializer(serializers.Serializer):
    """Dove mandare l'utente su cornhub: login, account, chiavi AI, registrazione."""

    login_url = serializers.URLField(read_only=True)
    account_url = serializers.URLField(read_only=True)
    ai_url = serializers.URLField(read_only=True)
    register_url = serializers.URLField(read_only=True)


class TokenPairSerializer(serializers.Serializer):
    """Solo l'access token esce nel body: il refresh vive in un cookie httpOnly."""

    access = serializers.CharField(read_only=True)
    user = UserSerializer(read_only=True)
