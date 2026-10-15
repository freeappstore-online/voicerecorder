# voicerecorder

Voice Recorder & Changer: record your voice and change it with effects, on FreeAppStore. Audio
never leaves the device. Recording engine in `web/src/lib/recorder.ts`
(MediaRecorder + Web Audio meter); library in `web/src/lib/library.ts` (IndexedDB); effects in
`web/src/lib/effects.ts` (live Web Audio chains, OfflineAudioContext → WAV export); Share sends MP4/WAV as-is and
converts WebM/Ogg to WAV (`web/src/lib/export.ts`). App styles live in
`web/src/vr.css` (template tokens stay in `index.css`). Tests:
`pnpm test` (vitest; effects render through node-web-audio-api). See
freeappstore-online/platform#175.

- Live: https://voicerecorder.freeappstore.online
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Check: `fas check`; layout: `fas screencheck` (Record must fit 568×320 to 1366×1024 without scrolling; on
  Windows run `pnpm build` first and add `--skip-build`)
- e2e: `pnpm test:e2e` (Playwright, Chromium fake mic; record, play, effect, export, offline, privacy)
- Deploy: `git push origin main` (auto-deploys to R2 via GitHub Actions)

## Notes

- Fonts are self-hosted (`@fontsource-variable/*`); the app makes no third-party requests
  beyond the platform API and analytics loader. Keep it that way.

Platform conventions: https://raw.githubusercontent.com/freeappstore-online/freeappstore/main/SKILLS.md
