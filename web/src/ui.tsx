import { type KeyboardEvent, type ReactNode, useRef } from 'react'
import { radioKeyTarget } from './lib/a11y.ts'
import { EFFECTS, type VoiceEffect } from './lib/effects.ts'

// Small building blocks shared by the screens: icons, the effect picker and
// a screen-reader-only live region.

const ICONS = {
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  play: <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" stroke="none" />,
  resume: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />,
  share: <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />,
  pencil: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />,
  wave: <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.01" />
    </>
  ),
} as const

export type IconName = keyof typeof ICONS

/** A decorative 24×24 stroke icon; the control it sits in carries the label. */
export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {ICONS[name]}
    </svg>
  )
}

/** Text only screen readers hear; with `live`, changes to it are announced. */
export function SrOnly({ children, live }: { children?: ReactNode; live?: 'polite' | 'assertive' }) {
  return (
    <span className="vr-sr-only" aria-live={live} aria-atomic={live ? true : undefined}>
      {children}
    </span>
  )
}

/**
 * The voice-effect picker: a segmented control with radio semantics. One tab
 * stop; arrow keys, Home and End move the choice (and focus), as screen-reader
 * users expect from a radio group.
 */
export function EffectPicker({
  value,
  onChange,
  disabled,
  labelId,
}: {
  value: VoiceEffect
  onChange: (effect: VoiceEffect) => void
  disabled?: boolean
  labelId: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const current = Math.max(
    0,
    EFFECTS.findIndex((e) => e.id === value),
  )

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = radioKeyTarget(e.key, current, EFFECTS.length)
    if (target === null) return
    e.preventDefault()
    onChange(EFFECTS[target].id)
    refs.current[target]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      aria-disabled={disabled || undefined}
      className="vr-segmented"
      onKeyDown={disabled ? undefined : onKeyDown}
    >
      {EFFECTS.map((e, i) => {
        const checked = i === current
        return (
          <button
            key={e.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            className="vr-segmented__option"
            onClick={() => onChange(e.id)}
          >
            {e.label}
          </button>
        )
      })}
    </div>
  )
}
