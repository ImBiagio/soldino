"""Dopo "Scarta" la finestra di lettura non tornava a sync_from: i movimenti
piu' vecchi della bozza scartata non venivano piu' richiesti. Si riparte da
sync_from per tutti; i movimenti gia' letti non si ripetono (SeenBankTransaction)."""

from django.db import migrations


def reset(apps, schema_editor):
    apps.get_model("banking", "BankAccount").objects.update(synced_until=None)


class Migration(migrations.Migration):
    dependencies = [("banking", "0003_release_discarded_drafts")]

    operations = [migrations.RunPython(reset, migrations.RunPython.noop)]
