// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
const themeBlocks = [...css.matchAll(/:root(?:\[data-theme=['"]dark['"]\])?\s*\{([^}]+)\}/g)]

describe('Tailwind surface contract', () => {
  it('keeps card surfaces opaque in light and dark themes', () => {
    const surfaces = themeBlocks.flatMap((block) => [...block[1].matchAll(/--panel:\s*([^;]+);/g)])
    expect(surfaces).toHaveLength(2)
    for (const [, value] of surfaces) {
      expect(value).toMatch(/^(?:#[\da-f]{6}|rgb\([^/]+\))$/i)
    }
  })

  it('uses the opaque page token for floating surfaces in both themes', () => {
    const surfaces = themeBlocks.flatMap((block) => [...block[1].matchAll(/--popover:\s*([^;]+);/g)])
    expect(surfaces).toHaveLength(2)
    for (const [, value] of surfaces) expect(value).toBe('var(--paper)')
    expect(css).toContain('--color-popover: var(--popover)')
  })

  it('scans SDK utilities and maps semantic colours for Tailwind', () => {
    expect(css).toContain('@source "../node_modules/@freeappstore/sdk/dist"')
    for (const token of ['paper', 'ink', 'panel', 'accent', 'danger']) {
      expect(css).toContain(`--color-${token}: var(--${token})`)
    }
  })
})
