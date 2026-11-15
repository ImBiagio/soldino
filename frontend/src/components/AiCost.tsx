import { useAiQuote } from '../api/hooks'
import { gettext, interpolate } from '../lib/i18n'
import { Icon } from './ui'

/**
 * Accanto al bottone di una funzione AI: dice chi paga e quanto, prima di
 * premere (ADR 0021).
 *
 * - piccola, sulla chiave di casa: "1 🌽" (pannocchie della quota del giorno);
 * - grande, con la chiave dell'utente: "~0,12 € con la tua chiave";
 * - non disponibile (serve la chiave, limite raggiunto): il motivo e il link
 *   a cornhub per aggiungere la chiave o alzare il limite.
 *
 * ``count``: quante volte l'azione chiama la funzione (es. 5 settimane di piano).
 */
export function AiCost({
  feature,
  count = 1,
  fast = false,
}: {
  feature: string
  count?: number
  /** Come la chiamata vera (fast=True): la stima usa lo stesso modello. */
  fast?: boolean
}) {
  const features = count > 1 ? [`${feature}:${count}`] : [feature]
  const { data } = useAiQuote(features, fast)
  const item = data?.items[0]
  if (!item || !data) return null

  if (!item.allowed) {
    return (
      <p className="mt-2 flex items-start gap-2 rounded-row bg-surface-container p-3 text-body-small text-on-surface-variant">
        <Icon name="key" size={18} />
        <span>
          {item.message}{' '}
          <a className="text-primary underline" href={data.account_url}>
            {gettext('Apri cornhub')}
          </a>
        </span>
      </p>
    )
  }
  if (item.billed_to === 'house') {
    return (
      <span
        className="inline-flex items-center gap-1 text-body-small text-on-surface-variant"
        title={interpolate(gettext('Pannocchie rimaste oggi: %s'), [data.pannocchie_left])}
      >
        {/* Pannocchie: unita' della quota di casa, uguale in tutte le lingue. */}
        {item.estimate_pannocchie ?? 1} 🌽
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-tertiary-container px-2 py-0.5 text-label-small text-on-tertiary-container">
      <Icon name="key" size={14} />
      {interpolate(gettext('~%s con la tua chiave'), [item.estimate_label ?? ''])}
    </span>
  )
}
