import clsx from 'clsx'
import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'

import {
  useArchiveTracker,
  useCategories,
  useDeleteTracker,
  useDeleteCategory,
  useDuplicateTracker,
  useInvite,
  useRemoveMember,
  useSaveCategory,
  useUpdateMember,
  useUpdateTracker,
} from '../../api/hooks'
import { activeMembers } from '../../components/Layout'
import { SelectField } from '../../components/selects'
import { defaultPercentages, formatPct } from '../../components/SplitWidget'
import {
  Avatar,
  ErrorBanner,
  Field,
  Icon,
  IconButton,
  IconCircle,
  Modal,
  Segmented,
  Skeleton,
  Switch,
} from '../../components/ui'
import { DEFAULT_CATEGORY_COLOR, categoryColor, memberColor } from '../../lib/colors'
import { getLanguages, gettext, interpolate, intlLocale, ngettext } from '../../lib/i18n'
import { categoryIcon } from '../../lib/icons'
import { ROLE_LABEL, ROLE_OPTIONS, TYPE_OPTIONS } from '../../lib/labels'
import { normalizeDecimal } from '../../lib/money'
import { showsSection } from '../../lib/trackerKind'
import { KindPicker } from './TrackerListPage'
import type { Category, Tracker, TransactionType } from '../../lib/types'

export function SettingsPage() {
  const tracker = useOutletContext<Tracker>()
  const isOwner = tracker.my_role === 'owner'

  return (
    <div className="p-5 md:p-7">
      <div className="panel grid gap-5 sm:p-6 md:p-7">
        <h1 className="text-title-large">{gettext('Setup del tracker')}</h1>
        <KindSection tracker={tracker} isOwner={isOwner} />
        <MembersSection tracker={tracker} isOwner={isOwner} />
        <DebtsSection tracker={tracker} isOwner={isOwner} />
        {showsSection(tracker, 'banca') && <BankSyncSection tracker={tracker} isOwner={isOwner} />}
        <CategoriesSection tracker={tracker} />
        {isOwner && <LifecycleSection tracker={tracker} />}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- tipo -- */

function KindSection({ tracker, isOwner }: { tracker: Tracker; isOwner: boolean }) {
  const update = useUpdateTracker(tracker.id)
  const value = (update.isPending && update.variables?.kind) || tracker.kind

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <h2 className="text-body-large font-medium">{gettext('Tipo di tracker')}</h2>
      <p className="mb-3 mt-1 text-body-small text-on-surface-variant">
        {gettext(
          'Cambia solo cosa si vede: movimenti, conti e ricorrenze restano tutti, e tornando indietro ricompaiono.',
        )}{' '}
        {!isOwner && gettext('Lo decide il proprietario del tracker.')}
      </p>
      <KindPicker
        value={value}
        disabled={!isOwner || update.isPending}
        onChange={(kind) => kind !== tracker.kind && update.mutate({ kind })}
      />
      <ErrorBanner error={update.error} />
    </section>
  )
}

/* ------------------------------------------------------------- debiti -- */

function DebtsSection({ tracker, isOwner }: { tracker: Tracker; isOwner: boolean }) {
  const update = useUpdateTracker(tracker.id)
  const checked = update.isPending
    ? Boolean(update.variables?.simplify_debts)
    : tracker.simplify_debts

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-body-large font-medium">{gettext('Semplifica i debiti')}</h2>
          <p className="mt-1 text-body-small text-on-surface-variant">
            {checked
              ? gettext(
                  'Acceso: i debiti si chiudono col minor numero di bonifici, anche fra persone che non hanno spese in comune. Se Anna ha pagato per Bruno e Bruno per Carla, basta che Carla dia i soldi ad Anna.',
                )
              : gettext(
                  'Spento: ognuno restituisce a chi ha pagato per lui, al netto di quello che quella persona deve a lui. Più bonifici, ma ogni debito resta fra chi ha condiviso la spesa.',
                )}
          </p>
          <p className="mt-1 text-body-small text-on-surface-variant">
            {gettext('In due non cambia nulla.')}{' '}
            {!isOwner && gettext('Lo decide il proprietario del tracker.')}
          </p>
        </div>
        <Switch
          checked={checked}
          disabled={!isOwner || update.isPending}
          onChange={(next) => update.mutate({ simplify_debts: next })}
          label={gettext('Semplifica i debiti')}
        />
      </div>
      <ErrorBanner error={update.error} />
    </section>
  )
}

