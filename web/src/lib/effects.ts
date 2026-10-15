// Voice effects, built from Web Audio nodes. The same chain drives live
// playback (an AudioContext) and export (an OfflineAudioContext), so what
// you hear is what you get in the file.
//
// Pitch effects work the classic tape way: the source plays faster or slower
// (`sourcePlaybackRate`), which shifts pitch and speed together. Reverse
// flips the buffer before it plays (`prepareBuffer`).
//
// No DOM here: only Web Audio types, so tests can run against a real
// OfflineAudioContext in Node.

export type VoiceEffect = 'none' | 'pitch-up' | 'pitch-down' | 'robot' | 'echo' | 'reverb' | 'radio' | 'reverse'

export const EFFECTS: readonly { id: VoiceEffect; label: string }[] = [
  { id: 'none', label: 'Original' },
  { id: 'pitch-up', label: 'Chipmunk' },
  { id: 'pitch-down', label: 'Deep' },
  { id: 'robot', label: 'Robot' },
  { id: 'echo', label: 'Echo' },
  { id: 'reverb', label: 'Reverb' },
  { id: 'radio', label: 'Radio' },
  { id: 'reverse', label: 'Reverse' },
]

export function effectLabel(effect: VoiceEffect): string {
  return EFFECTS.find((e) => e.id === effect)?.label ?? effect
}

export interface EffectChain {
  input: AudioNode
  output: AudioNode
  /** Stops anything the chain runs on its own (the robot's oscillator) and disconnects it. */
  dispose: () => void
}

/** Playback rate for the source: pitch effects shift pitch (and speed) by playing faster or slower. */
export function sourcePlaybackRate(effect: VoiceEffect): number {
  switch (effect) {
    case 'pitch-up':
      return 1.5
    case 'pitch-down':
      return 0.7
    default:
      return 1
  }
}

/** Seconds of sound an effect adds after the input ends (echo and reverb ring on). */
export function tailSeconds(effect: VoiceEffect): number {
  switch (effect) {
    case 'echo':
      // Feedback 0.4 every 0.3 s falls below −60 dB after ~7.5 repeats.
      return ECHO_DELAY * Math.ceil(Math.log(0.001) / Math.log(ECHO_FEEDBACK))
    case 'reverb':
      return REVERB_SECONDS
    default:
      return 0
  }
}

/** Highest level effects ever output, live or exported. */
export const EXPORT_PEAK = 0.98

const ECHO_DELAY = 0.3
const ECHO_FEEDBACK = 0.4
const REVERB_SECONDS = 2
const ROBOT_HZ = 50

/**
 * Builds the node graph for an effect. Connect your source to `input` and
 * `output` to the destination. Effects that add energy (robot, echo, reverb,
 * radio) end in a limiter so they can't clip live; the others only move or
 * reorder samples, so they're left untouched.
 */
