// Periodi del riepilogo come coppie di date ISO (YYYY-MM-DD). Si lavora in UTC
// solo per l'aritmetica dei giorni: nessun orario arriva mai all'API.

import { monthLabel } from './format'
import { gettext, interpolate } from './i18n'

export type PeriodKind = 'month' | 'quarter' | 'year' | 'custom'

export interface DateRange {
  from: string
  to: string
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parts(isoDate: string): [number, number, number] {
  const [year, month, day] = isoDate.split('-').map(Number)
  return [year, month, day]
}

/** Il periodo `kind` che contiene `anchor`. */
export function rangeFor(kind: Exclude<PeriodKind, 'custom'>, anchor: string): DateRange {
  const [year, month] = parts(anchor)
  if (kind === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` }
  const firstMonth = kind === 'quarter' ? Math.floor((month - 1) / 3) * 3 + 1 : month
  const span = kind === 'quarter' ? 3 : 1
  return {
    from: iso(new Date(Date.UTC(year, firstMonth - 1, 1))),
    to: iso(new Date(Date.UTC(year, firstMonth - 1 + span, 0))),
  }
}

/** Il periodo precedente (-1) o successivo (+1) dello stesso tipo. */
export function shiftRange(
  kind: Exclude<PeriodKind, 'custom'>,
  range: DateRange,
  step: -1 | 1,
): DateRange {
  const [year, month] = parts(range.from)
  const months = kind === 'year' ? 12 : kind === 'quarter' ? 3 : 1
  return rangeFor(kind, iso(new Date(Date.UTC(year, month - 1 + step * months, 1))))
}

export function rangeLabel(kind: PeriodKind, range: DateRange): string {
  const [year, month] = parts(range.from)
  if (kind === 'year') return String(year)
  if (kind === 'quarter')
    return interpolate(
      gettext('%(quarter)s° trimestre %(year)s'),
      { quarter: Math.floor((month - 1) / 3) + 1, year },
      true,
    )
  if (kind === 'month') return `${monthLabel(month)} ${year}`
  const fmt = (value: string) => value.split('-').reverse().join('/')
  return `${fmt(range.from)} – ${fmt(range.to)}`
}

/** I dodici mesi che finiscono col mese di `to`: la finestra del grafico d'andamento. */
export function trailingYear(to: string): DateRange & { months: string[] } {
  const [year, month] = parts(to)
  const months = Array.from({ length: 12 }, (_, i) =>
    iso(new Date(Date.UTC(year, month - 12 + i, 1))).slice(0, 7),
  )
  return {
    from: `${months[0]}-01`,
    to: iso(new Date(Date.UTC(year, month, 0))),
    months,
  }
}
