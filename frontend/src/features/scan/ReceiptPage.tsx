import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'

import { useStatements, useUploadStatement } from '../../api/hooks'
import { EmptyState, ErrorBanner, Icon, RowsSkeleton } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { formatMoney } from '../../lib/money'
import type { Tracker } from '../../lib/types'
import { StatusBadge } from './status'

/**
 * Scan dello scontrino (ADR 0014): una foto, una spesa. "Scatta" apre la
 * fotocamera posteriore sul telefono (`capture`); su desktop il browser
 * ignora `capture` e apre la scelta del file.
 */
export function ReceiptPage() {
  const tracker = useOutletContext<Tracker>()
  const upload = useUploadStatement(tracker.id)
  const statements = useStatements(tracker.id)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [sent, setSent] = useState(0)

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  // Foto e via: la lettura gira in background e la spesa arriva in "Da rivedere".
  // Si resta qui, pronti per lo scontrino successivo.
  const send = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    input.value = '' // la stessa foto si puo' riscegliere
    if (!file) return
    setPreview(URL.createObjectURL(file))
    try {
      await upload.mutateAsync({ file, source: 'receipt' })
      setSent((count) => count + 1)
    } finally {
      setPreview(null)
    }
  }

  const receipts = (statements.data?.results ?? []).filter((s) => s.source === 'receipt')

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5 md:p-7">
      <div>
        <h1 className="text-title-large">Scan scontrino</h1>
        <p className="mt-1 max-w-2xl text-body-medium text-on-surface-variant">
          Fotografa lo scontrino e vai: Gemini legge esercente, data e totale in background e
          propone la categoria. La spesa ti aspetta in{' '}
          <Link to="../da-rivedere" relative="path" className="text-primary underline">
            Da rivedere
          </Link>
          , con la foto accanto.
        </p>
      </div>

      <section className="grid gap-4 rounded-panel bg-surface-container-low p-5 md:p-6">
        {preview && upload.isPending ? (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <img
              src={preview}
              alt="Scontrino che sto caricando"
              className="max-h-72 rounded-card object-contain shadow-fab"
            />
            <p className="flex items-center gap-2 text-body-medium">
              <Icon name="cloud_upload" size={20} className="animate-pulse text-primary" />
              Carico la foto…
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="state flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-card bg-primary px-4 py-6 text-on-primary"
              onClick={() => cameraRef.current?.click()}
            >
              <Icon name="photo_camera" size={36} />
              <span className="text-title-medium">Scatta una foto</span>
              <span className="text-body-small text-primary-container">
                Apre la fotocamera del telefono
              </span>
            </button>
            <button
              type="button"
              className="state flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-outline-variant bg-surface px-4 py-6"
              onClick={() => galleryRef.current?.click()}
            >
              <Icon name="add_photo_alternate" size={36} className="text-primary" />
              <span className="text-title-medium">Scegli una foto</span>
              <span className="text-body-small text-on-surface-variant">
                Dalla galleria o dal computer · JPEG, PNG, HEIC fino a 15 MB
              </span>
            </button>
          </div>
        )}
        {/* Due input: con `capture` il telefono va dritto alla fotocamera, senza no. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => send(event.currentTarget)}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => send(event.currentTarget)}
        />
        <ErrorBanner error={upload.error} />
        {sent > 0 && !upload.isPending && !upload.error && (
          <p className="flex items-center gap-2 rounded-card bg-secondary-container px-4 py-3 text-body-medium text-on-secondary-container">
            <Icon name="check_circle" size={20} />
            {sent === 1
              ? 'Scontrino caricato: lo leggo in background, lo trovi in Da rivedere.'
              : `${sent} scontrini caricati: li leggo in background, li trovi in Da rivedere.`}{' '}
            Puoi scattarne un altro.
          </p>
        )}
        <p className="text-body-small text-on-surface-variant">
          La foto viene inviata a Google Gemini per la lettura e cancellata da Soldino quando
          registri o scarti la spesa.
        </p>
      </section>

      <section className="grid gap-2">
        <h2 className="text-title-medium">Scontrini recenti</h2>
        <ErrorBanner error={statements.error} />
        {statements.isLoading ? (
          <RowsSkeleton rows={3} />
        ) : receipts.length === 0 ? (
          <EmptyState
            icon="receipt_long"
            title="Ancora nessuno"
            description="Il primo scontrino letto comparirà qui."
          />
        ) : (
          receipts.map((receipt) => (
            <Link
              key={receipt.id}
              to={receipt.id}
              className="state flex flex-wrap items-center gap-3 rounded-card bg-surface-container-low px-4 py-3"
            >
              <Icon name="receipt_long" size={24} className="text-on-surface-variant" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-large font-medium">
                  {receipt.lines[0]?.title || receipt.filename}
                </span>
                <span className="text-body-small text-on-surface-variant">
                  {formatDate(receipt.created_at.slice(0, 10))}
                  {receipt.lines[0] &&
                    ` · ${formatMoney(receipt.lines[0].amount, tracker.currency)}`}
                </span>
              </span>
              <StatusBadge status={receipt.status} />
            </Link>
          ))
        )}
      </section>
    </div>
  )
}
