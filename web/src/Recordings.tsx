import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ConfirmDialog, EmptyState, Modal, Spinner, useToast } from '@freeappstore/sdk/ui'
import {
  MAX_NAME_LENGTH,
  type RecordingMeta,
  cleanName,
  extensionFor,
  formatDuration,
  formatSize,
  library,
} from './lib/library.ts'
import { shareRecording } from './lib/share.ts'
import { needsConversion, toPlayableFile } from './lib/export.ts'
import {
  type VoiceEffect,
  effectFromName,
  effectLabel,
  exportWithEffect,
  renderedLength,
} from './lib/effects.ts'
import { spokenDuration } from './lib/a11y.ts'
import { EffectPlayer, Player, decode } from './Player.tsx'
import { EffectPicker, Icon } from './ui.tsx'

// The Recordings screen: every saved recording, newest first. Tap one to open
// its player, effects and actions (export, share, rename, delete).
export function Recordings() {
  const toast = useToast()
  const [items, setItems] = useState<RecordingMeta[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<RecordingMeta | null>(null)
  const [deleting, setDeleting] = useState<RecordingMeta | null>(null)
  const rowButtons = useRef(new Map<string, HTMLButtonElement>())
  const headingRef = useRef<HTMLHeadingElement>(null)
  const emptyRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<string | 'heading' | null>(null)

  const reload = useCallback(async () => {
    try {
      setItems(await library().list())
      setLoadError(null)
    } catch (err) {
      setLoadError(message(err, 'Your recordings could not be loaded.'))
    }
  }, [])

  // Load now, and again whenever a recording is saved, renamed or deleted
  // (the Record screen can finish saving after this one has opened).
  useEffect(() => {
    void reload()
    const lib = library()
    const onChange = () => void reload()
    lib.addEventListener('change', onChange)
    return () => lib.removeEventListener('change', onChange)
  }, [reload])

  // Focus moves after the list re-renders: dialogs close first, rows go away.
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    const el =
      target === 'heading' ? (headingRef.current ?? emptyRef.current) : (rowButtons.current.get(target) ?? headingRef.current)
    requestAnimationFrame(() => el?.focus())
  })
  const focusSoon = (target: string | 'heading') => {
    pendingFocus.current = target
  }

  const confirmDelete = async () => {
    const target = deleting
    setDeleting(null)
    if (!target || !items) return
    // Where focus lands afterwards: the next row, else the previous, else the heading.
    const i = items.findIndex((r) => r.id === target.id)
    const neighbour = items[i + 1] ?? items[i - 1]
    try {
      await library().remove(target.id)
      if (openId === target.id) setOpenId(null)
      focusSoon(neighbour ? neighbour.id : 'heading')
      setItems((list) => list?.filter((r) => r.id !== target.id) ?? null)
      toast.show(`Deleted “${target.name}”.`, { variant: 'success' })
    } catch (err) {
      focusSoon(target.id)
      toast.show(message(err, 'That recording could not be deleted.'), { variant: 'error' })
    }
  }

  if (loadError) {
    return (
      <div role="alert" className="vr-alert">
        <Icon name="info" />
        <div>
          <p>{loadError}</p>
          <button type="button" className="vr-btn mt-3" onClick={() => void reload()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!items) {
    return (
      <div className="flex justify-center p-8" role="status" aria-label="Loading recordings">
        <Spinner />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div ref={emptyRef} tabIndex={-1} className="vr-empty">
        <EmptyState
          icon={<Icon name="mic" size={32} />}
          title="No recordings yet"
          message="Recordings you make are kept here, on this device only."
        />
      </div>
    )
  }

  const totalBytes = items.reduce((sum, r) => sum + r.size, 0)

  return (
    <>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold">
          {items.length === 1 ? '1 recording' : `${items.length} recordings`}
        </h2>
        <p className="text-sm text-[var(--muted)]">{formatSize(totalBytes)} on this device</p>
      </div>
      <ul className="flex flex-col gap-3" aria-label="Recordings">
        {items.map((rec) => (
          <RecordingItem
            key={rec.id}
            rec={rec}
            open={openId === rec.id}
            buttonRef={(el) => {
              if (el) rowButtons.current.set(rec.id, el)
              else rowButtons.current.delete(rec.id)
            }}
            onToggle={() => setOpenId((id) => (id === rec.id ? null : rec.id))}
            onRename={() => setRenaming(rec)}
            onDelete={() => setDeleting(rec)}
          />
        ))}
      </ul>

      <RenameDialog
        rec={renaming}
        onClose={() => {
          if (renaming) focusSoon(renaming.id)
          setRenaming(null)
        }}
        onRenamed={(updated) => {
          focusSoon(updated.id)
          setItems((list) => list?.map((r) => (r.id === updated.id ? updated : r)) ?? null)
          setRenaming(null)
          toast.show(`Renamed to “${updated.name}”.`, { variant: 'success' })
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete recording?"
        message={deleting ? `“${deleting.name}” will be removed from this device. This can't be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (deleting) focusSoon(deleting.id)
          setDeleting(null)
        }}
      />
    </>
  )
}

function RecordingItem({
  rec,
  open,
  buttonRef,
  onToggle,
  onRename,
  onDelete,
}: {
  rec: RecordingMeta
  open: boolean
  buttonRef: (el: HTMLButtonElement | null) => void
  onToggle: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const panelId = `rec-${rec.id}`
  const made = effectFromName(rec.name)
  const date = new Date(rec.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const format = extensionFor(rec.mimeType).toUpperCase()
  return (
    <li className="vr-card" data-open={open || undefined}>
      <button
        ref={buttonRef}
        type="button"
        className="vr-card__head"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onToggle}
      >
        <span className="vr-card__icon" data-kind={made ? 'effect' : 'original'} aria-hidden="true">
          <Icon name={made ? 'sparkle' : 'wave'} size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{rec.name}</span>
          <span className="vr-card__meta">
            {made && <span className="vr-tag">{effectLabel(made)}</span>}
            <span>{date}</span>
            <span aria-hidden="true">·</span>
            <span>
              {format}, {formatSize(rec.size)}
            </span>
          </span>
        </span>
        <span className="vr-card__duration">
          <span className="vr-sr-only">Length </span>
          <span aria-hidden="true">{formatDuration(rec.durationMs)}</span>
          <span className="vr-sr-only">{spokenDuration(rec.durationMs)}</span>
        </span>
        <Icon name="chevron" className="vr-card__chevron" />
      </button>
      {open && (
        <div id={panelId} className="vr-card__panel">
          <RecordingPanel rec={rec} onRename={onRename} onDelete={onDelete} />
        </div>
      )}
    </li>
  )
}

// Player, effects and actions for an opened recording. The audio is loaded
// once, when the panel opens, so Share can hand it to the share sheet without
// waiting on the database (Safari only shares during the tap itself). It's
// decoded to samples only when an effect is first picked.
function RecordingPanel({
  rec,
  onRename,
  onDelete,
}: {
  rec: RecordingMeta
  onRename: () => void
  onDelete: () => void
}) {
  const toast = useToast()
  const fxLabelId = useId()
  const shareNoteId = useId()
  const [blob, setBlob] = useState<Blob | null>(null)
  const [failed, setFailed] = useState(false)
  const [effect, setEffect] = useState<VoiceEffect>('none')
  const [decoded, setDecoded] = useState<AudioBuffer | null>(null)
  const [decoding, setDecoding] = useState<Promise<AudioBuffer> | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let live = true
    library()
      .audio(rec.id)
      .then((b) => {
        if (!live) return
        if (b) setBlob(b)
        else setFailed(true)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [rec.id])

  // Decodes once, on demand. Called from a tap, so iOS lets audio start.
  const samples = (): Promise<AudioBuffer> => {
    if (decoded) return Promise.resolve(decoded)
    if (decoding) return decoding
    if (!blob) return Promise.reject(new Error('The audio is still loading.'))
    const p = decode(blob)
    setDecoding(p)
    p.then(setDecoded, () => setDecoding(null))
    return p
  }

  const pick = (next: VoiceEffect) => {
    setEffect(next)
    if (next !== 'none') {
      samples().catch(() => toast.show("This recording couldn't be opened for effects.", { variant: 'error' }))
    }
  }

  const exportEffect = async () => {
    if (effect === 'none') return
    setExporting(true)
    try {
      const buffer = await samples()
      const wav = await exportWithEffect(buffer, effect)
      const durationMs = (renderedLength(buffer.length, buffer.sampleRate, effect) / buffer.sampleRate) * 1000
      const suffix = ` [${effectLabel(effect)}]`
      const saved = await library().save({
        blob: wav,
        durationMs,
        name: rec.name.slice(0, MAX_NAME_LENGTH - suffix.length).trim() + suffix,
      })
      toast.show(`Saved “${saved.name}” to your recordings.`, { variant: 'success' })
    } catch (err) {
      toast.show(message(err, "The effect couldn't be exported."), { variant: 'error' })
    } finally {
      setExporting(false)
    }
  }

  // The file Share sends, prepared as soon as the audio is loaded: WebM/Ogg
  // need converting to WAV, and Safari won't wait for that once tapped.
  const converts = needsConversion(rec.mimeType)
  const playable = useMemo(() => {
    if (!blob) return null
    const p = toPlayableFile({ blob, mimeType: rec.mimeType, name: rec.name })
    p.catch(() => {}) // reported when Share is tapped
    return p
  }, [blob, rec.mimeType, rec.name])

  const share = async () => {
    if (!blob || !playable) return
    try {
      const outcome = await shareRecording({ blob, mimeType: rec.mimeType, name: rec.name }, { file: playable })
      if (outcome === 'downloaded') {
        const file = await playable
        toast.show(`Downloaded ${file.name}.`, { variant: 'success' })
      }
    } catch (err) {
      toast.show(message(err, 'That recording could not be shared.'), { variant: 'error' })
    }
  }

  return (
    <>
      {failed ? (
        <p role="alert" className="text-[var(--danger)]">
          This recording's audio could not be loaded.
        </p>
      ) : blob ? (
        effect === 'none' ? (
          <Player blob={blob} durationMs={rec.durationMs} label={rec.name} />
        ) : (
          <EffectPlayer buffer={decoded} effect={effect} label={`${rec.name} as ${effectLabel(effect)}`} />
        )
      ) : (
        <div className="flex justify-center p-2" role="status" aria-label="Loading audio">
          <Spinner size={20} />
        </div>
      )}

      <div className="mt-4">
        <p id={fxLabelId} className="vr-label">
          Voice effect
        </p>
        <EffectPicker value={effect} onChange={pick} disabled={!blob || failed} labelId={fxLabelId} />
        <p className="vr-hint mt-2">
          {effect === 'none'
            ? 'Pick an effect to hear it. Changing effect while playing carries on from the same spot.'
            : `Playing as ${effectLabel(effect)}. Export saves it as a new recording.`}
        </p>
      </div>

      <div className="vr-actions">
        {effect !== 'none' && (
          <button
            type="button"
            className="vr-btn vr-btn--primary"
            onClick={() => void exportEffect()}
            disabled={exporting || !blob}
            aria-busy={exporting || undefined}
          >
            {exporting ? <Spinner size={16} color="currentColor" /> : <Icon name="sparkle" size={18} />}
            {exporting ? 'Exporting…' : `Export as ${effectLabel(effect)}`}
          </button>
        )}
        <button
          type="button"
          className="vr-btn"
          onClick={() => void share()}
          disabled={!blob}
          aria-describedby={converts ? shareNoteId : undefined}
        >
          <Icon name="share" size={18} />
          Share
        </button>
        <button type="button" className="vr-btn" onClick={onRename}>
          <Icon name="pencil" size={18} />
          Rename
        </button>
        <button type="button" className="vr-btn vr-btn--danger" onClick={onDelete}>
          <Icon name="trash" size={18} />
          Delete
        </button>
      </div>
      {converts && (
        <p id={shareNoteId} className="vr-hint mt-2">
          Shared as a WAV file, so it plays on iPhone, in Chrome and in desktop players.
        </p>
      )}
    </>
  )
}

function RenameDialog({
  rec,
  onClose,
  onRenamed,
}: {
  rec: RecordingMeta | null
  onClose: () => void
  onRenamed: (updated: RecordingMeta) => void
}) {
  const toast = useToast()
  const inputId = useId()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (rec) setName(rec.name)
  }, [rec])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!rec || !cleanName(name)) return
    setSaving(true)
    try {
      onRenamed(await library().rename(rec.id, name))
    } catch (err) {
      toast.show(message(err, 'That recording could not be renamed.'), { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={rec !== null} onClose={onClose} title="Rename recording">
      <form onSubmit={(e) => void submit(e)}>
        <label htmlFor={inputId} className="vr-label">
          Name
        </label>
        <input
          id={inputId}
          className="vr-input w-full"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(e) => setName(e.currentTarget.value)}
          onFocus={(e) => e.currentTarget.select()}
          autoFocus
          enterKeyHint="done"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="vr-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="vr-btn vr-btn--primary" disabled={saving || !cleanName(name)}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}
