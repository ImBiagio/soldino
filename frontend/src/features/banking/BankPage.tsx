import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'

import {
  useAccounts,
  useAspsps,
  useBankConnections,
  useBankingStatus,
  useDeleteBankConnection,
  useDeleteBankingApp,
  useStartBankConnection,
  useSyncBankAccount,
  useUpdateBankAccount,
} from '../../api/hooks'
import { ErrorBanner, Icon, Modal, RowsSkeleton, Skeleton, Switch } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { formatDate } from '../../lib/format'
import { formatMoney } from '../../lib/money'
import type { Account, Aspsp, BankAccountLink, BankConnection, Tracker } from '../../lib/types'
import { activeMembers } from '../../components/Layout'
import { NewAccountModal } from '../accounts/NewAccountModal'
import { SetupWizard } from './SetupWizard'

/** Sotto questa soglia il consenso va rinnovato presto: lo si dice in giallo. */
const EXPIRY_WARNING_DAYS = 14

export function BankPage() {
  const tracker = useOutletContext<Tracker>()
  const status = useBankingStatus()
  const [setupOpen, setSetupOpen] = useState(false)
  const [picking, setPicking] = useState(false)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5 md:p-7">
      <div>
        <h1 className="text-title-large">Banca</h1>
        <p className="mt-1 max-w-2xl text-body-medium text-on-surface-variant">
          Saldo e movimenti letti dalla banca con l&apos;open banking. I movimenti arrivano in una
          bozza da rivedere come lo scan, oppure si registrano da soli se attivi l&apos;interruttore
          sul conto.
        </p>
      </div>

      <ErrorBanner error={status.error} />
      {status.isLoading || !status.data ? (
        <Skeleton className="h-64 rounded-panel" />
      ) : !status.data.configured || setupOpen ? (
        <SetupWizard
          status={status.data}
          onDone={() => {
            setSetupOpen(false)
            setPicking(true)
          }}
        />
      ) : (
        <>
          <Connections tracker={tracker} onAdd={() => setPicking(true)} />
          <AppInfo onReconfigure={() => setSetupOpen(true)} />
        </>
      )}

      <BankPicker tracker={tracker} open={picking} onClose={() => setPicking(false)} />
    </div>
  )
}

/* -------------------------------------------------------- collegamenti -- */

function Connections({ tracker, onAdd }: { tracker: Tracker; onAdd: () => void }) {
  const connections = useBankConnections(tracker.id)
  const [params] = useSearchParams()
  const justLinked = params.get('collegata')
  const live = (connections.data ?? []).filter((c) => c.status !== 'replaced')

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-title-medium">Banche collegate</h2>
        <button type="button" className="btn-filled" onClick={onAdd}>
          <Icon name="add_link" size={20} />
          Collega una banca
        </button>
      </div>
      <ErrorBanner error={connections.error} />
      {connections.isLoading ? (
        <RowsSkeleton rows={2} />
      ) : live.length === 0 ? (
        <div className="rounded-panel bg-surface-container-low px-6 py-10 text-center">
          <Icon name="account_balance" size={36} className="text-primary" />
          <p className="mt-2 text-title-medium">Nessuna banca collegata</p>
          <p className="mt-1 text-body-medium text-on-surface-variant">
            La tua applicazione è pronta: collega la prima banca e abbina i suoi conti.
          </p>
        </div>
      ) : (
        live.map((connection) => (
          <ConnectionCard
            key={connection.id}
            tracker={tracker}
            connection={connection}
            highlight={connection.id === justLinked}
            onRenew={onAdd}
          />
        ))
      )}
    </section>
  )
}

function daysLeft(validUntil: string | null): number | null {
  if (!validUntil) return null
  return Math.floor((new Date(validUntil).getTime() - Date.now()) / 86_400_000)
}

