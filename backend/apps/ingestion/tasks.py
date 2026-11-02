from celery import shared_task

from .models import StatementImport
from .services.scan import run_scan, suggest_missing_categories


# Tre giri sui modelli (90 s al massimo per chiamata di un estratto conto) piu' le
# pause stanno di solito sotto il limite morbido: se lo si
# supera, SoftTimeLimitExceeded arriva dentro run_scan, che segna l'import come
# non riuscito (e quindi riprovabile) invece di lasciarlo "in lettura".
@shared_task(soft_time_limit=300, time_limit=330)
def scan_statement(statement_id: str) -> str:
    """Lettura di estratto conto o scontrino: secondi o decine di secondi, fuori dalla richiesta."""
    statement = StatementImport.objects.select_related("tracker").get(pk=statement_id)
    run_scan(statement)
    return statement.status


@shared_task(soft_time_limit=300, time_limit=330)
def suggest_statement_categories(statement_id: str) -> int:
    """Categorie suggerite per le righe arrivate dalla banca, fuori dalla sincronizzazione."""
    statement = StatementImport.objects.select_related("tracker").filter(pk=statement_id).first()
    if statement is None or statement.status != StatementImport.Status.READY:
        return 0
    return suggest_missing_categories(statement)
