# template-standalone

The standalone-app template used by [`fas init`](https://github.com/freeappstore-online/platform/tree/main/packages/cli) to scaffold new free apps for [FreeAppStore](https://freeappstore.online).

You almost certainly want to use the CLI, not clone this directly:

```bash
npm i -g @freeappstore/cli
fas init my-app
```

The CLI clones this template, replaces every `voicerecorder` placeholder with your app id, runs `git init`, and makes the first commit — the result is a runnable app you can `pnpm dev` immediately.

## What's in here

- `web/` — Vite + React + TypeScript + Tailwind 4 app, ESM-only.
- `web/src/App.tsx` — the app wrapped in the SDK's `Shell` (`@freeappstore/sdk/ui`) with two starter screens, Home (`/`) and About (`/about`), declared in its `nav` prop. A new app renders the standard topbar, its navigation (`<nav aria-label="Main">`), an error boundary, toasts and an offline banner from the first render. No sign-in required.
- `web/src/index.css` — brand fonts (Manrope + Fraunces) and the design tokens (`--paper`, `--ink`, `--accent`, …); dark mode via `:root[data-theme='dark']`, which the SDK sets from the system or the Shell's theme toggle.
- `web/src/main.tsx` — React entry point.
- `web/index.html` — links Manrope + Fraunces, sets PWA meta tags, references the manifest.
- `web/public/manifest.json` — PWA manifest with `name`, `display`, `start_url`.
- `package.json` — pnpm workspace, `dev` / `build` / `typecheck` / `test` scripts.
- `.github/workflows/compliance.yml` — runs the same checks as `fas check` on every PR. Source of truth lives in the [`@freeappstore/compliance`](https://www.npmjs.com/package/@freeappstore/compliance) package.

## Cloning manually (not recommended)

If you really want to scaffold by hand:

```bash
git clone https://github.com/freeappstore-online/template-standalone my-app
cd my-app
# Replace voicerecorder → my-app in package.json, web/index.html, web/src/App.tsx, README, etc.
rm -rf .git && git init
pnpm install && pnpm dev
```

Then run `fas publish` to provision repo + hosting + DNS, or open the [submission form](https://github.com/freeappstore-online/submissions/issues/new) for maintainer review.

## License

MIT.
