// Le select ricorrenti: categoria, conto, membro, e le scelte generiche dei
// form. Sono tutte lo stesso `Picker` (stesso menu, stessa ricerca), con due
// trigger: dentro un `Field` (`SelectField`) o come chip di un filtro
// (`ChipSelect`). Nei form non controllati basta `name` + `defaultValue`: il
// valore viaggia in un input nascosto, quindi `FormData` lo legge come prima.

import clsx from 'clsx'
import { useState } from 'react'

import { useAccounts, useCategories } from '../api/hooks'
import { categoryColor } from '../lib/colors'
import { gettext, intlLocale } from '../lib/i18n'
import { categoryIcon } from '../lib/icons'
import { accountLabel } from '../lib/labels'
import type { Account, Category, Membership, TransactionType, UUID } from '../lib/types'
import { FieldTrigger, Picker, type PickerOption } from './Picker'
import { Icon } from './ui'

/* ------------------------------------------------------------- pezzi -- */

/** Il pallino colorato con l'icona della categoria, uguale in ogni menu. */
export function CategoryDot({
  category,
  size = 22,
}: {
  category?: Pick<Category, 'color' | 'icon' | 'name'> | null
  size?: number
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-pill text-white"
      style={{
        width: size,
        height: size,
        background: category ? categoryColor(category) : 'var(--outline)',
      }}
    >
      <Icon name={category ? categoryIcon(category) : 'sell'} size={Math.round(size * 0.62)} />
    </span>
  )
}

export function categoryOptions(
  categories: Category[],
  { type, hideArchived }: { type?: TransactionType; hideArchived?: boolean } = {},
): PickerOption[] {
  // In ordine di nome tradotto: l'API ordina per il nome scritto, che in
  // un'altra lingua sembra un ordine a caso.
  return categories
    .filter((c) => (!type || c.type === type) && (!hideArchived || !c.archived))
    .sort((a, b) => a.name.localeCompare(b.name, intlLocale()))
    .map((c) => ({ value: c.id, label: c.name, leading: <CategoryDot category={c} /> }))
}

export function accountOptions(accounts: Account[]): PickerOption[] {
  return accounts.map((a) => ({ value: a.id, label: accountLabel(a) }))
}

/** Valore controllato (`value`) o interno, seminato da `defaultValue`. */
function useControllable(
  value: string | undefined,
  defaultValue: string | undefined,
  onChange: ((value: string) => void) | undefined,
): [string, (value: string) => void] {
  const [inner, setInner] = useState(defaultValue ?? '')
  const current = value ?? inner
  return [
    current,
    (next: string) => {
      if (value === undefined) setInner(next)
      onChange?.(next)
    },
  ]
}

interface BaseSelectProps {
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  /** Nome del campo nei form non controllati. */
  name?: string
  disabled?: boolean
  className?: string
  ariaLabel?: string
  placeholder?: string
}

/* ------------------------------------------------------------ generici -- */

/** La select di un form, dentro un `Field`: si vede come un input. */
export function SelectField({
  options,
  value,
  defaultValue,
  onChange,
  name,
  disabled,
  className,
  ariaLabel,
  placeholder,
  searchable,
}: BaseSelectProps & { options: PickerOption[]; searchable?: boolean }) {
  const [current, setCurrent] = useControllable(value, defaultValue, onChange)
  return (
    <>
      <Picker
        value={current}
        options={options}
        onChange={setCurrent}
        searchable={searchable}
        disabled={disabled}
        ariaLabel={ariaLabel}
        renderTrigger={(state) => (
          <FieldTrigger state={state} placeholder={placeholder} className={className} />
        )}
      />
      {name && <input type="hidden" name={name} value={current} />}
    </>
  )
}

/** Chip di filtro: mostra la scelta o l'etichetta, "Tutti" toglie il filtro. */
export function ChipSelect({
  label,
  value,
  options,
  onChange,
  searchable,
  allLabel = gettext('Tutti'),
}: {
  label: string
  value: string
  options: PickerOption[]
  onChange: (value: string) => void
  searchable?: boolean
  allLabel?: string
}) {
  return (
    <Picker
      value={value}
      options={[{ value: '', label: allLabel }, ...options]}
      onChange={onChange}
      searchable={searchable}
      ariaLabel={label}
      renderTrigger={({ selected, props }) => {
        const active = Boolean(value) && Boolean(selected)
        return (
          <button
            {...props}
            aria-pressed={active}
            className={clsx('shrink-0', active ? 'chip-selected' : 'chip-outlined')}
          >
            {active ? (selected!.leading ?? <Icon name="check" size={18} />) : null}
            <span className="max-w-[14rem] truncate">{active ? selected!.label : label}</span>
            <Icon name="arrow_drop_down" size={18} className="-mr-1" />
          </button>
        )
      }}
    />
  )
}

/* ---------------------------------------------------------- di dominio -- */

export function CategorySelect({
  trackerId,
  type,
  hideArchived,
  emptyLabel = gettext('Senza categoria'),
  ...props
}: BaseSelectProps & {
  trackerId: UUID
  /** Solo le categorie di quel tipo; senza, tutte. */
  type?: TransactionType
  hideArchived?: boolean
  emptyLabel?: string
}) {
  const categories = useCategories(trackerId)
  const options = [
    { value: '', label: emptyLabel, leading: <CategoryDot /> },
    ...categoryOptions(categories.data?.results ?? [], { type, hideArchived }),
  ]
  return <SelectField {...props} options={options} searchable />
}

export function AccountSelect({
  trackerId,
  emptyLabel = gettext('Nessuno'),
  ...props
}: BaseSelectProps & { trackerId: UUID; emptyLabel?: string }) {
  const accounts = useAccounts(trackerId)
  const options = [
    { value: '', label: emptyLabel },
    ...accountOptions(accounts.data?.results ?? []),
  ]
  return <SelectField {...props} options={options} />
}

/** Un'opzione per membro, col suo id utente come valore; senza valore, il primo. */
export function MemberSelect({
  members,
  value,
  defaultValue,
  ...props
}: BaseSelectProps & { members: Membership[] }) {
  const options = members.map((member) => ({
    value: member.user!.id,
    label: member.display_name,
  }))
  return (
    <SelectField
      {...props}
      value={value}
      defaultValue={defaultValue || options[0]?.value}
      options={options}
    />
  )
}
