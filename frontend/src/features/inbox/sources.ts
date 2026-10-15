import type { StatementSource } from '../../lib/types'

/**
 * Le quattro strade da cui arrivano movimenti da approvare, tutte nella stessa
 * bozza (`StatementImport`): nome del gruppo, icona e dove si rivedono.
 */
export const SOURCES: Record<
  StatementSource,
  { label: string; icon: string; review: string; page: string }
> = {
  scan: { label: 'Estratti conto', icon: 'document_scanner', review: 'scan', page: 'scan' },
  receipt: { label: 'Scontrini', icon: 'photo_camera', review: 'scontrino', page: 'scontrino' },
  voice: { label: 'Vocali', icon: 'mic', review: 'voce', page: 'voce' },
  bank: { label: 'Banche', icon: 'account_balance', review: 'scan', page: 'banca' },
}

export const SOURCE_ORDER: StatementSource[] = ['receipt', 'voice', 'scan', 'bank']
