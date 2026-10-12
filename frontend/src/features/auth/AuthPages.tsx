import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { ErrorBanner, Field, Icon, Skeleton } from '../../components/ui'
import { ApiError, api } from '../../lib/api'
import { useAuth } from '../../lib/auth'

/** Pagina piena: pannello primary con il marchio, card chiara con il form. */
function Shell({
  title,
  children,
  footer,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md rounded-panel bg-primary p-6 text-on-primary sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <img src="/logo-mark.png" alt="" width={64} height={48} className="h-12 w-auto" />
          <div>
            <p className="text-[34px] font-semibold leading-none">Soldino</p>
            <p className="mt-1 text-body-medium text-primary-container">
              Il conto della casa, a colpo d'occhio.
            </p>
          </div>
        </div>

        <div className="rounded-card bg-surface p-5 text-on-surface sm:p-6">
          <h1 className="mb-4 text-title-medium">{title}</h1>
          {children}
        </div>

        {footer && <div className="mt-4 text-center text-body-medium">{footer}</div>}
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
    <Shell
      title="Accedi"
      footer={
        <span className="text-primary-container">
          Non hai un account?{' '}
          <Link className="font-medium text-on-primary underline" to="/registrati">
            Registrati
          </Link>
        </span>
      }
    >
      <form
        className="grid gap-3"
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
            className="field-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label="Password">
          <input
            className="field-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <button className="btn-filled mt-1 w-full" disabled={busy}>
          {busy ? 'Accesso…' : 'Entra'}
        </button>
      </form>
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
    <Shell
      title="Crea un account"
      footer={
        <span className="text-primary-container">
          Hai già un account?{' '}
          <Link className="font-medium text-on-primary underline" to="/accedi">
            Accedi
          </Link>
        </span>
      }
    >
      {message ? (
        <div className="grid gap-3">
          <p className="text-body-medium">{message}</p>
          <Link className="btn-tonal w-full" to="/accedi">
            Torna al login
          </Link>
        </div>
      ) : (
        <form
          className="grid gap-3"
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
              className="field-input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Come ti chiamano"
            />
          </Field>
          <Field label="Email">
            <input
              className="field-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field
            label="Password"
            error={error instanceof ApiError ? error.fieldErrors().password : undefined}
            hint="Almeno 10 caratteri."
          >
            <input
              className="field-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          <button className="btn-filled mt-1 w-full" disabled={busy}>
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
      {error ? <ErrorBanner error={error} /> : <Skeleton className="h-12" />}
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

  if (!ready) {
    return (
      <Shell title="Invito">
        <Skeleton className="h-12" />
      </Shell>
    )
  }

  return (
    <Shell title="Ti hanno invitato">
      <div className="grid gap-3">
        <ErrorBanner error={error} />
        {preview && (
          <div className="rounded-row bg-surface-container p-4">
            <p className="text-body-large font-medium">{preview.tracker_name}</p>
            <p className="text-body-small text-on-surface-variant">
              Invito per {preview.invited_email} · ruolo {preview.role}
            </p>
          </div>
        )}
        {user ? (
          <button
            type="button"
            className="btn-filled w-full"
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
            <Icon name="check" size={20} />
            Accetta invito
          </button>
        ) : (
          <div className="grid gap-2">
            <p className="text-body-medium text-on-surface-variant">
              Accedi con l'indirizzo invitato per accettare.
            </p>
            <Link className="btn-filled w-full" to="/accedi">
              Accedi
            </Link>
            <Link className="btn-outlined w-full" to="/registrati">
              Crea un account
            </Link>
          </div>
        )}
      </div>
    </Shell>
  )
}
