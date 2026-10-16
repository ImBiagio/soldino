import { formatCents, formatMoney, formatSigned, formatSignedCents, toCents } from '../../lib/money'
import type { ReconciliationFigures } from '../../lib/types'
import { gettext, interpolate } from '../../lib/i18n'

type Kind = 'base' | 'up' | 'down' | 'settle' | 'expected' | 'gap' | 'real'

interface Step {
  label: string
  /** Livelli in centesimi: la barra va da `start` a `end`. */
  start: number
  end: number
  kind: Kind
  /** Testo sopra la barra e nel tooltip. */
  value: string
  detail?: string
}

// Entrate e uscite con gli stessi colori di tutta l'app; i totali in inchiostro
// pieno (atteso) e terziario (reale), lo scarto in giallo d'avviso.
const FILL: Record<Kind, string> = {
  base: 'var(--outline)',
  up: 'var(--primary)',
  down: 'var(--error)',
  settle: 'var(--tertiary)',
  expected: 'var(--on-surface)',
  gap: 'var(--warning)',
  real: 'var(--tertiary)',
}

const HEIGHT = 200

/**
 * Riconciliazione a cascata: saldo iniziale → + entrate → − uscite → ± pareggi
 * → atteso → scarto → reale. Lo scarto e' il gradino fra cio' che risulta dai
 * movimenti e cio' che c'e' davvero sui conti.
 */
export function ReconciliationWaterfall({
  figures,
  currency,
}: {
  figures: ReconciliationFigures
  currency: string
}) {
  const money = (cents: number) => formatCents(cents, currency)
  const signed = (cents: number) => formatSignedCents(cents, currency)

  const opening = toCents(figures.opening_balance)
  const income = toCents(figures.income)
  const expense = toCents(figures.expense)
  const settled = toCents(figures.settlements_net)
  const expected = toCents(figures.expected_balance)
  const real = toCents(figures.available_balance)
  const delta = toCents(figures.delta)

  const steps: Step[] = []
  let level = 0
  const push = (label: string, amount: number, kind: Kind, value: string, detail?: string) => {
    steps.push({ label, start: level, end: level + amount, kind, value, detail })
    level += amount
  }
  push(gettext('Saldo iniziale'), opening, 'base', money(opening))
  push(gettext('Entrate'), income, 'up', `+${money(income)}`)
  push(gettext('Uscite'), -expense, 'down', `−${money(expense)}`)
  if (settled !== 0) push(gettext('Pareggi'), settled, 'settle', signed(settled))
  steps.push({
    label: gettext('Atteso'),
    start: 0,
    end: expected,
    kind: 'expected',
    value: money(expected),
  })
  steps.push({
    label: gettext('Scarto'),
    start: expected,
    end: real,
    kind: 'gap',
    value: delta === 0 ? gettext('quadra') : signed(delta),
  })
  steps.push({
    label: gettext('Reale'),
    start: 0,
    end: real,
    kind: 'real',
    value: money(real),
    detail: interpolate(
      gettext('Conti %(accounts)s + in attesa %(pending)s'),
      {
        accounts: formatMoney(figures.accounts_balance, currency),
        pending: formatSigned(figures.pending_total, currency),
      },
      true,
    ),
  })

  const levels = steps.flatMap((step) => [step.start, step.end])
  const lo = Math.min(0, ...levels)
  const hi = Math.max(0, ...levels)
  const span = hi - lo || 1
  const y = (cents: number) => ((hi - cents) / span) * HEIGHT

  return (
    <div>
      <div
        className="relative grid gap-1 sm:gap-2"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        role="img"
        aria-label={interpolate(
          gettext('Atteso %(expected)s, reale %(real)s, scarto %(delta)s'),
          { expected: money(expected), real: money(real), delta: signed(delta) },
          true,
        )}
      >
        {/* linea dello zero, solo se ci sono valori negativi */}
        {lo < 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 h-px bg-outline-variant"
            style={{ top: y(0) + 22 }}
          />
        )}
        {steps.map((step, index) => {
          const top = y(Math.max(step.start, step.end))
          const height = Math.max(
            Math.abs(y(step.start) - y(step.end)),
            step.kind === 'gap' ? 2 : 1,
          )
          const next = steps[index + 1]
          const isTotal = step.kind === 'expected' || step.kind === 'real'
          return (
            <div
              key={step.label}
              className="min-w-0"
              title={`${step.label}: ${step.value}${step.detail ? ` (${step.detail})` : ''}`}
            >
              <p
                className={
                  isTotal
                    ? 'amount truncate text-center text-[12px] font-semibold sm:text-body-small'
                    : 'amount truncate text-center text-[11px] text-on-surface-variant sm:text-body-small'
                }
              >
                {step.value}
              </p>
              <div className="relative mt-1" style={{ height: HEIGHT }}>
                <div
                  className="absolute inset-x-[12%]"
                  style={{
                    top,
                    height,
                    background: FILL[step.kind],
                    borderRadius: 4,
                    opacity: step.kind === 'gap' && step.start === step.end ? 0 : 1,
                  }}
                />
                {/* raccordo col gradino successivo: dove finisce questo, parte quello */}
                {next && !isTotal && next.kind !== 'expected' && (
                  <div
                    className="absolute left-[88%] h-px bg-outline-variant"
                    style={{ top: y(step.end), width: 'calc(24% + 0.5rem)' }}
                  />
                )}
              </div>
              <p
                className={
                  isTotal
                    ? 'mt-2 truncate text-center text-[12px] font-medium sm:text-body-small'
                    : 'mt-2 truncate text-center text-[11px] text-on-surface-variant sm:text-body-small'
                }
              >
                {step.label}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
