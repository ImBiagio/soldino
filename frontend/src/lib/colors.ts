// Unica palette dei colori "dati" (membri, categorie): sono valori che finiscono
// in `style`, non classi Tailwind, e devono restare coerenti fra le schermate.

import type { Category, TransactionType } from './types'

/** I membri hanno un colore stabile per posizione: serve alla barra di split. */
export const MEMBER_COLORS = ['#1b6c2f', '#38656a', '#7d5700', '#74796f', '#8b4a62']

/** Colore di fallback quando la categoria non ne ha uno: i primi quattro dei membri. */
export const CATEGORY_FALLBACK_COLORS = MEMBER_COLORS.slice(0, 4)

/** Gli stessi del backend (`Category.DEFAULT_COLORS`): verde entrate, rosso uscite. */
export const DEFAULT_CATEGORY_COLOR: Record<TransactionType, string> = {
  expense: '#ba1a1a',
  income: '#1b6c2f',
}

export function memberColor(index: number): string {
  return MEMBER_COLORS[index % MEMBER_COLORS.length]
}

export function categoryColor(category?: Pick<Category, 'color'> | null, index = 0): string {
  return category?.color || CATEGORY_FALLBACK_COLORS[index % CATEGORY_FALLBACK_COLORS.length]
}
