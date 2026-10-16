// Le select ricorrenti dei form: categoria, conto, membro. Accettano gli
// attributi nativi (name/defaultValue per i form non controllati, value/onChange
// per quelli controllati) e caricano da sole categorie e conti del tracker.

import clsx from 'clsx'
import type { SelectHTMLAttributes } from 'react'

import { useAccounts, useCategories } from '../api/hooks'
import { gettext } from '../lib/i18n'
import type { Membership, TransactionType, UUID } from '../lib/types'

type NativeSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'>

export function CategorySelect({
  trackerId,
  type,
  hideArchived,
  className,
  ...props
}: NativeSelectProps & {
  trackerId: UUID
  /** Solo le categorie di quel tipo; senza, tutte. */
  type?: TransactionType
  hideArchived?: boolean
}) {
  const categories = useCategories(trackerId)
  const options = (categories.data?.results ?? []).filter(
    (c) => (!type || c.type === type) && (!hideArchived || !c.archived),
  )
  return (
    <select className={clsx('field-input', className)} {...props}>
      <option value="">{gettext('Senza categoria')}</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

export function AccountSelect({
  trackerId,
  className,
  ...props
}: NativeSelectProps & { trackerId: UUID }) {
  const accounts = useAccounts(trackerId)
  return (
    <select className={clsx('field-input', className)} {...props}>
      <option value="">{gettext('Nessuno')}</option>
      {(accounts.data?.results ?? []).map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  )
}

/** Un'opzione per membro, col suo id utente come valore. */
export function MemberSelect({
  members,
  className,
  ...props
}: NativeSelectProps & { members: Membership[] }) {
  return (
    <select className={clsx('field-input', className)} {...props}>
      {members.map((member) => (
        <option key={member.id} value={member.user!.id}>
          {member.display_name}
        </option>
      ))}
    </select>
  )
}
