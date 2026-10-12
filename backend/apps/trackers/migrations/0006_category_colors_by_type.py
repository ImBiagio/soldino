from django.db import migrations

# I colori con cui venivano create le categorie di default prima di questa
# migrazione: la palette tonale dell'app, assegnata a rotazione.
OLD_SEED_COLORS = {"#1b6c2f", "#38656a", "#7d5700", "#74796f"}
DEFAULT_NAMES = {
    "Supermarket", "Home", "Transport", "Eating out", "Health", "Shopping",
    "Subscriptions", "Leisure", "Gifts", "Other", "Salary", "Refund", "Other income",
}
COLORS = {"expense": "#ba1a1a", "income": "#1b6c2f"}


def recolor_defaults(apps, schema_editor):
    """Solo le categorie di default ancora col colore originale: quelle
    ricolorate a mano o create dall'utente restano come sono."""
    Category = apps.get_model("trackers", "Category")
    for kind, color in COLORS.items():
        Category.objects.filter(
            type=kind, name__in=DEFAULT_NAMES, color__in=OLD_SEED_COLORS
        ).update(color=color)


class Migration(migrations.Migration):
    dependencies = [
        ("trackers", "0005_membership_opening_balance"),
    ]

    operations = [migrations.RunPython(recolor_defaults, migrations.RunPython.noop)]
