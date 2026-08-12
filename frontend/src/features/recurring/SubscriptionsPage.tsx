import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'

import {
  useAccounts,
  useCategories,
  useDeleteRecurringRule,
  useRecurringRules,
  useSaveRecurringRule,
} from '../../api/hooks'
import { EmptyState, ErrorBanner, Field, Modal, Spinner, Stat } from '../../components/ui'
import { formatDate, todayIso } from '../../lib/format'
import { formatMoney, toCents } from '../../lib/money'
import type { Tracker } from '../../lib/types'

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: 'settimanale',
  monthly: 'mensile',
  yearly: 'annuale',
  custom: 'personalizzata',
}

export function SubscriptionsPage() {
  const tracker = useOutletContext<Tracker>()
  const { data, isLoading, error } = useRecurringRules(tracker.id)
  const save = useSaveRecurringRule(tracker.id)
  const remove = useDeleteRecurringRule(tracker.id)
  const categories = useCategories(tracker.id)
  const accounts = useAccounts(tracker.id)
  const [open, setOpen] = useState(false)

  const rules = data?.results ?? []
  const monthly = rules
    .filter((r) => r.active && r.type === 'expense')
    .reduce((sum, r) => sum + toCents(r.monthly_cost), 0)
  const members = tracker.members.filter((m) => m.status === 'active' && m.user)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-lg font-semibold">Ricorrenze e abbonamenti</h1>
          <p className="text-sm text-ink-500">
            Con “conferma automatica” spenta la ricorrenza propone e basta: nessuna scrittura
            senza la tua approvazione.
          </p>
        </div>
        <button className="btn-primary ml-auto" onClick={() => setOpen(true)}>
          + Ricorrenza
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Stat
          label="Costo mensilizzato"
          value={formatMoney(monthly / 100, tracker.currency)}
          tone="negative"
        />
        <Stat
          label="Costo annualizzato"
          value={formatMoney((monthly * 12) / 100, tracker.currency)}
          tone="negative"
        />
      </div>

      <ErrorBanner error={error} />
      {isLoading ? (
        <Spinner />
      ) : rules.length === 0 ? (
        <EmptyState
          title="Nessuna ricorrenza"
          description="Affitto, mutuo, Netflix: tutto quello che torna da solo."
        />
      ) : (
        <ul className="divide-y divide-ink-200 overflow-hidden rounded-xl border border-ink-200 bg-white dark:divide-ink-700 dark:border-ink-700 dark:bg-ink-800">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {rule.title}
                  {rule.is_subscription && (
                    <span className="ml-2 chip bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">
                      abbonamento
                    </span>
                  )}
                  {!rule.active && (
                    <span className="ml-2 chip bg-ink-100 text-ink-500">sospesa</span>
                  )}
                </p>
                <p className="text-xs text-ink-500">
                  {FREQUENCY_LABEL[rule.frequency]} · prossima {formatDate(rule.next_run)}
                  {rule.auto_commit ? ' · conferma automatica' : ' · da approvare'}
                </p>
              </div>
              <span className="amount w-24 text-right">
                {formatMoney(rule.amount, tracker.currency)}
              </span>
              <span className="amount w-24 text-right text-xs text-ink-500">
                {formatMoney(rule.monthly_cost, tracker.currency)}/mese
              </span>
              <label className="flex items-center gap-1 text-xs text-ink-500">
                <input
                  type="checkbox"
                  checked={rule.active}
                  onChange={(e) => save.mutate({ id: rule.id, active: e.target.checked })}
                />
                attiva
              </label>
              <button
                className="text-ink-400 hover:text-rose-600"
                onClick={() => remove.mutate(rule.id)}
                aria-label="Elimina"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nuova ricorrenza">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            await save.mutateAsync({
              type: form.get('type') as never,
              title: String(form.get('title')),
              amount: String(form.get('amount')).replace(',', '.'),
              frequency: form.get('frequency') as never,
              next_run: String(form.get('next_run')),
              paid_by: String(form.get('paid_by')),
              category: (form.get('category') as string) || null,
              account: (form.get('account') as string) || null,
              is_subscription: form.get('is_subscription') === 'on',
              auto_commit: form.get('auto_commit') === 'on',
            })
            setOpen(false)
          }}
        >
          <ErrorBanner error={save.error} />
          <Field label="Descrizione">
            <input className="input" name="title" required autoFocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Importo">
              <input className="input amount text-right" name="amount" required />
            </Field>
            <Field label="Tipo">
              <select className="input" name="type" defaultValue="expense">
                <option value="expense">Spesa</option>
                <option value="income">Entrata</option>
              </select>
            </Field>
            <Field label="Frequenza">
              <select className="input" name="frequency" defaultValue="monthly">
                <option value="weekly">Settimanale</option>
                <option value="monthly">Mensile</option>
                <option value="yearly">Annuale</option>
              </select>
            </Field>
            <Field label="Prossima occorrenza">
              <input className="input" type="date" name="next_run" defaultValue={todayIso()} />
            </Field>
            <Field label="A carico di">
              <select className="input" name="paid_by" required>
                {members.map((m) => (
                  <option key={m.id} value={m.user!.id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Categoria">
              <select className="input" name="category" defaultValue="">
                <option value="">Senza categoria</option>
                {(categories.data?.results ?? []).map((c) => (
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
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_subscription" /> È un abbonamento
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="auto_commit" /> Conferma automatica (scrive senza
            chiedere)
          </label>
          <button className="btn-primary w-full" disabled={save.isPending}>
            Crea
          </button>
        </form>
      </Modal>
    </div>
  )
}
