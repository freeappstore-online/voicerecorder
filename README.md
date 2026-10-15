# Voice Recorder & Changer

**Coming soon — record your voice and change it with fun effects, all on your device.** A free
app on [FreeAppStore](https://freeappstore.online), live at
https://voicerecorder.freeappstore.online.

Right now this is a shell: the planned screens (Record, Recordings, About) exist but nothing
records yet, and the microphone is never requested. Progress is tracked in
[freeappstore-online/platform#175](https://github.com/freeappstore-online/platform/issues/175).

## Develop

```bash
pnpm install
pnpm dev      # local dev server
pnpm build    # production build in web/dist
fas check     # FreeAppStore compliance checks
```

Pushes to `main` auto-deploy via GitHub Actions.

## License

MIT.
