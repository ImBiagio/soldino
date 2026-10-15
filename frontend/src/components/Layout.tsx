import clsx from 'clsx'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'

import { useTracker, useTrackers } from '../api/hooks'
import { useAuth } from '../lib/auth'
import { memberColor } from '../lib/colors'
import type { Membership, Tracker } from '../lib/types'
import { FabMenu } from './FabMenu'
import { Avatar, AvatarStack, Chip, Icon, Modal, Skeleton } from './ui'

const DESTINATIONS = [
  { to: '', label: 'Oggi', icon: 'dashboard', end: true },
  { to: 'movimenti', label: 'Movimenti', icon: 'receipt_long' },
  { to: 'conti', label: 'Conti', icon: 'account_balance' },
  { to: 'attese', label: 'In attesa', icon: 'hourglass_top' },
  { to: 'grafici', label: 'Grafici', icon: 'bar_chart', menuOnMobile: true },
  { to: 'abbonamenti', label: 'Ricorrenze', icon: 'autorenew', menuOnMobile: true },
  { to: 'impostazioni', label: 'Setup', icon: 'tune', menuOnMobile: true },
]

/** Sul mobile la bottom bar tiene quattro voci: le altre passano nel menu. */
const MOBILE_DESTINATIONS = DESTINATIONS.filter((destination) => !destination.menuOnMobile)
const MENU_DESTINATIONS = DESTINATIONS.filter((destination) => destination.menuOnMobile)

export function activeMembers(tracker: Tracker): Membership[] {
  return tracker.members.filter((m): m is Membership => m.status === 'active' && !!m.user)
}

export function TrackerLayout() {
  const { trackerId } = useParams()
  const { data: tracker, isLoading } = useTracker(trackerId)
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  if (isLoading || !tracker) {
    return (
      <div className="flex min-h-screen">
        <Skeleton className="hidden w-24 rounded-none md:block" />
        <div className="flex-1 space-y-4 p-7">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-[280px] rounded-panel" />
        </div>
      </div>
    )
  }

  const section = location.pathname.split('/')[3] ?? ''
  const inMenuSection = MENU_DESTINATIONS.some((destination) => destination.to === section)

  return (
    <div className="flex min-h-screen bg-surface">
      {/* --- navigation rail (desktop) --- */}
      <nav
        aria-label="Sezioni"
        className="sticky top-0 z-40 hidden h-screen w-24 shrink-0 flex-col items-center bg-surface-container-low py-3 md:flex"
      >
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Menu"
          className="state flex h-14 w-14 items-center justify-center rounded-pill text-on-surface-variant"
        >
          <Icon name="menu" />
        </button>

        <FabMenu tracker={tracker} placement="rail" />

        <div className="mt-6 flex flex-col items-center gap-3.5">
          {DESTINATIONS.map((destination) => (
            <RailItem key={destination.label} {...destination} />
          ))}
        </div>
      </nav>

      <div className="min-w-0 flex-1 pb-28 md:pb-0">
        {tracker.archived_at && (
          <div className="mx-5 mt-4 flex flex-wrap items-center gap-2 rounded-card bg-surface-container-high px-4 py-3 text-body-medium md:mx-7">
            <Icon name="archive" size={20} className="text-on-surface-variant" />
            <span className="flex-1">Tracker archiviato: niente ricorrenze automatiche.</span>
            <NavLink to="impostazioni" className="font-medium text-primary">
              Gestisci
            </NavLink>
          </div>
        )}
        <Outlet context={tracker} />
      </div>

      {/* --- bottom bar + FAB (mobile) --- */}
      {/* Durante la revisione di uno scan il "+" coprirebbe i pulsanti in basso. */}
      {section !== 'scan' && <FabMenu tracker={tracker} placement="mobile" />}

      <nav
        aria-label="Sezioni"
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex justify-around bg-surface-container-low px-2 pt-3 md:hidden"
      >
        {MOBILE_DESTINATIONS.map((destination) => (
          <BottomItem key={destination.label} {...destination} />
        ))}
        {/* Senza questa voce il menu (e quindi Grafici e Setup) su mobile non si apriva. */}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="flex flex-1 flex-col items-center gap-1"
        >
          <span
            className={clsx(
              'state flex items-center justify-center transition-colors duration-200 ease-m3',
              inMenuSection
                ? 'bg-secondary-container text-on-secondary-container'
                : 'text-on-surface-variant',
            )}
            style={{ width: 56, height: 32, borderRadius: 16 }}
          >
            <Icon name="more_horiz" size={24} filled={inMenuSection} />
          </span>
          <span
            className={clsx(
              'text-label-small',
              inMenuSection ? 'text-on-surface' : 'text-on-surface-variant',
            )}
          >
            Altro
          </span>
        </button>
      </nav>

      <MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} tracker={tracker} />
    </div>
  )
}