function ConnectionCard({
  tracker,
  connection,
  highlight,
  onRenew,
}: {
  tracker: Tracker
  connection: BankConnection
  highlight: boolean
  onRenew: () => void
}) {
  const remove = useDeleteBankConnection(tracker.id)
  const left = daysLeft(connection.valid_until)
  const expired = connection.status === 'expired' || (left !== null && left < 0)

  return (
    <article
      className={clsx(
        'grid gap-3 rounded-panel bg-surface-container-low p-4 sm:p-5',
        highlight && 'ring-2 ring-primary',
      )}
    >
      <header className="flex flex-wrap items-center gap-3">
        <BankLogo src={connection.aspsp_logo} name={connection.aspsp_name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-large font-medium">{connection.aspsp_name}</p>
          <p
            className={clsx(
              'text-body-small',
              expired
                ? 'text-error'
                : left !== null && left < EXPIRY_WARNING_DAYS
                  ? 'text-warning'
                  : 'text-on-surface-variant',
            )}
          >
            {expired
              ? 'Consenso scaduto: va rinnovato con la banca'
              : connection.valid_until
                ? `Consenso valido fino al ${formatDate(connection.valid_until.slice(0, 10))}`
                : 'Consenso attivo'}
          </p>
        </div>
        {/* Sul telefono i pulsanti vanno a capo: il nome della banca resta leggibile. */}
        <div className="flex basis-full justify-end gap-1 sm:basis-auto">
          {(expired || (left !== null && left < EXPIRY_WARNING_DAYS)) && (
            <button type="button" className="btn-tonal btn-sm" onClick={onRenew}>
              <Icon name="autorenew" size={18} />
              Rinnova
            </button>
          )}
          <button
            type="button"
            className="btn-text btn-sm"
            disabled={remove.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Scollegare ${connection.aspsp_name}? I movimenti già registrati restano, la sincronizzazione si ferma.`,
                )
              )
                remove.mutate(connection.id)
            }}
          >
            Scollega
          </button>
        </div>
      </header>
      <ErrorBanner error={remove.error} />

      {highlight && connection.accounts.some((a) => !a.account) && (
        <p className="rounded-card bg-secondary-container px-4 py-3 text-body-medium text-on-secondary-container">
          Banca collegata. Ora abbina ogni conto a un conto di Soldino: scegli da quando importare e
          se registrare in automatico.
        </p>
      )}

      <div className="grid gap-2">
        {connection.accounts.map((link) => (
          <AccountRow key={link.id} tracker={tracker} link={link} disabled={expired} />
        ))}
        {connection.accounts.length === 0 && (
          <p className="px-2 text-body-medium text-on-surface-variant">
            La banca non ha restituito conti.
          </p>
        )}
      </div>
    </article>
  )
}

function firstOfMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

const NEW_ACCOUNT = '__nuovo__'

function AccountRow({
  tracker,
  link,
  disabled,
}: {
  tracker: Tracker
  link: BankAccountLink
  disabled: boolean
}) {
  const { user } = useAuth()
  const accounts = useAccounts(tracker.id)
  const [creating, setCreating] = useState(false)
  const update = useUpdateBankAccount(tracker.id)
  const sync = useSyncBankAccount(tracker.id)
  const [syncFrom, setSyncFrom] = useState(link.sync_from ?? firstOfMonth())

  // Solo i conti intestati a me: chi intesta il conto paga le sue righe.
  const mine = useMemo(
    () => (accounts.data?.results ?? []).filter((a: Account) => a.owner === user?.id),
    [accounts.data, user],
  )
  const label = link.name || link.iban || 'Conto'

  const me = activeMembers(tracker).find((m) => m.user?.id === user?.id)
  const assign = async (value: string) => {
    if (value === NEW_ACCOUNT) {
      // Lo stesso modulo della pagina Conti: nome, tipo, saldo, nei totali.
      setCreating(true)
      return
    }
    const accountId = value || null
    await update.mutateAsync({ id: link.id, account: accountId, sync_from: syncFrom })
    // Appena abbinato si legge subito: saldo e primi movimenti senza aspettare stasera.
    if (accountId) sync.mutate(link.id)
  }

  const result = sync.data
  return (
    <div className="grid gap-3 rounded-card bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Icon name="account_balance_wallet" size={22} className="text-on-surface-variant" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-large font-medium">{label}</p>
          {link.iban && (
            <p className="truncate font-mono text-body-small text-on-surface-variant">
              {link.iban}
            </p>
          )}
        </div>
        {link.draft && (
          <Link
            to={`../scan/${link.draft.id}`}
            relative="path"
            className="state inline-flex items-center gap-1.5 rounded-pill bg-warning-container px-3 py-1.5 text-body-medium font-medium text-on-warning-container"
          >
            <Icon name="edit_note" size={18} />
            {link.draft.line_count} da rivedere
            <Icon name="chevron_right" size={18} />
          </Link>
        )}
      </div>

      {/* I due campi restano alti uguali: le note vanno sotto la riga, non dentro. */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-stretch">
        <label className="field block h-full">
          <span className="field-label">Conto in Soldino</span>
          <select
            className="field-input"
            value={link.account ?? ''}
            disabled={disabled || update.isPending}
            onChange={(event) => assign(event.target.value)}
          >
            <option value="">Non abbinato (non si sincronizza)</option>
            {mine.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            <option value={NEW_ACCOUNT}>+ Nuovo conto “{label}”</option>
          </select>
        </label>
        <label className="field block h-full">
          <span className="field-label">Importa movimenti dal</span>
          <input
            type="date"
            className="field-input"
            value={syncFrom}
            max={new Date().toISOString().slice(0, 10)}
            disabled={disabled}
            onChange={(event) => {
              if (!event.target.value) return
              setSyncFrom(event.target.value)
              if (link.account) update.mutate({ id: link.id, sync_from: event.target.value })
            }}
          />
        </label>
        <div className="flex items-center gap-3 md:self-center">
          <Switch
            checked={link.auto_commit}
            label="Registra in automatico"
            disabled={disabled || update.isPending}
            onChange={(checked) => update.mutate({ id: link.id, auto_commit: checked })}
          />
          <span className="text-body-medium">Registra in automatico</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body-small text-on-surface-variant">
        <span className="flex-1">
          {link.auto_commit
            ? 'I movimenti nuovi diventano subito movimenti; i possibili doppioni restano da rivedere.'
            : 'I movimenti nuovi arrivano in una bozza: li rivedi e li registri tu.'}
          {link.account &&
            !link.synced_until &&
            link.last_synced_at &&
            ` Alla prossima sincronizzazione rilegge dal ${formatDate(syncFrom)}; i movimenti già letti non si ripetono.`}
          {link.last_synced_at &&
            ` Ultima lettura ${new Date(link.last_synced_at).toLocaleString('it-IT', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}.`}
        </span>
        <button
          type="button"
          className="btn-text btn-sm"
          disabled={disabled || !link.account || sync.isPending}
          onClick={() => sync.mutate(link.id)}
        >
          <Icon name="sync" size={18} className={clsx(sync.isPending && 'animate-spin')} />
          {sync.isPending ? 'Leggo…' : 'Sincronizza ora'}
        </button>
      </div>

      {result && !sync.isPending && (
        <p className="text-body-medium text-primary">
          {result.balance != null &&
            // PayPal ha conti multivaluta ("XXX"): il saldo e' nella valuta del tracker.
            `Saldo ${formatMoney(result.balance, link.currency === 'XXX' ? tracker.currency : link.currency)}. `}
          {result.committed ? `${result.committed} registrati. ` : ''}
          {result.drafted
            ? `${result.drafted} da rivedere.`
            : !result.committed
              ? result.already_seen
                ? `Nessun movimento nuovo: ${result.already_seen} ${
                    result.already_seen === 1 ? 'era già stato letto' : 'erano già stati letti'
                  } (registrati o tolti in revisione).`
                : 'Nessun movimento nuovo.'
              : ''}
        </p>
      )}
      {/* L'errore della sincronizzazione appena lanciata lo mostra gia' il banner. */}
      {link.last_error && !sync.isPending && !sync.error && (
        <p className="text-body-medium text-error">{link.last_error}</p>
      )}
      <ErrorBanner error={update.error ?? sync.error} />
      {creating && me && (
        <NewAccountModal
          tracker={tracker}
          owner={me}
          defaultName={label.slice(0, 80)}
          fromBank
          onClose={() => setCreating(false)}
          onCreated={(account) => assign(account.id)}
        />
      )}
    </div>
  )
}

function BankLogo({ src, name }: { src: string; name: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-surface-container-high">
        <Icon name="account_balance" size={22} />
      </span>
    )
  }
  return (
    <img
      src={src}
      alt={name}
      className="h-10 w-10 shrink-0 rounded-card bg-white object-contain p-1"
      onError={() => setBroken(true)}
    />
  )
}

/* ------------------------------------------------------- scelta banca -- */

function BankPicker({
  tracker,
  open,
  onClose,
}: {
  tracker: Tracker
  open: boolean
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const aspsps = useAspsps('IT', open)
  const start = useStartBankConnection(tracker.id)
  const [chosen, setChosen] = useState<string | null>(null)

  const filtered = (aspsps.data ?? []).filter((a) =>
    a.name.toLowerCase().includes(query.trim().toLowerCase()),
  )

  const go = async (aspsp: Aspsp) => {
    setChosen(aspsp.name)
    const { url } = await start.mutateAsync(aspsp)
    // Si lascia Soldino: la banca rimanda a /banca/callback a autorizzazione fatta.
    window.location.assign(url)
  }

  return (
    <Modal open={open} onClose={onClose} title="Collega una banca" wide>
      <div className="grid gap-3">
        <p className="text-body-medium text-on-surface-variant">
          Scegli la banca: si apre la sua pagina di autorizzazione, poi torni qui ad abbinare i
          conti. Usa una banca che hai già collegato all&apos;applicazione nel pannello di Enable
          Banking.
        </p>
        <input
          className="field-input rounded-pill bg-surface-container px-4"
          placeholder="Cerca la banca (es. Hype, BBVA, illimity)"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
        <ErrorBanner error={aspsps.error ?? start.error} />
        <div className="grid max-h-[50vh] gap-1 overflow-y-auto">
          {aspsps.isLoading ? (
            <RowsSkeleton rows={6} />
          ) : (
            filtered.map((aspsp) => (
              <button
                key={`${aspsp.country}-${aspsp.name}`}
                type="button"
                disabled={start.isPending}
                onClick={() => go(aspsp)}
                className="state flex items-center gap-3 rounded-card px-3 py-2 text-left"
              >
                <BankLogo src={aspsp.logo} name={aspsp.name} />
                <span className="min-w-0 flex-1 truncate text-body-large">{aspsp.name}</span>
                {aspsp.beta && (
                  <span className="rounded-pill bg-surface-container-high px-2 py-0.5 text-body-small">
                    beta
                  </span>
                )}
                {start.isPending && chosen === aspsp.name ? (
                  <Icon name="progress_activity" size={20} className="animate-spin" />
                ) : (
                  <Icon name="chevron_right" size={20} />
                )}
              </button>
            ))
          )}
          {!aspsps.isLoading && filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-body-medium text-on-surface-variant">
              Nessuna banca con questo nome.
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}

/* --------------------------------------------------------- applicazione -- */

function AppInfo({ onReconfigure }: { onReconfigure: () => void }) {
  const status = useBankingStatus()
  const remove = useDeleteBankingApp()
  const app = status.data?.app
  if (!app) return null
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-panel bg-surface-container-low px-4 py-3 text-body-medium">
      <Icon name="key" size={20} className="text-on-surface-variant" />
      <span className="min-w-0 flex-1">
        Applicazione Enable Banking <strong>{app.name || 'senza nome'}</strong>
        <span className="text-on-surface-variant">
          {' '}
          · {app.environment.toLowerCase()}
          {!app.active && ' · non ancora attiva'}
        </span>
      </span>
      <button type="button" className="btn-text btn-sm" onClick={onReconfigure}>
        Cambia chiave
      </button>
      <button
        type="button"
        className="btn-text btn-sm"
        disabled={remove.isPending}
        onClick={() => {
          if (
            window.confirm(
              'Togliere la chiave? Tutte le banche collegate si scollegano. I movimenti registrati restano.',
            )
          )
            remove.mutate()
        }}
      >
        Rimuovi
      </button>
      <ErrorBanner error={remove.error} />
    </section>
  )
}
