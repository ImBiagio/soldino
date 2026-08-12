import clsx from 'clsx'
import { useEffect, useMemo } from 'react'

import { allocate, formatMoney, fromCents, toCents } from '../lib/money'
import type { Membership, SplitInput, UUID } from '../lib/types'
import { Avatar } from './ui'

export type SplitMode = 'personal' | 'default' | 'percent' | 'amount'

export interface SplitState {
  mode: SplitMode
  /** In modalita' personale: l'unico beneficiario. */
  personalUser: UUID
  /** Percentuali per utente, come stringhe (mode = default | percent). */
  percentages: Record<UUID, string>
  /** Importi esatti per utente, come stringhe (mode = amount). */
  amounts: Record<UUID, string>
}

export function initialSplitState(members: Membership[], paidBy: UUID): SplitState {
  return {
    mode: 'personal',
    personalUser: paidBy,
    percentages: Object.fromEntries(
      members.map((m) => [m.user!.id, m.default_share_pct]),
    ) as Record<UUID, string>,
    amounts: Object.fromEntries(members.map((m) => [m.user!.id, '0.00'])) as Record<UUID, string>,
  }
}

export function splitStateFromTransaction(
  members: Membership[],
  splits: { user: UUID; share_pct: string; share_amount: string }[],
  paidBy: UUID,
): SplitState {
  const base = initialSplitState(members, paidBy)
  if (splits.length === 1) {
    return { ...base, mode: 'personal', personalUser: splits[0].user }
  }
  return {
    ...base,
    mode: 'percent',
    percentages: {
      ...base.percentages,
      ...Object.fromEntries(splits.map((s) => [s.user, s.share_pct])),
    },
    amounts: {
      ...base.amounts,
      ...Object.fromEntries(splits.map((s) => [s.user, s.share_amount])),
    },
  }
}

/** Traduce lo stato del widget nel payload accettato dall'API. */
export function toSplitPayload(
  state: SplitState,
  members: Membership[],
): { splits_input: SplitInput[] } {
  if (state.mode === 'personal') {
    return { splits_input: [{ user: state.personalUser, share_pct: '100.00' }] }
  }
  if (state.mode === 'amount') {
    return {
      splits_input: members.map((m) => ({
        user: m.user!.id,
        share_amount: normalizeDecimal(state.amounts[m.user!.id] ?? '0'),
      })),
    }
  }
  return {
    splits_input: members.map((m) => ({
      user: m.user!.id,
      share_pct: normalizeDecimal(state.percentages[m.user!.id] ?? '0'),
    })),
  }
}

function normalizeDecimal(value: string): string {
  return fromCents(toCents(value))
}

interface Props {
  members: Membership[]
  amount: string
  value: SplitState
  onChange: (state: SplitState) => void
  currency?: string
}

const MODES: { id: SplitMode; label: string; hint: string }[] = [
  { id: 'personal', label: 'Personale', hint: 'Tutto a carico di una persona' },
  { id: 'default', label: 'Gruppo, default', hint: 'Percentuali salvate nel tracker' },
  { id: 'percent', label: 'Percentuali', hint: 'Percentuali su misura' },
  { id: 'amount', label: 'Importi esatti', hint: 'Digiti tu ogni quota' },
]

