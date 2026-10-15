// Conversion runs through a real Web Audio decoder (node-web-audio-api).
import { OfflineAudioContext as NodeOfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it, vi } from 'vitest'
import { encodeWav } from './effects.ts'
import {
  ExportError,
  baseType,
  browserDecoder,
  formatName,
  needsConversion,
  toPlayableFile,
} from './export.ts'

const realDecoder = (bytes: ArrayBuffer) =>
  new NodeOfflineAudioContext(1, 1, 16_000).decodeAudioData(bytes) as unknown as Promise<AudioBuffer>

/** 0.25 s of a 440 Hz tone as real, decodable audio bytes. */
function toneBytes(rate = 16_000): Blob {
  const n = rate / 4
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) data[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate)
  return encodeWav([data], rate)
}

async function wavHeader(file: Blob) {
  const view = new DataView(await file.arrayBuffer())
  const text = (o: number) => String.fromCharCode(...new Uint8Array(view.buffer, o, 4))
  return { riff: text(0), wave: text(8), format: view.getUint16(20, true), bits: view.getUint16(34, true), dataSize: view.getUint32(40, true) }
}

describe('needsConversion', () => {
  it.each(['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'AUDIO/MP4'])(
    '%s plays everywhere as-is',
    (type) => expect(needsConversion(type)).toBe(false),
  )

  it.each(['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/flac', 'video/webm', ''])(
    '%s is converted',
    (type) => expect(needsConversion(type)).toBe(true),
  )
})

describe('baseType and formatName', () => {
  it('drops parameters', () => {
    expect(baseType('audio/webm; codecs=opus')).toBe('audio/webm')
  })

  it('names formats for people', () => {
    expect(formatName('audio/webm;codecs=opus')).toBe('WebM/Opus')
    expect(formatName('audio/webm')).toBe('WebM/Opus')
    expect(formatName('audio/ogg;codecs="opus"')).toBe('Ogg/Opus')
    expect(formatName('audio/mp4;codecs=mp4a.40.2')).toBe('MP4/AAC')
    expect(formatName('audio/x-thing')).toBe('audio/x-thing')
    expect(formatName('')).toBe('unknown format')
  })
})

describe('toPlayableFile', () => {
  it('passes iOS MP4/AAC through unchanged, with a bare type and .m4a name', async () => {
    const blob = new Blob(['aac-bytes'], { type: 'audio/mp4;codecs=mp4a.40.2' })
    const decode = vi.fn()
    const file = await toPlayableFile({ blob, mimeType: blob.type, name: 'Memo' }, decode)
    expect(decode).not.toHaveBeenCalled()
    expect(file.name).toBe('Memo.m4a')
    expect(file.type).toBe('audio/mp4')
    expect(await file.text()).toBe('aac-bytes')
  })

  it('passes WAV through unchanged', async () => {
    const blob = toneBytes()
    const decode = vi.fn()
    const file = await toPlayableFile({ blob, mimeType: 'audio/wav', name: 'Echo take' }, decode)
    expect(decode).not.toHaveBeenCalled()
    expect(file.name).toBe('Echo take.wav')
    expect(file.size).toBe(blob.size)
  })

  it('converts a Chrome WebM/Opus recording to a 16-bit WAV', async () => {
    const decoded = new NodeOfflineAudioContext(1, 1, 48_000).createBuffer(1, 4800, 48_000)
    decoded.getChannelData(0).fill(0.25)
    const decode = vi.fn().mockResolvedValue(decoded)
    const webm = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: 'audio/webm;codecs=opus' })
    const file = await toPlayableFile({ blob: webm, mimeType: webm.type, name: 'Standup' }, decode)
    expect(decode).toHaveBeenCalledOnce()
    expect(file.name).toBe('Standup.wav')
    expect(file.type).toBe('audio/wav')
    expect(await wavHeader(file)).toEqual({ riff: 'RIFF', wave: 'WAVE', format: 1, bits: 16, dataSize: 4800 * 2 })
    const first = new DataView(await file.arrayBuffer()).getInt16(44, true) / 0x7fff
    expect(first).toBeCloseTo(0.25, 3)
  })

  it('converts through a real decoder, keeping the audio', async () => {
    // Real encoded bytes labelled as Ogg: the decoder sniffs the content, and
    // the label sends it down the conversion path.
    const file = await toPlayableFile({ blob: toneBytes(), mimeType: 'audio/ogg;codecs=opus', name: 'Real' }, realDecoder)
    expect(file.name).toBe('Real.wav')
    const header = await wavHeader(file)
    expect(header.riff).toBe('RIFF')
    expect(header.dataSize).toBe(4000 * 2) // 0.25 s at 16 kHz, mono
    // The tone survived: a peak near 0.5 somewhere in the first cycle.
    const view = new DataView(await file.arrayBuffer())
    let peak = 0
    for (let o = 44; o < 44 + 80; o += 2) peak = Math.max(peak, Math.abs(view.getInt16(o, true) / 0x8000))
    expect(peak).toBeGreaterThan(0.45)
  })

  it('says clearly when the recording cannot be decoded', async () => {
    const junk = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'audio/webm;codecs=opus' })
    const err = await toPlayableFile({ blob: junk, mimeType: junk.type, name: 'Bad' }, realDecoder).catch((e) => e)
    expect(err).toBeInstanceOf(ExportError)
    expect(err.kind).toBe('decode')
    expect(err.message).toMatch(/^Could not decode this recording \(WebM\/Opus\)/)
    expect(err.message).toMatch(/Try sharing it from Chrome on a desktop computer/)
  })

  it('says clearly when a decode gives no audio', async () => {
    const empty = { length: 0 } as AudioBuffer
    await expect(
      toPlayableFile({ blob: new Blob(['x']), mimeType: 'audio/ogg', name: 'x' }, async () => empty),
    ).rejects.toMatchObject({ kind: 'decode', message: expect.stringMatching(/no audio/) })
  })

  it('says clearly when the WAV cannot be made', async () => {
    const broken = {
      length: 10,
      numberOfChannels: 1,
      sampleRate: 48_000,
      copyFromChannel: () => {
        throw new RangeError('Array buffer allocation failed')
      },
    } as unknown as AudioBuffer
    const err = await toPlayableFile({ blob: new Blob(['x']), mimeType: 'audio/webm', name: 'x' }, async () => broken).catch(
      (e) => e,
    )
    expect(err).toBeInstanceOf(ExportError)
    expect(err.kind).toBe('encode')
    expect(err.message).toMatch(/Could not create a WAV file/)
    expect(err.cause).toBeInstanceOf(RangeError)
  })

  it('says clearly when the browser has no Web Audio to convert with', async () => {
    // Node has no global OfflineAudioContext, like a browser without Web Audio.
    expect(typeof globalThis.OfflineAudioContext).toBe('undefined')
    await expect(
      toPlayableFile({ blob: new Blob(['x']), mimeType: 'audio/webm', name: 'x' }, browserDecoder),
    ).rejects.toMatchObject({ kind: 'unsupported', message: expect.stringMatching(/can't convert audio/) })
  })
})
