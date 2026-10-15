import clsx from 'clsx'
import { useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'

import { useAccounts, useStatements, useUploadStatement } from '../../api/hooks'
import { EmptyState, ErrorBanner, Field, Icon, RowsSkeleton } from '../../components/ui'
import { formatDate } from '../../lib/format'
import type { Tracker } from '../../lib/types'
import { StatusBadge } from './status'

export function ScanPage() {
  const tracker = useOutletContext<Tracker>()
  const navigate = useNavigate()
  const statements = useStatements(tracker.id)
  const accounts = useAccounts(tracker.id)
  const upload = useUploadStatement(tracker.id)
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [account, setAccount] = useState('')
  const [dragging, setDragging] = useState(false)

  const pick = (candidate: File | undefined) => {
    if (candidate) setFile(candidate)
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5 md:p-7">
      <div>
        <h1 className="text-title-large">Scan estratto conto</h1>
        <p className="mt-1 max-w-2xl text-body-medium text-on-surface-variant">
          Carica il PDF della banca: lo legge Gemini e ti propone i movimenti, già con la categoria.
          Li rivedi riga per riga e niente viene registrato finché non confermi.
        </p>
      </div>

      <section className="rounded-panel bg-surface-container-low p-5 md:p-6">
        <form
          className="grid gap-4 md:grid-cols-[1.4fr_1fr] md:items-end"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!file) return
            const created = await upload.mutateAsync({ file, account: account || null })
            navigate(created.id)
          }}
        >
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              pick(event.dataTransfer.files[0])
            }}
            className={clsx(
              'state flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-6 text-center',
              dragging
                ? 'border-primary bg-secondary-container'
                : 'border-outline-variant bg-surface',
            )}
          >
            <Icon
              name={file ? 'picture_as_pdf' : 'upload_file'}
              size={32}
              className="text-primary"
            />
            <span className="text-body-large font-medium">
              {file ? file.name : 'Trascina qui il PDF o tocca per sceglierlo'}
            </span>
            <span className="text-body-small text-on-surface-variant">
              {file ? `${(file.size / 1024).toFixed(0)} KB` : 'Solo PDF, fino a 15 MB'}
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(event) => pick(event.target.files?.[0])}
          />

          <div className="grid gap-3">
            <Field
              label="Conto dell'estratto"
              hint="Decide chi ha pagato: si può cambiare riga per riga."
            >
              <select
                className="field-input"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
              >
                <option value="">Nessun conto (pago io)</option>
                {(accounts.data?.results ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.owner_detail.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn-filled" disabled={!file || upload.isPending}>
              <Icon name="document_scanner" size={20} />
              {upload.isPending ? 'Carico…' : "Leggi l'estratto conto"}
            </button>
          </div>
        </form>
        <ErrorBanner error={upload.error} />
        <p className="mt-3 text-body-small text-on-surface-variant">
          Il PDF viene inviato a Google Gemini per la lettura e cancellato da Soldino appena letto.
        </p>
      </section>

      <section className="grid gap-2">
        <h2 className="text-title-medium">Estratti conto caricati</h2>
        <ErrorBanner error={statements.error} />
        {statements.isLoading ? (
          <RowsSkeleton rows={3} />
        ) : (statements.data?.results ?? []).every((s) => s.source !== 'scan') ? (
          <EmptyState
            icon="document_scanner"
            title="Ancora nessuno"
            description="Il primo estratto conto letto comparirà qui."
          />
        ) : (
          (statements.data?.results ?? [])
            // Scontrini e bozze della banca (ADR 0013) hanno le loro pagine.
            .filter((statement) => statement.source === 'scan')
            .map((statement) => (
              <Link
                key={statement.id}
                to={statement.id}
                className="state flex flex-wrap items-center gap-3 rounded-card bg-surface-container-low px-4 py-3"
              >
                <Icon name="picture_as_pdf" size={24} className="text-on-surface-variant" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-large font-medium">
                    {statement.filename}
                  </span>
                  <span className="text-body-small text-on-surface-variant">
                    {formatDate(statement.created_at.slice(0, 10))}
                    {statement.account_name && ` · ${statement.account_name}`}
                    {statement.status !== 'processing' && ` · ${statement.line_count} righe`}
                  </span>
                </span>
                <StatusBadge status={statement.status} />
              </Link>
            ))
        )}
      </section>
    </div>
  )
}
