// Small, pure helpers for keyboard and screen-reader behaviour, kept apart
// from the components so they can be tested.

/**
 * Where focus goes in a radio group (or any single-select list) for a key.
 * Arrows wrap; Home/End jump. Returns null for keys the group doesn't handle.
 */
export function radioKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/** "45 seconds", "1 minute", "2 minutes 30 seconds": how a screen reader should say a duration. */
export function spokenDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  const parts: string[] = []
  if (h) parts.push(part(h, 'hour'))
  if (m) parts.push(part(m, 'minute'))
  if (s || parts.length === 0) parts.push(part(s, 'second'))
  return parts.join(' ')
}

/** How often elapsed time is spoken while recording, when spoken updates are on. */
export const TIME_ANNOUNCE_EVERY_MS = 30_000

/** The 30-second mark to announce, if `elapsedMs` has passed one since `lastMark`; otherwise null. */
export function timeMarkDue(elapsedMs: number, lastMark: number): number | null {
  const mark = Math.floor(elapsedMs / TIME_ANNOUNCE_EVERY_MS) * TIME_ANNOUNCE_EVERY_MS
  return mark > 0 && mark > lastMark ? mark : null
}

export type LevelWord = 'silent' | 'quiet' | 'medium' | 'strong' | 'too loud'

/** A word for a meter position (0..1, dB-scaled), plus whether the input clipped. */
export function levelWord(position: number, clipped = false): LevelWord {
  if (clipped) return 'too loud'
  if (position < 0.15) return 'silent'
  if (position < 0.45) return 'quiet'
  if (position < 0.75) return 'medium'
  return 'strong'
}

/** Minimum gap between spoken level updates, and how long a level must hold first. */
export const LEVEL_ANNOUNCE_GAP_MS = 5_000
export const LEVEL_HOLD_MS = 1_000

/**
 * Decides when to speak the input level: only when it changes, only once the
 * new level has held for a moment (so a single word doesn't flip it), and not
 * more often than every few seconds. "Too loud" skips the hold: it's the one
 * people need to hear straight away.
 */
export class LevelAnnouncer {
  private spoken: LevelWord | null = null
  private candidate: LevelWord | null = null
  private candidateSince = 0
  private lastSpokenAt = -Infinity

  /** Feed the current level; returns the word to announce now, or null. */
  update(word: LevelWord, now: number): LevelWord | null {
    if (word !== this.candidate) {
      this.candidate = word
      this.candidateSince = now
    }
    if (word === this.spoken) return null
    const held = now - this.candidateSince >= LEVEL_HOLD_MS || word === 'too loud'
    if (!held || now - this.lastSpokenAt < LEVEL_ANNOUNCE_GAP_MS) return null
    this.spoken = word
    this.lastSpokenAt = now
    return word
  }

  reset(): void {
    this.spoken = null
    this.candidate = null
    this.candidateSince = 0
    this.lastSpokenAt = -Infinity
  }
}
