/**
 * Avanzamento della prossima occorrenza di una ricorrenza.
 *
 * ⚠️ Duplica `RecurringRule.advance()` del backend. Serve finché non esiste
 * l'endpoint di approvazione delle proposte (`POST …/recurring/{id}/approve`):
 * appena c'è, questo file va cancellato, non tenuto allineato a mano.
 * La frequenza `custom` (rrule) non è replicabile qui e non viene gestita.
 */

import type { RecurringRule } from './types'

export function canAdvanceClientSide(rule: RecurringRule): boolean {
  return rule.frequency !== 'custom'
}

export function nextRun(rule: RecurringRule): string | null {
  if (!canAdvanceClientSide(rule)) return null
  const [year, month, day] = rule.next_run.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  switch (rule.frequency) {
    case 'weekly':
      date.setUTCDate(date.getUTCDate() + 7)
      break
    case 'monthly':
      addMonths(date, 1)
      break
    case 'yearly':
      addMonths(date, 12)
      break
  }
  return date.toISOString().slice(0, 10)
}

/** Come relativedelta: il 31 gennaio + 1 mese è il 28/29 febbraio, non il 3 marzo. */
function addMonths(date: Date, months: number) {
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
}
