import clsx from 'clsx'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useCreateTracker, useReconciliation, useTrackers } from '../../api/hooks'
import {
  Avatar,
  EmptyState,
  ErrorBanner,
  Field,
  Icon,
  IconCircle,
  Modal,
  RowsSkeleton,
} from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { memberColor } from '../../lib/icons'
import { formatMoney, toCents } from '../../lib/money'
import type { Tracker } from '../../lib/types'

export function TrackerListPage() {
  const { data, isLoading, error } = useTrackers()
  const { user, logout } = useAuth()
  const create = useCreateTracker()
  const [open, setOpen] = useState(false)

  const trackers = data?.results ?? []

  return (
    <div className="mx-auto max-w-3xl p-5 md:p-7">
      <div className="panel p-6 md:p-7">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="flex items-center justify-center rounded-row bg-primary-container text-on-primary-container"
              style={{ width: 48, height: 48 }}
            >
              <Icon name="savings" size={26} />
            </span>
            <div>
              <h1 className="text-title-large">Soldino</h1>
              <p className="text-body-medium text-on-surface-variant">Ciao {user?.display_name}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-filled" onClick={() => setOpen(true)}>
              <Icon name="add" size={20} />
              Nuovo tracker
            </button>
            <button type="button" className="btn-text" onClick={() => logout()}>
              Esci
            </button>
          </div>
        </header>

        <ErrorBanner error={error} />

        {isLoading ? (
          <RowsSkeleton rows={2} />
        ) : trackers.length === 0 ? (
          <EmptyState
            icon="savings"
            title="Nessun tracker"
            description="Crea il primo tracker per iniziare a registrare spese ed entrate."
            action={
              <button type="button" className="btn-tonal" onClick={() => setOpen(true)}>
                Crea tracker
              </button>
            }
          />
        ) : (
          <div className="grid gap-2">
            {trackers.map((tracker) => (
              <TrackerRow key={tracker.id} tracker={tracker} />
            ))}
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Nuovo tracker">
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            await create.mutateAsync({ name: String(form.get('name')) })
            setOpen(false)
          }}
        >
          <ErrorBanner error={create.error} />
          <Field label="Nome" hint="Es. “Spese casa 2026”">
            <input className="field-input" name="name" required autoFocus />
          </Field>
          <button className="btn-filled w-full" disabled={create.isPending}>
            Crea
          </button>
        </form>
      </Modal>
    </div>
  )
}

function TrackerRow({ tracker }: { tracker: Tracker }) {
  const members = tracker.members.filter((member) => member.status === 'active')
  const archived = Boolean(tracker.archived_at)

  return (
    <Link
      to={`/t/${tracker.id}`}
      className={clsx(
        'state flex items-center gap-4 rounded-card px-5 py-4',
        archived ? 'bg-surface-container-low opacity-70' : 'bg-secondary-container',
      )}
    >
      <IconCircle name="savings" color="var(--primary)" size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-large font-semibold">{tracker.name}</p>
        <p className="text-body-small text-on-surface-variant">
          {members.length} {members.length === 1 ? 'membro' : 'membri'} · {tracker.currency}
          {archived && ' · archiviato'}
          <ReconciliationHint tracker={tracker} />
        </p>
      </div>
      <div className="hidden sm:flex">
        {members.map((member, index) => (
          <span key={member.id} style={{ marginLeft: index ? -10 : 0 }}>
            <Avatar
              name={member.display_name}
              size={32}
              color={memberColor(index)}
              ring={index > 0}
            />
          </span>
        ))}
      </div>
      <Icon name="chevron_right" size={22} className="text-on-surface-variant" />
    </Link>
  )
}

/**
 * La riconciliazione emerge già in lista, come nel design.
 * Costa una richiesta per tracker: quando la lista crescerà, il campo va
 * aggiunto al serializer di `GET /trackers` invece di essere chiesto qui.
 */
function ReconciliationHint({ tracker }: { tracker: Tracker }) {
  const { data } = useReconciliation(tracker.id)
  if (!data) return null
  const delta = toCents(data.delta)
  if (delta === 0) return <> · quadra</>
  return <> · non quadra per {formatMoney(Math.abs(delta) / 100, tracker.currency)}</>
}
