from __future__ import annotations

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.methods import normalize_email, send_notification

from .serializers import (
    LoginSerializer,
    PasswordChangeSerializer,
    RegisterSerializer,
    TokenPairSerializer,
    UserSerializer,
)
from .tokens import EMAIL_VERIFY_SALT, email_verification_url, read_token

User = get_user_model()


def _set_refresh_cookie(response: Response, refresh: RefreshToken) -> Response:
    response.set_cookie(
        settings.REFRESH_COOKIE_NAME,
        str(refresh),
        max_age=settings.REFRESH_TOKEN_LIFETIME,
        httponly=True,
        secure=settings.REFRESH_COOKIE_SECURE,
        samesite=settings.REFRESH_COOKIE_SAMESITE,
        path=settings.REFRESH_COOKIE_PATH,
    )
    return response


def _auth_response(user) -> Response:
    refresh = RefreshToken.for_user(user)
    payload = {"access": str(refresh.access_token), "user": UserSerializer(user).data}
    return _set_refresh_cookie(Response(payload), refresh)


def revoke_all_refresh_tokens(user) -> None:
    """Ogni sessione aperta dell'utente non potra' piu' rinnovarsi."""
    BlacklistedToken.objects.bulk_create(
        [BlacklistedToken(token=token) for token in OutstandingToken.objects.filter(user=user)],
        ignore_conflicts=True,
    )


class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    @extend_schema(request=RegisterSerializer, responses={201: TokenPairSerializer})
    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        if settings.REQUIRE_EMAIL_VERIFICATION:
            send_notification(
                "Conferma il tuo indirizzo email",
                f"Conferma il tuo account: {email_verification_url(user)}",
                user.email,
            )
            return Response(
                {"detail": "Registrazione completata. Controlla la mail per confermare."},
                status=status.HTTP_201_CREATED,
            )

        user.email_verified_at = timezone.now()
        user.save(update_fields=["email_verified_at"])
        response = _auth_response(user)
        response.status_code = status.HTTP_201_CREATED
        return response


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    @extend_schema(request=LoginSerializer, responses={200: TokenPairSerializer})
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(
            request,
            username=normalize_email(serializer.validated_data["email"]),
            password=serializer.validated_data["password"],
        )
        if user is None:
            return Response(
                {"detail": "Credenziali non valide."}, status=status.HTTP_401_UNAUTHORIZED
            )
        if settings.REQUIRE_EMAIL_VERIFICATION and not user.is_email_verified:
            return Response(
                {"detail": "Email non ancora confermata."}, status=status.HTTP_403_FORBIDDEN
            )
        return _auth_response(user)


class RefreshView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "refresh"

    @extend_schema(request=None, responses={200: TokenPairSerializer})
    def post(self, request):
        # Solo dal cookie: il refresh non deve mai passare dal JavaScript.
        raw = request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
        if not raw:
            return Response(
                {"detail": "Refresh token assente."}, status=status.HTTP_401_UNAUTHORIZED
            )
        try:
            refresh = RefreshToken(raw)
        except TokenError:
            return Response(
                {"detail": "Refresh token non valido."}, status=status.HTTP_401_UNAUTHORIZED
            )

        user = User.objects.filter(pk=refresh.payload.get("user_id"), is_active=True).first()
        if user is None:
            return Response({"detail": "Utente non valido."}, status=status.HTTP_401_UNAUTHORIZED)

        # ROTATE_REFRESH_TOKENS: emettiamo una coppia nuova a ogni refresh.
        new_refresh = RefreshToken.for_user(user)
        payload = {"access": str(new_refresh.access_token), "user": UserSerializer(user).data}
        return _set_refresh_cookie(Response(payload), new_refresh)


class LogoutView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        # Il cookie cancellato non basta: chi l'avesse copiato potrebbe ancora usarlo.
        raw = request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
        if raw:
            try:
                RefreshToken(raw).blacklist()
            except TokenError:
                pass
        response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie(
            settings.REFRESH_COOKIE_NAME, path=settings.REFRESH_COOKIE_PATH
        )
        return response


class VerifyEmailView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    @extend_schema(request=None, responses={200: TokenPairSerializer})
    def post(self, request, token: str):
        uid = read_token(token, EMAIL_VERIFY_SALT)
        if uid is None:
            return Response(
                {"detail": "Link non valido o scaduto."}, status=status.HTTP_400_BAD_REQUEST
            )
        user = User.objects.filter(pk=uid).first()
        if user is None:
            return Response({"detail": "Utente inesistente."}, status=status.HTTP_400_BAD_REQUEST)
        # Il link fa entrare senza password: vale una volta sola, non per tre giorni.
        if user.is_email_verified:
            return Response(
                {"detail": "Email gia' confermata: accedi con la tua password."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.email_verified_at = timezone.now()
        user.save(update_fields=["email_verified_at"])
        return _auth_response(user)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: UserSerializer})
    def get(self, request):
        return Response(UserSerializer(request.user).data)

    @extend_schema(request=UserSerializer, responses={200: UserSerializer})
    def patch(self, request):
        serializer = UserSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=PasswordChangeSerializer, responses={204: None})
    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        if not request.user.check_password(serializer.validated_data["current_password"]):
            return Response(
                {"current_password": ["Password attuale errata."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        # Le altre sessioni (magari di chi conosceva la vecchia password) cadono;
        # questa riceve un refresh nuovo e resta aperta.
        revoke_all_refresh_tokens(request.user)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        return _set_refresh_cookie(response, RefreshToken.for_user(request.user))
