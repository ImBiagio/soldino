import clsx from 'clsx'
import { useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
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
import { formatCents, formatMoney, formatSignedCents, toCents } from '../../lib/money'
import { showsReconciliation } from '../../lib/trackerKind'
import type { DateRange } from '../../lib/period'
import type { Tracker, UUID } from '../../lib/types'
import { gettext, interpolate, intlLocale } from '../../lib/i18n'

interface Point {
  date: string
  /** Euro come numero solo per disegnare: i valori mostrati passano da formatMoney. */
  balance: number
  cash: number
  income: number
  expense: number
}

/**
 * Andamento del patrimonio: saldo iniziale + entrate − la propria quota delle
 * spese, giorno per giorno. Quello anticipato per gli altri resta un credito,
 * quindi la curva non scende quando si paga una spesa condivisa per intero.
 * La linea tratteggiata e' la cassa (come la riconciliazione) e compare solo
 * dove se ne stacca. Il punto "oggi" e' il saldo reale dichiarato piu' gli
 * stessi crediti: dove si stacca dalla curva c'e' lo scarto.
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
  // Nei gruppi niente riconciliazione, quindi niente punto "oggi sui conti".
  const reconciliation = useReconciliation(tracker.id, showsReconciliation(tracker))

  const today = todayIso()
  // Il futuro non ha movimenti: la curva si ferma a oggi invece di restare piatta.
  const points: Point[] = useMemo(
    () =>
      (history.data?.points ?? [])
        .filter((p) => p.date <= today)
        .map((p) => ({
          date: p.date,
          balance: toCents(p.balance) / 100,
          cash: toCents(p.cash) / 100,
          income: toCents(p.income) / 100,
          expense: toCents(p.expense) / 100,
        })),
    [history.data, today],
  )

  const realFigures = person
    ? reconciliation.data?.people.find((p) => p.user.id === person)
    : reconciliation.data
  // I crediti verso gli altri valgono anche sul reale: si aggiungono quelli di oggi.
  const todayPoint = points.at(-1)
  const realToday =
    realFigures && todayPoint && today >= range.from && today <= range.to
      ? (toCents(realFigures.available_balance) +
          toCents(todayPoint.balance) -
          toCents(todayPoint.cash)) /
        100
      : null
  const showsCash = points.some((p) => p.cash !== p.balance)

  // La partenza e' prima del primo giorno, cosi' la variazione ne conta i movimenti.
  const start = toCents(history.data?.start_balance ?? 0)
  const end = todayPoint ? toCents(todayPoint.balance) : start
  const change = end - start
  const spanDays = points.length
  const ticks = useMemo(() => pickTicks(points.map((p) => p.date)), [points])
  const minBalance = Math.min(
    ...points.map((p) => Math.min(p.balance, p.cash)),
    realToday ?? Infinity,
  )

  const compact = new Intl.NumberFormat(intlLocale(), {
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
            {personName
              ? interpolate(
                  gettext('Andamento del patrimonio di %(name)s'),
                  { name: personName },
                  true,
                )
              : gettext('Andamento del patrimonio, tutti insieme')}
          </h2>
          <p className="mt-1 text-body-small text-on-surface-variant">
            {gettext(
              'Saldo iniziale + entrate − la propria quota delle spese, giorno per giorno. Quello che si anticipa per gli altri resta un credito finché non torna.',
            )}
            {categoryActive && ' ' + gettext('Il filtro categoria qui non si applica.')}
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
              title={interpolate(
                gettext('Da %(start)s a %(end)s'),
                {
                  start: formatCents(start, tracker.currency),
                  end: formatCents(end, tracker.currency),
                },
                true,
              )}
            >
              <Icon name={change >= 0 ? 'trending_up' : 'trending_down'} size={18} />
              {formatSignedCents(change, tracker.currency)}
            </span>
          )}
          <button type="button" className="chip-outlined" onClick={() => setAsTable(!asTable)}>
            <Icon name={asTable ? 'show_chart' : 'table_rows'} size={18} />
            {asTable ? gettext('Grafico') : gettext('Tabella')}
          </button>
        </div>
      </div>

      {!history.data ? (
        <Skeleton className="h-[280px] rounded-card" />
      ) : asTable ? (
        <MovementDays points={points} currency={tracker.currency} />
      ) : (
        <>
          <div
            className="h-[280px]"
            role="img"
            aria-label={gettext('Andamento del patrimonio nel periodo')}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} margin={{ left: 0, right: 12, top: 8 }}>
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
                {showsCash && (
                  <Line
                    type="monotone"
                    dataKey="cash"
                    stroke="var(--outline)"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                )}
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
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-body-small text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded bg-primary" />
              {gettext('Patrimonio')}
            </span>
            {showsCash && (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-4 border-t-2 border-dashed border-outline" />
                {gettext('Sui conti, senza i crediti')}
              </span>
            )}
            {realToday !== null && (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-tertiary" />
                {interpolate(
                  gettext('Oggi, conti + crediti: %(amount)s'),
                  { amount: formatMoney(realToday, tracker.currency) },
                  true,
                )}
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
        <span className="text-on-surface-variant">{gettext('Patrimonio')}</span>
        <span className="amount font-medium">{formatMoney(point.balance, currency)}</span>
      </p>
      {point.cash !== point.balance && (
        <p className="flex justify-between gap-4">
          <span className="text-on-surface-variant">{gettext('Sui conti')}</span>
          <span className="amount">{formatMoney(point.cash, currency)}</span>
        </p>
      )}
      {point.income > 0 && (
        <p className="flex justify-between gap-4">
          <span className="text-on-surface-variant">{gettext('Entrate del giorno')}</span>
          <span className="amount text-primary">+{formatMoney(point.income, currency)}</span>
        </p>
      )}
      {point.expense > 0 && (
        <p className="flex justify-between gap-4">
          <span className="text-on-surface-variant">{gettext('Tua quota delle uscite')}</span>
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
        {gettext('Nessun movimento nel periodo.')}
      </p>
    )
  }
  return (
    <div className="max-h-[320px] overflow-auto">
      <table className="w-full text-body-medium">
        <thead className="sticky top-0 bg-surface-container-low text-left text-body-small text-on-surface-variant">
          <tr>
            <th className="py-2 font-medium">{gettext('Giorno')}</th>
            <th className="py-2 text-right font-medium">{gettext('Entrate')}</th>
            <th className="py-2 text-right font-medium">{gettext('Uscite (quota)')}</th>
            <th className="py-2 text-right font-medium">{gettext('Patrimonio')}</th>
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