function RailItem({
  to,
  label,
  icon,
  end,
}: {
  to: string
  label: string
  icon: string
  end?: boolean
}) {
  return (
    <NavLink to={to} end={end} className="group flex flex-col items-center gap-1">
      {({ isActive }) => (
        <>
          <span
            className={clsx(
              'state flex items-center justify-center transition-colors duration-200 ease-m3',
              isActive
                ? 'bg-secondary-container text-on-secondary-container'
                : 'text-on-surface-variant',
            )}
            style={{ width: 56, height: 32, borderRadius: 16 }}
          >
            <Icon name={icon} size={24} filled={isActive} />
          </span>
          <span
            className={clsx(
              'text-label-small',
              isActive ? 'text-on-surface' : 'text-on-surface-variant',
            )}
          >
            {label}
          </span>
        </>
      )}
    </NavLink>
  )
}

function BottomItem({
  to,
  label,
  icon,
  end,
}: {
  to: string
  label: string
  icon: string
  end?: boolean
}) {
  return (
    <NavLink to={to} end={end} className="flex flex-1 flex-col items-center gap-1">
      {({ isActive }) => (
        <>
          <span
            className={clsx(
              'state flex items-center justify-center transition-colors duration-200 ease-m3',
              isActive
                ? 'bg-secondary-container text-on-secondary-container'
                : 'text-on-surface-variant',
            )}
            style={{ width: 56, height: 32, borderRadius: 16 }}
          >
            <Icon name={icon} size={24} filled={isActive} />
          </span>
          <span
            className={clsx(
              'text-label-small',
              isActive ? 'text-on-surface' : 'text-on-surface-variant',
            )}
          >
            {label}
          </span>
        </>
      )}
    </NavLink>
  )
}

function MenuSheet({
  open,
  onClose,
  tracker,
}: {
  open: boolean
  onClose: () => void
  tracker: Tracker
}) {
  const { data } = useTrackers()
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <Modal open={open} onClose={onClose} title="Soldino">
      <div className="grid gap-2">
        <p className="px-1 text-label-small uppercase tracking-wide text-on-surface-variant">
          I tuoi tracker
        </p>
        {(data?.results ?? []).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              navigate(`/t/${item.id}`)
              onClose()
            }}
            className={clsx(
              'state flex items-center gap-3 rounded-card px-4 py-3 text-left',
              item.id === tracker.id
                ? 'bg-secondary-container text-on-secondary-container'
                : 'bg-surface-container-low',
            )}
          >
            <Icon name="savings" size={22} />
            <span className="min-w-0 flex-1 truncate text-body-large font-medium">{item.name}</span>
            {item.id === tracker.id && <Icon name="check" size={20} />}
          </button>
        ))}

        <div className="mt-2 grid gap-2">
          {MENU_DESTINATIONS.map((destination) => (
            <button
              key={destination.to}
              type="button"
              onClick={() => {
                navigate(`/t/${tracker.id}/${destination.to}`)
                onClose()
              }}
              className="state flex items-center gap-3 rounded-card bg-surface-container-low px-4 py-3 text-left md:hidden"
            >
              <Icon name={destination.icon} size={22} />
              <span className="flex-1 text-body-large">{destination.label}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              navigate('/')
              onClose()
            }}
            className="state flex items-center gap-3 rounded-card bg-surface-container-low px-4 py-3 text-left"
          >
            <Icon name="list" size={22} />
            <span className="flex-1 text-body-large">Tutti i tracker</span>
          </button>
          <button
            type="button"
            onClick={() => logout()}
            className="state flex items-center gap-3 rounded-card bg-surface-container-low px-4 py-3 text-left"
          >
            <Avatar name={user?.display_name ?? ''} size={22} />
            <span className="flex-1 text-body-large">Esci ({user?.email})</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Top app bar: chip switcher del tracker, ricerca, stack avatar. */
export function AppBar({
  tracker,
  greeting,
  onSearch,
}: {
  tracker: Tracker
  greeting?: string
  onSearch?: () => void
}) {
  const navigate = useNavigate()
  const members = activeMembers(tracker)

  return (
    <div className="px-5 pb-2 pt-5 md:px-7">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Chip
            variant="assist"
            icon="swap_horiz"
            label={tracker.name}
            onClick={() => navigate('/')}
          />
          {greeting && (
            <h1 className="mt-3 text-[28px] font-medium leading-9 md:text-headline-small">
              {greeting}
            </h1>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onSearch && (
            <button
              type="button"
              onClick={onSearch}
              aria-label="Cerca"
              className="state hidden h-10 w-10 items-center justify-center rounded-pill bg-surface-container-low text-on-surface-variant md:flex"
            >
              <Icon name="search" size={20} />
            </button>
          )}
          <AvatarStack
            people={members.map((member, index) => ({
              name: member.display_name,
              color: memberColor(index),
            }))}
          />
        </div>
      </div>
    </div>
  )
}
