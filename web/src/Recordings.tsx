import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { ConfirmDialog, EmptyState, Modal, Spinner, useToast } from '@freeappstore/sdk/ui'
import {
  MAX_NAME_LENGTH,
  type RecordingMeta,
  cleanName,
  fileNameFor,
  formatDuration,
  formatSize,
  library,
} from './lib/library.ts'
import { shareOrDownload } from './lib/share.ts'
import { EFFECTS, type VoiceEffect, effectLabel, exportWithEffect, renderedLength } from './lib/effects.ts'
import { EffectPlayer, Player, decode } from './Player.tsx'

// The Recordings screen: every saved recording, newest first. Tap one to open
// its player and actions (rename, share or download, delete).
export function Recordings() {
  const toast = useToast()
  const [items, setItems] = useState<RecordingMeta[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<RecordingMeta | null>(null)
  const [deleting, setDeleting] = useState<RecordingMeta | null>(null)

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

  const confirmDelete = async () => {
    const target = deleting
    setDeleting(null)
    if (!target) return
    try {
      await library().remove(target.id)
      if (openId === target.id) setOpenId(null)
      setItems((list) => list?.filter((r) => r.id !== target.id) ?? null)
      toast.show(`Deleted “${target.name}”.`, { variant: 'success' })
    } catch (err) {
      toast.show(message(err, 'That recording could not be deleted.'), { variant: 'error' })
    }
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4">
        <p>{loadError}</p>
        <button type="button" className="vr-btn mt-3" onClick={() => void reload()}>
          Try again
        </button>
      </div>
    )
  }

  if (!items) {
    return (
      <div className="flex justify-center p-8" aria-label="Loading recordings">
        <Spinner />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No recordings yet"
        message="Recordings you make are kept here, on this device only."
      />
    )
  }

  return (
    <>
      <p className="mb-3 text-sm text-[var(--muted)]">
        {items.length === 1 ? '1 recording' : `${items.length} recordings`}, stored on this device only.
      </p>
      <ul className="flex flex-col gap-3">
        {items.map((rec) => (
          <RecordingItem
            key={rec.id}
            rec={rec}
            open={openId === rec.id}
            onToggle={() => setOpenId((id) => (id === rec.id ? null : rec.id))}
            onRename={() => setRenaming(rec)}
            onDelete={() => setDeleting(rec)}
          />
        ))}
      </ul>

      <RenameDialog
        rec={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={(updated) => {
          setItems((list) => list?.map((r) => (r.id === updated.id ? updated : r)) ?? null)
          setRenaming(null)
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete recording?"
        message={deleting ? `“${deleting.name}” will be removed from this device. This can't be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function RecordingItem({
  rec,
  open,
  onToggle,
  onRename,
  onDelete,
}: {
  rec: RecordingMeta
  open: boolean
  onToggle: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const panelId = `rec-${rec.id}`
  const date = new Date(rec.createdAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  return (
    <li className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]">
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius)] p-4 text-left"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{rec.name}</span>
          <span className="block text-sm text-[var(--muted)]">
            {date} · {formatSize(rec.size)}
          </span>
        </span>
        <span className="tabular-nums text-[var(--muted)]">{formatDuration(rec.durationMs)}</span>
      </button>
      {open && (
        <div id={panelId} className="border-t border-[var(--line)] p-4">
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
      samples().catch(() =>
        toast.show("This recording couldn't be opened for effects.", { variant: 'error' }),
      )
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
      toast.show(`Saved “${saved.name}”.`, { variant: 'success' })
    } catch (err) {
      toast.show(message(err, "The effect couldn't be exported."), { variant: 'error' })
    } finally {
      setExporting(false)
    }
  }

  const share = async () => {
    if (!blob) return
    try {
      const outcome = await shareOrDownload(blob, fileNameFor(rec), rec.name)
      if (outcome === 'downloaded') toast.show(`Downloaded ${fileNameFor(rec)}.`, { variant: 'success' })
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
        <div className="flex justify-center p-2" aria-label="Loading audio">
          <Spinner size={20} />
        </div>
      )}
      <div className="mt-4">
        <p id={`fx-${rec.id}`} className="mb-2 text-sm text-[var(--muted)]">
          Voice effect
        </p>
        <div role="group" aria-labelledby={`fx-${rec.id}`} className="flex flex-wrap gap-2">
          {EFFECTS.map((e) => (
            <button
              key={e.id}
              type="button"
              className="vr-chip"
              aria-pressed={effect === e.id}
              disabled={!blob}
              onClick={() => pick(e.id)}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {effect !== 'none' && (
          <button
            type="button"
            className="vr-btn"
            onClick={() => void exportEffect()}
            disabled={exporting || !blob}
          >
            {exporting ? 'Exporting…' : `Export as ${effectLabel(effect)}`}
          </button>
        )}
        <button type="button" className="vr-btn" onClick={() => void share()} disabled={!blob}>
          Share
        </button>
        <button type="button" className="vr-btn" onClick={onRename}>
          Rename
        </button>
        <button type="button" className="vr-btn vr-btn--danger" onClick={onDelete}>
          Delete
        </button>
      </div>
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
        <label htmlFor="rename-input" className="mb-1 block text-sm text-[var(--muted)]">
          Name
        </label>
        <input
          id="rename-input"
          className="vr-input w-full"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(e) => setName(e.currentTarget.value)}
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
