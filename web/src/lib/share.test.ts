import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportError } from './export.ts'
import { type ShareEnv, canShareFile, shareOrDownload, shareRecording } from './share.ts'

interface FakeAnchor {
  href: string
  download: string
  rel: string
  style: { display: string }
  click: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

function fakeEnv(nav: ShareEnv['navigator']) {
  const anchors: FakeAnchor[] = []
  const revoked: string[] = []
  const env: ShareEnv = {
    navigator: nav,
    document: {
      createElement: (() => {
        const a: FakeAnchor = { href: '', download: '', rel: '', style: { display: '' }, click: vi.fn(), remove: vi.fn() }
        anchors.push(a)
        return a
      }) as unknown as Document['createElement'],
      body: { appendChild: vi.fn() } as unknown as HTMLElement,
    },
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: (url) => revoked.push(url),
  }
  return { env, anchors, revoked }
}

const audio = new Blob(['aac'], { type: 'audio/mp4' })

describe('shareOrDownload', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('opens the share sheet with the file when it can share files (iOS, Android)', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const { env, anchors } = fakeEnv({ share, canShare: () => true })
    expect(await shareOrDownload(audio, 'Memo.m4a', 'Memo', env)).toBe('shared')
    const data = share.mock.calls[0][0] as ShareData
    expect(data.title).toBe('Memo')
    expect(data.files?.[0].name).toBe('Memo.m4a')
    expect(data.files?.[0].type).toBe('audio/mp4')
    expect(anchors).toHaveLength(0)
  })

  it('treats closing the share sheet as a cancel, not a download', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('dismissed', 'AbortError'))
    const { env, anchors } = fakeEnv({ share, canShare: () => true })
    expect(await shareOrDownload(audio, 'Memo.m4a', 'Memo', env)).toBe('cancelled')
    expect(anchors).toHaveLength(0)
  })

  it('downloads when the share sheet refuses (e.g. gesture expired)', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('no gesture', 'NotAllowedError'))
    const { env, anchors } = fakeEnv({ share, canShare: () => true })
    expect(await shareOrDownload(audio, 'Memo.m4a', 'Memo', env)).toBe('downloaded')
    expect(anchors).toHaveLength(1)
  })

  it('downloads when files cannot be shared (desktop Chrome)', async () => {
    const share = vi.fn()
    const { env, anchors, revoked } = fakeEnv({ share, canShare: () => false })
    expect(await shareOrDownload(audio, 'Memo.webm', 'Memo', env)).toBe('downloaded')
    expect(share).not.toHaveBeenCalled()
    const [a] = anchors
    expect(a.href).toBe('blob:fake')
    expect(a.download).toBe('Memo.webm')
    expect(a.click).toHaveBeenCalledOnce()
    expect(a.remove).toHaveBeenCalledOnce()
    // The object URL outlives the click so the download can start.
    expect(revoked).toEqual([])
    vi.runAllTimers()
    expect(revoked).toEqual(['blob:fake'])
  })

  it('downloads when there is no Web Share API at all (Firefox desktop)', async () => {
    const { env, anchors } = fakeEnv({})
    expect(await shareOrDownload(audio, 'Memo.ogg', 'Memo', env)).toBe('downloaded')
    expect(anchors).toHaveLength(1)
  })
})

describe('canShareFile', () => {
  const file = new File(['x'], 'x.m4a', { type: 'audio/mp4' })

  it('is false without share or canShare', () => {
    expect(canShareFile(file, { navigator: {} })).toBe(false)
    expect(canShareFile(file, { navigator: { share: vi.fn() } })).toBe(false)
  })

  it('is false when canShare throws', () => {
    const canShare = () => {
      throw new TypeError('bad')
    }
    expect(canShareFile(file, { navigator: { share: vi.fn(), canShare } })).toBe(false)
  })
})

describe('shareRecording', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shares an iOS MP4 recording as-is, as .m4a with a bare MIME type', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const { env } = fakeEnv({ share, canShare: () => true })
    const blob = new Blob(['aac'], { type: 'audio/mp4;codecs=mp4a.40.2' })
    expect(await shareRecording({ blob, mimeType: blob.type, name: 'Memo' }, { env })).toBe('shared')
    const file = (share.mock.calls[0][0] as ShareData).files![0]
    expect(file.name).toBe('Memo.m4a')
    expect(file.type).toBe('audio/mp4')
    expect(await file.text()).toBe('aac')
  })

  it('shares the prepared (converted) file when one is passed in', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const { env } = fakeEnv({ share, canShare: () => true })
    const wav = new File(['RIFF'], 'Memo.wav', { type: 'audio/wav' })
    const blob = new Blob(['opus'], { type: 'audio/webm;codecs=opus' })
    await shareRecording({ blob, mimeType: blob.type, name: 'Memo' }, { file: Promise.resolve(wav), env })
    const sent = (share.mock.calls[0][0] as ShareData).files![0]
    expect(sent.name).toBe('Memo.wav')
    expect(sent.type).toBe('audio/wav')
  })

  it('downloads the converted file when it cannot share (desktop Chrome)', async () => {
    const { env, anchors } = fakeEnv({})
    const wav = new File(['RIFF'], 'Memo.wav', { type: 'audio/wav' })
    const blob = new Blob(['opus'], { type: 'audio/webm' })
    expect(await shareRecording({ blob, mimeType: blob.type, name: 'Memo' }, { file: Promise.resolve(wav), env })).toBe(
      'downloaded',
    )
    expect(anchors[0].download).toBe('Memo.wav')
  })

  it('surfaces a conversion error and neither shares nor downloads', async () => {
    const share = vi.fn()
    const { env, anchors } = fakeEnv({ share, canShare: () => true })
    const failure = new ExportError('decode', 'Could not decode this recording (WebM/Opus).')
    const blob = new Blob(['opus'], { type: 'audio/webm' })
    await expect(
      shareRecording({ blob, mimeType: blob.type, name: 'Memo' }, { file: Promise.reject(failure), env }),
    ).rejects.toBe(failure)
    expect(share).not.toHaveBeenCalled()
    expect(anchors).toHaveLength(0)
  })
})
