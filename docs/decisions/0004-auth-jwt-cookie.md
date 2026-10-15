# 0004 — Auth: SimpleJWT con refresh in cookie httpOnly

Custom `User` con email come `USERNAME_FIELD`. Access token (15 min) in memoria
nel frontend e inviato in `Authorization: Bearer`; refresh token (14 giorni) in
cookie `httpOnly`, `SameSite=Lax`, `path=/api/auth`, ruotato a ogni refresh.

## Perché ibrido e non tutto in cookie o tutto in memoria

- Access token in cookie → il browser lo allegherebbe da solo a ogni richiesta,
  anche a quelle originate da altri siti: servirebbe la difesa CSRF.
- Refresh token in memoria → un refresh della pagina sloggherebbe l'utente.

Quindi: la credenziale che dura a lungo sta dove il JavaScript non arriva
(`httpOnly`, quindi non esfiltrabile da un XSS), quella che gira su ogni
richiesta sta dove il CSRF non arriva (header esplicito, nessun automatismo del
browser). `SameSite=Lax` impedisce al cookie di refresh di essere allegato a una
POST cross-site, che è la forma dell'attacco CSRF.

## Costo accettato

JWT è stateless: un access token **non è revocabile** prima della scadenza.
Bannare un utente lo lascia operativo per al massimo 15 minuti. È il motivo per
cui `ACCESS_TOKEN_LIFETIME` è corto. Se in futuro servisse la revoca immediata
(logout da tutti i dispositivi, ban), la strada è la blacklist di SimpleJWT, che
però reintroduce lo stato lato server.

## Divergenza deliberata da cinemino

Il piano (§1.3) chiedeva di allinearsi a `cinemino`. Verificato sul repo locale:
cinemino usa **session + cookie con token CSRF** (`SessionAuthentication`,
`CSRF_TRUSTED_ORIGINS`, header `X-CSRFToken`), `AbstractUser` con `username`
mantenuto come display name, e throttling DRF per scope.

Soldino resta su JWT: scelta confermata esplicitamente. La conseguenza pratica è
che il codice di autenticazione dei due progetti non è trasferibile —
`apps/users` e `frontend/src/lib/auth.tsx` non hanno un equivalente in cinemino
e viceversa. Tutto il resto del backend non dipende da questa scelta.

Da cinemino resta invece preso il pattern dei **token firmati stateless**
(`django.core.signing` con salt dedicato e `max_age`) per verifica email e
inviti, invece di una tabella di token: vedi `apps/users/tokens.py` e
`apps/trackers/invites.py`.

## Aggiornamento 2026-10-15: revoca e rate limit

Attivata la blacklist di SimpleJWT (`token_blacklist`). Il logout blacklista il
refresh del cookie, il cambio password tutti quelli emessi per l'utente (la
sessione corrente ne riceve uno nuovo). `BLACKLIST_AFTER_ROTATION` resta
`False`: blacklistare il token ruotato farebbe uscire una delle due schede che
rinnovano nello stesso momento. Il refresh si accetta solo dal cookie.

Rate limit con `ScopedRateThrottle` (contatori nella cache Redis) su login,
registrazione, verifica email (`auth`), refresh (`refresh`) e upload dello scan
(`scan`). Il link di verifica email non autentica piu' un utente gia'
verificato: prima era un link di accesso senza password valido tre giorni.

## Aggiornamento 2026-10-15: reload che slogga

Sintomo: a volte un reload portava su `/accedi`, con due `POST /api/auth/refresh`
in parallelo e tutti e due `401 Utente non valido`. Causa: due stack di sviluppo
sulla stessa macchina (`:5173/:8000` e un worktree su `:5174/:8001`) usavano lo
stesso cookie `soldino_refresh`. I cookie non distinguono le porte, quindi il
login su uno stack sovrascriveva il cookie dell'altro. Con la stessa
`DJANGO_SECRET_KEY` il token straniero passava la firma e si fermava solo
sull'utente, che nell'altro DB non esiste. I refresh doppi non c'entravano: con
`BLACKLIST_AFTER_ROTATION=False` passano entrambi, ed è coperto da un test.

Decisione: il nome del cookie diventa configurabile (`REFRESH_COOKIE_NAME`,
default `soldino_refresh`) e ogni stack in più ne usa uno suo. Il frontend tiene
un solo refresh in volo, così il doppio effetto di StrictMode e le query che
prendono 401 insieme non ruotano il cookie una volta a testa.
