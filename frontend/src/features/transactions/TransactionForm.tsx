import clsx from 'clsx'
import { useMemo, useState } from 'react'

import { useAccounts, useSaveTransaction } from '../../api/hooks'
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
import { AccountSelect, CategorySelect } from '../../components/selects'
import { ErrorBanner, Field, Icon, MemberChips, Modal, Segmented } from '../../components/ui'
import { formatDate, todayIso } from '../../lib/format'
import { TYPE_LABEL, TYPE_OPTIONS } from '../../lib/labels'
import { formatCents, normalizeDecimal } from '../../lib/money'
import { isGroup, showsIncome, showsSection } from '../../lib/trackerKind'
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
      : initialSplitState(members, defaultPayer, isGroup(tracker) ? 'default' : 'personal'),
  )
  // In un gruppo solo spese; un'entrata gia' registrata si modifica come prima.
  const typeSwitch = showsIncome(tracker) || editing?.type === 'income'
  // Senza la sezione Conti il conto non si sceglie, salvo che il movimento ne abbia gia' uno.
  const accountField = showsSection(tracker, 'conti') || Boolean(editing?.account)

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
        typeSwitch && (
          <Segmented
            value={type}
            onChange={(value) => {
              setType(value)
              setCategory('')
            }}
            options={TYPE_OPTIONS}
          />
        )
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
        <div
          className={clsx(
            'rounded-card px-6 py-6 text-center transition-colors duration-200',
            type === 'expense'
              ? 'bg-error-container text-on-error-container'
              : 'bg-primary-container text-on-primary-container',
          )}
        >
          <p className="text-[13px] font-semibold uppercase tracking-wide">{TYPE_LABEL[type]}</p>
          <input
            className="amount w-full border-none bg-transparent text-center text-[44px] font-semibold leading-tight text-inherit outline-none placeholder:text-current placeholder:opacity-40 sm:text-display-medium"
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            onChange={(event) => setAmount(normalizeDecimal(event.target.value))}
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
            <CategorySelect
              trackerId={tracker.id}
              type={type}
              hideArchived
              value={category ?? ''}
              onChange={(event) => setCategory(event.target.value)}
            />
          </Field>
          {accountField && (
            <Field label="Conto">
              <AccountSelect
                trackerId={tracker.id}
                value={account ?? ''}
                onChange={(event) => setAccount(event.target.value)}
              />
            </Field>
          )}
        </div>

        <div>
          <p className="mb-2 text-body-medium font-medium">
            {type === 'expense' ? 'Ha pagato' : 'Ha incassato'}
          </p>
          <MemberChips
            members={members}
            value={paidBy}
            onChange={setPaidBy}
            avatarSize={28}
            filled
          />
        </div>

        <SplitWidget
          members={members}
          amount={amount || '0'}
          value={split}
          onChange={setSplit}
          currency={tracker.currency}
          barOnlyInPercent
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
            Le quote non quadrano: manca {formatCents(residual, tracker.currency)}.
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
