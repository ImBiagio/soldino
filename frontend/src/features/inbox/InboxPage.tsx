import { Link, useOutletContext } from 'react-router-dom'

import { useOpenStatements } from '../../api/hooks'
import { EmptyState, ErrorBanner, Icon, RowsSkeleton } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { gettext, interpolate, ngettext } from '../../lib/i18n'
import { formatMoney } from '../../lib/money'
import { showsSection } from '../../lib/trackerKind'
import type { StatementImport, Tracker } from '../../lib/types'
import { StatusBadge } from '../scan/status'
import { SOURCE_ORDER, SOURCES } from './sources'

/** Cosa mostrare di una bozza in una riga: dipende da dove viene. */
function describe(statement: StatementImport, currency: string) {
  const first = statement.lines[0]
  if (statement.source === 'voice') return { title: `“${statement.transcript}”`, amount: null }
  if (statement.source === 'receipt') {
    return {
      title: first?.title || gettext('Scontrino'),
      amount: first ? formatMoney(first.amount, currency) : null,
    }
  }
  return { title: statement.filename, amount: null }
}

/**
 * "Da rivedere": tutto quello che aspetta un OK, da qualunque strada arrivi.
 * Le righe portano alla revisione della bozza, i gruppi alla loro pagina.
 */
export function InboxPage() {
  const tracker = useOutletContext<Tracker>()
  const open = useOpenStatements(tracker.id)
  const items = open.data?.results ?? []
  const groups = SOURCE_ORDER.map((source) => ({
    source,
    items: items.filter((s) => s.source === source),
  })).filter((group) => group.items.length > 0 || showsSection(tracker, SOURCES[group.source].page))

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5 md:p-7">
      <div>
        <h1 className="text-title-large">{gettext('Da rivedere')}</h1>
        <p className="mt-1 max-w-2xl text-body-medium text-on-surface-variant">
          {gettext(
            'Movimenti letti da scontrini, vocali, estratti conto e banche che aspettano il tuo OK. Niente entra nei conti finché non li registri.',
          )}
        </p>
      </div>

      <ErrorBanner error={open.error} />
      {open.isLoading ? (
        <RowsSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="task_alt"
          title={gettext('Tutto rivisto')}
          description={gettext(
            'Quando fotografi uno scontrino, detti un movimento o arriva un estratto, lo trovi qui.',
          )}
        />
      ) : null}

      {!open.isLoading &&
        groups.map(({ source, items: group }) => {
          const meta = SOURCES[source]
          const lines = group.reduce((sum, s) => sum + s.line_count, 0)
          return (
            <section key={source} className="grid gap-2">
              <div className="flex items-center gap-2">
                <Icon name={meta.icon} size={22} className="text-primary" />
                <h2 className="flex-1 text-title-medium">
                  {meta.label}
                  {group.length > 0 && (
                    <span className="ml-2 inline-block whitespace-nowrap text-body-medium text-on-surface-variant">
                      {interpolate(gettext('%(count)s da rivedere'), { count: group.length }, true)}
                      {source !== 'receipt' &&
                        lines > 0 &&
                        ' · ' +
                          interpolate(
                            ngettext('%(count)s riga', '%(count)s righe', lines),
                            { count: lines },
                            true,
                          )}
                    </span>
                  )}
                </h2>
                <Link to={`../${meta.page}`} relative="path" className="btn-text btn-sm">
                  {source === 'bank' ? gettext('Banca') : gettext('Nuovo')}
                  <Icon name="chevron_right" size={18} />
                </Link>
              </div>
              {group.length === 0 ? (
                <p className="rounded-card bg-surface-container-low px-4 py-3 text-body-medium text-on-surface-variant">
                  {gettext('Niente in attesa.')}
                </p>
              ) : (
                group.map((statement) => {
                  const { title, amount } = describe(statement, tracker.currency)
                  return (
                    <Link
                      key={statement.id}
                      to={`../${meta.review}/${statement.id}`}
                      relative="path"
                      className="state flex flex-wrap items-center gap-3 rounded-card bg-surface-container-low px-4 py-3"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-large font-medium">{title}</span>
                        <span className="text-body-small text-on-surface-variant">
                          {formatDate(statement.created_at.slice(0, 10))}
                          {statement.uploaded_by_detail &&
                            ` · ${statement.uploaded_by_detail.display_name}`}
                          {statement.status === 'ready' &&
                            source !== 'receipt' &&
                            ' · ' +
                              interpolate(
                                ngettext('%(count)s riga', '%(count)s righe', statement.line_count),
                                { count: statement.line_count },
                                true,
                              )}
                          {statement.status === 'failed' &&
                            statement.error &&
                            ` · ${statement.error}`}
                        </span>
                      </span>
                      {amount && <span className="amount text-body-large">{amount}</span>}
                      <StatusBadge status={statement.status} />
                    </Link>
                  )
                })
              )}
            </section>
          )
        })}
    </div>
  )
}
