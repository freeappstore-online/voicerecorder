// Runs the effects through a real Web Audio implementation (node-web-audio-api),
// so these renders are the same maths the browser does. Its getChannelData()
// views native memory that goes when the buffer is collected, so samples kept
// past the buffer's lifetime are copied (`samplesOf`).
import { OfflineAudioContext as NodeOfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it } from 'vitest'
import {
  EFFECTS,
  EXPORT_PEAK,
  type OfflineContextFactory,
  type VoiceEffect,
  buildEffectChain,
  createReverbImpulse,
  driveCurve,
  effectFromName,
  safetyCurve,
  encodeWav,
  exportWithEffect,
  prepareBuffer,
  renderWithEffect,
  renderedLength,
  sourcePlaybackRate,
  tailSeconds,
} from './effects.ts'

const RATE = 16_000
const offline: OfflineContextFactory = (c, l, r) =>
  new NodeOfflineAudioContext(c, l, r) as unknown as OfflineAudioContext

function makeBuffer(fill: (i: number, t: number) => number, seconds = 0.5, channels = 1): AudioBuffer {
  const ctx = offline(channels, 1, RATE)
  const length = Math.round(seconds * RATE)
  const buf = ctx.createBuffer(channels, length, RATE)
  for (let ch = 0; ch < channels; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < length; i++) data[i] = fill(i, i / RATE)
  }
  return buf
}

function samplesOf(buf: AudioBuffer, ch = 0): Float32Array {
  const data = new Float32Array(buf.length)
  buf.copyFromChannel(data, ch)
  return data
}

const sine = (amp = 0.5, hz = 220) => makeBuffer((_, t) => amp * Math.sin(2 * Math.PI * hz * t))
const ALL = EFFECTS.map((e) => e.id)
const SEVEN = ALL.filter((e) => e !== 'none')

function peakOf(buf: AudioBuffer): number {
  let p = 0
  for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const s of buf.getChannelData(ch)) p = Math.max(p, Math.abs(s))
  return p
}

/** Reads a WAV back into numbers: header fields and samples scaled to −1..1. */
async function readWav(blob: Blob) {
  const view = new DataView(await blob.arrayBuffer())
  const text = (o: number, n: number) => String.fromCharCode(...new Uint8Array(view.buffer, o, n))
  const channels = view.getUint16(22, true)
  const dataSize = view.getUint32(40, true)
  const samples: number[] = []
  for (let o = 44; o < 44 + dataSize; o += 2) samples.push(view.getInt16(o, true) / 0x8000)
  return {
    riff: text(0, 4),
    wave: text(8, 4),
    fmt: text(12, 4),
    data: text(36, 4),
    format: view.getUint16(20, true),
    channels,
    sampleRate: view.getUint32(24, true),
    bits: view.getUint16(34, true),
    riffSize: view.getUint32(4, true),
    size: blob.size,
    dataSize,
    samples,
  }
}

describe('effect list', () => {
  it('has the seven effects from the issue plus the original', () => {
    expect(SEVEN).toEqual(['pitch-up', 'pitch-down', 'robot', 'echo', 'reverb', 'radio', 'reverse'])
  })
})

describe('buildEffectChain', () => {
  it.each(ALL)('%s returns connected input and output nodes', (effect) => {
    const ctx = offline(1, RATE, RATE)
    const chain = buildEffectChain(ctx, effect)
    expect(chain.input.context).toBe(ctx)
    expect(chain.output.context).toBe(ctx)
    expect(() => chain.output.connect(ctx.destination)).not.toThrow()
    chain.dispose()
  })

  it('passes audio through unchanged for "none"', async () => {
    const src = sine(0.5)
    const out = await renderWithEffect(src, 'none', offline)
    expect(out.length).toBe(src.length)
    const a = src.getChannelData(0)
    const b = out.getChannelData(0)
    for (let i = 0; i < a.length; i += 97) expect(b[i]).toBeCloseTo(a[i], 5)
  })
})

