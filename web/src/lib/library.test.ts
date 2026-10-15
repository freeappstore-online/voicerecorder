import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  Library,
  MAX_NAME_LENGTH,
  cleanName,
  defaultName,
  extensionFor,
  fileNameFor,
  formatDuration,
  formatSize,
} from './library.ts'

const webm = (bytes = 'opus-bytes') => new Blob([bytes], { type: 'audio/webm;codecs=opus' })
const m4a = (bytes = 'aac-bytes') => new Blob([bytes], { type: 'audio/mp4' })

describe('Library', () => {
  let factory: IDBFactory
  let lib: Library

  beforeEach(() => {
    factory = new IDBFactory()
    lib = new Library(factory)
  })
  afterEach(() => lib.close())

  it('starts empty', async () => {
    expect(await lib.list()).toEqual([])
  })

  it('saves a recording with its name, date, duration, type and size', async () => {
    const meta = await lib.save({ blob: webm(), durationMs: 3210.6, createdAt: 1000, name: '  Hello   world ' })
    expect(meta).toMatchObject({
      name: 'Hello world',
      createdAt: 1000,
      durationMs: 3211,
      mimeType: 'audio/webm;codecs=opus',
      size: 10,
    })
    expect(meta.id).toBeTruthy()
    expect(await lib.get(meta.id)).toEqual(meta)
  })

  it('names unnamed recordings after their date', async () => {
    const createdAt = Date.UTC(2026, 9, 15, 12, 30)
    const meta = await lib.save({ blob: m4a(), durationMs: 1000, createdAt })
    expect(meta.name).toBe(defaultName(new Date(createdAt)))
    expect(meta.name).toMatch(/^Recording /)
  })

  it('returns the audio as a Blob of the original type', async () => {
    const meta = await lib.save({ blob: m4a('aac!'), durationMs: 500 })
    const audio = await lib.audio(meta.id)
    expect(audio?.type).toBe('audio/mp4')
    expect(await audio?.text()).toBe('aac!')
  })

  it('lists newest first', async () => {
    await lib.save({ blob: webm(), durationMs: 1, createdAt: 100, name: 'old' })
    await lib.save({ blob: webm(), durationMs: 1, createdAt: 300, name: 'new' })
    await lib.save({ blob: webm(), durationMs: 1, createdAt: 200, name: 'mid' })
    expect((await lib.list()).map((r) => r.name)).toEqual(['new', 'mid', 'old'])
  })

  it('keeps recordings across a reload', async () => {
    const meta = await lib.save({ blob: webm('persist'), durationMs: 42, name: 'Keep me' })
    lib.close()
    const reopened = new Library(factory)
    try {
      expect(await reopened.list()).toEqual([meta])
      expect(await (await reopened.audio(meta.id))?.text()).toBe('persist')
    } finally {
      reopened.close()
    }
  })

  it('renames a recording', async () => {
    const meta = await lib.save({ blob: webm(), durationMs: 1, name: 'Before' })
    const updated = await lib.rename(meta.id, '  After ')
    expect(updated).toEqual({ ...meta, name: 'After' })
    expect((await lib.get(meta.id))?.name).toBe('After')
  })

  it('refuses a blank name and keeps the old one', async () => {
    const meta = await lib.save({ blob: webm(), durationMs: 1, name: 'Keep' })
    await expect(lib.rename(meta.id, '   ')).rejects.toThrow(/name/)
    expect((await lib.get(meta.id))?.name).toBe('Keep')
  })

  it('refuses to rename a missing recording', async () => {
    await expect(lib.rename('nope', 'x')).rejects.toThrow(/no longer exists/)
  })

  it('deletes a recording and its audio', async () => {
    const a = await lib.save({ blob: webm(), durationMs: 1, name: 'a' })
    const b = await lib.save({ blob: webm(), durationMs: 1, name: 'b' })
    await lib.remove(a.id)
    expect((await lib.list()).map((r) => r.id)).toEqual([b.id])
    expect(await lib.audio(a.id)).toBeUndefined()
    await lib.remove(a.id) // deleting twice is harmless
  })
})

describe('cleanName', () => {
  it('trims, collapses whitespace and caps the length', () => {
    expect(cleanName('  a \n\t b  ')).toBe('a b')
    expect(cleanName('x'.repeat(200))).toHaveLength(MAX_NAME_LENGTH)
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [7_400, '0:07'],
    [205_000, '3:25'],
    [3_723_000, '1:02:03'],
    [Number.POSITIVE_INFINITY, '0:00'],
    [-5, '0:00'],
  ])('%s ms → %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })
})

describe('formatSize', () => {
  it('uses B, KB and MB', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(14 * 1024)).toBe('14 KB')
    expect(formatSize(2.34 * 1024 * 1024)).toBe('2.3 MB')
  })
})

describe('extensionFor', () => {
  it.each([
    ['audio/mp4', 'm4a'], // iOS Safari: AAC in MP4
    ['audio/mp4;codecs=mp4a.40.2', 'm4a'],
    ['audio/webm;codecs=opus', 'webm'], // Chrome
    ['audio/ogg;codecs=opus', 'ogg'], // Firefox
    ['audio/wav', 'wav'],
    ['', 'webm'],
  ])('%s → .%s', (type, ext) => {
    expect(extensionFor(type)).toBe(ext)
  })
})

describe('fileNameFor', () => {
  it('strips characters file systems refuse', () => {
    expect(fileNameFor({ name: 'Mon/Tue: "notes"?', mimeType: 'audio/mp4' })).toBe('Mon-Tue- -notes--.m4a')
  })
  it('never produces a hidden or empty name', () => {
    expect(fileNameFor({ name: '..', mimeType: 'audio/webm' })).toBe('Recording.webm')
    expect(fileNameFor({ name: '...take', mimeType: 'audio/webm' })).toBe('take.webm')
  })
})

describe('Library change events', () => {
  it('fires on save, rename and delete', async () => {
    const lib = new Library(new IDBFactory())
    let count = 0
    lib.addEventListener('change', () => count++)
    const meta = await lib.save({ blob: webm(), durationMs: 1 })
    await lib.rename(meta.id, 'x')
    await lib.remove(meta.id)
    expect(count).toBe(3)
    lib.close()
  })
})
