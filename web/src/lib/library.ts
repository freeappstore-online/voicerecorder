// The recordings library: everything the user has recorded, kept on this
// device in IndexedDB. Nothing here ever touches the network.
//
// Two object stores, both keyed by recording id:
// - `meta`  — small records (name, date, duration, type, size) the list reads.
// - `audio` — the bytes, read only when a recording is played or shared.
// Splitting them keeps the list fast however long the recordings are.
//
// Audio is stored as an ArrayBuffer plus its MIME type rather than as a Blob:
// older WebKit (iOS Safari) fails to put Blobs into IndexedDB, and an
// ArrayBuffer round-trips everywhere.

export interface RecordingMeta {
  id: string
  name: string
  /** Epoch milliseconds when the recording was made. */
  createdAt: number
  durationMs: number
  /** MIME type the recorder produced, e.g. `audio/webm;codecs=opus` or `audio/mp4`. */
  mimeType: string
  /** Size of the audio in bytes. */
  size: number
}

export interface NewRecording {
  blob: Blob
  durationMs: number
  /** Defaults to now. */
  createdAt?: number
  /** Defaults to a name built from `createdAt`. */
  name?: string
}

const DB_NAME = 'voicerecorder'
const DB_VERSION = 1
const META = 'meta'
const AUDIO = 'audio'

/** Longest name we keep; anything longer is cut. */
export const MAX_NAME_LENGTH = 80

export class Library {
  private db: Promise<IDBDatabase> | null = null
  private readonly factory: IDBFactory
  private readonly dbName: string

  constructor(factory: IDBFactory = indexedDB, dbName = DB_NAME) {
    this.factory = factory
    this.dbName = dbName
  }

  /** Saves a new recording and returns its metadata. */
  async save(input: NewRecording): Promise<RecordingMeta> {
    const createdAt = input.createdAt ?? Date.now()
    const bytes = await input.blob.arrayBuffer()
    const meta: RecordingMeta = {
      id: newId(),
      name: cleanName(input.name ?? '') || defaultName(new Date(createdAt)),
      createdAt,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      mimeType: input.blob.type || 'audio/webm',
      size: bytes.byteLength,
    }
    await this.write((meta_, audio) => {
      meta_.add(meta)
      audio.add({ id: meta.id, bytes })
    })
    return meta
  }

  /** All recordings, newest first. Doesn't load any audio. */
  async list(): Promise<RecordingMeta[]> {
    const db = await this.open()
    const all = await request<RecordingMeta[]>(db.transaction(META).objectStore(META).getAll())
    return all.sort((a, b) => b.createdAt - a.createdAt)
  }

  async get(id: string): Promise<RecordingMeta | undefined> {
    const db = await this.open()
    return request<RecordingMeta | undefined>(db.transaction(META).objectStore(META).get(id))
  }

  /** The recording's audio as a Blob of its original type, or undefined if it's gone. */
  async audio(id: string): Promise<Blob | undefined> {
    const db = await this.open()
    const tx = db.transaction([META, AUDIO])
    const [meta, row] = await Promise.all([
      request<RecordingMeta | undefined>(tx.objectStore(META).get(id)),
      request<{ id: string; bytes: ArrayBuffer } | undefined>(tx.objectStore(AUDIO).get(id)),
    ])
    if (!meta || !row) return undefined
    return new Blob([row.bytes], { type: meta.mimeType })
  }

  /** Renames a recording. A blank name is refused; the old name stays. */
  async rename(id: string, name: string): Promise<RecordingMeta> {
    const clean = cleanName(name)
    if (!clean) throw new Error('A recording needs a name.')
    let updated: RecordingMeta | undefined
    await this.write((meta) => {
      const req = meta.get(id)
      req.onsuccess = () => {
        const current = req.result as RecordingMeta | undefined
        if (!current) return
        updated = { ...current, name: clean }
        meta.put(updated)
      }
    })
    if (!updated) throw new Error('That recording no longer exists.')
    return updated
  }

  /** Deletes a recording and its audio. Deleting a missing id is a no-op. */
  async remove(id: string): Promise<void> {
    await this.write((meta, audio) => {
      meta.delete(id)
      audio.delete(id)
    })
  }

  close(): void {
    const db = this.db
    this.db = null
    void db?.then((d) => d.close()).catch(() => {})
  }

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        const req = this.factory.open(this.dbName, DB_VERSION)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' })
          if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO, { keyPath: 'id' })
        }
        req.onsuccess = () => {
          const db = req.result
          // Another tab upgrading the schema: step aside so it isn't blocked.
          db.onversionchange = () => {
            db.close()
            this.db = null
          }
          resolve(db)
        }
        req.onerror = () => reject(req.error ?? new Error('Could not open the recordings library.'))
      })
      // A failed open shouldn't poison every later call.
      this.db.catch(() => {
        this.db = null
      })
    }
    return this.db
  }

  /** Runs `fn` in a read-write transaction over both stores and waits for it to commit. */
  private async write(fn: (meta: IDBObjectStore, audio: IDBObjectStore) => void): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([META, AUDIO], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Saving to the recordings library failed.'))
      tx.onabort = () => reject(tx.error ?? new Error('Saving to the recordings library was cancelled.'))
      fn(tx.objectStore(META), tx.objectStore(AUDIO))
    })
  }
}

function request<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Trims, collapses whitespace and caps the length of a user-typed name. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim()
}

/** "Recording 15 Oct 2026, 21:34", in the user's locale. */
export function defaultName(date: Date): string {
  const when = date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `Recording ${when}`
}

/** 0:07, 3:25, 1:02:03. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** 512 B, 14 KB, 2.3 MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** File extension for a recorder MIME type: iOS gives AAC in MP4, Chrome/Firefox Opus in WebM or Ogg. */
export function extensionFor(mimeType: string): string {
  const type = mimeType.split(';')[0].trim().toLowerCase()
  switch (type) {
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/aac':
      return 'm4a'
    case 'audio/ogg':
      return 'ogg'
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return 'wav'
    case 'audio/mpeg':
      return 'mp3'
    default:
      return 'webm'
  }
}

/** A safe file name for sharing or downloading, e.g. `Team standup.m4a`. */
export function fileNameFor(meta: Pick<RecordingMeta, 'name' | 'mimeType'>): string {
  const base =
    cleanName(meta.name)
      // Characters Windows, macOS or iOS Files refuse in file names.
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .replace(/^\.+/, '')
      .trim() || 'Recording'
  return `${base}.${extensionFor(meta.mimeType)}`
}

let shared: Library | null = null

/** The app-wide library. The recorder saves here; the Recordings screen reads it. */
export function library(): Library {
  shared ??= new Library()
  return shared
}
