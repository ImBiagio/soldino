import { useMemo, useState } from 'react'

import { useAccounts, useCategories, useSaveTransaction } from '../../api/hooks'
import {
  SplitWidget,
  initialSplitState,
  splitResidualCents,
  splitStateFromTransaction,
  toSplitPayload,
  type SplitState,
} from '../../components/SplitWidget'
import { Avatar, ErrorBanner, Field, Modal } from '../../components/ui'
import { todayIso } from '../../lib/format'
import { formatMoney, fromCents } from '../../lib/money'
import type { Membership, Tracker, Transaction, TransactionType } from '../../lib/types'

interface Props {
  tracker: Tracker
  open: boolean
  onClose: () => void
  editing?: Transaction | null
}

export function TransactionForm({ tracker, open, onClose, editing }: Props) {
  const members = useMemo(
    () => tracker.members.filter((m): m is Membership => m.status === 'active' && !!m.user),
    [tracker.members],
  )
  const defaultPayer = editing?.paid_by ?? members[0]?.user?.id ?? ''

  const [type, setType] = useState<TransactionType>(editing?.type ?? 'expense')
  const [date, setDate] = useState(editing?.date ?? todayIso())
  const [title, setTitle] = useState(editing?.title ?? '')
  const [amount, setAmount] = useState(editing?.amount ?? '')
  const [category, setCategory] = useState(editing?.category ?? '')
  const [account, setAccount] = useState(editing?.account ?? '')
  const [paidBy, setPaidBy] = useState(defaultPayer)
  const [note, setNote] = useState(editing?.note ?? '')
  const [split, setSplit] = useState<SplitState>(() =>
    editing
      ? splitStateFromTransaction(members, editing.splits, editing.paid_by)
      : initialSplitState(members, defaultPayer),
  )

  const categories = useCategories(tracker.id)
  const accounts = useAccounts(tracker.id)
  const save = useSaveTransaction(tracker.id)

  const residual = splitResidualCents(split, members, amount || '0')
  const canSave = Boolean(title && amount && paidBy) && residual === 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? 'Modifica movimento' : 'Nuovo movimento'}
    >
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()
          await save.mutateAsync({
            id: editing?.id,
            type,
            date,
            title,
            amount,
            category: category || null,
            account: account || null,
            paid_by: paidBy,
            note,
            ...toSplitPayload(split, members),
          })
          onClose()
        }}
      >
        <ErrorBanner error={save.error} />

        <div className="flex gap-1">
          {(['expense', 'income'] as TransactionType[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setType(value)
                setCategory('')
              }}
              className={
                type === value
                  ? 'btn-primary flex-1'
                  : 'btn-ghost flex-1'
              }
            >
              {value === 'expense' ? 'Spesa' : 'Entrata'}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Descrizione">
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Esselunga, affitto, stipendio…"
              required
              autoFocus
            />
          </Field>
          <Field label="Importo">
            <input
              className="input amount text-right"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
              placeholder="0.00"
              required
            />
          </Field>
          <Field label="Data">
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Categoria">
            <select
              className="input"
              value={category ?? ''}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Senza categoria</option>
              {(categories.data?.results ?? [])
                .filter((c) => c.type === type && !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Conto">
            <select
              className="input"
              value={account ?? ''}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">Nessuno</option>
              {(accounts.data?.results ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={type === 'expense' ? 'Chi ha pagato' : 'Chi ha incassato'}
            hint="Distingue “ho pagato io, dividiamo” da “ha pagato l'altro”."
          >
            <div className="flex flex-wrap gap-2">
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setPaidBy(member.user!.id)}
                  className={
                    paidBy === member.user!.id
                      ? 'flex items-center gap-2 rounded-lg border border-indigo-500 bg-indigo-50 px-3 py-2 text-sm dark:bg-indigo-950'
                      : 'flex items-center gap-2 rounded-lg border border-ink-300 px-3 py-2 text-sm dark:border-ink-600'
                  }
                >
                  <Avatar name={member.display_name} size={22} />
                  {member.display_name}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
          <p className="label">Come si divide</p>
          <SplitWidget
            members={members}
            amount={amount || '0'}
            value={split}
            onChange={setSplit}
            currency={tracker.currency}
          />
        </div>

        <Field label="Nota">
          <textarea
            className="input"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {residual !== 0 && (
          <p className="text-xs text-amber-600">
            Le quote non quadrano: mancano {formatMoney(fromCents(residual), tracker.currency)}.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button className="btn-primary" disabled={!canSave || save.isPending}>
            {save.isPending ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
