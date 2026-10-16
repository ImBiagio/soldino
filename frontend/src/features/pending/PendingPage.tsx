import clsx from 'clsx'
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'

import {
  useConvertPendingItem,
  useDeletePendingItem,
  usePendingItems,
  useSavePendingItem,
} from '../../api/hooks'
import { activeMembers } from '../../components/Layout'
import { AccountSelect, CategorySelect, MemberSelect } from '../../components/selects'
import {
  Chip,
  EmptyState,
  ErrorBanner,
  Field,
  Icon,
  IconButton,
  IconCircle,
  Modal,
  RowsSkeleton,
} from '../../components/ui'
import { formatDate, todayIso } from '../../lib/format'
import { formatSigned, formatSignedCents, normalizeDecimal, toCents } from '../../lib/money'
import type { PendingItem, Tracker } from '../../lib/types'

const STATUSES = [
  { id: 'open', label: 'Aperti' },
  { id: 'converted', label: 'Convertiti' },
  { id: 'cancelled', label: 'Annullati' },
]

export function PendingPage() {
  const tracker = useOutletContext<Tracker>()
  const [status, setStatus] = useState('open')
  const { data, isLoading, error } = usePendingItems(tracker.id, status)
  const save = useSavePendingItem(tracker.id)
  const remove = useDeletePendingItem(tracker.id)
  const [formOpen, setFormOpen] = useState(false)
  const [converting, setConverting] = useState<PendingItem | null>(null)

  const members = activeMembers(tracker)
  const items = data?.results ?? []
  const total = items.reduce((sum, item) => sum + toCents(item.amount), 0)

  return (
    <div className="p-5 md:p-7">
      <div className="panel sm:p-6 md:p-7">
        <h1 className="text-title-large">In attesa</h1>
        <p className="mt-1 text-body-medium text-on-surface-variant">
          Soldi attesi o già impegnati che non sono ancora un movimento.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {STATUSES.map((option) => (
            <Chip
              key={option.id}
              selected={status === option.id}
              label={
                option.id === 'open' && status === 'open'
                  ? `${option.label} · ${items.length}`
                  : option.label
              }
              onClick={() => setStatus(option.id)}
            />
          ))}
          <button
            type="button"
            className="btn-tonal btn-sm ml-auto"
            onClick={() => setFormOpen(true)}
          >
            <Icon name="add" size={20} />
            Voce
          </button>
        </div>

        <ErrorBanner error={error} />

        {status === 'open' && items.length > 0 && (
          <div className="mt-5 flex items-center gap-4 rounded-card bg-secondary-container p-5 text-on-secondary-container">
            <Icon name="hourglass_top" size={40} />
            <div>
              <p className="text-body-medium">Totale in attesa</p>
              <p className="amount text-[32px] font-semibold leading-10">
                {formatSignedCents(total, tracker.currency)}
              </p>
            </div>
          </div>
        )}

        <div className="mt-4">
          {isLoading ? (
            <RowsSkeleton rows={3} />
          ) : items.length === 0 ? (
            <EmptyState
              icon="hourglass_top"
              title="Niente in attesa"
              description="Rimborsi, accrediti, impegni futuri: quello che sai che arriverà o che è già promesso."
            />
          ) : (
            <div className="grid gap-2">
              {items.map((item) => {
                const cents = toCents(item.amount)
                const positive = cents >= 0
                return (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center gap-4 rounded-card bg-surface-container-low px-5 py-[18px]"
                  >
                    <IconCircle
                      name={positive ? 'savings' : 'redeem'}
                      color={positive ? 'var(--primary)' : 'var(--error)'}
                      size={44}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-large font-medium">{item.title}</p>
                      <p className="text-body-small text-on-surface-variant">
                        {item.owner_detail.display_name}
                        {item.expected_date &&
                          ` · ${positive ? 'attesa' : 'impegno'} ${formatDate(item.expected_date)}`}
                      </p>
                    </div>
                    <span
                      className={clsx(
                        'amount text-[18px] font-semibold',
                        positive ? 'text-primary' : 'text-error',
                      )}
                    >
                      {formatSigned(item.amount, tracker.currency)}
                    </span>
                    {item.status === 'open' && (
                      <>
                        <button
                          type="button"
                          className="btn-tonal btn-sm"
                          onClick={() => setConverting(item)}
                        >
                          Converti
                        </button>
                        <IconButton
                          icon="close"
                          label="Elimina"
                          onClick={() => remove.mutate(item.id)}
                        />
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Nuova voce in attesa">
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            await save.mutateAsync({
              title: String(form.get('title')),
              amount: normalizeDecimal(String(form.get('amount'))),
              owner: String(form.get('owner')),
              expected_date: (form.get('expected_date') as string) || null,
              note: String(form.get('note') ?? ''),
            })
            setFormOpen(false)
          }}
        >
          <ErrorBanner error={save.error} />
          <Field label="Descrizione">
            <input className="field-input" name="title" required autoFocus />
          </Field>
          <Field label="Importo" hint="Negativo per un impegno, es. −700 per un regalo.">
            <input
              className="field-input amount text-right"
              name="amount"
              required
              inputMode="decimal"
            />
          </Field>
          <Field label="Di chi">
            <MemberSelect members={members} name="owner" required />
          </Field>
          <Field label="Data attesa">
            <input className="field-input" type="date" name="expected_date" />
          </Field>
          <Field label="Nota">
            <textarea className="field-input resize-none" name="note" rows={2} />
          </Field>
          <button className="btn-filled w-full" disabled={save.isPending}>
            Salva
          </button>
        </form>
      </Modal>

      {converting && (
        <ConvertModal tracker={tracker} item={converting} onClose={() => setConverting(null)} />
      )}
    </div>
  )
}

function ConvertModal({
  tracker,
  item,
  onClose,
}: {
  tracker: Tracker
  item: PendingItem
  onClose: () => void
}) {
  const convert = useConvertPendingItem(tracker.id)
  const isIncome = toCents(item.amount) >= 0

  return (
    <Modal open onClose={onClose} title={`Converti “${item.title}”`}>
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          await convert.mutateAsync({
            id: item.id,
            date: String(form.get('date')),
            category: (form.get('category') as string) || null,
            account: (form.get('account') as string) || null,
          })
          onClose()
        }}
      >
        <ErrorBanner error={convert.error} />
        <p className="text-body-medium text-on-surface-variant">
          Diventa un{isIncome ? "'entrata" : 'a spesa'} di{' '}
          <span className="amount">{formatSigned(item.amount, tracker.currency)}</span>.
        </p>
        <Field label="Data">
          <input
            className="field-input"
            type="date"
            name="date"
            defaultValue={item.expected_date ?? todayIso()}
          />
        </Field>
        <Field label="Categoria">
          <CategorySelect
            trackerId={tracker.id}
            type={isIncome ? 'income' : 'expense'}
            name="category"
            defaultValue=""
          />
        </Field>
        <Field label="Conto">
          <AccountSelect trackerId={tracker.id} name="account" defaultValue="" />
        </Field>
        <button className="btn-filled w-full" disabled={convert.isPending}>
          Converti in movimento
        </button>
      </form>
    </Modal>
  )
}
