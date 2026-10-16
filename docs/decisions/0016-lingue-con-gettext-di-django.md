# 0016 — Lingue: italiano e inglese con il gettext di Django, anche nel frontend

Data: 2026-10-16 · Stato: accettata

## Contesto

L'interfaccia era tutta in italiano, scritta direttamente nel markup React e
nei messaggi d'errore dell'API. Serve anche l'inglese, con un selettore, e le
mail (conferma, reset, inviti) devono partire nella lingua di chi le riceve.
Le stringhe stanno quasi tutte nel frontend (una SPA Vite), una parte nel
backend. Il vincolo dato: usare lo standard di Django.

## Decisione

**Un solo formato di traduzione: i `.po` di Django.** L'italiano resta la
lingua sorgente (i msgid sono le frasi italiane di oggi), l'inglese sta in
`backend/locale/en/LC_MESSAGES/`:

- `django.po` — backend: messaggi dell'API, errori di validazione, mail
  (`gettext` / `gettext_lazy`, `{% translate %}` nei template).
- `djangojs.po` — frontend: estratto con `makemessages -d djangojs`. Non
  direttamente dai `.ts/.tsx`: xgettext (0.23, modalita' JavaScript) legge il
  JSX annidato in `{...}` come JS, scambia il `/` di un tag di chiusura per
  l'inizio di una regex e salta stringhe **senza avvisare**. Il frontend si
  traspila prima con esbuild (`npm run i18n:js`, gia' presente con Vite) e
  `makemessages` gira sul JS risultante, con `--no-location` perche' i numeri
  di riga sarebbero quelli del traspilato. Verificato al primo giro: tutte le
  620 stringhe passate a `gettext` nei sorgenti sono nel `.po`.

**Il frontend usa le funzioni del catalogo JavaScript di Django.**
`lib/i18n.ts` espone `gettext`, `ngettext`, `pgettext`, `npgettext`,
`interpolate` con nomi e firme di Django, cosi' xgettext le riconosce senza
configurazione. Il catalogo arriva da `GET /api/i18n/catalog`, una
sottoclasse di `JSONCatalog` (dominio `djangojs`) che aggiunge la lingua
attiva e se e' stata scelta esplicitamente. `main.tsx` carica il catalogo
**prima** di importare l'app, cosi' anche le etichette definite come costanti
di modulo si traducono. Cambiare lingua ricarica la pagina: niente stato da
ritradurre a caldo. Regola per chi scrive codice: a `gettext()` solo stringhe
letterali, i valori con `interpolate()`, mai una chiamata dentro `${...}`.

**Dove sta la lingua scelta.** Nel cookie standard `django_language`, letto da
`LocaleMiddleware` (poi `Accept-Language`, poi l'italiano). `POST
/api/i18n/language` lo scrive (CSRF non serve: l'API non usa sessioni) e, se
c'e' il login, salva anche `User.language`. Al login una scelta esplicita
fatta sulla pagina di accesso vince e si salva sul profilo; una sessione
ripresa su un altro dispositivo adotta invece la lingua del profilo. Chi si
registra nasce con la lingua attiva.

**Mail.** Si compongono nel thread della richiesta: i chiamanti fanno
`translation.override(<lingua del destinatario>)` attorno a testi e template.
Un invito a chi non ha ancora un account parte nella lingua di chi invita.

**Formati.** Date, mesi e importi passano da `Intl` con `intlLocale()`
(`it-IT` / `en-GB`: in inglese si resta su giorno/mese e sull'euro). Il
riconoscimento vocale ascolta nella lingua dell'interfaccia.

**I `.mo` sono nel repository.** In sviluppo il codice e' montato come volume
e coprirebbe dei `.mo` compilati nell'immagine; in produzione cosi' non serve
gettext. gettext e' installato solo nell'immagine `dev` per `makemessages` e
`compilemessages`. Dopo aver toccato un `.po` si ricompila e si committano
entrambi.

## Cosa resta in italiano

Prompt di Gemini e testi verso servizi esterni; `verbose_name`/`help_text`
dei modelli e le etichette delle `TextChoices` (solo admin, e cambiarle
creerebbe migrazioni); log; dati scritti dall'utente. I testi che il worker
Celery salva nel database (es. l'errore di una lettura) sono nella lingua di
default.

## Alternative scartate

- **react-i18next con JSON nel frontend**: due formati e due flussi di
  traduzione, e non e' lo standard Django richiesto.
- **Valutare la formula del plurale del catalogo**: richiede `eval`/`new
  Function`; con italiano e inglese la regola e' la stessa (1 / tutto il
  resto) ed e' scritta in `lib/i18n.ts`. Una terza lingua con plurali diversi
  dovra' rivederla.
