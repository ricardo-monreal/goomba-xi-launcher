import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import AccountPanel from './AccountPanel'
import { formatBytes, formatDuration } from '../format'
import type { AppState, NewsItem, PatchProgress, UpdateCheck, UserSettings, WebMe } from '../../../shared/types'

type Status = 'checking' | 'needs-update' | 'updating' | 'ready' | 'launching' | 'error'

const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x86.exe'

/** Smoothed download speed in bytes/second from a stream of progress events. */
function useSpeed(progress: PatchProgress | null): number {
  const samples = useRef<{ t: number; b: number }[]>([])
  const [speed, setSpeed] = useState(0)
  useEffect(() => {
    if (!progress || progress.phase !== 'downloading') {
      samples.current = []
      setSpeed(0)
      return
    }
    const now = performance.now()
    const s = samples.current
    s.push({ t: now, b: progress.bytesDone })
    while (s.length > 2 && now - s[0].t > 5000) s.shift()
    if (s.length > 1) {
      const dt = (s[s.length - 1].t - s[0].t) / 1000
      if (dt > 0.5) setSpeed(Math.max(0, (s[s.length - 1].b - s[0].b) / dt))
    }
  }, [progress])
  return speed
}

interface Props {
  state: AppState
  me: WebMe | null
  save: (patch: Partial<UserSettings>) => Promise<void>
  refresh: () => Promise<void>
  /** Reload the website account (characters). */
  refreshMe: () => Promise<void>
}

