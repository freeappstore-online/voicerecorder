import { describe, expect, it, vi } from 'vitest'
import { extensionFor } from './library.ts'
import {
  ATTACK_MS,
  Clock,
  MIC_CONSTRAINTS,
  MicError,
  RELEASE_MS,
  Recorder,
  type RecorderDeps,
  WaveformHistory,
  isAppleWebKit,
  measure,
  meterPosition,
  micError,
  pickMimeType,
  smoothLevel,
} from './recorder.ts'

const supports = (...types: string[]) => (t: string) => types.includes(t)

describe('pickMimeType', () => {
  it('records AAC/MP4 on iOS Safari', () => {
    const ios = supports('audio/mp4', 'audio/mp4;codecs=mp4a.40.2')
    expect(pickMimeType(ios, true)).toBe('audio/mp4;codecs=mp4a.40.2')
  })

  it('still records MP4 on Safari 18.4+, which can also do WebM', () => {
    const safari = supports('audio/mp4', 'audio/webm;codecs=opus', 'audio/webm')
    expect(pickMimeType(safari, true)).toBe('audio/mp4')
  })

  it('records Opus/WebM on Chrome, even where it also offers MP4', () => {
    const chrome = supports('audio/webm;codecs=opus', 'audio/webm', 'audio/mp4')
    expect(pickMimeType(chrome, false)).toBe('audio/webm;codecs=opus')
  })

  it('records Opus/Ogg where WebM is missing', () => {
    expect(pickMimeType(supports('audio/ogg;codecs=opus'), false)).toBe('audio/ogg;codecs=opus')
  })

  it("lets the browser choose when it supports none of them, or throws when asked", () => {
    expect(pickMimeType(() => false, false)).toBe('')
    expect(
      pickMimeType(() => {
        throw new Error('old engine')
      }, true),
    ).toBe('')
  })

  it('gives files the library can name', () => {
    expect(extensionFor('audio/mp4;codecs=mp4a.40.2')).toBe('m4a')
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm')
  })
})

describe('isAppleWebKit', () => {
  it('spots Safari and every iOS browser', () => {
    expect(isAppleWebKit({ vendor: 'Apple Computer, Inc.', userAgent: 'Macintosh Safari' })).toBe(true)
    expect(isAppleWebKit({ vendor: 'Google Inc.', userAgent: 'Mozilla/5.0 (iPhone) CriOS/120' })).toBe(true)
    expect(isAppleWebKit({ vendor: 'Google Inc.', userAgent: 'Mozilla/5.0 (Windows) Chrome/120' })).toBe(false)
  })
})

describe('MIC_CONSTRAINTS', () => {
  it('turns on automatic gain control so voices do not clip', () => {
    expect(MIC_CONSTRAINTS.audio).toMatchObject({ autoGainControl: true })
  })
})

describe('measure', () => {
  it('reports RMS and peak', () => {
    const l = measure([0.5, -0.5, 0.5, -0.5])
    expect(l.rms).toBeCloseTo(0.5)
    expect(l.peak).toBe(0.5)
    expect(l.clipped).toBe(false)
  })

  it('flags full-scale samples as clipped', () => {
    expect(measure([0, 0.2, -1]).clipped).toBe(true)
    expect(measure([0.995]).clipped).toBe(true)
  })

  it('is silent for an empty block', () => {
    expect(measure([])).toEqual({ rms: 0, peak: 0, clipped: false })
  })
})

describe('meterPosition', () => {
  it('maps amplitude onto a 60 dB scale', () => {
    expect(meterPosition(0)).toBe(0)
    expect(meterPosition(1)).toBe(1)
    expect(meterPosition(0.001)).toBeCloseTo(0) // −60 dB
    expect(meterPosition(0.0316)).toBeCloseTo(0.5, 2) // −30 dB
    expect(meterPosition(2)).toBe(1)
  })
})

