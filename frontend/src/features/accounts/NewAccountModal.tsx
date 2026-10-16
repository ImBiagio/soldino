import { Link } from 'react-router-dom'

import { useSaveAccount } from '../../api/hooks'
import { ErrorBanner, Field, Modal } from '../../components/ui'
import { gettext, interpolate } from '../../lib/i18n'
import { ACCOUNT_KIND_LABEL } from '../../lib/labels'
import { normalizeDecimal } from '../../lib/money'
import type { Account, Membership, Tracker } from '../../lib/types'

/**
 * Nuovo conto: lo stesso modulo dalla pagina Conti e dalla Banca, dove parte
 * col nome del conto in banca e il saldo lo aggiorna poi la sincronizzazione.
 */
export function NewAccountModal({
  tracker,
  owner,
  onClose,
  onCreated,
  defaultName = '',
  fromBank = false,
}: {
  tracker: Tracker
  owner: Pick<Membership, 'display_name'> & { user: { id: string } | null }
  onClose: () => void
  onCreated?: (account: Account) => void
  defaultName?: string
  fromBank?: boolean
}) {
  const save = useSaveAccount(tracker.id)

  return (
    <Modal
      open
      onClose={onClose}
      title={interpolate(gettext('Nuovo conto di %(name)s'), { name: owner.display_name }, true)}
    >
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          const created = await save.mutateAsync({
            name: String(form.get('name')),
            owner: owner.user!.id,
            kind: form.get('kind') as Account['kind'],
            current_balance: normalizeDecimal(String(form.get('balance') || '0')),
            include_in_totals: form.get('include_in_totals') === 'on',
          })
          onCreated?.(created)
          onClose()
        }}
      >
        <ErrorBanner error={save.error} />
        <Field label={gettext('Nome')}>
          <input
            className="field-input"
            name="name"
            required
            autoFocus
            maxLength={80}
            defaultValue={defaultName}
            placeholder="Hype, BBVA…"
          />
        </Field>
        <Field label={gettext('Tipo')}>
          <select className="field-input" name="kind" defaultValue="bank">
            {Object.entries(ACCOUNT_KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={gettext('Saldo attuale')}
          hint={fromBank ? gettext('Lo sovrascrive la prima lettura della banca.') : undefined}
        >
          <input
            className="field-input amount text-right"
            name="balance"
            inputMode="decimal"
            defaultValue="0.00"
          />
        </Field>
        <label className="flex items-center gap-3 px-1 text-body-medium">
          <input type="checkbox" name="include_in_totals" defaultChecked className="h-5 w-5" />
          {gettext('Conta nei totali e nella riconciliazione')}
        </label>
        <button className="btn-filled w-full" disabled={save.isPending}>
          {fromBank ? gettext('Crea e abbina') : gettext('Aggiungi')}
        </button>
        {!fromBank && (
          <p className="text-body-small text-on-surface-variant">
            {gettext('Il saldo si aggiorna a mano da questa pagina, quando guardi la banca.')}{' '}
            <Link to={`/t/${tracker.id}/attese`} className="text-primary underline">
              {gettext('I soldi attesi o già promessi vanno in In attesa.')}
            </Link>
          </p>
        )}
      </form>
    </Modal>
  )
}
