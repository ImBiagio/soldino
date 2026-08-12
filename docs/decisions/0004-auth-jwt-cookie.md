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
