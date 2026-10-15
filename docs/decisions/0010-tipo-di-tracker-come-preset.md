# 0010 — Tipo di tracker come preset di interfaccia

Data: 2026-10-15 · Stato: accettata

## Contesto

Soldino nasce per il tracking **continuo** di una coppia o di una casa: conti,
voci in attesa, ricorrenze, riconciliazione col saldo reale. Lo stesso
strumento serve anche per un uso alla Splitwise: un viaggio, le cene fra
amici, una vacanza in cinque. Lì conta solo **chi deve cosa** e quanto si è
speso in tutto; conti, BTA, abbonamenti e riconciliazione sono rumore, e lo
split "solo mia" come default è sbagliato (quasi ogni spesa è divisa fra
tutti).

Due strade: un secondo tipo di oggetto con la sua logica, oppure lo stesso
tracker con un'interfaccia diversa.

## Decisione

`Tracker.kind`, scelta fra:

- `household` (default, il comportamento di sempre): tracking continuo.
- `group`: solo dividere le spese.

Il tipo è **solo un preset di interfaccia e di default**. Modello dati,
calcoli di debiti, split, summary e riconciliazione restano identici e
l'API non cambia comportamento in base al tipo: un tracker `group` ha ancora
conti, ricorrenze e riconciliazione, semplicemente il frontend non li mostra.

Per `group` il frontend:

- nasconde le sezioni **Conti**, **In attesa** e **Ricorrenze** (rail, bottom
  bar, menu), la voce **Da estratto conto** del "+" (un estratto conto è
  personale, non del gruppo) e la riconciliazione (pill e card in dashboard,
  riga nella lista dei tracker). **Grafici** resta;
- nel form del movimento propone solo le **spese** (niente selettore
  Spesa/Entrata; un'entrata già esistente si modifica come prima);
- propone lo split **"di default"** fra tutti invece di "Solo mia";
- in dashboard apre la vista **Tutti** invece della propria e mette in primo
  piano **chi deve cosa** e il **totale speso** del gruppo, al posto di
  entrate/uscite/resta.

Il backend, alla creazione di un tracker `group` senza `simplify_debts`
esplicito, lo accende (ADR 0009). Il tipo si sceglie alla creazione e si
cambia dal Setup (solo owner); cambiarlo non tocca nessun dato, quindi è
reversibile in ogni momento.

## Conseguenze

- Una sola logica contabile da testare: i test esistenti coprono anche i
  tracker `group`.
- Le rotte nascoste restano raggiungibili da URL: è voluto, non è un permesso.
  Se un tracker cambia tipo, i dati delle sezioni nascoste ricompaiono intatti.
- Ogni nuova schermata deve decidere se è visibile in `group`: la regola sta
  in un solo punto del frontend (`lib/trackerKind.ts`).

## Scartato

- **Due modelli o due app separate**: duplicherebbe split, debiti e summary
  per una differenza che è solo di presentazione.
- **Interruttori sparsi per ogni sezione** (mostra conti sì/no, mostra
  ricorrenze sì/no…): più flessibile ma più difficile da capire; il preset
  copre i due usi reali. Si potrà aggiungere dopo senza migrazioni pesanti.
- **Bloccare lato API** conti/ricorrenze nei tracker `group`: cambiare tipo
  diventerebbe distruttivo o pieno di casi limite, senza un guadagno reale.
