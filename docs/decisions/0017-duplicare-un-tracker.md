# 0017 — Duplicare un tracker: la struttura sì, i movimenti no

Data: 2026-10-19 · Stato: accettata

## Contesto

Il caso tipico è l'anno nuovo: da "Spese 2026" si vuole "Spese 2027" con le
stesse categorie (con le loro descrizioni, che guidano Gemini nella
categorizzazione), le stesse persone e gli stessi conti, ripartendo da zero
coi movimenti. Rifare tutto a mano dal Setup è lungo e sbaglia le
descrizioni.

## Decisione

`POST /trackers/{id}/duplicate` con `name` e tre interruttori. Lo fa solo il
**proprietario**, che resta proprietario della copia.

| Cosa | Nella copia |
|---|---|
| Valuta, tipo, semplifica debiti, frequenza della banca | sempre |
| Categorie (nome, tipo, descrizione, colore, icona, archiviata) | sempre |
| Membri attivi con ruolo e quota (`members`, default sì) | entrano **già attivi**, senza nuovo invito |
| Conti con il saldo di oggi (`accounts`, default sì) | solo quelli di membri presenti nella copia |
| Ricorrenze attive (`recurring`, default **no**) | categoria e conto ricollegati alle copie; saltate se chi paga o chi divide non è nella copia |
| Movimenti, pareggi, voci in attesa, bozze, collegamenti alla banca | mai |

- **Membri senza invito**: sono le stesse persone che hanno già accettato di
  condividere col proprietario il tracker di partenza. Gli inviti ancora
  pendenti non si copiano (servirebbe un token nuovo). Saldo iniziale e data
  di partenza ripartono vuoti: sono del periodo nuovo.
- **Ricorrenze spente di default**: copiate, quelle con `auto_commit`
  scriverebbero in due tracker. Archiviare il vecchio tracker le ferma lì.
- **Banca**: un `BankAccount` è abbinato a un `Account` solo; il collegamento
  resta al tracker di partenza e si riabbina dalla pagina Banca se serve.

Il servizio è `apps/trackers/duplicate.py`, in una transazione sola. Nel
frontend: Setup → "Duplica, archivia, elimina" → Duplica; nei tracker
`group` le opzioni Conti e Ricorrenze non compaiono.

## Alternative scartate

- **Duplicare anche i movimenti**: per l'anno nuovo non servono, e per il
  resto è una copia di un tracker che si può semplicemente continuare a usare.
- **Inviti nuovi a tutti i membri**: un passaggio in più per persone che
  hanno già accettato, e la copia nascerebbe senza le loro quote.
