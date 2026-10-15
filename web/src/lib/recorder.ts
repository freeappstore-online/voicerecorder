// The recording engine: microphone → MediaRecorder for the file, and the same
// stream → Web Audio AnalyserNode for the live meter and waveform.
//
// Formats: iOS Safari records AAC in MP4; Chrome (and Firefox) record Opus in
// WebM (or Ogg). Safari 18.4+ can also do WebM, but MP4 is what iOS apps and
// the Files app open, so Apple browsers are steered to MP4.
//
// Clipping: the mic is opened with the browser's automatic gain control on,
// which keeps loud voices out of the red at the source. The meter also
// reports when the signal touches full scale so the UI can say "too loud".

/** Format candidates, best first, for each family. */
const MP4_TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4']
const WEBM_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

/**
 * The MIME type to ask MediaRecorder for, or '' to let the browser choose.
 * `preferMp4` is for Apple browsers (see the note at the top).
 */
export function pickMimeType(isTypeSupported: (type: string) => boolean, preferMp4: boolean): string {
  const order = preferMp4 ? [...MP4_TYPES, ...WEBM_TYPES] : [...WEBM_TYPES, ...MP4_TYPES]
  for (const type of order) {
    try {
      if (isTypeSupported(type)) return type
    } catch {
      // Some old engines throw on unknown types; treat that as "no".
    }
  }
  return ''
}

/** True for Safari/WebKit (including every iOS browser), which should record MP4. */
export function isAppleWebKit(nav: Pick<Navigator, 'vendor' | 'userAgent'> = navigator): boolean {
  return nav.vendor === 'Apple Computer, Inc.' || /iP(hone|ad|od)/.test(nav.userAgent)
}

/** Microphone settings for voice: AGC keeps levels out of clipping, the rest cleans up a room. */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    autoGainControl: true,
    noiseSuppression: true,
    echoCancellation: true,
    channelCount: 1,
  },
}

// ---------------------------------------------------------------------------
// Levels

/** Samples at or above this are treated as clipped. */
export const CLIP_THRESHOLD = 0.99
/** The meter's floor: anything quieter shows as empty. */
export const METER_FLOOR_DB = -60

export interface Levels {
  /** Root-mean-square of the block, 0..1. */
  rms: number
  /** Largest absolute sample in the block, 0..1. */
  peak: number
  clipped: boolean
}

export function measure(samples: ArrayLike<number>): Levels {
  let sum = 0
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    sum += s * s
    const a = Math.abs(s)
    if (a > peak) peak = a
  }
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0
  return { rms: Math.min(1, rms), peak: Math.min(1, peak), clipped: peak >= CLIP_THRESHOLD }
}

/** Maps an amplitude (0..1) to a meter position (0..1) on a dB scale, which matches how loudness sounds. */
export function meterPosition(amplitude: number): number {
  if (amplitude <= 0) return 0
  const db = 20 * Math.log10(amplitude)
  return Math.max(0, Math.min(1, 1 - db / METER_FLOOR_DB))
}

/** Rise time constant: the meter jumps up quickly… */
export const ATTACK_MS = 25
/** …and falls back slowly, so it reads as smooth rather than flickering. */
export const RELEASE_MS = 300

/**
 * One step of the meter's ballistics, independent of frame rate: moves `prev`
 * toward `target` with a fast attack and a slow release over `dtMs`.
 */
export function smoothLevel(prev: number, target: number, dtMs: number): number {
  const tau = target > prev ? ATTACK_MS : RELEASE_MS
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau)
  return prev + (target - prev) * k
}

/**
 * A rolling history of levels for the scrolling waveform: one bar per
 * `intervalMs`, the loudest moment within each interval, newest last.
 */
export class WaveformHistory {
  readonly bars: number[]
  private acc = 0
  private elapsed = 0
  private readonly intervalMs: number

  constructor(size: number, intervalMs = 50) {
    this.bars = new Array<number>(size).fill(0)
    this.intervalMs = intervalMs
  }

  /** Adds a reading taken `dtMs` after the previous one. Returns true when a bar was added. */
  push(value: number, dtMs: number): boolean {
    this.acc = Math.max(this.acc, value)
    this.elapsed += dtMs
    if (this.elapsed < this.intervalMs) return false
    this.elapsed %= this.intervalMs
    this.bars.shift()
    this.bars.push(this.acc)
    this.acc = 0
    return true
  }

