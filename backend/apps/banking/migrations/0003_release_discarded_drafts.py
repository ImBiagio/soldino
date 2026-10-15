"""Le bozze della banca scartate prima del 2026-10-15 avevano "bruciato" i loro
movimenti: li si rimette in coda, come fa ora "Scarta" (ADR 0013)."""

from django.db import migrations


def release(apps, schema_editor):
    StatementImport = apps.get_model("ingestion", "StatementImport")
    StatementLine = apps.get_model("ingestion", "StatementLine")
    Seen = apps.get_model("banking", "SeenBankTransaction")
    discarded = StatementImport.objects.filter(
        source="bank", status="ready", deleted_at__isnull=False, account__isnull=False
    )
    for statement in discarded:
        ids = list(
            StatementLine.objects.filter(
                statement=statement,
                transaction__isnull=True,
                settlement__isnull=True,
            )
            .exclude(external_id="")
            .values_list("external_id", flat=True)
        )
        Seen.objects.filter(account_id=statement.account_id, external_id__in=ids).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("banking", "0002_longer_account_identifiers"),
        ("ingestion", "0004_statementimport_transcript_statementline_settlement_and_more"),
    ]

    operations = [migrations.RunPython(release, migrations.RunPython.noop)]
