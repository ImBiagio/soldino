const MONTHS = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
]

export function monthLabel(month: number): string {
  return MONTHS[month - 1] ?? ''
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
