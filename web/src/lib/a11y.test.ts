import { describe, expect, it } from 'vitest'
import {
  LEVEL_ANNOUNCE_GAP_MS,
  LEVEL_HOLD_MS,
  LevelAnnouncer,
  levelWord,
  radioKeyTarget,
  spokenDuration,
  timeMarkDue,
} from './a11y.ts'

describe('radioKeyTarget', () => {
  it('moves with arrows and wraps', () => {
    expect(radioKeyTarget('ArrowRight', 0, 8)).toBe(1)
    expect(radioKeyTarget('ArrowDown', 7, 8)).toBe(0)
    expect(radioKeyTarget('ArrowLeft', 0, 8)).toBe(7)
    expect(radioKeyTarget('ArrowUp', 3, 8)).toBe(2)
  })

  it('jumps with Home and End and ignores other keys', () => {
    expect(radioKeyTarget('Home', 5, 8)).toBe(0)
    expect(radioKeyTarget('End', 0, 8)).toBe(7)
    expect(radioKeyTarget('Enter', 2, 8)).toBeNull()
    expect(radioKeyTarget('ArrowRight', 0, 0)).toBeNull()
  })
})

describe('spokenDuration', () => {
  it.each([
    [0, '0 seconds'],
    [1_000, '1 second'],
    [30_000, '30 seconds'],
    [60_000, '1 minute'],
    [150_000, '2 minutes 30 seconds'],
    [3_661_000, '1 hour 1 minute 1 second'],
  ])('%s ms → %s', (ms, text) => expect(spokenDuration(ms)).toBe(text))
})

describe('timeMarkDue', () => {
  it('fires once at each 30-second mark', () => {
    expect(timeMarkDue(29_999, 0)).toBeNull()
    expect(timeMarkDue(30_000, 0)).toBe(30_000)
    expect(timeMarkDue(45_000, 30_000)).toBeNull()
    expect(timeMarkDue(61_000, 30_000)).toBe(60_000)
  })
})

describe('levelWord', () => {
  it('buckets the meter and puts clipping first', () => {
    expect(levelWord(0)).toBe('silent')
    expect(levelWord(0.3)).toBe('quiet')
    expect(levelWord(0.6)).toBe('medium')
    expect(levelWord(0.9)).toBe('strong')
    expect(levelWord(0.2, true)).toBe('too loud')
  })
})

describe('LevelAnnouncer', () => {
  it('speaks a level once it has held, then stays quiet while it holds', () => {
    const a = new LevelAnnouncer()
    expect(a.update('medium', 0)).toBeNull()
    expect(a.update('medium', LEVEL_HOLD_MS)).toBe('medium')
    expect(a.update('medium', LEVEL_HOLD_MS + 10_000)).toBeNull()
  })

  it('ignores brief flickers', () => {
    const a = new LevelAnnouncer()
    a.update('medium', 0)
    a.update('medium', LEVEL_HOLD_MS)
    expect(a.update('quiet', 10_000)).toBeNull()
    expect(a.update('medium', 10_200)).toBeNull() // back before it held
    expect(a.update('medium', 20_000)).toBeNull() // and medium was already said
  })

  it('throttles changes', () => {
    const a = new LevelAnnouncer()
    a.update('quiet', 0)
    expect(a.update('quiet', LEVEL_HOLD_MS)).toBe('quiet')
    a.update('strong', LEVEL_HOLD_MS + 100)
    expect(a.update('strong', LEVEL_HOLD_MS * 2 + 100)).toBeNull() // too soon after the last
    expect(a.update('strong', LEVEL_HOLD_MS + LEVEL_ANNOUNCE_GAP_MS)).toBe('strong')
  })

  it('says "too loud" without waiting for it to hold', () => {
    const a = new LevelAnnouncer()
    expect(a.update('too loud', 0)).toBe('too loud')
  })

  it('starts over after reset', () => {
    const a = new LevelAnnouncer()
    expect(a.update('too loud', 0)).toBe('too loud')
    a.reset()
    expect(a.update('too loud', 1)).toBe('too loud')
  })
})
