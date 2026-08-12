import clsx from 'clsx'
import { NavLink, Outlet, useParams } from 'react-router-dom'

import { useTracker } from '../api/hooks'
import { useAuth } from '../lib/auth'
import { Avatar, Spinner } from './ui'

const TABS = [
  { to: '', label: 'Dashboard', end: true },
  { to: 'movimenti', label: 'Movimenti' },
  { to: 'attese', label: 'In attesa' },
  { to: 'abbonamenti', label: 'Abbonamenti' },
  { to: 'impostazioni', label: 'Impostazioni' },
]

export function TrackerLayout() {
  const { trackerId } = useParams()
  const { data: tracker, isLoading } = useTracker(trackerId)
  const { user, logout } = useAuth()

  if (isLoading || !tracker) return <Spinner />

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/90 backdrop-blur dark:border-ink-700 dark:bg-ink-900/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <NavLink to="/" className="text-xs text-ink-500 hover:underline">
              ← tutti i tracker
            </NavLink>
            <h1 className="truncate text-lg font-semibold">{tracker.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {tracker.members
                .filter((m) => m.status === 'active')
                .map((member) => (
                  <Avatar key={member.id} name={member.display_name} />
                ))}
            </div>
            <button className="btn-ghost" onClick={() => logout()} title={user?.email}>
              Esci
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {TABS.map((tab) => (
            <NavLink
              key={tab.label}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                clsx(
                  'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition',
                  isActive
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-ink-500 hover:text-ink-800 dark:hover:text-ink-200',
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet context={tracker} />
      </main>
    </div>
  )
}
