// Il menu a tendina di tutta l'app: categorie, conti, persone, filtri.
//
// Si apre in un portal, posizionato sul bottone che lo apre: dentro una riga
// che scorre in orizzontale (i chip dei filtri) o una card con overflow un
// menu `absolute` veniva tagliato e non si vedeva affatto. Con la ricerca
// (sempre per le categorie, oltre le 7 voci per il resto) si filtra per
// nome senza badare a maiuscole e accenti; frecce, Invio ed Esc da tastiera.

import clsx from 'clsx'
import type { CSSProperties, KeyboardEvent, ReactNode, Ref } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { gettext } from '../lib/i18n'
import { Icon } from './ui'

export interface PickerOption {
  value: string
  label: string
  /** Testo secondario, in piccolo a destra (es. la persona di un conto). */
  hint?: string
  /** Icona o pallino davanti all'etichetta. */
  leading?: ReactNode
}

export interface TriggerState {
  open: boolean
  selected: PickerOption | undefined
  props: {
    ref: Ref<HTMLButtonElement>
    type: 'button'
    onClick: () => void
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
    disabled?: boolean
    'aria-haspopup': 'listbox'
    'aria-expanded': boolean
    'aria-label'?: string
    title?: string
  }
}

const AUTO_SEARCH_THRESHOLD = 7
const POPOVER_MIN_WIDTH = 240
const POPOVER_MAX_HEIGHT = 360
const GAP = 6

