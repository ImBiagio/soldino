import clsx from 'clsx'

import { Icon } from '../../components/ui'
import { gettext } from '../../lib/i18n'
import type { StatementStatus } from '../../lib/types'

const STATUS_LABEL: Record<StatementStatus, { label: string; icon: string; tone: string }> = {
  processing: {
    label: gettext('In lettura'),
    icon: 'hourglass_top',
    tone: 'bg-surface-container-high text-on-surface',
  },
  ready: {
    label: gettext('Da rivedere'),
    icon: 'edit_note',
    tone: 'bg-warning-container text-on-warning-container',
  },
  failed: {
    label: gettext('Non riuscito'),
    icon: 'error',
    tone: 'bg-error-container text-on-error-container',
  },
  committed: {
    label: gettext('Registrato'),
    icon: 'check_circle',
    tone: 'bg-secondary-container text-on-secondary-container',
  },
}

/** Lo stato di un estratto conto, uguale in lista e nella pagina di revisione. */
export function StatusBadge({ status }: { status: StatementStatus }) {
  const { label, icon, tone } = STATUS_LABEL[status]
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-body-small font-medium',
        tone,
      )}
    >
      <Icon name={icon} size={16} />
      {label}
    </span>
  )
}
