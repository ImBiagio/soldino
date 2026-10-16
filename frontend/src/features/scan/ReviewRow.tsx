import clsx from 'clsx'
import type { ReactNode } from 'react'

import { activeMembers } from '../../components/Layout'
import { Avatar, Icon, IconButton } from '../../components/ui'
import { monthLabel } from '../../lib/format'
import { gettext, interpolate } from '../../lib/i18n'
import { categoryColor, memberColor } from '../../lib/colors'
import { categoryIcon } from '../../lib/icons'
import { toCents } from '../../lib/money'
import type { Category, StatementLine } from '../../lib/types'

export type Row = StatementLine & { key: string }
type Members = ReturnType<typeof activeMembers>

const SOURCE: Record<string, { icon: string; label: string }> = {
  history: {
    icon: 'history',
    label: gettext('Dallo storico: questo esercente era già in questa categoria'),
  },
  ai: {
    icon: 'auto_awesome',
    label: gettext('Suggerita leggendo le descrizioni delle categorie'),
  },
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
  if (!month || !day) return gettext('Data')
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
  const transfer = row.type === 'transfer'
  const category = categories.find((c) => c.id === row.category)
  const options = categories.filter((c) => c.type === row.type && !c.archived)
  const payerIndex = Math.max(
    members.findIndex((m) => m.user!.id === row.paid_by),
    0,
  )
  const payer = members[payerIndex]
  const source = SOURCE[row.category_source ?? '']
  const receiverIndex = members.findIndex((m) => m.user!.id === row.to_user)
  const receiver = receiverIndex >= 0 ? members[receiverIndex] : null
  // Uscita -> entrata -> pareggio (solo se c'e' qualcuno a cui dare i soldi).
  const nextType = (): Partial<Row> => {
    if (expense) return { type: 'income', category: null }
    if (!transfer && members.length > 1) {
      const other = members.find((m) => m.user!.id !== row.paid_by)
      return { type: 'transfer', category: null, to_user: other?.user?.id ?? null }
    }
    return { type: 'expense', category: null, to_user: null }
  }
  const tone = transfer ? 'text-on-surface' : expense ? 'text-error' : 'text-primary'
  const sign = transfer ? '' : expense ? '−' : '+'
  const amountOk = toCents(row.amount) > 0

  const amount = (
    <span className="inline-flex items-center">
      <span className={clsx('amount -mr-2 shrink-0 text-title-medium font-semibold', tone)}>
        {sign}
      </span>
      <input
        className={clsx(
          'amount shrink-0 rounded-nested border-none bg-transparent px-1.5 py-1 text-right text-title-medium font-semibold outline-none transition hover:bg-surface-container-low focus:bg-surface-container',
          tone,
          !amountOk && 'bg-error-container',
        )}
        // Il campo si stringe sul numero (font mono): il segno resta attaccato.
        style={{ width: `calc(${Math.max(String(row.amount).length, 4)}ch + 0.9rem)` }}
        inputMode="decimal"
        value={row.amount}
        onChange={(event) => onChange({ amount: event.target.value.replace('.', ',') })}
        placeholder="0,00"
        aria-label={gettext('Importo')}
      />
    </span>
  )
  const removeButton = (
    <IconButton
      icon="delete"
      label={
        row.title
          ? interpolate(gettext('Elimina %(title)s'), { title: row.title }, true)
          : gettext('Elimina riga')
      }
      onClick={onRemove}
      size="md"
      className="shrink-0"
    />
  )

  return (
    <div className="flex items-start gap-3 rounded-row bg-surface px-3 py-2.5 sm:px-4">
      <button
        type="button"
        onClick={() => onChange(nextType())}
        className={clsx(
          'state mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-pill',
          transfer
            ? 'bg-surface-container-high text-on-surface'
            : expense
              ? 'bg-error-container text-on-error-container'
              : 'bg-secondary-container text-on-secondary-container',
        )}
        title={
          transfer
            ? gettext('Pareggio: soldi dati a un altro membro. Tocca per farlo uscita')
            : expense
              ? gettext('Uscita: tocca per farla entrata')
              : members.length > 1
                ? gettext('Entrata: tocca per farla pareggio')
                : gettext('Entrata: tocca per farla uscita')
        }
        aria-label={
          transfer ? gettext('Pareggio') : expense ? gettext('Uscita') : gettext('Entrata')
        }
      >
        <Icon name={transfer ? 'swap_horiz' : expense ? 'remove' : 'add'} size={22} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded-nested border-none bg-transparent px-1.5 py-1 text-body-large font-medium text-on-surface outline-none transition hover:bg-surface-container-low focus:bg-surface-container"
            value={row.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder={gettext('Descrizione')}
            aria-label={gettext('Descrizione')}
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
              aria-label={gettext('Data')}
            />
          </label>

          {!transfer && (
            <SelectChip
              ariaLabel={gettext('Categoria')}
              value={row.category ?? ''}
              onChange={(value) => onChange({ category: value || null, category_source: 'manual' })}
              options={[
                { value: '', label: gettext('Senza categoria') },
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
              label={category?.name ?? gettext('Categoria')}
              trailing={
                source && category ? (
                  <span title={source.label} className="opacity-70">
                    <Icon name={source.icon} size={15} />
                  </span>
                ) : undefined
              }
              title={source && category ? source.label : undefined}
            />
          )}

          <SelectChip
            ariaLabel={gettext('Chi paga')}
            value={row.paid_by}
            onChange={(value) => onChange({ paid_by: value })}
            options={members.map((m) => ({
              value: m.user!.id,
              label: transfer
                ? interpolate(gettext('Da %(name)s'), { name: m.display_name }, true)
                : interpolate(gettext('Paga %(name)s'), { name: m.display_name }, true),
            }))}
            leading={
              payer && (
                <Avatar name={payer.display_name} size={20} color={memberColor(payerIndex)} />
              )
            }
            label={
              payer
                ? transfer
                  ? interpolate(
                      gettext('Da %(name)s'),
                      { name: firstName(payer.display_name) },
                      true,
                    )
                  : firstName(payer.display_name)
                : gettext('Chi paga')
            }
            title={transfer ? gettext('Chi dà i soldi') : gettext('Chi ha pagato')}
          />

          {transfer ? (
            <SelectChip
              ariaLabel={gettext('A chi')}
              value={row.to_user ?? ''}
              onChange={(value) => onChange({ to_user: value || null })}
              options={[
                { value: '', label: gettext('A chi…') },
                ...members
                  .filter((m) => m.user!.id !== row.paid_by)
                  .map((m) => ({
                    value: m.user!.id,
                    label: interpolate(gettext('A %(name)s'), { name: m.display_name }, true),
                  })),
              ]}
              tone={receiver ? 'tonal' : 'warning'}
              leading={
                receiver ? (
                  <Avatar
                    name={receiver.display_name}
                    size={20}
                    color={memberColor(receiverIndex)}
                  />
                ) : (
                  <Icon name="arrow_forward" size={16} />
                )
              }
              label={
                receiver
                  ? interpolate(
                      gettext('A %(name)s'),
                      { name: firstName(receiver.display_name) },
                      true,
                    )
                  : gettext('A chi?')
              }
              title={gettext('Chi riceve i soldi')}
            />
          ) : (
            <SelectChip
              ariaLabel={gettext('Divisione')}
              value={row.split_mode}
              onChange={(value) => onChange({ split_mode: value as Row['split_mode'] })}
              options={[
                { value: 'personal', label: gettext('Solo sua') },
                { value: 'default', label: gettext('Divisa di default') },
              ]}
              leading={<Icon name={row.split_mode === 'default' ? 'group' : 'person'} size={16} />}
              label={row.split_mode === 'default' ? gettext('Divisa') : gettext('Solo sua')}
            />
          )}

          {row.duplicate_of && (
            <span
              className={clsx(
                CHIP,
                'border-transparent bg-warning-container text-on-warning-container',
              )}
              title={gettext('Stessa data, importo e tipo di un movimento già registrato')}
            >
              <Icon name="content_copy" size={15} />
              {gettext('Doppione?')}
            </span>
          )}
        </div>
      </div>

      <div className="mt-0.5 hidden sm:block">{removeButton}</div>
    </div>
  )
}
