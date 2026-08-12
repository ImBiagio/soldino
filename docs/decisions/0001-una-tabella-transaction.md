# 0001 — Una sola tabella `Transaction`

Spese ed entrate condividono `Transaction`, discriminate da `type`, con `amount`
sempre positivo e vincolo DB `amount > 0`.

**Perché:** filtri, riepiloghi e riconciliazione lavorano su un solo indice; il
segno vive nel tipo, non nel dato, quindi nessuna query deve ricordarsi di
normalizzarlo. Il costo è un `CheckConstraint` in più.
