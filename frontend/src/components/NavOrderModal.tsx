import clsx from 'clsx'
import { Fragment, useState } from 'react'

import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { gettext, interpolate } from '../lib/i18n'
import type { Destination } from '../lib/navigation'
import { DESTINATIONS, MOBILE_SLOTS, moveDestination, orderDestinations } from '../lib/navigation'
import type { User } from '../lib/types'
import { ErrorBanner, Icon, IconButton, Modal } from './ui'

/**
 * Riordino delle voci di navigazione con le frecce (piu' affidabile del drag
 * su un telefono). `isVisible` limita la lista alle voci del tracker aperto;
 * dall'Account si vedono tutte.
 */
export function NavOrderModal({
  open,
  onClose,
  isVisible = () => true,
}: {
  open: boolean
  onClose: () => void
  isVisible?: (destination: Destination) => boolean
}) {
  const { user, setUser } = useAuth()
  const [order, setOrder] = useState(() => orderDestinations(user?.nav_order))
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const visible = new Set(order.filter(isVisible).map((destination) => destination.key))
  const shown = order.filter((destination) => visible.has(destination.key))

  const move = (key: string, direction: -1 | 1) =>
    setOrder(orderDestinations(moveDestination(order, visible, key, direction)))

  return (
    <Modal open={open} onClose={onClose} title={gettext('Riordina il menu')}>
      <div className="grid gap-3">
        <p className="text-body-medium text-on-surface-variant">
          {interpolate(
            gettext(
              'Sposta le voci con le frecce. Su mobile le prime %(count)s stanno nella barra in basso, le altre in "Altro".',
            ),
            { count: MOBILE_SLOTS },
            true,
          )}
        </p>
        <ol className="grid gap-1.5">
          {shown.map((destination, index) => (
            <Fragment key={destination.key}>
              {index === MOBILE_SLOTS && (
                <li
                  aria-hidden
                  className="flex items-center gap-2 px-1 pt-2 text-label-small uppercase tracking-wide text-on-surface-variant"
                >
                  <span className="h-px flex-1 bg-outline-variant" />
                  {gettext('Su mobile in "Altro"')}
                  <span className="h-px flex-1 bg-outline-variant" />
                </li>
              )}
              <li
                className={clsx(
                  'flex items-center gap-3 rounded-row py-1.5 pl-4 pr-1.5',
                  index < MOBILE_SLOTS ? 'bg-secondary-container' : 'bg-surface-container-low',
                )}
              >
                <Icon name={destination.icon} size={22} className="text-on-surface-variant" />
                <span className="min-w-0 flex-1 truncate text-body-large">{destination.label}</span>
                <IconButton
                  icon="arrow_upward"
                  label={interpolate(gettext('Sposta su %s'), [destination.label])}
                  onClick={() => move(destination.key, -1)}
                  disabled={index === 0}
                  className="disabled:opacity-30"
                />
                <IconButton
                  icon="arrow_downward"
                  label={interpolate(gettext('Sposta giù %s'), [destination.label])}
                  onClick={() => move(destination.key, 1)}
                  disabled={index === shown.length - 1}
                  className="disabled:opacity-30"
                />
              </li>
            </Fragment>
          ))}
        </ol>
        <ErrorBanner error={error} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-text"
            onClick={() => setOrder(DESTINATIONS)}
            disabled={order.every((destination, index) => destination === DESTINATIONS[index])}
          >
            {gettext('Ripristina')}
          </button>
          <button
            type="button"
            className="btn-filled ml-auto"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                const nav_order = order.map((destination) => destination.key)
                setUser(await api.patch<User>('/api/me', { nav_order }))
                onClose()
              } catch (err) {
                setError(err)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? gettext('Salvo…') : gettext('Salva')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
