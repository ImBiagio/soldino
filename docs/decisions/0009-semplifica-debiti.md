# 0009 — Semplifica debiti, attivabile per tracker

Data: 2026-10-15 · Stato: accettata

## Contesto

"Chi deve cosa" proponeva sempre i bonifici calcolati dal **saldo netto** di
ciascuno (greedy creditore/debitore maggiore, `minimize_transfers`). È la
"semplificazione dei debiti" di Splitwise: se Anna ha pagato 30 per Bruno e
Bruno 30 per Carla, basta che Carla dia 30 ad Anna, e Bruno non muove niente.

In due persone non c'è differenza. In tre o più è un compromesso: meno
bonifici, ma a volte si paga qualcuno con cui non si è condiviso niente, e il
debito "di Bruno verso Anna" sparisce dalla vista. Alcuni gruppi (viaggi fra
amici) preferiscono che ognuno restituisca a chi ha pagato per lui.

## Decisione

`Tracker.simplify_debts` (default `True`, cioè il comportamento di prima),
modificabile solo dal proprietario dal Setup.

- **Acceso**: `minimize_transfers` sui saldi netti. Al massimo `n − 1` bonifici.
- **Spento**: `pairwise_debts` — per ogni coppia A, B: quote di A nelle spese
  pagate da B, meno quote di B nelle spese pagate da A, meno i pareggi fra i
  due. Un pareggio "sbagliato" (a chi non si doveva niente) diventa un credito
  in quella coppia.

`GET /trackers/{id}/balances` restituisce `simplified` e i
`suggested_transfers` calcolati nel modo scelto; `balances` (pagato, di
competenza, netto) non cambia. Tutto si calcola al volo: niente da migrare
quando si cambia impostazione.

## Invariante

In entrambi i modi, per ogni persona `ricevuto − dato == net`: i due modi
portano tutti allo stesso saldo, cambia solo chi paga chi. Property test
Hypothesis in `apps/transactions/tests/test_debts.py`.

## Scartato

- **Minimo esatto di bonifici**: è NP-difficile (partizione in sottoinsiemi a
  somma zero). Il greedy resta entro `n − 1` ed è quello che fanno anche le
  app del genere; con i 2–5 membri di un tracker la differenza è irrilevante.
- **Impostazione per utente**: i bonifici proposti devono essere gli stessi per
  tutti i membri, altrimenti Anna e Bruno vedrebbero debiti diversi.
