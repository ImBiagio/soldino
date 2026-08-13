import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { formatMoney } from '../lib/money'
import { allocate, fromCents, toCents } from '../lib/money'
import { memberColor } from '../lib/icons'
import type { Membership, SplitInput, UUID } from '../lib/types'
import { Avatar, Icon } from './ui'

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

/** Il form usa questo per bloccare il salvataggio quando le quote non quadrano. */
export function splitResidualCents(
  state: SplitState,
  members: Membership[],
  amount: string,
): number {
  if (state.mode !== 'amount') return 0
  const total = toCents(amount)
  const allocated = members.reduce((sum, m) => sum + toCents(state.amounts[m.user!.id] ?? '0'), 0)
  return total - allocated
}

/** Etichetta della chip "di default": mostra le percentuali vere del tracker. */
function defaultModeLabel(members: Membership[]): string {
  const parts = members.map((m) => Math.round(Number(m.default_share_pct)))
  const sum = parts.reduce((a, b) => a + b, 0)
  if (!sum) return 'Di default'
  return `${parts.join('/')} di default`
}

interface Props {
  members: Membership[]
  amount: string
  value: SplitState
  onChange: (state: SplitState) => void
  currency?: string
  compact?: boolean
}

export function SplitWidget({
  members,
  amount,
  value,
  onChange,
  currency = 'EUR',
  compact,
}: Props) {
  const totalCents = toCents(amount)
  const barRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  // In "default" le percentuali sono quelle del tracker: si riallineano se un
  // membro cambia la sua quota.
  useEffect(() => {
    if (value.mode !== 'default') return
    const changed = members.some((m) => value.percentages[m.user!.id] !== m.default_share_pct)
    if (!changed) return
    onChange({
      ...value,
      percentages: Object.fromEntries(
        members.map((m) => [m.user!.id, m.default_share_pct]),
      ) as Record<UUID, string>,
    })
  }, [value.mode, members]) // eslint-disable-line react-hooks/exhaustive-deps

  const visibleMembers = value.mode === 'personal' ? members : members

  /** Quote in centesimi, calcolate con lo stesso algoritmo del backend. */
  const preview = useMemo(() => {
    if (value.mode === 'personal') {
      return Object.fromEntries(
        members.map((m) => [m.user!.id, m.user!.id === value.personalUser ? totalCents : 0]),
      ) as Record<UUID, number>
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

  /**
   * Chi riceve il centesimo dispari. Deriva da allocate(): la quota assegnata
   * supera la parte intera della divisione esatta.
   */
  const oddCentHolder = useMemo(() => {
    if (value.mode === 'personal' || value.mode === 'amount' || totalCents === 0) return null
    const weights = members.map((m) => toCents(value.percentages[m.user!.id] ?? '0'))
    const sum = weights.reduce((a, b) => a + b, 0)
    if (sum <= 0) return null
    for (let i = 0; i < members.length; i += 1) {
      const exact = (totalCents * weights[i]) / sum
      if (preview[members[i].user!.id] > Math.floor(exact)) return members[i]
    }
    return null
  }, [members, preview, totalCents, value])

  /* --- trascinamento della maniglia fra due segmenti --- */
  const handleDrag = useCallback(
    (index: number, clientX: number) => {
      const bar = barRef.current
      if (!bar || members.length < 2) return
      const rect = bar.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))

      const current = members.map((m) => Number(value.percentages[m.user!.id] ?? 0))
      const total = current.reduce((a, b) => a + b, 0) || 100
      // Somma delle quote fino al segmento trascinato, come frazione del totale.
      const before = current.slice(0, index).reduce((a, b) => a + b, 0)
      const pair = current[index] + current[index + 1]
      const target = Math.min(pair, Math.max(0, ratio * total - before))

      const next = [...current]
      next[index] = target
      next[index + 1] = pair - target

      onChange({
        ...value,
        mode: 'percent',
        percentages: Object.fromEntries(
          members.map((m, i) => [m.user!.id, next[i].toFixed(2)]),
        ) as Record<UUID, string>,
      })
    },
    [members, onChange, value],
  )

  useEffect(() => {
    if (dragging === null) return
    const move = (event: PointerEvent) => handleDrag(dragging, event.clientX)
    const up = () => setDragging(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, handleDrag])

  const barHeight = compact ? 32 : 40
  const modes: { id: SplitMode; label: string }[] = [
    { id: 'personal', label: 'Solo mia' },
    { id: 'default', label: defaultModeLabel(members) },
    { id: 'percent', label: 'Percentuali' },
    { id: 'amount', label: 'Importi esatti' },
  ]

  return (
    <div className={clsx('rounded-card bg-surface-container-low', compact ? 'p-4' : 'p-5')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-large font-medium">Come si divide</p>
        <span
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-body-medium font-medium',
            residual === 0
              ? 'bg-secondary-container text-on-secondary-container'
              : 'bg-warning-container text-on-warning-container',
          )}
        >
          <Icon name={residual === 0 ? 'check_circle' : 'balance'} size={18} />
          {residual === 0
            ? `Quadra: ${formatMoney(fromCents(allocated), currency)}`
            : `Residuo ${formatMoney(fromCents(residual), currency)}`}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {modes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => onChange({ ...value, mode: mode.id })}
            aria-pressed={value.mode === mode.id}
            className={value.mode === mode.id ? 'chip-selected' : 'chip-outlined'}
          >
            {value.mode === mode.id && <Icon name="check" size={18} />}
            {mode.label}
          </button>
        ))}
      </div>

      {value.mode === 'amount' ? (
        <div className="grid gap-2">
          {visibleMembers.map((member, index) => (
            <div key={member.id} className="field flex items-center gap-3">
              <Avatar name={member.display_name} size={28} color={memberColor(index)} />
              <span className="min-w-0 flex-1 truncate text-body-medium">
                {member.display_name}
              </span>
              <input
                className="field-input amount w-28 text-right"
                inputMode="decimal"
                value={value.amounts[member.user!.id] ?? '0.00'}
                onChange={(event) =>
                  onChange({
                    ...value,
                    amounts: { ...value.amounts, [member.user!.id]: event.target.value },
                  })
                }
                aria-label={`Importo di ${member.display_name}`}
              />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div
            ref={barRef}
            className="relative flex w-full select-none overflow-visible"
            style={{ height: barHeight, gap: 3 }}
          >
            {visibleMembers.map((member, index) => {
              const cents = preview[member.user!.id] ?? 0
              const share = totalCents > 0 ? cents : index === 0 ? 1 : 0
              return (
                <div
                  key={member.id}
                  className="flex min-w-0 items-center justify-center overflow-hidden"
                  style={{
                    flexGrow: Math.max(share, 0.0001),
                    flexBasis: 0,
                    background: memberColor(index),
                    borderRadius: barHeight / 2,
                  }}
                  title={`${member.display_name}: ${formatMoney(fromCents(cents), currency)}`}
                >
                  <span className="amount truncate px-2 text-[14px] font-semibold text-white">
                    {compact
                      ? formatMoney(fromCents(cents), currency)
                      : `${initialsOf(member.display_name)} ${formatMoney(fromCents(cents), currency)}`}
                  </span>
                </div>
              )
            })}

            {/* maniglie: una fra ogni coppia di segmenti */}
            {value.mode !== 'personal' &&
              visibleMembers.slice(0, -1).map((member, index) => {
                const left = cumulativeRatio(visibleMembers, preview, index, totalCents)
                return (
                  <button
                    key={`handle-${member.id}`}
                    type="button"
                    aria-label={`Sposta la quota fra ${member.display_name} e ${
                      visibleMembers[index + 1].display_name
                    }`}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      setDragging(index)
                    }}
                    className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-pill bg-white shadow-fab"
                    style={{ left: `${left * 100}%`, width: 8, height: barHeight - 10 }}
                  />
                )
              })}
          </div>

          {!compact && (
            <div className="mt-2 flex items-center justify-between text-body-small text-on-surface-variant">
              <span>
                {visibleMembers[0]?.display_name}{' '}
                {value.mode === 'personal'
                  ? value.personalUser === visibleMembers[0]?.user?.id
                    ? '100%'
                    : '0%'
                  : `${Math.round(Number(value.percentages[visibleMembers[0]?.user?.id ?? ''] ?? 0))}%`}
              </span>
              {value.mode !== 'personal' && members.length > 1 && (
                <span className="text-outline">trascina la maniglia per cambiare</span>
              )}
              {visibleMembers.length > 1 && (
                <span>
                  {visibleMembers[visibleMembers.length - 1].display_name}{' '}
                  {value.mode === 'personal'
                    ? value.personalUser === visibleMembers[visibleMembers.length - 1].user?.id
                      ? '100%'
                      : '0%'
                    : `${Math.round(
                        Number(
                          value.percentages[
                            visibleMembers[visibleMembers.length - 1].user?.id ?? ''
                          ] ?? 0,
                        ),
                      )}%`}
                </span>
              )}
            </div>
          )}
        </>
      )}

      {value.mode === 'personal' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {members.map((member, index) => (
            <button
              key={member.id}
              type="button"
              onClick={() => onChange({ ...value, personalUser: member.user!.id })}
              aria-pressed={value.personalUser === member.user!.id}
              className={value.personalUser === member.user!.id ? 'chip-selected' : 'chip-outlined'}
            >
              <Avatar name={member.display_name} size={22} color={memberColor(index)} />
              {member.display_name}
            </button>
          ))}
        </div>
      )}

      {!compact && oddCentHolder && (
        <p className="mt-3 text-body-small text-on-surface-variant">
          Il centesimo dispari va a {oddCentHolder.display_name}: la somma delle quote è sempre
          esattamente il totale.
        </p>
      )}
    </div>
  )
}

function initialsOf(name: string): string {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function cumulativeRatio(
  members: Membership[],
  preview: Record<UUID, number>,
  index: number,
  totalCents: number,
): number {
  if (totalCents <= 0) return (index + 1) / members.length
  let sum = 0
  for (let i = 0; i <= index; i += 1) sum += preview[members[i].user!.id] ?? 0
  return sum / totalCents
}
