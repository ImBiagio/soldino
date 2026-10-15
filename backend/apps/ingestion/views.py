from __future__ import annotations

from datetime import timedelta

from django.db import transaction as db_transaction
from django.db.models import BooleanField, ExpressionWrapper, Q
from django.http import Http404, HttpResponse
from django.utils import timezone
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
    VoiceInputSerializer,
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
    # Il file (PDF o foto, anche megabyte) non si legge per le liste: si sa
    # solo se c'e'. Lo scarica l'azione ``file`` quando serve.
    queryset = (
        StatementImport.objects.select_related("account", "uploaded_by")
        .prefetch_related("lines")
        .defer("pdf")
        .annotate(
            file_present=ExpressionWrapper(Q(pdf__isnull=False), output_field=BooleanField())
        )
    )
    filterset_fields = ["source", "status", "account"]

    def get_queryset(self):
        qs = super().get_queryset()
        # ?open=1: solo cio' che aspetta qualcuno (la schermata "Da rivedere").
        if self.action == "list" and self.request.query_params.get("open"):
            qs = qs.exclude(status=StatementImport.Status.COMMITTED)
        return qs

    @property
    def throttle_scope(self):
        # Solo cio' che chiama Gemini: la revisione fa polling ogni 2,5 secondi.
        return "scan" if self.action in {"create", "retry", "voice"} else None

    @extend_schema(request=StatementUploadSerializer, responses={201: StatementImportSerializer})
    def create(self, request, tracker_pk=None):
        tracker = self.get_tracker()
        upload = StatementUploadSerializer(data=request.data, context={"tracker": tracker})
        upload.is_valid(raise_exception=True)
        data = upload.validated_data
        account = data.get("account")
        statement = StatementImport.objects.create(
            tracker=tracker,
            uploaded_by=request.user,
            source=data["source"],
            filename=data["file"].name[:255],
            pdf=data["file"].read(),
            mime_type=data["mime_type"],
            account=account,
            # Le righe di un estratto conto sono di chi intesta il conto; lo
            # scontrino senza conto e' di chi l'ha fotografato.
            default_payer=account.owner if account else request.user,
        )
        db_transaction.on_commit(lambda: scan_statement.delay(str(statement.pk)))
        return Response(self.get_serializer(statement).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=VoiceInputSerializer, responses={201: StatementImportSerializer})
    @action(detail=False, methods=["post"])
    def voice(self, request, tracker_pk=None):
        """Movimento a voce: il testo dettato si legge in background, come uno scontrino."""
        tracker = self.get_tracker()
        payload = VoiceInputSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        text = payload.validated_data["text"]
        statement = StatementImport.objects.create(
            tracker=tracker,
            uploaded_by=request.user,
            source=StatementImport.Source.VOICE,
            filename=text[:255],
            transcript=text,
            mime_type="text/plain",
            default_payer=request.user,
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
            raw = request.data["lines"][position]
            line_id = str(raw.get("id") or "") if isinstance(raw, dict) else ""
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

    @extend_schema(request=None, responses={(200, "image/jpeg"): bytes})
    @action(detail=True, methods=["get"])
    def file(self, request, tracker_pk=None, pk=None):
        """La foto dello scontrino, per la revisione. Il PDF non si riscarica."""
        statement = self.get_object()
        if not statement.is_receipt or statement.pdf is None:
            raise Http404("Nessuna foto per questo import.")
        response = HttpResponse(bytes(statement.pdf), content_type=statement.mime_type)
        # Dato personale: niente cache condivise, niente copie su disco del browser.
        response["Cache-Control"] = "private, no-store"
        response["Content-Disposition"] = "inline"
        return response

    @extend_schema(request=None, responses={202: StatementImportSerializer})
    @action(detail=True, methods=["post"])
    def retry(self, request, tracker_pk=None, pk=None):
        """Rilegge un file la cui lettura non e' riuscita (il file e' ancora li').

        Vale anche per un import fermo "in lettura" da oltre 10 minuti: il worker
        e' stato riavviato a meta' (un deploy) e il task non tornera' piu'.
        """
        statement = self.get_object()
        stuck = (
            statement.status == StatementImport.Status.PROCESSING
            and statement.updated_at < timezone.now() - timedelta(minutes=10)
        )
        retryable = statement.status == StatementImport.Status.FAILED or stuck
        # La voce non ha file: si rilegge il testo.
        if not retryable or not (statement.pdf or statement.transcript):
            return Response({"detail": "Niente da rileggere."}, status=status.HTTP_409_CONFLICT)
        statement.status = StatementImport.Status.PROCESSING
        statement.error = ""
        statement.save(update_fields=["status", "error", "updated_at"])
        db_transaction.on_commit(lambda: scan_statement.delay(str(statement.pk)))
        return Response(self.get_serializer(statement).data, status=status.HTTP_202_ACCEPTED)

    def perform_destroy(self, instance):
        if instance.source == StatementImport.Source.BANK:
            from apps.banking.services.sync import release_draft

            # La bozza della banca scartata torna alla prossima sincronizzazione.
            release_draft(instance)
        # Scartare una bozza cancella anche il PDF, se c'e' ancora.
        instance.pdf = None
        instance.save(update_fields=["pdf", "updated_at"])
        instance.delete()
