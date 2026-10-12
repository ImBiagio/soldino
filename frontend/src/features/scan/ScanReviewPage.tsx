import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'

import { useCategories, useStatement, useStatementAction } from '../../api/hooks'
import { activeMembers } from '../../components/Layout'
import { ErrorBanner, Icon, Skeleton } from '../../components/ui'
import { formatDate, todayIso } from '../../lib/format'
import { formatMoney, toCents } from '../../lib/money'
import type {
  Category,
  StatementImport,
  StatementLine,
  Tracker,
  TransactionType,
} from '../../lib/types'
import { STATUS_LABEL } from './ScanPage'

/** Riga in revisione: `key` resta stabile anche per le righe aggiunte a mano. */
type Row = StatementLine & { key: string }

let counter = 0
const newKey = () => `nuova-${++counter}`

const SOURCE_BADGE: Record<string, { icon: string; label: string }> = {
  history: {
    icon: 'history',
    label: 'Dallo storico: questo esercente era già in questa categoria',
  },
  ai: { icon: 'auto_awesome', label: 'Suggerita leggendo le descrizioni delle categorie' },
}

export function ScanReviewPage() {
  const tracker = useOutletContext<Tracker>()
  const { statementId } = useParams()
  const { data: statement, isLoading, error } = useStatement(tracker.id, statementId)

  return (
    <div className="grid gap-5 p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to=".."
          relative="path"
          className="state flex h-10 w-10 items-center justify-center rounded-pill"
          aria-label="Torna agli estratti conto"
        >
          <Icon name="arrow_back" size={22} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-title-large">{statement?.filename ?? 'Estratto conto'}</h1>
          {statement && (
            <p className="text-body-small text-on-surface-variant">
              {statement.account_name ?? 'Nessun conto'}
              {statement.period_start &&
                ` · dal ${formatDate(statement.period_start)}${
                  statement.period_end ? ` al ${formatDate(statement.period_end)}` : ''
                }`}
            </p>
          )}
        </div>
        {statement && (
          <span
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-body-small font-medium',
              STATUS_LABEL[statement.status].tone,
            )}
          >
            <Icon name={STATUS_LABEL[statement.status].icon} size={16} />
            {STATUS_LABEL[statement.status].label}
          </span>
        )}
      </div>

      <ErrorBanner error={error} />
      {isLoading || !statement ? (
        <Skeleton className="h-64 rounded-panel" />
      ) : statement.status === 'processing' ? (
        <Processing />
      ) : statement.status === 'failed' ? (
        <Failed tracker={tracker} statement={statement} />
      ) : statement.status === 'committed' ? (
        <Committed tracker={tracker} statement={statement} />
      ) : (
        <Review key={statement.id} tracker={tracker} statement={statement} />
      )}
    </div>
  )
}

function Processing() {
  return (
    <section className="flex flex-col items-center gap-3 rounded-panel bg-surface-container-low px-6 py-14 text-center">
      <Icon name="document_scanner" size={40} className="animate-pulse text-primary" />
      <p className="text-title-medium">Sto leggendo l&apos;estratto conto…</p>
      <p className="max-w-md text-body-medium text-on-surface-variant">
        Di solito ci vogliono 10–30 secondi. Puoi lasciare la pagina: quando torni le righe sono
        pronte da rivedere.
      </p>
    </section>
  )
}

function Failed({ tracker, statement }: { tracker: Tracker; statement: StatementImport }) {
  const navigate = useNavigate()
  const { retry, discard } = useStatementAction(tracker.id, statement.id)
  return (
    <section className="grid gap-3 rounded-panel bg-error-container p-6 text-on-error-container">
      <p className="text-title-medium">Lettura non riuscita</p>
      <p className="text-body-medium">{statement.error || 'Errore sconosciuto.'}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-filled"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          <Icon name="refresh" size={20} />
          Riprova
        </button>
        <button
          type="button"
          className="btn-text"
          onClick={async () => {
            await discard.mutateAsync()
            navigate('..', { relative: 'path' })
          }}
        >
          Scarta
        </button>
      </div>
      <ErrorBanner error={retry.error ?? discard.error} />
    </section>
  )
}

function Committed({ tracker, statement }: { tracker: Tracker; statement: StatementImport }) {
  return (
    <section className="grid gap-3 rounded-panel bg-secondary-container p-6 text-on-secondary-container">
      <p className="text-title-medium">
        {statement.line_count} movimenti registrati
        {statement.committed_at && ` il ${formatDate(statement.committed_at.slice(0, 10))}`}
      </p>
      <p className="text-body-medium">Li trovi nei movimenti, con origine &quot;scan&quot;.</p>
      <Link to={`/t/${tracker.id}/movimenti`} className="btn-filled w-fit">
        Vai ai movimenti
      </Link>
    </section>
  )
}

/* ------------------------------------------------------------ revisione -- */

