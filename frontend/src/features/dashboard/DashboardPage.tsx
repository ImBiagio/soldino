import clsx from 'clsx'
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'

import {
  useBalances,
  useCreateSettlement,
  useReconciliation,
  useSummary,
} from '../../api/hooks'
import { Avatar, ErrorBanner, Modal, Spinner, Stat } from '../../components/ui'
import { monthLabel, todayIso } from '../../lib/format'
import { formatMoney, formatSigned, toCents } from '../../lib/money'
import type { Tracker } from '../../lib/types'

export function DashboardPage() {
  const tracker = useOutletContext<Tracker>()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState<number | ''>(now.getMonth() + 1)

  const summary = useSummary(tracker.id, { year, month: month || undefined })
  const balances = useBalances(tracker.id)
  const reconciliation = useReconciliation(tracker.id)

  return (
    <div className="space-y-6">
      <ReconciliationCard tracker={tracker} />

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input w-auto"
          value={month}
          onChange={(e) => setMonth(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">Tutto l'anno</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {Array.from({ length: 6 }, (_, i) => now.getFullYear() - i).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <ErrorBanner error={summary.error} />
      {summary.isLoading || !summary.data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Spese"
              value={formatMoney(summary.data.total_expense, tracker.currency)}
              tone="negative"
              hint={`${summary.data.transaction_count} movimenti`}
            />
            <Stat
              label="Entrate"
              value={formatMoney(summary.data.total_income, tracker.currency)}
              tone="positive"
            />
            <Stat
              label="Saldo del periodo"
              value={formatSigned(summary.data.net, tracker.currency)}
              tone={toCents(summary.data.net) >= 0 ? 'positive' : 'negative'}
            />
          </div>

          <section className="card">
            <h2 className="mb-3 text-sm font-semibold">Per categoria</h2>
            {summary.data.by_category.length === 0 ? (
              <p className="text-sm text-ink-500">Nessun movimento nel periodo.</p>
            ) : (
              <ul className="space-y-2">
                {summary.data.by_category
                  .filter((row) => row.type === 'expense')
                  .map((row) => {
                    const share =
                      toCents(summary.data!.total_expense) > 0
                        ? (toCents(row.total) / toCents(summary.data!.total_expense)) * 100
                        : 0
                    return (
                      <li key={`${row.category_id}-${row.type}`} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <span
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: row.color }}
                            />
                            {row.category_name}
                            <span className="text-xs text-ink-500">({row.count})</span>
                          </span>
                          <span className="amount">
                            {formatMoney(row.total, tracker.currency)}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-700">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${share}%`, backgroundColor: row.color }}
                          />
                        </div>
                      </li>
                    )
                  })}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="card space-y-3">
        <h2 className="text-sm font-semibold">Chi deve cosa</h2>
        {balances.isLoading || !balances.data ? (
          <Spinner />
        ) : (
          <>
            <ul className="space-y-1">
              {balances.data.balances.map((balance) => (
                <li key={balance.user.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Avatar name={balance.user.display_name} />
                    {balance.user.display_name}
                  </span>
                  <span
                    className={clsx(
                      'amount font-medium',
                      toCents(balance.net) > 0
                        ? 'text-emerald-600'
                        : toCents(balance.net) < 0
                          ? 'text-rose-600'
                          : 'text-ink-500',
                    )}
                    title={`Pagato ${formatMoney(balance.paid)} · di competenza ${formatMoney(balance.owed)}`}
                  >
                    {formatSigned(balance.net, tracker.currency)}
                  </span>
                </li>
              ))}
            </ul>

            {balances.data.suggested_transfers.length === 0 ? (
              <p className="text-sm text-emerald-600">Siete in pari.</p>
            ) : (
              <ul className="space-y-2 border-t border-ink-200 pt-3 dark:border-ink-700">
                {balances.data.suggested_transfers.map((transfer, index) => (
                  <SettleRow key={index} tracker={tracker} transfer={transfer} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {reconciliation.data && (
        <p className="text-xs text-ink-500">
          Saldo conti {formatMoney(reconciliation.data.accounts_balance, tracker.currency)} · in
          attesa {formatSigned(reconciliation.data.pending_total, tracker.currency)}
        </p>
      )}
    </div>
  )
}

function ReconciliationCard({ tracker }: { tracker: Tracker }) {
  const { data, isLoading } = useReconciliation(tracker.id)
  if (isLoading || !data) return null
  const delta = toCents(data.delta)
  const quadra = delta === 0

  return (
    <div
      className={clsx(
        'rounded-xl border p-4',
        quadra
          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950'
          : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Riconciliazione</p>
          <p className="text-xs text-ink-600 dark:text-ink-300">
            Saldo conti {formatMoney(data.accounts_balance, tracker.currency)} + in attesa{' '}
            {formatSigned(data.pending_total, tracker.currency)} ={' '}
            {formatMoney(data.available_balance, tracker.currency)} disponibili · dalle
            transazioni {formatSigned(data.transactions_balance, tracker.currency)}
          </p>
        </div>
        <div className="text-right">
          <p className="label mb-0">Delta</p>
          <p className="amount text-2xl font-semibold">
            {formatSigned(data.delta, tracker.currency)}
          </p>
        </div>
      </div>
    </div>
  )
}

function SettleRow({
  tracker,
  transfer,
}: {
  tracker: Tracker
  transfer: {
    from_user: { id: string; display_name: string }
    to_user: { id: string; display_name: string }
    amount: string
  }
}) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(todayIso())
  const [amount, setAmount] = useState(transfer.amount)
  const create = useCreateSettlement(tracker.id)

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>
        <strong>{transfer.from_user.display_name}</strong> deve a{' '}
        <strong>{transfer.to_user.display_name}</strong>{' '}
        <span className="amount">{formatMoney(transfer.amount, tracker.currency)}</span>
      </span>
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        Salda
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Registra un pareggio">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault()
            await create.mutateAsync({
              from_user: transfer.from_user.id,
              to_user: transfer.to_user.id,
              amount,
              date,
            })
            setOpen(false)
          }}
        >
          <ErrorBanner error={create.error} />
          <p className="text-sm text-ink-500">
            Un pareggio azzera il debito e non compare in nessuna statistica per categoria.
          </p>
          <label className="block">
            <span className="label">Importo</span>
            <input
              className="input amount text-right"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
            />
          </label>
          <label className="block">
            <span className="label">Data</span>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button className="btn-primary w-full" disabled={create.isPending}>
            Registra
          </button>
        </form>
      </Modal>
    </li>
  )
}
