import { describe, expect, it, vi } from 'vitest'
import { type WakeLockEnv, holdScreenOn } from './wakelock.ts'

function fakeEnv(withApi = true) {
  const listeners = new Set<() => void>()
  const release = vi.fn().mockResolvedValue(undefined)
  const request = vi.fn().mockResolvedValue({ release })
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  const env = {
    wakeLock: withApi ? { request } : undefined,
    document: doc as unknown as WakeLockEnv['document'],
  }
  return { env, request, release, doc, listeners, flush: () => new Promise((r) => setTimeout(r)) }
}

describe('holdScreenOn', () => {
  it('takes a screen wake lock and releases it', async () => {
    const f = fakeEnv()
    const stop = holdScreenOn(f.env)
    await f.flush()
    expect(f.request).toHaveBeenCalledWith('screen')
    stop()
    expect(f.release).toHaveBeenCalledOnce()
    expect(f.listeners.size).toBe(0)
  })

  it('takes it again when the page becomes visible again', async () => {
    const f = fakeEnv()
    const stop = holdScreenOn(f.env)
    await f.flush()
    f.doc.visibilityState = 'hidden'
    f.listeners.forEach((l) => l())
    expect(f.request).toHaveBeenCalledTimes(1)
    f.doc.visibilityState = 'visible'
    f.listeners.forEach((l) => l())
    expect(f.request).toHaveBeenCalledTimes(2)
    stop()
  })

  it('releases a lock that arrives after stopping', async () => {
    const f = fakeEnv()
    const stop = holdScreenOn(f.env)
    stop()
    await f.flush()
    expect(f.release).toHaveBeenCalledOnce()
  })

  it('does nothing where unsupported or refused', async () => {
    expect(() => holdScreenOn(fakeEnv(false).env)()).not.toThrow()
    const f = fakeEnv()
    f.request.mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    const stop = holdScreenOn(f.env)
    await f.flush()
    expect(() => stop()).not.toThrow()
  })
})
