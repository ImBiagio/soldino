import clsx from 'clsx'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect } from 'react'

import { memberColor } from '../lib/colors'
import { initials } from '../lib/format'
import { useCloseOnEscape } from '../lib/hooks'
import type { Membership, UUID } from '../lib/types'

/* ---------------------------------------------------------------- icone -- */

export function Icon({
  name,
  size = 24,
  filled,
  className,
  style,
}: {
  name: string
  size?: number
  filled?: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      aria-hidden
      className={clsx('icon', filled && 'icon-filled', className)}
      style={{ fontSize: size, width: size, height: size, ...style }}
    >
      {name}
    </span>
  )
}

/** Pastiglia rotonda piena del colore della categoria, glifo bianco. */
export function IconCircle({
  name,
  color,
  size = 44,
  className,
}: {
  name: string
  color: string
  size?: number
  className?: string
}) {
  return (
    <span
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-pill', className)}
      style={{ width: size, height: size, background: color }}
    >
      <Icon name={name} size={Math.round(size * 0.52)} className="text-white" />
    </span>
  )
}

/** Pulsante rotondo con solo l'icona: chiudi, elimina, menu. */
export function IconButton({
  icon,
  label,
  onClick,
  size = 'sm',
  iconSize = 20,
  disabled,
  inheritColor,
  className,
}: {
  icon: string
  label: string
  onClick: () => void
  /** sm = 36px (azioni di riga), md = 40px (barre e dialog). */
  size?: 'sm' | 'md'
  iconSize?: number
  disabled?: boolean
  /** Prende il colore del contenitore invece di on-surface-variant. */
  inheritColor?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      className={clsx(
        'state flex items-center justify-center rounded-pill',
        size === 'sm' ? 'h-9 w-9' : 'h-10 w-10',
        !inheritColor && 'text-on-surface-variant',
        className,
      )}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  )
}

/* -------------------------------------------------------------- avatar -- */

export function Avatar({
  name,
  size = 32,
  color,
  ring,
}: {
  name: string
  size?: number
  color?: string
  ring?: boolean
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-pill font-medium text-white"
      style={{
        width: size,
        height: size,
        background: color ?? 'var(--primary)',
        fontSize: Math.max(10, Math.round(size * 0.34)),
        boxShadow: ring ? '0 0 0 2px var(--surface)' : undefined,
      }}
      title={name}
    >
      {initials(name)}
    </span>
  )
}

export function AvatarStack({
  people,
  size = 36,
  className,
}: {
  people: { name: string; color?: string }[]
  size?: number
  className?: string
}) {
  return (
    <div className={clsx('flex', className)} style={{ paddingLeft: 10 }}>
      {people.map((person, index) => (
        <span key={index} style={{ marginLeft: -10 }}>
          <Avatar name={person.name} color={person.color} size={size} ring={index > 0} />
        </span>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------- chip -- */

/**
 * Una chip con avatar per membro, una sola selezionata: chi ha pagato, di chi è
 * la vista, a chi va la spesa. `children` va prima dei membri (es. "Tutti").
 */
export function MemberChips({
  members,
  value,
  onChange,
  avatarSize = 22,
  filled,
  labelOf = (member) => member.display_name,
  ariaLabel,
  className,
  children,
}: {
  members: Membership[]
  value: UUID | null
  onChange: (userId: UUID) => void
  avatarSize?: number
  /** Selezione piena in primary invece della chip tonale. */
  filled?: boolean
  labelOf?: (member: Membership) => string
  ariaLabel?: string
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      className={clsx('flex flex-wrap gap-2', className)}
      role={ariaLabel ? 'group' : undefined}
      aria-label={ariaLabel}
    >
      {children}
      {members.map((member, index) => {
        const selected = value === member.user!.id
        return (
          <button
            key={member.id}
            type="button"
            onClick={() => onChange(member.user!.id)}
            aria-pressed={selected}
            className={
              !selected
                ? 'chip-outlined'
                : filled
                  ? 'state inline-flex items-center gap-2 rounded-pill bg-primary px-4 py-2 text-body-medium font-medium text-on-primary'
                  : 'chip-selected'
            }
          >
            <Avatar name={member.display_name} size={avatarSize} color={memberColor(index)} />
            {labelOf(member)}
          </button>
        )
      })}
    </div>
  )
}

export function Chip({
  label,
  icon,
  trailingIcon,
  selected,
  variant = 'outlined',
  onClick,
  className,
  children,
}: {
  label?: string
  icon?: string
  trailingIcon?: string
  selected?: boolean
  variant?: 'outlined' | 'assist' | 'selected'
  onClick?: () => void
  className?: string
  children?: ReactNode
}) {
  const resolved = selected ? 'selected' : variant
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        resolved === 'selected' && 'chip-selected',
        resolved === 'outlined' && 'chip-outlined',
        resolved === 'assist' && 'chip-assist',
        className,
      )}
    >
      {icon && <Icon name={icon} size={18} />}
      {children ?? label}
      {trailingIcon && <Icon name={trailingIcon} size={18} />}
    </button>
  )
}

/* -------------------------------------------------------------- campi --- */

export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string
  error?: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className="field block cursor-text">
        <span className="field-label">{label}</span>
        {children}
      </label>
      {hint && !error && (
        <p className="mt-1 px-4 text-body-small text-on-surface-variant">{hint}</p>
      )}
      {error && <p className="mt-1 px-4 text-body-small text-error">{error}</p>}
    </div>
  )
}

