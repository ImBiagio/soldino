import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

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

/** Il login risponde con questo codice se l'email non e' ancora confermata. */
function isUnverified(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.data as { code?: string } | null)?.code === 'email_not_verified'
  )
}

/** Le due mail "a richiesta": rispondono sempre 204, non dicono chi e' registrato. */
export function requestEmail(kind: 'verify' | 'reset', email: string) {
  const path = kind === 'verify' ? '/api/auth/verify-email/resend' : '/api/auth/password-reset'
  return api.post<void>(path, { email })
}

function ResendVerification({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle')
  return (
    <div className="rounded-row bg-surface-container p-4 text-body-medium">
      <p>Prima di entrare conferma l'indirizzo dal link che ti abbiamo mandato.</p>
      <button
        type="button"
        className="btn-tonal btn-sm mt-3"
        disabled={state !== 'idle'}
        onClick={async () => {
          setState('busy')
          await requestEmail('verify', email).catch(() => undefined)
          setState('sent')
        }}
      >
        <Icon name="forward_to_inbox" size={18} />
        {state === 'sent' ? 'Mail rimandata' : 'Rimanda la mail'}
      </button>
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
        {isUnverified(error) ? <ResendVerification email={email} /> : <ErrorBanner error={error} />}
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
        <Link
          to={
            email
              ? `/password-dimenticata?email=${encodeURIComponent(email)}`
              : '/password-dimenticata'
          }
          className="btn-text w-full"
        >
          Password dimenticata?
        </Link>
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

export function ForgotPasswordPage() {
  const [params] = useSearchParams()
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [error, setError] = useState<unknown>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <Shell
      title="Password dimenticata"
      footer={
        <Link className="font-medium text-on-primary underline" to="/accedi">
          Torna al login
        </Link>
      }
    >
      {sent ? (
        <p className="text-body-medium">
          Se <strong>{email}</strong> ha un account, tra poco ti arriva una mail con il link per
          scegliere una nuova password. Il link vale 2 ore. Controlla anche lo spam.
        </p>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError(null)
            try {
              await requestEmail('reset', email)
              setSent(true)
            } catch (err) {
              setError(err)
            } finally {
              setBusy(false)
            }
          }}
        >
          <p className="text-body-medium text-on-surface-variant">
            Scrivi l'email dell'account: ti mandiamo un link per sceglierne una nuova.
          </p>
          <ErrorBanner error={error} />
          <Field label="Email">
            <input
              className="field-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <button className="btn-filled mt-1 w-full" disabled={busy}>
            {busy ? 'Invio…' : 'Mandami il link'}
          </button>
        </form>
      )}
    </Shell>
  )
}

/** Nuova password due volte, con lo stesso controllo locale in login e in Account. */
export function NewPasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  error,
}: {
  password: string
  confirm: string
  onPassword: (value: string) => void
  onConfirm: (value: string) => void
  error?: string
}) {
  const mismatch = confirm.length > 0 && confirm !== password
  return (
    <>
      <Field label="Nuova password" error={error} hint="Almeno 10 caratteri.">
        <input
          className="field-input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => onPassword(event.target.value)}
          required
        />
      </Field>
      <Field label="Ripeti la nuova password" error={mismatch ? 'Non coincide.' : undefined}>
        <input
          className="field-input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => onConfirm(event.target.value)}
          required
        />
      </Field>
    </>
  )
}

export function ResetPasswordPage() {
  const { uid, token } = useParams()
  const { resetPassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  return (
    <Shell title="Nuova password">
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault()
          if (password !== confirm) return
          setBusy(true)
          setError(null)
          try {
            await resetPassword(uid ?? '', token ?? '', password)
            navigate('/', { replace: true })
          } catch (err) {
            setError(err)
          } finally {
            setBusy(false)
          }
        }}
      >
        <ErrorBanner error={error} />
        <NewPasswordFields
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          error={error instanceof ApiError ? error.fieldErrors().new_password : undefined}
        />
        <button className="btn-filled mt-1 w-full" disabled={busy || password !== confirm}>
          {busy ? 'Salvo…' : 'Salva ed entra'}
        </button>
        <Link to="/password-dimenticata" className="btn-text w-full">
          Il link non va? Chiedine uno nuovo
        </Link>
      </form>
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
