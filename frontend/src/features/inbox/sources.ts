import { gettext } from '../../lib/i18n'
import type { StatementSource } from '../../lib/types'

/**
 * Le quattro strade da cui arrivano movimenti da approvare, tutte nella stessa
 * bozza (`StatementImport`): nome del gruppo, icona e dove si rivedono.
 */
export const SOURCES: Record<
  StatementSource,
  { label: string; icon: string; review: string; page: string }
> = {
  scan: {
    label: gettext('Estratti conto'),
    icon: 'document_scanner',
    review: 'scan',
    page: 'scan',
  },
  receipt: {
    label: gettext('Scontrini'),
    icon: 'photo_camera',
    review: 'scontrino',
    page: 'scontrino',
  },
  voice: { label: gettext('Vocali'), icon: 'mic', review: 'voce', page: 'voce' },
  bank: { label: gettext('Banche'), icon: 'account_balance', review: 'scan', page: 'banca' },
}

export const SOURCE_ORDER: StatementSource[] = ['receipt', 'voice', 'scan', 'bank']
