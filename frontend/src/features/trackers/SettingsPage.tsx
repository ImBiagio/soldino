import clsx from 'clsx'
import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'

import {
  useArchiveTracker,
  useCategories,
  useDeleteTracker,
  useDeleteCategory,
  useInvite,
  useRemoveMember,
  useSaveCategory,
  useUpdateMember,
} from '../../api/hooks'
import { activeMembers } from '../../components/Layout'
import { defaultPercentages, formatPct } from '../../components/SplitWidget'
import { Avatar, ErrorBanner, Field, Icon, IconCircle, Modal, Skeleton } from '../../components/ui'
import { categoryColor, categoryIcon, memberColor } from '../../lib/icons'
import type { Category, Tracker, TransactionType } from '../../lib/types'

/** Gli stessi del backend (`Category.DEFAULT_COLORS`): verde entrate, rosso uscite. */
const DEFAULT_CATEGORY_COLOR: Record<TransactionType, string> = {
  expense: '#ba1a1a',
  income: '#1b6c2f',
}

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
        <CategoriesSection tracker={tracker} />
        {isOwner && <LifecycleSection tracker={tracker} />}
      </div>
    </div>
  )
}

/* --------------------------------------------- archivio ed eliminazione -- */

function LifecycleSection({ tracker }: { tracker: Tracker }) {
  const navigate = useNavigate()
  const archive = useArchiveTracker(tracker.id)
  const remove = useDeleteTracker(tracker.id)
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const archived = Boolean(tracker.archived_at)

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <h2 className="text-body-large font-medium">Archivio ed eliminazione</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-body-medium font-medium">
            {archived ? 'Tracker archiviato' : 'Archivia'}
          </p>
          <p className="mb-3 text-body-small text-on-surface-variant">
            {archived
              ? 'È nel gruppo degli archiviati e non riceve ricorrenze automatiche. Ripristinalo per riportarlo fra gli attivi.'
              : 'Per un anno chiuso o un tracker che non usi più: resta consultabile, finisce fra gli archiviati e non riceve più ricorrenze automatiche.'}
          </p>
          <button
            type="button"
            className="btn-tonal btn-sm"
            disabled={archive.isPending}
            onClick={async () => {
              await archive.mutateAsync(!archived)
              if (!archived) navigate('/')
            }}
          >
            <Icon name={archived ? 'unarchive' : 'archive'} size={18} />
            {archived ? 'Ripristina' : 'Archivia'}
          </button>
        </div>
        <div>
          <p className="text-body-medium font-medium text-error">Elimina</p>
          <p className="mb-3 text-body-small text-on-surface-variant">
            Sparisce per tutti i membri, con movimenti, conti e ricorrenze. Se vuoi solo toglierlo
            di mezzo, archivialo.
          </p>
          <button
            type="button"
            className="state inline-flex items-center gap-2 rounded-pill border border-error px-4 py-2 text-body-medium font-medium text-error"
            onClick={() => setConfirming(true)}
          >
            <Icon name="delete" size={18} />
            Elimina tracker
          </button>
        </div>
      </div>
      <ErrorBanner error={archive.error} />

      <Modal
        open={confirming}
        onClose={() => {
          setConfirming(false)
          setTyped('')
        }}
        title="Eliminare il tracker?"
      >
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            await remove.mutateAsync()
            navigate('/', { replace: true })
          }}
        >
          <ErrorBanner error={remove.error} />
          <p className="text-body-medium">
            Spariranno per tutti i {activeMembers(tracker).length} membri i movimenti, i conti, le
            voci in attesa e le ricorrenze di <strong>{tracker.name}</strong>.
          </p>
          <Field label={`Scrivi «${tracker.name}» per confermare`}>
            <input
              className="field-input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoFocus
            />
          </Field>
          <button
            className="state w-full rounded-pill bg-error px-5 py-3 text-body-medium font-medium text-on-primary disabled:opacity-40"
            disabled={typed.trim() !== tracker.name.trim() || remove.isPending}
          >
            {remove.isPending ? 'Elimino…' : 'Elimina definitivamente'}
          </button>
        </form>
      </Modal>
    </section>
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
  // Quanto pesa davvero ciascuno nella divisione "di default": contano solo i membri attivi.
  const effective = defaultPercentages(activeMembers(tracker))

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
                key={member.default_share_pct}
                className="field-input amount w-[72px] text-right"
                inputMode="decimal"
                defaultValue={member.default_share_pct}
                disabled={!isOwner}
                onBlur={(event) => {
                  const value = event.target.value.replace(',', '.').trim()
                  if (value && value !== member.default_share_pct) {
                    update.mutate({ id: member.id, default_share_pct: value })
                  }
                }}
                aria-label={`Peso di ${member.display_name}`}
              />
              <span className="w-24 text-body-small text-on-surface-variant">
                {member.user && effective[member.user.id] !== undefined
                  ? `= ${formatPct(effective[member.user.id])}%`
                  : 'conta da attivo'}
              </span>

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
        Pesi fra 0 e 100, non devono fare 100: a destra la percentuale che ne risulta nella
        divisione di default.
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

