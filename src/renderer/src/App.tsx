import { useCallback, useEffect, useState } from 'react'
import type { AppState, UserSettings, WebMe } from '../../shared/types'
import Addons from './components/Addons'
import Home from './components/Home'
import Settings from './components/Settings'
import SignIn from './components/SignIn'

type Page = 'home' | 'addons' | 'settings'

const THEMES = ['goomba', 'blue', 'slate']

/** Small inline icons for the top bar (no icon font needed). */
const Icon = {
  home: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z" fill="currentColor" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.9 4.6-2-.4a7 7 0 0 1-.7 1.7l1.2 1.7-1.6 1.6-1.7-1.2a7 7 0 0 1-1.7.7l-.4 2h-2.3l-.4-2a7 7 0 0 1-1.7-.7l-1.7 1.2-1.6-1.6 1.2-1.7a7 7 0 0 1-.7-1.7l-2-.4v-2.3l2-.4a7 7 0 0 1 .7-1.7L4.1 7.2l1.6-1.6 1.7 1.2a7 7 0 0 1 1.7-.7l.4-2h2.3l.4 2a7 7 0 0 1 1.7.7l1.7-1.2 1.6 1.6-1.2 1.7a7 7 0 0 1 .7 1.7l2 .4z"
        fill="currentColor"
      />
    </svg>
  ),
  box: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2 3 7v10l9 5 9-5V7zm0 2.3L18.6 8 12 11.7 5.4 8zM5 9.7l6 3.3v6.7l-6-3.3zm8 10V13l6-3.3v6.7z" fill="currentColor" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5Z" fill="currentColor" />
    </svg>
  ),
  out: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M10 3H4v18h6v-2H6V5h4zm5.6 4.4L14.2 8.8l2.2 2.2H9v2h7.4l-2.2 2.2 1.4 1.4L20.2 12z" fill="currentColor" />
    </svg>
  ),
  link: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14zM5 5h6v2H5v12h12v-6h2v8H3V5z" fill="currentColor" />
    </svg>
  )
}

export default function App(): JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [page, setPage] = useState<Page>('home')
  const [loadError, setLoadError] = useState('')
  const [me, setMe] = useState<WebMe | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [online, setOnline] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const s = await window.api.getState()
      setState(s)
      document.title = s.config.serverName
      if (THEMES.includes(s.config.theme)) document.documentElement.dataset.theme = s.config.theme
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const refreshMe = useCallback(async () => {
    const r = await window.api.webMe()
    if (r.ok && r.me) {
      setMe(r.me)
      setSignedOut(false)
      setOnline(r.me.online)
    } else if (r.signedOut) {
      setMe(null)
      setSignedOut(true)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const website = !!state?.config.websiteUrl
  useEffect(() => {
    if (!website) return
    refreshMe()
    const pollOnline = () => window.api.serverStatus().then((s) => s.online !== null && setOnline(s.online))
    pollOnline()
    const t = setInterval(pollOnline, 60_000)
    return () => clearInterval(t)
  }, [website, refreshMe])

  const save = useCallback(
    async (patch: Partial<UserSettings>) => {
      await window.api.saveSettings(patch)
      await refresh()
    },
    [refresh]
  )

  const signOut = async (): Promise<void> => {
    await window.api.webSignOut()
    setMe(null)
    setSignedOut(true)
    setPage('home')
  }

  if (loadError) return <div className="boot">Failed to start: {loadError}</div>
  if (!state) return <div className="boot">Loading…</div>

  const nav: { id: Page; label: string; icon: JSX.Element }[] = [
    { id: 'settings', label: 'Settings', icon: Icon.gear },
    { id: 'addons', label: 'Addons', icon: Icon.box }
  ]

  return (
    <div className="shell">
      <header className="topbar">
        <button className={page === 'home' ? 'tb-btn icon-only active' : 'tb-btn icon-only'} onClick={() => setPage('home')} title="Home" aria-label="Home">
          {Icon.home}
        </button>
        {nav.map((n) => (
          <button key={n.id} className={page === n.id ? 'tb-btn active' : 'tb-btn'} onClick={() => setPage(n.id)}>
            {n.icon}
            {n.label}
          </button>
        ))}
        {online !== null && (
          <span className="tb-online">
            <span className="dot on" /> {online.toLocaleString()} online
          </span>
        )}
        <span className="tb-drag" />
        {Object.entries(state.config.links).map(([label, url]) => (
          <button key={label} className="tb-btn" onClick={() => window.api.openExternal(url)} title={url}>
            {label}
            {Icon.link}
          </button>
        ))}
        {website && me && (
          <>
            <span className="tb-sep" />
            <button className="tb-btn" onClick={() => window.api.openExternal(`${state.config.websiteUrl.replace(/\/$/, '')}/account`)} title="Your account on the website">
              {Icon.user}
              {me.account.login}
            </button>
            <button className="tb-btn icon-only" onClick={signOut} title="Sign out" aria-label="Sign out">
              {Icon.out}
            </button>
          </>
        )}
        <span className="tb-sep" />
        <button className="tb-win" onClick={() => window.api.windowMinimize()} aria-label="Minimize">
          ─
        </button>
        <button className="tb-win close" onClick={() => window.api.windowClose()} aria-label="Close">
          ✕
        </button>
      </header>
      <main className="content">
        {page === 'home' &&
          (website && signedOut ? (
            <SignIn
              state={state}
              onSignedIn={(m) => {
                setMe(m)
                setOnline(m.online)
                setSignedOut(false)
              }}
            />
          ) : (
            <Home state={state} me={me} save={save} refresh={refresh} refreshMe={refreshMe} />
          ))}
        {page === 'addons' && <Addons save={save} />}
        {page === 'settings' && <Settings state={state} save={save} />}
      </main>
    </div>
  )
}
