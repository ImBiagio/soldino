import clsx from 'clsx'
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'

import {
  useAccounts,
  useDeleteAccount,
  useReconciliation,
  useSaveAccount,
  useUpdateMember,
} from '../../api/hooks'
import { NewAccountModal } from './NewAccountModal'
import { useConfirm } from '../../components/ConfirmDialog'
import { activeMembers } from '../../components/Layout'
import {
  Avatar,
  ErrorBanner,
  Field,
  Icon,
  IconButton,
  IconCircle,
  RowsSkeleton,
  StatusPill,
  Switch,
} from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { formatDate } from '../../lib/format'
import { gettext, interpolate, ngettext } from '../../lib/i18n'
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
        <h1 className="text-title-large">{gettext('Conti')}</h1>
        <p className="mt-1 max-w-2xl text-body-medium text-on-surface-variant">
          {gettext(
            'I saldi veri, aggiornati a mano. Per ognuno: saldo iniziale + entrate − uscite deve tornare con conti + in attesa. Se non torna, manca qualcosa nei movimenti.',
          )}
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
  const confirm = useConfirm()
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
        {/* Con un minimo di larghezza la pill dello scarto va a capo invece di schiacciare il nome. */}
        <div className="min-w-[9rem] flex-1">
          <h2 className="truncate text-title-medium">
            {member.display_name}
            {isMe && <span className="text-on-surface-variant"> · {gettext('tu')}</span>}
          </h2>
          <p className="text-body-small text-on-surface-variant">
            {interpolate(
              ngettext('%(count)s conto', '%(count)s conti', accounts.length),
              { count: accounts.length },
              true,
            )}{' '}
            · {gettext('nei totali')}{' '}
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
              {gettext('Nessun conto. Aggiungine uno per confrontare i soldi veri coi movimenti.')}
            </p>
          )}
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex flex-wrap items-center gap-3 rounded-nested bg-surface px-4 py-3"
            >
              <IconCircle name={accountIcon(account.kind)} color="var(--tertiary)" size={40} />
              {/* Su mobile i controlli vanno a capo tutti insieme, a destra. */}
              <div className="min-w-[10rem] flex-1">
                <p className="truncate text-body-large font-medium">{account.name}</p>
                <p className="text-body-small text-on-surface-variant">
                  {ACCOUNT_KIND_LABEL[account.kind]}
                  {account.balance_updated_at &&
                    ' · ' +
                      interpolate(
                        gettext('aggiornato il %(date)s'),
                        { date: formatDate(account.balance_updated_at.slice(0, 10)) },
                        true,
                      )}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-3">
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
                  aria-label={interpolate(
                    gettext('Saldo di %(name)s'),
                    { name: account.name },
                    true,
                  )}
                />
                <Switch
                  checked={account.include_in_totals}
                  onChange={(checked) =>
                    save.mutate({ id: account.id, include_in_totals: checked })
                  }
                  label={interpolate(gettext('%(name)s nei totali'), { name: account.name }, true)}
                />
                {canWrite && (
                  <IconButton
                    icon="close"
                    label={interpolate(gettext('Elimina %(name)s'), { name: account.name }, true)}
                    onClick={async () => {
                      const ok = await confirm({
                        title: interpolate(
                          gettext('Eliminare il conto %(name)s?'),
                          { name: account.name },
                          true,
                        ),
                        confirmLabel: gettext('Elimina'),
                        destructive: true,
                      })
                      if (ok) remove.mutate(account.id)
                    }}
                  />
                )}
              </div>
            </div>
          ))}
          {canWrite && (
            <button type="button" className="btn-tonal btn-sm w-fit" onClick={onAdd}>
              <Icon name="add" size={18} />
              {interpolate(gettext('Conto di %(name)s'), { name: member.display_name }, true)}
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
      <p className="text-body-medium font-medium">{gettext('Saldo iniziale')}</p>
      <p className="mb-3 text-body-small opacity-80">
        {gettext(
          "Quanto c'era su tutti i conti alla data di partenza. Da lì in poi contano i movimenti.",
        )}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label={gettext('Importo')}>
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
            aria-label={interpolate(
              gettext('Saldo iniziale di %(name)s'),
              { name: member.display_name },
              true,
            )}
          />
        </Field>
        <Field label={gettext('Dal')}>
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
            aria-label={interpolate(
              gettext('Data di partenza di %(name)s'),
              { name: member.display_name },
              true,
            )}
          />
        </Field>
      </div>
      {!member.opening_date && (
        <p className="mt-2 text-body-small opacity-80">
          {gettext('Senza data contano tutti i movimenti.')}
        </p>
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
          {gettext('Atteso dai movimenti')}
        </p>
        <Line label={gettext('Saldo iniziale')} value={money(figures.opening_balance)} />
        <Line label={gettext('+ Entrate incassate')} value={money(figures.income)} />
        <Line label={gettext('− Spese pagate')} value={money(figures.expense)} />
        {toCents(figures.settlements_net) !== 0 && (
          <Line label={gettext('± Pareggi')} value={signed(figures.settlements_net)} />
        )}
        <Line label={gettext('= Atteso')} value={money(figures.expected_balance)} strong />
      </div>
      <div>
        <p className="mb-1 text-label-small uppercase tracking-wide text-on-surface-variant">
          {gettext('Reale')}
        </p>
        <Line label={gettext('Conti')} value={money(figures.accounts_balance)} />
        <Line label={gettext('+ In attesa')} value={signed(figures.pending_total)} />
        <Line label={gettext('= Reale')} value={money(figures.available_balance)} strong />
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
