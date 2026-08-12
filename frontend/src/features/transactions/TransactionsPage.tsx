import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'

import {
  useAccounts,
  useCategories,
  useDeleteTransaction,
  useSaveTransaction,
  useTransactions,
} from '../../api/hooks'
import { Avatar, EmptyState, ErrorBanner, Spinner } from '../../components/ui'
import { formatDate, monthKey, monthKeyLabel } from '../../lib/format'
import { formatMoney } from '../../lib/money'
import type { Tracker, Transaction } from '../../lib/types'
import { TransactionForm } from './TransactionForm'

const FILTER_KEYS = [
  'type',
  'q',
  'category',
  'account',
  'paid_by',
  'split_user',
  'date_from',
  'date_to',
  'min_amount',
  'max_amount',
  'page',
] as const

export function TransactionsPage() {
  const tracker = useOutletContext<Tracker>()
  // I filtri vivono nella URL: un elenco filtrato e' condivisibile e sopravvive al refresh.
  const [params, setParams] = useSearchParams()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)

  const filters = useMemo(() => {
    const out: Record<string, string> = { page_size: '100' }
    for (const key of FILTER_KEYS) {
      const value = params.get(key)
      if (value) out[key] = value
    }
    return out
  }, [params])

  const { data, isLoading, error, isFetching } = useTransactions(tracker.id, filters)
  const categories = useCategories(tracker.id)
  const accounts = useAccounts(tracker.id)
  const save = useSaveTransaction(tracker.id)
  const remove = useDeleteTransaction(tracker.id)

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    setParams(next, { replace: true })
  }

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>()
    for (const tx of data?.results ?? []) {
      const key = monthKey(tx.date)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(tx)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [data])

  const members = tracker.members.filter((m) => m.status === 'active' && m.user)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs flex-1"
          placeholder="Cerca descrizione o nota…"
          defaultValue={params.get('q') ?? ''}
          onChange={(e) => setFilter('q', e.target.value)}
        />
        <select
          className="input w-auto"
          value={params.get('type') ?? ''}
          onChange={(e) => setFilter('type', e.target.value)}
        >
          <option value="">Tutti i tipi</option>
          <option value="expense">Spese</option>
          <option value="income">Entrate</option>
        </select>
        <select
          className="input w-auto"
          value={params.get('category') ?? ''}
          onChange={(e) => setFilter('category', e.target.value)}
        >
          <option value="">Tutte le categorie</option>
          {(categories.data?.results ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={params.get('account') ?? ''}
          onChange={(e) => setFilter('account', e.target.value)}
        >
          <option value="">Tutti i conti</option>
          {(accounts.data?.results ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={params.get('paid_by') ?? ''}
          onChange={(e) => setFilter('paid_by', e.target.value)}
        >
          <option value="">Chiunque ha pagato</option>
          {members.map((m) => (
            <option key={m.id} value={m.user!.id}>
              {m.display_name}
            </option>
          ))}
        </select>
        <input
          className="input w-auto"
          type="date"
          value={params.get('date_from') ?? ''}
          onChange={(e) => setFilter('date_from', e.target.value)}
          aria-label="Dal"
        />
        <input
          className="input w-auto"
          type="date"
          value={params.get('date_to') ?? ''}
          onChange={(e) => setFilter('date_to', e.target.value)}
          aria-label="Al"
        />
        {[...params.keys()].some((k) => FILTER_KEYS.includes(k as never)) && (
          <button className="btn-ghost" onClick={() => setParams({}, { replace: true })}>
            Azzera filtri
          </button>
        )}
        <button
          className="btn-primary ml-auto"
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          + Movimento
        </button>
      </div>

      <ErrorBanner error={error} />
      {isLoading ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <EmptyState
          title="Nessun movimento"
          description="Cambia i filtri o registra il primo movimento."
        />
      ) : (
        <div className={clsx('space-y-6', isFetching && 'opacity-70 transition')}>
          <p className="text-xs text-ink-500">{data?.count} movimenti</p>
          {groups.map(([key, rows]) => {
            const monthTotal = rows.reduce(
              (sum, tx) => sum + (tx.type === 'expense' ? -1 : 1) * Number(tx.amount),
              0,
            )
            return (
              <section key={key}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold capitalize">{monthKeyLabel(key)}</h2>
                  <span
                    className={clsx(
                      'amount text-sm',
                      monthTotal < 0 ? 'text-rose-600' : 'text-emerald-600',
                    )}
                  >
                    {formatMoney(monthTotal, tracker.currency)}
                  </span>
                </div>
                <ul className="divide-y divide-ink-200 overflow-hidden rounded-xl border border-ink-200 bg-white dark:divide-ink-700 dark:border-ink-700 dark:bg-ink-800">
                  {rows.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      tracker={tracker}
                      categories={categories.data?.results ?? []}
                      onEdit={() => {
                        setEditing(tx)
                        setFormOpen(true)
                      }}
                      onInlineSave={(patch) => save.mutate({ id: tx.id, ...patch })}
                      onDelete={() => remove.mutate(tx.id)}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {formOpen && (
        <TransactionForm
          key={editing?.id ?? 'new'}
          tracker={tracker}
          open={formOpen}
          editing={editing}
          onClose={() => setFormOpen(false)}
        />
      )}
    </div>
  )
}

function TransactionRow({
  tx,
  tracker,
  categories,
  onEdit,
  onInlineSave,
  onDelete,
}: {
  tx: Transaction
  tracker: Tracker
  categories: { id: string; name: string; type: string }[]
  onEdit: () => void
  onInlineSave: (patch: Record<string, unknown>) => void
  onDelete: () => void
}) {
  const [editingAmount, setEditingAmount] = useState(false)
  const [amount, setAmount] = useState(tx.amount)
  const isGroup = tx.splits.length > 1

  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-ink-50 dark:hover:bg-ink-700/50">
      <span className="w-14 shrink-0 text-xs text-ink-500">{formatDate(tx.date).slice(0, 5)}</span>

      <span
        className="h-8 w-1 shrink-0 rounded-full"
        style={{ backgroundColor: tx.category_color ?? '#94a3b8' }}
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <button className="block max-w-full truncate text-left font-medium" onClick={onEdit}>
          {tx.title}
        </button>
        <div className="flex flex-wrap items-center gap-1 text-xs text-ink-500">
          {/* Modifica inline della categoria: e' il campo che si sbaglia piu' spesso. */}
          <select
            className="rounded border-none bg-transparent p-0 text-xs text-ink-500 hover:underline"
            value={tx.category ?? ''}
            onChange={(e) => onInlineSave({ category: e.target.value || null })}
            aria-label="Categoria"
          >
            <option value="">Senza categoria</option>
            {categories
              .filter((c) => c.type === tx.type)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          {tx.account_name && <span>· {tx.account_name}</span>}
          {tx.possible_duplicates.length > 0 && (
            <span className="chip bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200">
              possibile doppione
            </span>
          )}
        </div>
      </div>

      <span
        className={clsx(
          'chip shrink-0',
          isGroup
            ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200'
            : 'bg-ink-100 text-ink-600 dark:bg-ink-700 dark:text-ink-300',
        )}
        title={tx.splits
          .map((s) => `${s.user_detail.display_name}: ${formatMoney(s.share_amount)}`)
          .join(' · ')}
      >
        {isGroup ? 'gruppo' : 'personale'}
      </span>

      <span className="hidden shrink-0 items-center gap-1 sm:flex" title={`Pagato da ${tx.paid_by_detail.display_name}`}>
        <Avatar name={tx.paid_by_detail.display_name} size={22} />
      </span>

      {editingAmount ? (
        <input
          className="input amount w-24 py-1 text-right"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
          onBlur={() => {
            setEditingAmount(false)
            if (amount !== tx.amount) onInlineSave({ amount })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setAmount(tx.amount)
              setEditingAmount(false)
            }
          }}
        />
      ) : (
        <button
          className={clsx(
            'amount w-24 shrink-0 text-right font-medium',
            tx.type === 'expense' ? 'text-rose-600' : 'text-emerald-600',
          )}
          onClick={() => setEditingAmount(true)}
          title="Clicca per modificare"
        >
          {tx.type === 'expense' ? '−' : '+'}
          {formatMoney(tx.amount, tracker.currency)}
        </button>
      )}

      <button
        className="shrink-0 text-ink-400 hover:text-rose-600"
        onClick={onDelete}
        aria-label="Elimina"
        title="Elimina"
      >
        ✕
      </button>
    </li>
  )
}
