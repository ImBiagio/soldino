import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'

import {
  useBalances,
  useCategories,
  useCreateSettlement,
  useReconciliation,
  useRecurringProposals,
  useSummary,
} from '../../api/hooks'
import { ReconciliationWaterfall } from './ReconciliationWaterfall'
import { AppBar, activeMembers } from '../../components/Layout'
import {
  Avatar,
  CompositeBar,
  DashboardSkeleton,
  ErrorBanner,
  Field,
  Icon,
  IconCircle,
  MemberChips,
  Modal,
  Skeleton,
  StatusPill,
} from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { gettext, interpolate, ngettext } from '../../lib/i18n'
import { monthLabel, todayIso } from '../../lib/format'
import { rangeFor } from '../../lib/period'
import { categoryColor, memberColor } from '../../lib/colors'
import { categoryIcon } from '../../lib/icons'
import { PERIOD_LABEL, deltaText } from '../../lib/labels'
import { formatCents, formatMoney, formatSigned, normalizeDecimal, toCents } from '../../lib/money'
import { isGroup, showsReconciliation, showsSection } from '../../lib/trackerKind'
import type {
  BalancesResponse,
  Membership,
  Reconciliation,
  ReconciliationFigures,
  Tracker,
} from '../../lib/types'

type Transfer = BalancesResponse['suggested_transfers'][number]
type Period = 'month' | 'quarter' | 'year'

const SIDE_BY_SIDE = 'grid content-start gap-4 lg:flex lg:flex-col lg:[&>*:first-child]:flex-1'

export function DashboardPage() {
  const tracker = useOutletContext<Tracker>()
  const { user } = useAuth()
  const members = activeMembers(tracker)
  const [params, setParams] = useSearchParams()
  const now = new Date()
  const [period, setPeriod] = useState<Period>('month')

  // Di default la propria vista; "tutti" e' la dashboard globale del tracker.
  // In un gruppo si parte da "tutti": conta chi deve cosa fra tutti (ADR 0010).
  const group = isGroup(tracker)
  const requested = params.get('vista') ?? (group ? ALL : (user?.id ?? ALL))
  const person = members.find((m) => m.user!.id === requested) ?? null
  const view = person ? person.user!.id : ALL
  const setView = (next: string) => {
    const copy = new URLSearchParams(params)
    copy.set('vista', next)
    setParams(copy, { replace: true })
  }

  // "Trimestre" chiedeva l'anno intero: ora e' il trimestre in corso.
  const quarter = rangeFor('quarter', todayIso())
  const userFilter = person ? { user_id: person.user!.id } : {}
  const summary = useSummary(tracker.id, {
    ...userFilter,
    ...(period === 'month'
      ? { year: now.getFullYear(), month: now.getMonth() + 1 }
      : period === 'quarter'
        ? { date_from: quarter.from, date_to: quarter.to }
        : { year: now.getFullYear() }),
  })
  const balances = useBalances(tracker.id)
  const reconciliation = useReconciliation(tracker.id, showsReconciliation(tracker))
  const figures = person
    ? reconciliation.data?.people.find((p) => p.user.id === person.user!.id)
    : reconciliation.data

  const transfers = (balances.data?.suggested_transfers ?? []).filter(
    (t) => !person || t.from_user.id === view || t.to_user.id === view,
  )

  return (
    <>
      <AppBar
        tracker={tracker}
        greeting={interpolate(gettext('Ciao %(name)s'), { name: user?.display_name ?? '' }, true)}
      />

      <div className="grid gap-5 px-5 pb-8 pt-3 md:px-7">
        {members.length > 1 && <ViewSwitcher tracker={tracker} value={view} onChange={setView} />}

        {figures && <ReconciliationPill tracker={tracker} delta={figures.delta} />}

        <ErrorBanner error={balances.error ?? summary.error ?? reconciliation.error} />

        {balances.isLoading || !balances.data ? (
          <DashboardSkeleton />
        ) : (
          <div
            className={clsx(
              'grid gap-4',
              group ? 'lg:grid-cols-[1.35fr_1fr]' : 'lg:grid-cols-[1fr_1.35fr]',
            )}
          >
            {/* In un gruppo chi deve cosa viene prima, anche su mobile. Su desktop
                il primo riquadro di ogni colonna si allunga: stessa altezza affiancati. */}
            <div className={clsx(SIDE_BY_SIDE, group && 'order-last')}>
              {group ? (
                <GroupTotalCard tracker={tracker} balances={balances.data} person={person} />
              ) : (
                <MonthCard tracker={tracker} person={person} />
              )}
              {showsSection(tracker, 'abbonamenti') && <ProposalsCard tracker={tracker} />}
            </div>

            <div className={SIDE_BY_SIDE}>
              {transfers.length === 0 ? (
                <SettledCard balances={balances.data} tracker={tracker} person={person} />
              ) : (
                transfers.map((transfer, index) => (
                  <HeroCard
                    key={index}
                    tracker={tracker}
                    transfer={transfer}
                    balances={balances.data!}
                  />
                ))
              )}
            </div>
          </div>
        )}

        <SpendingCard
          tracker={tracker}
          period={period}
          onPeriod={setPeriod}
          summary={summary.data}
          loading={summary.isLoading}
          person={person}
        />

        {figures && reconciliation.data && (
          <ReconciliationCard
            tracker={tracker}
            figures={figures}
            people={person ? null : reconciliation.data.people}
            person={person}
            onPerson={setView}
          />
        )}
      </div>
    </>
  )
}