/* ------------------------------------------------------------- banca -- */

const BANK_SYNC_OPTIONS: { value: Tracker['bank_sync_frequency']; label: string }[] = [
  { value: 'daily', label: gettext('Ogni giorno') },
  { value: 'weekly', label: gettext('Ogni settimana') },
  { value: 'monthly', label: gettext('Ogni mese') },
  { value: 'manual', label: gettext('Mai') },
]

const BANK_SYNC_HINT: Record<Tracker['bank_sync_frequency'], string> = {
  daily: gettext('Ogni mattina saldo e movimenti del giorno prima.'),
  weekly: gettext('Il lunedì mattina saldo e movimenti della settimana passata.'),
  monthly: gettext(
    'Il primo del mese saldo e movimenti del mese appena chiuso, come un estratto conto.',
  ),
  manual: gettext(
    'Nessuna lettura programmata: la banca non viene chiamata finché non lo chiedi tu.',
  ),
}

/** Ogni quanto si leggono i conti collegati in Banca (ADR 0013): default mensile. */
function BankSyncSection({ tracker, isOwner }: { tracker: Tracker; isOwner: boolean }) {
  const update = useUpdateTracker(tracker.id)
  const value = update.isPending
    ? (update.variables?.bank_sync_frequency ?? tracker.bank_sync_frequency)
    : tracker.bank_sync_frequency

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <h2 className="text-body-large font-medium">{gettext('Lettura dei conti in banca')}</h2>
      <p className="mt-1 text-body-small text-on-surface-variant">
        {BANK_SYNC_HINT[value]}{' '}
        {gettext(
          'I movimenti arrivano in Da rivedere, o si registrano da soli sui conti con "Registra in automatico". Dalla Banca puoi sempre fare "Sincronizza ora".',
        )}{' '}
        {!isOwner && gettext('Lo decide il proprietario del tracker.')}
      </p>
      <div className="mt-3">
        {isOwner ? (
          <Segmented
            value={value}
            options={BANK_SYNC_OPTIONS}
            onChange={(next) => update.mutate({ bank_sync_frequency: next })}
          />
        ) : (
          <span className="text-body-medium font-medium">
            {BANK_SYNC_OPTIONS.find((o) => o.value === value)?.label}
          </span>
        )}
      </div>
      <ErrorBanner error={update.error} />
    </section>
  )
}

/* --------------------------------------------- archivio ed eliminazione -- */

function LifecycleSection({ tracker }: { tracker: Tracker }) {
  const navigate = useNavigate()
  const archive = useArchiveTracker(tracker.id)
  const remove = useDeleteTracker(tracker.id)
  const [confirming, setConfirming] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [typed, setTyped] = useState('')
  const archived = Boolean(tracker.archived_at)

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <h2 className="text-body-large font-medium">{gettext('Duplica, archivia, elimina')}</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <p className="text-body-medium font-medium">{gettext('Duplica')}</p>
          <p className="mb-3 text-body-small text-on-surface-variant">
            {gettext(
              'Un tracker nuovo con le stesse categorie e impostazioni, per esempio per l’anno nuovo. I movimenti non si copiano.',
            )}
          </p>
          <button type="button" className="btn-tonal btn-sm" onClick={() => setDuplicating(true)}>
            <Icon name="content_copy" size={18} />
            {gettext('Duplica')}
          </button>
        </div>
        <div>
          <p className="text-body-medium font-medium">
            {archived ? gettext('Tracker archiviato') : gettext('Archivia')}
          </p>
          <p className="mb-3 text-body-small text-on-surface-variant">
            {archived
              ? gettext(
                  'È nel gruppo degli archiviati e non riceve ricorrenze automatiche. Ripristinalo per riportarlo fra gli attivi.',
                )
              : gettext(
                  'Per un anno chiuso o un tracker che non usi più: resta consultabile, finisce fra gli archiviati e non riceve più ricorrenze automatiche.',
                )}
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
            {archived ? gettext('Ripristina') : gettext('Archivia')}
          </button>
        </div>
        <div>
          <p className="text-body-medium font-medium text-error">{gettext('Elimina')}</p>
          <p className="mb-3 text-body-small text-on-surface-variant">
            {gettext(
              'Sparisce per tutti i membri, con movimenti, conti e ricorrenze. Se vuoi solo toglierlo di mezzo, archivialo.',
            )}
          </p>
          <button
            type="button"
            className="state inline-flex items-center gap-2 rounded-pill border border-error px-4 py-2 text-body-medium font-medium text-error"
            onClick={() => setConfirming(true)}
          >
            <Icon name="delete" size={18} />
            {gettext('Elimina tracker')}
          </button>
        </div>
      </div>
      <ErrorBanner error={archive.error} />

      {duplicating && <DuplicateModal tracker={tracker} onClose={() => setDuplicating(false)} />}

      <Modal
        open={confirming}
        onClose={() => {
          setConfirming(false)
          setTyped('')
        }}
        title={gettext('Eliminare il tracker?')}
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
            {interpolate(
              gettext(
                'Spariranno per tutti i %(count)s membri i movimenti, i conti, le voci in attesa e le ricorrenze di',
              ),
              { count: activeMembers(tracker).length },
              true,
            )}{' '}
            <strong>{tracker.name}</strong>.
          </p>
          <Field
            label={interpolate(
              gettext('Scrivi «%(name)s» per confermare'),
              { name: tracker.name },
              true,
            )}
          >
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
            {remove.isPending ? gettext('Elimino…') : gettext('Elimina definitivamente')}
          </button>
        </form>
      </Modal>
    </section>
  )
}

