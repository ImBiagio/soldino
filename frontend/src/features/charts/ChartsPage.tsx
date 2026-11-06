import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { useCategories, useSummary, useTransactions } from '../../api/hooks'
import { activeMembers } from '../../components/Layout'
import { CategoryDot, categoryOptions, ChipSelect } from '../../components/selects'
import { BalanceCurve } from './BalanceCurve'
import {
  Avatar,
  ErrorBanner,
  Icon,
  IconButton,
  IconCircle,
  Segmented,
  Skeleton,
  Stat,
} from '../../components/ui'
import { formatDate, todayIso } from '../../lib/format'
import { categoryColor, memberColor } from '../../lib/colors'
import { categoryIcon } from '../../lib/icons'
import { PERIOD_LABEL } from '../../lib/labels'
import { formatCents, formatMoney, formatSigned, formatSignedCents, toCents } from '../../lib/money'
import { rangeFor, rangeLabel, shiftRange, type DateRange, type PeriodKind } from '../../lib/period'
import type {
  Summary,
  SummaryParams,
  Tracker,
  Transaction,
  TransactionType,
  UUID,
} from '../../lib/types'
import { gettext, interpolate, ngettext } from '../../lib/i18n'

// Due serie sole, sempre gli stessi colori: entrate = primary, uscite = error.
// Validati con lo script dataviz: separazione CVD nella fascia 6-8, quindi
// servono legenda, etichette e lo spazio fra le barre (mai il colore da solo).
const SERIES = {
  income: { label: gettext('Entrate'), color: 'var(--primary)' },
  expense: { label: gettext('Uscite'), color: 'var(--error)' },
} as const

/** Filtri nell'URL, come nei movimenti: un grafico si condivide con un link. */
function useChartFilters() {
  const [params, setParams] = useSearchParams()
  const kind = (params.get('periodo') as PeriodKind | null) ?? 'month'
  const anchor = params.get('dal') ?? todayIso()
  const range: DateRange =
    kind === 'custom'
      ? { from: params.get('dal') ?? todayIso(), to: params.get('al') ?? todayIso() }
      : rangeFor(kind, anchor)

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }

  return {
    kind,
    range,
    person: (params.get('persona') as UUID | null) ?? '',
    category: params.get('categoria') ?? '',
    setKind: (value: PeriodKind) =>
      update(
        value === 'custom'
          ? { periodo: value, dal: range.from, al: range.to }
          : { periodo: value, dal: range.from, al: null },
      ),
    setRange: (value: DateRange) =>
      update({ dal: value.from, al: kind === 'custom' ? value.to : null }),
    setPerson: (value: string) => update({ persona: value || null }),
    setCategory: (value: string) => update({ categoria: value || null }),
  }
}

