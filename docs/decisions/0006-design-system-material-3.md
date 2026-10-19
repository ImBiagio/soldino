# 0006 — Material 3 Expressive come design system

L'interfaccia segue l'handoff "Soldino — redesign Material 3 Expressive":
palette tonale dal seed `#1b6c2f`, forme grandi (28px sui pannelli, 20px sui
campi), un solo accento pieno, tipografia espressiva sui numeri.

## Dove vivono i token

Custom properties in `src/index.css`, mappate in `tailwind.config.js` sui **nomi
di ruolo** M3 e non sulle tinte. Nel markup si scrive `bg-surface-container`:
cambiare palette è cambiare venti righe di CSS, non cercare hex nei componenti.

## Solo tema chiaro

Il design non definisce una variante scura, quindi `color-scheme: light` è
fissato. Aggiungerla in seguito significa ridefinire i token dentro un
`@media (prefers-color-scheme: dark)`, non toccare i componenti.

## Conferme dentro l'app (2026-10-19)

Nessun `window.confirm` / `alert`: le conferme passano da `useConfirm()`
(`components/ConfirmDialog.tsx`), un basic dialog M3 centrato anche su mobile
(icona, titolo, testo, "Annulla" + azione; rossa se toglie qualcosa), sopra le
modali (z-70), Esc e tocco sullo scrim annullano. Così sono tradotte e hanno
lo stile dell'app. Unica eccezione: il `beforeunload` alla chiusura della
scheda, che il browser non lascia personalizzare.

## Colori e icone delle categorie sono dati

`Category.color` e `Category.icon` arrivano dall'API. Il client ha solo
un'euristica di fallback per le categorie create prima che il campo esistesse.
I default lato backend usano la palette dell'app.

## Cosa non è stato replicato dal design, e perché

- **Tasto di dettatura** nel tastierino mobile: senza un riconoscimento vocale
  vero sarebbe un bottone finto.
- **Inbox delle proposte ricorrenti**: l'elenco e l'approvazione ci sono, ma
  poggiano su due chiamate non atomiche e su una copia di
  `RecurringRule.advance()` in `lib/recurrence.ts`. Il design stesso indica
  questo come ripiego in attesa dell'endpoint dedicato.
- **Riconciliazione nella lista tracker**: c'è, al prezzo di una richiesta per
  riga. Va spostata nel serializer della lista quando i tracker aumenteranno.
