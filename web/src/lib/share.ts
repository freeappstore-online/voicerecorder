// Getting a recording off the device: the system share sheet where it can
// take audio files (iOS Safari, Chrome on Android, Safari/Edge on desktop),
// otherwise a plain file download (Chrome/Firefox on desktop).

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled'

/** The bits of `navigator` and `document` this needs, so tests can stand in for them. */
export interface ShareEnv {
  navigator: Partial<Pick<Navigator, 'share' | 'canShare'>>
  document: Pick<Document, 'createElement' | 'body'>
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
}

function browserEnv(): ShareEnv {
  return {
    navigator,
    document,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  }
}

/** True when the share sheet will accept this file. */
export function canShareFile(file: File, env: Pick<ShareEnv, 'navigator'> = browserEnv()): boolean {
  const nav = env.navigator
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false
  try {
    return nav.canShare({ files: [file] })
  } catch {
    return false
  }
}

/**
 * Shares the audio through the share sheet, or downloads it when sharing files
 * isn't supported. Call it straight from a tap with the Blob already in hand:
 * Safari only opens the share sheet during the user's gesture, so awaiting a
 * database read first can make it refuse.
 */
export async function shareOrDownload(
  blob: Blob,
  fileName: string,
  title: string,
  env: ShareEnv = browserEnv(),
): Promise<ShareOutcome> {
  const file = new File([blob], fileName, { type: blob.type })
  if (canShareFile(file, env)) {
    try {
      await env.navigator.share!({ files: [file], title })
      return 'shared'
    } catch (err) {
      // The user closed the sheet: that's a choice, not a failure.
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
      // NotAllowedError (gesture expired) and friends: fall back to a download.
    }
  }
  download(blob, fileName, env)
  return 'downloaded'
}

/** Saves the Blob as a file via a temporary `<a download>`. */
export function download(blob: Blob, fileName: string, env: ShareEnv = browserEnv()): void {
  const url = env.createObjectURL(blob)
  const a = env.document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  env.document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking straight away can cancel the download in some browsers.
  setTimeout(() => env.revokeObjectURL(url), 60_000)
}