const ALL = 'tutti'

/** "Tutti" e una chip per persona: la scelta resta nell'URL. */
function ViewSwitcher({
  tracker,
  value,
  onChange,
}: {
  tracker: Tracker
  value: string
  onChange: (value: string) => void
}) {
  const { user } = useAuth()
  return (
    <MemberChips
      members={activeMembers(tracker)}
      value={value}
      onChange={onChange}
      labelOf={(member) => (member.user!.id === user?.id ? gettext('Io') : member.display_name)}
      ariaLabel={gettext('Di chi è la dashboard')}
    >
      <button
        type="button"
        onClick={() => onChange(ALL)}
        aria-pressed={value === ALL}
        className={value === ALL ? 'chip-selected' : 'chip-outlined'}
      >
        <Icon name="groups" size={18} />
        {gettext('Tutti')}
      </button>
    </MemberChips>
  )
}

/* ------------------------------------------------- pill riconciliazione -- */

function ReconciliationPill({ tracker, delta }: { tracker: Tracker; delta: string }) {
  const quadra = toCents(delta) === 0

  return (
    <StatusPill ok={quadra} href="#riconciliazione">
      {quadra ? (
        <span>{gettext('Conti e movimenti quadrano')}</span>
      ) : (
        <span>
          {gettext('Conti e movimenti non quadrano per')}{' '}
          <strong className="amount font-semibold">
            {formatCents(Math.abs(toCents(delta)), tracker.currency)}
          </strong>
        </span>
      )}
    </StatusPill>
  )
}

/* ------------------------------------------------------------ card hero -- */

