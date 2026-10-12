import clsx from 'clsx'
import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts'

import { useBalanceHistory, useReconciliation } from '../../api/hooks'
import { Icon, Skeleton } from '../../components/ui'
import { formatDate, monthLabel, todayIso } from '../../lib/format'
import { formatMoney, formatSigned, toCents } from '../../lib/money'
import type { DateRange } from '../../lib/period'
import type { Tracker, UUID } from '../../lib/types'

interface Point {
  date: string
  /** Euro come numero solo per disegnare: i valori mostrati passano da formatMoney. */
  balance: number
  income: number
  expense: number
}

/**
 * Andamento dei soldi: saldo iniziale + entrate − uscite ± pareggi, giorno per
 * giorno, per cassa come la riconciliazione. Il punto "oggi sui conti" e' il
 * saldo reale dichiarato: dove si stacca dalla curva c'e' lo scarto.
 */
export function BalanceCurve({
  tracker,
  range,
  person,
  personName,
  categoryActive,
}: {
  tracker: Tracker
  range: DateRange
  person: UUID | ''
  personName?: string
  categoryActive: boolean
}) {
  const [asTable, setAsTable] = useState(false)
  const history = useBalanceHistory(tracker.id, {
    date_from: range.from,
    date_to: range.to,
    user_id: person || undefined,
  })
  const reconciliation = useReconciliation(tracker.id)

  const today = todayIso()
  // Il futuro non ha movimenti: la curva si ferma a oggi invece di restare piatta.
  const points: Point[] = useMemo(
    () =>
      (history.data?.points ?? [])
        .filter((p) => p.date <= today)
        .map((p) => ({
          date: p.date,
          balance: toCents(p.balance) / 100,
          income: toCents(p.income) / 100,
          expense: toCents(p.expense) / 100,
        })),
    [history.data, today],
  )

  const realFigures = person
    ? reconciliation.data?.people.find((p) => p.user.id === person)
    : reconciliation.data
  const realToday =
    realFigures && today >= range.from && today <= range.to
      ? toCents(realFigures.available_balance) / 100
      : null

  const start = Math.round((points[0]?.balance ?? 0) * 100)
  const end = Math.round((points.at(-1)?.balance ?? 0) * 100)
  const change = end - start
  const spanDays = points.length
  const ticks = useMemo(() => pickTicks(points.map((p) => p.date)), [points])
  const minBalance = Math.min(...points.map((p) => p.balance), realToday ?? Infinity)

  const compact = new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: tracker.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  })

  return (
    <section className="card-m3 p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-title-medium">
            Andamento dei soldi{personName ? ` di ${personName}` : ', tutti insieme'}
          </h2>
          <p className="mt-1 text-body-small text-on-surface-variant">
            Saldo iniziale + entrate − uscite, giorno per giorno. Contano i soldi che passano dai
            conti, come nella riconciliazione.
            {categoryActive && ' Il filtro categoria qui non si applica.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {history.data && (
            <span
              className={clsx(
                'amount inline-flex items-center gap-1 rounded-pill px-3 py-1.5 text-body-medium font-medium',
                change >= 0
                  ? 'bg-secondary-container text-on-secondary-container'
                  : 'bg-error-container text-on-error-container',
              )}
              title={`Da ${formatMoney(start / 100, tracker.currency)} a ${formatMoney(end / 100, tracker.currency)}`}
            >
              <Icon name={change >= 0 ? 'trending_up' : 'trending_down'} size={18} />
              {formatSigned(change / 100, tracker.currency)}
            </span>
          )}
          <button type="button" className="chip-outlined" onClick={() => setAsTable(!asTable)}>
            <Icon name={asTable ? 'show_chart' : 'table_rows'} size={18} />
            {asTable ? 'Grafico' : 'Tabella'}
          </button>
        </div>
      </div>

      {!history.data ? (
        <Skeleton className="h-[280px] rounded-card" />
      ) : asTable ? (
        <MovementDays points={points} currency={tracker.currency} />
      ) : (
        <>
          <div className="h-[280px]" role="img" aria-label="Andamento del saldo nel periodo">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ left: 0, right: 12, top: 8 }}>
                <defs>
                  <linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--outline-variant)" strokeWidth={1} />
                <XAxis
                  dataKey="date"
                  ticks={ticks}
                  tickFormatter={(value: string) => tickLabel(value, spanDays)}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--outline-variant)' }}
                  tick={{ fill: 'var(--on-surface-variant)', fontSize: 12 }}
                />
                <YAxis
                  width={64}
                  tickLine={false}
                  axisLine={false}
                  domain={['auto', 'auto']}
                  tick={{ fill: 'var(--on-surface-variant)', fontSize: 12 }}
                  tickFormatter={(value: number) => compact.format(value)}
                />
                {minBalance < 0 && <ReferenceLine y={0} stroke="var(--outline)" strokeWidth={1} />}
                <Tooltip
                  cursor={{ stroke: 'var(--outline)', strokeWidth: 1 }}
                  content={<CurveTooltip currency={tracker.currency} />}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  fill="url(#balance-fill)"
                  isAnimationActive={false}
                  activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
                />
                {realToday !== null && (
                  <ReferenceDot
                    x={today}
                    y={realToday}
                    r={6}
                    fill="var(--tertiary)"
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-body-small text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded bg-primary" />
              Saldo dai movimenti
            </span>
            {realToday !== null && (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-tertiary" />
                Oggi sui conti: {formatMoney(realToday, tracker.currency)}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  )
}

/** Primo del mese sugli intervalli lunghi, una data a settimana su quelli brevi. */
function pickTicks(dates: string[]): string[] {
  if (dates.length <= 62) return dates.filter((_, i) => i % 7 === 0)
  const monthStarts = dates.filter((d) => d.endsWith('-01'))
  const step = Math.ceil(monthStarts.length / 12)
  return monthStarts.filter((_, i) => i % step === 0)
}

function tickLabel(date: string, spanDays: number): string {
  const [year, month, day] = date.split('-')
  if (spanDays <= 62) return `${Number(day)}/${Number(month)}`
  const label = monthLabel(Number(month)).slice(0, 3)
  return month === '01' ? `${label} ${year.slice(2)}` : label
}

function CurveTooltip({
  active,
  payload,
  currency,
}: TooltipProps<number, string> & { currency: string }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload as Point
  return (
    <div className="rounded-row bg-surface px-3 py-2 text-body-small shadow-fab">
      <p className="mb-1 font-medium">{formatDate(point.date)}</p>
      <p className="flex justify-between gap-4">
        <span className="text-on-surface-variant">Saldo</span>
        <span className="amount font-medium">{formatMoney(point.balance, currency)}</span>
      </p>
      {point.income > 0 && (
        <p className="flex justify-between gap-4">
          <span className="text-on-surface-variant">Entrate del giorno</span>
          <span className="amount text-primary">+{formatMoney(point.income, currency)}</span>
        </p>
      )}
      {point.expense > 0 && (
        <p className="flex justify-between gap-4">
          <span className="text-on-surface-variant">Uscite del giorno</span>
          <span className="amount text-error">−{formatMoney(point.expense, currency)}</span>
        </p>
      )}
    </div>
  )
}

/** Vista tabella: solo i giorni in cui qualcosa si e' mosso. */
function MovementDays({ points, currency }: { points: Point[]; currency: string }) {
  const rows = points.filter((p) => p.income > 0 || p.expense > 0)
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-body-medium text-on-surface-variant">
        Nessun movimento nel periodo.
      </p>
    )
  }
  return (
    <div className="max-h-[320px] overflow-auto">
      <table className="w-full text-body-medium">
        <thead className="sticky top-0 bg-surface-container-low text-left text-body-small text-on-surface-variant">
          <tr>
            <th className="py-2 font-medium">Giorno</th>
            <th className="py-2 text-right font-medium">Entrate</th>
            <th className="py-2 text-right font-medium">Uscite</th>
            <th className="py-2 text-right font-medium">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date} className="border-t border-outline-variant">
              <td className="py-2">{formatDate(row.date)}</td>
              <td className="amount py-2 text-right">
                {row.income ? formatMoney(row.income, currency) : '—'}
              </td>
              <td className="amount py-2 text-right">
                {row.expense ? formatMoney(row.expense, currency) : '—'}
              </td>
              <td className="amount py-2 text-right font-medium">
                {formatMoney(row.balance, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