/* ----------------------------------------------------------- categorie -- */

function CategoriesSection({ tracker }: { tracker: Tracker }) {
  const { data, isLoading } = useCategories(tracker.id)
  const save = useSaveCategory(tracker.id)
  const remove = useDeleteCategory(tracker.id)
  const [editing, setEditing] = useState<Category | null>(null)
  const [creating, setCreating] = useState<TransactionType | null>(null)
  const [formType, setFormType] = useState<TransactionType>('expense')
  const [formColor, setFormColor] = useState(DEFAULT_CATEGORY_COLOR.expense)

  const categories = data?.results ?? []

  const openForm = (category: Category | null, type: TransactionType) => {
    setEditing(category)
    setCreating(category ? null : type)
    setFormType(category?.type ?? type)
    setFormColor(category?.color ?? DEFAULT_CATEGORY_COLOR[type])
  }

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <h2 className="mb-4 text-body-large font-medium">Categorie</h2>

      {isLoading ? (
        <Skeleton className="h-10" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(['expense', 'income'] as const).map((type) => (
            <div
              key={type}
              className={clsx(
                'rounded-nested p-4',
                type === 'expense' ? 'bg-error-container' : 'bg-secondary-container',
              )}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <p
                  className={clsx(
                    'inline-flex items-center gap-1.5 text-body-medium font-medium',
                    type === 'expense' ? 'text-error' : 'text-primary',
                  )}
                >
                  <Icon name={type === 'expense' ? 'trending_down' : 'trending_up'} size={20} />
                  {type === 'expense' ? 'Uscite' : 'Entrate'}
                </p>
                <button
                  type="button"
                  className="btn-text btn-sm"
                  onClick={() => openForm(null, type)}
                >
                  <Icon name="add" size={18} />
                  Categoria
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {categories
                  .filter((category) => category.type === type)
                  .map((category, index) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => openForm(category, type)}
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
            </div>
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
            setCreating(null)
          }}
          title={
            editing
              ? `Categoria “${editing.name}”`
              : creating === 'income'
                ? 'Nuova categoria di entrata'
                : 'Nuova categoria di uscita'
          }
        >
          <form
            className="grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              await save.mutateAsync({
                id: editing?.id,
                name: String(form.get('name')),
                type: formType,
                description: String(form.get('description') ?? ''),
                color: formColor,
                icon: String(form.get('icon') ?? ''),
              })
              setEditing(null)
              setCreating(null)
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
                  value={formType}
                  onChange={(event) => {
                    const next = event.target.value as TransactionType
                    // Se il colore e' ancora quello di default, segue il tipo.
                    if (formColor === DEFAULT_CATEGORY_COLOR[formType]) {
                      setFormColor(DEFAULT_CATEGORY_COLOR[next])
                    }
                    setFormType(next)
                  }}
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
                  value={formColor}
                  onChange={(event) => setFormColor(event.target.value)}
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
