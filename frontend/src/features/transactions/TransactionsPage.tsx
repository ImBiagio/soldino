import clsx from 'clsx'
import { useMemo, useRef, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'

import {
  useAccounts,
  useCategories,
  useDeleteTransaction,
  useSaveTransaction,
  useTransactions,
} from '../../api/hooks'
import { activeMembers } from '../../components/Layout'
import {
  Avatar,
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
import { formatDate, monthKey, monthKeyLabel } from '../../lib/format'
import { useClickOutside } from '../../lib/hooks'
import { categoryColor, memberColor } from '../../lib/colors'
import { categoryIcon } from '../../lib/icons'
import { formatCents, formatMoney, normalizeDecimal, toCents } from '../../lib/money'
import type { Account, Category, Tracker, Transaction } from '../../lib/types'
import { NewEntryMenuButton } from '../../components/FabMenu'
import { TransactionForm } from './TransactionForm'

// Il contratto della URL resta quello di prima: cambia solo il controllo.
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
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  // Il FAB della shell apre il form passando da ?new=1: nessuno stato globale.
  const formOpen = params.get('new') === '1' || editing !== null

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

  const closeForm = () => {
    setEditing(null)
    const next = new URLSearchParams(params)
    next.delete('new')
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

  const members = activeMembers(tracker)
  const categoryList = categories.data?.results ?? []
  const accountList = accounts.data?.results ?? []
  // Ogni membro ha un colore stabile per posizione: lo stesso della barra di split.
  const memberIndex = useMemo(
    () => new Map(members.map((member, index) => [member.user!.id, index])),
    [members],
  )

  return (
    <div className="grid gap-[18px] px-5 pb-8 pt-6 md:px-7">
      {/* --- ricerca + azione principale --- */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-14 max-w-[520px] flex-1 items-center gap-3 rounded-panel bg-surface-container px-5">
          <Icon name="search" size={22} className="text-on-surface-variant" />
          <input
            className="w-full border-none bg-transparent text-body-large outline-none placeholder:text-on-surface-variant"
            placeholder={`Cerca fra ${data?.count ?? 0} movimenti`}
            defaultValue={params.get('q') ?? ''}
            onChange={(event) => setFilter('q', event.target.value)}
          />
        </div>
        <NewEntryMenuButton tracker={tracker} className="hidden md:block" />
      </div>

      {/* --- filter chips: sostituiscono i sette select --- */}
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0">
        {params.get('date_from') && (
          <Chip
            selected
            icon="check"
            trailingIcon="close"
            label={`Dal ${formatDate(params.get('date_from')!)}`}
            onClick={() => setFilter('date_from', '')}
          />
        )}
        {params.get('date_to') && (
          <Chip
            selected
            icon="check"
            trailingIcon="close"
            label={`Al ${formatDate(params.get('date_to')!)}`}
            onClick={() => setFilter('date_to', '')}
          />
        )}
        <Chip
          selected={params.get('type') === 'expense'}
          icon={params.get('type') === 'expense' ? 'check' : undefined}
          label="Solo spese"
          onClick={() => setFilter('type', params.get('type') === 'expense' ? '' : 'expense')}
        />
        <Chip
          selected={params.get('type') === 'income'}
          icon={params.get('type') === 'income' ? 'check' : undefined}
          label="Solo entrate"
          onClick={() => setFilter('type', params.get('type') === 'income' ? '' : 'income')}
        />
        <SelectChip
          label="Categoria"
          value={params.get('category')}
          options={categoryList.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(value) => setFilter('category', value)}
        />
        <SelectChip
          label="Conto"
          value={params.get('account')}
          options={accountList.map((a) => ({ value: a.id, label: a.name }))}
          onChange={(value) => setFilter('account', value)}
        />
        <SelectChip
          label="Chi ha pagato"
          value={params.get('paid_by')}
          options={members.map((m) => ({ value: m.user!.id, label: m.display_name }))}
          onChange={(value) => setFilter('paid_by', value)}
        />
        <Chip icon="filter_list" label="Altri filtri" onClick={() => setSheetOpen(true)} />
        {FILTER_KEYS.some((key) => params.get(key)) && (
          <Chip
            icon="close"
            label="Azzera"
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
          />
        )}
      </div>

      <ErrorBanner error={error} />

      {isLoading ? (
        <RowsSkeleton />
      ) : groups.length === 0 ? (
        <EmptyState
          icon="receipt_long"
          title="Nessun movimento"
          description="Cambia i filtri, oppure registra il primo movimento."
          action={
            <button
              type="button"
              onClick={() => setParams(withParam(params, 'new', '1'), { replace: true })}
              className="btn-tonal"
            >
              <Icon name="add" size={20} />
              Nuovo movimento
            </button>
          }
        />
      ) : (
        <div className={clsx('grid gap-5 transition-opacity', isFetching && 'opacity-70')}>
          {groups.map(([key, rows]) => {
            const monthTotal = rows.reduce(
              (sum, tx) => sum + (tx.type === 'expense' ? -1 : 1) * toCents(tx.amount),
              0,
            )
            return (
              <section key={key}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className="text-[22px] font-semibold capitalize">{monthKeyLabel(key)}</h2>
                  <span
                    className={clsx(
                      'amount text-[18px] font-semibold',
                      monthTotal < 0 ? 'text-error' : 'text-primary',
                    )}
                  >
                    {formatCents(monthTotal, tracker.currency)}
                  </span>
                </div>
                <div className="grid gap-1">
                  {rows.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      tracker={tracker}
                      categories={categoryList}
                      accounts={accountList}
                      memberIndex={memberIndex}
                      onEdit={() => setEditing(tx)}
                      onInlineSave={(patch) => save.mutate({ id: tx.id, ...patch })}
                      onDelete={() => remove.mutate(tx.id)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <MoreFiltersSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        params={params}
        onChange={setFilter}
      />

      {formOpen && (
        <TransactionForm
          key={editing?.id ?? 'new'}
          tracker={tracker}
          open
          editing={editing}
          onClose={closeForm}
        />
      )}
    </div>
  )
}

function withParam(params: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(params)
  next.set(key, value)
  return next
}

/* ------------------------------------------------------------ chip menu -- */

function SelectChip({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string | null
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)

  useClickOutside(ref, open, () => setOpen(false))

  return (
    <div ref={ref} className="relative shrink-0">
      <Chip
        selected={Boolean(selected)}
        icon={selected ? 'check' : undefined}
        trailingIcon="arrow_drop_down"
        label={selected?.label ?? label}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 max-h-72 w-56 overflow-y-auto rounded-card bg-surface-container p-2 shadow-sheet">
          <button
            type="button"
            className="state w-full rounded-nested px-3 py-2 text-left text-body-medium"
            onClick={() => {
              onChange('')
              setOpen(false)
            }}
          >
            Tutti
          </button>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={clsx(
                'state w-full rounded-nested px-3 py-2 text-left text-body-medium',
                option.value === value && 'bg-secondary-container text-on-secondary-container',
              )}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MoreFiltersSheet({
  open,
  onClose,
  params,
  onChange,
}: {
  open: boolean
  onClose: () => void
  params: URLSearchParams
  onChange: (key: string, value: string) => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Altri filtri">
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dal">
            <input
              className="field-input"
              type="date"
              value={params.get('date_from') ?? ''}
              onChange={(event) => onChange('date_from', event.target.value)}
            />
          </Field>
          <Field label="Al">
            <input
              className="field-input"
              type="date"
              value={params.get('date_to') ?? ''}
              onChange={(event) => onChange('date_to', event.target.value)}
            />
          </Field>
          <Field label="Importo minimo">
            <input
              className="field-input amount"
              inputMode="decimal"
              value={params.get('min_amount') ?? ''}
              onChange={(event) => onChange('min_amount', event.target.value)}
            />
          </Field>
          <Field label="Importo massimo">
            <input
              className="field-input amount"
              inputMode="decimal"
              value={params.get('max_amount') ?? ''}
              onChange={(event) => onChange('max_amount', event.target.value)}
            />
          </Field>
        </div>
        <button type="button" className="btn-filled w-full" onClick={onClose}>
          Applica
        </button>
      </div>
    </Modal>
  )
}

/* ---------------------------------------------------------------- riga -- */

function TransactionRow({
  tx,
  tracker,
  categories,
  accounts,
  memberIndex,
  onEdit,
  onInlineSave,
  onDelete,
}: {
  tx: Transaction
  tracker: Tracker
  categories: Category[]
  accounts: Account[]
  memberIndex: Map<string, number>
  onEdit: () => void
  onInlineSave: (patch: Record<string, unknown>) => void
  onDelete: () => void
}) {
  const [editingAmount, setEditingAmount] = useState(false)
  const [amount, setAmount] = useState(tx.amount)
  const [menuOpen, setMenuOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const category = categories.find((c) => c.id === tx.category)
  const account = accounts.find((a) => a.id === tx.account)
  const isGroup = tx.splits.length > 1
  const isIncome = tx.type === 'income'

  useClickOutside(menuRef, menuOpen || categoryOpen, () => {
    setMenuOpen(false)
    setCategoryOpen(false)
  })

  const splitLabel = isGroup
    ? tx.splits.map((split) => Math.round(Number(split.share_pct))).join('/')
    : 'personale'

  return (
    <div
      className={clsx(
        'flex items-center gap-3 rounded-row py-3.5 pl-4 pr-2 sm:gap-4 sm:px-5',
        isIncome ? 'bg-secondary-container' : 'bg-surface-container-low',
      )}
    >
      <IconCircle
        name={categoryIcon(category)}
        color={categoryColor(category)}
        size={44}
        className="hidden sm:inline-flex"
      />

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onEdit}
          className="block max-w-full truncate text-left text-body-large font-medium"
        >
          {tx.title}
        </button>
        <p className="flex flex-wrap items-center gap-1.5 text-body-small text-on-surface-variant">
          <span>{formatDate(tx.date).slice(0, 5)}</span>
          <span>·</span>
          {/* La categoria si riassegna sul posto: e' il campo che si sbaglia di piu'. */}
          <span className="relative" ref={categoryOpen ? menuRef : undefined}>
            <button
              type="button"
              onClick={() => setCategoryOpen((open) => !open)}
              className="underline decoration-dotted underline-offset-2"
            >
              {category?.name ?? 'Senza categoria'}
            </button>
            {categoryOpen && (
              <span className="absolute left-0 top-full z-20 mt-1 block max-h-64 w-52 overflow-y-auto rounded-card bg-surface-container p-2 shadow-sheet">
                <button
                  type="button"
                  className="state block w-full rounded-nested px-3 py-2 text-left text-body-medium"
                  onClick={() => {
                    onInlineSave({ category: null })
                    setCategoryOpen(false)
                  }}
                >
                  Senza categoria
                </button>
                {categories
                  .filter((option) => option.type === tx.type)
                  .map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="state block w-full rounded-nested px-3 py-2 text-left text-body-medium"
                      onClick={() => {
                        onInlineSave({ category: option.id })
                        setCategoryOpen(false)
                      }}
                    >
                      {option.name}
                    </button>
                  ))}
              </span>
            )}
          </span>
          {account && (
            <>
              <span>·</span>
              <span>{account.name}</span>
            </>
          )}
          {tx.possible_duplicates.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-pill bg-warning-container px-2 py-0.5 text-on-warning-container">
              <Icon name="content_copy" size={14} />
              possibile doppione
            </span>
          )}
        </p>
        {isGroup && (
          <p className="amount mt-0.5 truncate text-body-small text-on-surface-variant">
            {tx.splits
              .map(
                (split) =>
                  `${split.user_detail.display_name} ${formatMoney(split.share_amount, tracker.currency)}`,
              )
              .join(' · ')}
          </p>
        )}
      </div>

      <span
        className={clsx(
          'hidden shrink-0 items-center gap-1 rounded-pill px-2.5 py-1 text-body-small font-medium sm:inline-flex',
          isGroup
            ? 'bg-secondary-container text-on-secondary-container'
            : 'bg-surface text-on-surface-variant',
        )}
      >
        <Icon name={isGroup ? 'group' : 'person'} size={16} />
        {splitLabel}
      </span>

      <Avatar
        name={tx.paid_by_detail.display_name}
        size={32}
        color={memberColor(memberIndex.get(tx.paid_by) ?? 0)}
      />

      {editingAmount ? (
        <input
          className="field-input amount w-28 rounded-nested bg-surface px-2 py-1 text-right sm:w-[152px]"
          autoFocus
          value={amount}
          onChange={(event) => setAmount(normalizeDecimal(event.target.value))}
          onBlur={() => {
            setEditingAmount(false)
            if (amount !== tx.amount) onInlineSave({ amount })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setAmount(tx.amount)
              setEditingAmount(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditingAmount(true)}
          title="Tocca per correggere"
          className={clsx(
            // Larghezza fissa solo da sm in su: su mobile toglieva spazio alla descrizione.
            'amount min-w-[6.5rem] shrink-0 whitespace-nowrap text-right text-[16px] font-semibold sm:w-[152px] sm:text-amount-row',
            isIncome ? 'text-primary' : 'text-error',
          )}
        >
          {isIncome ? '+' : '−'}
          {formatMoney(tx.amount, tracker.currency)}
        </button>
      )}

      <div className="relative" ref={menuOpen ? menuRef : undefined}>
        <IconButton icon="more_vert" label="Azioni" onClick={() => setMenuOpen((open) => !open)} />
        {menuOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-card bg-surface-container p-2 shadow-sheet">
            <button
              type="button"
              className="state block w-full rounded-nested px-3 py-2 text-left text-body-medium"
              onClick={() => {
                setMenuOpen(false)
                onEdit()
              }}
            >
              Modifica
            </button>
            <button
              type="button"
              className="state block w-full rounded-nested px-3 py-2 text-left text-body-medium text-error"
              onClick={() => {
                setMenuOpen(false)
                onDelete()
              }}
            >
              Elimina
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
