import { intlLocale } from './i18n'

/** Nome del mese (1-12) nella lingua dell'interfaccia: "ottobre", "October". */
export function monthLabel(month: number): string {
  if (month < 1 || month > 12) return ''
  return new Intl.DateTimeFormat(intlLocale(), { month: 'long' }).format(
    new Date(2000, month - 1, 1),
  )
}

/** Chiave di raggruppamento: la data e' una stringa YYYY-MM-DD, niente Date. */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

export function monthKeyLabel(key: string): string {
  const [year, month] = key.split('-')
  return `${monthLabel(Number(month))} ${year}`
}

export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

export function todayIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function initials(name: string): string {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
