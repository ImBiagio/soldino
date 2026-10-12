from celery import shared_task

from .models import StatementImport
from .services.scan import run_scan


@shared_task
def scan_statement(statement_id: str) -> str:
    """Lettura dell'estratto conto: decine di secondi, fuori dalla richiesta HTTP."""
    statement = StatementImport.objects.select_related("tracker").get(pk=statement_id)
    run_scan(statement)
    return statement.status
