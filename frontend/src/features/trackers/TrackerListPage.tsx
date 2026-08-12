import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useCreateTracker, useTrackers } from '../../api/hooks'
import { Avatar, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui'
import { useAuth } from '../../lib/auth'

export function TrackerListPage() {
  const { data, isLoading, error } = useTrackers()
  const { user, logout } = useAuth()
  const create = useCreateTracker()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Soldino</h1>
          <p className="text-sm text-ink-500">Ciao {user?.display_name}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => setOpen(true)}>
            Nuovo tracker
          </button>
          <button className="btn-ghost" onClick={() => logout()}>
            Esci
          </button>
        </div>
      </header>

      <ErrorBanner error={error} />
      {isLoading ? (
        <Spinner />
      ) : data && data.results.length > 0 ? (
        <ul className="space-y-2">
          {data.results.map((tracker) => (
            <li key={tracker.id}>
              <Link
                to={`/t/${tracker.id}`}
                className="card flex items-center justify-between hover:border-indigo-400"
              >
                <div>
                  <p className="font-medium">{tracker.name}</p>
                  <p className="text-xs text-ink-500">
                    {tracker.currency} · {tracker.my_role}
                    {tracker.archived_at && ' · archiviato'}
                  </p>
                </div>
                <div className="flex -space-x-2">
                  {tracker.members
                    .filter((m) => m.status === 'active')
                    .map((member) => (
                      <Avatar key={member.id} name={member.display_name} />
                    ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="Nessun tracker"
          description="Crea il primo tracker per iniziare a registrare spese ed entrate."
          action={
            <button className="btn-primary mt-2" onClick={() => setOpen(true)}>
              Crea tracker
            </button>
          }
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nuovo tracker">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault()
            await create.mutateAsync({ name })
            setName('')
            setOpen(false)
          }}
        >
          <ErrorBanner error={create.error} />
          <Field label="Nome" hint="Es. “Spese coppia 2026”">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <button className="btn-primary w-full" disabled={create.isPending}>
            Crea
          </button>
        </form>
      </Modal>
    </div>
  )
}
