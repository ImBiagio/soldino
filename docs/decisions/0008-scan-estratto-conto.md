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
