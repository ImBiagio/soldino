import clsx from 'clsx'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useCreateTracker, useReconciliation, useTrackers } from '../../api/hooks'
import { activeMembers } from '../../components/Layout'
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
import { formatCents, toCents } from '../../lib/money'
import { KIND_OPTIONS, isGroup, showsReconciliation } from '../../lib/trackerKind'
import type { Tracker, TrackerKind } from '../../lib/types'

export function TrackerListPage() {
  const { data, isLoading, error } = useTrackers()
  const { user, logout } = useAuth()
  const create = useCreateTracker()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<TrackerKind>('household')

  const [showArchived, setShowArchived] = useState(false)
  const trackers = data?.results ?? []
  const active = trackers.filter((tracker) => !tracker.archived_at)
  const archived = trackers.filter((tracker) => tracker.archived_at)

  return (
    <div className="mx-auto max-w-3xl p-5 md:p-7">
      <div className="panel p-6 md:p-7">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="" width={48} height={48} />
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
            {active.map((tracker) => (
              <TrackerRow key={tracker.id} tracker={tracker} />
            ))}
            {active.length === 0 && (
              <p className="px-1 py-4 text-body-medium text-on-surface-variant">
                Nessun tracker attivo.
              </p>
            )}
          </div>
        )}

        {archived.length > 0 && (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              aria-expanded={showArchived}
              className="state mb-2 flex w-full items-center gap-2 rounded-row px-1 py-2 text-left text-body-medium font-medium text-on-surface-variant"
            >
              <Icon name="archive" size={20} />
              Archiviati · {archived.length}
              <Icon
                name={showArchived ? 'expand_less' : 'expand_more'}
                size={20}
                className="ml-auto"
              />
            </button>
            {showArchived && (
              <div className="grid gap-2">
                {archived.map((tracker) => (
                  <TrackerRow key={tracker.id} tracker={tracker} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Nuovo tracker">
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            await create.mutateAsync({ name: String(form.get('name')), kind })
            setOpen(false)
          }}
        >
          <ErrorBanner error={create.error} />
          <Field label="Nome" hint="Es. “Spese casa 2026”">
            <input className="field-input" name="name" required autoFocus />
          </Field>
          <KindPicker value={kind} onChange={setKind} />
          <button className="btn-filled w-full" disabled={create.isPending}>
            Crea
          </button>
        </form>
      </Modal>
    </div>
  )
}

function TrackerRow({ tracker }: { tracker: Tracker }) {
  const members = activeMembers(tracker)
  const archived = Boolean(tracker.archived_at)

  return (
    <Link
      to={`/t/${tracker.id}`}
      className={clsx(
        'state flex items-center gap-4 rounded-card px-5 py-4',
        archived ? 'bg-surface-container-low opacity-70' : 'bg-secondary-container',
      )}
    >
      <IconCircle name={isGroup(tracker) ? 'groups' : 'savings'} color="var(--primary)" size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-large font-semibold">{tracker.name}</p>
        <p className="text-body-small text-on-surface-variant">
          {members.length} {members.length === 1 ? 'membro' : 'membri'} · {tracker.currency}
          {archived && ' · archiviato'}
          {isGroup(tracker) && ' · dividere le spese'}
          {showsReconciliation(tracker) && <ReconciliationHint tracker={tracker} />}
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
  return <> · non quadra per {formatCents(Math.abs(delta), tracker.currency)}</>
}

/** Il tipo di tracker: due card radio, si cambia poi dal Setup (ADR 0010). */
export function KindPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: TrackerKind
  onChange: (kind: TrackerKind) => void
  disabled?: boolean
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo di tracker">
      {KIND_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={clsx(
            'state flex items-start gap-3 rounded-card p-4 text-left disabled:opacity-60',
            value === option.value
              ? 'bg-secondary-container text-on-secondary-container'
              : 'bg-surface-container-low',
          )}
        >
          <Icon
            name={value === option.value ? 'radio_button_checked' : 'radio_button_unchecked'}
            size={22}
            className={value === option.value ? 'text-primary' : 'text-on-surface-variant'}
          />
          <span className="min-w-0">
            <span className="block text-body-large font-medium">{option.label}</span>
            <span className="block text-body-small text-on-surface-variant">
              {option.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
