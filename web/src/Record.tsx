import { useEffect, useId, useRef, useState } from 'react'
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
import { LevelAnnouncer, levelWord, spokenDuration, timeMarkDue } from './lib/a11y.ts'
import { holdScreenOn } from './lib/wakelock.ts'
import { Icon, SrOnly } from './ui.tsx'

type Phase = 'idle' | 'starting' | 'recording' | 'paused' | 'saving'

const WAVE_BARS = 56
/** How long the "too loud" warning stays up after the last clipped block. */
const CLIP_HOLD_MS = 1500
/** How often the meter's accessible value is refreshed (it's read on demand, not announced). */
const METER_ARIA_MS = 500
const SPOKEN_UPDATES_KEY = 'voicerecorder.spokenUpdates'

// The Record screen: one big button to start, then a stage with the elapsed
// time, a scrolling waveform and a level meter, and controls to pause, stop
// and save, or discard. Stopping saves to the library. Laid out to fit the
// viewport without scrolling, from a small phone in landscape up (vr.css).
export function Record({ navigate }: { navigate: (href: string) => void }) {
  const toast = useToast()
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<MicError | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [tooLoud, setTooLoud] = useState(false)
  const [announcement, setAnnouncement] = useState({ text: '', n: 0 })
  const [spoken, setSpoken] = useState(() => readFlag(SPOKEN_UPDATES_KEY))
  const recorderRef = useRef<Recorder | null>(null)
  const releaseScreenRef = useRef<() => void>(() => {})
  const meterRef = useRef<HTMLDivElement>(null)
  const meterFillRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const waveRef = useRef(new WaveformHistory(WAVE_BARS))
  const spokenRef = useRef(spoken)
  const stopRef = useRef<(reason?: string) => void>(() => {})
  const ids = { note: useId(), spokenHint: useId(), more: useId() }
  const [more, setMore] = useState(false)

  const live = phase === 'recording' || phase === 'paused'
  const say = (text: string) => setAnnouncement((a) => ({ text, n: a.n + 1 }))

  useEffect(() => {
    spokenRef.current = spoken
    writeFlag(SPOKEN_UPDATES_KEY, spoken)
  }, [spoken])

  // Meter and waveform: drawn straight to the DOM every frame (no re-render),
  // with frame-rate-independent smoothing so it glides rather than flickers.
  useEffect(() => {
    if (!live) return
    let frame = 0
    let last = performance.now()
    let level = 0
    let clippedAt = -Infinity
    let ariaAt = 0
    let timeMark = 0
    const levels = new LevelAnnouncer()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      const rec = recorderRef.current
      if (rec) {
        const l = rec.levels()
        level = smoothLevel(level, meterPosition(l.peak), dt)
        if (l.clipped) clippedAt = now
        const loud = now - clippedAt < CLIP_HOLD_MS
        if (rec.state === 'recording') waveRef.current.push(meterPosition(l.rms), dt)
        setTooLoud(loud)
        setElapsed(Math.floor(rec.clock.elapsedMs / 250) * 250)

        const word = levelWord(level, loud)
        if (now - ariaAt > METER_ARIA_MS && meterRef.current) {
          ariaAt = now
          meterRef.current.setAttribute('aria-valuenow', String(Math.round(level * 100)))
          meterRef.current.setAttribute('aria-valuetext', `Level: ${word}`)
        }
        if (spokenRef.current && rec.state === 'recording') {
          const mark = timeMarkDue(rec.clock.elapsedMs, timeMark)
          const levelNow = levels.update(word, now)
          if (mark !== null) {
            timeMark = mark
            say(spokenDuration(mark))
          } else if (levelNow) {
            say(`Level: ${levelNow}`)
          }
        }
      }
      if (meterFillRef.current) meterFillRef.current.style.clipPath = `inset(0 ${(1 - level) * 100}% 0 0)`
      drawWave(canvasRef.current, waveRef.current.bars)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [live])

  // At rest the stage shows the last take's waveform (or a flat line).
  useEffect(() => {
    if (!live) drawWave(canvasRef.current, waveRef.current.bars)
  }, [live])

  // Leaving the screen mid-take keeps what was recorded rather than losing it.
  useEffect(
    () => () => {
      releaseScreenRef.current()
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
      // iOS ends the take when the screen locks or the app is backgrounded:
      // keep what was recorded and say why it stopped.
      rec.onInterrupted = () =>
        stopRef.current('Recording stopped because the microphone was interrupted (screen locked, app switched, or a call).')
      waveRef.current.clear()
      setElapsed(0)
      await rec.start()
      releaseScreenRef.current = holdScreenOn()
      setPhase('recording')
      say('Recording')
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
      say(`Paused at ${spokenDuration(rec.clock.elapsedMs)}`)
    } else {
      rec.resume()
      setPhase('recording')
      say('Recording resumed')
    }
  }

  const stop = async (reason?: string) => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') return
    setPhase('saving')
    releaseScreenRef.current()
    try {
      const take = await rec.stop()
      recorderRef.current = null
      const saved = await library().save(take)
      const done = `Saved “${saved.name}”, ${spokenDuration(take.durationMs)}.`
      toast.show(reason ? `${reason} ${done}` : done, { variant: reason ? 'info' : 'success' })
      say(reason ? `${reason} ${done}` : done)
    } catch (err) {
      recorderRef.current = null
      const msg = err instanceof Error ? err.message : 'The recording could not be saved.'
      toast.show(msg, { variant: 'error' })
      say(msg)
    } finally {
      setPhase('idle')
      setTooLoud(false)
    }
  }
  stopRef.current = (reason) => void stop(reason)

  const discard = () => {
    releaseScreenRef.current()
    recorderRef.current?.cancel()
    recorderRef.current = null
    setPhase('idle')
    setTooLoud(false)
    toast.show('Recording discarded.')
    say('Recording discarded')
  }

  const status =
    phase === 'recording' ? 'Recording' : phase === 'paused' ? 'Paused' : phase === 'saving' ? 'Saving…' : phase === 'starting' ? 'Starting…' : 'Ready'

  return (
    <div className="vr-rec">
      {error && (
        <div role="alert" className="vr-alert vr-rec__full">
          <Icon name="info" />
          <p>{error.message}</p>
        </div>
      )}

      <section className="vr-stage" aria-label="Recording">
        <div className="flex items-center justify-between gap-3">
          <span className="vr-pill" data-phase={phase}>
            <span className="vr-pill__dot" aria-hidden="true" />
            {status}
          </span>
          <span className="text-xs text-[var(--muted)]">On this device only</span>
        </div>

        <p role="timer" aria-label="Elapsed time" className="display-font vr-timer">
          {formatDuration(live || phase === 'saving' ? elapsed : 0)}
        </p>

        <canvas ref={canvasRef} className="vr-wave" data-live={live} aria-hidden="true" />

        <div
          ref={meterRef}
          role="meter"
          aria-label="Input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          aria-valuetext="Level: silent"
          className="vr-meter"
        >
          <div ref={meterFillRef} className="vr-meter__fill" />
        </div>

        <p className="vr-hint vr-stage__hint" data-tone={tooLoud && phase === 'recording' ? 'warning' : undefined}>
          {tooLoud && phase === 'recording'
            ? 'Too loud: move back from the mic a little.'
            : live
              ? 'Speak normally; the meter should sit in the green.'
              : 'Your browser asks for the mic the first time.'}
        </p>
      </section>

      <div className="vr-rec__side">
        {live || phase === 'saving' ? (
          <div className="vr-controls" role="group" aria-label="Recording controls">
            <button type="button" className="vr-round" onClick={pauseResume} disabled={phase === 'saving'}>
              <span className="vr-round__face">
                <Icon name={phase === 'paused' ? 'resume' : 'pause'} size={24} />
              </span>
              {phase === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              className="vr-record"
              data-live={phase}
              onClick={() => void stop()}
              disabled={phase === 'saving'}
            >
              <span className="vr-record__face">
                <Icon name="stop" size={36} />
              </span>
              Stop &amp; save
            </button>
            <button type="button" className="vr-round vr-round--danger" onClick={discard} disabled={phase === 'saving'}>
              <span className="vr-round__face">
                <Icon name="trash" size={22} />
              </span>
              Discard
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="vr-record"
            onClick={() => void start()}
            disabled={phase !== 'idle'}
            aria-describedby={ids.note}
          >
            <span className="vr-record__face">
              <Icon name="mic" size={40} />
            </span>
            {phase === 'starting' ? 'Starting…' : 'Record'}
          </button>
        )}

        <div className="vr-fineprint">
          <p>
            <Icon name="lock" size={16} />
            <span>
              Audio stays on your device.{' '}
              <button type="button" className="vr-inline-link" onClick={() => navigate('/about')}>
                Privacy
              </button>
            </span>
          </p>
          <p role="note" id={ids.note}>
            <Icon name="info" size={16} />
            <span>
              On iPhone and iPad, recording stops if the screen locks.{' '}
              <button
                type="button"
                className="vr-inline-link"
                aria-expanded={more}
                aria-controls={ids.more}
                onClick={() => setMore((m) => !m)}
              >
                {more ? 'Less' : 'More'}
              </button>
            </span>
          </p>
        </div>
      </div>

      {more && (
        <div id={ids.more} className="vr-more vr-rec__full">
          <p>
            Browsers on iPhone and iPad can't record in the background. Voice Recorder keeps the screen
            awake while recording where it can, and if a take is cut short, what was recorded is saved.
          </p>
          <label className="vr-toggle mt-3">
            <input
              type="checkbox"
              checked={spoken}
              onChange={(e) => setSpoken(e.currentTarget.checked)}
              aria-describedby={ids.spokenHint}
            />
            <span>Speak time and level while recording</span>
          </label>
          <p id={ids.spokenHint} className="vr-hint mt-1 pl-8">
            For screen readers: every 30 seconds, and when the level changes. Use headphones, or the
            microphone may record the speech.
          </p>
          <button type="button" className="vr-link mt-2" onClick={() => navigate('/recordings')}>
            <Icon name="list" size={18} />
            Go to your recordings
          </button>
        </div>
      )}

      <SrOnly live="polite">
        {announcement.text}
        {announcement.n % 2 ? ' ' : ''}
      </SrOnly>
    </div>
  )
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    // private mode: the setting just won't stick
  }
}

/** Draws the waveform as rounded, mirrored bars, newest on the right, fading in from the left. */
function drawWave(canvas: HTMLCanvasElement | null, bars: number[]) {
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(canvas.clientWidth * dpr)
  const h = Math.round(canvas.clientHeight * dpr)
  if (!w || !h) return
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = getComputedStyle(canvas).color
  const step = w / bars.length
  const barW = Math.max(dpr * 2, step * 0.55)
  const mid = h / 2
  bars.forEach((v, i) => {
    const bh = Math.max(barW, v * h * 0.95)
    ctx.globalAlpha = 0.25 + 0.75 * (i / bars.length)
    const x = i * step + (step - barW) / 2
    const y = mid - bh / 2
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(x, y, barW, bh, barW / 2)
    else ctx.rect(x, y, barW, bh)
    ctx.fill()
  })
  ctx.globalAlpha = 1
}
