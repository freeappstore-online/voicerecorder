import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { formatDuration } from './lib/library.ts'
import { Icon } from './ui.tsx'
import {
  type EffectChain,
  type VoiceEffect,
  buildEffectChain,
  prepareBuffer,
  sourcePlaybackRate,
  tailSeconds,
} from './lib/effects.ts'

// Two players behind the same controls: a plain <audio> element for the
// original, and a Web Audio graph for playing it back through an effect.

let sharedContext: AudioContext | null = null

/**
 * The app's one AudioContext, created on first use. Call from a tap: iOS only
 * lets audio start when the context is created or resumed during a gesture.
 */
export function audioContext(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') {
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    sharedContext = new AC()
  }
  if (sharedContext.state === 'suspended') void sharedContext.resume().catch(() => {})
  return sharedContext
}

/** Decodes a recording (WebM/Opus, MP4/AAC, Ogg or WAV) to samples. */
export async function decode(blob: Blob): Promise<AudioBuffer> {
  return audioContext().decodeAudioData(await blob.arrayBuffer())
}

/** Play/pause, seek bar and time, shared by both players. */
function Transport({
  playing,
  time,
  duration,
  label,
  disabled,
  onToggle,
  onSeek,
}: {
  playing: boolean
  time: number
  duration: number
  label: string
  disabled?: boolean
  onToggle: () => void
  onSeek: (seconds: number) => void
}) {
  const shown = Math.min(time, duration)
  const progress = duration > 0 ? (shown / duration) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="vr-play"
        onClick={onToggle}
        disabled={disabled}
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
      >
        <Icon name={playing ? 'pause' : 'play'} size={22} />
      </button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          className="vr-seek"
          style={{ '--progress': `${progress}%` } as CSSProperties}
          min={0}
          max={duration || 0}
          step={0.01}
          value={shown}
          disabled={disabled}
          onChange={(e) => onSeek(Number(e.currentTarget.value))}
          aria-label={`Position in ${label}`}
          aria-valuetext={`${formatDuration(shown * 1000)} of ${formatDuration(duration * 1000)}`}
        />
        <div className="flex justify-between text-xs tabular-nums text-[var(--muted)]" aria-hidden="true">
          <span>{formatDuration(shown * 1000)}</span>
          <span>{formatDuration(duration * 1000)}</span>
        </div>
      </div>
    </div>
  )
}

// The original, through an <audio> element. MediaRecorder WebM files (Chrome)
// often report an Infinity duration, so the saved duration stands in until
// the browser knows better.
export function Player({ blob, durationMs, label }: { blob: Blob; durationMs: number; label: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(durationMs / 1000)

  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      if (audio.ended || audio.currentTime >= duration) audio.currentTime = 0
      void audio.play().catch(() => setPlaying(false))
    } else {
      audio.pause()
    }
  }

  const seek = (seconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = seconds
    setTime(seconds)
  }

  const onMetadata = () => {
    const d = audioRef.current?.duration
    if (d && Number.isFinite(d)) setDuration(d)
  }

  return (
    <>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onLoadedMetadata={onMetadata}
          onDurationChange={onMetadata}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={() => setTime(audioRef.current?.currentTime ?? 0)}
        />
      )}
      <Transport
        playing={playing}
        time={time}
        duration={duration}
        label={label}
        onToggle={toggle}
        onSeek={seek}
      />
    </>
  )
}

interface Voice {
  source: AudioBufferSourceNode
  chain: EffectChain
  /** context.currentTime when this voice started, and the output position it started from. */
  startedAt: number
  from: number
}

// The recording through an effect, live. Times shown are output time: a
// chipmunk take plays (and reads) shorter than the original.
export function EffectPlayer({
  buffer,
  effect,
  label,
}: {
  buffer: AudioBuffer | null
  effect: VoiceEffect
  label: string
}) {
  const voiceRef = useRef<Voice | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const rate = sourcePlaybackRate(effect)
  const duration = buffer ? buffer.duration / rate : 0

  // Halts the current voice. Echo and reverb are cut on a user stop, but left
  // to ring out (then cleaned up) when the take reaches its end.
  const halt = (letRing: boolean) => {
    const v = voiceRef.current
    voiceRef.current = null
    if (!v) return
    v.source.onended = null
    try {
      v.source.stop()
    } catch {
      // never started or already ended
    }
    if (letRing) setTimeout(() => v.chain.dispose(), tailSeconds(effect) * 1000 + 100)
    else v.chain.dispose()
  }

  const play = (from: number) => {
    if (!buffer) return
    halt(false)
    const ctx = audioContext()
    const source = ctx.createBufferSource()
    source.buffer = prepareBuffer(ctx, buffer, effect)
    source.playbackRate.value = rate
    const chain = buildEffectChain(ctx, effect)
    source.connect(chain.input)
    chain.output.connect(ctx.destination)
    const start = Math.max(0, Math.min(from, duration))
    // start() takes the offset in source seconds.
    source.start(0, start * rate)
    const voice: Voice = { source, chain, startedAt: ctx.currentTime, from: start }
    source.onended = () => {
      if (voiceRef.current !== voice) return
      halt(true)
      setPlaying(false)
      setTime(0)
    }
    voiceRef.current = voice
    setPlaying(true)
  }

  // Position, read from the audio clock while playing.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const v = voiceRef.current
      if (v) setTime(Math.min(duration, v.from + (v.source.context.currentTime - v.startedAt)))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, duration])

  // Switching effect mid-play carries on from the same point in the take.
  const lastEffect = useRef(effect)
  useEffect(() => {
    if (lastEffect.current === effect) return
    const prevRate = sourcePlaybackRate(lastEffect.current)
    lastEffect.current = effect
    const at = (time * prevRate) / rate // same moment in the recording
    setTime(at)
    if (voiceRef.current) play(at)
    // play and time are read at the moment the effect changes, on purpose
  }, [effect])

  // Stop when the panel closes.
  useEffect(() => () => halt(false), [])

  const toggle = () => {
    if (voiceRef.current) {
      halt(false)
      setPlaying(false)
    } else {
      // Too close to the end to hear anything: start over.
      play(time >= duration - 0.25 ? 0 : time)
    }
  }

  const seek = (seconds: number) => {
    setTime(seconds)
    if (voiceRef.current) play(seconds)
  }

  return (
    <Transport
      playing={playing}
      time={time}
      duration={duration}
      label={label}
      disabled={!buffer}
      onToggle={toggle}
      onSeek={seek}
    />
  )
}
