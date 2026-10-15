# 0013 — Open banking con Enable Banking, un'app per utente

Data: 2026-10-15 · Stato: accettata

## Contesto

Movimenti e saldo dei conti si inseriscono a mano, con lo scan del PDF (ADR
0008) o con le ricorrenze. Le banche europee espongono saldo e movimenti con
le API PSD2 (AIS), ma solo a operatori con licenza: un privato passa da un
aggregatore. GoCardless (ex Nordigen) dal 2025 non accetta nuovi utenti; gli
altri (Tink, Salt Edge, Yapily...) vogliono contratto e verifica aziendale.
Enable Banking ha una modalità **gratuita e ristretta**: un'applicazione
legge solo i conti che il suo proprietario ha collegato dal pannello.

Soldino non ha un contratto con nessun aggregatore e non può avere i conti di
tutti sotto una sola applicazione.

## Decisione

**Ogni utente porta la sua applicazione Enable Banking.** La registra nel
pannello di Enable Banking (con l'URL di ritorno di Soldino), la attiva
collegando i suoi conti, e carica in Soldino l'application ID e la chiave
privata `.pem`. Soldino firma con quella chiave (JWT RS256, un'ora di vita)
ogni chiamata fatta per conto di quell'utente. Il wizard nella sezione
"Banca" guida tutti i passaggi, con le schermate del pannello.

- `BankingApp` (uno per utente): application ID e chiave privata **cifrata**
  (Fernet, chiave in `BANKING_ENCRYPTION_KEY`; in sviluppo, se manca, derivata
  da `DJANGO_SECRET_KEY`). Al caricamento si verifica con `GET /application`
  che la chiave funzioni e che l'URL di ritorno di Soldino sia tra quelli
  ammessi.
- `BankConnection`: un'autorizzazione presso una banca (sessione PSD2), con la
  scadenza del consenso (massimo 180 giorni, poi va rinnovata con la SCA).
- `BankAccount`: un conto della sessione, abbinato a un `Account` di Soldino
  **dell'utente stesso** (chi intesta il conto paga le sue righe). Rinnovando il
  consenso, i conti si riconoscono dall'`identification_hash` e mantengono
  abbinamento e impostazioni.

**Sincronizzazione.** Programmata secondo `Tracker.bank_sync_frequency`, scelta
nel Setup: ogni giorno, ogni settimana (il lunedì) o **ogni mese (default)**, il
1° del mese con tutto il mese appena chiuso, come un estratto conto. Il task di
Celery beat gira ogni mattina alle 6:15 e legge solo i conti a cui tocca;
"Sincronizza ora" resta sempre disponibile e conta come lettura. Le banche
limitano a circa 4 accessi al giorno senza l'utente presente e ogni giro fa
due chiamate (saldo e movimenti). (Fino al 2026-10-15 il giro era fisso, alle
7:15 e alle 19:15.)

- Il **saldo** aggiorna `Account.current_balance` (contabile se c'è, poi
  disponibile), con `balance_updated_at`.
- I **movimenti** contabilizzati (`BOOK`, mai i `PDNG` che cambiano ancora)
  diventano righe della stessa bozza dello scan (`StatementImport` con
  `source=bank`): stessa revisione, stesse categorie dallo storico, stesso
  avviso doppioni. Una sola bozza aperta per conto: i giri successivi la
  allungano.
- Ogni movimento visto si ricorda in `SeenBankTransaction` (conto Soldino +
  id del movimento): una riga scartata dalla bozza non ritorna al giro dopo.
  Se la banca non dà un id stabile si usa un'impronta di data, importo, verso e
  causale.

**Registrazione automatica: scelta per conto.** Di default si rivede tutto
(§0.6, come lo scan). Con l'interruttore "Registra in automatico" i movimenti
diventano subito `Transaction` (`source=bank`); i possibili doppioni restano
comunque nella bozza da rivedere, perché un movimento già inserito a mano non
deve contare due volte.

## Conseguenze

- Nessun costo e nessun contratto per Soldino; ogni utente accetta i termini
  di Enable Banking per sé.
- Il setup è più lungo (registrazione sul pannello), da cui il wizard.
- La chiave privata nel database è un segreto: senza `BANKING_ENCRYPTION_KEY`
  non si decifra. Cambiare quella chiave obbliga tutti a ricaricare il `.pem`.
- Se un utente revoca il consenso o scade, la sincronizzazione si ferma con
  un messaggio e un pulsante "Rinnova", senza toccare i dati già importati.
- I dati bancari passano da Enable Banking (Finlandia, AISP autorizzato).