function Review({ tracker, statement }: { tracker: Tracker; statement: StatementImport }) {
  const navigate = useNavigate()
  const members = useMemo(() => activeMembers(tracker), [tracker])
  const categories = useCategories(tracker.id).data?.results ?? []
  const { save, commit, discard } = useStatementAction(tracker.id, statement.id)

  const [rows, setRows] = useState<Row[]>(() =>
    statement.lines.map((line) => ({ ...line, key: line.id ?? newKey() })),
  )
  const [dirty, setDirty] = useState(false)

  // Non perdere le modifiche chiudendo la scheda per sbaglio.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = (key: string, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
    setDirty(true)
  }
  const remove = (key: string) => {
    setRows((current) => current.filter((row) => row.key !== key))
    setDirty(true)
  }
  const add = () => {
    setRows((current) => [
      ...current,
      {
        key: newKey(),
        date: current.at(-1)?.date ?? todayIso(),
        title: '',
        amount: '',
        type: 'expense',
        category: null,
        paid_by: statement.default_payer,
        split_mode: 'personal',
      },
    ])
    setDirty(true)
  }
  const setAll = (patch: Partial<Row>) => {
    setRows((current) => current.map((row) => ({ ...row, ...patch })))
    setDirty(true)
  }

  const payload = (): StatementLine[] =>
    // Solo i campi che il backend accetta: `key` e' una comodita' della tabella.
    rows.map((row) => ({
      id: row.id,
      date: row.date,
      title: row.title.trim(),
      amount: String(row.amount).replace(',', '.').trim(),
      type: row.type,
      category: row.category,
      paid_by: row.paid_by,
      split_mode: row.split_mode,
    }))

  const invalid = rows.filter((row) => !row.title.trim() || toCents(row.amount) <= 0 || !row.date)
  const totals = rows.reduce(
    (acc, row) => {
      acc[row.type] += Math.max(toCents(row.amount), 0)
      return acc
    },
    { expense: 0, income: 0 } as Record<TransactionType, number>,
  )
  const duplicates = rows.filter((row) => row.duplicate_of).length

  const saveDraft = async () => {
    const saved = await save.mutateAsync(payload())
    setRows(saved.lines.map((line) => ({ ...line, key: line.id ?? newKey() })))
    setDirty(false)
  }

  return (
    <>
      <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel bg-surface-container-low px-5 py-3 text-body-medium">
        <span className="font-medium">Per tutte le righe:</span>
        <label className="inline-flex items-center gap-2">
          chi paga
          <select
            className="field-input w-auto py-1.5"
            value=""
            onChange={(event) => event.target.value && setAll({ paid_by: event.target.value })}
          >
            <option value="">—</option>
            {members.map((m) => (
              <option key={m.id} value={m.user!.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2">
          divisione
          <select
            className="field-input w-auto py-1.5"
            value=""
            onChange={(event) =>
              event.target.value && setAll({ split_mode: event.target.value as Row['split_mode'] })
            }
          >
            <option value="">—</option>
            <option value="personal">Solo di chi paga</option>
            <option value="default">Di default</option>
          </select>
        </label>
        {duplicates > 0 && (
          <span className="inline-flex flex-wrap items-center gap-2 text-warning">
            <Icon name="content_copy" size={18} />
            {duplicates} {duplicates === 1 ? 'possibile doppione' : 'possibili doppioni'}
            <button
              type="button"
              className="btn-text btn-sm"
              title="Elimina le righe con la stessa data, importo e tipo di un movimento già registrato"
              onClick={() => {
                setRows((current) => current.filter((row) => !row.duplicate_of))
                setDirty(true)
              }}
            >
              Togli i doppioni
            </button>
          </span>
        )}
      </section>

      <section className="rounded-panel bg-surface-container-low p-2 md:p-3">
        <div className="grid gap-1.5">
          {rows.map((row) => (
            <LineRow
              key={row.key}
              row={row}
              categories={categories}
              members={members}
              currency={tracker.currency}
              onChange={(patch) => update(row.key, patch)}
              onRemove={() => remove(row.key)}
            />
          ))}
          {rows.length === 0 && (
            <p className="px-2 py-8 text-center text-body-medium text-on-surface-variant">
              Nessuna riga. Aggiungine una o scarta l&apos;estratto conto.
            </p>
          )}
        </div>

        <button type="button" className="btn-text btn-sm mt-2" onClick={add}>
          <Icon name="add" size={18} />
          Aggiungi riga
        </button>
      </section>

      <section className="sticky bottom-24 z-20 flex flex-wrap items-center gap-3 rounded-panel bg-surface-container px-5 py-4 shadow-fab md:bottom-4">
        <span className="text-body-medium">
          <strong>{rows.length}</strong> righe ·{' '}
          <span className="amount text-error">
            −{formatMoney(totals.expense / 100, tracker.currency)}
          </span>{' '}
          ·{' '}
          <span className="amount text-primary">
            +{formatMoney(totals.income / 100, tracker.currency)}
          </span>
        </span>
        {invalid.length > 0 && (
          <span className="text-body-small text-warning">
            {invalid.length} {invalid.length === 1 ? 'riga incompleta' : 'righe incomplete'}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-text"
            onClick={async () => {
              if (!window.confirm("Scartare l'estratto conto e tutte le righe?")) return
              await discard.mutateAsync()
              navigate('..', { relative: 'path' })
            }}
          >
            Scarta
          </button>
          <button
            type="button"
            className="btn-tonal"
            disabled={!dirty || save.isPending || invalid.length > 0}
            onClick={saveDraft}
          >
            {save.isPending ? 'Salvo…' : 'Salva bozza'}
          </button>
          <button
            type="button"
            className="btn-filled"
            disabled={rows.length === 0 || invalid.length > 0 || commit.isPending || save.isPending}
            onClick={async () => {
              if (dirty) await saveDraft()
              await commit.mutateAsync()
            }}
          >
            <Icon name="check" size={20} />
            {commit.isPending
              ? 'Registro…'
              : `Registra ${rows.length} ${rows.length === 1 ? 'movimento' : 'movimenti'}`}
          </button>
        </div>
        <div className="w-full">
          <ErrorBanner error={save.error ?? commit.error ?? discard.error} />
        </div>
      </section>
    </>
  )
}

function LineRow({
  row,
  categories,
  members,
  currency,
  onChange,
  onRemove,
}: {
  row: Row
  categories: Category[]
  members: ReturnType<typeof activeMembers>
  currency: string
  onChange: (patch: Partial<Row>) => void
  onRemove: () => void
}) {
  const options = categories.filter((c) => c.type === row.type && !c.archived)
  const badge = SOURCE_BADGE[row.category_source ?? '']
  const amountOk = toCents(row.amount) > 0

  const date = (className: string) => (
    <input
      type="date"
      className={clsx('field-input py-1.5', className)}
      value={row.date}
      onChange={(event) => onChange({ date: event.target.value })}
      aria-label="Data"
    />
  )

  // Due livelli: sopra quello che si legge (data, segno, importo, descrizione),
  // sotto quello che si decide (categoria, chi paga, divisione).
  return (
    <div
      className={clsx(
        'grid gap-2 rounded-row border-l-4 bg-surface p-2',
        row.type === 'expense' ? 'border-error' : 'border-primary',
      )}
    >
      <div className="grid grid-cols-[40px_minmax(0,1fr)_96px_36px] items-center gap-2 sm:grid-cols-[136px_40px_104px_minmax(0,1fr)_36px]">
        {date('hidden sm:block')}
        <button
          type="button"
          onClick={() =>
            onChange({ type: row.type === 'expense' ? 'income' : 'expense', category: null })
          }
          className={clsx(
            'state h-9 rounded-pill text-title-medium font-semibold',
            row.type === 'expense'
              ? 'bg-error-container text-on-error-container'
              : 'bg-secondary-container text-on-secondary-container',
          )}
          title={
            row.type === 'expense'
              ? 'Uscita: tocca per farla entrata'
              : 'Entrata: tocca per farla uscita'
          }
          aria-label={row.type === 'expense' ? 'Uscita' : 'Entrata'}
        >
          {row.type === 'expense' ? '−' : '+'}
        </button>
        <input
          className={clsx(
            'field-input amount py-1.5 text-right sm:order-none',
            !amountOk && 'outline outline-1 outline-error',
            'order-3',
          )}
          inputMode="decimal"
          value={row.amount}
          onChange={(event) => onChange({ amount: event.target.value })}
          aria-label={`Importo in ${currency}`}
        />
        <div className="order-2 flex min-w-0 items-center gap-1.5 sm:order-none">
          {row.duplicate_of && (
            <span
              title="Possibile doppione di un movimento già registrato"
              className="text-warning"
            >
              <Icon name="content_copy" size={18} />
            </span>
          )}
          <input
            className="field-input min-w-0 flex-1 py-1.5 font-medium"
            value={row.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="Descrizione"
            aria-label="Descrizione"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="state order-4 flex h-9 w-9 items-center justify-center rounded-pill text-on-surface-variant sm:order-none"
          aria-label={`Elimina ${row.title || 'riga'}`}
        >
          <Icon name="delete" size={20} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
        {date('sm:hidden')}
        <div className="flex min-w-0 items-center gap-1">
          <select
            className="field-input min-w-0 flex-1 py-1.5"
            value={row.category ?? ''}
            onChange={(event) =>
              onChange({ category: event.target.value || null, category_source: 'manual' })
            }
            aria-label="Categoria"
          >
            <option value="">Senza categoria</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {badge && row.category && (
            <span title={badge.label} className="text-on-surface-variant">
              <Icon name={badge.icon} size={18} />
            </span>
          )}
        </div>
        <select
          className="field-input py-1.5"
          value={row.paid_by}
          onChange={(event) => onChange({ paid_by: event.target.value })}
          aria-label="Chi paga"
          title="Chi paga"
        >
          {members.map((m) => (
            <option key={m.id} value={m.user!.id}>
              Paga {m.display_name}
            </option>
          ))}
        </select>
        <select
          className="field-input py-1.5"
          value={row.split_mode}
          onChange={(event) => onChange({ split_mode: event.target.value as Row['split_mode'] })}
          aria-label="Divisione"
          title="Divisione"
        >
          <option value="personal">Solo sua</option>
          <option value="default">Divisa di default</option>
        </select>
      </div>
    </div>
  )
}
