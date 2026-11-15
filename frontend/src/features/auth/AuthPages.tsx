import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useAuthConfig } from '../../api/hooks'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { ErrorBanner, Icon, Skeleton } from '../../components/ui'
import { api } from '../../lib/api'
import { loginUrl, useAuth } from '../../lib/auth'
import { gettext, interpolate } from '../../lib/i18n'

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
              {gettext("Il conto della casa, a colpo d'occhio.")}
            </p>
          </div>
        </div>

        <div className="rounded-card bg-surface p-5 text-on-surface sm:p-6">
          <h1 className="mb-4 text-title-medium">{title}</h1>
          {children}
        </div>

        {footer && <div className="mt-4 text-center text-body-medium">{footer}</div>}
        <div className="mt-4 flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  )
}

const AUTO_KEY = 'sso-auto-redirect'

const ERRORS: Record<string, string> = {
  annullato: gettext('Accesso annullato.'),
  scaduto: gettext('Il login ha impiegato troppo: riprova.'),
  stato: gettext("Il login non e' andato a buon fine: riprova."),
  cornhub: gettext("L'account della suite non risponde: riprova tra poco."),
  account: gettext("Questo account non puo' entrare in Soldino."),
}

/**
 * Login e registrazione stanno su cornhub (account unico della suite, ADR
 * 0021): qui solo il bottone, e il redirect automatico se non c'e' un errore
 * da mostrare. Dopo il login cornhub torna sull'API, che apre la sessione e
 * rimanda alla pagina di partenza (``next``).
 */
export function LoginPage() {
  const { user, ready } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('next') || '/'
  const error = params.get('errore')
  const target = loginUrl(next)

  // Redirect automatico al massimo una volta ogni 30 secondi: se dopo il
  // ritorno da cornhub la sessione non parte (cornhub irraggiungibile dal
  // backend, account non piu' valido) si resta qui col bottone, senza un
  // giro infinito tra app e cornhub.
  useEffect(() => {
    if (!ready || user || error) return
    let last = 0
    try {
      last = Number(sessionStorage.getItem(AUTO_KEY) || 0)
    } catch {
      /* storage non disponibile: niente redirect automatico */
      return
    }
    if (Date.now() - last < 30_000) return
    try {
      sessionStorage.setItem(AUTO_KEY, String(Date.now()))
    } catch {
      return
    }
    window.location.assign(target)
  }, [ready, user, error, target])

  if (user) return <Navigate to={next} replace />
  return (
    <Shell title={gettext('Accedi')}>
      <p className="mb-4 text-body-medium text-on-surface-variant">
        {gettext("Si entra con l'account della suite ino: lo stesso per tutte le app.")}
      </p>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-row bg-error-container p-3 text-body-medium text-on-error-container"
        >
          {ERRORS[error] ?? gettext('Accesso non riuscito: riprova.')}
        </p>
      )}
      <a className="btn-filled w-full" href={target}>
        <Icon name="login" size={18} />
        {gettext('Accedi con cornhub')}
      </a>
    </Shell>
  )
}

interface InvitePreview {
  tracker_name: string
  invited_email: string
  role: string
  status: string
}

/**
 * L'invito a un tracker (link della mail): l'anteprima e' pubblica. Chi non
 * e' dentro entra con cornhub e torna qui (``next``); chi non ha un account
 * lo crea su cornhub in un'altra scheda (la registrazione di cornhub non
 * riporta indietro) e poi torna qui ad accedere.
 */
export function AcceptInvitePage() {
  const { token } = useParams()
  const { user, ready } = useAuth()
  const { data: config } = useAuthConfig()
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
      <Shell title={gettext('Invito')}>
        <Skeleton className="h-12" />
      </Shell>
    )
  }

  return (
    <Shell title={gettext('Ti hanno invitato')}>
      <div className="grid gap-3">
        <ErrorBanner error={error} />
        {preview && (
          <div className="rounded-row bg-surface-container p-4">
            <p className="text-body-large font-medium">{preview.tracker_name}</p>
            <p className="text-body-small text-on-surface-variant">
              {interpolate(
                gettext('Invito per %(email)s · ruolo %(role)s'),
                { email: preview.invited_email, role: preview.role },
                true,
              )}
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
            {gettext('Accetta invito')}
          </button>
        ) : (
          <div className="grid gap-2">
            <p className="text-body-medium text-on-surface-variant">
              {gettext("Accedi con l'indirizzo invitato per accettare.")}
            </p>
            <a className="btn-filled w-full" href={loginUrl(`/inviti/${token ?? ''}`)}>
              <Icon name="login" size={18} />
              {gettext('Accedi con cornhub')}
            </a>
            {config && (
              <>
                <a
                  className="btn-outlined w-full"
                  href={config.register_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {gettext('Crea un account su cornhub')}
                </a>
                <p className="text-body-small text-on-surface-variant">
                  {gettext(
                    "Usa lo stesso indirizzo dell'invito. Confermata la mail, torna su questa pagina e premi Accedi.",
                  )}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </Shell>
  )
}
