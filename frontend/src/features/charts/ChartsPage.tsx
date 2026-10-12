import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts'

import { useCategories, useSummary } from '../../api/hooks'
import { activeMembers } from '../../components/Layout'
import {
  Avatar,
  ErrorBanner,
  Icon,
  IconCircle,
  Segmented,
  Skeleton,
  Stat,
} from '../../components/ui'
import { monthLabel, todayIso } from '../../lib/format'
import { categoryColor, categoryIcon, memberColor } from '../../lib/icons'
import { formatMoney, formatSigned, toCents } from '../../lib/money'
import {
  rangeFor,
  rangeLabel,
  shiftRange,
  trailingYear,
  type DateRange,
  type PeriodKind,
} from '../../lib/period'
import type { Summary, SummaryParams, Tracker, TransactionType, UUID } from '../../lib/types'

// Due serie sole, sempre gli stessi colori: entrate = primary, uscite = error.
// Validati con lo script dataviz: separazione CVD nella fascia 6-8, quindi
// servono legenda, etichette e lo spazio fra le barre (mai il colore da solo).
const SERIES = {
  income: { label: 'Entrate', color: 'var(--primary)' },
  expense: { label: 'Uscite', color: 'var(--error)' },
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
  const trendWindow = trailingYear(filters.range.to)
  const trend = useSummary(tracker.id, {
    ...shared,
    date_from: trendWindow.from,
    date_to: trendWindow.to,
  })

  const personName = members.find((m) => m.user!.id === filters.person)?.display_name
  const data = summary.data

  return (
    <div className="grid gap-5 p-5 md:p-7">
      <div>
        <h1 className="text-title-large">Grafici</h1>
        <p className="mt-1 text-body-medium text-on-surface-variant">
          {personName
            ? `La quota di ${personName}: una spesa divisa a metà conta per metà.`
            : 'Tutti i movimenti del tracker, per intero.'}
        </p>
      </div>

      <FilterBar tracker={tracker} filters={filters} />
      <ErrorBanner error={summary.error ?? trend.error} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {!data ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[112px] rounded-panel" />)
        ) : (
          <>
            <Stat
              label="Entrate"
              value={formatMoney(data.total_income, tracker.currency)}
              tone="positive"
              icon="trending_up"
            />
            <Stat
              label="Uscite"
              value={formatMoney(data.total_expense, tracker.currency)}
              tone="negative"
              icon="trending_down"
            />
            <Stat
              label="Netto"
              value={formatSigned(data.net, tracker.currency)}
              icon="balance"
              hint={rangeLabel(filters.kind, filters.range)}
            />
            <Stat
              label="Movimenti"
              value={String(data.transaction_count)}
              icon="receipt_long"
              hint={personName ? `a cui partecipa ${personName}` : undefined}
            />
          </>
        )}
      </div>

      <TrendCard
        tracker={tracker}
        summary={trend.data}
        months={trendWindow.months}
        highlight={filters.kind === 'month' ? filters.range.from.slice(0, 7) : null}
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
          { value: 'month', label: 'Mese' },
          { value: 'quarter', label: 'Trimestre' },
          { value: 'year', label: 'Anno' },
          { value: 'custom', label: 'Date' },
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
            aria-label="Dal"
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
            aria-label="Al"
          />
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="state flex h-10 w-10 items-center justify-center rounded-pill"
            onClick={() => filters.setRange(shiftRange(kind, range, -1))}
            aria-label="Periodo precedente"
          >
            <Icon name="chevron_left" size={22} />
          </button>
          <span className="min-w-[150px] text-center text-body-large font-medium">
            {rangeLabel(kind, range)}
          </span>
          <button
            type="button"
            className="state flex h-10 w-10 items-center justify-center rounded-pill"
            onClick={() => filters.setRange(shiftRange(kind, range, 1))}
            aria-label="Periodo successivo"
          >
            <Icon name="chevron_right" size={22} />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
        <select
          className="field-input w-auto py-2"
          value={filters.person}
          onChange={(event) => filters.setPerson(event.target.value)}
          aria-label="Persona"
        >
          <option value="">Tutte le persone</option>
          {members.map((member) => (
            <option key={member.id} value={member.user!.id}>
              {member.display_name}
            </option>
          ))}
        </select>
        <select
          className="field-input w-auto py-2"
          value={filters.category}
          onChange={(event) => filters.setCategory(event.target.value)}
          aria-label="Categoria"
        >
          <option value="">Tutte le categorie</option>
          <option value="none">Senza categoria</option>
          {(categories.data?.results ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ andamento -- */

interface TrendRow {
  key: string
  label: string
  income: number
  expense: number
}

function TrendCard({
  tracker,
  summary,
  months,
  highlight,
}: {
  tracker: Tracker
  summary: Summary | undefined
  months: string[]
  highlight: string | null
}) {
  const [asTable, setAsTable] = useState(false)

  const rows: TrendRow[] = useMemo(() => {
    const totals = new Map<string, { income: number; expense: number }>()
    for (const row of summary?.by_month ?? []) {
      const key = `${row.year}-${String(row.month).padStart(2, '0')}`
      const entry = totals.get(key) ?? { income: 0, expense: 0 }
      entry[row.type] += toCents(row.total)
      totals.set(key, entry)
    }
    return months.map((key) => {
      const [year, month] = key.split('-').map(Number)
      const entry = totals.get(key) ?? { income: 0, expense: 0 }
      return {
        key,
        label: `${monthLabel(month).slice(0, 3)}${month === 1 ? ` ${String(year).slice(2)}` : ''}`,
        // Euro come numero solo per disegnare: i valori mostrati passano da formatMoney.
        income: entry.income / 100,
        expense: entry.expense / 100,
      }
    })
  }, [summary, months])

  const empty = rows.every((row) => row.income === 0 && row.expense === 0)
  const compact = new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: tracker.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  })

  return (
    <section className="card-m3 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-title-medium">Entrate e uscite, ultimi 12 mesi</h2>
          <Legend />
        </div>
        <button type="button" className="chip-outlined" onClick={() => setAsTable(!asTable)}>
          <Icon name={asTable ? 'bar_chart' : 'table_rows'} size={18} />
          {asTable ? 'Grafico' : 'Tabella'}
        </button>
      </div>

      {!summary ? (
        <Skeleton className="h-[260px] rounded-card" />
      ) : empty ? (
        <p className="py-10 text-center text-body-medium text-on-surface-variant">
          Nessun movimento negli ultimi 12 mesi.
        </p>
      ) : asTable ? (
        <TrendTable rows={rows} currency={tracker.currency} />
      ) : (
        <div className="h-[260px]" role="img" aria-label="Entrate e uscite per mese">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} barGap={2} barCategoryGap="22%" margin={{ left: 0, right: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--outline-variant)" strokeWidth={1} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: 'var(--outline-variant)' }}
                tick={{ fill: 'var(--on-surface-variant)', fontSize: 12 }}
                interval={0}
              />
              <YAxis
                width={64}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--on-surface-variant)', fontSize: 12 }}
                tickFormatter={(value: number) => compact.format(value)}
              />
              <Tooltip
                cursor={{ fill: 'var(--surface-container-high)' }}
                content={<TrendTooltip currency={tracker.currency} />}
              />
              {(['income', 'expense'] as const).map((series) => (
                <Bar
                  key={series}
                  dataKey={series}
                  name={SERIES[series].label}
                  fill={SERIES[series].color}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={18}
                  isAnimationActive={false}
                  // Il mese scelto nei filtri resta pieno, gli altri si attenuano.
                  shape={(props: unknown) => {
                    const { x, y, width, height, payload, fill } = props as {
                      x: number
                      y: number
                      width: number
                      height: number
                      payload: TrendRow
                      fill: string
                    }
                    if (!height) return <g />
                    const dim = highlight !== null && payload.key !== highlight
                    const r = Math.min(4, width / 2, height)
                    return (
                      <path
                        d={`M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`}
                        fill={fill}
                        opacity={dim ? 0.35 : 1}
                      />
                    )
                  }}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}

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

function TrendTooltip({
  active,
  payload,
  currency,
}: TooltipProps<number, string> & { currency: string }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload as TrendRow
  const [year, month] = row.key.split('-').map(Number)
  return (
    <div className="rounded-row bg-surface px-3 py-2 text-body-small shadow-fab">
      <p className="mb-1 font-medium capitalize">
        {monthLabel(month)} {year}
      </p>
      {(['income', 'expense'] as const).map((series) => (
        <p key={series} className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-on-surface-variant">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: SERIES[series].color }}
            />
            {SERIES[series].label}
          </span>
          <span className="amount">{formatMoney(row[series], currency)}</span>
        </p>
      ))}
      <p className="mt-1 flex justify-between gap-4 border-t border-outline-variant pt-1">
        <span className="text-on-surface-variant">Netto</span>
        <span className="amount">{formatSigned(row.income - row.expense, currency)}</span>
      </p>
    </div>
  )
}

function TrendTable({ rows, currency }: { rows: TrendRow[]; currency: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-medium">
        <thead className="text-left text-body-small text-on-surface-variant">
          <tr>
            <th className="py-2 font-medium">Mese</th>
            <th className="py-2 text-right font-medium">Entrate</th>
            <th className="py-2 text-right font-medium">Uscite</th>
            <th className="py-2 text-right font-medium">Netto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const [year, month] = row.key.split('-').map(Number)
            return (
              <tr key={row.key} className="border-t border-outline-variant">
                <td className="py-2 capitalize">
                  {monthLabel(month)} {year}
                </td>
                <td className="amount py-2 text-right">{formatMoney(row.income, currency)}</td>
                <td className="amount py-2 text-right">{formatMoney(row.expense, currency)}</td>
                <td className="amount py-2 text-right">
                  {formatSigned(row.income - row.expense, currency)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
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
        <h2 className="text-title-medium">Per categoria</h2>
        <Segmented<TransactionType>
          value={type}
          onChange={onType}
          options={[
            { value: 'expense', label: 'Uscite' },
            { value: 'income', label: 'Entrate' },
          ]}
        />
      </div>

      {!summary ? (
        <Skeleton className="h-[200px] rounded-card" />
      ) : rows.length === 0 ? (
        <p className="py-6 text-body-medium text-on-surface-variant">
          Nessun movimento nel periodo.
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
                  title={`${row.category_name}: ${formatMoney(row.total, tracker.currency)} · ${row.count} movimenti`}
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
                          width: `${Math.max((cents / max) * 100, 1)}%`,
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
          Tocca di nuovo la categoria per togliere il filtro.
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
        <h2 className="text-title-medium">Per persona</h2>
        <Legend />
      </div>
      <p className="mb-4 text-body-small text-on-surface-variant">
        La quota di ciascuno nel periodo, secondo le divisioni: non chi ha pagato.
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
                        netto {formatSigned((entry.income - entry.expense) / 100, tracker.currency)}
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
                          {formatMoney(entry[series] / 100, tracker.currency)}
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
          Tocca di nuovo la persona per tornare a tutto il tracker.
        </p>
      )}
    </section>
  )
}
