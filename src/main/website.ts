// Talks to the server website's launcher API (goomba-xi-web: src/app/api/launcher/*).
//
//   POST /api/launcher/login         { username, password, device } -> { token }
//   GET  /api/launcher/me            Bearer token -> account, characters, players online
//   POST /api/launcher/launch-token  Bearer token -> { username, loginToken }  (single use, ~5 min)
//   POST /api/launcher/logout        Bearer token
//   GET  /api/status                 -> { online }
//
// The launcher keeps only the session token (encrypted with the OS keychain when "remember me"
// is on). The password is sent once, to the website, over HTTPS.

import { hostname } from 'node:os'
import type { WebMe } from '../shared/types'

export class SignedOutError extends Error {}

const TIMEOUT_MS = 15_000

async function call<T>(base: string, path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const url = base.replace(/\/$/, '') + path
  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (e) {
    const host = new URL(url).host
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    throw new Error(`${timedOut ? 'The website didn’t answer in time' : 'Can’t reach the website'} (${host}). Check your internet connection and try again.`)
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T
  if (res.status === 401 && opts.token) throw new SignedOutError(data.error ?? 'Your session has ended. Sign in again.')
  if (res.status === 429) throw new Error('Too many sign-in attempts. Wait a minute and try again.')
  if (!res.ok || data.ok === false) throw new Error(data.error ?? `The website answered with an error (${res.status}).`)
  return data
}

export async function signIn(base: string, username: string, password: string): Promise<string> {
  if (!username.trim() || !password) throw new Error('Enter your username and password.')
  const r = await call<{ token: string }>(base, '/api/launcher/login', {
    method: 'POST',
    body: { username: username.trim(), password, device: `${hostname()} (${process.platform})` }
  })
  if (!/^[0-9a-f]{64}$/.test(r.token)) throw new Error('The website sent an unexpected answer.')
  return r.token
}

export const me = (base: string, token: string): Promise<WebMe> => call<WebMe>(base, '/api/launcher/me', { token })

export async function launchToken(base: string, token: string): Promise<{ username: string; loginToken: string }> {
  const r = await call<{ username: string; loginToken: string }>(base, '/api/launcher/launch-token', { method: 'POST', token })
  if (!/^[0-9a-f]{64}$/.test(r.loginToken)) throw new Error('The website sent an unexpected launch token.')
  return r
}

export async function signOut(base: string, token: string): Promise<void> {
  await call(base, '/api/launcher/logout', { method: 'POST', token }).catch(() => {})
}

export async function status(base: string): Promise<number | null> {
  try {
    const r = await call<{ online: number }>(base, '/api/status')
    return typeof r.online === 'number' ? r.online : null
  } catch {
    return null
  }
}
