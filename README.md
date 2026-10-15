# Soldino

Expense tracker collaborativo: due o più persone su un tracker condiviso, ognuno
registra le sue spese, l'app calcola chi deve cosa a chi. Nasce per sostituire
`Expense_Tracker_2026.xlsx`.

Django + DRF + Postgres + Celery/Redis + React (Vite), tutto in Docker Compose.

---

## Avvio

```bash
cp .env.example .env && docker compose up --build
```

| | |
|---|---|
| App | http://localhost:5173 |
| API | http://localhost:8000/api |
| Docs OpenAPI | http://localhost:8000/api/docs/ |
| Admin Django | http://localhost:8000/admin/ |

Con `.env.example` la verifica email è disattivata (`REQUIRE_EMAIL_VERIFICATION=0`),
quindi ci si registra ed entra subito. Le mail (verifica, inviti) finiscono nella
console del backend: `docker compose logs -f backend`.

Il codice è montato come volume: hot reload attivo su backend e frontend.

> **Dopo aver generato nuove migrazioni, ricostruisci l'immagine:**
> `docker compose build backend`. In sviluppo il bind mount le rende comunque
> visibili, ma l'immagine no — e in produzione non c'è mount, quindi `migrate`
> allo startup fallirebbe con `Dependency on app with no migrations`. Sintomo
> lato browser: **"Failed to fetch"**, cioè l'API non risponde affatto.

### ⚠️ Avvia sempre con entrambi i file compose

`docker-compose.override.yml` è quello che monta il codice come volume. La CLI lo
carica da sola, ma **solo se non passi `-f`**: `docker compose -f docker-compose.yml up`
lo salta e i container girano sul codice congelato dentro l'immagine — niente
hot reload, e modifiche che sembrano non avere effetto.

Vale anche per gli IDE: la run configuration Docker Compose di PyCharm punta a
un file solo. Va aggiunto anche `docker-compose.override.yml` (Run → Edit
Configurations → Compose → Compose files).

Se qualcosa non si aggiorna, la diagnosi è una sola riga — se non stampa nulla,
il mount non c'è:

```bash
docker inspect soldino-frontend-1 --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```

e si rimedia con:

```bash
docker compose up -d --force-recreate
```

---

## I servizi, e perché ci sono

| Servizio | Cosa fa |
|---|---|
| `db` | Postgres 16. `pg_trgm` e `unaccent` abilitate da migration |
| `redis` | Coda dei task Celery (db 1) e cache Django (db 0) |
| `backend` | Django + DRF |
| `worker` | Esegue i task Celery |
| `beat` | Scheduler: accoda i task ricorrenti a orario |
| `frontend` | Vite in dev, build statica servita da nginx in prod |

**Perché Redis.** Fa due lavori, nessuno dei due sostituibile da Postgres senza
fatica: è la **coda** da cui il `worker` prende i task (lo scan con Gemini, il
job notturno delle ricorrenze) ed è la **cache** dove DRF tiene i contatori del
rate limit (login, registrazione, upload dello scan), che devono essere
condivisi fra i processi gunicorn e veloci. Non fa da result backend: il valore
di ritorno dei task non lo legge nessuno, lo stato dello scan sta nel DB
(`CELERY_TASK_IGNORE_RESULT`).

**Redis, worker e beat sono tre pezzi della stessa cosa:** far girare codice
fuori dal ciclo richiesta/risposta. Django scrive in coda su Redis "esegui il
task X" e risponde subito; il `worker` lo prende ed esegue per conto suo; `beat`
è la sveglia che accoda i task a orario (non li esegue: accoda soltanto, per
questo servono due processi distinti).

**Lo Scan dell'estratto conto** gira nel `worker` (`scan_statement`): la lettura
con Gemini richiede 10–30 secondi e non può stare dentro una richiesta.

**Il beat ha due job**: `materialize_due_rules` alle 3:00, che
scrive le occorrenze scadute delle ricorrenze con `auto_commit`, e
`flush_expired_tokens` alle 4:00, che pulisce la blacklist dei refresh token. Le altre
restano proposte finché qualcuno non le approva o le salta dalla UI. Sono qui da subito perché
il piano li vuole in compose dall'inizio (§1.2) e perché la fase 3 li rende
indispensabili: lo Scan di un estratto conto (estrazione testo → OCR → chiamata
LLM) è decine di secondi e non può stare dentro una view.

---

## Autenticazione

Custom `User` con **email come username**. Ibrido JWT:

- **access token** (15 min) in memoria JS, inviato in `Authorization: Bearer`
- **refresh token** (14 giorni) in cookie `httpOnly`, `SameSite=Lax`,
  `path=/api/auth`, ruotato a ogni refresh

