# Voice Recorder & Changer

**Record your voice and change it with fun effects, all on your device.** A free app on
[FreeAppStore](https://freeappstore.online), live at https://voicerecorder.freeappstore.online.

- One big button to record, with pause/resume, a live level meter and waveform.
- A library of recordings kept on your device (IndexedDB): play, seek, rename, delete.
- Seven voice effects, live while you play: chipmunk, deep, robot, echo, reverb, radio and reverse.
  Export any of them as a new WAV recording.
- Share or download in a format that plays everywhere (iPhone .m4a as-is; Chrome WebM converted
  to WAV).
- Works offline once loaded, and installs as an app (PWA).

Your audio never leaves your device. The app loads FreeAppStore's page-view analytics and the
Cloudflare Web Analytics beacon; see Privacy on the app's About screen.

## Develop

```bash
pnpm install
pnpm dev          # local dev server
pnpm build        # production build in web/dist
pnpm test         # unit tests (vitest)
pnpm test:e2e     # end-to-end tests (Playwright, fake microphone)
fas check         # FreeAppStore compliance checks
fas screencheck   # layout at 12 phone/tablet viewports
```

Pushes to `main` auto-deploy via GitHub Actions.

## License

MIT.