  clear(): void {
    this.bars.fill(0)
    this.acc = 0
    this.elapsed = 0
  }
}

// ---------------------------------------------------------------------------
// Time

/** Elapsed recording time that stops while paused. */
export class Clock {
  private startedAt = 0
  private banked = 0
  private running = false
  private readonly now: () => number

  constructor(now: () => number = () => performance.now()) {
    this.now = now
  }

  start(): void {
    this.banked = 0
    this.startedAt = this.now()
    this.running = true
  }

  pause(): void {
    if (!this.running) return
    this.banked += this.now() - this.startedAt
    this.running = false
  }

  resume(): void {
    if (this.running) return
    this.startedAt = this.now()
    this.running = true
  }

  get elapsedMs(): number {
    return this.banked + (this.running ? this.now() - this.startedAt : 0)
  }
}

// ---------------------------------------------------------------------------
// Errors

export type MicErrorKind = 'unsupported' | 'denied' | 'blocked' | 'not-found' | 'busy' | 'unknown'

export class MicError extends Error {
  readonly kind: MicErrorKind
  constructor(kind: MicErrorKind, message: string) {
    super(message)
    this.name = 'MicError'
    this.kind = kind
  }
}

type PolicyDoc = { permissionsPolicy?: { allowsFeature(f: string): boolean }; featurePolicy?: { allowsFeature(f: string): boolean } }

/**
 * False when the page itself isn't allowed the microphone (a Permissions-Policy
 * header or iframe attribute): then no browser setting the person can change
 * will help. Browsers that can't tell (Safari) report true.
 */
export function pageAllowsMicrophone(doc: PolicyDoc | undefined = typeof document !== 'undefined' ? (document as PolicyDoc) : undefined): boolean {
  const policy = doc?.permissionsPolicy ?? doc?.featurePolicy
  try {
    return policy ? policy.allowsFeature('microphone') : true
  } catch {
    return true
  }
}

/** Turns a getUserMedia failure into something a person can act on. */
export function micError(err: unknown, pageAllowsMic: boolean = pageAllowsMicrophone()): MicError {
  if (err instanceof MicError) return err
  const name = err instanceof Error ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      if (!pageAllowsMic) {
        return new MicError(
          'blocked',
          "This site isn't allowed to use the microphone right now, so recording can't start. It's a setting on our side, not yours; please try again later.",
        )
      }
      return new MicError(
        'denied',
        'Microphone access is blocked. Allow it for this site in your browser settings, then try again.',
      )
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new MicError('not-found', 'No microphone was found. Connect one and try again.')
    case 'NotReadableError':
    case 'AbortError':
      return new MicError('busy', 'The microphone is in use by another app. Close it and try again.')
    default:
      return new MicError('unknown', 'The microphone could not be started. Please try again.')
  }
}

// ---------------------------------------------------------------------------
// The recorder

export type RecorderState = 'inactive' | 'recording' | 'paused'

export interface Take {
  blob: Blob
  durationMs: number
  mimeType: string
}

/** Browser APIs the recorder uses, injectable so it can be tested without a browser. */
export interface RecorderDeps {
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>
  createMediaRecorder: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder
  createAudioContext: () => AudioContext
  isTypeSupported: (type: string) => boolean
  preferMp4: boolean
  now: () => number
}

function browserDeps(): RecorderDeps {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  if (!md?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new MicError(
      'unsupported',
      "This browser can't record audio. Try the latest Safari, Chrome, Edge or Firefox.",
    )
  }
  const AC =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  return {
    getUserMedia: (c) => md.getUserMedia(c),
    createMediaRecorder: (s, o) => new MediaRecorder(s, o),
    createAudioContext: () => new AC(),
    isTypeSupported: (t) => MediaRecorder.isTypeSupported(t),
    preferMp4: isAppleWebKit(),
    now: () => performance.now(),
  }
}

/**
 * One recording session. `start()` opens the mic and starts recording,
 * `pause()`/`resume()` do what they say, and `stop()` resolves with the
 * finished file. `cancel()` throws the take away. Either way the mic is
 * released afterwards.
 */
