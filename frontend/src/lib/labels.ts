// Etichette italiane dei valori enumerati dell'API: un solo posto per liste,
// select e chip.

import { formatSigned, toCents } from './money'
import type { Account, MemberRole, RecurringRule, TransactionType } from './types'

export const ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'Proprietario',
  editor: 'Editor',
  viewer: 'Sola lettura',
}

/** I ruoli assegnabili: il proprietario non si sceglie da un invito o da una select. */
export const ROLE_OPTIONS = (['editor', 'viewer'] as const).map((value) => ({
  value,
  label: ROLE_LABEL[value],
}))

export const TYPE_LABEL: Record<TransactionType, string> = {
  expense: 'Spesa',
  income: 'Entrata',
}

export const TYPE_OPTIONS = (['expense', 'income'] as const).map((value) => ({
  value,
  label: TYPE_LABEL[value],
}))

export const ACCOUNT_KIND_LABEL: Record<Account['kind'], string> = {
  bank: 'Conto corrente',
  card: 'Carta',
  cash: 'Contanti',
  wallet: 'Wallet',
}

/** Minuscole: si leggono dentro una frase ("mensile · 01/11/2026"). */
export const FREQUENCY_LABEL: Record<RecurringRule['frequency'], string> = {
  weekly: 'settimanale',
  monthly: 'mensile',
  yearly: 'annuale',
  custom: 'personalizzata',
}

/** Le frequenze che si creano dalla UI; "personalizzata" arriva solo dall'API. */
export const FREQUENCY_OPTIONS = (['weekly', 'monthly', 'yearly'] as const).map((value) => ({
  value,
  label: FREQUENCY_LABEL[value].charAt(0).toUpperCase() + FREQUENCY_LABEL[value].slice(1),
}))

export const PERIOD_LABEL = {
  month: 'Mese',
  quarter: 'Trimestre',
  year: 'Anno',
} as const

/** Lo scarto della riconciliazione in una parola: "Quadra" o "Scarto +12,00 €". */
export function deltaText(delta: string, currency: string): string {
  return toCents(delta) === 0 ? 'Quadra' : `Scarto ${formatSigned(delta, currency)}`
}
