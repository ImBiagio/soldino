# 0002 — Allocazione degli split a centesimi con resto maggiore

`apps/core/money.allocate()` ripartisce in centesimi interi e assegna il resto
col metodo del resto maggiore, tie-break sull'indice.

**Perché:** arrotondare ogni riga in modo indipendente perde o crea centesimi, e
un centesimo perso rompe l'invariante `Σ share_amount == amount`, che è un
vincolo applicativo verificato in `Transaction.validate_splits()`. Coverage 100%
sul modulo, più un property test Hypothesis. Lo stesso algoritmo è replicato in
`frontend/src/lib/money.ts` perché l'anteprima del widget non deve mai divergere
dal risultato salvato.
