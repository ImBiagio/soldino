import clsx from 'clsx'
import type { ReactNode } from 'react'

import { activeMembers } from '../../components/Layout'
import { Avatar, Icon } from '../../components/ui'
import { monthLabel } from '../../lib/format'
import { categoryColor, categoryIcon, memberColor } from '../../lib/icons'
import { toCents } from '../../lib/money'
import type { Category, StatementLine } from '../../lib/types'

export type Row = StatementLine & { key: string }
type Members = ReturnType<typeof activeMembers>

const SOURCE: Record<string, { icon: string; label: string }> = {
  history: {
    icon: 'history',
    label: 'Dallo storico: questo esercente era già in questa categoria',
  },
  ai: { icon: 'auto_awesome', label: 'Suggerita leggendo le descrizioni delle categorie' },
}

const CHIP =
  'state relative inline-flex h-8 max-w-full shrink-0 items-center gap-1.5 rounded-pill border border-outline-variant px-3 text-[13px] font-medium text-on-surface-variant'

/**
 * Chip M3 che apre una scelta. Sotto c'e' un <select> nativo invisibile: su
 * telefono apre il picker di sistema, da tastiera si usa con frecce e lettere.
 */
export function SelectChip({
  value,
  options,
  onChange,
  label,
  leading,
  trailing,
  tone = 'outlined',
  ariaLabel,
  title,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  label: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  tone?: 'outlined' | 'tonal' | 'warning'
  ariaLabel: string
  title?: string
}) {
  return (
    <label
      title={title}
      className={clsx(
        CHIP,
        'cursor-pointer focus-within:ring-2 focus-within:ring-primary',
        tone === 'tonal' && 'border-transparent bg-secondary-container text-on-secondary-container',
        tone === 'warning' && 'border-transparent bg-warning-container text-on-warning-container',
      )}
    >
      {leading}
      <span className="truncate">{label}</span>
      {trailing}
      <Icon name="arrow_drop_down" size={18} className="-mr-1.5" />
      <select
        className="absolute inset-0 cursor-pointer opacity-0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split('-').map(Number)
  if (!month || !day) return 'Data'
  return `${day} ${monthLabel(month).slice(0, 3)}`
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name
}

/**
 * Riga della revisione come list item M3 a due livelli: sopra quello che si
 * legge (segno, descrizione, importo), sotto i chip di quello che si decide.
 */
export function ReviewRow({
  row,
  categories,
  members,
  onChange,
  onRemove,
}: {
  row: Row
  categories: Category[]
  members: Members
  onChange: (patch: Partial<Row>) => void
  onRemove: () => void
}) {
  const expense = row.type === 'expense'
  const category = categories.find((c) => c.id === row.category)
  const options = categories.filter((c) => c.type === row.type && !c.archived)
  const payerIndex = Math.max(
    members.findIndex((m) => m.user!.id === row.paid_by),
    0,
  )
  const payer = members[payerIndex]
  const source = SOURCE[row.category_source ?? '']
  const amountOk = toCents(row.amount) > 0

  const amount = (
    <span className="inline-flex items-center">
      <span
        className={clsx(
          'amount -mr-2 shrink-0 text-title-medium font-semibold',
          expense ? 'text-error' : 'text-primary',
        )}
      >
        {expense ? '−' : '+'}
      </span>
      <input
        className={clsx(
          'amount shrink-0 rounded-nested border-none bg-transparent px-1.5 py-1 text-right text-title-medium font-semibold outline-none transition hover:bg-surface-container-low focus:bg-surface-container',
          expense ? 'text-error' : 'text-primary',
          !amountOk && 'bg-error-container',
        )}
        // Il campo si stringe sul numero (font mono): il segno resta attaccato.
        style={{ width: `calc(${Math.max(String(row.amount).length, 4)}ch + 0.9rem)` }}
        inputMode="decimal"
        value={row.amount}
        onChange={(event) => onChange({ amount: event.target.value.replace('.', ',') })}
        placeholder="0,00"
        aria-label="Importo"
      />
    </span>
  )
  const removeButton = (
    <button
      type="button"
      onClick={onRemove}
      className="state flex h-10 w-10 shrink-0 items-center justify-center rounded-pill text-on-surface-variant"
      aria-label={`Elimina ${row.title || 'riga'}`}
    >
      <Icon name="delete" size={20} />
    </button>
  )

  return (
    <div className="flex items-start gap-3 rounded-row bg-surface px-3 py-2.5 sm:px-4">
      <button
        type="button"
        onClick={() => onChange({ type: expense ? 'income' : 'expense', category: null })}
        className={clsx(
          'state mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-pill',
          expense
            ? 'bg-error-container text-on-error-container'
            : 'bg-secondary-container text-on-secondary-container',
        )}
        title={expense ? 'Uscita: tocca per farla entrata' : 'Entrata: tocca per farla uscita'}
        aria-label={expense ? 'Uscita' : 'Entrata'}
      >
        <Icon name={expense ? 'remove' : 'add'} size={22} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded-nested border-none bg-transparent px-1.5 py-1 text-body-large font-medium text-on-surface outline-none transition hover:bg-surface-container-low focus:bg-surface-container"
            value={row.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="Descrizione"
            aria-label="Descrizione"
          />
          <div className="hidden shrink-0 items-center sm:flex">{amount}</div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1">
          <div className="-ml-1.5 flex w-full items-center justify-between sm:hidden">
            {amount}
            {removeButton}
          </div>
          <label
            className={clsx(CHIP, 'cursor-pointer focus-within:ring-2 focus-within:ring-primary')}
          >
            <Icon name="calendar_today" size={16} />
            {shortDate(row.date)}
            <input
              type="date"
              className="absolute inset-0 cursor-pointer opacity-0"
              value={row.date}
              onChange={(event) => event.target.value && onChange({ date: event.target.value })}
              onClick={(event) => event.currentTarget.showPicker?.()}
              aria-label="Data"
            />
          </label>

          <SelectChip
            ariaLabel="Categoria"
            value={row.category ?? ''}
            onChange={(value) => onChange({ category: value || null, category_source: 'manual' })}
            options={[
              { value: '', label: 'Senza categoria' },
              ...options.map((c) => ({ value: c.id, label: c.name })),
            ]}
            tone={category ? 'tonal' : 'outlined'}
            leading={
              <span
                className="flex h-5 w-5 items-center justify-center rounded-pill text-white"
                style={{ background: category ? categoryColor(category) : 'var(--outline)' }}
              >
                <Icon name={category ? categoryIcon(category) : 'sell'} size={13} />
              </span>
            }
            label={category?.name ?? 'Categoria'}
            trailing={
              source && category ? (
                <span title={source.label} className="opacity-70">
                  <Icon name={source.icon} size={15} />
                </span>
              ) : undefined
            }
            title={source && category ? source.label : undefined}
          />

          <SelectChip
            ariaLabel="Chi paga"
            value={row.paid_by}
            onChange={(value) => onChange({ paid_by: value })}
            options={members.map((m) => ({ value: m.user!.id, label: `Paga ${m.display_name}` }))}
            leading={
              payer && (
                <Avatar name={payer.display_name} size={20} color={memberColor(payerIndex)} />
              )
            }
            label={payer ? firstName(payer.display_name) : 'Chi paga'}
            title="Chi ha pagato"
          />

          <SelectChip
            ariaLabel="Divisione"
            value={row.split_mode}
            onChange={(value) => onChange({ split_mode: value as Row['split_mode'] })}
            options={[
              { value: 'personal', label: 'Solo sua' },
              { value: 'default', label: 'Divisa di default' },
            ]}
            leading={<Icon name={row.split_mode === 'default' ? 'group' : 'person'} size={16} />}
            label={row.split_mode === 'default' ? 'Divisa' : 'Solo sua'}
          />

          {row.duplicate_of && (
            <span
              className={clsx(
                CHIP,
                'border-transparent bg-warning-container text-on-warning-container',
              )}
              title="Stessa data, importo e tipo di un movimento già registrato"
            >
              <Icon name="content_copy" size={15} />
              Doppione?
            </span>
          )}
        </div>
      </div>

      <div className="mt-0.5 hidden sm:block">{removeButton}</div>
    </div>
  )
}
