import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'

import { useSendVoice, useStatements } from '../../api/hooks'
import { EmptyState, ErrorBanner, Icon, RowsSkeleton } from '../../components/ui'
import { formatDate } from '../../lib/format'
import type { Tracker } from '../../lib/types'
import { StatusBadge } from '../scan/status'
import { gettext, interpolate, intlLocale, ngettext } from '../../lib/i18n'

/* Web Speech API: in Chrome e Safari c'e' (anche col prefisso webkit), nei tipi DOM no. */
interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult:
    | ((event: {
        resultIndex: number
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
      }) => void)
    | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  start: () => void
  stop: () => void
}
type RecognitionClass = new () => Recognition

function recognitionClass(): RecognitionClass | null {
  const w = window as unknown as Record<string, RecognitionClass | undefined>
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const EXAMPLES = [
  gettext('Ho dato 10 euro a Maurizio per le spese di casa'),
  gettext('Ieri ho pagato 42 euro di spesa al supermercato, da dividere'),
  gettext('Benzina 60 euro'),
]

/**
 * Movimento a voce: si detta (o si scrive) e si manda. Gemini lo legge in
 * background e la bozza arriva in "Da rivedere", come uno scontrino.
 */
export function VoicePage() {
  const tracker = useOutletContext<Tracker>()
  const send = useSendVoice(tracker.id)
  const statements = useStatements(tracker.id)
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState('')
  const [sent, setSent] = useState(false)
  const recognition = useRef<Recognition | null>(null)
  // Il testo gia' presente quando si preme il microfono: la dettatura si aggiunge.
  const base = useRef('')
  const Speech = recognitionClass()

  useEffect(() => () => recognition.current?.stop(), [])

  const toggle = () => {
    if (listening) {
      recognition.current?.stop()
      return
    }
    if (!Speech) return
    const rec = new Speech()
    rec.lang = intlLocale()
    rec.interimResults = true
    rec.continuous = false
    base.current = text ? `${text.trim()} ` : ''
    rec.onresult = (event) => {
      let heard = ''
      for (let i = 0; i < event.results.length; i++) heard += event.results[i][0].transcript
      setText(base.current + heard)
    }
    rec.onerror = (event) =>
      setMicError(
        event.error === 'not-allowed'
          ? gettext('Il browser non ha il permesso di usare il microfono.')
          : gettext('Non ti ho sentito: riprova o scrivi.'),
      )
    rec.onend = () => setListening(false)
    recognition.current = rec
    setMicError('')
    setSent(false)
    setListening(true)
    rec.start()
  }

  const submit = async () => {
    recognition.current?.stop()
    await send.mutateAsync(text.trim())
    setText('')
    setSent(true)
  }

  const recent = (statements.data?.results ?? []).filter((s) => s.source === 'voice').slice(0, 10)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5 md:p-7">
      <div>
        <h1 className="text-title-large">{gettext('A voce')}</h1>
        <p className="mt-1 max-w-2xl text-body-medium text-on-surface-variant">
          {gettext(
            "Di' cosa hai speso, incassato o dato a chi: lo legge Gemini in background e lo ritrovi in",
          )}{' '}
          <Link to="../da-rivedere" relative="path" className="text-primary underline">
            {gettext('Da rivedere')}
          </Link>
          {gettext(', pronto da confermare.')}
        </p>
      </div>

      <section className="grid gap-4 rounded-panel bg-surface-container-low p-5 md:p-6">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            disabled={!Speech}
            aria-pressed={listening}
            aria-label={listening ? gettext('Ferma la dettatura') : gettext('Detta')}
            className={clsx(
              'state flex h-24 w-24 items-center justify-center rounded-pill shadow-fab transition disabled:opacity-40',
              listening ? 'animate-pulse bg-error text-on-error' : 'bg-primary text-on-primary',
            )}
          >
            <Icon name={listening ? 'stop' : 'mic'} size={44} />
          </button>
          <p className="text-body-small text-on-surface-variant">
            {!Speech
              ? gettext('Questo browser non detta: usa il microfono della tastiera o scrivi.')
              : listening
                ? gettext('Ti ascolto… tocca per fermare')
                : gettext('Tocca e parla')}
          </p>
        </div>

        <textarea
          className="field-input min-h-[96px] rounded-card bg-surface p-4 text-body-large"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setSent(false)
          }}
          placeholder={interpolate(gettext('Es. "%(example)s"'), { example: EXAMPLES[0] }, true)}
          maxLength={2000}
          aria-label={gettext('Cosa vuoi registrare')}
        />
        {micError && <p className="text-body-small text-error">{micError}</p>}
        <ErrorBanner error={send.error} />
        {sent && !send.isPending && (
          <p className="flex items-center gap-2 rounded-card bg-secondary-container px-4 py-3 text-body-medium text-on-secondary-container">
            <Icon name="check_circle" size={20} />
            {gettext(
              'Inviato: lo leggo in background, lo trovi in Da rivedere. Puoi dettarne un altro.',
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-filled"
            disabled={!text.trim() || send.isPending}
            onClick={submit}
          >
            <Icon name="send" size={20} />
            {send.isPending ? gettext('Invio…') : gettext('Invia')}
          </button>
          <span className="text-body-small text-on-surface-variant">
            {gettext('Funziona con più movimenti nella stessa frase.')}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="state rounded-pill border border-outline-variant px-3 py-1 text-body-small text-on-surface-variant"
              onClick={() => {
                setText(example)
                setSent(false)
              }}
            >
              {example}
            </button>
          ))}
        </div>
        <p className="text-body-small text-on-surface-variant">
          {gettext('Il testo viene inviato a Google Gemini per la lettura.')}
        </p>
      </section>

      <section className="grid gap-2">
        <h2 className="text-title-medium">{gettext('Vocali recenti')}</h2>
        <ErrorBanner error={statements.error} />
        {statements.isLoading ? (
          <RowsSkeleton rows={3} />
        ) : recent.length === 0 ? (
          <EmptyState
            icon="mic"
            title={gettext('Ancora nessuno')}
            description={gettext('Il primo messaggio vocale comparirà qui.')}
          />
        ) : (
          recent.map((statement) => (
            <Link
              key={statement.id}
              to={statement.id}
              className="state flex flex-wrap items-center gap-3 rounded-card bg-surface-container-low px-4 py-3"
            >
              <Icon name="mic" size={24} className="text-on-surface-variant" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-large">“{statement.transcript}”</span>
                <span className="text-body-small text-on-surface-variant">
                  {formatDate(statement.created_at.slice(0, 10))}
                  {statement.status !== 'processing' &&
                    ' · ' +
                      interpolate(
                        ngettext('%(count)s riga', '%(count)s righe', statement.line_count),
                        { count: statement.line_count },
                        true,
                      )}
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