export default function Home({ state, me, save, refresh, refreshMe }: Props): JSX.Element {
  const [news, setNews] = useState<NewsItem[] | null>(null)
  const [status, setStatus] = useState<Status>('checking')
  const [check, setCheck] = useState<UpdateCheck | null>(null)
  const [progress, setProgress] = useState<PatchProgress | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  // Direct login-server sign-in (only when no website is configured).
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(state.settings.rememberMe)
  const [mode, setMode] = useState<'signin' | 'create' | 'password'>('signin')
  const speed = useSpeed(progress)

  const { config, ffxi, prereqs, settings } = state
  const website = !!config.websiteUrl
  const bundled = config.clientMode === 'bundled'
  const firstInstall = bundled && !ffxi.found

  const runCheck = useCallback(async () => {
    setStatus('checking')
    setProgress(null)
    const r = await window.api.checkUpdates()
    setCheck(r)
    if (!r.ok) {
      setStatus('error')
      setError(r.error ?? 'Update check failed.')
    } else {
      setStatus(r.filesToDownload + r.filesToDelete > 0 ? 'needs-update' : 'ready')
    }
  }, [])

  useEffect(() => {
    window.api.getNews().then(setNews)
    if (!website) {
      window.api.getSavedCredentials().then((c) => {
        setUsername(c.username)
        setPassword(c.password)
      })
    }
    return window.api.onPatchProgress(setProgress)
  }, [website])

  useEffect(() => {
    setMessage('')
    setError('')
    runCheck()
  }, [runCheck, settings.installDir])

  const update = async (verify = false): Promise<void> => {
    setStatus('updating')
    setError('')
    setMessage(verify ? 'Verifying every file. This can take a few minutes.' : '')
    setProgress(null)
    const r = await window.api.runUpdate({ verify })
    if (r.cancelled) {
      setMessage('Paused. Press Resume to continue where you left off.')
      await runCheck()
      return
    }
    if (!r.ok) {
      setStatus('error')
      setError(r.error ?? 'Update failed.')
      return
    }
    setMessage(verify ? 'All files verified.' : firstInstall ? 'Installed. Welcome to Goomba XI!' : '')
    await refresh()
    await runCheck()
  }

  const chooseInstallDir = async (): Promise<void> => {
    const dir = await window.api.chooseFolder('Choose where to install the game')
    if (dir) await save({ installDir: dir })
  }

  const locateFfxi = async (): Promise<void> => {
    const dir = await window.api.chooseFolder('Select your FINAL FANTASY XI folder (contains FFXiMain.dll)')
    if (dir) await save({ ffxiPath: dir })
  }

  const play = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault()
    if (status !== 'ready') return
    setError('')
    if (!website) {
      if (mode !== 'signin') return
      if (!username.trim() || !password) return setError('Enter your username and password.')
    }
    setStatus('launching')
    setMessage(state.platform === 'win32' ? 'Starting the game… If Windows asks for permission, choose Yes.' : 'Starting the game…')
    const off = window.api.onLaunchStatus(setMessage)
    const r = website ? await window.api.launch({}) : await window.api.launch({ username: username.trim(), password, remember })
    off()
    if (r.ok) {
      setMessage('Game started. See you in Vana’diel!')
      setTimeout(() => {
        setStatus('ready')
        setMessage('')
        refreshMe()
      }, 8000)
    } else {
      setStatus('ready')
      setMessage('')
      setError(r.error ?? 'Launch failed.')
      if (website) refreshMe()
    }
  }

  const pct = progress && progress.bytesTotal > 0 ? Math.min(100, Math.floor((progress.bytesDone / progress.bytesTotal) * 100)) : 0
  const lowDisk = !!check?.ok && check.freeBytes !== undefined && check.freeBytes < check.bytesToWrite + 512 * 1024 * 1024
  const paused = status === 'needs-update' && message.startsWith('Paused')
  const remaining = progress && speed > 0 ? (progress.bytesTotal - progress.bytesDone) / speed : 0

  let button: JSX.Element
  if (!bundled && !ffxi.found) {
    button = (
      <button type="button" className="play" onClick={locateFfxi}>
        Locate FFXI
      </button>
    )
  } else if (status === 'needs-update') {
    button = (
      <button type="button" className="play" onClick={() => update()} disabled={lowDisk}>
        {paused ? 'Resume' : firstInstall ? 'Install' : 'Update'}
        <span className="play-sub">{formatBytes(check?.bytesToDownload ?? 0)}</span>
      </button>
    )
  } else if (status === 'updating') {
    button = (
      <button type="button" className="play ghost" onClick={() => window.api.cancelUpdate()}>
        Pause <span className="play-sub">{pct}%</span>
      </button>
    )
  } else if (status === 'error') {
    button = (
      <button type="button" className="play" onClick={runCheck}>
        Retry
      </button>
    )
  } else {
    button = (
      <button type="button" className="play" onClick={() => play()} disabled={status !== 'ready' || !ffxi.found}>
        {status === 'checking' ? 'Checking…' : status === 'launching' ? 'Launching…' : 'Play'}
      </button>
    )
  }

  return (
    <div className="home">
      <div className="home-main">
        <div className="wordmark">
          GOOMBA <span>XI</span>
        </div>

        {firstInstall && status !== 'ready' ? (
          <div className="panel install-panel">
            <h2>Install the game</h2>
            <p className="muted small">Everything you need to play is downloaded here. No separate FINAL FANTASY XI install required.</p>
            {check?.ok && (
              <dl className="facts">
                <dt>Download</dt>
                <dd>{formatBytes(check.bytesToDownload)}</dd>
                <dt>Size on disk</dt>
                <dd>{formatBytes(check.bytesToWrite)}</dd>
                {check.freeBytes !== undefined && (
                  <>
                    <dt>Free space</dt>
                    <dd className={lowDisk ? 'error' : ''}>{formatBytes(check.freeBytes)}</dd>
                  </>
                )}
              </dl>
            )}
            <div className="install-dir">
              <div className="small muted">Install location</div>
              <div className="path">{settings.installDir}</div>
              {status !== 'updating' && (
                <button type="button" className="link small" onClick={chooseInstallDir}>
                  Change…
                </button>
              )}
            </div>
            {lowDisk && <p className="error small">Not enough free space on this drive. Pick another location or free up space.</p>}
          </div>
        ) : website ? (
          <div className="char-list">
            {me?.characters.length === 0 && (
              <div className="panel char-empty">
                <b>No characters yet.</b>
                <span className="muted small">Press Play and create your first adventurer.</span>
              </div>
            )}
            {me?.characters.map((c) => (
              <button key={c.name} type="button" className="char-card" onClick={() => window.api.openExternal(`${config.websiteUrl}/characters/${c.name}`)} title="Open on the website">
                <span className="char-info">
                  <span className="char-name">
                    {c.online && <span className="dot on" />} {c.name}
                  </span>
                  <span className="char-zone">{c.zone || c.nation}</span>
                </span>
                <span className="char-rank">
                  <span>RANK {c.rank}</span>
                  <b>
                    {c.job} {c.level}
                  </b>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <form className="panel signin-inline" onSubmit={play}>
            {mode === 'signin' ? (
              <>
                <h2>Sign in</h2>
                <label>
                  Username
                  <input value={username} maxLength={16} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} />
                </label>
                <label>
                  Password
                  <input type="password" value={password} maxLength={32} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                </label>
                <label className="check">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  Remember me on this computer
                </label>
                <div className="account-links small">
                  {config.allowAccountCreation && (
                    <button type="button" className="link" onClick={() => (config.registerUrl ? window.api.openExternal(config.registerUrl) : setMode('create'))}>
                      Create account{config.registerUrl ? ' ↗' : ''}
                    </button>
                  )}
                  <button type="button" className="link" onClick={() => setMode('password')}>
                    Change password
                  </button>
                </div>
              </>
            ) : (
              <AccountPanel
                mode={mode}
                initialUsername={username}
                onCancel={() => setMode('signin')}
                onDone={(u, note) => {
                  setUsername(u)
                  setPassword('')
                  setMessage(note)
                  setMode('signin')
                }}
              />
            )}
          </form>
        )}

        {news && news.length > 0 && (
          <div className="news">
            {news.slice(0, 3).map((n, i) => (
              <article key={i} className="news-item">
                <span className="news-date">{n.date}</span>
                <b>{n.title}</b>
                <p>{n.body}</p>
                {n.url && (
                  <button className="link small" onClick={() => window.api.openExternal(n.url!)}>
                    Read more ↗
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      <footer className="play-bar">
        <div className="play-status">
          {status === 'checking' && progress?.phase === 'checking' && progress.filesTotal > 0 && (
            <>
              <div className="bar">
                <div style={{ width: `${Math.floor((progress.filesDone / progress.filesTotal) * 100)}%` }} />
              </div>
              <span className="muted small">
                Checking files {progress.filesDone.toLocaleString()} / {progress.filesTotal.toLocaleString()}
              </span>
            </>
          )}
          {status === 'updating' && progress && (
            <>
              <div className="bar">
                <div style={{ width: `${progress.phase === 'checking' ? 0 : pct}%` }} />
              </div>
              <span className="muted small">
                {progress.phase === 'checking'
                  ? `Checking files ${progress.filesDone.toLocaleString()} / ${progress.filesTotal.toLocaleString()}`
                  : `${formatBytes(progress.bytesDone)} of ${formatBytes(progress.bytesTotal)}` +
                    (speed > 0 ? ` · ${formatBytes(speed)}/s · ${formatDuration(remaining)} left` : '') +
                    ` · ${progress.filesDone.toLocaleString()} / ${progress.filesTotal.toLocaleString()} files`}
              </span>
            </>
          )}
          {error && <span className="error small">{error}</span>}
          {!error && message && <span className="small">{message}</span>}
          {!bundled && !ffxi.found && <span className="error small">{ffxi.error}</span>}
          {prereqs.wine === null && (
            <span className="notice small">Wine/Proton couldn’t be set up. Open Settings → Linux.</span>
          )}
          {prereqs.vcRedistX86 === false && (
            <span className="notice small">
              The Microsoft Visual C++ x86 runtime is missing; the game won’t start without it.{' '}
              <button type="button" className="link" onClick={() => window.api.openExternal(VC_REDIST_URL)}>
                Download it ↗
              </button>
            </span>
          )}
          {!error && !message && status === 'ready' && check?.version && <span className="muted small">Up to date · version {check.version}</span>}
        </div>
        {button}
      </footer>
    </div>
  )
}
