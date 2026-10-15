import { useEffect, useState } from 'react'
import { initApp } from '@freeappstore/sdk'
import { BuildInfo, type NavItem, PageHeader, Shell } from '@freeappstore/sdk/ui'
import { Record } from './Record.tsx'
import { Recordings } from './Recordings.tsx'

const fas = initApp({ appId: 'voicerecorder' })

// The app's screens. Shell renders them as its navbar (<nav aria-label="Main">,
// current screen highlighted, a menu on phones). `title` becomes the browser
// tab title on that route.
const NAV: NavItem[] = [
  { label: 'Record', href: '/', title: 'Record — Voice Recorder' },
  { label: 'Recordings', href: '/recordings', title: 'Recordings — Voice Recorder' },
  { label: 'About', href: '/about', title: 'About — Voice Recorder' },
]

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname)

  // Keep the screen in step with the browser's back and forward buttons.
  useEffect(() => {
    const sync = () => setPath(window.location.pathname)
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  // Nav clicks switch screens without a page load. Shell scrolls to the top
  // and moves focus to the new screen's PageHeader.
  const navigate = (href: string) => {
    window.history.pushState(null, '', href)
    setPath(href)
  }

  return (
    <Shell app={fas} appName="Voice Recorder" nav={NAV} onNavigate={navigate}>
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">
        <Screen path={path} navigate={navigate} />
      </div>
      <BuildInfo />
    </Shell>
  )
}

function Screen({ path, navigate }: { path: string; navigate: (href: string) => void }) {
  switch (path) {
    case '/recordings':
      return (
        <>
          <PageHeader title="Recordings" description="Play, rename, share or delete what you've recorded." />
          <Recordings />
        </>
      )
    case '/about':
      return (
        <>
          <PageHeader title="About" />
          <p className="text-[var(--muted)]">
            Voice Recorder records your voice with one big button, keeps your recordings on this
            device, and lets you play, rename, share or download them. Play any recording back as a
            chipmunk, deep, robot, echo, reverb, radio or reversed voice, and export the result as a
            new WAV file. Your audio never leaves your device.
          </p>
          <section id="privacy" aria-labelledby="privacy-title" className="vr-privacy mt-6">
            <h2 id="privacy-title" className="text-lg font-bold">
              Privacy
            </h2>
            <ul className="mt-2 flex flex-col gap-2 text-[var(--muted)]">
              <li>
                <strong className="text-[var(--ink)]">Your audio never leaves your device.</strong> Recording,
                playback, effects and export all happen in your browser. Nothing is uploaded, and there's no
                server that could receive it.
              </li>
              <li>
                <strong className="text-[var(--ink)]">Recordings are stored on this device</strong>, in your
                browser's IndexedDB storage for this site. Delete a recording and it's gone; clearing this
                site's data in your browser removes them all. They aren't backed up or synced.
              </li>
              <li>
                <strong className="text-[var(--ink)]">No account needed.</strong> You can use every feature
                without signing in. Signing in is optional and only links you to your FreeAppStore profile; it
                doesn't upload recordings.
              </li>
              <li>
                <strong className="text-[var(--ink)]">Usage statistics.</strong> Like every FreeAppStore
                app, this page loads the platform's analytics script (api.freeappstore.online/v1/analytics.js).
                Each time you open a screen it sends a page-view event to api.freeappstore.online: the app
                name, which screen, the page you came from, and the time. As with any web request, that
                server also sees your IP address and browser. It sets no cookies; while you're offline it keeps
                these events in this browser and sends them later. It never includes your audio, your
                recordings or their names.
              </li>
              <li>
                <strong className="text-[var(--ink)]">Microphone</strong>: used only while you record, after
                your browser asks you for permission. Sharing a recording only happens when you tap Share.
              </li>
            </ul>
          </section>
          <p className="mt-6 text-[var(--muted)]">
            Voice Recorder is a free, MIT-licensed app on{' '}
            <a href="https://freeappstore.online" className="underline">
              FreeAppStore
            </a>
            .
          </p>
        </>
      )
    default:
      return (
        <>
          <PageHeader title="Record" description="Record your voice. It stays on this device." />
          <Record navigate={navigate} />
        </>
      )
  }
}

