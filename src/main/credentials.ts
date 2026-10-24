import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Secrets are encrypted with the OS keychain (DPAPI on Windows, the Secret Service/KWallet on
// Linux) via safeStorage. Where no keychain is available they are not stored at all.

function save(name: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) return
  writeFileSync(join(app.getPath('userData'), name), safeStorage.encryptString(value), { mode: 0o600 })
}

function load(name: string): string {
  const file = join(app.getPath('userData'), name)
  try {
    if (existsSync(file) && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(readFileSync(file))
  } catch {
    // Unreadable (e.g. copied from another machine): treat as nothing saved.
  }
  return ''
}

const clear = (name: string): void => rmSync(join(app.getPath('userData'), name), { force: true })

// Password: only used when the launcher signs in to the login server directly (no website).
export const savePassword = (password: string): void => save('credentials.bin', password)
export const loadPassword = (): string => load('credentials.bin')
export const clearPassword = (): void => clear('credentials.bin')

// Website session token ("remember me").
export const saveSession = (token: string): void => save('session.bin', token)
export const loadSession = (): string => load('session.bin')
export const clearSession = (): void => clear('session.bin')
