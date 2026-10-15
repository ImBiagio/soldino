# 0015 — Movimenti a voce, pareggi in bozza e la schermata "Da rivedere"

Data: 2026-10-15 · Stato: accettata

## Contesto

Le strade per far entrare movimenti senza scriverli a mano sono diventate
quattro: estratto conto (ADR 0008), scontrino (ADR 0014), banca (ADR 0013) e
ora la voce ("ho dato 10 euro a Maurizio per le spese di casa"). Tutte
producono una bozza da approvare (§0.6), ma ognuna aveva la sua pagina: per
sapere cosa aspettava un OK bisognava girarle tutte. E dallo scontrino si
restava fermi sulla lettura invece di fotografare e andare.

## Decisione

**Voce come testo, letto da Gemini.** Il browser trascrive (Web Speech API,
`it-IT`; dove manca si usa il microfono della tastiera o si scrive) e il
backend riceve solo il **testo** (`POST /statements/voice`), salvato in
`StatementImport.transcript` con `source=voice`. Il task Celery lo passa a
Gemini insieme a membri del tracker (id e nome), chi parla, la data di oggi e
le categorie; la risposta è vincolata a uno schema (`ExtractedVoice`). Niente
audio sul server: Gemini non accetta tutti i formati dei browser (webm/opus) e
il testo si può correggere prima di inviarlo.

**La voce sa chi paga, a chi e se è divisa.** Ogni riga può portare
`payer_id`, `to_id` e `shared`; il backend accetta un id solo se è di un membro
attivo, altrimenti la riga è di chi parla. "Per casa", "da dividere" diventano
divisione di default.

**Pareggi in bozza.** `StatementLine.type` ammette `transfer` con `to_user`:
soldi dati a un altro membro. Alla registrazione diventa un `Settlement` (non
una spesa: non entra nelle statistiche), validato come quelli fatti a mano. In
revisione il pulsante del segno passa da uscita a entrata a pareggio, che
mostra "da" e "a" invece di categoria e divisione. Le spese e le entrate a voce
hanno origine `voice` (`Transaction.Source`).

**Foto e via.** Lo scontrino si carica e la pagina resta pronta per il
successivo: la lettura era già in background, ora lo è anche l'esperienza.

**Una schermata "Da rivedere".** `/t/:id/da-rivedere` elenca le bozze non
ancora registrate (`GET /statements?open=1`), raggruppate per fonte
(scontrini, vocali, estratti conto, banche), con un link alla revisione di
ciascuna. È nella barra di navigazione con un badge col numero di bozze
pronte o da riprovare; su mobile prende il posto di "In attesa", che passa in
"Altro".

## Conseguenze

- La voce costa una chiamata a Gemini come lo scontrino (stesso limite `scan`,
  stessa catena di modelli di riserva) e il testo passa da Google.
- Un pareggio dettato verso una persona che non è membro del tracker resta una
  spesa normale.
- La bozza e la revisione sono una sola per tutte le fonti: ogni miglioria
  (doppioni, categorie dallo storico) vale per tutte.
