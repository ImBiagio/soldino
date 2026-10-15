import clsx from 'clsx'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useClickOutside, useCloseOnEscape } from '../lib/hooks'
import type { Tracker } from '../lib/types'
import { Icon } from './ui'

/** Le due strade per inserire movimenti: una alla volta o dall'estratto conto. */
const ACTIONS = [
  { path: 'movimenti?new=1', icon: 'edit', label: 'A mano' },
  { path: 'scan', icon: 'document_scanner', label: 'Da estratto conto' },
]

/**
 * FAB menu di Material 3 Expressive: il "+" diventa "×" e apre le azioni come
 * pill sopra uno scrim. Sulla rail si apre a destra (sopra il contenuto, non sulle
 * voci della rail), su mobile verso l'alto.
 */
export function FabMenu({
  tracker,
  placement,
}: {
  tracker: Tracker
  placement: 'rail' | 'mobile'
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  useCloseOnEscape(open, close)
  const mobile = placement === 'mobile'
  const actions = mobile ? [...ACTIONS].reverse() : ACTIONS

  return (
    <>
      <div
        aria-hidden
        onClick={close}
        className={clsx(
          'fixed inset-0 z-40 transition-opacity duration-200 ease-m3',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={{ background: 'var(--scrim)' }}
      />
      <div
        className={clsx('z-50', mobile ? 'fixed right-[18px] md:hidden' : 'relative mt-2')}
        style={mobile ? { bottom: 96 } : undefined}
      >
        <div
          role="menu"
          aria-label="Nuovo inserimento"
          // Il contenitore resta montato anche da chiuso: non deve prendersi i
          // click del contenuto sotto, solo le pill aperte li ricevono.
          className={clsx(
            'pointer-events-none absolute flex flex-col gap-2',
            mobile ? 'bottom-full right-0 mb-3 items-end' : 'left-full top-0 ml-4 items-start',
          )}
        >
          {actions.map((action, index) => (
            <button
              key={action.path}
              type="button"
              role="menuitem"
              tabIndex={open ? 0 : -1}
              onClick={() => {
                close()
                navigate(`/t/${tracker.id}/${action.path}`)
              }}
              className={clsx(
                'state flex h-14 items-center gap-3 whitespace-nowrap rounded-pill bg-primary-container pl-5 pr-6 text-title-medium text-on-primary-container shadow-fab-mobile transition-all duration-200 ease-m3',
                open
                  ? 'pointer-events-auto translate-x-0 translate-y-0 opacity-100'
                  : clsx(
                      'pointer-events-none opacity-0',
                      mobile ? 'translate-y-3' : '-translate-y-3',
                    ),
              )}
              style={{ transitionDelay: open ? `${index * 40}ms` : '0ms' }}
            >
              <Icon name={action.icon} size={24} />
              {action.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Chiudi' : 'Nuovo inserimento'}
          aria-expanded={open}
          aria-haspopup="menu"
          className={clsx(
            'state flex items-center justify-center transition-all duration-200 ease-m3',
            open
              ? 'rounded-pill bg-primary text-on-primary'
              : clsx(
                  'bg-primary-container text-on-primary-container',
                  mobile ? 'rounded-fab shadow-fab-mobile' : 'rounded-row shadow-fab',
                ),
          )}
          style={mobile ? { width: 64, height: 64 } : { width: 60, height: 60 }}
        >
          <Icon
            name="add"
            size={mobile ? 28 : 26}
            className={clsx('transition-transform duration-200 ease-m3', open && 'rotate-45')}
          />
        </button>
      </div>
    </>
  )
}

/**
 * Lo stesso, come menu M3 ancorato a un pulsante di testo (es. "Nuovo
 * movimento" nell'intestazione dei Movimenti), dove un FAB non c'entra.
 */
export function NewEntryMenuButton({
  tracker,
  className,
}: {
  tracker: Tracker
  className?: string
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useCloseOnEscape(open, () => setOpen(false))
  useClickOutside(ref, open, () => setOpen(false))

  return (
    <div ref={ref} className={clsx('relative', className)}>
      <button
        type="button"
        className="btn-filled"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Icon name="add" size={20} />
        Nuovo movimento
        <Icon
          name="arrow_drop_down"
          size={20}
          className={clsx('transition-transform duration-200 ease-m3', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[220px] overflow-hidden rounded-row bg-surface-container py-2 shadow-fab-mobile"
        >
          {ACTIONS.map((action) => (
            <button
              key={action.path}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                navigate(`/t/${tracker.id}/${action.path}`)
              }}
              className="state flex h-12 w-full items-center gap-3 px-4 text-left text-body-large"
            >
              <Icon name={action.icon} size={22} className="text-on-surface-variant" />
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
