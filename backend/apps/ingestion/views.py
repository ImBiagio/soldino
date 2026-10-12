from __future__ import annotations

from django.db import transaction as db_transaction
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsTrackerMember
from apps.core.scoping import TrackerScopedMixin

from .models import StatementImport, StatementLine
from .serializers import (
    LinesReplaceSerializer,
    StatementImportSerializer,
    StatementUploadSerializer,
)
from .services.scan import commit_statement
from .tasks import scan_statement


class StatementViewSet(
    TrackerScopedMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Scan dell'estratto conto: carica, rivedi, conferma (ADR 0008)."""

    serializer_class = StatementImportSerializer
    permission_classes = [IsAuthenticated, IsTrackerMember]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    queryset = StatementImport.objects.select_related("account", "uploaded_by").prefetch_related(
        "lines"
    )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["tracker"] = self.get_tracker()
        return context

    @extend_schema(request=StatementUploadSerializer, responses={201: StatementImportSerializer})
    def create(self, request, tracker_pk=None):
        tracker = self.get_tracker()
        upload = StatementUploadSerializer(data=request.data, context={"tracker": tracker})
        upload.is_valid(raise_exception=True)
        account = upload.validated_data.get("account")
        statement = StatementImport.objects.create(
            tracker=tracker,
            uploaded_by=request.user,
            filename=upload.validated_data["file"].name[:255],
            pdf=upload.validated_data["file"].read(),
            account=account,
            # Le righe di un estratto conto sono di chi intesta il conto.
            default_payer=account.owner if account else request.user,
        )
        db_transaction.on_commit(lambda: scan_statement.delay(str(statement.pk)))
        return Response(self.get_serializer(statement).data, status=status.HTTP_201_CREATED)

    def _fresh(self, statement):
        """Le righe precaricate da get_object() non vedono le modifiche appena fatte."""
        return self.get_queryset().get(pk=statement.pk)

    def _editable(self, statement):
        if statement.status != StatementImport.Status.READY:
            return Response(
                {"detail": "Questo estratto conto non e' in revisione."},
                status=status.HTTP_409_CONFLICT,
            )
        return None

    @extend_schema(request=LinesReplaceSerializer, responses={200: StatementImportSerializer})
    @action(detail=True, methods=["put"], url_path="lines")
    @db_transaction.atomic
    def replace_lines(self, request, tracker_pk=None, pk=None):
        """Riscrive tutte le righe della bozza: e' come lavora la tabella di revisione."""
        statement = self.get_object()
        if error := self._editable(statement):
            return error
        payload = LinesReplaceSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)

        existing = {str(line.pk): line for line in statement.lines.all()}
        keep = set()
        for position, data in enumerate(payload.validated_data["lines"]):
            line_id = str(request.data["lines"][position].get("id") or "")
            data["position"] = position
            line = existing.get(line_id)
            if line is not None:
                before = line.category_id
                for field, value in data.items():
                    setattr(line, field, value)
                if line.category_id != before:
                    line.category_source = StatementLine.CategorySource.MANUAL
                line.save()
                keep.add(line_id)
            else:
                data.setdefault("category_source", StatementLine.CategorySource.MANUAL)
                if data.get("category") is None:
                    data["category_source"] = StatementLine.CategorySource.NONE
                keep.add(str(StatementLine.objects.create(statement=statement, **data).pk))
        statement.lines.exclude(pk__in=keep).hard_delete()
        return Response(self.get_serializer(self._fresh(statement)).data)

    @extend_schema(request=None, responses={201: StatementImportSerializer})
    @action(detail=True, methods=["post"])
    def commit(self, request, tracker_pk=None, pk=None):
        """OK: le righe diventano movimenti, tutte insieme o nessuna."""
        statement = self.get_object()
        if error := self._editable(statement):
            return error
        if not statement.lines.exists():
            return Response({"detail": "Non ci sono righe da registrare."}, status=400)
        commit_statement(statement, request)
        return Response(
            self.get_serializer(self._fresh(statement)).data, status=status.HTTP_201_CREATED
        )

    @extend_schema(request=None, responses={202: StatementImportSerializer})
    @action(detail=True, methods=["post"])
    def retry(self, request, tracker_pk=None, pk=None):
        """Rilegge un PDF la cui lettura non e' riuscita (il file e' ancora li')."""
        statement = self.get_object()
        if statement.status != StatementImport.Status.FAILED or not statement.pdf:
            return Response({"detail": "Niente da rileggere."}, status=status.HTTP_409_CONFLICT)
        statement.status = StatementImport.Status.PROCESSING
        statement.error = ""
        statement.save(update_fields=["status", "error", "updated_at"])
        db_transaction.on_commit(lambda: scan_statement.delay(str(statement.pk)))
        return Response(self.get_serializer(statement).data, status=status.HTTP_202_ACCEPTED)

    def perform_destroy(self, instance):
        # Scartare una bozza cancella anche il PDF, se c'e' ancora.
        instance.pdf = None
        instance.save(update_fields=["pdf", "updated_at"])
        instance.delete()
