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
import { Avatar, ErrorBanner, Field, Modal, Spinner } from '../../components/ui'
import { formatMoney } from '../../lib/money'
import type { Tracker } from '../../lib/types'

export function SettingsPage() {
  const tracker = useOutletContext<Tracker>()
  const isOwner = tracker.my_role === 'owner'

  return (
    <div className="space-y-6">
      <MembersSection tracker={tracker} isOwner={isOwner} />
      <AccountsSection tracker={tracker} />
      <CategoriesSection tracker={tracker} />
    </div>
  )
}

function MembersSection({ tracker, isOwner }: { tracker: Tracker; isOwner: boolean }) {
  const update = useUpdateMember(tracker.id)
  const remove = useRemoveMember(tracker.id)
  const invite = useInvite(tracker.id)
  const [open, setOpen] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const total = tracker.members
    .filter((m) => m.status === 'active')
    .reduce((sum, m) => sum + Number(m.default_share_pct), 0)

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Membri e percentuali di default</h2>
        {isOwner && (
          <button className="btn-ghost" onClick={() => setOpen(true)}>
            Invita
          </button>
        )}
      </div>

      <ul className="space-y-2">
        {tracker.members
          .filter((m) => m.status !== 'revoked')
          .map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Avatar name={member.display_name} />
              <span className="min-w-0 flex-1 truncate">
                {member.display_name}
                {member.status === 'pending' && (
                  <span className="ml-2 chip bg-amber-100 text-amber-700">invito in sospeso</span>
                )}
              </span>
              <select
                className="input w-auto py-1"
                value={member.role}
                disabled={!isOwner || member.role === 'owner'}
                onChange={(e) => update.mutate({ id: member.id, role: e.target.value as never })}
              >
                <option value="owner">Proprietario</option>
                <option value="editor">Editor</option>
                <option value="viewer">Sola lettura</option>
              </select>
              <input
                className="input amount w-20 py-1 text-right"
                defaultValue={member.default_share_pct}
                disabled={!isOwner}
                onBlur={(e) =>
                  e.target.value !== member.default_share_pct &&
                  update.mutate({ id: member.id, default_share_pct: e.target.value })
                }
                aria-label={`Percentuale di default di ${member.display_name}`}
              />
              <span className="text-xs text-ink-500">%</span>
              {isOwner && member.role !== 'owner' && (
                <button
                  className="text-ink-400 hover:text-rose-600"
                  onClick={() => remove.mutate(member.id)}
                  aria-label="Rimuovi"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
      </ul>
      <p className="text-xs text-ink-500">
        Somma delle percentuali attive: {total.toFixed(2)}%. Non devono per forza fare 100: sono
        pesi, e la ripartizione a centesimi quadra comunque.
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
          <div className="space-y-2">
            <p className="text-sm">Invito creato. In sviluppo la mail finisce in console:</p>
            <code className="block break-all rounded bg-ink-100 p-2 text-xs dark:bg-ink-900">
              {inviteLink}
            </code>
          </div>
        ) : (
          <form
            className="space-y-3"
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
              <input className="input" type="email" name="email" required autoFocus />
            </Field>
            <Field label="Ruolo">
              <select className="input" name="role" defaultValue="editor">
                <option value="editor">Editor</option>
                <option value="viewer">Sola lettura</option>
              </select>
            </Field>
            <Field label="Percentuale di default">
              <input className="input amount text-right" name="pct" defaultValue="50.00" />
            </Field>
            <button className="btn-primary w-full" disabled={invite.isPending}>
              Invia invito
            </button>
          </form>
        )}
      </Modal>
    </section>
  )
}

