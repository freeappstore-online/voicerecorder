import { useEffect, useState } from 'react'
import { initApp } from '@freeappstore/sdk'
import { BuildInfo, type NavItem, PageHeader, Shell } from '@freeappstore/sdk/ui'

const fas = initApp({ appId: 'voicerecorder' })

// The app's screens. Shell renders them as its navbar (<nav aria-label="Main">,
// current screen highlighted, a menu on phones). Add one entry per screen;
// `title` becomes the browser tab title on that route.
const NAV: NavItem[] = [
  { label: 'Home', href: '/', title: 'voicerecorder' },
  { label: 'About', href: '/about', title: 'About — voicerecorder' },
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
    <Shell app={fas} appName="voicerecorder" nav={NAV} onNavigate={navigate}>
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">
        {path === '/about' ? <About /> : <Home />}
      </div>
      <BuildInfo />
    </Shell>
  )
}

function Home() {
  return <PageHeader title="voicerecorder" description="Edit web/src/App.tsx to start building." />
}

function About() {
  return (
    <>
      <PageHeader title="About" />
      <p className="text-[var(--muted)]">
        voicerecorder is a free app on <a href="https://freeappstore.online" className="underline">FreeAppStore</a>.
      </p>
    </>
  )
}
