# 0020 — Nomi delle categorie tradotti, con Gemini

Data: 2026-11-06 · Stato: accettata

## Contesto

Con l'ADR 0016 l'interfaccia parla italiano e inglese, ma le categorie sono
dati: i nomi di default erano in inglese per tutti ("Supermarket", "Eating
out") e quelli scritti da un utente restavano nella sua lingua. In italiano
si leggeva "Supermarket", in inglese "Spesa casa". Il gettext non serve:
traduce testi fissi del codice, non dati che cambiano per tracker.

## Decisione

**`Category.name_translations`** (JSON, `{"it": ..., "en": ...}`) accanto a
`name`. `name` resta il nome com'e' stato scritto: e' quello del vincolo di
unicita' e quello che vedono i prompt di Gemini. L'API restituisce come
`name` la traduzione nella lingua della richiesta (`LocaleMiddleware`), e lo
stesso fanno `category_name` dei movimenti e il `by_category` dei grafici;
finche' manca, il nome scritto.

**Chi traduce.** Le 13 categorie di default nascono gia' tradotte con un
dizionario fisso (`DEFAULT_CATEGORY_NAMES` in `apps/trackers/translate.py`;
la migrazione `trackers.0011` le ha riempite sui tracker esistenti). Per le
altre il task Celery `translate_categories` chiede a Gemini le lingue che
mancano, in un'unica chiamata a blocchi di 50, con nome, tipo e descrizione
come contesto. Le lingue gia' presenti non si sovrascrivono mai.

**Quando.** Dopo il commit di ogni creazione o cambio di nome, nel worker; in
piu' ogni ora (beat `translate-categories`, al minuto 20) su quelle rimaste
indietro: Gemini giu', chiave assente, categorie create prima di questa
modifica. Senza nulla da tradurre il giro non chiama Gemini.

**Modifiche dal form.** Il form mostra il nome tradotto e lo rimanda: se e'
uguale a quello mostrato, nome e traduzioni non cambiano (si e' toccato solo
il colore, l'icona, ...). Se cambia, il nuovo nome vale per la lingua di chi
scrive e le altre si rifanno.

## Alternative scartate

- **Tradurre al volo a ogni lettura**: una chiamata a Gemini per pagina, lenta
  e a pagamento, per nomi che cambiano di rado.
- **Due colonne `name_it` / `name_en`**: una terza lingua vorrebbe una
  migrazione; il JSON no (il prompt e lo schema di risposta invece si', vedi
  `translate_category_names`).
- **Chiedere all'utente il nome in entrambe le lingue**: piu' attrito proprio
  dove si crea una categoria al volo.
