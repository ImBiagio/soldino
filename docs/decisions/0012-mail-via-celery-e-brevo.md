# 0012 — Mail dell'account via Celery, SMTP di Brevo condiviso

Data: 2026-10-15 · Stato: accettata

## Contesto

Conferma dell'email, reset della password e inviti esistevano solo come link
stampati in console: in produzione nessuna mail partiva, e la verifica era
spenta per non bloccare la registrazione.

## Decisione

- **Invio dal worker Celery** (`apps/core/tasks.deliver_email`), accodato con
  `transaction.on_commit`: una richiesta non aspetta mai l'SMTP, una
  transazione annullata non manda mail, un SMTP giù viene riprovato con attesa
  crescente (30 s, 1, 2, 4 minuti).
- **Un solo layout** testo + HTML (`templates/emails/base.*`, tabelle e stili
  inline come le mail di cinemino) usato da `core.methods.send_email`.
- **SMTP di Brevo, lo stesso account di cinemino**: il dominio `inoo.it` è già
  autenticato (DKIM/DMARC), mittente `Soldino <messagg@inoo.it>`. I 300 invii
  al giorno del piano gratuito sono condivisi, abbondanti per due app di
  famiglia e amici.
- **Reset password** col generatore di Django (`default_token_generator`):
  l'hash dipende da password e ultimo login, quindi il link muore appena usato
  senza tabelle; validità 2 ore (`PASSWORD_RESET_TIMEOUT`). Dopo il reset tutte
  le sessioni aperte vengono revocate e l'email vale come confermata.
- Reinvio della conferma e richiesta di reset rispondono **sempre 204**.

## Scartato

- **Invio nella richiesta**: un SMTP lento blocca registrazione e reset, uno
  giù li fa fallire.
- **Token firmato stateless anche per il reset**: resterebbe valido fino alla
  scadenza anche dopo l'uso.
- **Un secondo provider** per soldino: un account e un dominio in più da
  autenticare per volumi minimi.
