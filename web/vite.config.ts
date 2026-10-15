import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,wasm,json}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        // Force the new SW to activate immediately instead of waiting for
        // all tabs to close. Combined with registerType: 'autoUpdate' this
        // ensures users always get the latest deploy without a manual refresh.
        skipWaiting: true,
        clientsClaim: true,
        // Serve index.html for all navigation requests (SPA fallback).
        // Without this, opening from iPhone home screen shows blank —
        // the SW intercepts the navigation but has no response for it.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/v1/],
      },
      // Manifest is defined in web/public/manifest.json (single source of truth).
      // VitePWA reads it from there automatically when manifest is false.
      manifest: false,
    }),
  ],
  server: { host: true },
})