describe('smoothLevel', () => {
  it('rises fast and falls slowly', () => {
    const up = smoothLevel(0, 1, ATTACK_MS)
    const down = 1 - smoothLevel(1, 0, ATTACK_MS)
    expect(up).toBeCloseTo(1 - Math.exp(-1))
    expect(down).toBeLessThan(up / 5)
    expect(1 - smoothLevel(1, 0, RELEASE_MS)).toBeCloseTo(1 - Math.exp(-1))
  })

  it('does not depend on frame rate', () => {
    let at60 = 0
    for (let i = 0; i < 6; i++) at60 = smoothLevel(at60, 1, 1000 / 60)
    let at120 = 0
    for (let i = 0; i < 12; i++) at120 = smoothLevel(at120, 1, 1000 / 120)
    expect(at60).toBeCloseTo(at120, 10)
  })

  it('never overshoots', () => {
    expect(smoothLevel(0, 0.8, 10_000)).toBeCloseTo(0.8)
    expect(smoothLevel(0.5, 0.5, 16)).toBe(0.5)
    expect(smoothLevel(0.3, 1, -5)).toBe(0.3)
  })
})

describe('WaveformHistory', () => {
  it('adds one bar per interval holding the loudest reading', () => {
    const w = new WaveformHistory(3, 50)
    expect(w.push(0.2, 20)).toBe(false)
    expect(w.push(0.9, 20)).toBe(false)
    expect(w.push(0.1, 20)).toBe(true)
    expect(w.bars).toEqual([0, 0, 0.9])
    w.push(0.4, 50)
    w.push(0.6, 50)
    expect(w.bars).toEqual([0.9, 0.4, 0.6])
    w.clear()
    expect(w.bars).toEqual([0, 0, 0])
  })
})

describe('Clock', () => {
  it('counts only time spent recording', () => {
    let t = 1000
    const c = new Clock(() => t)
    c.start()
    t += 3000
    c.pause()
    t += 10_000 // paused
    expect(c.elapsedMs).toBe(3000)
    c.resume()
    t += 2000
    expect(c.elapsedMs).toBe(5000)
    c.pause()
    c.pause() // harmless
    expect(c.elapsedMs).toBe(5000)
  })
})

describe('micError', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'not-found'],
    ['NotReadableError', 'busy'],
    ['Weird', 'unknown'],
  ])('%s → %s', (name, kind) => {
    expect(micError(new DOMException('x', name)).kind).toBe(kind)
  })

  it('passes MicErrors through', () => {
    const e = new MicError('unsupported', 'nope')
    expect(micError(e)).toBe(e)
  })
})

// ---------------------------------------------------------------------------
// Recorder, against fake browser APIs.

class FakeMediaRecorder {
  state: RecordingState = 'inactive'
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  timeslice?: number
  constructor(options: MediaRecorderOptions) {
    this.mimeType = options.mimeType ?? ''
  }
  start(timeslice?: number) {
    this.timeslice = timeslice
    this.state = 'recording'
  }
  pause() {
    this.state = 'paused'
  }
  resume() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['tail'], { type: this.mimeType }) })
    this.onstop?.()
  }
  emit(text: string) {
    this.ondataavailable?.({ data: new Blob([text], { type: this.mimeType }) })
  }
}

function fakes(opts: { getUserMedia?: RecorderDeps['getUserMedia']; samples?: number[] } = {}) {
  let t = 0
  const track: { stop: ReturnType<typeof vi.fn>; onended: (() => void) | null } = { stop: vi.fn(), onended: null }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  const ctx = {
    state: 'running',
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createMediaStreamSource: () => ({ connect: vi.fn() }),
    createAnalyser: () => ({
      fftSize: 0,
      smoothingTimeConstant: 1,
      getFloatTimeDomainData: (buf: Float32Array) => buf.set((opts.samples ?? []).slice(0, buf.length)),
    }),
  }
  let media: FakeMediaRecorder | null = null
  const deps: RecorderDeps = {
    getUserMedia: opts.getUserMedia ?? vi.fn().mockResolvedValue(stream),
    createMediaRecorder: (_s, o) => (media = new FakeMediaRecorder(o)) as unknown as MediaRecorder,
    createAudioContext: () => ctx as unknown as AudioContext,
    isTypeSupported: supports('audio/webm;codecs=opus'),
    preferMp4: false,
    now: () => t,
  }
  return {
    deps,
    track,
    ctx,
    media: () => media!,
    advance: (ms: number) => (t += ms),
  }
}