La credenziale che dura a lungo sta dove il JavaScript non arriva (un XSS non la
può esfiltrare), quella che gira su ogni richiesta sta dove il CSRF non arriva
(header esplicito, nessun automatismo del browser). Mai `localStorage`.

Il costo accettato è che un access token **non è revocabile** prima della
scadenza — da cui i 15 minuti. Il refresh invece sì: il **logout** mette in
blacklist quello del cookie e il **cambio password** chiude tutte le altre
sessioni (la corrente riceve un refresh nuovo). Il refresh si legge solo dal
cookie, mai dal body. La rotazione non blacklista il token vecchio: due schede
che rinnovano insieme si butterebbero fuori a vicenda.

Login, registrazione e verifica email hanno un **rate limit** (10/min per IP,
`THROTTLE_AUTH`), il refresh 60/min, l'upload dello scan 20/ora
(`THROTTLE_SCAN`, ogni upload è una chiamata a Gemini). Il link di verifica
email fa entrare senza password, quindi vale **una volta sola**.

Ruoli: solo il proprietario modifica il tracker (nome, valuta, impostazioni),
lo archivia o lo elimina; non si può invitare né promuovere un secondo
proprietario. In produzione `prod.py` rifiuta di partire con la
`DJANGO_SECRET_KEY` di default, Swagger è visibile solo allo staff loggato
nell'admin e Postgres non espone porte (la `5433` sta solo nell'override di
sviluppo). Verifica email e inviti usano token firmati
stateless (`django.core.signing`), senza tabelle da mantenere.

> **Nota:** cinemino usa session + CSRF, non JWT. La divergenza è deliberata,
> vedi [ADR 0004](docs/decisions/0004-auth-jwt-cookie.md).

> **In sviluppo** `CORS_ALLOW_ALL_ORIGINS` è attivo insieme a
> `CORS_ALLOW_CREDENTIALS`: qualsiasi origine può leggere le risposte dell'API.
> In produzione vale la lista esplicita da `DJANGO_CSRF_TRUSTED_ORIGINS`.

---

## Interfaccia

Material 3 Expressive, palette tonale generata dal seed `#1b6c2f`. I token
stanno come custom properties in `src/index.css` e Tailwind li mappa sui nomi di
ruolo M3 (`bg-surface-container`, `text-on-primary`), così nel markup non
compaiono hex. Roboto Flex per il testo, **Roboto Mono per ogni importo**,
Material Symbols Rounded per le icone.

Navigation rail su desktop, bottom bar con FAB sotto i 768px. La palette è solo
chiara: il design non definisce una variante scura.

I colori e le icone delle categorie sono **dati** (`Category.color`,
`Category.icon`), non scelte del client: la UI li legge dall'API.

> I font arrivano da Google Fonts via `<link>`. In produzione conviene
> self-hostarli e servire un subset del font delle icone.

## I principi che reggono il modello

Sono le decisioni che costano care se prese dopo. Ognuna vive in un punto preciso:

| Principio | Dove |
|---|---|
| Una sola tabella per spese ed entrate, `amount` sempre positivo | `Transaction.type` + `CheckConstraint` |
| `Decimal(12,2)` ovunque, mai `float` | `apps/core/money.py` |
| `DateField` per la data del movimento | `Transaction.date` — nel foglio gli orari fantasma spostavano le spese di mese |
| "Coppia" non è un utente | `TransactionSplit`, uno per persona |
| I saldi si calcolano, non si memorizzano | `services/debts.py` |
| Ogni scrittura da fonte esterna passa da approvazione | `RecurringRule.auto_commit` |
| Soft delete + audit | `apps/core/models.BaseModel` + `django-simple-history` |
| Isolamento per tracker con un mixin, non a mano | `apps/core/scoping.py` |

### La ripartizione a centesimi

Il pezzo più delicato. `allocate()` divide in centesimi interi e assegna il resto
col metodo del resto maggiore, tie-break deterministico sull'indice: la somma
delle quote è **esattamente** il totale, sempre. Arrotondare ogni riga
separatamente perde o crea centesimi, e un centesimo perso rompe l'invariante.