function AccountsSection({ tracker }: { tracker: Tracker }) {
  const { data, isLoading } = useAccounts(tracker.id)
  const save = useSaveAccount(tracker.id)
  const remove = useDeleteAccount(tracker.id)
  const [open, setOpen] = useState(false)
  const members = tracker.members.filter((m) => m.status === 'active' && m.user)

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Conti</h2>
        <button className="btn-ghost" onClick={() => setOpen(true)}>
          + Conto
        </button>
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <ul className="space-y-2">
          {(data?.results ?? []).map((account) => (
            <li key={account.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {account.name}
                <span className="ml-2 text-xs text-ink-500">
                  {account.kind} · {account.owner_detail.display_name}
                </span>
              </span>
              <input
                className="input amount w-32 py-1 text-right"
                defaultValue={account.current_balance}
                onBlur={(e) =>
                  e.target.value !== account.current_balance &&
                  save.mutate({ id: account.id, current_balance: e.target.value.replace(',', '.') })
                }
                aria-label={`Saldo di ${account.name}`}
              />
              <label className="flex items-center gap-1 text-xs text-ink-500">
                <input
                  type="checkbox"
                  checked={account.include_in_totals}
                  onChange={(e) =>
                    save.mutate({ id: account.id, include_in_totals: e.target.checked })
                  }
                />
                nei totali
              </label>
              <button
                className="text-ink-400 hover:text-rose-600"
                onClick={() => remove.mutate(account.id)}
                aria-label="Elimina"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-500">
        Totale dichiarato:{' '}
        <span className="amount">
          {formatMoney(
            (data?.results ?? [])
              .filter((a) => a.include_in_totals)
              .reduce((sum, a) => sum + Number(a.current_balance), 0),
            tracker.currency,
          )}
        </span>
      </p>
      <ErrorBanner error={save.error ?? remove.error} />

      <Modal open={open} onClose={() => setOpen(false)} title="Nuovo conto">
        <form
          className="space-y-3"
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
            <input className="input" name="name" required autoFocus placeholder="Hype, BBVA…" />
          </Field>
          <Field label="Tipo">
            <select className="input" name="kind" defaultValue="bank">
              <option value="bank">Conto corrente</option>
              <option value="card">Carta</option>
              <option value="cash">Contanti</option>
              <option value="wallet">Wallet</option>
            </select>
          </Field>
          <Field label="Intestatario">
            <select className="input" name="owner" required>
              {members.map((m) => (
                <option key={m.id} value={m.user!.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Saldo attuale">
            <input className="input amount text-right" name="balance" defaultValue="0.00" />
          </Field>
          <button className="btn-primary w-full">Crea</button>
        </form>
      </Modal>
    </section>
  )
}

function CategoriesSection({ tracker }: { tracker: Tracker }) {
  const { data, isLoading } = useCategories(tracker.id)
  const save = useSaveCategory(tracker.id)
  const remove = useDeleteCategory(tracker.id)
  const [open, setOpen] = useState(false)

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Categorie</h2>
        <button className="btn-ghost" onClick={() => setOpen(true)}>
          + Categoria
        </button>
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <ul className="space-y-1">
          {(data?.results ?? []).map((category) => (
            <li key={category.id} className="flex items-center gap-2 text-sm">
              <input
                type="color"
                className="h-6 w-6 cursor-pointer rounded border-none bg-transparent p-0"
                value={category.color}
                onChange={(e) => save.mutate({ id: category.id, color: e.target.value })}
                aria-label={`Colore di ${category.name}`}
              />
              <span className="w-40 shrink-0 truncate">{category.name}</span>
              <span className="chip bg-ink-100 text-ink-600 dark:bg-ink-700 dark:text-ink-300">
                {category.type === 'expense' ? 'spesa' : 'entrata'}
              </span>
              {/* La descrizione e' cio' che in fase 3 viene passato all'LLM: vale la pena curarla. */}
              <input
                className="input flex-1 py-1 text-xs"
                defaultValue={category.description}
                placeholder="Descrizione (serve alla categorizzazione automatica)"
                onBlur={(e) =>
                  e.target.value !== category.description &&
                  save.mutate({ id: category.id, description: e.target.value })
                }
              />
              <button
                className="text-ink-400 hover:text-rose-600"
                onClick={() => remove.mutate(category.id)}
                aria-label="Elimina"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorBanner error={save.error ?? remove.error} />

      <Modal open={open} onClose={() => setOpen(false)} title="Nuova categoria">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            await save.mutateAsync({
              name: String(form.get('name')),
              type: form.get('type') as never,
              description: String(form.get('description') ?? ''),
            })
            setOpen(false)
          }}
        >
          <ErrorBanner error={save.error} />
          <Field label="Nome">
            <input className="input" name="name" required autoFocus />
          </Field>
          <Field label="Tipo">
            <select className="input" name="type" defaultValue="expense">
              <option value="expense">Spesa</option>
              <option value="income">Entrata</option>
            </select>
          </Field>
          <Field label="Descrizione">
            <textarea className="input" name="description" rows={2} />
          </Field>
          <button className="btn-primary w-full">Crea</button>
        </form>
      </Modal>
    </section>
  )
}