describe('sourcePlaybackRate and tailSeconds', () => {
  it('speeds up for chipmunk, slows down for deep, leaves the rest alone', () => {
    expect(sourcePlaybackRate('pitch-up')).toBeGreaterThan(1)
    expect(sourcePlaybackRate('pitch-down')).toBeLessThan(1)
    for (const e of ['none', 'robot', 'echo', 'reverb', 'radio', 'reverse'] as VoiceEffect[]) {
      expect(sourcePlaybackRate(e)).toBe(1)
    }
  })

  it('leaves room for echo and reverb to ring out', () => {
    expect(tailSeconds('echo')).toBeGreaterThan(2)
    expect(tailSeconds('reverb')).toBe(2)
    expect(tailSeconds('robot')).toBe(0)
  })
})

describe('renderWithEffect', () => {
  it('changes length with the pitch effects and adds tails', async () => {
    const src = sine()
    expect((await renderWithEffect(src, 'pitch-up', offline)).length).toBe(Math.ceil(src.length / 1.5))
    expect((await renderWithEffect(src, 'pitch-down', offline)).length).toBe(Math.ceil(src.length / 0.7))
    expect((await renderWithEffect(src, 'reverb', offline)).length).toBe(src.length + 2 * RATE)
  })

  it('makes every effect sound different from the original and from each other', async () => {
    const src = sine(0.5, 440)
    const renders = new Map<VoiceEffect, Float32Array>()
    for (const e of ALL) renders.set(e, samplesOf(await renderWithEffect(src, e, offline)))
    const window = Math.round(0.4 * RATE) // compare the first 0.4 s of each
    const distance = (a: Float32Array, b: Float32Array) => {
      let d = 0
      for (let i = 0; i < window; i++) d += Math.abs((a[i] ?? 0) - (b[i] ?? 0))
      return d / window
    }
    for (let i = 0; i < ALL.length; i++) {
      for (let j = i + 1; j < ALL.length; j++) {
        expect(distance(renders.get(ALL[i])!, renders.get(ALL[j])!), `${ALL[i]} vs ${ALL[j]}`).toBeGreaterThan(0.01)
      }
    }
  })

  it.each(SEVEN)('%s renders without NaNs or clipping', async (effect) => {
    const out = await renderWithEffect(sine(0.9), effect, offline)
    const data = out.getChannelData(0)
    expect(data.every(Number.isFinite)).toBe(true)
    expect(peakOf(out)).toBeLessThanOrEqual(1)
  })

  it.each(['robot', 'echo', 'reverb', 'radio'] as VoiceEffect[])(
    '%s stays under the ceiling live, even fed a full-scale square wave',
    async (effect) => {
      const square = makeBuffer((_, t) => (Math.sin(2 * Math.PI * 200 * t) >= 0 ? 1 : -1))
      expect(peakOf(await renderWithEffect(square, effect, offline))).toBeLessThanOrEqual(EXPORT_PEAK)
    },
  )

  it('reverses the audio', async () => {
    const ramp = makeBuffer((i) => i / RATE) // 0 → ~0.5
    const out = samplesOf(await renderWithEffect(ramp, 'reverse', offline))
    const orig = samplesOf(ramp)
    expect(out[0]).toBeCloseTo(orig[orig.length - 1], 2)
    expect(out[out.length - 1]).toBeCloseTo(orig[0], 2)
    expect(out[0]).not.toBeCloseTo(orig[0], 2)
  })
})

describe('prepareBuffer', () => {
  it('reverses each channel into a copy and leaves the original alone', () => {
    const ctx = offline(2, 1, RATE)
    const src = makeBuffer((i) => i, 0.001, 2)
    const rev = prepareBuffer(ctx, src, 'reverse')
    expect(rev).not.toBe(src)
    for (let ch = 0; ch < 2; ch++) {
      expect(Array.from(rev.getChannelData(ch))).toEqual(Array.from(src.getChannelData(ch)).reverse())
    }
    expect(src.getChannelData(0)[0]).toBe(0)
    expect(prepareBuffer(ctx, src, 'echo')).toBe(src)
  })
})

describe('createReverbImpulse', () => {
  it('is stereo, the right length, decays and is the same each time', () => {
    const ctx = offline(1, 1, RATE)
    const ir = createReverbImpulse(ctx, 1, 2)
    expect(ir.numberOfChannels).toBe(2)
    expect(ir.length).toBe(RATE)
    const d = samplesOf(ir)
    const energy = (from: number, to: number) => d.slice(from, to).reduce((s, x) => s + x * x, 0)
    expect(energy(0, 1000)).toBeGreaterThan(energy(RATE - 1000, RATE) * 100)
    expect(Array.from(createReverbImpulse(ctx, 1, 2).getChannelData(0).slice(0, 50))).toEqual(Array.from(d.slice(0, 50)))
  })
})

