import clsx from 'clsx'
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'

import {
  useAccounts,
  useCategories,
  useConvertPendingItem,
  useDeletePendingItem,
  usePendingItems,
  useSavePendingItem,
} from '../../api/hooks'
import { EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui'
import { formatDate, todayIso } from '../../lib/format'
import { formatSigned, toCents } from '../../lib/money'
import type { PendingItem, Tracker } from '../../lib/types'

export function PendingPage() {
  const tracker = useOutletContext<Tracker>()
  const [status, setStatus] = useState('open')
  const { data, isLoading, error } = usePendingItems(tracker.id, status)
  const save = useSavePendingItem(tracker.id)
  const remove = useDeletePendingItem(tracker.id)
  const [open, setOpen] = useState(false)
  const [converting, setConverting] = useState<PendingItem | null>(null)

  const members = tracker.members.filter((m) => m.status === 'active' && m.user)
  const total = (data?.results ?? []).reduce((sum, item) => sum + toCents(item.amount), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">In attesa</h1>
        <p className="text-sm text-ink-500">
          Soldi attesi o gia' impegnati che non sono ancora un movimento.
        </p>
        <select
          className="input ml-auto w-auto"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="open">Aperti</option>
          <option value="converted">Convertiti</option>
          <option value="cancelled">Annullati</option>
        </select>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          + Voce
        </button>
      </div>

      <ErrorBanner error={error} />
      {isLoading ? (
        <Spinner />
      ) : (data?.results.length ?? 0) === 0 ? (
        <EmptyState title="Niente in attesa" description="Rimborsi, accrediti, impegni futuri." />
      ) : (
        <>
          <ul className="divide-y divide-ink-200 overflow-hidden rounded-xl border border-ink-200 bg-white dark:divide-ink-700 dark:border-ink-700 dark:bg-ink-800">
            {data!.results.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="text-xs text-ink-500">
                    {item.owner_detail.display_name}
                    {item.expected_date && ` · attesa ${formatDate(item.expected_date)}`}
                  </p>
                </div>
                <span
                  className={clsx(
                    'amount w-28 text-right font-medium',
                    toCents(item.amount) < 0 ? 'text-rose-600' : 'text-emerald-600',
                  )}
                >
                  {formatSigned(item.amount, tracker.currency)}
                </span>
                {item.status === 'open' && (
                  <>
                    <button className="btn-ghost py-1" onClick={() => setConverting(item)}>
                      Converti
                    </button>
                    <button
                      className="text-ink-400 hover:text-rose-600"
                      onClick={() => remove.mutate(item.id)}
                      aria-label="Elimina"
                    >
                      ✕
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="text-right text-sm text-ink-500">
            Totale in attesa:{' '}
            <span className="amount font-medium">
              {formatSigned(total / 100, tracker.currency)}
            </span>
          </p>
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nuova voce in attesa">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            await save.mutateAsync({
              title: String(form.get('title')),
              amount: String(form.get('amount')).replace(',', '.'),
              owner: String(form.get('owner')),
              expected_date: (form.get('expected_date') as string) || null,
              note: String(form.get('note') ?? ''),
            })
            setOpen(false)
          }}
        >
          <ErrorBanner error={save.error} />
          <Field label="Descrizione">
            <input className="input" name="title" required autoFocus />
          </Field>
          <Field label="Importo" hint="Negativo per un impegno (es. −700 per un regalo).">
            <input className="input amount text-right" name="amount" required inputMode="decimal" />
          </Field>
          <Field label="Di chi">
            <select className="input" name="owner" required>
              {members.map((m) => (
                <option key={m.id} value={m.user!.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Data attesa">
            <input className="input" type="date" name="expected_date" />
          </Field>
          <Field label="Nota">
            <textarea className="input" name="note" rows={2} />
          </Field>
          <button className="btn-primary w-full" disabled={save.isPending}>
            Salva
          </button>
        </form>
      </Modal>

      {converting && (
        <ConvertModal
          tracker={tracker}
          item={converting}
          onClose={() => setConverting(null)}
        />
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
  const categories = useCategories(tracker.id)
  const accounts = useAccounts(tracker.id)
  const isIncome = toCents(item.amount) >= 0

  return (
    <Modal open onClose={onClose} title={`Converti “${item.title}”`}>
      <form
        className="space-y-3"
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
        <p className="text-sm text-ink-500">
          Diventa un{isIncome ? "'entrata" : 'a spesa'} di{' '}
          <span className="amount">{formatSigned(item.amount, tracker.currency)}</span>.
        </p>
        <Field label="Data">
          <input
            className="input"
            type="date"
            name="date"
            defaultValue={item.expected_date ?? todayIso()}
          />
        </Field>
        <Field label="Categoria">
          <select className="input" name="category" defaultValue="">
            <option value="">Senza categoria</option>
            {(categories.data?.results ?? [])
              .filter((c) => c.type === (isIncome ? 'income' : 'expense'))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Conto">
          <select className="input" name="account" defaultValue="">
            <option value="">Nessuno</option>
            {(accounts.data?.results ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <button className="btn-primary w-full" disabled={convert.isPending}>
          Converti in movimento
        </button>
      </form>
    </Modal>
  )
}
