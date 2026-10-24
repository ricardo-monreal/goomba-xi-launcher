// Talks to the LandSandBoat login server's auth port (default 54231) the same way xiloader does:
// one JSON request over TLS, one JSON reply. See LandSandBoat src/login/auth_session.cpp.
//
// Used to create accounts, change passwords, and check credentials before launching, so players
// get a clear error in the launcher instead of a console prompt.

import tls from 'node:tls'

/** xiloader version the launcher identifies as. Must match the server's major.minor (2.2.x). */
export const XILOADER_VERSION: [number, number, number] = [2, 2, 0]

const enum Cmd {
  LOGIN = 0x10,
  CREATE = 0x20,
  CHANGE_PASSWORD = 0x30
}

const enum Result {
  FAIL = 0x00,
  SUCCESS = 0x01,
  ERROR = 0x02,
  SUCCESS_CREATE = 0x03,
  ERROR_CREATE_TAKEN = 0x04,
  SUCCESS_CHANGE_PASSWORD = 0x06,
  ERROR_CHANGE_PASSWORD = 0x07,
  ERROR_CREATE_DISABLED = 0x08,
  ERROR_CREATE = 0x09,
  ERROR_ALREADY_LOGGED_IN = 0x0a,
  ERROR_VERSION_UNSUPPORTED = 0x0b
}

export interface AccountResult {
  ok: boolean
  error?: string
}

export interface AuthTarget {
  host: string
  port: number
}

/** Same limits the server enforces (auth_session.cpp: isStringMalformed). */
export function validateCredentials(username: string, password: string): string | null {
  if (!username) return 'Enter your username.'
  if (!password) return 'Enter your password.'
  if (username.length > 16) return 'Usernames can be at most 16 characters.'
  if (password.length > 32) return 'Passwords can be at most 32 characters.'
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(username + password)) return 'Usernames and passwords can’t contain control characters.'
  return null
}

/** Sends one request and resolves with the parsed JSON reply. */
export function authRequest(target: AuthTarget, payload: Record<string, unknown>, timeoutMs = 10_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let settled = false
    let buf = Buffer.alloc(0)
    const done = (err: Error | null, value?: Record<string, unknown>): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (err) reject(err)
      else resolve(value!)
    }
    // The login server uses its own (usually self-signed) certificate, and xiloader doesn't pin it
    // either, so the certificate isn't verified here. The channel is still encrypted.
    const socket = tls.connect({ host: target.host, port: target.port, rejectUnauthorized: false }, () => {
      socket.write(JSON.stringify({ ...payload, version: XILOADER_VERSION }))
    })
    const timer = setTimeout(() => done(new Error('The login server didn’t answer in time.')), timeoutMs)
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      const text = buf.toString('utf8').replace(/\0+$/, '')
      try {
        done(null, JSON.parse(text))
      } catch {
        // Partial message; wait for more.
      }
    })
    socket.on('error', (err: NodeJS.ErrnoException) => {
      const reason =
        err.code === 'ECONNREFUSED' ? 'nothing is listening on that port (is the server running?)'
        : err.code === 'ETIMEDOUT' || err.code === 'EHOSTUNREACH' ? 'the server can’t be reached on this network'
        : err.code === 'ENOTFOUND' ? 'the server address doesn’t exist'
        : err.message
      done(new Error(`Can’t reach the login server at ${target.host}:${target.port}: ${reason}.`))
    })
    socket.on('end', () => done(new Error('The login server closed the connection without answering.')))
  })
}

function errorFromReply(r: Record<string, unknown>, fallback: string): string {
  if (typeof r.error_message === 'string' && r.error_message) return r.error_message
  switch (r.result) {
    case Result.FAIL:
      return 'This account can’t log in right now (it may be suspended or banned).'
    case Result.ERROR:
      return 'Wrong username or password. Too many failed attempts will lock you out for a while.'
    case Result.ERROR_CREATE_TAKEN:
      return 'That username is already taken.'
    case Result.ERROR_CREATE_DISABLED:
      return 'Account creation is turned off on this server.'
    case Result.ERROR_CREATE:
      return 'The server couldn’t create the account. Try again, or contact the server team.'
    case Result.ERROR_CHANGE_PASSWORD:
      return 'Couldn’t change the password. Check your username and current password.'
    case Result.ERROR_ALREADY_LOGGED_IN:
      return 'This account is already logged in.'
    case Result.ERROR_VERSION_UNSUPPORTED:
      return 'The server needs a different xiloader version. Run the update.'
    default:
      return fallback
  }
}

/**
 * Checks the username and password with a normal login attempt. Accounts with two-factor
 * authentication can't be checked this way; those still log in through xiloader's prompt.
 */
export async function verifyLogin(target: AuthTarget, username: string, password: string): Promise<AccountResult> {
  const invalid = validateCredentials(username, password)
  if (invalid) return { ok: false, error: invalid }
  try {
    const r = await authRequest(target, { command: Cmd.LOGIN, username, password })
    return r.result === Result.SUCCESS ? { ok: true } : { ok: false, error: errorFromReply(r, 'Login failed.') }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function createAccount(target: AuthTarget, username: string, password: string): Promise<AccountResult> {
  const invalid = validateCredentials(username, password)
  if (invalid) return { ok: false, error: invalid }
  try {
    const r = await authRequest(target, { command: Cmd.CREATE, username, password })
    return r.result === Result.SUCCESS_CREATE ? { ok: true } : { ok: false, error: errorFromReply(r, 'Account creation failed.') }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function changePassword(target: AuthTarget, username: string, password: string, newPassword: string): Promise<AccountResult> {
  const invalid = validateCredentials(username, password) ?? validateCredentials(username, newPassword)
  if (invalid) return { ok: false, error: invalid }
  try {
    const r = await authRequest(target, { command: Cmd.CHANGE_PASSWORD, username, password, new_password: newPassword })
    return r.result === Result.SUCCESS_CHANGE_PASSWORD ? { ok: true } : { ok: false, error: errorFromReply(r, 'Password change failed.') }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
