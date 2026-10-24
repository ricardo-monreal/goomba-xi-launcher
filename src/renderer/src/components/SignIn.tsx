import { FormEvent, useState } from 'react'
import BrandMark from './BrandMark'
import type { AppState, WebMe } from '../../../shared/types'

/** Website sign-in (websiteUrl). The password goes to the website once; only a session token is kept. */
export default function SignIn({ state, onSignedIn }: { state: AppState; onSignedIn: (me: WebMe) => void }): JSX.Element {
  const [username, setUsername] = useState(state.settings.lastUsername)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const site = state.config.websiteUrl.replace(/\/$/, '')

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) return setError('Enter your username and password.')
    setBusy(true)
    const r = await window.api.webSignIn(username.trim(), password, remember)
    setBusy(false)
    if (r.ok && r.me) {
      setPassword('')
      onSignedIn(r.me)
    } else setError(r.error ?? 'Sign-in failed.')
  }

  return (
    <div className="signin">
      <BrandMark className="signin-mark" />
      <form className="panel signin-panel" onSubmit={submit}>
        <div className="wordmark small-wordmark">
          GOOMBA <span>XI</span>
        </div>
        <h2>Sign in</h2>
        <label>
          Username
          <input value={username} maxLength={16} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} autoFocus={!username} />
        </label>
        <label>
          Password
          <input type="password" value={password} maxLength={32} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus={!!username} />
        </label>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep me signed in on this computer
        </label>
        {error && <p className="error small">{error}</p>}
        <button type="submit" className="play wide" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="account-links small">
          <button type="button" className="link" onClick={() => window.api.openExternal(state.config.registerUrl || `${site}/register`)}>
            Create account ↗
          </button>
          <button type="button" className="link" onClick={() => window.api.openExternal(`${site}/forgot-password`)}>
            Forgot password ↗
          </button>
        </div>
      </form>
    </div>
  )
}
