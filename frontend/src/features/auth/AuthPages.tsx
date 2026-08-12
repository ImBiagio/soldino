import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { ErrorBanner, Field, Spinner } from '../../components/ui'
import { ApiError, api } from '../../lib/api'
import { useAuth } from '../../lib/auth'

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Soldino</h1>
        <p className="mt-1 text-sm text-ink-500">{subtitle ?? 'Le spese di casa, in chiaro.'}</p>
      </div>
      <div className="card space-y-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function LoginPage() {
  const { login, user } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  return (
    <Shell title="Accedi">
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setError(null)
          try {
            await login(email, password)
          } catch (err) {
            setError(err)
          } finally {
            setBusy(false)
          }
        }}
      >
        <ErrorBanner error={error} />
        <Field label="Email">
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Password">
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Accesso…' : 'Entra'}
        </button>
      </form>
      <p className="text-sm text-ink-500">
        Non hai un account?{' '}
        <Link className="text-indigo-600 hover:underline" to="/registrati">
          Registrati
        </Link>
      </p>
    </Shell>
  )
}

export function RegisterPage() {
  const { register, user } = useAuth()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  return (
    <Shell title="Crea un account">
      {message ? (
        <div className="space-y-3">
          <p className="text-sm">{message}</p>
          <Link className="btn-ghost w-full" to="/accedi">
            Torna al login
          </Link>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError(null)
            try {
              setMessage(await register(email, password, displayName))
            } catch (err) {
              setError(err)
            } finally {
              setBusy(false)
            }
          }}
        >
          <ErrorBanner error={error} />
          <Field label="Nome">
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Come ti chiamano"
            />
          </Field>
          <Field label="Email">
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Password"
            error={error instanceof ApiError ? error.fieldErrors().password : undefined}
            hint="Almeno 10 caratteri."
          >
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Creazione…' : 'Crea account'}
          </button>
        </form>
      )}
    </Shell>
  )
}

export function VerifyEmailPage() {
  const { token } = useParams()
  const { verifyEmail } = useAuth()
  const [error, setError] = useState<unknown>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) return
    verifyEmail(token)
      .then(() => setDone(true))
      .catch(setError)
  }, [token, verifyEmail])

  if (done) return <Navigate to="/" replace />
  return (
    <Shell title="Conferma email">
      {error ? <ErrorBanner error={error} /> : <Spinner label="Verifica in corso…" />}
    </Shell>
  )
}

interface InvitePreview {
  tracker_name: string
  invited_email: string
  role: string
  status: string
}

export function AcceptInvitePage() {
  const { token } = useParams()
  const { user, ready } = useAuth()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    api.get<InvitePreview>(`/api/invites/${token}`).then(setPreview).catch(setError)
  }, [token])

  if (!ready) return <Spinner />

  return (
    <Shell title="Invito" subtitle="Ti hanno invitato su un tracker condiviso.">
      <ErrorBanner error={error} />
      {preview && (
        <div className="space-y-1 text-sm">
          <p>
            Tracker: <strong>{preview.tracker_name}</strong>
          </p>
          <p className="text-ink-500">
            Invito per {preview.invited_email} · ruolo {preview.role}
          </p>
        </div>
      )}
      {user ? (
        <button
          className="btn-primary w-full"
          disabled={busy || !preview}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await api.post(`/api/invites/${token}/accept`)
              navigate('/')
            } catch (err) {
              setError(err)
            } finally {
              setBusy(false)
            }
          }}
        >
          Accetta invito
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-ink-500">Accedi con l'indirizzo invitato per accettare.</p>
          <Link className="btn-primary w-full" to="/accedi">
            Accedi
          </Link>
          <Link className="btn-ghost w-full" to="/registrati">
            Crea un account
          </Link>
        </div>
      )}
    </Shell>
  )
}
