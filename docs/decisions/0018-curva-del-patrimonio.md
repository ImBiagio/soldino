# 0018 — La curva in Grafici segue il patrimonio, non la cassa

Data: 2026-11-02 · Stato: accettata

## Contesto

La curva "Andamento dei soldi" era per cassa, come la riconciliazione (ADR
0007): saldo iniziale + entrate incassate − spese pagate ± pareggi. Chi paga
per intero le spese di casa la vede scendere anche in un mese in cui ha
guadagnato più di quanto ha speso per sé. Caso reale, ottobre 2026: 2.253 di
entrate, 2.601 pagati, di cui 655 per la metà dell'altra persona. La curva
segnava −348 mentre il netto della persona (le quote, in alto nella stessa
pagina) era +306. Due numeri opposti sullo stesso periodo, e quello della
curva non è il patrimonio: i 655 sono un credito, ancora suoi.

## Decisione

**La curva è il patrimonio**: saldo iniziale + entrate incassate − **quota**
delle spese, dalla data di partenza di ciascuno. È la cassa più il credito
verso gli altri, calcolato come i debiti (`debts.compute_balances`): le
entrate restano di chi incassa, le spese pesano per quota. Un pareggio sposta
il credito in cassa e non cambia il patrimonio.

- `balance-history` dà per ogni giorno `balance` (patrimonio) e `cash` (la
  vecchia curva); `expense` è la quota del giorno. `start_balance` è il saldo
  **prima** del primo giorno, così la variazione del periodo ne conta i
  movimenti (prima il primo giorno restava fuori).
- La cassa è una linea tratteggiata, solo dove si stacca dal patrimonio. Su
  tutti insieme le due coincidono: le quote fanno la spesa intera, i pareggi
  si annullano.
- Il punto di oggi è il reale (conti + in attesa) **più gli stessi crediti**:
  lo scarto resta quello della riconciliazione, che non cambia e resta per
  cassa.

## Conseguenze

La variazione del badge coincide col netto per persona della pagina. Chi
vuole vedere i soldi sui conti li ha nella linea tratteggiata e nella
riconciliazione in dashboard.
