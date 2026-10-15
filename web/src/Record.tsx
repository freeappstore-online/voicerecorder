import { useEffect, useRef, useState } from 'react'
import { useToast } from '@freeappstore/sdk/ui'
import { formatDuration, library } from './lib/library.ts'
import {
  MicError,
  Recorder,
  WaveformHistory,
  meterPosition,
  micError,
  smoothLevel,
} from './lib/recorder.ts'

type Phase = 'idle' | 'starting' | 'recording' | 'paused' | 'saving'

const WAVE_BARS = 64
/** How long the "too loud" warning stays up after the last clipped block. */
const CLIP_HOLD_MS = 1500

// The Record screen: one big button to start, then pause/resume, a live meter,
// a scrolling waveform and the elapsed time. Stopping saves to the library.
export function Record({ onOpenRecordings }: { onOpenRecordings: () => void }) {
  const toast = useToast()
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<MicError | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [tooLoud, setTooLoud] = useState(false)
  const recorderRef = useRef<Recorder | null>(null)
  const meterRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const waveRef = useRef(new WaveformHistory(WAVE_BARS))

  const live = phase === 'recording' || phase === 'paused'

  // Meter and waveform: drawn straight to the DOM every frame (no re-render),
  // with frame-rate-independent smoothing so it glides rather than flickers.
  useEffect(() => {
    if (!live) return
    let frame = 0
    let last = performance.now()
    let level = 0
    let clippedAt = -Infinity
    const tick = (now: number) => {
      const dt = now - last
      last = now
      const rec = recorderRef.current
      if (rec) {
        const l = rec.levels()
        level = smoothLevel(level, meterPosition(l.peak), dt)
        if (l.clipped) clippedAt = now
        if (rec.state === 'recording') waveRef.current.push(meterPosition(l.rms), dt)
        setTooLoud(now - clippedAt < CLIP_HOLD_MS)
        setElapsed(Math.floor(rec.clock.elapsedMs / 250) * 250)
      }
      if (meterRef.current) meterRef.current.style.transform = `scaleX(${level})`
      drawWave(canvasRef.current, waveRef.current.bars)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [live])

  // Leaving the screen mid-take keeps what was recorded rather than losing it.
  useEffect(
    () => () => {
      const rec = recorderRef.current
      recorderRef.current = null
      if (rec && rec.state !== 'inactive') {
        void rec
          .stop()
          .then((take) => library().save(take))
          .catch(() => {})
      }
    },
    [],
  )

  const start = async () => {
    setError(null)
    setPhase('starting')
    try {
      const rec = new Recorder()
      recorderRef.current = rec
      waveRef.current.clear()
      setElapsed(0)
      await rec.start()
      setPhase('recording')
    } catch (err) {
      recorderRef.current = null
      setError(micError(err))
      setPhase('idle')
    }
  }

  const pauseResume = () => {
    const rec = recorderRef.current
    if (!rec) return
    if (rec.state === 'recording') {
      rec.pause()
      setPhase('paused')
    } else {
      rec.resume()
      setPhase('recording')
    }
  }

  const stop = async () => {
    const rec = recorderRef.current
    if (!rec) return
    setPhase('saving')
    try {
      const take = await rec.stop()
      recorderRef.current = null
      const saved = await library().save(take)
      toast.show(`Saved “${saved.name}”.`, { variant: 'success' })
    } catch (err) {
      recorderRef.current = null
      toast.show(err instanceof Error ? err.message : 'The recording could not be saved.', { variant: 'error' })
    } finally {
      setPhase('idle')
      setTooLoud(false)
    }
  }

  const discard = () => {
    recorderRef.current?.cancel()
    recorderRef.current = null
    setPhase('idle')
    setTooLoud(false)
    toast.show('Recording discarded.')
  }

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      {!live && phase !== 'saving' && (
        <p className="max-w-md text-[var(--muted)]">
          Tap the button to start. Your browser will ask to use the microphone the first time.
          Recordings stay on this device; nothing is uploaded.
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="w-full max-w-md rounded-[var(--radius)] border border-[var(--danger)] bg-[var(--panel)] p-4 text-left"
        >
          {error.message}
        </div>
      )}

      <div className="w-full max-w-md">
        <p className="display-font text-5xl tabular-nums" aria-live="off">
          {formatDuration(live || phase === 'saving' ? elapsed : 0)}
        </p>
        <p className="mt-1 h-5 text-sm" role="status">
          {phase === 'paused' && <span className="text-[var(--muted)]">Paused</span>}
          {phase === 'recording' && tooLoud && (
            <span className="text-[var(--warning)]">Too loud: move back from the mic a little</span>
          )}
          {phase === 'recording' && !tooLoud && <span className="text-[var(--accent)]">Recording</span>}
          {phase === 'saving' && <span className="text-[var(--muted)]">Saving…</span>}
        </p>
        <canvas
          ref={canvasRef}
          className="vr-wave mt-4 h-20 w-full"
          role="img"
          aria-label="Live waveform"
        />
        <div className="vr-meter mt-3" aria-hidden="true">
          <div ref={meterRef} className="vr-meter__fill" />
        </div>
      </div>

      {live ? (
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" className="vr-btn min-w-28" onClick={pauseResume}>
            {phase === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="vr-btn vr-btn--primary min-w-28" onClick={() => void stop()}>
            Stop &amp; save
          </button>
          <button type="button" className="vr-btn vr-btn--danger" onClick={discard}>
            Discard
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="vr-record"
          onClick={() => void start()}
          disabled={phase !== 'idle'}
          aria-label="Start recording"
        >
          <span className="vr-record__dot" />
        </button>
      )}

      <button type="button" className="text-sm underline text-[var(--muted)]" onClick={onOpenRecordings}>
        Go to your recordings
      </button>
    </div>
  )
}

/** Draws the waveform as mirrored bars, newest on the right. */
function drawWave(canvas: HTMLCanvasElement | null, bars: number[]) {
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(canvas.clientWidth * dpr)
  const h = Math.round(canvas.clientHeight * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = getComputedStyle(canvas).color
  const step = w / bars.length
  const barW = Math.max(1, step * 0.6)
  const mid = h / 2
  bars.forEach((v, i) => {
    const bh = Math.max(dpr * 2, v * h)
    ctx.fillRect(i * step + (step - barW) / 2, mid - bh / 2, barW, bh)
  })
}
