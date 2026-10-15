// Making a recording's file playable everywhere before it leaves the app.
//
// iOS records AAC in MP4 (.m4a): the iOS Files app, Chrome, and desktop
// players (QuickTime, Windows Media Player, VLC) all open it, so it's sent
// as-is. Chrome and Firefox record Opus in WebM or Ogg: iOS Files and many
// desktop players can't open those, and MediaRecorder WebM has no duration
// in its header. Those are decoded and re-encoded as 16-bit WAV, which every
// player opens.
//
// No DOM here: only Web Audio types, so it runs in tests too.

import { audioBufferToWav } from './effects.ts'
import { fileNameFor } from './library.ts'

/** MIME types (without parameters) that already play everywhere and are sent unchanged. */
const PLAYABLE = new Set([
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg',
])

/** The MIME type without parameters, lower-cased: `audio/webm;codecs=opus` → `audio/webm`. */
export function baseType(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase()
}

/** True when the format won't open in common players (WebM, Ogg, anything unknown) and must be converted. */
export function needsConversion(mimeType: string): boolean {
  return !PLAYABLE.has(baseType(mimeType))
}

/** A short human name for a recording's format, for error messages: "WebM/Opus". */
export function formatName(mimeType: string): string {
  const base = baseType(mimeType)
  const codec = /codecs="?([^";,]+)/i.exec(mimeType)?.[1]?.toLowerCase()
  const container =
    {
      'audio/webm': 'WebM',
      'audio/ogg': 'Ogg',
      'audio/mp4': 'MP4',
      'audio/x-m4a': 'M4A',
      'audio/wav': 'WAV',
      'audio/mpeg': 'MP3',
    }[base] ?? (base || 'unknown format')
  if (codec === 'opus' || ((base === 'audio/webm' || base === 'audio/ogg') && !codec)) return `${container}/Opus`
  if (codec?.startsWith('mp4a')) return `${container}/AAC`
  return container
}

export type ExportErrorKind = 'unsupported' | 'decode' | 'encode'

/** A conversion that couldn't be done. The message is written for the person using the app. */
export class ExportError extends Error {
  readonly kind: ExportErrorKind
  constructor(kind: ExportErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExportError'
    this.kind = kind
  }
}

/** Turns encoded audio bytes into samples. */
export type Decoder = (bytes: ArrayBuffer) => Promise<AudioBuffer>

/** Decodes with an OfflineAudioContext: no audio output needed, so no autoplay rules apply. */
export const browserDecoder: Decoder = (bytes) => {
  if (typeof OfflineAudioContext === 'undefined') {
    throw new ExportError('unsupported', "This browser can't convert audio. Try the latest Safari, Chrome, Edge or Firefox.")
  }
  return new OfflineAudioContext(1, 1, 48_000).decodeAudioData(bytes)
}

export interface PlayableSource {
  blob: Blob
  mimeType: string
  name: string
}

/**
 * The recording as a File that common players open: unchanged for MP4/AAC
 * and WAV, converted to WAV for WebM/Ogg and anything else. Throws an
 * ExportError with a clear message if the browser can't convert it.
 */
export async function toPlayableFile(source: PlayableSource, decode: Decoder = browserDecoder): Promise<File> {
  if (!needsConversion(source.mimeType)) {
    // The bare type (no codecs=…) is what share sheets and file pickers match on.
    const type = baseType(source.mimeType)
    return new File([source.blob], fileNameFor({ name: source.name, mimeType: type }), { type })
  }

  const format = formatName(source.mimeType)
  let buffer: AudioBuffer
  try {
    buffer = await decode(await source.blob.arrayBuffer())
  } catch (err) {
    if (err instanceof ExportError) throw err
    throw new ExportError(
      'decode',
      `Could not decode this recording (${format}) in this browser, so it can't be converted to a file other apps can play. Try sharing it from Chrome on a desktop computer.`,
      { cause: err },
    )
  }
  if (!buffer || buffer.length === 0) {
    throw new ExportError('decode', `This recording (${format}) has no audio in it to export.`)
  }

  let wav: Blob
  try {
    wav = audioBufferToWav(buffer)
  } catch (err) {
    throw new ExportError(
      'encode',
      'Could not create a WAV file from this recording. It may be too long for this device; try a shorter one.',
      { cause: err },
    )
  }
  return new File([wav], fileNameFor({ name: source.name, mimeType: 'audio/wav' }), { type: 'audio/wav' })
}