function HeroCard({
  tracker,
  transfer,
  balances,
}: {
  tracker: Tracker
  transfer: Transfer
  balances: BalancesResponse
}) {
  const { user } = useAuth()
  const [settling, setSettling] = useState(false)
  const [detail, setDetail] = useState(false)

  const youOwe = transfer.from_user.id === user?.id
  const youReceive = transfer.to_user.id === user?.id
  const sentence = youOwe
    ? interpolate(gettext('Devi a %(name)s'), { name: transfer.to_user.display_name }, true)
    : youReceive
      ? interpolate(gettext('%(name)s deve a te'), { name: transfer.from_user.display_name }, true)
      : interpolate(
          gettext('%(from)s deve a %(to)s'),
          { from: transfer.from_user.display_name, to: transfer.to_user.display_name },
          true,
        )

  return (
    <section className="rounded-panel bg-primary p-7 text-on-primary">
      <p className="text-body-medium font-medium uppercase tracking-wide text-primary-container">
        {gettext('Chi deve cosa')}
      </p>
      <p className="mt-5 text-[18px] leading-6">{sentence}</p>
      <p className="amount mt-1 text-headline-medium md:text-display-large">
        {formatMoney(transfer.amount, tracker.currency)}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSettling(true)}
          className="state inline-flex items-center gap-2 rounded-pill bg-primary-container px-6 py-3.5 text-body-medium font-medium text-on-primary-container"
        >
          <Icon name="handshake" size={20} />
          {gettext('Segna come saldato')}
        </button>
        <button
          type="button"
          onClick={() => setDetail((open) => !open)}
          className="state inline-flex items-center gap-2 rounded-pill border px-6 py-3.5 text-body-medium font-medium"
          style={{ borderColor: 'rgba(255,255,255,0.5)' }}
        >
          {gettext('Come si compone')}
        </button>
      </div>

      <div
        className="grid transition-all duration-[250ms] ease-m3"
        style={{ gridTemplateRows: detail ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="mt-5 border-t pt-4" style={{ borderColor: 'rgba(255,255,255,0.24)' }}>
            {balances.balances.map((balance, index) => (
              <BalanceRow
                key={balance.user.id}
                tracker={tracker}
                balance={balance}
                color={memberColor(index)}
                showOwed
              />
            ))}
          </div>
        </div>
      </div>

      <SettleModal
        open={settling}
        onClose={() => setSettling(false)}
        tracker={tracker}
        transfer={transfer}
      />
    </section>
  )
}

function SettledCard({
  balances,
  tracker,
  person,
}: {
  balances: BalancesResponse
  tracker: Tracker
  person: Membership | null
}) {
  const rows = person
    ? balances.balances.filter((balance) => balance.user.id === person.user!.id)
    : balances.balances
  return (
    <section className="rounded-panel bg-primary p-7 text-on-primary">
      <p className="text-body-medium font-medium uppercase tracking-wide text-primary-container">
        {gettext('Chi deve cosa')}
      </p>
      <p className="mt-5 text-title-large">
        {person
          ? interpolate(gettext('%(name)s è in pari'), { name: person.display_name }, true)
          : gettext('Siete in pari')}
      </p>
      <div className="mt-5 border-t pt-4" style={{ borderColor: 'rgba(255,255,255,0.24)' }}>
        {rows.map((balance, index) => (
          <BalanceRow
            key={balance.user.id}
            tracker={tracker}
            balance={balance}
            color={memberColor(index)}
          />
        ))}
      </div>
    </section>
  )
}

/** Una persona nel riepilogo dei saldi: quanto ha pagato e il netto. */
function BalanceRow({
  tracker,
  balance,
  color,
  showOwed,
}: {
  tracker: Tracker
  balance: BalancesResponse['balances'][number]
  color: string
  /** Anche la quota di competenza: serve a capire come si compone il debito. */
  showOwed?: boolean
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <Avatar name={balance.user.display_name} size={32} color={color} />
      <span className="min-w-0 flex-1 truncate text-body-medium">
        {balance.user.display_name} · {gettext('pagato')}{' '}
        <span className="amount">{formatMoney(balance.paid, tracker.currency)}</span>
        {showOwed && (
          <>
            {' '}
            · {gettext('di competenza')}{' '}
            <span className="amount">{formatMoney(balance.owed, tracker.currency)}</span>
          </>
        )}
      </span>
      <span className="amount shrink-0 font-semibold">
        {formatSigned(balance.net, tracker.currency)}
      </span>
    </div>
  )
}

function SettleModal({
  open,
  onClose,
  tracker,
  transfer,
}: {
  open: boolean
  onClose: () => void
  tracker: Tracker
  transfer: Transfer
}) {
  // L'importo arriva già precompilato dal trasferimento suggerito: un tap.
  const [amount, setAmount] = useState(transfer.amount)
  const [date, setDate] = useState(todayIso())
  const create = useCreateSettlement(tracker.id)

  return (
    <Modal open={open} onClose={onClose} title={gettext('Segna come saldato')}>
      <form
        className="grid gap-3 text-on-surface"
        onSubmit={async (event) => {
          event.preventDefault()
          await create.mutateAsync({
            from_user: transfer.from_user.id,
            to_user: transfer.to_user.id,
            amount,
            date,
          })
          onClose()
        }}
      >
        <ErrorBanner error={create.error} />
        <p className="text-body-medium text-on-surface-variant">
          {transfer.from_user.display_name} → {transfer.to_user.display_name}.{' '}
          {gettext(
            'Un pareggio azzera il debito e non compare in nessuna statistica per categoria.',
          )}
        </p>
        <Field label={gettext('Importo')}>
          <input
            className="field-input amount text-right"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(normalizeDecimal(event.target.value))}
          />
        </Field>
        <Field label={gettext('Data')}>
          <input
            className="field-input"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <button className="btn-filled mt-1 w-full" disabled={create.isPending}>
          <Icon name="handshake" size={20} />
          {gettext('Registra il pareggio')}
        </button>
      </form>
    </Modal>
  )
}

