# 0014 — Scan dello scontrino sulla pipeline dell'estratto conto

Data: 2026-10-15 · Stato: accettata

## Contesto

Lo scan dell'estratto conto (ADR 0008) legge un PDF e produce tante righe in
bozza da approvare. Per le spese di tutti i giorni serve l'inverso: una foto
dello scontrino fatta al momento, una sola spesa, controllata guardando la
foto prima dell'OK. Anche nei tracker "dividere le spese" (ADR 0010), dove
l'estratto conto non c'è.

## Decisione

- **Stessa pipeline, una fonte in più**: `StatementImport.source` vale `scan`
  (PDF) o `receipt` (foto). Upload, task Celery, bozza in `StatementLine`,
  revisione, doppioni, categorie storico→AI e commit atomico sono gli stessi.
  Cambiano solo il lettore e cosa si fa del file.
- **Lettura**: `extract_receipt` manda la foto a Gemini con uno schema
  `{merchant, date, total, category_id}` (solo categorie di spesa) e la
  trasforma in un `ExtractedStatement` di una riga, così `build_lines` non
  cambia. Totale illeggibile → errore chiaro ("rifai la foto"); data
  illeggibile → oggi.
- **Tipo del file dai primi byte** (JPEG, PNG, WebP, HEIC), non
  dall'estensione: `mime_type` sull'import, passato a Gemini e al download.
- **La foto resta fino all'OK**: si scarica da `GET …/statements/<id>/file`
  (con l'header Authorization, quindi via `fetch` → object URL, non `<img src>`
  diretto), `Cache-Control: private, no-store`. Si cancella alla registrazione
  o allo scarto. Il PDF dell'estratto conto invece si cancella appena letto e
  non è scaricabile.
- **Movimento con `source=receipt`** (già previsto da ADR 0001). Nei tracker
  "group" la riga nasce divisa "di default" invece che personale: è un default
  della bozza, si cambia in revisione.
- **Fotocamera**: due input file, uno con `capture="environment"` (sul
  telefono apre direttamente la fotocamera posteriore) e uno senza (galleria
  o file). Su desktop il browser ignora `capture`.
- Lista con `defer("pdf")` + flag `has_file`: le foto non si leggono dal DB
  per mostrare un elenco.

Nello stesso lavoro, due correzioni valide anche per l'estratto conto: timeout
di 90 s per chiamata a Gemini e limite di 5 minuti al task (prima una chiamata
appesa lasciava l'import "in lettura" per sempre), 504 fra gli errori da
riprovare, e "Riprova" anche per un import fermo in lettura da oltre 10 minuti
(worker riavviato da un deploy).

## Scartato

- **App o modello separati per lo scontrino**: duplicherebbero revisione,
  doppioni, categorie e commit.
- **Fotocamera in pagina con `getUserMedia`**: più codice e permessi del
  browser per un risultato peggiore della fotocamera nativa che `capture` apre
  sul telefono.
- **Tenere la foto come allegato del movimento**: non richiesto, e uno
  scontrino resta un dato personale da non conservare senza motivo.
