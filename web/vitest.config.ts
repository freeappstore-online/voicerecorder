import { defineConfig } from 'vitest/config'

// Unit tests only; the Playwright e2e specs in e2e/ run with `pnpm test:e2e`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
