from django.contrib.postgres.operations import TrigramExtension, UnaccentExtension
from django.db import migrations


class Migration(migrations.Migration):
    """pg_trgm e unaccent servono al matching fuzzy dei merchant (fasi 2-3).

    Vanno abilitate da subito: aggiungerle dopo significa una migration che
    richiede privilegi di superuser su un database gia' in produzione.
    """

    initial = True
    dependencies: list = []

    operations = [
        TrigramExtension(),
        UnaccentExtension(),
    ]
