// Material Symbols Rounded: si usano i nomi dei glifi, nessuna icona disegnata.
// La categoria porta il suo `icon` dall'API; l'euristica sul nome copre le
// categorie create prima che il campo esistesse.

import type { Account, Category } from './types'

const BY_KEYWORD: [RegExp, string][] = [
  [/spesa|supermarket|alimentar|grocer/i, 'shopping_basket'],
  [/casa|home|affitto|mutuo|utenz/i, 'home'],
  [/trasport|transport|auto|benzin|carburant/i, 'directions_car'],
  [/carburant|gas/i, 'local_gas_station'],
  [/tempo libero|leisure|svago|bar|aperitiv/i, 'local_bar'],
  [/ristorant|eating|fuori|delivery/i, 'local_bar'],
  [/salute|health|medic|farmac/i, 'local_hospital'],
  [/regal|gift|dono/i, 'redeem'],
  [/abbonament|subscription|streaming/i, 'live_tv'],
  [/viaggi|vacanz|travel/i, 'beach_access'],
  [/stipendio|salary|entrat|income/i, 'payments'],
  [/rimbors|refund|storno/i, 'savings'],
  [/shopping|abbigliament/i, 'shopping_basket'],
]

export function categoryIcon(category?: Pick<Category, 'name' | 'icon'> | null): string {
  if (category?.icon) return category.icon
  if (category?.name) {
    for (const [pattern, icon] of BY_KEYWORD) {
      if (pattern.test(category.name)) return icon
    }
  }
  return 'payments'
}

export function accountIcon(kind?: Account['kind'] | null): string {
  switch (kind) {
    case 'card':
      return 'credit_card'
    case 'cash':
      return 'payments'
    case 'wallet':
      return 'account_balance_wallet'
    default:
      return 'account_balance'
  }
}

/** Colore di fallback quando la categoria non ne ha uno: coerente con la palette. */
export const CATEGORY_FALLBACK_COLORS = ['#1b6c2f', '#38656a', '#7d5700', '#74796f']

export function categoryColor(category?: Pick<Category, 'color'> | null, index = 0): string {
  return category?.color || CATEGORY_FALLBACK_COLORS[index % CATEGORY_FALLBACK_COLORS.length]
}

/** I membri hanno un colore stabile per posizione: serve alla barra di split. */
export const MEMBER_COLORS = ['#1b6c2f', '#38656a', '#7d5700', '#74796f', '#8b4a62']

export function memberColor(index: number): string {
  return MEMBER_COLORS[index % MEMBER_COLORS.length]
}
