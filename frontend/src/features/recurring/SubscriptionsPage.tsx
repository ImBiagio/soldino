import clsx from 'clsx'
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'

import {
  useAccounts,
  useCategories,
  useDeleteRecurringRule,
  useRecurringProposals,
  useRecurringRules,
  useRecurringOccurrence,
  useSaveRecurringRule,
} from '../../api/hooks'
import { activeMembers } from '../../components/Layout'
import {
  SplitWidget,
  initialSplitState,
  splitResidualBasisPoints,
  splitResidualCents,
  toSplitPayload,
  type SplitState,
} from '../../components/SplitWidget'
import {
  EmptyState,
  ErrorBanner,
  Field,
  Icon,
  IconCircle,
  Modal,
  RowsSkeleton,
  Switch,
} from '../../components/ui'
import { formatDate, todayIso } from '../../lib/format'
import { categoryIcon } from '../../lib/icons'
import { formatCents, formatMoney, normalizeDecimal, toCents } from '../../lib/money'
import type { RecurringRule, Tracker } from '../../lib/types'

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: 'settimanale',
  monthly: 'mensile',
  yearly: 'annuale',
  custom: 'personalizzata',
}

export function SubscriptionsPage() {
  const tracker = useOutletContext<Tracker>()
  const { data, isLoading, error } = useRecurringRules(tracker.id)
  const { proposals } = useRecurringProposals(tracker.id)
  const save = useSaveRecurringRule(tracker.id)
  const remove = useDeleteRecurringRule(tracker.id)
  const [formOpen, setFormOpen] = useState(false)

  const rules = data?.results ?? []
  const proposalIds = new Set(proposals.map((rule) => rule.id))
  const monthly = rules
    .filter((rule) => rule.active && rule.type === 'expense')
    .reduce((sum, rule) => sum + toCents(rule.monthly_cost), 0)

  return (
    <div className="p-5 md:p-7">
      <div className="panel p-6 md:p-7">
        <h1 className="text-title-large">Ricorrenze</h1>
        <p className="mt-1 text-body-medium text-on-surface-variant">
          Le proposte da approvare stanno in cima: senza conferma automatica nulla viene scritto.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-card bg-surface-container p-5">
            <p className="text-body-medium text-on-surface-variant">Al mese</p>
            <p className="amount text-[26px] font-semibold">
              {formatCents(monthly, tracker.currency)}
            </p>
          </div>
          <div className="rounded-card bg-surface-container p-5">
            <p className="text-body-medium text-on-surface-variant">All'anno</p>
            <p className="amount text-[26px] font-semibold">
              {formatCents(monthly * 12, tracker.currency)}
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" className="btn-filled btn-sm" onClick={() => setFormOpen(true)}>
            <Icon name="add" size={20} />
            Ricorrenza
          </button>
        </div>

        <ErrorBanner error={error} />

        <div className="mt-4 grid gap-2">
          {proposals.map((rule) => (
            <ProposalRow key={`proposal-${rule.id}`} tracker={tracker} rule={rule} />
          ))}

          {isLoading ? (
            <RowsSkeleton rows={3} />
          ) : rules.length === 0 ? (
            <EmptyState
              icon="autorenew"
              title="Nessuna ricorrenza"
              description="Affitto, mutuo, Netflix: tutto quello che torna da solo."
            />
          ) : (
            rules.map((rule) => (
              <div
                key={rule.id}
                className={clsx(
                  'flex flex-wrap items-center gap-4 rounded-card bg-surface-container-low px-5 py-4',
                  !rule.active && 'opacity-[0.62]',
                )}
              >
                <IconCircle
                  name={categoryIcon({ name: rule.title, icon: '' })}
                  color="var(--tertiary)"
                  size={44}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 truncate text-body-large font-medium">
                    {rule.title}
                    {rule.is_subscription && (
                      <span className="rounded-pill bg-tertiary-container px-2 py-0.5 text-body-small text-on-tertiary-container">
                        abbonamento
                      </span>
                    )}
                    {!rule.active && (
                      <span className="rounded-pill bg-surface-container-high px-2 py-0.5 text-body-small text-on-surface-variant">
                        sospesa
                      </span>
                    )}
                  </p>
                  <p className="text-body-small text-on-surface-variant">
                    {FREQUENCY_LABEL[rule.frequency]} · {formatDate(rule.next_run)} ·{' '}
                    {rule.auto_commit ? 'conferma automatica' : 'da approvare'}
                    {rule.frequency === 'yearly' &&
                      ` · ${formatMoney(rule.monthly_cost, tracker.currency)}/mese`}
                  </p>
                </div>
                <span className="amount text-[16px] font-semibold">
                  {formatMoney(rule.amount, tracker.currency)}
                </span>
                <Switch
                  checked={rule.active}
                  onChange={(checked) => save.mutate({ id: rule.id, active: checked })}
                  label={`Attiva ${rule.title}`}
                />
                <button
                  type="button"
                  onClick={() => remove.mutate(rule.id)}
                  aria-label="Elimina"
                  className="state flex h-9 w-9 items-center justify-center rounded-pill text-on-surface-variant"
                >
                  <Icon name="close" size={20} />
                </button>
                {proposalIds.has(rule.id) && <span className="sr-only">proposta in sospeso</span>}
              </div>
            ))
          )}
        </div>
      </div>

      {formOpen && <RuleForm tracker={tracker} open onClose={() => setFormOpen(false)} />}
    </div>
  )
}