export function buildEffectChain(ctx: BaseAudioContext, effect: VoiceEffect): EffectChain {
  const input = ctx.createGain()
  const nodes: AudioNode[] = [input]
  const scheduled: AudioScheduledSourceNode[] = []
  let out: AudioNode = input

  const add = <T extends AudioNode>(node: T): T => {
    nodes.push(node)
    return node
  }

  switch (effect) {
    case 'none':
    case 'pitch-up':
    case 'pitch-down':
    case 'reverse':
      break

    case 'robot': {
      // Ring modulation: the voice's gain swings with a 50 Hz sine, which
      // gives the metallic, buzzing robot timbre.
      const ring = add(ctx.createGain())
      ring.gain.value = 0
      const osc = add(ctx.createOscillator())
      osc.type = 'sine'
      osc.frequency.value = ROBOT_HZ
      osc.connect(ring.gain)
      osc.start(0)
      scheduled.push(osc)
      input.connect(ring)
      // A touch of the dry voice keeps words intelligible.
      const dry = add(ctx.createGain())
      dry.gain.value = 0.25
      input.connect(dry)
      const mix = add(ctx.createGain())
      mix.gain.value = 0.8
      ring.connect(mix)
      dry.connect(mix)
      out = mix
      break
    }

    case 'echo': {
      const delay = add(ctx.createDelay(1))
      delay.delayTime.value = ECHO_DELAY
      const feedback = add(ctx.createGain())
      feedback.gain.value = ECHO_FEEDBACK
      const wet = add(ctx.createGain())
      wet.gain.value = 0.6
      const mix = add(ctx.createGain())
      input.connect(mix)
      input.connect(delay)
      delay.connect(feedback)
      feedback.connect(delay)
      delay.connect(wet)
      wet.connect(mix)
      out = mix
      break
    }

    case 'reverb': {
      const conv = add(ctx.createConvolver())
      conv.buffer = createReverbImpulse(ctx, REVERB_SECONDS, 2)
      const wet = add(ctx.createGain())
      wet.gain.value = 0.5
      const dry = add(ctx.createGain())
      dry.gain.value = 0.8
      const mix = add(ctx.createGain())
      input.connect(conv)
      conv.connect(wet)
      wet.connect(mix)
      input.connect(dry)
      dry.connect(mix)
      out = mix
      break
    }

    case 'radio': {
      // Telephone band (300 Hz – 3 kHz) plus a little tube-ish drive.
      const hp = add(ctx.createBiquadFilter())
      hp.type = 'highpass'
      hp.frequency.value = 300
      hp.Q.value = 0.7
      const lp = add(ctx.createBiquadFilter())
      lp.type = 'lowpass'
      lp.frequency.value = 3000
      lp.Q.value = 0.7
      const shaper = add(ctx.createWaveShaper())
      shaper.curve = driveCurve(2.5)
      shaper.oversample = '2x'
      const level = add(ctx.createGain())
      level.gain.value = 1.4 // band-limiting takes out a lot of energy
      input.connect(hp)
      hp.connect(lp)
      lp.connect(shaper)
      shaper.connect(level)
      out = level
      break
    }
  }

  if (ADDS_ENERGY.has(effect)) {
    const comp = add(compressor(ctx))
    const safety = add(ctx.createWaveShaper())
    safety.curve = safetyCurve()
    out.connect(comp)
    comp.connect(safety)
    out = safety
  }

  return {
    input,
    output: out,
    dispose: () => {
      for (const s of scheduled) {
        try {
          s.stop()
        } catch {
          // already stopped
        }
      }
      for (const n of nodes) n.disconnect()
    },
  }
}

const ADDS_ENERGY: ReadonlySet<VoiceEffect> = new Set(['robot', 'echo', 'reverb', 'radio'])

/** Fast, hard compression near full scale: tames peaks before the safety curve has to. */
function compressor(ctx: BaseAudioContext): DynamicsCompressorNode {
  const c = ctx.createDynamicsCompressor()
  c.threshold.value = -3
  c.knee.value = 0
  c.ratio.value = 20
  c.attack.value = 0.002
  c.release.value = 0.1
  return c
}

/**
 * The limiter's last stage: a WaveShaper curve that is a straight line up to
 * 0.7, then bends smoothly toward a ceiling of 0.98. A WaveShaper can't
 * output more than its curve's largest value, so this stage never clips,
 * whatever the compressor (and its automatic make-up gain) lets through.
 */
export function safetyCurve(knee = 0.7, ceiling = EXPORT_PEAK, size = 4096): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size)
  const room = ceiling - knee
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1
    const a = Math.abs(x)
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room)
    curve[i] = Math.sign(x) * y
  }
  return curve
}


/** Soft-clipping curve (tanh, normalised so ±1 maps to ±1). */
export function driveCurve(amount: number, size = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size)
  const norm = Math.tanh(amount)
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1
    curve[i] = Math.tanh(amount * x) / norm
  }
  return curve
}

/**
 * A synthetic room: stereo white noise with an exponential decay. Fixed seed,
 * so the same room every time (and in tests).
 */