/** Minuscole e senza accenti: "caffe" trova "Caffè". */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export function Picker({
  value,
  options,
  onChange,
  renderTrigger,
  searchable,
  ariaLabel,
  title,
  disabled,
  minWidth = POPOVER_MIN_WIDTH,
}: {
  value: string
  options: PickerOption[]
  onChange: (value: string) => void
  renderTrigger: (state: TriggerState) => ReactNode
  /** Forza la ricerca; senza, compare oltre le 7 voci. */
  searchable?: boolean
  ariaLabel?: string
  title?: string
  disabled?: boolean
  minWidth?: number
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const withSearch = searchable ?? options.length > AUTO_SEARCH_THRESHOLD
  const selected = options.find((option) => option.value === value)

  const filtered = useMemo(() => {
    const needle = normalizeSearch(query)
    if (!needle) return options
    return options.filter((option) =>
      normalizeSearch(`${option.label} ${option.hint ?? ''}`).includes(needle),
    )
  }, [options, query])

  // L'evidenziata non esce mai dalla lista filtrata, anche se Invio arriva
  // prima del render che segue l'ultima lettera digitata.
  const current = Math.max(Math.min(active, filtered.length - 1), 0)

  const close = (refocus = true) => {
    setOpen(false)
    setQuery('')
    if (refocus) triggerRef.current?.focus()
  }

  const openMenu = () => {
    if (disabled) return
    const index = options.findIndex((option) => option.value === value)
    setActive(Math.max(index, 0))
    setOpen(true)
  }

  const choose = (option: PickerOption | undefined) => {
    if (!option) return
    if (option.value !== value) onChange(option.value)
    close()
  }

  // Posizione: sotto il bottone, sopra se sotto non c'e' spazio. Si ricalcola
  // a ogni scroll (anche di un contenitore interno) e resize.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(Math.max(rect.width, minWidth), window.innerWidth - 16)
      const left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8)
      const below = window.innerHeight - rect.bottom - GAP - 8
      const above = rect.top - GAP - 8
      const upward = below < 220 && above > below
      const maxHeight = Math.min(POPOVER_MAX_HEIGHT, upward ? above : below)
      setPosition(
        upward
          ? { left, width, maxHeight, bottom: window.innerHeight - rect.top + GAP }
          : { left, width, maxHeight, top: rect.bottom + GAP },
      )
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, minWidth])

  // Click fuori: ne' sul bottone ne' dentro il menu (che sta in un portal).
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // La ricerca prende il fuoco solo con un puntatore preciso: su telefono
  // aprirebbe la tastiera sopra la lista a ogni tocco.
  useEffect(() => {
    if (!open || !position) return
    if (withSearch && window.matchMedia('(pointer: fine)').matches) searchRef.current?.focus()
    else listRef.current?.focus()
  }, [open, position, withSearch])

  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [current, open])

  const onListKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(Math.min(current + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(filtered[current])
    } else if (event.key === 'Escape') {
      // Solo il menu: un Esc che arrivasse al documento chiuderebbe anche il dialog.
      event.preventDefault()
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation()
      close()
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  const trigger = renderTrigger({
    open,
    selected,
    props: {
      ref: triggerRef,
      type: 'button',
      onClick: () => (open ? close() : openMenu()),
      onKeyDown: (event) => {
        if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault()
          openMenu()
        }
      },
      disabled,
      'aria-haspopup': 'listbox',
      'aria-expanded': open,
      'aria-label': ariaLabel,
      title,
    },
  })

  return (
    <>
      {trigger}
      {open &&
        position &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[80] flex flex-col overflow-hidden rounded-card bg-surface-container p-2 shadow-sheet"
            style={position}
            onKeyDown={onListKey}
            // I click qui dentro non devono arrivare ai genitori React (righe
            // cliccabili, label dei campi): il portal li farebbe risalire.
            onClick={(event) => event.stopPropagation()}
          >
            {withSearch && (
              <div className="mb-1 flex shrink-0 items-center gap-2 rounded-nested bg-surface-container-high px-3">
                <Icon name="search" size={18} className="text-on-surface-variant" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setActive(0)
                  }}
                  placeholder={gettext('Cerca…')}
                  aria-label={gettext('Cerca')}
                  className="h-10 w-full border-none bg-transparent text-body-medium outline-none placeholder:text-on-surface-variant"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      setActive(0)
                      searchRef.current?.focus()
                    }}
                    aria-label={gettext('Svuota la ricerca')}
                    className="text-on-surface-variant"
                  >
                    <Icon name="close" size={18} />
                  </button>
                )}
              </div>
            )}
            <ul
              ref={listRef}
              role="listbox"
              tabIndex={-1}
              aria-label={ariaLabel}
              className="min-h-0 flex-1 overflow-y-auto outline-none"
            >
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-body-medium text-on-surface-variant">
                  {gettext('Nessun risultato')}
                </li>
              )}
              {filtered.map((option, index) => {
                const isSelected = option.value === value
                return (
                  <li
                    key={option.value || '__empty'}
                    role="option"
                    aria-selected={isSelected}
                    data-index={index}
                    onMouseMove={() => setActive(index)}
                    onClick={() => choose(option)}
                    className={clsx(
                      'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-nested px-3 py-2 text-body-medium',
                      isSelected && 'bg-secondary-container text-on-secondary-container',
                      !isSelected && index === current && 'bg-surface-container-highest',
                    )}
                  >
                    {option.leading}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.hint && (
                      <span className="shrink-0 truncate text-body-small text-on-surface-variant">
                        {option.hint}
                      </span>
                    )}
                    {isSelected && <Icon name="check" size={18} className="shrink-0" />}
                  </li>
                )
              })}
            </ul>
          </div>,
          document.body,
        )}
    </>
  )
}

/* ------------------------------------------------------------ trigger -- */

/** Il trigger dentro un `Field`: stessa riga e stesso testo di un input. */
export function FieldTrigger({
  state,
  placeholder,
  className,
}: {
  state: TriggerState
  placeholder?: string
  className?: string
}) {
  const { selected, props, open } = state
  return (
    <button
      {...props}
      className={clsx(
        'field-input flex items-center gap-2 text-left disabled:opacity-60',
        className,
      )}
    >
      {selected?.leading}
      <span className={clsx('min-w-0 flex-1 truncate', !selected && 'text-outline')}>
        {selected?.label ?? placeholder ?? ''}
      </span>
      {selected?.hint && (
        <span className="shrink-0 truncate text-body-small text-on-surface-variant">
          {selected.hint}
        </span>
      )}
      <Icon
        name="arrow_drop_down"
        size={22}
        className={clsx('-mr-1 shrink-0 text-on-surface-variant transition', open && 'rotate-180')}
      />
    </button>
  )
}
