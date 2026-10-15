import { type Page, expect, test } from '@playwright/test'

// The four journeys from platform#182 (record, play, effect, export) plus
// offline. Each test starts from an empty library in a fresh browser context.

test.beforeEach(async ({ page }) => {
  // Keep test runs out of the app's usage statistics.
  await page.route('**/v1/analytics**', (route) =>
    route.fulfill({ status: 204, contentType: 'application/javascript', body: '' }),
  )
})

/** Records a clip of about `ms` with the fake microphone and waits for it to be saved. */
async function recordClip(page: Page, ms = 1500) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop & save' })).toBeVisible()
  await expect(page.locator('.vr-pill')).toHaveText('Recording')
  await page.waitForTimeout(ms)
  await expect(page.getByRole('timer')).not.toHaveText('0:00')
  await page.getByRole('button', { name: 'Stop & save' }).click()
  await expect(toast(page, /^Saved “Recording /)).toBeVisible()
}

/** Opens the Recordings screen and expands the newest recording. */
async function openNewest(page: Page) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Recordings' }).click()
  await expect(page.getByRole('heading', { name: '1 recording' })).toBeVisible()
  await page.locator('.vr-card__head').first().click()
}

/** A toast message (the screen-reader announcer repeats some of them, so match the toast itself). */
const toast = (page: Page, text: RegExp) => page.locator('.fas-toast').filter({ hasText: text })

/** The seek bar's position in seconds, read from its value. */
const position = (page: Page) => page.locator('.vr-seek').first().inputValue().then(Number)

test('record a clip', async ({ page }) => {
  await recordClip(page)
  // Live meter and waveform were running; afterwards the screen is ready again.
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Recordings' }).click()
  await expect(page.getByRole('heading', { name: '1 recording' })).toBeVisible()
  const card = page.locator('.vr-card').first()
  await expect(card).toContainText('WEBM')
  await expect(card.locator('.vr-card__duration')).toContainText(/0:0[1-3]/)

  // It survives a reload (IndexedDB).
  await page.reload()
  await expect(page.getByRole('heading', { name: '1 recording' })).toBeVisible()
})

test('play it back', async ({ page }) => {
  await recordClip(page)
  await openNewest(page)
  const play = page.getByRole('button', { name: /^Play Recording / })
  await expect(play).toBeEnabled()
  await play.click()
  await expect(page.getByRole('button', { name: /^Pause Recording / })).toBeVisible()
  await expect.poll(() => position(page)).toBeGreaterThan(0.2)
  // Plays to the end and stops by itself.
  await expect(page.getByRole('button', { name: /^Play Recording / })).toBeVisible({ timeout: 10_000 })
})

test('apply an effect', async ({ page }) => {
  await recordClip(page)
  await openNewest(page)
  const picker = page.getByRole('radiogroup', { name: 'Voice effect' })
  await expect(picker.getByRole('radio', { name: 'Original' })).toHaveAttribute('aria-checked', 'true')

  // Keyboard: arrow from Original to Robot.
  await picker.getByRole('radio', { name: 'Original' }).focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await expect(picker.getByRole('radio', { name: 'Robot' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Playing as Robot.')).toBeVisible()

  const play = page.getByRole('button', { name: /^Play .* as Robot$/ })
  await expect(play).toBeEnabled() // decoded and ready
  await play.click()
  await expect(page.getByRole('button', { name: /^Pause .* as Robot$/ })).toBeVisible()
  await expect.poll(() => position(page)).toBeGreaterThan(0.2)

  // Switching effect mid-play keeps playing.
  await picker.getByRole('radio', { name: 'Echo' }).click()
  await expect(page.getByRole('button', { name: /^Pause .* as Echo$/ })).toBeVisible()
})

test('export the file', async ({ page }) => {
  await recordClip(page)
  await openNewest(page)

  // Export with an effect: saved to the library as a new WAV recording.
  await page.getByRole('radiogroup', { name: 'Voice effect' }).getByRole('radio', { name: 'Chipmunk' }).click()
  await page.getByRole('button', { name: 'Export as Chipmunk' }).click()
  await expect(toast(page, /^Saved “Recording .* \[Chipmunk\]” to your recordings\./)).toBeVisible()
  await expect(page.getByRole('heading', { name: '2 recordings' })).toBeVisible()
  const exported = page.locator('.vr-card', { hasText: '[Chipmunk]' })
  await expect(exported).toContainText('WAV')
  await expect(exported.locator('.vr-tag')).toHaveText('Chipmunk')

  // Share the exported file: desktop Chromium can't share files, so it downloads a playable WAV.
  await exported.locator('.vr-card__head').click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exported.getByRole('button', { name: 'Share' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\[Chipmunk\]\.wav$/)
  const head = await readHead(await download.createReadStream())
  expect(head.toString('ascii', 0, 4)).toBe('RIFF')
  expect(head.toString('ascii', 8, 12)).toBe('WAVE')
})

test('the original WebM is converted to WAV when shared', async ({ page }) => {
  await recordClip(page)
  await openNewest(page)
  await expect(page.getByText('Shared as a WAV file')).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Share' }).click()])
  expect(download.suggestedFilename()).toMatch(/^Recording .*\.wav$/)
  const head = await readHead(await download.createReadStream())
  expect(head.toString('ascii', 0, 4)).toBe('RIFF')
})

test('works offline once loaded', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible()
  // Wait for the service worker to take control and finish precaching.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
    }
  })

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible()

  // Recording and the library work without a network.
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop & save' })).toBeVisible()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Stop & save' }).click()
  await expect(toast(page, /^Saved “Recording /)).toBeVisible()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Recordings' }).click()
  await expect(page.getByRole('heading', { name: '1 recording' })).toBeVisible()

  // Deep links are served from the cache too.
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible()
  await context.setOffline(false)
})

test('privacy disclosures are visible', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Audio stays on your device.')).toBeVisible()
  await page.getByRole('button', { name: 'Privacy' }).click()
  await expect(page).toHaveURL(/\/about$/)
  const privacy = page.getByRole('region', { name: 'Privacy' })
  await expect(privacy).toContainText('Your audio never leaves your device.')
  await expect(privacy).toContainText('IndexedDB')
  await expect(privacy).toContainText('api.freeappstore.online/v1/analytics.js')
  await expect(privacy).toContainText('No account needed.')
})

async function readHead(stream: NodeJS.ReadableStream, bytes = 12): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    chunks.push(b)
    size += b.length
    if (size >= bytes) break
  }
  return Buffer.concat(chunks).subarray(0, bytes)
}
