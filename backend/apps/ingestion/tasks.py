from celery import shared_task

from .models import StatementImport
from .services.scan import run_scan


# Tre tentativi da 90 s piu' le pause stanno sotto il limite morbido: se lo si
# supera, SoftTimeLimitExceeded arriva dentro run_scan, che segna l'import come
# non riuscito (e quindi riprovabile) invece di lasciarlo "in lettura".
@shared_task(soft_time_limit=300, time_limit=330)
def scan_statement(statement_id: str) -> str:
    """Lettura di estratto conto o scontrino: secondi o decine di secondi, fuori dalla richiesta."""
    statement = StatementImport.objects.select_related("tracker").get(pk=statement_id)
    run_scan(statement)
    return statement.status
