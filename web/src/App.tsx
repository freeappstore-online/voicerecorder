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
                <strong className="text-[var(--ink)]">Your audio never leaves your device.</strong> Nothing is
                uploaded: recording, playback, effects and export all happen on your device.
              </li>
              <li>
                Voice Recorder uses your microphone only while you record, after your browser asks you for
                permission. A recording is only sent anywhere when you tap Share and choose where it goes.
              </li>
              <li>
                Your recordings are stored on this device, in this browser's storage for the site
                (IndexedDB). They aren't kept in your FreeAppStore account, backed up or synced. Deleting a
                recording removes it; clearing this site's data removes them all.
              </li>
              <li>
                <strong className="text-[var(--ink)]">No account needed.</strong> Every feature works without
                signing in, and signing in doesn't upload anything.
              </li>
              <li>
                Page-view counts: the app loads FreeAppStore's store analytics script
                (api.freeappstore.online/v1/analytics.js), which records which screen you opened (for example
                /recordings), the page that linked here, and the time. It's sent to FreeAppStore without
                cookies and without your account, and held in this browser while you're offline. Your
                recordings and their names are never included.
              </li>
              <li>
                Voice Recorder is served via FreeAppStore, which also loads Cloudflare Web Analytics
                (beacon.min.js from static.cloudflareinsights.com). It doesn't use cookies and reports only
                aggregate page-view statistics, such as page load times and visit counts. As with any
                website, the servers handling these requests see your IP address and browser type.
              </li>
              <li>
                No ads, no tracking cookies and no advertising or tracking SDKs. The only third-party script
                is the Cloudflare Web Analytics beacon above.
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