export function ChartsPage() {
  const tracker = useOutletContext<Tracker>()
  const members = activeMembers(tracker)
  const filters = useChartFilters()
  const categories = useCategories(tracker.id)
  const [categoryType, setCategoryType] = useState<TransactionType>('expense')

  const shared: SummaryParams = {
    user_id: filters.person || undefined,
    category: (filters.category as SummaryParams['category']) || undefined,
  }
  const summary = useSummary(tracker.id, {
    ...shared,
    date_from: filters.range.from,
    date_to: filters.range.to,
  })

  const personName = members.find((m) => m.user!.id === filters.person)?.display_name
  const data = summary.data

  return (
    <div className="grid gap-5 p-5 md:p-7">
      <div>
        <h1 className="text-title-large">{gettext('Grafici')}</h1>
        <p className="mt-1 text-body-medium text-on-surface-variant">
          {personName
            ? interpolate(
                gettext('La quota di %(name)s: una spesa divisa a metà conta per metà.'),
                { name: personName },
                true,
              )
            : gettext('Tutti i movimenti del tracker, per intero.')}
        </p>
      </div>

      <FilterBar tracker={tracker} filters={filters} />
      <ErrorBanner error={summary.error} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {!data ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[112px] rounded-panel" />)
        ) : (
          <>
            <Stat
              label={gettext('Entrate')}
              value={formatMoney(data.total_income, tracker.currency)}
              tone="positive"
              icon="trending_up"
            />
            <Stat
              label={gettext('Uscite')}
              value={formatMoney(data.total_expense, tracker.currency)}
              tone="negative"
              icon="trending_down"
            />
            <Stat
              label={gettext('Netto')}
              value={formatSigned(data.net, tracker.currency)}
              icon="balance"
              hint={rangeLabel(filters.kind, filters.range)}
            />
            <Stat
              label={gettext('Movimenti')}
              value={String(data.transaction_count)}
              icon="receipt_long"
              hint={
                personName
                  ? interpolate(gettext('a cui partecipa %(name)s'), { name: personName }, true)
                  : undefined
              }
            />
          </>
        )}
      </div>

      <BalanceCurve
        tracker={tracker}
        range={filters.range}
        person={filters.person}
        personName={personName}
        categoryActive={Boolean(filters.category)}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <CategoryCard
          tracker={tracker}
          summary={data}
          type={categoryType}
          onType={setCategoryType}
          categories={categories.data?.results ?? []}
          selected={filters.category}
          onSelect={filters.setCategory}
        />
        <PeopleCard
          tracker={tracker}
          summary={data}
          selected={filters.person}
          onSelect={filters.setPerson}
        />
      </div>

      {filters.category && (
        <CategoryTransactions
          tracker={tracker}
          filters={filters}
          type={categoryType}
          categoryName={
            filters.category === 'none'
              ? gettext('Senza categoria')
              : (categories.data?.results.find((c) => c.id === filters.category)?.name ?? '')
          }
          personName={personName}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------- filtri -- */

function FilterBar({
  tracker,
  filters,
}: {
  tracker: Tracker
  filters: ReturnType<typeof useChartFilters>
}) {
  const members = activeMembers(tracker)
  const categories = useCategories(tracker.id)
  const { kind, range } = filters

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-panel bg-surface-container-low p-3">
      <Segmented<PeriodKind>
        value={kind}
        onChange={filters.setKind}
        options={[
          { value: 'month', label: PERIOD_LABEL.month },
          { value: 'quarter', label: PERIOD_LABEL.quarter },
          { value: 'year', label: PERIOD_LABEL.year },
          { value: 'custom', label: gettext('Date') },
        ]}
      />

      {kind === 'custom' ? (
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="field-input w-auto py-2"
            value={range.from}
            max={range.to}
            onChange={(event) =>
              event.target.value && filters.setRange({ ...range, from: event.target.value })
            }
            aria-label={gettext('Dal')}
          />
          <span className="text-on-surface-variant">–</span>
          <input
            type="date"
            className="field-input w-auto py-2"
            value={range.to}
            min={range.from}
            onChange={(event) =>
              event.target.value && filters.setRange({ ...range, to: event.target.value })
            }
            aria-label={gettext('Al')}
          />
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <IconButton
            icon="chevron_left"
            label={gettext('Periodo precedente')}
            onClick={() => filters.setRange(shiftRange(kind, range, -1))}
            size="md"
            iconSize={22}
            inheritColor
          />
          <span className="min-w-[150px] text-center text-body-large font-medium">
            {rangeLabel(kind, range)}
          </span>
          <IconButton
            icon="chevron_right"
            label={gettext('Periodo successivo')}
            onClick={() => filters.setRange(shiftRange(kind, range, 1))}
            size="md"
            iconSize={22}
            inheritColor
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
        <ChipSelect
          label={gettext('Persona')}
          allLabel={gettext('Tutte le persone')}
          value={filters.person}
          onChange={filters.setPerson}
          options={members.map((member, index) => ({
            value: member.user!.id,
            label: member.display_name,
            leading: <Avatar name={member.display_name} size={22} color={memberColor(index)} />,
          }))}
        />
        <ChipSelect
          label={gettext('Categoria')}
          allLabel={gettext('Tutte le categorie')}
          value={filters.category}
          onChange={filters.setCategory}
          searchable
          options={[
            { value: 'none', label: gettext('Senza categoria'), leading: <CategoryDot /> },
            ...categoryOptions(categories.data?.results ?? []).map((option) => {
              const category = categories.data?.results.find((c) => c.id === option.value)
              return { ...option, hint: category ? SERIES[category.type].label : undefined }
            }),
          ]}
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ andamento -- */

function Legend() {
  return (
    <div className="mt-1 flex gap-4 text-body-small text-on-surface-variant">
      {(['income', 'expense'] as const).map((series) => (
        <span key={series} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: SERIES[series].color }}
          />
          {SERIES[series].label}
        </span>
      ))}
    </div>
  )
}

/* ----------------------------------------------------------- categorie -- */

function CategoryCard({
  tracker,
  summary,
  type,
  onType,
  categories,
  selected,
  onSelect,
}: {
  tracker: Tracker
  summary: Summary | undefined
  type: TransactionType
  onType: (type: TransactionType) => void
  categories: { id: UUID; color: string; icon: string; name: string }[]
  selected: string
  onSelect: (category: string) => void
}) {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const rows = (summary?.by_category ?? []).filter((row) => row.type === type)
  const total = rows.reduce((sum, row) => sum + toCents(row.total), 0)
  const max = Math.max(...rows.map((row) => toCents(row.total)), 1)

  return (
    <section className="card-m3 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-title-medium">{gettext('Per categoria')}</h2>
        <Segmented<TransactionType>
          value={type}
          onChange={onType}
          options={[
            { value: 'expense', label: gettext('Uscite') },
            { value: 'income', label: gettext('Entrate') },
          ]}
        />
      </div>

      {!summary ? (
        <Skeleton className="h-[200px] rounded-card" />
      ) : rows.length === 0 ? (
        <p className="py-6 text-body-medium text-on-surface-variant">
          {gettext('Nessun movimento nel periodo.')}
        </p>
      ) : (
        <ul className="grid gap-1">
          {rows.map((row, index) => {
            const category = byId.get(row.category_id ?? '')
            const cents = toCents(row.total)
            const id = row.category_id ?? 'none'
            const active = selected === id
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onSelect(active ? '' : id)}
                  aria-pressed={active}
                  title={
                    `${row.category_name}: ${formatMoney(row.total, tracker.currency)} · ` +
                    interpolate(
                      ngettext('%(count)s movimento', '%(count)s movimenti', row.count),
                      { count: row.count },
                      true,
                    )
                  }
                  className={clsx(
                    'state grid w-full grid-cols-[36px_1fr_auto] items-center gap-3 rounded-row px-2 py-2 text-left',
                    active && 'bg-secondary-container',
                  )}
                >
                  <IconCircle
                    name={categoryIcon(category ?? { name: row.category_name, icon: row.icon })}
                    color={categoryColor(category, index)}
                    size={36}
                  />
                  <span className="min-w-0">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-body-medium font-medium">
                        {row.category_name}
                      </span>
                      <span className="text-body-small text-on-surface-variant">
                        {total > 0 ? Math.round((cents / total) * 100) : 0}%
                      </span>
                    </span>
                    {/* Una serie sola: un colore solo per tutte le barre. */}
                    <span className="mt-1 block h-2 rounded-sm bg-surface-container-high">
                      <span
                        className="block h-full rounded-sm"
                        style={{
                          width: Math.max((cents / max) * 100, 1) + '%',
                          background: SERIES[type].color,
                        }}
                      />
                    </span>
                  </span>
                  <span className="amount text-body-medium">
                    {formatMoney(row.total, tracker.currency)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {selected && (
        <p className="mt-3 text-body-small text-on-surface-variant">
          {gettext('Tocca di nuovo la categoria per togliere il filtro.')}
        </p>
      )}
    </section>
  )
}

/* -------------------------------------------------------------- persone -- */

function PeopleCard({
  tracker,
  summary,
  selected,
  onSelect,
}: {
  tracker: Tracker
  summary: Summary | undefined
  selected: string
  onSelect: (person: string) => void
}) {
  const members = activeMembers(tracker)
  const totals = new Map<string, { income: number; expense: number }>()
  for (const row of summary?.by_user ?? []) {
    const entry = totals.get(row.user_id) ?? { income: 0, expense: 0 }
    entry[row.type] += toCents(row.total)
    totals.set(row.user_id, entry)
  }
  const max = Math.max(...[...totals.values()].flatMap((entry) => [entry.income, entry.expense]), 1)

  return (
    <section className="card-m3 p-6">
      <div className="mb-1">
        <h2 className="text-title-medium">{gettext('Per persona')}</h2>
        <Legend />
      </div>
      <p className="mb-4 text-body-small text-on-surface-variant">
        {gettext('La quota di ciascuno nel periodo, secondo le divisioni: non chi ha pagato.')}
      </p>

      {!summary ? (
        <Skeleton className="h-[200px] rounded-card" />
      ) : (
        <ul className="grid gap-2">
          {members.map((member, index) => {
            const entry = totals.get(member.user!.id) ?? { income: 0, expense: 0 }
            const active = selected === member.user!.id
            return (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={() => onSelect(active ? '' : member.user!.id)}
                  aria-pressed={active}
                  className={clsx(
                    'state grid w-full grid-cols-[36px_1fr] items-center gap-3 rounded-row px-2 py-2 text-left',
                    active && 'bg-secondary-container',
                  )}
                >
                  <Avatar name={member.display_name} size={36} color={memberColor(index)} />
                  <span className="min-w-0">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-body-medium font-medium">
                        {member.display_name}
                      </span>
                      <span className="amount text-body-small text-on-surface-variant">
                        {gettext('netto')}{' '}
                        {formatSignedCents(entry.income - entry.expense, tracker.currency)}
                      </span>
                    </span>
                    {(['income', 'expense'] as const).map((series) => (
                      <span
                        key={series}
                        className="mt-1 grid grid-cols-[1fr_auto] items-center gap-2"
                      >
                        <span className="block h-2 rounded-sm bg-surface-container-high">
                          <span
                            className="block h-full rounded-sm"
                            style={{
                              width: `${entry[series] ? Math.max((entry[series] / max) * 100, 1) : 0}%`,
                              background: SERIES[series].color,
                            }}
                          />
                        </span>
                        <span className="amount w-24 text-right text-body-small">
                          {formatCents(entry[series], tracker.currency)}
                        </span>
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {selected && (
        <p className="mt-3 text-body-small text-on-surface-variant">
          {gettext('Tocca di nuovo la persona per tornare a tutto il tracker.')}
        </p>
      )}
    </section>
  )
}

/* ------------------------------------------- movimenti della categoria -- */

/**
 * I movimenti dietro una barra del grafico, con gli stessi filtri: periodo,
 * persona (chi partecipa alla spesa, come nei grafici) e categoria. Con una
 * persona l'importo e' la sua quota, come nei totali sopra.
 */
function CategoryTransactions({
  tracker,
  filters,
  type,
  categoryName,
  personName,
}: {
  tracker: Tracker
  filters: ReturnType<typeof useChartFilters>
  type: TransactionType
  categoryName: string
  personName: string | undefined
}) {
  const ref = useRef<HTMLElement>(null)
  const query: Record<string, string> = {
    category: filters.category,
    date_from: filters.range.from,
    date_to: filters.range.to,
  }
  // "Senza categoria" esiste sia fra le uscite sia fra le entrate.
  if (filters.category === 'none') query.type = type
  if (filters.person) query.split_user = filters.person
  const transactions = useTransactions(tracker.id, { ...query, page_size: 100 })
  const rows: Transaction[] = transactions.data?.results ?? []
  const total = transactions.data?.count ?? 0

  // Si arriva qui con un click sulla categoria, piu' su nella pagina.
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [filters.category])

  const amountOf = (tx: Transaction) =>
    filters.person
      ? (tx.splits.find((split) => split.user === filters.person)?.share_amount ?? tx.amount)
      : tx.amount

  return (
    <section ref={ref} className="card-m3 scroll-mt-4 p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-title-medium">
            {interpolate(gettext('Movimenti in %(name)s'), { name: categoryName }, true)}
          </h2>
          <p className="mt-1 text-body-small text-on-surface-variant">
            {rangeLabel(filters.kind, filters.range)}
            {personName &&
              ' · ' + interpolate(gettext('la quota di %(name)s'), { name: personName }, true)}
            {' · '}
            {interpolate(
              ngettext('%(count)s movimento', '%(count)s movimenti', total),
              { count: total },
              true,
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            to={`../movimenti?${new URLSearchParams(query).toString()}`}
            relative="path"
            className="btn-text btn-sm"
          >
            {gettext('Apri in Movimenti')}
            <Icon name="arrow_forward" size={18} />
          </Link>
          <IconButton
            icon="close"
            label={gettext('Chiudi')}
            onClick={() => filters.setCategory('')}
          />
        </div>
      </div>

      <ErrorBanner error={transactions.error} />
      {transactions.isLoading ? (
        <Skeleton className="h-[160px] rounded-card" />
      ) : rows.length === 0 ? (
        <p className="py-4 text-body-medium text-on-surface-variant">
          {gettext('Nessun movimento nel periodo.')}
        </p>
      ) : (
        <ul className={clsx('grid gap-1', transactions.isFetching && 'opacity-70')}>
          {rows.map((tx) => (
            <li
              key={tx.id}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-row bg-surface px-4 py-2.5"
            >
              <span className="amount w-12 text-body-small text-on-surface-variant">
                {formatDate(tx.date).slice(0, 5)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-body-medium font-medium">{tx.title}</span>
                <span className="block truncate text-body-small text-on-surface-variant">
                  {interpolate(
                    gettext('pagato da %(name)s'),
                    { name: tx.paid_by_detail.display_name },
                    true,
                  )}
                  {tx.account_name ? ` · ${tx.account_name}` : ''}
                </span>
              </span>
              <span
                className={clsx(
                  'amount text-body-medium font-semibold',
                  tx.type === 'income' ? 'text-primary' : 'text-error',
                )}
              >
                {tx.type === 'income' ? '+' : '−'}
                {formatMoney(amountOf(tx), tracker.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {total > rows.length && (
        <p className="mt-3 text-body-small text-on-surface-variant">
          {interpolate(
            gettext('Qui i primi %(count)s: tutti gli altri in Movimenti.'),
            { count: rows.length },
            true,
          )}
        </p>
      )}
    </section>
  )
}