Lo stesso algoritmo è replicato in `frontend/src/lib/money.ts` (in `BigInt`,
così anche l'ordine dei resti coincide col `Decimal`) perché l'anteprima del
widget di split non deve mai divergere dal risultato salvato — 100,01 € al
50/50 mostra 50,01 / 50,00 e salva 50,01 / 50,00.

L'API accetta **pesi** (70/70 è lecito, fra 0 e 100) ma `share_pct` salva la
percentuale effettiva; la verità contabile resta `share_amount`. Le percentuali
a due decimali non bastano a ricostruire gli importi (333,33 su 1000 è 33,33%,
che riapplicato dà 333,30): per questo se cambia l'importo il backend
riproporziona sugli importi salvati, e il form riapre a importi esatti un
movimento che le percentuali non riproducono.

### Chi deve cosa: semplificato o per coppia

`Tracker.simplify_debts` (Setup, solo proprietario, acceso di default) decide
come si propongono i bonifici. Acceso: dal saldo netto di ciascuno, col minor
numero di bonifici anche fra persone senza spese in comune (Anna paga per
Bruno, Bruno per Carla → Carla dà i soldi ad Anna). Spento: ognuno restituisce
a chi ha pagato per lui, al netto di cosa gli deve l'altro e dei pareggi fra i
due. In due persone coincidono; in ogni caso ognuno arriva allo stesso saldo
netto. Vedi [ADR 0009](docs/decisions/0009-semplifica-debiti.md).

### La riconciliazione

```
atteso = saldo iniziale + entrate incassate − spese pagate ± pareggi
reale  = conti + in attesa (BTA, anche negativo)
delta  = reale − atteso
```

Per persona e per **cassa**: contano le spese che uno ha pagato e le entrate che
ha incassato, non le quote (una cena da 100 divisa a metà toglie 100 dal conto
di chi paga; l'altra metà è un credito che rientra col pareggio). Il saldo
iniziale e la data da cui contare stanno sul membro. Il totale del tracker è la
somma delle persone. Vedi [ADR 0007](docs/decisions/0007-riconciliazione-per-persona.md).

È la funzione più preziosa del foglio, quindi ha un endpoint suo e sta in cima
alla dashboard (globale e per persona) e nella tab Conti.

---

## Struttura

Le funzioni generiche che servivano in più punti stanno in un `methods.py`
per app: `core/methods.py` (email normalizzate, token firmati, mail di
servizio, somme di importi, validatori), `trackers/methods.py` (chi è membro
attivo di un tracker), `transactions/methods.py` (`create_transaction`, l'unico
modo di scrivere un movimento con i suoi split, usato da form, BTA e
ricorrenze). La logica di dominio resta nei `services/`. Nel frontend lo stesso
ruolo lo fanno `lib/money.ts` (`normalizeDecimal`, `formatCents`) e gli helper
`useSaveResource` / `useDeleteResource` di `api/hooks.ts`.

```
backend/
├── config/settings/     base · dev · prod · test
└── apps/
    ├── core/            BaseModel, money.py, methods.py, scoping, permessi, normalize
    ├── users/           User custom + auth JWT
    ├── trackers/        Tracker, Membership, Category, inviti
    ├── accounts/        Account, PendingItem (il foglio BTA)
    ├── transactions/    Transaction, TransactionSplit, Settlement
    │   └── services/    debts · splits · reports
    ├── recurring/       RecurringRule + task Celery
    └── ingestion/       import e scan (fasi 2-3, vuoto)
frontend/src/
├── api/                 hook TanStack Query
├── lib/                 client HTTP, auth, money, format, tipi
├── components/          UI + SplitWidget
└── features/            per dominio: auth, trackers, transactions, dashboard…
docs/decisions/          ADR
```

---

## Comandi

Test del backend:

```bash
docker compose run --rm --no-deps -e DJANGO_SETTINGS_MODULE=config.settings.test backend pytest
```

Lint del backend:

```bash
docker compose run --rm --no-deps backend ruff check apps config
```

Typecheck del frontend:

```bash
docker compose run --rm --no-deps frontend npx tsc -b
```

Superuser per l'admin:

```bash
docker compose run --rm --no-deps backend python manage.py createsuperuser
```

Rigenerare il client tipizzato dallo schema OpenAPI:

```bash
docker compose run --rm --no-deps frontend npm run api:generate
```

---

## Invarianti verificate dai test

144 test, `pytest` + `factory-boy` + `hypothesis`. Coverage 100% su
`apps/core/money.py`.

- `Σ split.share_amount == transaction.amount`, sempre — vincolo applicativo in
  `Transaction.validate_splits()`, più property test sulla ripartizione
- `Σ net == 0` su ogni tracker — property test Hypothesis su scenari misti
- Con i debiti semplificati o per coppia, ognuno riceve o dà esattamente il
  proprio `net` (property test a tre persone)
- Logout e cambio password revocano il refresh, il login ha un rate limit, il
  link di verifica vale una volta, conversioni BTA e ricorrenze non puntano a
  persone, categorie o conti di altri tracker (`apps/core/tests/test_security.py`)
- Nessun endpoint restituisce dati di tracker altrui —
  `apps/trackers/tests/test_isolation.py` copre collezioni annidate, ruoli,
  inviti pendenti, split verso non membri, categorie di altri tracker
- Un `Settlement` azzera i debiti senza comparire nelle statistiche per categoria
- Un possibile duplicato viene **segnalato, non bloccato**: nel foglio esistono
  righe legittimamente identiche
- Modificare un movimento senza toccare gli split non sposta centesimi;
  cambiarne l'importo riproporziona sugli importi, non sulle percentuali
- Una ricorrenza senza `auto_commit` non avanza da sola, e un doppio "Approva"
  non scrive due volte (`apps/recurring/tests/`)

---

## Stato

**Fase 0 — completa.** Compose con tutti e sei i servizi, settings per ambiente,
estensioni Postgres, pre-commit, schema OpenAPI.

**Fase 1 — completa.** Tutti gli endpoint del piano (§2.3) e tutte e sette le
schermate (§2.6): login/registrazione/invito, lista tracker, lista movimenti con
filtri persistiti in URL e modifica inline di importo e categoria, form con
widget di split a quattro modalità, dashboard, impostazioni, BTA.

**Ciclo di vita del tracker** (Setup, solo proprietario): archivia e ripristina
(`POST /trackers/{id}/archive` · `/unarchive`): l'archiviato resta consultabile,
finisce nel gruppo "Archiviati" della lista e non riceve ricorrenze automatiche.
Elimina (`DELETE /trackers/{id}`, conferma scrivendo il nome) è un soft delete
che porta giù anche le membership, perché le rotte annidate controllano quelle.

**Dashboard per persona** (`?vista=<id>`, di default la propria) e globale
(`?vista=tutti`): chi deve cosa, mese, categorie e riconciliazione seguono la
vista. **Conti** (`/t/:id/conti`): conti raggruppati per persona, saldo
iniziale e confronto atteso/reale di ciascuno.

**Scan estratto conto** (`/t/:id/scan`, [ADR 0008](docs/decisions/0008-scan-estratto-conto.md)).
Si carica il PDF, un task Celery lo fa leggere a Gemini (`GEMINI_API_KEY`,
`GEMINI_MODEL` nel `.env`) e le righe finiscono in una bozza da rivedere in
tabella: data, titolo, importo, tipo, categoria, chi paga, divisione; si
eliminano e aggiungono righe. Solo "Registra" le scrive nei movimenti
(`source=scan`). La categoria viene prima dallo storico dell'esercente, poi da
Gemini che legge le **descrizioni** delle categorie. I possibili doppioni sono
segnalati. Il PDF si cancella appena letto.

**Andamento dei soldi** (`GET /trackers/{id}/balance-history?date_from&date_to&user_id`):
il saldo per cassa giorno per giorno, come la riconciliazione. In Grafici è una
curva che si ferma a oggi, col punto "oggi sui conti" per vedere lo scarto; in
dashboard la riconciliazione è un grafico a cascata (saldo iniziale → entrate →
uscite → atteso → scarto → reale).

**Grafici** (`/t/:id/grafici`). Entrate e
uscite degli ultimi 12 mesi, ripartizione per categoria e per persona, filtri
per periodo (mese, trimestre, anno, date libere), persona e categoria, tutti
nell'URL. Con una persona selezionata ogni totale è la sua **quota** dagli split,
non l'importo pieno: `GET /trackers/{id}/summary?user_id=…&date_from=…&date_to=…&category=…`.
Entrate e uscite usano solo `primary` ed `error`, con legenda e tabella: la
coppia verde/rosso regge ai daltonici solo con un secondo indizio.

**Fase 2 — parziale.** `RecurringRule` con costo mensilizzato e annualizzato,
task beat giornaliero, vista Ricorrenze con divisione fra i membri. Con
`auto_commit=False` la ricorrenza propone soltanto: `POST …/recurring-rules/{id}/approve`
e `…/skip` gestiscono la proposta in una sola transazione.

### Cosa manca

- **Import del foglio (§3.1).** `Expense_Tracker_2026.xlsx` non è nel repo, e il
  criterio di accettazione della fase 2 è "i numeri coincidono col foglio":
  senza i dati veri non è verificabile. `POST /transactions/bulk` è già il punto
  di atterraggio dell'import.
- **Togliere le città dal normalizzatore merchant.** Serve un gazetteer, si fa in
  fase 2 sui dati veri. Vedi [ADR 0005](docs/decisions/0005-normalizzatore-merchant.md).
- **Fasi 3-5.** Scope non toccato, come da piano.
