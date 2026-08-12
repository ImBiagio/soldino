from django.urls import path

from .views import (
    LoginView,
    LogoutView,
    MeView,
    PasswordChangeView,
    RefreshView,
    RegisterView,
    VerifyEmailView,
)

urlpatterns = [
    path("auth/register", RegisterView.as_view(), name="auth-register"),
    path("auth/login", LoginView.as_view(), name="auth-login"),
    path("auth/refresh", RefreshView.as_view(), name="auth-refresh"),
    path("auth/logout", LogoutView.as_view(), name="auth-logout"),
    path("auth/verify-email/<str:token>", VerifyEmailView.as_view(), name="auth-verify-email"),
    path("auth/password", PasswordChangeView.as_view(), name="auth-password"),
    path("me", MeView.as_view(), name="me"),
]
