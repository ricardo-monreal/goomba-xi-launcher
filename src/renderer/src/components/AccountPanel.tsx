import { FormEvent, useState } from 'react'

interface Props {
  mode: 'create' | 'password'
  initialUsername: string
  onCancel: () => void
  /** Called after success with the username and a message to show on the sign-in form. */
  onDone: (username: string, note: string) => void
}

/** Create an account or change a password directly with the game's login server. */
export default function AccountPanel({ mode, initialUsername, onCancel, onDone }: Props): JSX.Element {
  const [username, setUsername] = useState(mode === 'password' ? initialUsername : '')
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = mode === 'create'

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    const u = username.trim()
    if (!u) return setError('Enter a username.')
    if (!create && !current) return setError('Enter your current password.')
    if (pw.length < 6) return setError('Use a password with at least 6 characters.')
    if (pw !== confirm) return setError('The passwords don’t match.')
    setBusy(true)
    const r = create ? await window.api.createAccount(u, pw) : await window.api.changePassword(u, current, pw)
    setBusy(false)
    if (!r.ok) return setError(r.error ?? 'Something went wrong.')
    onDone(u, create ? 'Account created. Sign in with your new password.' : 'Password changed. Sign in with your new password.')
  }

  return (
    <div className="account-panel">
      <h2>{create ? 'Create account' : 'Change password'}</h2>
      <label>
        Username
        <input value={username} maxLength={16} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} autoFocus />
      </label>
      {!create && (
        <label>
          Current password
          <input type="password" value={current} maxLength={32} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </label>
      )}
      <label>
        {create ? 'Password' : 'New password'}
        <input type="password" value={pw} maxLength={32} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </label>
      <label>
        Confirm password
        <input type="password" value={confirm} maxLength={32} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </label>
      {create && <p className="muted small">Up to 16 characters for the username and 32 for the password. You’ll create your characters in game.</p>}
      {error && <p className="error small">{error}</p>}
      <button type="button" className="primary" disabled={busy} onClick={submit}>
        {busy ? 'Please wait…' : create ? 'Create account' : 'Change password'}
      </button>
      <button type="button" className="link small center" onClick={onCancel} disabled={busy}>
        ← Back to sign in
      </button>
    </div>
  )
}
