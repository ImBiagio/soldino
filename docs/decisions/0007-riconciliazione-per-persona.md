# 0007 — Riconciliazione per persona, per cassa, con saldo iniziale

La riconciliazione confronta i soldi segnati con quelli veri:

```
atteso = saldo iniziale + entrate incassate − spese pagate ± pareggi
reale  = conti + in attesa (BTA, anche negativo: soldi ancora da dare)
delta  = reale − atteso
```

Si calcola **per persona** e il totale del tracker è la somma delle persone.

**Saldo iniziale.** Prima la formula era `conti + BTA − (entrate − uscite)`:
senza un punto di partenza, il delta era in pratica il saldo che c'era sui conti
prima del primo movimento. Ogni `Membership` ha ora `opening_balance` e
`opening_date`: quanto c'era sui conti a quella data, e da lì in poi contano
movimenti e pareggi. Data vuota = da sempre. Ognuno modifica il proprio; il
proprietario anche quelli degli altri.

**Per cassa, non per quote.** Per la persona contano le spese che ha *pagato* e
le entrate che ha *incassato* (`paid_by`), non le quote degli split. Una cena da
100 € divisa a metà toglie 100 € dal conto di chi paga: i 50 che gli devono sono
un credito, stanno in "chi deve cosa" e rientrano col pareggio, che qui si conta
(`settlements_net`). Usare le quote darebbe uno scarto di 50 € finché l'altro
non salda, cioè un falso allarme. Le quote restano la misura giusta per le
statistiche ("quanto ho speso io"): dashboard per persona e Grafici le usano.

**Totale = somma delle persone.** Così ognuno conta dalla propria data, e i
pareggi fra membri si annullano. Entrano anche i membri revocati, perché i loro
movimenti restano; il dettaglio per persona mostra solo i membri attivi.

**Conseguenza:** intestatario di un conto e titolare di una voce in attesa
devono essere membri attivi del tracker, altrimenti uscirebbero da ogni
riconciliazione.