function DuplicateModal({ tracker, onClose }: { tracker: Tracker; onClose: () => void }) {
  const navigate = useNavigate()
  const duplicate = useDuplicateTracker(tracker.id)
  const [name, setName] = useState(
    interpolate(gettext('%(name)s (copia)'), { name: tracker.name }, true),
  )
  const [members, setMembers] = useState(true)
  const [accounts, setAccounts] = useState(true)
  const [recurring, setRecurring] = useState(false)
  const others = activeMembers(tracker).length - 1
  const household = showsSection(tracker, 'conti')

  const options = [
    others > 0 && {
      label: gettext('Membri e quote'),
      hint: interpolate(
        ngettext(
          'Entra subito anche l’altra persona, con il suo ruolo e la sua quota.',
          'Entrano subito anche le altre %(count)s persone, con ruolo e quota.',
          others,
        ),
        { count: others },
        true,
      ),
      checked: members,
      onChange: setMembers,
    },
    household && {
      label: gettext('Conti'),
      hint: gettext('Con il saldo di oggi. Il collegamento alla banca resta su questo tracker.'),
      checked: accounts,
      onChange: setAccounts,
    },
    household && {
      label: gettext('Ricorrenze e abbonamenti'),
      hint: gettext(
        'Quelle attive. Archivia questo tracker, o le automatiche si registrano in tutti e due.',
      ),
      checked: recurring,
      onChange: setRecurring,
    },
  ].filter(Boolean) as {
    label: string
    hint: string
    checked: boolean
    onChange: (value: boolean) => void
  }[]

  return (
    <Modal open onClose={onClose} title={gettext('Duplica il tracker')}>
      <form
        className="grid gap-4"
        onSubmit={async (event) => {
          event.preventDefault()
          const copy = await duplicate.mutateAsync({
            name: name.trim(),
            members: others > 0 && members,
            accounts: household && accounts,
            recurring: household && recurring,
          })
          navigate(`/t/${copy.id}`)
        }}
      >
        <ErrorBanner error={duplicate.error} />
        <Field label={gettext('Nome')}>
          <input
            className="field-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
            autoFocus
          />
        </Field>
        <p className="text-body-medium text-on-surface-variant">
          {gettext(
            'Categorie, valuta, tipo e impostazioni si copiano sempre. Movimenti, pareggi e voci in attesa no.',
          )}
        </p>
        {options.length > 0 && (
          <div className="grid gap-1">
            {options.map((option) => (
              <div key={option.label} className="flex items-center gap-4 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-body-large">{option.label}</p>
                  <p className="text-body-small text-on-surface-variant">{option.hint}</p>
                </div>
                <Switch checked={option.checked} onChange={option.onChange} label={option.label} />
              </div>
            ))}
          </div>
        )}
        <button className="btn-filled w-full" disabled={!name.trim() || duplicate.isPending}>
          <Icon name="content_copy" size={20} />
          {duplicate.isPending ? gettext('Duplico…') : gettext('Duplica')}
        </button>
      </form>
    </Modal>
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
        <h2 className="text-body-large font-medium">{gettext("Chi c'è, e con quale peso")}</h2>
        {isOwner && (
          <button type="button" className="btn-tonal btn-sm" onClick={() => setOpen(true)}>
            {gettext('Invita')}
          </button>
        )}
      </div>

      <div className="grid gap-3">
        {visible.map((member, index) => {
          const weight = Number(member.default_share_pct)
          return (
            <div key={member.id} className="flex flex-wrap items-center gap-4">
              <Avatar name={member.display_name} size={40} color={memberColor(index)} />
              {/* Con un minimo di larghezza i controlli vanno a capo invece di schiacciare il nome. */}
              <div className="min-w-[8rem] flex-1">
                <p className="truncate text-body-large font-medium">{member.display_name}</p>
                <p className="flex flex-wrap items-center gap-2 text-body-small text-on-surface-variant">
                  {ROLE_LABEL[member.role]}
                  {member.status === 'pending' && (
                    <span className="rounded-pill bg-warning-container px-2 py-0.5 text-on-warning-container">
                      {gettext('invito in sospeso')}
                    </span>
                  )}
                </p>
              </div>

              <div className="ml-auto flex items-center gap-3 sm:gap-4">
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
                    const value = normalizeDecimal(event.target.value)
                    if (value && value !== member.default_share_pct) {
                      update.mutate({ id: member.id, default_share_pct: value })
                    }
                  }}
                  aria-label={interpolate(
                    gettext('Peso di %(name)s'),
                    { name: member.display_name },
                    true,
                  )}
                />
                <span className="w-24 text-body-small text-on-surface-variant">
                  {member.user && effective[member.user.id] !== undefined
                    ? `= ${formatPct(effective[member.user.id])}%`
                    : gettext('conta da attivo')}
                </span>

                {isOwner && member.role !== 'owner' && (
                  <>
                    <SelectField
                      className="w-auto rounded-nested bg-surface-container px-3 py-2 text-body-medium"
                      value={member.role}
                      options={ROLE_OPTIONS}
                      onChange={(role) => update.mutate({ id: member.id, role: role as never })}
                      ariaLabel={interpolate(
                        gettext('Ruolo di %(name)s'),
                        { name: member.display_name },
                        true,
                      )}
                    />
                    <IconButton
                      icon="close"
                      label={gettext('Rimuovi')}
                      onClick={() => remove.mutate(member.id)}
                    />
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-4 text-body-small text-on-surface-variant">
        {gettext(
          'Pesi fra 0 e 100, non devono fare 100: a destra la percentuale che ne risulta nella divisione di default.',
        )}
      </p>
      <ErrorBanner error={update.error ?? remove.error} />

      <Modal
        open={open}
        onClose={() => {
          setOpen(false)
          setInviteLink(null)
        }}
        title={gettext('Invita una persona')}
      >
        {inviteLink ? (
          <div className="grid gap-2">
            <p className="text-body-medium">
              {gettext('Invito creato. In sviluppo la mail va in console:')}
            </p>
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
                default_share_pct: normalizeDecimal(String(form.get('pct'))),
              })
              setInviteLink(
                result.invite_token
                  ? `${window.location.origin}/inviti/${result.invite_token}`
                  : gettext('Email inviata.'),
              )
            }}
          >
            <ErrorBanner error={invite.error} />
            <Field label={gettext('Email')}>
              <input className="field-input" type="email" name="email" required autoFocus />
            </Field>
            <Field label={gettext('Ruolo')}>
              <SelectField name="role" defaultValue="editor" options={ROLE_OPTIONS} />
            </Field>
            <Field label={gettext('Peso di default')}>
              <input className="field-input amount text-right" name="pct" defaultValue="50.00" />
            </Field>
            <button className="btn-filled w-full" disabled={invite.isPending}>
              {gettext('Invia invito')}
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

  // Per nome tradotto: l'API ordina per il nome scritto.
  const categories = [...(data?.results ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, intlLocale()),
  )

  const openForm = (category: Category | null, type: TransactionType) => {
    save.reset()
    setEditing(category)
    setCreating(category ? null : type)
    setFormType(category?.type ?? type)
    setFormColor(category?.color ?? DEFAULT_CATEGORY_COLOR[type])
  }

  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <h2 className="mb-4 text-body-large font-medium">{gettext('Categorie')}</h2>

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
                  {type === 'expense' ? gettext('Uscite') : gettext('Entrate')}
                </p>
                <button
                  type="button"
                  className="btn-text btn-sm"
                  onClick={() => openForm(null, type)}
                >
                  <Icon name="add" size={18} />
                  {gettext('Categoria')}
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
        {gettext(
          'La descrizione di ogni categoria alimenterà la categorizzazione automatica: si modifica toccando la chip.',
        )}
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
              ? interpolate(gettext('Categoria “%(name)s”'), { name: editing.name }, true)
              : creating === 'income'
                ? gettext('Nuova categoria di entrata')
                : gettext('Nuova categoria di uscita')
          }
        >
          <form
            className="grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              // Si manda solo quello che e' cambiato: un nome originale nuovo
              // rifa' tutte le lingue, una traduzione corretta tocca solo la sua.
              const names: Partial<Category> = {}
              if (editing) {
                const original = String(form.get('original_name') ?? '').trim()
                if (original && original !== editing.original_name) {
                  names.original_name = original
                }
                const changed: Record<string, string> = {}
                for (const { code } of getLanguages()) {
                  const value = String(form.get(`name_${code}`) ?? '').trim()
                  if (value !== (editing.name_translations[code] ?? '')) changed[code] = value
                }
                if (Object.keys(changed).length) names.name_translations = changed
              } else {
                names.name = String(form.get('name'))
              }
              try {
                await save.mutateAsync({
                  id: editing?.id,
                  ...names,
                  type: formType,
                  description: String(form.get('description') ?? ''),
                  color: formColor,
                  icon: String(form.get('icon') ?? ''),
                })
              } catch {
                return // l'errore lo mostra il banner nel dialog
              }
              setEditing(null)
              setCreating(null)
            }}
          >
            {/* Dentro il dialog: fuori resterebbe coperto (es. un nome gia' usato). */}
            <ErrorBanner error={save.error} />
            {editing ? (
              <>
                <Field
                  label={gettext('Nome originale')}
                  hint={gettext(
                    'Il nome com’è stato scritto (anche quello del foglio da importare). Cambiandolo si rifanno tutte le traduzioni.',
                  )}
                >
                  <input
                    className="field-input"
                    name="original_name"
                    required
                    defaultValue={editing.original_name}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  {getLanguages().map(({ code, name }) => (
                    <Field key={code} label={name}>
                      <input
                        className="field-input"
                        name={`name_${code}`}
                        defaultValue={editing.name_translations[code] ?? ''}
                        placeholder={gettext('Vuoto: la traduce Gemini')}
                      />
                    </Field>
                  ))}
                </div>
                <p className="-mt-1 px-4 text-body-small text-on-surface-variant">
                  {gettext('Correggi solo come si legge nell’app: il nome originale resta com’è.')}
                </p>
              </>
            ) : (
              <Field label={gettext('Nome')}>
                <input className="field-input" name="name" required autoFocus />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label={gettext('Tipo')}>
                <SelectField
                  name="type"
                  value={formType}
                  options={TYPE_OPTIONS}
                  onChange={(value) => {
                    const next = value as TransactionType
                    // Se il colore e' ancora quello di default, segue il tipo.
                    if (formColor === DEFAULT_CATEGORY_COLOR[formType]) {
                      setFormColor(DEFAULT_CATEGORY_COLOR[next])
                    }
                    setFormType(next)
                  }}
                />
              </Field>
              <Field label={gettext('Colore')}>
                <input
                  className="field-input h-8 p-0"
                  type="color"
                  name="color"
                  value={formColor}
                  onChange={(event) => setFormColor(event.target.value)}
                />
              </Field>
            </div>
            <Field
              label={gettext('Icona')}
              hint={gettext('Nome di un glifo Material Symbols, es. shopping_basket.')}
            >
              <input
                className="field-input"
                name="icon"
                defaultValue={editing?.icon}
                placeholder="shopping_basket"
              />
            </Field>
            <Field
              label={gettext('Descrizione')}
              hint={gettext(
                'È il testo che in fase 3 verrà passato alla categorizzazione automatica.',
              )}
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
                  {gettext('Elimina')}
                </button>
              )}
              <button className="btn-filled flex-1">{gettext('Salva')}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