export function SplitWidget({ members, amount, value, onChange, currency = 'EUR' }: Props) {
  const totalCents = toCents(amount)

  // In modalita' "default" le percentuali sono quelle del tracker: si
  // riallineano se un membro cambia la sua quota di default.
  useEffect(() => {
    if (value.mode !== 'default') return
    const fresh = Object.fromEntries(members.map((m) => [m.user!.id, m.default_share_pct]))
    const changed = members.some((m) => value.percentages[m.user!.id] !== m.default_share_pct)
    if (changed) onChange({ ...value, percentages: fresh as Record<UUID, string> })
  }, [value.mode, members]) // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => {
    if (value.mode === 'personal') {
      return { [value.personalUser]: totalCents } as Record<UUID, number>
    }
    if (value.mode === 'amount') {
      return Object.fromEntries(
        members.map((m) => [m.user!.id, toCents(value.amounts[m.user!.id] ?? '0')]),
      ) as Record<UUID, number>
    }
    const weights = members.map((m) => toCents(value.percentages[m.user!.id] ?? '0'))
    const parts = allocate(totalCents, weights)
    return Object.fromEntries(members.map((m, i) => [m.user!.id, parts[i]])) as Record<UUID, number>
  }, [value, members, totalCents])

  const allocated = Object.values(preview).reduce((a, b) => a + b, 0)
  const residual = totalCents - allocated
  const weightsSum =
    value.mode === 'percent' || value.mode === 'default'
      ? members.reduce((sum, m) => sum + toCents(value.percentages[m.user!.id] ?? '0'), 0)
      : 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Modalita' di divisione">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={value.mode === mode.id}
            title={mode.hint}
            onClick={() => onChange({ ...value, mode: mode.id })}
            className={clsx(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition',
              value.mode === mode.id
                ? 'bg-indigo-600 text-white'
                : 'border border-ink-300 hover:bg-ink-100 dark:border-ink-600 dark:hover:bg-ink-700',
            )}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {value.mode === 'personal' ? (
        <div className="space-y-1">
          <span className="label">A carico di</span>
          <div className="flex flex-wrap gap-2">
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => onChange({ ...value, personalUser: member.user!.id })}
                className={clsx(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                  value.personalUser === member.user!.id
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
                    : 'border-ink-300 dark:border-ink-600',
                )}
              >
                <Avatar name={member.display_name} size={22} />
                {member.display_name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((member) => {
            const uid = member.user!.id
            return (
              <div key={member.id} className="flex items-center gap-3">
                <Avatar name={member.display_name} />
                <span className="min-w-0 flex-1 truncate text-sm">{member.display_name}</span>
                {value.mode === 'amount' ? (
                  <input
                    className="input w-28 text-right amount"
                    inputMode="decimal"
                    value={value.amounts[uid] ?? '0.00'}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        amounts: { ...value.amounts, [uid]: event.target.value },
                      })
                    }
                    aria-label={`Importo di ${member.display_name}`}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      disabled={value.mode === 'default'}
                      value={Number(value.percentages[uid] ?? 0)}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          mode: 'percent',
                          percentages: {
                            ...value.percentages,
                            [uid]: Number(event.target.value).toFixed(2),
                          },
                        })
                      }
                      className="w-24 accent-indigo-600"
                      aria-label={`Percentuale di ${member.display_name}`}
                    />
                    <input
                      className="input w-20 text-right amount"
                      inputMode="decimal"
                      disabled={value.mode === 'default'}
                      value={value.percentages[uid] ?? '0.00'}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          mode: 'percent',
                          percentages: { ...value.percentages, [uid]: event.target.value },
                        })
                      }
                    />
                    <span className="text-xs text-ink-500">%</span>
                  </div>
                )}
                <span className="amount w-24 text-right text-sm text-ink-500">
                  {formatMoney(fromCents(preview[uid] ?? 0), currency)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-ink-200 pt-2 text-xs dark:border-ink-700">
        <span className="text-ink-500">
          {value.mode === 'percent' || value.mode === 'default'
            ? `Somma percentuali: ${(weightsSum / 100).toFixed(2)}%`
            : 'Somma quote'}
        </span>
        <span
          className={clsx(
            'amount font-medium',
            residual === 0 ? 'text-emerald-600' : 'text-amber-600',
          )}
        >
          {residual === 0
            ? `Quadra: ${formatMoney(fromCents(allocated), currency)}`
            : `Residuo ${formatMoney(fromCents(residual), currency)}`}
        </span>
      </div>
    </div>
  )
}

/** Il form usa questo per bloccare il salvataggio quando le quote non quadrano. */
export function splitResidualCents(
  state: SplitState,
  members: Membership[],
  amount: string,
): number {
  if (state.mode !== 'amount') return 0
  const total = toCents(amount)
  const allocated = members.reduce(
    (sum, m) => sum + toCents(state.amounts[m.user!.id] ?? '0'),
    0,
  )
  return total - allocated
}
