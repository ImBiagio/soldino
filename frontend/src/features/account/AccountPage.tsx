import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Avatar, ErrorBanner, Field, Icon, PasswordInput } from '../../components/ui'
import { ApiError, api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { User } from '../../lib/types'
import { NewPasswordFields, requestEmail } from '../auth/AuthPages'

/** Profilo, stato dell'email e password: tutto cio' che e' dell'utente, non di un tracker. */
export function AccountPage() {
  const { user, logout } = useAuth()
  if (!user) return null

  return (
    <div className="mx-auto max-w-2xl p-5 md:p-7">
      <div className="panel grid gap-5 sm:p-6 md:p-7">
        <header className="flex flex-wrap items-center gap-3">
          <Link to="/" className="btn-text btn-sm -ml-2" aria-label="Torna ai tracker">
            <Icon name="arrow_back" size={20} />
            Tracker
          </Link>
          <h1 className="flex-1 text-title-large">Account</h1>
          <button type="button" className="btn-outlined btn-sm" onClick={() => logout()}>
            <Icon name="logout" size={18} />
            Esci
          </button>
        </header>

        <ProfileSection user={user} />
        <EmailSection user={user} />
        <PasswordSection user={user} />
      </div>
    </div>
  )
}

function ProfileSection({ user }: { user: User }) {
  const { setUser } = useAuth()
  const [name, setName] = useState(user.display_name)
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <div className="mb-4 flex items-center gap-3">
        <Avatar name={user.display_name} size={44} />
        <div className="min-w-0">
          <h2 className="text-body-large font-medium">Profilo</h2>
          <p className="text-body-small text-on-surface-variant">
            Il nome con cui ti vedono gli altri membri dei tracker.
          </p>
        </div>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (event) => {
          event.preventDefault()
          setError(null)
          setSaved(false)
          try {
            setUser(await api.patch<User>('/api/me', { display_name: name.trim() }))
            setSaved(true)
          } catch (err) {
            setError(err)
          }
        }}
      >
        <Field label="Nome" className="min-w-[220px] flex-1">
          <input
            className="field-input"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setSaved(false)
            }}
            required
          />
        </Field>
        <button className="btn-tonal" disabled={!name.trim() || name.trim() === user.display_name}>
          {saved ? 'Salvato' : 'Salva'}
        </button>
      </form>
      <ErrorBanner error={error} />
    </section>
  )
}

function EmailSection({ user }: { user: User }) {
  const [sent, setSent] = useState(false)
  const verified = Boolean(user.email_verified_at)

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <h2 className="text-body-large font-medium">Email</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-body-large">{user.email}</span>
        <span
          className={
            verified
              ? 'inline-flex items-center gap-1.5 rounded-pill bg-secondary-container px-3 py-1.5 text-body-small font-medium text-on-secondary-container'
              : 'inline-flex items-center gap-1.5 rounded-pill bg-warning-container px-3 py-1.5 text-body-small font-medium text-on-warning-container'
          }
        >
          <Icon name={verified ? 'verified' : 'mark_email_unread'} size={16} />
          {verified ? 'Confermata' : 'Da confermare'}
        </span>
      </div>
      {!verified && (
        <button
          type="button"
          className="btn-tonal btn-sm mt-3"
          disabled={sent}
          onClick={async () => {
            await requestEmail('verify', user.email).catch(() => undefined)
            setSent(true)
          }}
        >
          <Icon name="forward_to_inbox" size={18} />
          {sent ? 'Mail mandata' : 'Rimanda la mail di conferma'}
        </button>
      )}
    </section>
  )
}

function PasswordSection({ user }: { user: User }) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [changed, setChanged] = useState(false)
  const [linkSent, setLinkSent] = useState(false)
  const fields = error instanceof ApiError ? error.fieldErrors() : {}

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <h2 className="text-body-large font-medium">Password</h2>
      <p className="mt-1 text-body-small text-on-surface-variant">
        Cambiandola si chiudono le sessioni aperte sugli altri dispositivi; questa resta aperta.
      </p>

      {changed && (
        <p className="mt-3 flex items-center gap-2 rounded-row bg-secondary-container px-4 py-3 text-body-medium text-on-secondary-container">
          <Icon name="check_circle" size={20} />
          Password cambiata.
        </p>
      )}

      <form
        className="mt-4 grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault()
          if (password !== confirm) return
          setBusy(true)
          setError(null)
          setChanged(false)
          try {
            await api.post<void>('/api/auth/password', {
              current_password: current,
              new_password: password,
            })
            setCurrent('')
            setPassword('')
            setConfirm('')
            setChanged(true)
          } catch (err) {
            setError(err)
          } finally {
            setBusy(false)
          }
        }}
      >
        {!fields.current_password && !fields.new_password && <ErrorBanner error={error} />}
        <Field label="Password attuale" error={fields.current_password}>
          <PasswordInput
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
            required
          />
        </Field>
        <NewPasswordFields
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          error={fields.new_password}
        />
        <button className="btn-filled" disabled={busy || !current || password !== confirm}>
          {busy ? 'Salvo…' : 'Cambia password'}
        </button>
      </form>

      <div className="mt-5 border-t border-outline-variant pt-4">
        <p className="text-body-medium">Non ricordi quella attuale?</p>
        <p className="text-body-small text-on-surface-variant">
          Ti mandiamo a {user.email} un link per reimpostarla, valido 2 ore.
        </p>
        <button
          type="button"
          className="btn-tonal btn-sm mt-3"
          disabled={linkSent}
          onClick={async () => {
            await requestEmail('reset', user.email).catch(() => undefined)
            setLinkSent(true)
          }}
        >
          <Icon name="lock_reset" size={18} />
          {linkSent ? 'Link mandato, controlla la mail' : 'Mandami il link di reset'}
        </button>
      </div>
    </section>
  )
}