/** Segmented button M3 (es. Spesa / Entrata). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={clsx('inline-flex rounded-pill bg-surface-container p-1', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={clsx(
            'state rounded-pill px-4 py-2 text-body-medium font-medium transition',
            value === option.value ? 'bg-primary text-on-primary' : 'text-on-surface-variant',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Switch M3 52×32 con thumb 26px. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 rounded-pill transition-colors duration-200 ease-m3 disabled:opacity-40"
      style={{
        width: 52,
        height: 32,
        background: checked ? 'var(--primary)' : 'var(--outline-variant)',
      }}
    >
      <span
        className="absolute rounded-pill bg-white transition-all duration-200 ease-m3"
        style={{ width: 26, height: 26, top: 3, left: checked ? 23 : 3 }}
      />
    </button>
  )
}

/* -------------------------------------------------------- feedback ------ */

/**
 * Pill di stato: tonale quando tutto torna, warning quando no. Con `href`
 * diventa un link (più grande, con freccia) che porta al dettaglio.
 */
export function StatusPill({
  ok,
  icon,
  href,
  children,
}: {
  ok: boolean
  icon?: string
  href?: string
  children: ReactNode
}) {
  const tone = ok
    ? 'bg-secondary-container text-on-secondary-container'
    : 'bg-warning-container text-on-warning-container'
  if (href) {
    return (
      <a
        href={href}
        className={clsx(
          'state inline-flex w-fit items-center gap-2 rounded-pill py-2 pl-4 pr-3 text-body-medium',
          tone,
        )}
      >
        <Icon name={icon ?? 'balance'} size={20} />
        {children}
        {!ok && <Icon name="chevron_right" size={20} />}
      </a>
    )
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-body-medium font-medium',
        tone,
      )}
    >
      <Icon name={icon ?? (ok ? 'check_circle' : 'balance')} size={18} />
      {children}
    </span>
  )
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={clsx('skeleton', className)} style={style} aria-hidden />
}

/** Scheletro con la forma della dashboard: hero, card mese, prime righe. */
export function DashboardSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
      <Skeleton className="h-[300px] rounded-panel" />
      <div className="grid gap-4">
        <Skeleton className="h-[140px] rounded-panel" />
        <Skeleton className="h-[144px] rounded-panel" />
      </div>
    </div>
  )
}

export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="grid gap-1">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-[72px]" />
      ))}
    </div>
  )
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-row bg-error-container px-4 py-3 text-body-medium text-on-error-container"
    >
      <Icon name="error" size={20} />
      <span>{message}</span>
    </div>
  )
}

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
}: {
  icon?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="card-m3 flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Icon name={icon} size={40} className="text-outline" />
      <p className="text-title-medium">{title}</p>
      {description && (
        <p className="max-w-md text-body-medium text-on-surface-variant">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/* ----------------------------------------------------------- overlay ---- */

/**
 * Dialog centrato su desktop, bottom sheet su mobile: nel design sono la stessa
 * superficie con due ancoraggi diversi.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  headerRight,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
  headerRight?: ReactNode
}) {
  useCloseOnEscape(open, onClose)
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto sm:items-start sm:p-6"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          'w-full bg-surface shadow-sheet',
          'rounded-t-panel sm:my-auto sm:rounded-panel',
          wide ? 'sm:max-w-[620px]' : 'sm:max-w-[520px]',
        )}
        style={{ animation: 'none' }}
      >
        <div className="flex items-center gap-3 px-6 pb-2 pt-6 sm:px-7 sm:pt-7">
          <IconButton
            icon="close"
            label="Chiudi"
            onClick={onClose}
            size="md"
            iconSize={22}
            className="-ml-2"
          />
          <h2 className="flex-1 text-[22px] font-semibold leading-7">{title}</h2>
          {headerRight}
        </div>
        <div className="px-6 pb-6 sm:px-7 sm:pb-7">{children}</div>
      </div>
    </div>
  )
}

/** Bottom sheet: su desktop diventa un pannello ancorato in basso a destra. */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {children}
    </Modal>
  )
}

/* ------------------------------------------------------------- varie ---- */

export function Stat({
  label,
  value,
  tone = 'neutral',
  hint,
  icon,
}: {
  label: string
  value: string
  tone?: 'neutral' | 'positive' | 'negative'
  hint?: string
  icon?: string
}) {
  return (
    <div className="rounded-panel bg-surface-container p-5">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-label-small uppercase tracking-wide text-on-surface-variant">{label}</p>
        {icon && <Icon name={icon} size={18} className="text-on-surface-variant" />}
      </div>
      <p
        className={clsx(
          'amount text-[30px] font-semibold leading-9',
          tone === 'positive' && 'text-primary',
          tone === 'negative' && 'text-error',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-body-small text-on-surface-variant">{hint}</p>}
    </div>
  )
}

/** Barra composita: un segmento per voce, coda neutra per il residuo. */
export function CompositeBar({
  segments,
  height = 26,
  showLabels,
}: {
  segments: { value: number; color: string; label?: string }[]
  height?: number
  showLabels?: boolean
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  return (
    <div
      className="flex w-full overflow-hidden"
      style={{ height, borderRadius: height / 2, gap: 3, background: 'var(--outline-variant)' }}
    >
      {total > 0 &&
        segments
          .filter((segment) => segment.value > 0)
          .map((segment, index) => (
            <div
              key={index}
              className="flex items-center justify-center overflow-hidden"
              style={{
                flexGrow: segment.value,
                flexBasis: 0,
                background: segment.color,
                borderRadius: height / 2,
              }}
              title={segment.label}
            >
              {showLabels && segment.label && (
                <span className="amount truncate px-2 text-[14px] font-semibold text-white">
                  {segment.label}
                </span>
              )}
            </div>
          ))}
    </div>
  )
}
