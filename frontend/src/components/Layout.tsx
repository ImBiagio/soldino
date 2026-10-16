import clsx from 'clsx'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'

import { useOpenStatements, useTracker, useTrackers } from '../api/hooks'
import { useAuth } from '../lib/auth'
import { memberColor } from '../lib/colors'
import { showsSection } from '../lib/trackerKind'
import type { Membership, Tracker } from '../lib/types'
import { FabMenu } from './FabMenu'
import { Avatar, AvatarStack, Chip, Icon, Modal, Skeleton } from './ui'

const DESTINATIONS = [
  { to: '', label: 'Oggi', icon: 'dashboard', end: true },
  { to: 'movimenti', label: 'Movimenti', icon: 'receipt_long' },
  { to: 'da-rivedere', label: 'Da rivedere', icon: 'inbox' },
  { to: 'conti', label: 'Conti', icon: 'account_balance' },
  { to: 'attese', label: 'In attesa', icon: 'hourglass_top' },
  { to: 'grafici', label: 'Grafici', icon: 'bar_chart' },
  { to: 'abbonamenti', label: 'Ricorrenze', icon: 'autorenew' },
  { to: 'banca', label: 'Banca', icon: 'sync_alt' },
  { to: 'impostazioni', label: 'Setup', icon: 'tune' },
]

/**
 * Sul mobile la bottom bar tiene le prime quattro voci visibili, le altre
 * passano nel menu. In un tracker "group" le voci sono quattro in tutto.
 */
const MOBILE_SLOTS = 4

function destinationsFor(tracker: Tracker) {
  const visible = DESTINATIONS.filter((destination) => showsSection(tracker, destination.to))
  return { all: visible, bar: visible.slice(0, MOBILE_SLOTS), menu: visible.slice(MOBILE_SLOTS) }
}

export function activeMembers(tracker: Tracker): Membership[] {
  return tracker.members.filter((m): m is Membership => m.status === 'active' && !!m.user)
}

const SCAN_SECTIONS = new Set(['scan', 'scontrino', 'voce'])

export function TrackerLayout() {
  const { trackerId } = useParams()
  const { data: tracker, isLoading } = useTracker(trackerId)
  // Il numero accanto a "Da rivedere": bozze pronte o da riprovare.
  const waiting = (useOpenStatements(trackerId).data?.results ?? []).filter(
    (s) => s.status !== 'processing',
  ).length
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

  const destinations = destinationsFor(tracker)
  const section = location.pathname.split('/')[3] ?? ''
  const inMenuSection = destinations.menu.some((destination) => destination.to === section)

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
          {destinations.all.map((destination) => (
            <RailItem
              key={destination.label}
              {...destination}
              badge={destination.to === 'da-rivedere' ? waiting : 0}
            />
          ))}
        </div>
      </nav>

      {/* Su mobile lo spazio in fondo supera barra e "+", che sta a 96px + 56px. */}
      <div
        className={clsx('min-w-0 flex-1 md:pb-0', SCAN_SECTIONS.has(section) ? 'pb-28' : 'pb-44')}
      >
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
      {/* Durante uno scan il "+" coprirebbe la barra di revisione su mobile. */}
      {!SCAN_SECTIONS.has(section) && <FabMenu tracker={tracker} placement="mobile" />}

      <nav
        aria-label="Sezioni"
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex justify-around bg-surface-container-low px-2 pt-3 md:hidden"
      >
        {destinations.bar.map((destination) => (
          <BottomItem
            key={destination.label}
            {...destination}
            badge={destination.to === 'da-rivedere' ? waiting : 0}
          />
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

/** Badge M3 sull'icona: quante cose aspettano. */
function Badge({ count }: { count: number }) {
  if (!count) return null
  return (
    <span className="absolute -top-1 left-8 min-w-[16px] rounded-pill bg-error px-1 text-center text-[11px] font-medium leading-4 text-on-error">
      {count > 99 ? '99+' : count}
    </span>
  )
}

function RailItem({
  to,
  label,
  icon,
  end,
  badge = 0,
}: {
  to: string
  label: string
  icon: string
  end?: boolean
  badge?: number
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
            style={{ width: 56, height: 32, borderRadius: 16, position: 'relative' }}
          >
            <Icon name={icon} size={24} filled={isActive} />
            <Badge count={badge} />
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
  badge = 0,
}: {
  to: string
  label: string
  icon: string
  end?: boolean
  badge?: number
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
            style={{ width: 56, height: 32, borderRadius: 16, position: 'relative' }}
          >
            <Icon name={icon} size={24} filled={isActive} />
            <Badge count={badge} />
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
          {destinationsFor(tracker).menu.map((destination) => (
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
            onClick={() => {
              navigate('/account')
              onClose()
            }}
            className="state flex items-center gap-3 rounded-card bg-surface-container-low px-4 py-3 text-left"
          >
            <Avatar name={user?.display_name ?? ''} size={22} />
            <span className="min-w-0 flex-1 truncate text-body-large">
              Account <span className="text-on-surface-variant">· {user?.email}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => logout()}
            className="state flex items-center gap-3 rounded-card bg-surface-container-low px-4 py-3 text-left"
          >
            <Icon name="logout" size={22} />
            <span className="flex-1 text-body-large">Esci</span>
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