describe('safetyCurve', () => {
  it('is linear below the knee and never exceeds the ceiling', () => {
    const c = safetyCurve(0.7, 0.98, 2001)
    expect(c[1000]).toBeCloseTo(0)
    expect(c[1500]).toBeCloseTo(0.5) // x = 0.5, below the knee
    expect(c[0]).toBeCloseTo(-c[2000])
    expect(Math.max(...c.map(Math.abs))).toBeLessThanOrEqual(0.98)
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1])
  })
})

describe('driveCurve', () => {
  it('maps −1..1 onto −1..1 and is symmetric', () => {
    const c = driveCurve(2.5, 101)
    expect(c[0]).toBeCloseTo(-1)
    expect(c[100]).toBeCloseTo(1)
    expect(c[50]).toBeCloseTo(0)
    expect(c[25]).toBeCloseTo(-c[75])
  })
})

describe('exportWithEffect', () => {
  it.each(ALL)('%s exports a playable 16-bit PCM WAV', async (effect) => {
    const wav = await readWav(await exportWithEffect(sine(), effect, offline))
    expect(wav.riff).toBe('RIFF')
    expect(wav.wave).toBe('WAVE')
    expect(wav.fmt).toBe('fmt ')
    expect(wav.data).toBe('data')
    expect(wav.format).toBe(1)
    expect(wav.bits).toBe(16)
    expect(wav.channels).toBe(1)
    expect(wav.sampleRate).toBe(RATE)
    expect(wav.riffSize).toBe(wav.size - 8)
    expect(wav.dataSize).toBe(wav.size - 44)
    expect(wav.dataSize).toBeGreaterThan(0)
  })

  it('never clips, even from a source at twice full scale', async () => {
    const loud = sine(2)
    for (const effect of ALL) {
      const { samples } = await readWav(await exportWithEffect(loud, effect, offline))
      const peak = samples.reduce((p, s) => Math.max(p, Math.abs(s)), 0)
      expect(peak, effect).toBeLessThanOrEqual(1)
      expect(peak, effect).toBeLessThanOrEqual(EXPORT_PEAK + 0.001)
    }
  })
})

describe('encodeWav', () => {
  it('interleaves channels', async () => {
    const left = new Float32Array([0.5, 0.25])
    const right = new Float32Array([-0.5, 0])
    const wav = await readWav(encodeWav([left, right], 8000))
    expect(wav.channels).toBe(2)
    expect(wav.samples.map((s) => Math.round(s * 100) / 100)).toEqual([0.5, -0.5, 0.25, 0])
  })

  it('leaves quiet audio at its level and scales loud audio down to the export peak', async () => {
    expect((await readWav(encodeWav([new Float32Array([0.5])], 8000))).samples[0]).toBeCloseTo(0.5, 3)
    const loud = await readWav(encodeWav([new Float32Array([2, -1, 1])], 8000))
    expect(loud.samples[0]).toBeCloseTo(EXPORT_PEAK, 3)
    expect(loud.samples[1]).toBeCloseTo(-EXPORT_PEAK / 2, 3)
  })

  it('writes silence for NaN samples', async () => {
    expect((await readWav(encodeWav([new Float32Array([Number.NaN])], 8000))).samples).toEqual([0])
  })
})

describe('renderedLength', () => {
  it('accounts for pitch rate and tails', () => {
    expect(renderedLength(15_000, RATE, 'none')).toBe(15_000)
    expect(renderedLength(15_000, RATE, 'pitch-up')).toBe(10_000)
    expect(renderedLength(15_000, RATE, 'reverb')).toBe(15_000 + 2 * RATE)
    expect(renderedLength(0, RATE, 'none')).toBe(1)
  })
})

describe('effectFromName', () => {
  it('reads the effect from an export name', () => {
    expect(effectFromName('Standup [Robot]')).toBe('robot')
    expect(effectFromName('Standup [Chipmunk] ')).toBe('pitch-up')
    expect(effectFromName('Standup')).toBeNull()
    expect(effectFromName('Notes [draft]')).toBeNull()
    expect(effectFromName('Standup [Original]')).toBeNull()
  })
})
