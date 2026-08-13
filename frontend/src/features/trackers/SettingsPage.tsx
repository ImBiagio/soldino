import clsx from 'clsx'
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'

import {
  useAccounts,
  useCategories,
  useDeleteAccount,
  useDeleteCategory,
  useInvite,
  useRemoveMember,
  useSaveAccount,
  useSaveCategory,
  useUpdateMember,
} from '../../api/hooks'
import { activeMembers } from '../../components/Layout'
import {
  Avatar,
  ErrorBanner,
  Field,
  Icon,
  IconCircle,
  Modal,
  Skeleton,
  Switch,
} from '../../components/ui'
import { accountIcon, categoryColor, categoryIcon, memberColor } from '../../lib/icons'
import { formatMoney } from '../../lib/money'
import type { Category, Tracker } from '../../lib/types'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Proprietario',
  editor: 'Editor',
  viewer: 'Sola lettura',
}

export function SettingsPage() {
  const tracker = useOutletContext<Tracker>()
  const isOwner = tracker.my_role === 'owner'

  return (
    <div className="p-5 md:p-7">
      <div className="panel grid gap-5 p-6 md:p-7">
        <h1 className="text-title-large">Setup del tracker</h1>
        <MembersSection tracker={tracker} isOwner={isOwner} />
        <AccountsSection tracker={tracker} />
        <CategoriesSection tracker={tracker} />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- membri -- */

function MembersSection({ tracker, isOwner }: { tracker: Tracker; isOwner: boolean }) {
  const update = useUpdateMember(tracker.id)
  const remove = useRemoveMember(tracker.id)
  const invite = useInvite(tracker.id)
  const [open, setOpen] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const visible = tracker.members.filter((member) => member.status !== 'revoked')
  const maxWeight = Math.max(...visible.map((member) => Number(member.default_share_pct)), 1)

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-body-large font-medium">Chi c'è, e con quale peso</h2>
        {isOwner && (
          <button type="button" className="btn-tonal btn-sm" onClick={() => setOpen(true)}>
            Invita
          </button>
        )}
      </div>

      <div className="grid gap-3">
        {visible.map((member, index) => {
          const weight = Number(member.default_share_pct)
          return (
            <div key={member.id} className="flex flex-wrap items-center gap-4">
              <Avatar name={member.display_name} size={40} color={memberColor(index)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-large font-medium">{member.display_name}</p>
                <p className="flex flex-wrap items-center gap-2 text-body-small text-on-surface-variant">
                  {ROLE_LABEL[member.role]}
                  {member.status === 'pending' && (
                    <span className="rounded-pill bg-warning-container px-2 py-0.5 text-on-warning-container">
                      invito in sospeso
                    </span>
                  )}
                </p>
              </div>

              <div
                className="hidden h-2 overflow-hidden rounded sm:block"
                style={{ width: 140, background: 'var(--outline-variant)' }}
              >
                <div
                  className="h-full rounded"
                  style={{
                    width: `${(weight / maxWeight) * 100}%`,
                    background: memberColor(index),
                  }}
                />
              </div>

              <input
                className="field-input amount w-[60px] text-right"
                defaultValue={member.default_share_pct}
                disabled={!isOwner}
                onBlur={(event) =>
                  event.target.value !== member.default_share_pct &&
                  update.mutate({ id: member.id, default_share_pct: event.target.value })
                }
                aria-label={`Peso di ${member.display_name}`}
              />
              <span className="text-body-small text-on-surface-variant">%</span>

              {isOwner && member.role !== 'owner' && (
                <>
                  <select
                    className="field-input w-auto"
                    value={member.role}
                    onChange={(event) =>
                      update.mutate({ id: member.id, role: event.target.value as never })
                    }
                    aria-label={`Ruolo di ${member.display_name}`}
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Sola lettura</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => remove.mutate(member.id)}
                    aria-label="Rimuovi"
                    className="state flex h-9 w-9 items-center justify-center rounded-pill text-on-surface-variant"
                  >
                    <Icon name="close" size={20} />
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>

      <p className="mt-4 text-body-small text-on-surface-variant">
        Sono pesi, non deve fare 100: la ripartizione a centesimi quadra comunque.
      </p>
      <ErrorBanner error={update.error ?? remove.error} />

      <Modal
        open={open}
        onClose={() => {
          setOpen(false)
          setInviteLink(null)
        }}
        title="Invita una persona"
      >
        {inviteLink ? (
          <div className="grid gap-2">
            <p className="text-body-medium">Invito creato. In sviluppo la mail va in console:</p>
            <code className="block break-all rounded-row bg-surface-container p-3 text-body-small">
              {inviteLink}
            </code>
          </div>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              const result = await invite.mutateAsync({
                email: String(form.get('email')),
                role: String(form.get('role')),
                default_share_pct: String(form.get('pct')).replace(',', '.'),
              })
              setInviteLink(
                result.invite_token
                  ? `${window.location.origin}/inviti/${result.invite_token}`
                  : 'Email inviata.',
              )
            }}
          >
            <ErrorBanner error={invite.error} />
            <Field label="Email">
              <input className="field-input" type="email" name="email" required autoFocus />
            </Field>
            <Field label="Ruolo">
              <select className="field-input" name="role" defaultValue="editor">
                <option value="editor">Editor</option>
                <option value="viewer">Sola lettura</option>
              </select>
            </Field>
            <Field label="Peso di default">
              <input className="field-input amount text-right" name="pct" defaultValue="50.00" />
            </Field>
            <button className="btn-filled w-full" disabled={invite.isPending}>
              Invia invito
            </button>
          </form>
        )}
      </Modal>
    </section>
  )
}

/* --------------------------------------------------------------- conti -- */

function AccountsSection({ tracker }: { tracker: Tracker }) {
  const { data, isLoading } = useAccounts(tracker.id)
  const save = useSaveAccount(tracker.id)
  const remove = useDeleteAccount(tracker.id)
  const [open, setOpen] = useState(false)
  const members = activeMembers(tracker)

  const accounts = data?.results ?? []
  const declared = accounts
    .filter((account) => account.include_in_totals)
    .reduce((sum, account) => sum + Number(account.current_balance), 0)

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-body-large font-medium">
          Conti ·{' '}
          <span className="amount font-semibold">{formatMoney(declared, tracker.currency)}</span>{' '}
          dichiarati
        </h2>
        <button type="button" className="btn-tonal btn-sm" onClick={() => setOpen(true)}>
          <Icon name="add" size={18} />
          Conto
        </button>
      </div>

      {isLoading ? (
        <Skeleton className="h-16" />
      ) : (
        <div className="grid gap-2">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex flex-wrap items-center gap-3 rounded-nested bg-surface px-4 py-3"
            >
              <IconCircle name={accountIcon(account.kind)} color="var(--tertiary)" size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-large font-medium">{account.name}</p>
                <p className="text-body-small text-on-surface-variant">
                  {account.kind} · {account.owner_detail.display_name}
                </p>
              </div>
              <input
                className="field-input amount w-32 text-right"
                defaultValue={account.current_balance}
                onBlur={(event) =>
                  event.target.value !== account.current_balance &&
                  save.mutate({
                    id: account.id,
                    current_balance: event.target.value.replace(',', '.'),
                  })
                }
                aria-label={`Saldo di ${account.name}`}
              />
              <Switch
                checked={account.include_in_totals}
                onChange={(checked) => save.mutate({ id: account.id, include_in_totals: checked })}
                label={`${account.name} nei totali`}
              />
              <button
                type="button"
                onClick={() => remove.mutate(account.id)}
                aria-label="Elimina"
                className="state flex h-9 w-9 items-center justify-center rounded-pill text-on-surface-variant"
              >
                <Icon name="close" size={20} />
              </button>
            </div>
          ))}
        </div>
      )}
      <ErrorBanner error={save.error ?? remove.error} />

      <Modal open={open} onClose={() => setOpen(false)} title="Nuovo conto">
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            await save.mutateAsync({
              name: String(form.get('name')),
              owner: String(form.get('owner')),
              kind: form.get('kind') as never,
              current_balance: String(form.get('balance')).replace(',', '.'),
            })
            setOpen(false)
          }}
        >
          <ErrorBanner error={save.error} />
          <Field label="Nome">
            <input
              className="field-input"
              name="name"
              required
              autoFocus
              placeholder="Hype, BBVA…"
            />
          </Field>
          <Field label="Tipo">
            <select className="field-input" name="kind" defaultValue="bank">
              <option value="bank">Conto corrente</option>
              <option value="card">Carta</option>
              <option value="cash">Contanti</option>
              <option value="wallet">Wallet</option>
            </select>
          </Field>
          <Field label="Intestatario">
            <select className="field-input" name="owner" required>
              {members.map((member) => (
                <option key={member.id} value={member.user!.id}>
                  {member.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Saldo attuale">
            <input className="field-input amount text-right" name="balance" defaultValue="0.00" />
          </Field>
          <button className="btn-filled w-full">Crea</button>
        </form>
      </Modal>
    </section>
  )
}

/* ----------------------------------------------------------- categorie -- */

function CategoriesSection({ tracker }: { tracker: Tracker }) {
  const { data, isLoading } = useCategories(tracker.id)
  const save = useSaveCategory(tracker.id)
  const remove = useDeleteCategory(tracker.id)
  const [editing, setEditing] = useState<Category | null>(null)
  const [creating, setCreating] = useState(false)

  const categories = data?.results ?? []

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-body-large font-medium">Categorie</h2>
        <button type="button" className="btn-tonal btn-sm" onClick={() => setCreating(true)}>
          <Icon name="add" size={18} />
          Categoria
        </button>
      </div>

      {isLoading ? (
        <Skeleton className="h-10" />
      ) : (
        <div className="flex flex-wrap gap-2">
          {categories.map((category, index) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setEditing(category)}
              className="state inline-flex items-center gap-2 rounded-pill bg-surface py-1.5 pl-1.5 pr-4 text-body-medium"
            >
              <IconCircle
                name={categoryIcon(category)}
                color={categoryColor(category, index)}
                size={22}
              />
              {category.name}
            </button>
          ))}
        </div>
      )}

      <p className="mt-4 text-body-small text-on-surface-variant">
        La descrizione di ogni categoria alimenterà la categorizzazione automatica: si modifica
        toccando la chip.
      </p>
      <ErrorBanner error={save.error ?? remove.error} />

      {(editing || creating) && (
        <Modal
          open
          onClose={() => {
            setEditing(null)
            setCreating(false)
          }}
          title={editing ? `Categoria “${editing.name}”` : 'Nuova categoria'}
        >
          <form
            className="grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              await save.mutateAsync({
                id: editing?.id,
                name: String(form.get('name')),
                type: (form.get('type') as never) ?? editing?.type,
                description: String(form.get('description') ?? ''),
                color: String(form.get('color')),
                icon: String(form.get('icon') ?? ''),
              })
              setEditing(null)
              setCreating(false)
            }}
          >
            <Field label="Nome">
              <input
                className="field-input"
                name="name"
                required
                autoFocus
                defaultValue={editing?.name}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipo">
                <select
                  className="field-input"
                  name="type"
                  defaultValue={editing?.type ?? 'expense'}
                >
                  <option value="expense">Spesa</option>
                  <option value="income">Entrata</option>
                </select>
              </Field>
              <Field label="Colore">
                <input
                  className="field-input h-8 p-0"
                  type="color"
                  name="color"
                  defaultValue={editing?.color ?? '#1b6c2f'}
                />
              </Field>
            </div>
            <Field label="Icona" hint="Nome di un glifo Material Symbols, es. shopping_basket.">
              <input
                className="field-input"
                name="icon"
                defaultValue={editing?.icon}
                placeholder="shopping_basket"
              />
            </Field>
            <Field
              label="Descrizione"
              hint="È il testo che in fase 3 verrà passato alla categorizzazione automatica."
            >
              <textarea
                className="field-input resize-none"
                name="description"
                rows={2}
                defaultValue={editing?.description}
              />
            </Field>
            <div className="flex gap-2">
              {editing && (
                <button
                  type="button"
                  className={clsx('btn-outlined flex-1 text-error')}
                  onClick={() => {
                    remove.mutate(editing.id)
                    setEditing(null)
                  }}
                >
                  Elimina
                </button>
              )}
              <button className="btn-filled flex-1">Salva</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
