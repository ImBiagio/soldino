import { useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useCompleteBankConnection } from '../../api/hooks'
import { ErrorBanner, Icon } from '../../components/ui'

/**
 * Ritorno dalla banca: Enable Banking rimanda qui con ``code`` e ``state``.
 * L'URL e' quello registrato nell'applicazione, quindi sta fuori dal tracker:
 * il tracker giusto lo dice il collegamento.
 */
export function BankCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const complete = useCompleteBankConnection()
  const started = useRef(false)

  const code = params.get('code')
  const state = params.get('state')
  const bankError = params.get('error_description') || params.get('error')

  useEffect(() => {
    // StrictMode monta due volte: il codice della banca vale una volta sola.
    if (started.current || !code || !state) return
    started.current = true
    complete.mutate(
      { code, state },
      {
        onSuccess: (connection) =>
          navigate(`/t/${connection.tracker}/banca?collegata=${connection.id}`, { replace: true }),
      },
    )
  }, [code, state, complete, navigate])

  const failed = bankError || (!code && !state) || complete.isError

  return (
    <div className="mx-auto grid max-w-lg gap-4 p-6 pt-16 text-center">
      {failed ? (
        <>
          <Icon name="link_off" size={40} className="mx-auto text-error" />
          <h1 className="text-title-large">Collegamento non riuscito</h1>
          {bankError && <p className="text-body-medium">La banca ha risposto: {bankError}</p>}
          {!bankError && !code && (
            <p className="text-body-medium">Mancano i dati di ritorno dalla banca.</p>
          )}
          <ErrorBanner error={complete.error} />
          <Link to="/" className="btn-filled mx-auto w-fit">
            Torna a Soldino
          </Link>
        </>
      ) : (
        <>
          <Icon name="sync" size={40} className="mx-auto animate-spin text-primary" />
          <h1 className="text-title-large">Collego la banca…</h1>
          <p className="text-body-medium text-on-surface-variant">
            Leggo i conti autorizzati, ci vuole qualche secondo.
          </p>
        </>
      )}
    </div>
  )
}