/* -------------------------------------------------------- card proposte -- */

function ProposalsCard({ tracker }: { tracker: Tracker }) {
  const { proposals, isLoading } = useRecurringProposals(tracker.id)
  if (isLoading || proposals.length === 0) return null

  return (
    <section className="rounded-panel bg-warning-container p-6 text-on-warning-container">
      <div className="flex items-center gap-2">
        <Icon name="inbox" size={22} />
        <p className="text-body-large font-medium">
          {interpolate(
            ngettext(
              '%(count)s ricorrenza da approvare',
              '%(count)s ricorrenze da approvare',
              proposals.length,
            ),
            { count: proposals.length },
            true,
          )}
        </p>
      </div>
      <p className="mt-2 text-body-medium">
        {proposals
          .slice(0, 3)
          .map((rule) => `${rule.title} ${formatMoney(rule.amount, tracker.currency)}`)
          .join(' · ')}
        . {gettext('Nessuna scrittura senza il tuo ok.')}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to="abbonamenti"
          className="state inline-flex items-center rounded-pill bg-on-warning-container px-5 py-2.5 text-body-medium font-medium text-warning-container"
        >
          {gettext('Vedi le proposte')}
        </Link>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------ card mese -- */

function MonthCard({ tracker, person }: { tracker: Tracker; person: Membership | null }) {
  const now = new Date()
  const { data, isLoading } = useSummary(tracker.id, {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    user_id: person?.user?.id,
  })

  if (isLoading || !data) return <Skeleton className="h-[144px] rounded-panel" />

  return (
    <section className="rounded-panel bg-surface-container p-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-label-small uppercase tracking-wide text-on-surface-variant">
          {monthLabel(now.getMonth() + 1)} {now.getFullYear()}
          {person &&
            ' · ' + interpolate(gettext('quota di %(name)s'), { name: person.display_name }, true)}
        </p>
        <Icon name="calendar_month" size={18} className="text-on-surface-variant" />
      </div>
      <p className="text-body-medium text-on-surface-variant">{gettext('Uscite')}</p>
      <p className="amount text-[30px] font-semibold leading-9 text-error">
        {formatMoney(data.total_expense, tracker.currency)}
      </p>
      <p className="mt-2 text-body-medium text-on-surface-variant">{gettext('Entrate')}</p>
      <p className="amount text-[30px] font-semibold leading-9 text-primary">
        {formatMoney(data.total_income, tracker.currency)}
      </p>
      <div className="my-3 h-px bg-outline-variant" />
      <div className="flex items-baseline justify-between">
        <span className="text-body-medium text-on-surface-variant">{gettext('Resta')}</span>
        <span className="amount text-[22px] font-semibold">
          {formatSigned(data.net, tracker.currency)}
        </span>
      </div>
    </section>
  )
}

/* ------------------------------------------- card totale (tracker group) -- */

/** Al posto di entrate/uscite del mese: quanto ha speso il gruppo e chi ha pagato. */
function GroupTotalCard({
  tracker,
  balances,
  person,
}: {
  tracker: Tracker
  balances: BalancesResponse
  person: Membership | null
}) {
  // Senza filtri di periodo: un viaggio si guarda tutto insieme, non per mese.
  const { data, isLoading } = useSummary(tracker.id, { user_id: person?.user?.id })
  const rows = person
    ? balances.balances.filter((balance) => balance.user.id === person.user!.id)
    : balances.balances

  if (isLoading || !data) return <Skeleton className="h-[144px] rounded-panel" />

  return (
    <section className="rounded-panel bg-surface-container p-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-label-small uppercase tracking-wide text-on-surface-variant">
          {gettext('Speso in tutto')}
          {person &&
            ' · ' + interpolate(gettext('quota di %(name)s'), { name: person.display_name }, true)}
        </p>
        <Icon name="payments" size={18} className="text-on-surface-variant" />
      </div>
      <p className="amount text-[30px] font-semibold leading-9 text-error">
        {formatMoney(data.total_expense, tracker.currency)}
      </p>
      <div className="my-3 h-px bg-outline-variant" />
      {rows.map((balance) => (
        <div key={balance.user.id} className="flex items-center gap-3 py-1.5">
          <Avatar
            name={balance.user.display_name}
            size={32}
            color={memberColor(balances.balances.indexOf(balance))}
          />
          <span className="min-w-0 flex-1 truncate text-body-medium">
            {balance.user.display_name}
            <span className="block text-body-small text-on-surface-variant">
              {gettext('quota')}{' '}
              <span className="amount">{formatMoney(balance.owed, tracker.currency)}</span>
            </span>
          </span>
          <span className="text-right">
            <span className="block text-body-small text-on-surface-variant">
              {gettext('ha pagato')}
            </span>
            <span className="amount font-semibold">
              {formatMoney(balance.paid, tracker.currency)}
            </span>
          </span>
        </div>
      ))}
    </section>
  )
}

/* -------------------------------------------------- card "dove sono finiti" */

function SpendingCard({
  tracker,
  period,
  onPeriod,
  summary,
  loading,
  person,
}: {
  tracker: Tracker
  period: Period
  onPeriod: (period: Period) => void
  summary: ReturnType<typeof useSummary>['data']
  loading: boolean
  person: Membership | null
}) {
  const categories = useCategories(tracker.id)
  const byId = useMemo(
    () => new Map((categories.data?.results ?? []).map((c) => [c.id, c])),
    [categories.data],
  )

  const rows = (summary?.by_category ?? []).filter((row) => row.type === 'expense')
  const total = toCents(summary?.total_expense ?? '0')

  return (
    <section className="card-m3 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-title-medium">
          {gettext('Dove sono finiti')}
          {person &&
            ' · ' + interpolate(gettext('quota di %(name)s'), { name: person.display_name }, true)}
        </h2>
        <div className="flex gap-2">
          {(Object.entries(PERIOD_LABEL) as [Period, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onPeriod(id)}
              aria-pressed={period === id}
              className={
                period === id
                  ? 'state rounded-pill bg-primary px-4 py-2 text-body-medium font-medium text-on-primary'
                  : 'chip-outlined'
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Link
        to={`/t/${tracker.id}/grafici?periodo=${period}${person ? `&persona=${person.user!.id}` : ''}`}
        className="state mb-4 inline-flex items-center gap-1 rounded-pill text-body-medium font-medium text-primary"
      >
        {gettext('Grafici, persone e filtri')}
        <Icon name="chevron_right" size={18} />
      </Link>

      {loading ? (
        <Skeleton className="h-[26px] rounded-pill" />
      ) : rows.length === 0 ? (
        <p className="text-body-medium text-on-surface-variant">
          {gettext('Nessun movimento nel periodo.')}
        </p>
      ) : (
        <>
          <CompositeBar
            segments={rows.map((row, index) => ({
              value: toCents(row.total),
              color: categoryColor(byId.get(row.category_id ?? ''), index),
              label: row.category_name,
            }))}
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {rows.slice(0, 4).map((row, index) => {
              const category = byId.get(row.category_id ?? '')
              const color = categoryColor(category, index)
              const share = total > 0 ? Math.round((toCents(row.total) / total) * 100) : 0
              return (
                <div key={`${row.category_id}`} className="rounded-row bg-surface p-4">
                  <IconCircle name={categoryIcon(category)} color={color} size={40} />
                  <p className="mt-3 text-[15px] font-medium">{row.category_name}</p>
                  <p className="amount text-title-medium">
                    {formatMoney(row.total, tracker.currency)}
                  </p>
                  <p className="text-body-small text-on-surface-variant">
                    {share}% ·{' '}
                    {interpolate(
                      ngettext('%(count)s movimento', '%(count)s movimenti', row.count),
                      { count: row.count },
                      true,
                    )}
                  </p>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

/* --------------------------------------------- card riconciliazione estesa */

function ReconciliationCard({
  tracker,
  figures,
  people,
  person,
  onPerson,
}: {
  tracker: Tracker
  figures: ReconciliationFigures
  people: Reconciliation['people'] | null
  person: Membership | null
  onPerson: (userId: string) => void
}) {
  const delta = toCents(figures.delta)
  const noOpening = toCents(figures.opening_balance) === 0

  return (
    <section id="riconciliazione" className="rounded-panel bg-surface-container p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h2 className="text-title-medium">
            {gettext('Riconciliazione')}
            {person && ` · ${person.display_name}`}
          </h2>
          <p className="mt-1 text-body-small text-on-surface-variant">
            {gettext(
              'Saldo iniziale + entrate − uscite deve fare conti + in attesa. Contano i soldi che passano davvero dai conti: spese pagate ed entrate incassate, non le quote.',
            )}
          </p>
        </div>
        <StatusPill ok={delta === 0}>{deltaText(figures.delta, tracker.currency)}</StatusPill>
      </div>

      <p className="mb-5 max-w-2xl text-body-medium">
        {delta === 0
          ? gettext('I conti tornano con i movimenti segnati.')
          : delta < 0
            ? interpolate(
                gettext(
                  'Sui conti ci sono %(amount)s in meno di quanto risulta dai movimenti: probabilmente qualche spesa non è stata segnata.',
                ),
                { amount: formatCents(-delta, tracker.currency) },
                true,
              )
            : interpolate(
                gettext(
                  "Sui conti ci sono %(amount)s in più di quanto risulta dai movimenti: manca un'entrata, o una spesa è stata segnata due volte.",
                ),
                { amount: formatCents(delta, tracker.currency) },
                true,
              )}
      </p>

      <ReconciliationWaterfall figures={figures} currency={tracker.currency} />

      {noOpening && (
        <p className="mt-5 rounded-nested bg-warning-container p-3 text-body-small text-on-warning-container">
          {gettext(
            "Saldo iniziale a zero: se all'inizio sui conti c'erano già dei soldi, lo scarto viene da lì.",
          )}{' '}
          <Link to={`/t/${tracker.id}/conti`} className="font-medium underline">
            {gettext('Impostalo in Conti')}
          </Link>
          .
        </p>
      )}

      {people && (
        <div className="mt-5 grid gap-2 md:grid-cols-2">
          {people.map((row, index) => {
            const rowDelta = toCents(row.delta)
            return (
              <button
                key={row.user.id}
                type="button"
                onClick={() => onPerson(row.user.id)}
                className="state flex items-center gap-3 rounded-row bg-surface px-3 py-2.5 text-left"
              >
                <Avatar name={row.user.display_name} size={32} color={memberColor(index)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-body-medium font-medium">
                      {row.user.display_name}
                    </span>
                    <span
                      className={clsx(
                        'amount shrink-0 text-body-medium font-medium',
                        rowDelta === 0 ? 'text-primary' : 'text-warning',
                      )}
                    >
                      {rowDelta === 0
                        ? gettext('quadra')
                        : formatSigned(row.delta, tracker.currency)}
                    </span>
                  </span>
                  <span className="amount block truncate text-body-small text-on-surface-variant">
                    {gettext('reale')} {formatMoney(row.available_balance, tracker.currency)} ·{' '}
                    {gettext('atteso')} {formatMoney(row.expected_balance, tracker.currency)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