/** Riga di proposta: approvare scrive il movimento, saltare passa alla prossima. */
function ProposalRow({ tracker, rule }: { tracker: Tracker; rule: RecurringRule }) {
  const approve = useRecurringOccurrence(tracker.id, 'approve')
  const skip = useRecurringOccurrence(tracker.id, 'skip')
  const busy = approve.isPending || skip.isPending

  return (
    <div className="rounded-card bg-warning-container px-5 py-4 text-on-warning-container">
      <ErrorBanner error={approve.error ?? skip.error} />
      <div className="flex flex-wrap items-center gap-4">
        <Icon name="inbox" size={24} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-large font-medium">
            {rule.title} · {formatMoney(rule.amount, tracker.currency)}
          </p>
          <p className="text-body-small">Proposta per il {formatDate(rule.next_run)}</p>
        </div>
        <button
          type="button"
          onClick={() => approve.mutate(rule)}
          disabled={busy}
          className="state rounded-pill bg-on-warning-container px-5 py-2.5 text-body-medium font-medium text-warning-container disabled:opacity-50"
        >
          {approve.isPending ? 'Approvo…' : 'Approva'}
        </button>
        <button
          type="button"
          onClick={() => skip.mutate(rule)}
          disabled={busy}
          aria-label="Salta questa occorrenza"
          className="state flex h-9 w-9 items-center justify-center rounded-pill disabled:opacity-50"
        >
          <Icon name="close" size={20} />
        </button>
      </div>
    </div>
  )
}

function RuleForm({
  tracker,
  open,
  onClose,
}: {
  tracker: Tracker
  open: boolean
  onClose: () => void
}) {
  const save = useSaveRecurringRule(tracker.id)
  const categories = useCategories(tracker.id)
  const accounts = useAccounts(tracker.id)
  const members = activeMembers(tracker)
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState(members[0]?.user?.id ?? '')
  const [split, setSplit] = useState<SplitState>(() =>
    initialSplitState(members, members[0]?.user?.id ?? ''),
  )
  const splitOk =
    splitResidualCents(split, members, amount || '0') === 0 &&
    splitResidualBasisPoints(split, members) === 0

  return (
    <Modal open={open} onClose={onClose} title="Nuova ricorrenza">
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          await save.mutateAsync({
            type: form.get('type') as never,
            title: String(form.get('title')),
            amount,
            frequency: form.get('frequency') as never,
            next_run: String(form.get('next_run')),
            paid_by: paidBy,
            // "Solo mia" resta vuoto: il backend usa chi paga, anche se cambia dopo.
            split_template:
              split.mode === 'personal' && split.personalUser === paidBy
                ? []
                : toSplitPayload(split, members).splits_input,
            category: (form.get('category') as string) || null,
            account: (form.get('account') as string) || null,
            is_subscription: form.get('is_subscription') === 'on',
            auto_commit: form.get('auto_commit') === 'on',
          })
          onClose()
        }}
      >
        <ErrorBanner error={save.error} />
        <Field label="Descrizione">
          <input className="field-input" name="title" required autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Importo">
            <input
              className="field-input amount text-right"
              name="amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(normalizeDecimal(event.target.value))}
              required
            />
          </Field>
          <Field label="Tipo">
            <select className="field-input" name="type" defaultValue="expense">
              <option value="expense">Spesa</option>
              <option value="income">Entrata</option>
            </select>
          </Field>
          <Field label="Frequenza">
            <select className="field-input" name="frequency" defaultValue="monthly">
              <option value="weekly">Settimanale</option>
              <option value="monthly">Mensile</option>
              <option value="yearly">Annuale</option>
            </select>
          </Field>
          <Field label="Prossima occorrenza">
            <input className="field-input" type="date" name="next_run" defaultValue={todayIso()} />
          </Field>
          <Field label="A carico di">
            <select
              className="field-input"
              name="paid_by"
              value={paidBy}
              onChange={(event) => {
                setPaidBy(event.target.value)
                if (split.mode === 'personal') {
                  setSplit({ ...split, personalUser: event.target.value })
                }
              }}
              required
            >
              {members.map((member) => (
                <option key={member.id} value={member.user!.id}>
                  {member.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Categoria">
            <select className="field-input" name="category" defaultValue="">
              <option value="">Senza categoria</option>
              {(categories.data?.results ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Conto">
          <select className="field-input" name="account" defaultValue="">
            <option value="">Nessuno</option>
            {(accounts.data?.results ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        {members.length > 1 && (
          <SplitWidget
            members={members}
            amount={amount || '0'}
            value={split}
            onChange={setSplit}
            currency={tracker.currency}
            compact
          />
        )}
        <label className="flex items-center gap-2 px-1 text-body-medium">
          <input type="checkbox" name="is_subscription" /> È un abbonamento
        </label>
        <label className="flex items-center gap-2 px-1 text-body-medium">
          <input type="checkbox" name="auto_commit" /> Conferma automatica (scrive senza chiedere)
        </label>
        <button className="btn-filled w-full" disabled={save.isPending || !splitOk}>
          Crea
        </button>
      </form>
    </Modal>
  )
}
