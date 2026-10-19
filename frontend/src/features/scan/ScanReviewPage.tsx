import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'

import { useCategories, useStatement, useStatementAction, useStatementFile } from '../../api/hooks'
import { useConfirm } from '../../components/ConfirmDialog'
import { activeMembers } from '../../components/Layout'
import { ErrorBanner, Icon, Skeleton } from '../../components/ui'
import { formatDate, todayIso } from '../../lib/format'
import { gettext, interpolate, ngettext } from '../../lib/i18n'
import { formatCents, normalizeDecimal, toCents } from '../../lib/money'
import type { StatementImport, StatementLine, Tracker, TransactionType } from '../../lib/types'
import { ReviewRow, SelectChip, type Row } from './ReviewRow'
import { StatusBadge } from './status'

let counter = 0
const newKey = () => `nuova-${++counter}`

/** In tabella gli importi si leggono all'italiana (45,30); al salvataggio torna il punto. */
const toRow = (line: StatementLine): Row => ({
  ...line,
  amount: String(line.amount).replace('.', ','),
  key: line.id ?? newKey(),
})

export function ScanReviewPage() {
  const tracker = useOutletContext<Tracker>()
  const { statementId } = useParams()
  const { data: statement, isLoading, error } = useStatement(tracker.id, statementId)
  const receipt = statement?.source === 'receipt'
  const voice = statement?.source === 'voice'

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-3 sm:gap-5 sm:p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={statement?.source === 'bank' ? '../../banca' : '..'}
          relative="path"
          className="state flex h-10 w-10 items-center justify-center rounded-pill"
          aria-label={
            statement?.source === 'bank'
              ? gettext('Torna alla banca')
              : receipt
                ? gettext('Torna agli scontrini')
                : voice
                  ? gettext('Torna ai vocali')
                  : gettext('Torna agli estratti conto')
          }
        >
          <Icon name="arrow_back" size={22} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-title-large">
            {receipt
              ? gettext('Scontrino')
              : voice
                ? gettext('Messaggio vocale')
                : (statement?.filename ?? gettext('Estratto conto'))}
          </h1>
          {statement && voice && (
            <p className="text-body-small italic text-on-surface-variant">
              “{statement.transcript}”
            </p>
          )}
          {statement && !receipt && !voice && (
            <p className="text-body-small text-on-surface-variant">
              {statement.account_name ?? gettext('Nessun conto')}
              {statement.period_start &&
                ' · ' +
                  (statement.period_end
                    ? interpolate(
                        gettext('dal %(start)s al %(end)s'),
                        {
                          start: formatDate(statement.period_start),
                          end: formatDate(statement.period_end),
                        },
                        true,
                      )
                    : interpolate(
                        gettext('dal %(start)s'),
                        { start: formatDate(statement.period_start) },
                        true,
                      ))}
            </p>
          )}
        </div>
        {statement && <StatusBadge status={statement.status} />}
      </div>

      <ErrorBanner error={error} />
      {isLoading || !statement ? (
        <Skeleton className="h-64 rounded-panel" />
      ) : statement.status === 'processing' ? (
        <Processing tracker={tracker} statement={statement} />
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

/** Oltre questo il task non tornera' piu' (worker riavviato): il backend accetta "Riprova". */
const STUCK_AFTER_MS = 10 * 60 * 1000

function Processing({ tracker, statement }: { tracker: Tracker; statement: StatementImport }) {
  const receipt = statement.source === 'receipt'
  const { retry } = useStatementAction(tracker.id, statement.id)
  const stuck = Date.now() - new Date(statement.updated_at).getTime() > STUCK_AFTER_MS
  return (
    <section className="flex flex-col items-center gap-3 rounded-panel bg-surface-container-low px-6 py-14 text-center">
      <Icon
        name={receipt ? 'receipt_long' : 'document_scanner'}
        size={40}
        className="animate-pulse text-primary"
      />
      <p className="text-title-medium">
        {receipt
          ? gettext('Sto leggendo lo scontrino…')
          : gettext("Sto leggendo l'estratto conto…")}
      </p>
      <p className="max-w-md text-body-medium text-on-surface-variant">
        {receipt
          ? gettext('Di solito bastano pochi secondi.')
          : gettext(
              'Di solito ci vogliono 10–30 secondi. Puoi lasciare la pagina: quando torni le righe sono pronte da rivedere.',
            )}
      </p>
      {stuck && (
        <div className="grid justify-items-center gap-2">
          <p className="text-body-medium text-warning">
            {gettext('Sembra bloccato da più di 10 minuti: rilanciamo la lettura.')}
          </p>
          <button
            type="button"
            className="btn-tonal"
            disabled={retry.isPending}
            onClick={() => retry.mutate()}
          >
            <Icon name="refresh" size={20} />
            {gettext('Riprova')}
          </button>
          <ErrorBanner error={retry.error} />
        </div>
      )}
    </section>
  )
}

function Failed({ tracker, statement }: { tracker: Tracker; statement: StatementImport }) {
  const navigate = useNavigate()
  const { retry, discard } = useStatementAction(tracker.id, statement.id)
  return (
    <section className="grid gap-3 rounded-panel bg-error-container p-6 text-on-error-container">
      <p className="text-title-medium">{gettext('Lettura non riuscita')}</p>
      <p className="text-body-medium">{statement.error || gettext('Errore sconosciuto.')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-filled"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          <Icon name="refresh" size={20} />
          {gettext('Riprova')}
        </button>
        <button
          type="button"
          className="btn-text"
          onClick={async () => {
            await discard.mutateAsync()
            navigate('..', { relative: 'path' })
          }}
        >
          {gettext('Scarta')}
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
        {statement.source === 'receipt'
          ? gettext('Spesa registrata')
          : interpolate(
              ngettext(
                '%(count)s movimento registrato',
                '%(count)s movimenti registrati',
                statement.line_count,
              ),
              { count: statement.line_count },
              true,
            )}
        {statement.committed_at &&
          ' ' +
            interpolate(
              gettext('il %(date)s'),
              { date: formatDate(statement.committed_at.slice(0, 10)) },
              true,
            )}
      </p>
      <p className="text-body-medium">
        {statement.source === 'receipt'
          ? gettext('La trovi nei movimenti. La foto dello scontrino è stata cancellata.')
          : statement.source === 'bank'
            ? gettext('Li trovi nei movimenti, con origine "open banking".')
            : statement.source === 'voice'
              ? gettext(
                  'Spese ed entrate sono nei movimenti (origine "voce"), i pareggi nei debiti.',
                )
              : gettext('Li trovi nei movimenti, con origine "scan".')}
      </p>
      <Link to={`/t/${tracker.id}/movimenti`} className="btn-filled w-fit">
        {gettext('Vai ai movimenti')}
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
  const confirm = useConfirm()
  // Lo scontrino e' una spesa sola: niente "applica a tutte", niente righe in piu'.
  const receipt = statement.source === 'receipt'

  const [rows, setRows] = useState<Row[]>(() => statement.lines.map(toRow))
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
      amount: normalizeDecimal(String(row.amount)),
      type: row.type,
      category: row.category,
      paid_by: row.paid_by,
      to_user: row.type === 'transfer' ? (row.to_user ?? null) : null,
      split_mode: row.split_mode,
    }))

  const invalid = rows.filter(
    (row) =>
      !row.title.trim() ||
      toCents(row.amount) <= 0 ||
      !row.date ||
      (row.type === 'transfer' && !row.to_user),
  )
  const totals = rows.reduce(
    (acc, row) => {
      // I pareggi spostano soldi fra membri: non sono ne' spese ne' entrate.
      if (row.type !== 'transfer') acc[row.type] += Math.max(toCents(row.amount), 0)
      return acc
    },
    { expense: 0, income: 0 } as Record<TransactionType, number>,
  )
  const duplicates = rows.filter((row) => row.duplicate_of).length
  const transfers = rows.filter((row) => row.type === 'transfer').length

  const saveDraft = async () => {
    const saved = await save.mutateAsync(payload())
    setRows(saved.lines.map(toRow))
    setDirty(false)
  }

  return (
    <>
      {receipt && <ReceiptPhoto tracker={tracker} statement={statement} />}

      {!receipt && (
        <section className="flex flex-wrap items-center gap-2 rounded-panel bg-surface-container-low px-4 py-3">
          <span className="mr-1 text-body-medium text-on-surface-variant">
            {gettext('Applica a tutte')}
          </span>
          <SelectChip
            ariaLabel={gettext('Chi paga, per tutte le righe')}
            value=""
            onChange={(value) => value && setAll({ paid_by: value })}
            options={[
              { value: '', label: gettext('Chi paga…') },
              ...members.map((m) => ({
                value: m.user!.id,
                label: interpolate(gettext('Paga %(name)s'), { name: m.display_name }, true),
              })),
            ]}
            leading={<Icon name="person" size={16} />}
            label={gettext('Chi paga')}
          />
          <SelectChip
            ariaLabel={gettext('Divisione, per tutte le righe')}
            value=""
            onChange={(value) => value && setAll({ split_mode: value as Row['split_mode'] })}
            options={[
              { value: '', label: gettext('Divisione…') },
              { value: 'personal', label: gettext('Solo di chi paga') },
              { value: 'default', label: gettext('Divisa di default') },
            ]}
            leading={<Icon name="group" size={16} />}
            label={gettext('Divisione')}
          />
          {duplicates > 0 && (
            <span className="ml-auto inline-flex flex-wrap items-center gap-1">
              <span className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-warning-container px-3 text-[13px] font-medium text-on-warning-container">
                <Icon name="content_copy" size={15} />
                {interpolate(
                  ngettext(
                    '%(count)s possibile doppione',
                    '%(count)s possibili doppioni',
                    duplicates,
                  ),
                  { count: duplicates },
                  true,
                )}
              </span>
              <button
                type="button"
                className="btn-text btn-sm"
                title={gettext(
                  'Elimina le righe con la stessa data, importo e tipo di un movimento già registrato',
                )}
                onClick={() => {
                  setRows((current) => current.filter((row) => !row.duplicate_of))
                  setDirty(true)
                }}
              >
                {gettext('Togli i doppioni')}
              </button>
            </span>
          )}
        </section>
      )}

      <section className="rounded-panel bg-surface-container-low p-1.5 sm:p-2">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
          {rows.map((row) => (
            <ReviewRow
              key={row.key}
              row={row}
              categories={categories}
              members={members}
              onChange={(patch) => update(row.key, patch)}
              onRemove={() => remove(row.key)}
            />
          ))}
          {rows.length === 0 && (
            <p className="px-2 py-8 text-center text-body-medium text-on-surface-variant">
              {receipt
                ? gettext('Riga eliminata: aggiungila di nuovo o scarta lo scontrino.')
                : gettext("Nessuna riga. Aggiungine una o scarta l'estratto conto.")}
            </p>
          )}
        </div>

        {(!receipt || rows.length === 0) && (
          <button type="button" className="btn-text btn-sm mt-2" onClick={add}>
            <Icon name="add" size={18} />
            {gettext('Aggiungi riga')}
          </button>
        )}
      </section>

      <section className="sticky bottom-24 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-panel bg-surface-container px-4 py-3 shadow-fab sm:px-5 sm:py-4 md:bottom-4">
        <span className="text-body-medium">
          {receipt ? (
            <>
              {gettext('Totale')}{' '}
              <span className="amount text-error">
                −{formatCents(totals.expense + totals.income, tracker.currency)}
              </span>
            </>
          ) : (
            <>
              <strong>{rows.length}</strong> {ngettext('riga', 'righe', rows.length)} ·{' '}
              <span className="amount text-error">
                −{formatCents(totals.expense, tracker.currency)}
              </span>{' '}
              ·{' '}
              <span className="amount text-primary">
                +{formatCents(totals.income, tracker.currency)}
              </span>
              {transfers > 0 &&
                ' · ' +
                  interpolate(
                    ngettext('%(count)s pareggio', '%(count)s pareggi', transfers),
                    { count: transfers },
                    true,
                  )}
            </>
          )}
        </span>
        {invalid.length > 0 && (
          <span className="text-body-small text-warning">
            {interpolate(
              ngettext('%(count)s riga incompleta', '%(count)s righe incomplete', invalid.length),
              { count: invalid.length },
              true,
            )}
          </span>
        )}
        <div className="flex w-full items-center gap-1 sm:ml-auto sm:w-auto sm:gap-2">
          <button
            type="button"
            className="btn-text px-3 sm:px-4"
            onClick={async () => {
              const ok = await confirm({
                ...(receipt
                  ? {
                      title: gettext('Scartare lo scontrino?'),
                      message: gettext('Anche la foto viene cancellata.'),
                    }
                  : statement.source === 'bank'
                    ? {
                        title: gettext('Scartare la bozza?'),
                        message: gettext(
                          'I movimenti torneranno alla prossima sincronizzazione. Per ignorarne uno per sempre, eliminalo dalla lista.',
                        ),
                      }
                    : statement.source === 'voice'
                      ? {
                          title: gettext('Scartare il messaggio vocale?'),
                          message: gettext('Spariscono anche tutte le righe.'),
                        }
                      : {
                          title: gettext("Scartare l'estratto conto?"),
                          message: gettext('Spariscono anche tutte le righe.'),
                        }),
                confirmLabel: gettext('Scarta'),
                destructive: true,
              })
              if (!ok) return
              await discard.mutateAsync()
              navigate(statement.source === 'bank' ? '../../banca' : '..', { relative: 'path' })
            }}
          >
            {gettext('Scarta')}
          </button>
          <button
            type="button"
            className="btn-tonal px-4 sm:px-6"
            disabled={!dirty || save.isPending || invalid.length > 0}
            onClick={saveDraft}
          >
            {save.isPending ? (
              gettext('Salvo…')
            ) : (
              <>
                {gettext('Salva')}
                <span className="hidden sm:inline">{gettext('bozza')}</span>
              </>
            )}
          </button>
          <button
            type="button"
            className="btn-filled ml-auto px-4 sm:ml-0 sm:px-6"
            disabled={rows.length === 0 || invalid.length > 0 || commit.isPending || save.isPending}
            onClick={async () => {
              if (dirty) await saveDraft()
              await commit.mutateAsync()
            }}
          >
            <Icon name="check" size={20} />
            {commit.isPending ? (
              gettext('Registro…')
            ) : (
              <>
                {gettext('Registra')} {receipt ? gettext('spesa') : rows.length}
                {!receipt && (
                  <span className="hidden sm:inline">
                    {ngettext('movimento', 'movimenti', rows.length)}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
        <div className="w-full">
          <ErrorBanner error={save.error ?? commit.error ?? discard.error} />
        </div>
      </section>
    </>
  )
}

/** La foto accanto alla riga: si controlla totale ed esercente prima dell'OK. */
function ReceiptPhoto({ tracker, statement }: { tracker: Tracker; statement: StatementImport }) {
  const { url, isLoading, error } = useStatementFile(tracker.id, statement)
  const [zoom, setZoom] = useState(false)

  return (
    <section className="flex justify-center rounded-panel bg-surface-container-low p-3 sm:p-4">
      <ErrorBanner error={error} />
      {isLoading ? (
        <Skeleton className="h-72 w-56 rounded-card" />
      ) : url ? (
        <button
          type="button"
          onClick={() => setZoom((open) => !open)}
          className="cursor-zoom-in"
          aria-label={zoom ? gettext('Rimpicciolisci la foto') : gettext('Ingrandisci la foto')}
        >
          <img
            src={url}
            alt={gettext('Foto dello scontrino')}
            className={
              zoom
                ? 'max-h-none w-full max-w-2xl cursor-zoom-out rounded-card'
                : 'max-h-[34vh] w-auto rounded-card object-contain shadow-fab sm:max-h-[55vh]'
            }
          />
        </button>
      ) : (
        <p className="py-6 text-body-medium text-on-surface-variant">
          {gettext("La foto non c'è più.")}
        </p>
      )}
    </section>
  )
}