describe('Recorder', () => {
  it('records, pauses, resumes and stops into one file', async () => {
    const f = fakes()
    const rec = new Recorder(f.deps)
    await rec.start()
    expect(rec.state).toBe('recording')
    expect(f.deps.getUserMedia).toHaveBeenCalledWith(MIC_CONSTRAINTS)
    expect(f.media().timeslice).toBe(1000)
    f.media().emit('a')
    f.advance(2000)
    rec.pause()
    expect(rec.state).toBe('paused')
    expect(f.media().state).toBe('paused')
    f.advance(5000)
    rec.resume()
    f.media().emit('b')
    f.advance(1000)
    const take = await rec.stop()
    expect(take.mimeType).toBe('audio/webm;codecs=opus')
    expect(take.blob.type).toBe('audio/webm;codecs=opus')
    expect(await take.blob.text()).toBe('abtail')
    expect(take.durationMs).toBe(3000)
    // The mic is released.
    expect(rec.state).toBe('inactive')
    expect(f.track.stop).toHaveBeenCalled()
    expect(f.ctx.close).toHaveBeenCalled()
  })

  it('explains a blocked microphone and releases everything', async () => {
    const f = fakes({ getUserMedia: () => Promise.reject(new DOMException('no', 'NotAllowedError')) })
    const rec = new Recorder(f.deps)
    await expect(rec.start()).rejects.toMatchObject({ kind: 'denied' })
    expect(rec.state).toBe('inactive')
    expect(f.ctx.close).toHaveBeenCalled()
  })

  it('resumes a suspended audio context (iOS)', async () => {
    const f = fakes()
    f.ctx.state = 'suspended'
    await new Recorder(f.deps).start()
    expect(f.ctx.resume).toHaveBeenCalled()
  })

  it('reads levels while recording and silence while paused', async () => {
    const f = fakes({ samples: [1, -1, 1, -1] })
    const rec = new Recorder(f.deps)
    expect(rec.levels().peak).toBe(0)
    await rec.start()
    expect(rec.levels()).toMatchObject({ peak: 1, clipped: true })
    rec.pause()
    expect(rec.levels().peak).toBe(0)
  })

  it('discards a take on cancel', async () => {
    const f = fakes()
    const rec = new Recorder(f.deps)
    await rec.start()
    rec.cancel()
    expect(rec.state).toBe('inactive')
    expect(f.track.stop).toHaveBeenCalled()
    await expect(rec.stop()).rejects.toThrow(/Not recording/)
  })

  it('ignores pause/resume when they do not apply', async () => {
    const f = fakes()
    const rec = new Recorder(f.deps)
    rec.pause()
    rec.resume()
    expect(rec.state).toBe('inactive')
    await rec.start()
    rec.resume()
    expect(rec.state).toBe('recording')
  })

  it('reports when the system cuts the mic (iOS screen lock) and can still save', async () => {
    const f = fakes()
    const rec = new Recorder(f.deps)
    const interrupted = vi.fn()
    rec.onInterrupted = interrupted
    await rec.start()
    f.media().emit('a')
    f.track.onended?.()
    expect(interrupted).toHaveBeenCalledOnce()
    expect(await (await rec.stop()).blob.text()).toBe('atail')
    // Released tracks don't report again.
    expect(f.track.onended).toBeNull()
  })
})
