# 0005 — Normalizzatore merchant: generico ora, gazetteer in fase 2

`normalize_merchant()` toglie accenti, numeri, date, forme societarie e rumore
di pagamento. Il campo `merchant_normalized` viene popolato **da subito** su
ogni `Transaction`, anche se serve davvero dalla fase 2.

**Perché ora:** aggiungerlo dopo significherebbe un backfill su tutto lo storico
importato, con la normalizzazione che cambia sotto i piedi alle `MerchantRule`.

**Limite noto:** l'esempio del piano `"Suncar di Ferrari Dav. Reggio Nell'E" →
"suncar di ferrari"` non è raggiungibile senza un elenco di città italiane.
Oggi produce `"suncar ferrari dav reggio nell"`. Il test
`test_obiettivo_del_piano_niente_citta` è marcato `xfail(strict=True)`: quando in
fase 2 aggiungeremo il gazetteer sui dati veri, il test passerà e il marcatore
diventerà un errore, costringendo a rimuoverlo.