export function createReverbImpulse(ctx: BaseAudioContext, duration = 2, decay = 2): AudioBuffer {
  const rate = ctx.sampleRate
  const length = Math.max(1, Math.round(rate * duration))
  const impulse = ctx.createBuffer(2, length, rate)
  let seed = 0x9e3779b9
  const random = () => {
    // xorshift32
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return ((seed >>> 0) / 0xffffffff) * 2 - 1
  }
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch)
    for (let i = 0; i < length; i++) data[i] = random() * Math.pow(1 - i / length, decay)
  }
  return impulse
}

/** The buffer the source should play: a reversed copy for 'reverse', otherwise the original. */
export function prepareBuffer(ctx: BaseAudioContext, buffer: AudioBuffer, effect: VoiceEffect): AudioBuffer {
  if (effect !== 'reverse') return buffer
  const copy = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = new Float32Array(buffer.length)
    buffer.copyFromChannel(data, ch)
    data.reverse()
    copy.copyToChannel(data, ch)
  }
  return copy
}

// ---------------------------------------------------------------------------
// Export

export type OfflineContextFactory = (channels: number, length: number, sampleRate: number) => OfflineAudioContext

const defaultOffline: OfflineContextFactory = (c, l, r) => new OfflineAudioContext(c, l, r)

/** Frames an export of `frames` input frames will have: resampled by the pitch rate, plus the tail. */
export function renderedLength(frames: number, sampleRate: number, effect: VoiceEffect): number {
  return Math.max(1, Math.ceil(frames / sourcePlaybackRate(effect) + tailSeconds(effect) * sampleRate))
}

/** Renders the effect over the whole buffer, offline. */
export async function renderWithEffect(
  buffer: AudioBuffer,
  effect: VoiceEffect,
  createContext: OfflineContextFactory = defaultOffline,
): Promise<AudioBuffer> {
  const rate = sourcePlaybackRate(effect)
  const length = renderedLength(buffer.length, buffer.sampleRate, effect)
  const ctx = createContext(buffer.numberOfChannels, length, buffer.sampleRate)
  const source = ctx.createBufferSource()
  source.buffer = prepareBuffer(ctx, buffer, effect)
  source.playbackRate.value = rate
  const chain = buildEffectChain(ctx, effect)
  source.connect(chain.input)
  chain.output.connect(ctx.destination)
  source.start(0)
  return ctx.startRendering()
}

/** Renders the effect and encodes it as a WAV file, which every media player opens. */
export async function exportWithEffect(
  buffer: AudioBuffer,
  effect: VoiceEffect,
  createContext: OfflineContextFactory = defaultOffline,
): Promise<Blob> {
  const rendered = await renderWithEffect(buffer, effect, createContext)
  return encodeWav(channelsOf(rendered), rendered.sampleRate)
}

/** Copies of each channel's samples (copies, so they outlive the buffer). */
function channelsOf(buffer: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = []
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = new Float32Array(buffer.length)
    buffer.copyFromChannel(data, ch)
    out.push(data)
  }
  return out
}


/**
 * Encodes PCM as a 16-bit WAV (44-byte RIFF header, interleaved samples).
 * If the peak is above EXPORT_PEAK the whole thing is scaled down to it, so
 * nothing clips; quieter audio is left alone.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const numCh = Math.max(1, channels.length)
  const frames = channels[0]?.length ?? 0
  let peak = 0
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i])
      if (a > peak) peak = a
    }
  }
  const gain = peak > EXPORT_PEAK ? EXPORT_PEAK / peak : 1

  const bytesPerSample = 2
  const dataSize = frames * numCh * bytesPerSample
  const view = new DataView(new ArrayBuffer(44 + dataSize))
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numCh, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numCh * bytesPerSample, true) // byte rate
  view.setUint16(32, numCh * bytesPerSample, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const raw = channels[ch]?.[i] ?? 0
      const s = Math.max(-1, Math.min(1, (Number.isFinite(raw) ? raw : 0) * gain))
      view.setInt16(offset, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true)
      offset += 2
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' })
}
