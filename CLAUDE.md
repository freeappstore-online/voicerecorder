# voicerecorder

A free app on FreeAppStore.

- Subdomain: `voicerecorder.freeappstore.online`
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Deploy: `git push origin main` (auto-deploys to R2 via GitHub Actions)

Free, MIT-licensed, no tracking. For platform conventions, read
https://freeappstore.online/skills.md
before writing or changing anything.

## App shell

`web/src/App.tsx` wraps the app in `<Shell app={fas} appName="voicerecorder" nav={NAV} onNavigate={navigate}>`
from `@freeappstore/sdk/ui`. Keep it as the root and build every screen inside it:

- Add one `NAV` entry per screen (`{ label, href, title }`) and render the screen for `path` in `App`.
  The Shell turns `NAV` into the app's navigation (`<nav aria-label="Main">`).
- Start each screen with `<PageHeader title="…" />`. Use `useToast()` for feedback.
- Don't build your own header, sidebar, tab bar, bottom dock or error boundary; the Shell has them.
- This template doesn't require sign-in. Pass `requireAuth` only if the whole app needs an account.

Guide: https://docs.freeappstore.online/getting-started/#build-your-app-on-the-shell

## SDK

This app uses `@freeappstore/sdk` (v0.14.30+). Available modules:

- `fas.auth` — OAuth sign-in (SSO across all apps). **Always offer both GitHub and Google sign-in.**
- `fas.kv` — per-user storage (1MB, 100 keys)
- `fas.collections` — Firestore-style document database
- `fas.counters` — atomic shared counters
- `fas.rooms` — real-time WebSocket rooms (32 peers)
- `fas.proxy` — secret-injecting API proxy
- `fas.keys` — user API key vault (OpenAI, Anthropic, etc.)
- `fas.email` — transactional email (100/day)
- `fas.log` — logging (auto-captures errors, uploads to server)
- `fas.webhooks` — outbound webhook management
- `fas.roles` — app-level RBAC
- `fas.friends` — platform-level friend relationships (shared across all apps)
- `fas.voice` — speech-to-text via `useVoiceInput` hook (React only)

UI components: `import { Shell, PageHeader, useToast, Modal, Card, Tabs, Badge, ... } from '@freeappstore/sdk/ui'`
Hooks: `import { useAuth, useTheme, useFriends, useVoiceInput } from '@freeappstore/sdk/hooks'`

## Config & secrets

- Never commit `.env.production` (compliance check fails).
- Public identifiers (OAuth client IDs, Firebase config): set as GitHub repo Variables (`VITE_*` prefix).
- API keys that cost money: use `fas.proxy.fetch()` (app-secret proxy or user key vault).
- Local dev: use `.env.local` (gitignored).
- See "App Config & Secrets" in SKILLS.md for the full guide.

## MCP (for AI agents)

Connect to the FreeAppStore MCP server for SDK docs, deploy status, and log queries:

```json
{
  "mcpServers": {
    "freeappstore": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.freeappstore.online/mcp"]
    }
  }
}
```

Tools: `create_app`, `update_files`, `read_file`, `list_files`, `agent_build`, `agent_status`, `list_apps`, `app_info`, `deploy_status`, `app_logs`, `platform_guide`, `sdk_reference`.
