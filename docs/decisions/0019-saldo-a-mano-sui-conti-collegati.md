# 0019 — Un saldo corretto a mano non lo sovrascrive la banca

Data: 2026-11-05 · Stato: accettata

## Contesto

La sincronizzazione con la banca (ADR 0013) scriveva sempre il saldo letto sul
conto di Soldino. Caso reale, novembre 2026: per Illimity la banca restituisce
19.977,65 (il conto senza il deposito), mentre i soldi veri sono 84.700,09.
Serena allinea a mano il 24/10, il giro mensile del 1/11 riscrive 19.977,65 e
la riconciliazione del tracker va a −63 mila senza che nessuno abbia toccato
niente. Allineare a mano non serviva: durava fino al giro successivo.

## Decisione

- `BankAccount.sync_balance` (default acceso): solo con questo acceso il saldo
  letto va sul conto. **Si spegne da solo** quando qualcuno corregge a mano il
  saldo di un conto collegato (`PATCH` del conto con un `current_balance`
  diverso).
- Il saldo della banca si salva comunque in `bank_balance` / `bank_balance_at`,
  come riferimento: la pagina Banca lo mostra accanto all'interruttore "Saldo
  dalla banca".
- Riaccendere l'interruttore riporta subito il conto all'ultimo saldo letto,
  senza aspettare il giro.
- Il rinnovo del consenso conserva l'impostazione, come `auto_commit`.

## Conseguenze

Un saldo tenuto a mano resta fermo finché qualcuno non lo aggiorna: la
riconciliazione mostra lo scarto quando i movimenti cambiano e il saldo no,
ma non lo inventa più. Chi vuole il saldo della banca riaccende l'interruttore.
Scartati: un saldo "bloccato" per sempre senza riferimento alla banca, e la
somma di più conti in banca su un conto di Soldino (il deposito spesso non è
esposto via PSD2).
