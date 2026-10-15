from django.contrib import admin
from django.http import HttpResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def health(request):
    """Per l'healthcheck del container: risponde senza DB, auth ne' redirect."""
    return HttpResponse("ok", content_type="text/plain")


urlpatterns = [
    path("api/health", health, name="health"),
    path("admin/", admin.site.urls),
    path("api/", include("apps.users.urls")),
    path("api/", include("apps.trackers.urls")),
    path("api/", include("apps.accounts.urls")),
    path("api/", include("apps.transactions.urls")),
    path("api/", include("apps.recurring.urls")),
    path("api/", include("apps.ingestion.urls")),
    path("api/", include("apps.banking.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
]
