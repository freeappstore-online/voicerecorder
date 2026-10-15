# voicerecorder

Voice Recorder & Changer: record your voice and change it with effects, on FreeAppStore. Audio
never leaves the device. Recording engine in `web/src/lib/recorder.ts`
(MediaRecorder + Web Audio meter); library in `web/src/lib/library.ts` (IndexedDB). Effects not
built yet. Tests: `pnpm test` (vitest). See
freeappstore-online/platform#175.

- Live: https://voicerecorder.freeappstore.online
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Check: `fas check`
- Deploy: `git push origin main` (auto-deploys to R2 via GitHub Actions)

## Notes

- Fonts are self-hosted (`@fontsource-variable/*`); the app makes no third-party requests
  beyond the platform API and analytics loader. Keep it that way.

Platform conventions: https://raw.githubusercontent.com/freeappstore-online/freeappstore/main/SKILLS.md