export class Recorder {
  state: RecorderState = 'inactive'
  readonly clock: Clock
  /**
   * Called when the system takes the microphone away mid-take: on iOS that's
   * the screen locking, the app going to the background, or a phone call.
   * The take so far can still be stopped and saved.
   */
  onInterrupted: (() => void) | null = null
  private readonly deps: RecorderDeps
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private media: MediaRecorder | null = null
  private chunks: Blob[] = []
  private buffer: Float32Array<ArrayBuffer> = new Float32Array(0)
  private mimeType = ''

  constructor(deps?: Partial<RecorderDeps>) {
    this.deps = { ...(deps && isComplete(deps) ? {} : browserDeps()), ...deps } as RecorderDeps
    this.clock = new Clock(this.deps.now)
  }

  async start(): Promise<void> {
    if (this.state !== 'inactive') return
    // Made before the first await so iOS counts it as part of the tap.
    const context = this.deps.createAudioContext()
    this.context = context
    let stream: MediaStream
    try {
      stream = await this.deps.getUserMedia(MIC_CONSTRAINTS)
    } catch (err) {
      this.release()
      throw micError(err)
    }
    this.stream = stream
    for (const track of stream.getTracks()) {
      track.onended = () => {
        if (this.state !== 'inactive') this.onInterrupted?.()
      }
    }
    try {
      if (context.state === 'suspended') await context.resume().catch(() => {})
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0
      source.connect(analyser) // not to the speakers: no feedback
      this.analyser = analyser
      this.buffer = new Float32Array(analyser.fftSize)

      const requested = pickMimeType(this.deps.isTypeSupported, this.deps.preferMp4)
      const media = this.deps.createMediaRecorder(stream, requested ? { mimeType: requested } : {})
      this.media = media
      this.chunks = []
      media.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data)
      }
      // Timeslice: data arrives every second, so a crash loses at most that.
      media.start(1000)
      this.mimeType = media.mimeType || requested
      this.clock.start()
      this.state = 'recording'
    } catch (err) {
      this.release()
      throw err instanceof MicError ? err : micError(err)
    }
  }

  pause(): void {
    if (this.state !== 'recording' || !this.media) return
    this.media.pause()
    this.clock.pause()
    this.state = 'paused'
  }

  resume(): void {
    if (this.state !== 'paused' || !this.media) return
    this.media.resume()
    this.clock.resume()
    this.state = 'recording'
  }

  /** Finishes the take. Resolves once the last data has arrived. */
  stop(): Promise<Take> {
    const media = this.media
    if (this.state === 'inactive' || !media) return Promise.reject(new Error('Not recording.'))
    this.clock.pause()
    const durationMs = this.clock.elapsedMs
    return new Promise<Take>((resolve, reject) => {
      media.onstop = () => {
        const type = this.mimeType || this.chunks[0]?.type || 'audio/webm'
        const blob = new Blob(this.chunks, { type })
        this.release()
        if (blob.size === 0) reject(new Error('Nothing was recorded.'))
        else resolve({ blob, durationMs, mimeType: type })
      }
      media.onerror = () => {
        this.release()
        reject(new Error('Recording failed.'))
      }
      media.stop()
    })
  }

  /** Throws the take away and releases the mic. */
  cancel(): void {
    if (this.media) {
      this.media.ondataavailable = null
      this.media.onstop = null
      if (this.media.state !== 'inactive') this.media.stop()
    }
    this.release()
  }

  /** The current block's levels, for the meter. Zero when not recording or paused. */
  levels(): Levels {
    if (this.state !== 'recording' || !this.analyser) return { rms: 0, peak: 0, clipped: false }
    this.analyser.getFloatTimeDomainData(this.buffer)
    return measure(this.buffer)
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => {
      t.onended = null
      t.stop()
    })
    this.stream = null
    this.analyser = null
    void this.context?.close().catch(() => {})
    this.context = null
    this.media = null
    this.chunks = []
    this.state = 'inactive'
  }
}

function isComplete(d: Partial<RecorderDeps>): d is RecorderDeps {
  return Boolean(
    d.getUserMedia && d.createMediaRecorder && d.createAudioContext && d.isTypeSupported && d.now,
  )
}
