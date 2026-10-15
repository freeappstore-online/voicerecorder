# voicerecorder

Voice Recorder & Changer: record your voice and change it with effects, on FreeAppStore. Audio
never leaves the device. Recordings library (IndexedDB, `web/src/lib/library.ts`) is built;
Record is still a "Coming soon" placeholder. Tests: `pnpm test` (vitest). See
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
