import clsx from 'clsx'
import { useMemo, useState } from 'react'

import { useAccounts, useCategories, useSaveTransaction } from '../../api/hooks'
import { activeMembers } from '../../components/Layout'
import {
  SplitWidget,
  initialSplitState,
  splitResidualBasisPoints,
  splitResidualCents,
  splitStateFromTransaction,
  toSplitPayload,
  type SplitState,
} from '../../components/SplitWidget'
import { Avatar, ErrorBanner, Field, Icon, Modal, Segmented } from '../../components/ui'
import { formatDate, todayIso } from '../../lib/format'
import { memberColor } from '../../lib/icons'
import { formatMoney } from '../../lib/money'
import type { Tracker, Transaction, TransactionType } from '../../lib/types'

interface Props {
  tracker: Tracker
  open: boolean
  onClose: () => void
  editing?: Transaction | null
}

export function TransactionForm({ tracker, open, onClose, editing }: Props) {
  const members = useMemo(() => activeMembers(tracker), [tracker])
  const defaultPayer = editing?.paid_by ?? members[0]?.user?.id ?? ''

  const [type, setType] = useState<TransactionType>(editing?.type ?? 'expense')
  const [date, setDate] = useState(editing?.date ?? todayIso())
  const [title, setTitle] = useState(editing?.title ?? '')
  const [amount, setAmount] = useState(editing?.amount ?? '')
  const [category, setCategory] = useState(editing?.category ?? '')
  const [account, setAccount] = useState(editing?.account ?? '')
  const [paidBy, setPaidBy] = useState(defaultPayer)
  const [note, setNote] = useState(editing?.note ?? '')
  const [noteOpen, setNoteOpen] = useState(Boolean(editing?.note))
  const [split, setSplit] = useState<SplitState>(() =>
    editing
      ? splitStateFromTransaction(members, editing.splits, editing.paid_by, editing.amount)
      : initialSplitState(members, defaultPayer),
  )

  const categories = useCategories(tracker.id)
  const accounts = useAccounts(tracker.id)
  const save = useSaveTransaction(tracker.id)

  const residual = splitResidualCents(split, members, amount || '0')
  const residualBp = splitResidualBasisPoints(split, members)
  const canSave = Boolean(title && amount && paidBy) && residual === 0 && residualBp === 0

  const accountName = (accounts.data?.results ?? []).find((a) => a.id === account)?.name

  const submit = async () => {
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
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? 'Modifica movimento' : type === 'expense' ? 'Nuova spesa' : 'Nuova entrata'}
      headerRight={
        <Segmented
          value={type}
          onChange={(value) => {
            setType(value)
            setCategory('')
          }}
          options={[
            { value: 'expense', label: 'Spesa' },
            { value: 'income', label: 'Entrata' },
          ]}
        />
      }
    >
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSave) void submit()
        }}
      >
        <ErrorBanner error={save.error} />

        {/* --- blocco importo: l'importo prima di tutto --- */}
        <div className="rounded-card bg-secondary-container px-6 py-6 text-center text-on-secondary-container">
          <p className="text-[13px] font-semibold uppercase tracking-wide">Importo</p>
          <input
            className="amount w-full border-none bg-transparent text-center text-[44px] font-semibold leading-tight text-on-primary-container outline-none placeholder:text-on-secondary-container/50 sm:text-display-medium"
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(',', '.'))}
            aria-label="Importo"
          />
          <p className="text-body-medium">
            {[title || 'senza descrizione', formatDate(date), accountName]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        {/* --- tastierino: su mobile si salva senza lasciare il pollice --- */}
        <Keypad value={amount} onChange={setAmount} onConfirm={submit} canConfirm={canSave} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Descrizione">
            <input
              className="field-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Esselunga, affitto, stipendio…"
              required
              autoFocus
            />
          </Field>
          <Field label="Data">
            <input
              className="field-input"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </Field>
          <Field label="Categoria">
            <select
              className="field-input"
              value={category ?? ''}
              onChange={(event) => setCategory(event.target.value)}
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
              className="field-input"
              value={account ?? ''}
              onChange={(event) => setAccount(event.target.value)}
            >
              <option value="">Nessuno</option>
              {(accounts.data?.results ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <p className="mb-2 text-body-medium font-medium">
            {type === 'expense' ? 'Ha pagato' : 'Ha incassato'}
          </p>
          <div className="flex flex-wrap gap-2">
            {members.map((member, index) => (
              <button
                key={member.id}
                type="button"
                onClick={() => setPaidBy(member.user!.id)}
                aria-pressed={paidBy === member.user!.id}
                className={
                  paidBy === member.user!.id
                    ? 'state inline-flex items-center gap-2 rounded-pill bg-primary px-4 py-2 text-body-medium font-medium text-on-primary'
                    : 'chip-outlined'
                }
              >
                <Avatar name={member.display_name} size={28} color={memberColor(index)} />
                {member.display_name}
              </button>
            ))}
          </div>
        </div>

        <SplitWidget
          members={members}
          amount={amount || '0'}
          value={split}
          onChange={setSplit}
          currency={tracker.currency}
        />

        {noteOpen && (
          <Field label="Nota">
            <textarea
              className="field-input resize-none"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!noteOpen && (
            <button type="button" className="chip-outlined" onClick={() => setNoteOpen(true)}>
              <Icon name="note_add" size={18} />
              Nota
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="btn-text" onClick={onClose}>
              Annulla
            </button>
            <button className="btn-filled" disabled={!canSave || save.isPending}>
              <Icon name="check" size={20} />
              {save.isPending ? 'Salvataggio…' : 'Salva'}
            </button>
          </div>
        </div>

        {residual !== 0 && (
          <p className="text-body-small text-warning">
            Le quote non quadrano: manca {formatMoney(residual / 100, tracker.currency)}.
          </p>
        )}
        {residualBp !== 0 && (
          <p className="text-body-small text-warning">Le percentuali devono fare 100%.</p>
        )}
      </form>
    </Modal>
  )
}

/**
 * Tastierino mobile. Il tasto di dettatura del design non c'e': senza un
 * riconoscimento vocale vero sarebbe un bottone finto.
 */
function Keypad({
  value,
  onChange,
  onConfirm,
  canConfirm,
}: {
  value: string
  onChange: (value: string) => void
  onConfirm: () => void
  canConfirm: boolean
}) {
  const press = (key: string) => {
    if (key === 'back') {
      onChange(value.slice(0, -1))
      return
    }
    if (key === '.') {
      if (value.includes('.')) return
      onChange((value || '0') + '.')
      return
    }
    // Non si superano i due decimali: l'importo e' sempre a centesimi.
    const [, decimals] = value.split('.')
    if (decimals !== undefined && decimals.length >= 2) return
    onChange(value === '0' ? key : value + key)
  }

  const key = (label: string, action: string, className?: string) => (
    <button
      key={action}
      type="button"
      onClick={() => press(action)}
      className={clsx(
        'state flex items-center justify-center rounded-nested bg-surface py-4 text-title-medium',
        className,
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="grid grid-cols-4 gap-2 rounded-card bg-surface-container p-3 sm:hidden">
      {key('1', '1')}
      {key('2', '2')}
      {key('3', '3')}
      <button
        type="button"
        onClick={() => press('back')}
        aria-label="Cancella"
        className="state flex items-center justify-center rounded-nested bg-secondary-container text-on-secondary-container"
      >
        <Icon name="backspace" size={22} />
      </button>
      {key('4', '4')}
      {key('5', '5')}
      {key('6', '6')}
      <button
        type="button"
        onClick={onConfirm}
        disabled={!canConfirm}
        aria-label="Salva"
        className="state row-span-3 flex items-center justify-center rounded-nested bg-primary text-on-primary disabled:opacity-40"
      >
        <Icon name="check" size={26} />
      </button>
      {key('7', '7')}
      {key('8', '8')}
      {key('9', '9')}
      {key(',', '.')}
      {key('0', '0', 'col-span-2')}
    </div>
  )
}
