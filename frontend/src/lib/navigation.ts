/**
 * Le sezioni di un tracker e il loro ordine. L'ordine lo sceglie l'utente
 * (`User.nav_order`, salvato sul server cosi' vale su ogni dispositivo) e vale
 * per la rail desktop, la barra in basso e il menu "Altro".
 */

export interface Destination {
  /** Chiave stabile salvata in `nav_order`. */
  key: string
  /** Segmento di URL sotto /t/:id. */
  to: string
  label: string
  icon: string
  end?: boolean
}

/** Ordine predefinito: e' anche quello che si ripristina. */
export const DESTINATIONS: Destination[] = [
  { key: 'oggi', to: '', label: 'Oggi', icon: 'dashboard', end: true },
  { key: 'movimenti', to: 'movimenti', label: 'Movimenti', icon: 'receipt_long' },
  { key: 'da-rivedere', to: 'da-rivedere', label: 'Da rivedere', icon: 'inbox' },
  { key: 'conti', to: 'conti', label: 'Conti', icon: 'account_balance' },
  { key: 'attese', to: 'attese', label: 'In attesa', icon: 'hourglass_top' },
  { key: 'grafici', to: 'grafici', label: 'Grafici', icon: 'bar_chart' },
  { key: 'abbonamenti', to: 'abbonamenti', label: 'Ricorrenze', icon: 'autorenew' },
  { key: 'banca', to: 'banca', label: 'Banca', icon: 'sync_alt' },
  { key: 'impostazioni', to: 'impostazioni', label: 'Setup', icon: 'tune' },
]

/**
 * Sul mobile la bottom bar tiene le prime quattro voci visibili, le altre
 * passano nel menu. In un tracker "group" le voci sono quattro in tutto.
 */
export const MOBILE_SLOTS = 4

/**
 * Le voci nell'ordine dell'utente. Chiavi sconosciute si ignorano; le sezioni
 * che l'ordine salvato non conosce (aggiunte dopo) vanno in coda, nel loro
 * ordine predefinito.
 */
export function orderDestinations(order: readonly string[] | undefined): Destination[] {
  const position = new Map((order ?? []).map((key, index) => [key, index]))
  return [...DESTINATIONS].sort(
    (a, b) =>
      (position.get(a.key) ?? Infinity) - (position.get(b.key) ?? Infinity) ||
      DESTINATIONS.indexOf(a) - DESTINATIONS.indexOf(b),
  )
}

/**
 * Sposta `key` di un posto fra le voci `visible` (quelle che l'utente vede in
 * questo momento) e restituisce l'ordine completo: le voci nascoste, per
 * esempio in un tracker "group", restano dove sono.
 */
export function moveDestination(
  ordered: readonly Destination[],
  visible: ReadonlySet<string>,
  key: string,
  direction: -1 | 1,
): string[] {
  const keys = ordered.map((destination) => destination.key)
  const shown = keys.filter((k) => visible.has(k))
  const from = shown.indexOf(key)
  const neighbour = shown[from + direction]
  if (from < 0 || neighbour === undefined) return keys
  const a = keys.indexOf(key)
  const b = keys.indexOf(neighbour)
  ;[keys[a], keys[b]] = [keys[b], keys[a]]
  return keys
}
