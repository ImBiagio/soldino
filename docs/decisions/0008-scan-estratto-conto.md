# 0008 — Scan dell'estratto conto: Gemini sul PDF, bozza approvata a mano

**Cosa.** Si carica il PDF di un estratto conto; un task Celery lo manda a
Gemini, che restituisce i movimenti come JSON vincolato a uno schema
(`ExtractedStatement`). Le righe finiscono in una **bozza** (`StatementLine`) che
l'utente rivede in una tabella: modifica data, titolo, importo, tipo,
categoria, chi paga e divisione, elimina e aggiunge righe. Solo con "Registra"
diventano `Transaction` (`source=scan`), tutte insieme in una transazione di
database.

**Perché Gemini e il PDF intero.** Il modello legge da sé sia i PDF testuali sia
le scansioni: niente pipeline estrazione testo → OCR → parsing per ogni banca.
Lo schema JSON toglie il parsing di testo libero. Modello e chiave stanno in
`GEMINI_MODEL` e `GEMINI_API_KEY`.

**Man in the loop.** È il principio §0.6 già usato per le ricorrenze: nessuna
scrittura da fonte esterna senza approvazione. L'LLM sbaglia poco ma sbaglia, e
un movimento sbagliato sporca debiti e riconciliazione.

**Categorie in due livelli.** Prima lo *storico*: se un esercente (normalizzato)
è già stato categorizzato nel tracker, si riusa la categoria più usata, perché
è una scelta già fatta dall'utente. Altrimenti decide Gemini, a cui si passa
l'elenco delle categorie **con la loro descrizione**: è il criterio di scelta, e
il motivo per cui la descrizione esiste. Un id inventato o di tipo sbagliato
viene scartato. La revisione mostra da dove viene ogni categoria.

**Doppioni.** Una riga è un possibile doppione se esiste già un movimento con
stessa data, importo e tipo (a parità vince lo stesso esercente). Non si usa
solo l'impronta, che include il titolo: Gemini ripulisce i titoli e lo stesso
estratto letto due volte non avrebbe titoli identici. Resta un avviso, con un
pulsante per togliere i doppioni in blocco.

**Riservatezza.** Il PDF si tiene solo finché la lettura non riesce (serve per
"Riprova"), poi si cancella; scartando una bozza si cancella comunque. Il file
passa da Google: con il piano gratuito dell'API i contenuti possono essere usati
per migliorare i modelli, per gli estratti conto serve un progetto a pagamento.

**Errori.** 429/500/503 (sovraccarico, limiti) si riprovano da soli due volte,
con pause crescenti; gli altri arrivano all'utente con un messaggio leggibile e
lo stato `failed`, da cui si può riprovare.

## Aggiornamento 2026-10-15: modello scelto in base alla disponibilità

Il 15 ottobre `gemini-flash-latest` ha risposto 503/504 per ore mentre
`gemini-flash-lite-latest` rispondeva in un secondo: con un modello solo lo
scan era fermo. Ora `GEMINI_MODEL` è il principale e `GEMINI_FALLBACK_MODELS`
(default `gemini-flash-lite-latest`) le riserve, in ordine.

- Un errore temporaneo (429, 5xx, timeout, rete) passa **subito** al modello
  successivo invece di aspettare; finito il giro si aspetta (4 s, poi 12 s) e
  si rifà il giro, tre volte in tutto.
- Il modello che ha fallito resta **in fondo alla fila per
  `GEMINI_MODEL_COOLDOWN` secondi** (300), nella cache Redis condivisa dai
  worker: le letture successive partono da quello che funziona. Un 404
  (modello inesistente per la chiave) lo tiene in fondo un giorno.
- Chiave rifiutata (401/403) e richieste non valide non dipendono dal modello:
  si fermano subito.
- L'import registra in `model_name` il modello che ha letto davvero.
- Timeout per chiamata: 90 s per l'estratto conto, 30 s per lo scontrino, così
  un modello appeso non fa aspettare un minuto e mezzo per una foto.

