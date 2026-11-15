import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuthConfig } from '../../api/hooks'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { NavOrderModal } from '../../components/NavOrderModal'
import { Avatar, Icon } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { gettext } from '../../lib/i18n'
import { orderDestinations } from '../../lib/navigation'
import type { User } from '../../lib/types'

/**
 * Cio' che e' dell'utente, non di un tracker. Nome, email, password e chiavi
 * AI sono dell'account della suite (cornhub, ADR 0021); qui restano le
 * impostazioni di Soldino: lingua e ordine del menu.
 */
export function AccountPage() {
  const { user, logout } = useAuth()
  if (!user) return null

  return (
    <div className="mx-auto max-w-2xl p-5 md:p-7">
      <div className="panel grid gap-5 sm:p-6 md:p-7">
        <header className="flex flex-wrap items-center gap-3">
          <Link to="/" className="btn-text btn-sm -ml-2" aria-label={gettext('Torna ai tracker')}>
            <Icon name="arrow_back" size={20} />
            {gettext('Tracker')}
          </Link>
          <h1 className="flex-1 text-title-large">{gettext('Account')}</h1>
          <button type="button" className="btn-outlined btn-sm" onClick={() => logout()}>
            <Icon name="logout" size={18} />
            {gettext('Esci')}
          </button>
        </header>

        <ProfileSection user={user} />
        <LanguageSection />
        <MenuSection user={user} />
      </div>
    </div>
  )
}

/**
 * Nome, email e password sono dell'account della suite e si cambiano su
 * cornhub: qui solo come sono adesso (arrivano a ogni login) e i link.
 */
function ProfileSection({ user }: { user: User }) {
  const { data: config } = useAuthConfig()

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <div className="flex items-center gap-3">
        <Avatar name={user.display_name} size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="text-body-large font-medium">{user.display_name}</h2>
          <p className="truncate text-body-small text-on-surface-variant">{user.email}</p>
        </div>
      </div>
      <p className="mt-4 text-body-medium text-on-surface-variant">
        {gettext(
          "Nome, email e password sono dell'account della suite ino: valgono per tutte le app e si cambiano su cornhub. Il nome è quello con cui ti vedono gli altri membri dei tracker.",
        )}
      </p>
      {config && (
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="btn-tonal btn-sm" href={config.account_url}>
            <Icon name="manage_accounts" size={18} />
            {gettext('Account della suite')}
          </a>
          <a className="btn-outlined btn-sm" href={config.ai_url}>
            <Icon name="key" size={18} />
            {gettext('Chiavi e limiti AI')}
          </a>
        </div>
      )}
    </section>
  )
}

/** Ordine delle voci di navigazione: vale in tutti i tracker e su ogni dispositivo. */
function MenuSection({ user }: { user: User }) {
  const [open, setOpen] = useState(false)
  const labels = orderDestinations(user.nav_order).map((destination) => destination.label)

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <h2 className="text-body-large font-medium">{gettext('Menu')}</h2>
      <p className="mt-1 text-body-small text-on-surface-variant">{labels.join(' · ')}</p>
      <button type="button" className="btn-tonal btn-sm mt-3" onClick={() => setOpen(true)}>
        <Icon name="swap_vert" size={18} />
        {gettext('Riordina il menu')}
      </button>
      {open && <NavOrderModal open onClose={() => setOpen(false)} />}
    </section>
  )
}

/** Lingua dell'interfaccia e delle mail, salvata sul profilo. */
function LanguageSection() {
  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <h2 className="text-body-large font-medium">{gettext('Lingua')}</h2>
      <p className="mt-1 text-body-small text-on-surface-variant">
        {gettext("Vale per l'app e per le mail che ti mandiamo.")}
      </p>
      <LanguageSwitcher className="mt-3" />
    </section>
  )
}
