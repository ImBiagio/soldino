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

---

## I servizi, e perché ci sono

| Servizio | Cosa fa |
|---|---|
| `db` | Postgres 16. `pg_trgm` e `unaccent` abilitate da migration |
| `redis` | Coda dei task Celery, backend dei risultati, cache Django |
| `backend` | Django + DRF |
| `worker` | Esegue i task Celery |
| `beat` | Scheduler: accoda i task ricorrenti a orario |
| `frontend` | Vite in dev, build statica servita da nginx in prod |

**Redis, worker e beat sono tre pezzi della stessa cosa:** far girare codice
fuori dal ciclo richiesta/risposta. Django scrive in coda su Redis "esegui il
task X" e risponde subito; il `worker` lo prende ed esegue per conto suo; `beat`
è la sveglia che accoda i task a orario (non li esegue: accoda soltanto, per
questo servono due processi distinti).

**Oggi fanno poco** — un solo job, `materialize_due_rules` alle 3:00, che
materializza le occorrenze delle ricorrenze scadute. Sono qui da subito perché
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
scadenza — da cui i 15 minuti. Verifica email e inviti usano token firmati
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

Lo stesso algoritmo è replicato in `frontend/src/lib/money.ts` perché
l'anteprima del widget di split non deve mai divergere dal risultato salvato —
100,01 € al 50/50 mostra 50,01 / 50,00 e salva 50,01 / 50,00.

### La riconciliazione

```
saldo conti + in attesa (BTA) = disponibile
disponibile − saldo dalle transazioni = delta
```

È la funzione più preziosa del foglio, quindi ha un endpoint suo e sta in cima
alla dashboard, non sepolta in fondo.

---

## Struttura

```
backend/
├── config/settings/     base · dev · prod · test
└── apps/
    ├── core/            BaseModel, money.py, scoping, permessi, normalize
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

71 test, `pytest` + `factory-boy` + `hypothesis`. Coverage 100% su
`apps/core/money.py`.

- `Σ split.share_amount == transaction.amount`, sempre — vincolo applicativo in
  `Transaction.validate_splits()`, più property test sulla ripartizione
- `Σ net == 0` su ogni tracker — property test Hypothesis su scenari misti
- Nessun endpoint restituisce dati di tracker altrui —
  `apps/trackers/tests/test_isolation.py` copre collezioni annidate, ruoli,
  inviti pendenti, split verso non membri, categorie di altri tracker
- Un `Settlement` azzera i debiti senza comparire nelle statistiche per categoria
- Un possibile duplicato viene **segnalato, non bloccato**: nel foglio esistono
  righe legittimamente identiche

---

## Stato

**Fase 0 — completa.** Compose con tutti e sei i servizi, settings per ambiente,
estensioni Postgres, pre-commit, schema OpenAPI.

**Fase 1 — completa.** Tutti gli endpoint del piano (§2.3) e tutte e sette le
schermate (§2.6): login/registrazione/invito, lista tracker, lista movimenti con
filtri persistiti in URL e modifica inline di importo e categoria, form con
widget di split a quattro modalità, dashboard, impostazioni, BTA.

**Fase 2 — parziale.** `RecurringRule` con costo mensilizzato e annualizzato,
task beat giornaliero, vista Abbonamenti. Con `auto_commit=False` la ricorrenza
propone soltanto.

### Cosa manca

- **Import del foglio (§3.1).** `Expense_Tracker_2026.xlsx` non è nel repo, e il
  criterio di accettazione della fase 2 è "i numeri coincidono col foglio":
  senza i dati veri non è verificabile. `POST /transactions/bulk` è già il punto
  di atterraggio dell'import.
- **Togliere le città dal normalizzatore merchant.** Serve un gazetteer, si fa in
  fase 2 sui dati veri. Vedi [ADR 0005](docs/decisions/0005-normalizzatore-merchant.md).
- **Endpoint di approvazione delle ricorrenze.** L'interfaccia elenca e approva
  le proposte, ma lo fa con due chiamate non atomiche e replicando
  `RecurringRule.advance()` in `frontend/src/lib/recurrence.ts`. Serve
  `GET /trackers/{id}/recurring/pending` + `POST …/{occurrence}/approve`:
  quando ci sarà, quel file va cancellato.
- **Fasi 3-5.** Scope non toccato, come da piano.
