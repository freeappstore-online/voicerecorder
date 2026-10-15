import { useEffect, useState } from 'react'
import { initApp } from '@freeappstore/sdk'
import { BuildInfo, type NavItem, PageHeader, Shell } from '@freeappstore/sdk/ui'

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
        <Screen path={path} />
      </div>
      <BuildInfo />
    </Shell>
  )
}

function Screen({ path }: { path: string }) {
  switch (path) {
    case '/recordings':
      return (
        <>
          <PageHeader title="Recordings" description="Play, rename, share or delete what you've recorded." />
          <ComingSoon />
        </>
      )
    case '/about':
      return (
        <>
          <PageHeader title="About" />
          <ComingSoon />
          <p className="mt-4 text-[var(--muted)]">
            Voice Recorder will record your voice with one big button, keep your recordings on this
            device, and let you play them back or export them with effects: chipmunk, deep, robot,
            echo, reverb, radio and reverse. Your audio will never leave your device.
          </p>
          <p className="mt-4 text-[var(--muted)]">
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
          <PageHeader title="Record" description="Record your voice, then change it with effects." />
          <ComingSoon />
        </>
      )
  }
}

// Placeholder body until the screens are built. Nothing records yet and the
// microphone is never requested, so it says so plainly.
function ComingSoon() {
  return (
    <p className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4 text-[var(--muted)]">
      Coming soon. Voice Recorder is in development; it doesn't record anything yet and won't ask
      for your microphone.
    </p>
  )
}
