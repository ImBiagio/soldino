import clsx from 'clsx'
import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'

import {
  useAccounts,
  useDeleteAccount,
  useReconciliation,
  useSaveAccount,
  useUpdateMember,
} from '../../api/hooks'
import { activeMembers } from '../../components/Layout'
import {
  Avatar,
  ErrorBanner,
  Field,
  Icon,
  IconButton,
  IconCircle,
  Modal,
  RowsSkeleton,
  StatusPill,
  Switch,
} from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { formatDate } from '../../lib/format'
import { memberColor } from '../../lib/colors'
import { accountIcon } from '../../lib/icons'
import { ACCOUNT_KIND_LABEL, deltaText } from '../../lib/labels'
import { formatCents, formatMoney, formatSigned, normalizeDecimal, toCents } from '../../lib/money'
import type {
  Account,
  Membership,
  Reconciliation,
  ReconciliationFigures,
  Tracker,
} from '../../lib/types'

export function AccountsPage() {
  const tracker = useOutletContext<Tracker>()
  const members = activeMembers(tracker)
  const accounts = useAccounts(tracker.id)
  const reconciliation = useReconciliation(tracker.id)
  const [adding, setAdding] = useState<Membership | null>(null)

  return (
    <div className="grid gap-5 p-5 md:p-7">
      <div>
        <h1 className="text-title-large">Conti</h1>
        <p className="mt-1 max-w-2xl text-body-medium text-on-surface-variant">
          I saldi veri, aggiornati a mano. Per ognuno: saldo iniziale + entrate − uscite deve
          tornare con conti + in attesa. Se non torna, manca qualcosa nei movimenti.
        </p>
      </div>

      <ErrorBanner error={accounts.error ?? reconciliation.error} />

      {accounts.isLoading ? (
        <RowsSkeleton rows={4} />
      ) : (
        members.map((member, index) => (
          <PersonSection
            key={member.id}
            tracker={tracker}
            member={member}
            color={memberColor(index)}
            accounts={(accounts.data?.results ?? []).filter((a) => a.owner === member.user!.id)}
            figures={reconciliation.data?.people.find((p) => p.user.id === member.user!.id)}
            onAdd={() => setAdding(member)}
          />
        ))
      )}

      {adding && (
        <NewAccountModal tracker={tracker} owner={adding} onClose={() => setAdding(null)} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------- persona -- */

function PersonSection({
  tracker,
  member,
  color,
  accounts,
  figures,
  onAdd,
}: {
  tracker: Tracker
  member: Membership
  color: string
  accounts: Account[]
  figures: Reconciliation['people'][number] | undefined
  onAdd: () => void
}) {
  const { user } = useAuth()
  const save = useSaveAccount(tracker.id)
  const remove = useDeleteAccount(tracker.id)
  const isMe = member.user!.id === user?.id
  const canEditOpening = isMe || tracker.my_role === 'owner'
  const canWrite = tracker.my_role !== 'viewer'

  const included = accounts
    .filter((account) => account.include_in_totals)
    .reduce((sum, account) => sum + toCents(account.current_balance), 0)

  return (
    <section className="rounded-panel bg-surface-container-low p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Avatar name={member.display_name} size={40} color={color} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-title-medium">
            {member.display_name}
            {isMe && <span className="text-on-surface-variant"> · tu</span>}
          </h2>
          <p className="text-body-small text-on-surface-variant">
            {accounts.length} {accounts.length === 1 ? 'conto' : 'conti'} · nei totali{' '}
            <span className="amount">{formatCents(included, tracker.currency)}</span>
          </p>
        </div>
        {figures && (
          <StatusPill ok={toCents(figures.delta) === 0}>
            {deltaText(figures.delta, tracker.currency)}
          </StatusPill>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="grid content-start gap-3">
          <OpeningBalance tracker={tracker} member={member} editable={canEditOpening} />
          {figures && <PersonFormula tracker={tracker} figures={figures} />}
        </div>

        <div className="grid content-start gap-2">
          {accounts.length === 0 && (
            <p className="rounded-nested bg-surface px-4 py-6 text-center text-body-medium text-on-surface-variant">
              Nessun conto. Aggiungine uno per confrontare i soldi veri coi movimenti.
            </p>
          )}
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex flex-wrap items-center gap-3 rounded-nested bg-surface px-4 py-3"
            >
              <IconCircle name={accountIcon(account.kind)} color="var(--tertiary)" size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-large font-medium">{account.name}</p>
                <p className="text-body-small text-on-surface-variant">
                  {ACCOUNT_KIND_LABEL[account.kind]}
                  {account.balance_updated_at &&
                    ` · aggiornato il ${formatDate(account.balance_updated_at.slice(0, 10))}`}
                </p>
              </div>
              <input
                key={account.current_balance}
                className="field-input amount w-32 text-right"
                inputMode="decimal"
                defaultValue={account.current_balance}
                disabled={!canWrite}
                onBlur={(event) => {
                  const value = normalizeDecimal(event.target.value)
                  if (value && value !== account.current_balance) {
                    save.mutate({ id: account.id, current_balance: value })
                  }
                }}
                aria-label={`Saldo di ${account.name}`}
              />
              <Switch
                checked={account.include_in_totals}
                onChange={(checked) => save.mutate({ id: account.id, include_in_totals: checked })}
                label={`${account.name} nei totali`}
              />
              {canWrite && (
                <IconButton
                  icon="close"
                  label={`Elimina ${account.name}`}
                  onClick={() => {
                    if (window.confirm(`Eliminare il conto ${account.name}?`)) {
                      remove.mutate(account.id)
                    }
                  }}
                />
              )}
            </div>
          ))}
          {canWrite && (
            <button type="button" className="btn-tonal btn-sm w-fit" onClick={onAdd}>
              <Icon name="add" size={18} />
              Conto di {member.display_name}
            </button>
          )}
          <ErrorBanner error={save.error ?? remove.error} />
        </div>
      </div>
    </section>
  )
}

function OpeningBalance({
  tracker,
  member,
  editable,
}: {
  tracker: Tracker
  member: Membership
  editable: boolean
}) {
  const update = useUpdateMember(tracker.id)
  const unset = toCents(member.opening_balance) === 0 && !member.opening_date

  return (
    <div
      className={clsx(
        'rounded-nested p-4',
        unset ? 'bg-warning-container text-on-warning-container' : 'bg-surface',
      )}
    >
      <p className="text-body-medium font-medium">Saldo iniziale</p>
      <p className="mb-3 text-body-small opacity-80">
        Quanto c&apos;era su tutti i conti alla data di partenza. Da lì in poi contano i movimenti.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Importo">
          <input
            key={member.opening_balance}
            className="field-input amount text-right"
            inputMode="decimal"
            defaultValue={member.opening_balance}
            disabled={!editable}
            onBlur={(event) => {
              const value = normalizeDecimal(event.target.value)
              if (value && value !== member.opening_balance) {
                update.mutate({ id: member.id, opening_balance: value })
              }
            }}
            aria-label={`Saldo iniziale di ${member.display_name}`}
          />
        </Field>
        <Field label="Dal">
          <input
            key={member.opening_date ?? ''}
            className="field-input"
            type="date"
            defaultValue={member.opening_date ?? ''}
            disabled={!editable}
            onBlur={(event) => {
              const value = event.target.value || null
              if (value !== member.opening_date) {
                update.mutate({ id: member.id, opening_date: value })
              }
            }}
            aria-label={`Data di partenza di ${member.display_name}`}
          />
        </Field>
      </div>
      {!member.opening_date && (
        <p className="mt-2 text-body-small opacity-80">Senza data contano tutti i movimenti.</p>
      )}
      <ErrorBanner error={update.error} />
    </div>
  )
}

/** I due lati della riconciliazione, coi segni: si vede da dove viene il delta. */
export function PersonFormula({
  tracker,
  figures,
}: {
  tracker: Tracker
  figures: ReconciliationFigures
}) {
  const money = (value: string) => formatMoney(value, tracker.currency)
  const signed = (value: string) => formatSigned(value, tracker.currency)

  return (
    <div className="grid gap-3 rounded-nested bg-surface p-4 text-body-medium">
      <div>
        <p className="mb-1 text-label-small uppercase tracking-wide text-on-surface-variant">
          Atteso dai movimenti
        </p>
        <Line label="Saldo iniziale" value={money(figures.opening_balance)} />
        <Line label="+ Entrate incassate" value={money(figures.income)} />
        <Line label="− Spese pagate" value={money(figures.expense)} />
        {toCents(figures.settlements_net) !== 0 && (
          <Line label="± Pareggi" value={signed(figures.settlements_net)} />
        )}
        <Line label="= Atteso" value={money(figures.expected_balance)} strong />
      </div>
      <div>
        <p className="mb-1 text-label-small uppercase tracking-wide text-on-surface-variant">
          Reale
        </p>
        <Line label="Conti" value={money(figures.accounts_balance)} />
        <Line label="+ In attesa" value={signed(figures.pending_total)} />
        <Line label="= Reale" value={money(figures.available_balance)} strong />
      </div>
    </div>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p
      className={clsx(
        'flex justify-between gap-3 py-0.5',
        strong && 'mt-1 border-t border-outline-variant pt-1.5 font-medium',
      )}
    >
      <span className="text-on-surface-variant">{label}</span>
      <span className="amount">{value}</span>
    </p>
  )
}

/* -------------------------------------------------------- nuovo conto -- */

function NewAccountModal({
  tracker,
  owner,
  onClose,
}: {
  tracker: Tracker
  owner: Membership
  onClose: () => void
}) {
  const save = useSaveAccount(tracker.id)

  return (
    <Modal open onClose={onClose} title={`Nuovo conto di ${owner.display_name}`}>
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          await save.mutateAsync({
            name: String(form.get('name')),
            owner: owner.user!.id,
            kind: form.get('kind') as Account['kind'],
            current_balance: normalizeDecimal(String(form.get('balance') || '0')),
          })
          onClose()
        }}
      >
        <ErrorBanner error={save.error} />
        <Field label="Nome">
          <input className="field-input" name="name" required autoFocus placeholder="Hype, BBVA…" />
        </Field>
        <Field label="Tipo">
          <select className="field-input" name="kind" defaultValue="bank">
            {Object.entries(ACCOUNT_KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Saldo attuale">
          <input
            className="field-input amount text-right"
            name="balance"
            inputMode="decimal"
            defaultValue="0.00"
          />
        </Field>
        <button className="btn-filled w-full" disabled={save.isPending}>
          Aggiungi
        </button>
        <p className="text-body-small text-on-surface-variant">
          Il saldo si aggiorna a mano da questa pagina, quando guardi la banca.{' '}
          <Link to={`/t/${tracker.id}/attese`} className="text-primary underline">
            I soldi attesi o già promessi vanno in In attesa.
          </Link>
        </p>
      </form>
    </Modal>
  )
}
