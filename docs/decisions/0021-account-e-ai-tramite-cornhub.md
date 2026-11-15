# 0021 — Account unico e AI tramite cornhub

Data: 2026-11-15 · Stato: accettata · Supera: login e mail dell'account di
ADR 0004 e 0012, chiave e modelli Gemini di ADR 0008, 0014, 0015 e 0020

## Contesto

Le app della suite (soldino, regalino, languorino, cinemino, templatino)
avevano ognuna login, registrazione, password, conferma email e chiavi AI
proprie: quattro copie dello stesso codice, quattro password per persona e
una chiave Gemini per app. Ora l'account vive su **cornhub**
(https://cornhub.it, repo cornhub), che e' un provider OpenID Connect
(django-oauth-toolkit) e un gateway AI. Il modello e' quello di templatino
(ADR 0002 del template).

## Decisione

### Login

1. Il frontend senza sessione va su `/accedi?next=<percorso>`, che manda (al
   massimo una volta ogni 30 secondi, per non girare in tondo se la sessione
   non parte) a `/api/auth/sso/start?next=<percorso>`.
2. Il backend crea state, nonce e PKCE (S256), li mette in un cookie firmato
   httpOnly (`soldino_refresh_sso_login`, 10 minuti, path `/api/auth/sso`) e
   rimanda a `CORNHUB_URL/o/authorize/`.
3. cornhub fa entrare l'utente (o lo fa registrare) e torna su
   `/api/auth/sso/callback?code&state` (`API_PUBLIC_URL`).
4. Il backend controlla lo state, scambia il codice sulla rete interna Docker
   (`CORNHUB_INTERNAL_URL/o/token/`, client confidenziale + verificatore
   PKCE), verifica l'id_token (RS256, JWKS di cornhub, `iss`, `aud`, `exp`,
   `nonce`) e trova l'utente: per `User.cornhub_sub`, poi per email **solo se
   cornhub la dichiara verificata** (cosi' gli account di prima si agganciano
   con tutti i loro tracker), altrimenti lo crea senza password. Nome, email e
   lingua si aggiornano a ogni login.
5. Da li' la sessione e' quella di ADR 0004 (refresh nel cookie httpOnly). A
   ogni refresh si chiede a cornhub `GET /internal/users/<sub>` (cache 2
   minuti): account spento o senza Soldino = sessione chiusa e refresh in
   blacklist. Se cornhub non risponde si lascia passare.
6. Logout: blacklist del refresh, poi il `logout_url` di cornhub, che chiede
   se uscire anche dall'account della suite.

Spariscono registrazione, `SIGNUP_CODE`, conferma email, reset e cambio
password, con le loro pagine e mail. Restano gli **inviti ai tracker**
(`/inviti/<token>`, anteprima pubblica): chi non e' dentro entra con cornhub e
torna sull'invito; chi non ha un account lo crea su cornhub
(`register_url` di `GET /api/auth/config`, in un'altra scheda perche' la
registrazione di cornhub non riporta indietro) e poi torna ad accedere.

Il profilo (`/account`) tiene lingua e ordine del menu (`User.nav_order`);
nome ed email sono in sola lettura con i link all'account e alle chiavi AI
su cornhub. Gli utenti di prima si portano su cornhub con
`manage.py export_cornhub_users` (JSON con l'hash della password).

### AI

Mai chiamare un provider dall'app: ogni lettura passa da `_generate()` in
`apps/ingestion/services/ai.py`, che chiama `cornhub.generate(feature, parti,
SchemaPydantic, user=...)`. Le funzioni nel listino di cornhub
(`backend/apps/ai/features.py`, app `soldino`):

| Funzione | Livello | Chi la chiede (`user`) |
|---|---|---|
| `statement` — estratto conto PDF | **grande** (chiave dell'utente) | chi carica il PDF |
| `receipt` — scontrino da foto | piccola (`fast`) | chi fotografa |
| `voice` — movimento a voce | piccola (`fast`) | chi detta |
| `categories` — categorie delle righe della banca | piccola | chi ha collegato la banca |
| `translate` — nomi delle categorie | piccola | chi scrive il nome; nel giro orario il proprietario del tracker |

Accanto al bottone dello scan dell'estratto conto il frontend mostra
`<AiCost feature="statement" />`: chi paga e la stima, o perche' non si puo'
con il link a cornhub. Un `cornhub.AIError` diventa `ExtractionError` col
messaggio di cornhub, salvato sull'import insieme al codice
(`StatementImport.error_code`): con `needs_key`, `limit` e `house_empty` la
revisione mostra il link alle chiavi AI. I ripieghi su altri modelli o
provider li fa cornhub: spariscono `GEMINI_*`, `google-genai` e la fila dei
modelli in cache di ADR 0008.

**Pannocchie e bottoni con la chiave** (`frontend/src/components/Ai.tsx`):
`<CornCounter />` mostra le pannocchie 🌽 rimaste oggi (quota della chiave
di casa per le funzioni piccole) e porta alla pagina AI di cornhub; sta in
fondo al rail su desktop e in una striscia in alto su mobile, anche fuori
dai tracker (lista, account: `PlainLayout`, stessa posizione), e legge
`GET /api/ai/wallet` (`cornhub.wallet()`, `{}` se cornhub e' giu': il
contatore sparisce). Si aggiorna ogni minuto e subito quando una lettura AI
finisce (`useRefreshAi()` dentro `useOpenStatements`, che sta nel layout). Il
bottone della funzione grande `statement` ("Leggi l'estratto conto") ha il
simbolo della chiave (`<AiKeyIcon />`) ed e' spento finche' l'utente non ha
una chiave adatta (`useAiGate('statement')`, `allowed` della stima); accanto
`<AiCost>` dice perche' e porta a cornhub. Scontrini e vocali (piccole)
restano liberi anche se usano lo stesso upload.

### Errori

Backend, worker e beat a GlitchTip con `SENTRY_DSN` (`config/sentry.py`, dev e
prod); il frontend con `@sentry/react` e `VITE_SENTRY_DSN` passata alla build
dell'immagine web (variabile del repo `SENTRY_DSN_FRONTEND`).

## Conseguenze

**Perche':** un account e una password per tutta la suite; chiavi API in un
solo posto, cifrate, che l'app non vede mai; limiti di spesa veri, calcolati
sui token dichiarati dai provider.

**Costo accettato:** cornhub e' un punto unico. Se e' giu' non si entra (le
sessioni gia' aperte continuano) e scan, scontrino, voce, categorie e
traduzioni si fermano: l'import resta "non riuscito" e riprovabile, le
traduzioni le rifa il giro orario. In produzione backend, worker e beat stanno
sulla rete Docker esterna `cornhub`.

**Quando rivederla:** se Soldino deve funzionare da solo, fuori dalla suite.
