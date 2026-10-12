import { useNavigate } from 'react-router-dom'

import type { Tracker } from '../lib/types'
import { Icon, Modal } from './ui'

/** Il "+": un movimento a mano, oppure tanti in una volta dallo Scan dell'estratto conto. */
export function NewEntryChooser({
  tracker,
  open,
  onClose,
}: {
  tracker: Tracker
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const go = (path: string) => {
    onClose()
    navigate(`/t/${tracker.id}/${path}`)
  }

  const options = [
    {
      path: 'movimenti?new=1',
      icon: 'edit',
      title: 'A mano',
      text: 'Una spesa o un’entrata, con importo, categoria e divisione.',
    },
    {
      path: 'scan',
      icon: 'document_scanner',
      title: 'Da estratto conto',
      text: 'Carica il PDF della banca: lo legge Gemini, tu rivedi le righe e confermi.',
    },
  ]

  return (
    <Modal open={open} onClose={onClose} title="Nuovo inserimento">
      <div className="grid gap-3">
        {options.map((option) => (
          <button
            key={option.path}
            type="button"
            onClick={() => go(option.path)}
            className="state flex items-center gap-4 rounded-card bg-surface-container-low p-4 text-left"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-row bg-primary-container text-on-primary-container">
              <Icon name={option.icon} size={26} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body-large font-medium">{option.title}</span>
              <span className="block text-body-small text-on-surface-variant">{option.text}</span>
            </span>
            <Icon name="chevron_right" size={22} className="text-on-surface-variant" />
          </button>
        ))}
      </div>
    </Modal>
  )
}
