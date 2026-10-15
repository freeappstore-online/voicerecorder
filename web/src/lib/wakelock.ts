// Keeps the screen on while recording, where the browser allows it (Screen
// Wake Lock: Chrome, Edge, Safari 16.4+). On iOS a locked screen ends the
// recording, so this is the difference between a full take and a cut one.
// The lock drops whenever the page is hidden, so it's re-taken on return.

type WakeLockApi = { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }

export interface WakeLockEnv {
  wakeLock?: WakeLockApi
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
}

function browserEnv(): WakeLockEnv {
  return { wakeLock: (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock, document }
}

/** Holds the screen on until the returned function is called. Does nothing where unsupported. */
export function holdScreenOn(env: WakeLockEnv = browserEnv()): () => void {
  const api = env.wakeLock
  if (!api) return () => {}
  let sentinel: { release: () => Promise<void> } | null = null
  let active = true

  const acquire = () => {
    if (!active || env.document.visibilityState !== 'visible') return
    api.request('screen').then(
      (s) => {
        if (active) sentinel = s
        else void s.release().catch(() => {})
      },
      () => {
        // Refused (battery saver, no permission): recording still works.
      },
    )
  }
  const onVisibility = () => acquire()

  acquire()
  env.document.addEventListener('visibilitychange', onVisibility)
  return () => {
    active = false
    env.document.removeEventListener('visibilitychange', onVisibility)
    void sentinel?.release().catch(() => {})
    sentinel = null
  }
}
