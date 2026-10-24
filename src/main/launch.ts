import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LaunchResult, LauncherConfig, UserSettings } from '../shared/types'
import { ashitaCli, ashitaDir, scanAddons, writeProfile, xiloaderPath } from './ashita'
import { overlaysForLaunch } from './pivot'
import { isWindows, preparePrefix, resolveRunner, startWithWine } from './wine'

// Credentials are handed to xiloader through a short-lived JSON file (xiloader --json)
// instead of --user/--pass, so nothing secret appears in the process list. With the website
// sign-in that file holds a single-use launch token ("login_token") instead of a password.
const pendingCredentialFiles = new Set<string>()

/** How long the credentials file survives after Ashita has started (it reads it within seconds). */
const CREDENTIALS_TTL_MS = 60_000

export interface GameLogin {
  username: string
  password?: string
  /** Launch token from the website; sent instead of the password. */
  loginToken?: string
}

function writeCredentialFile(login: GameLogin): string {
  const path = join(tmpdir(), `xil-${randomBytes(8).toString('hex')}.json`)
  const payload = login.loginToken ? { username: login.username, login_token: login.loginToken } : { username: login.username, password: login.password }
  writeFileSync(path, JSON.stringify(payload), { mode: 0o600 })
  pendingCredentialFiles.add(path)
  return path
}

function removeCredentialFile(path: string): void {
  rmSync(path, { force: true })
  pendingCredentialFiles.delete(path)
}

export function cleanupCredentialFiles(): void {
  for (const p of [...pendingCredentialFiles]) removeCredentialFile(p)
}

/**
 * Starts a program through ShellExecute, the way Explorer does.
 *
 * Ashita-cli.exe's manifest says requireAdministrator, so Node's spawn() (CreateProcess) fails
 * with EACCES. ShellExecute instead shows the Windows UAC prompt and starts it elevated.
 * Paths and arguments go through environment variables, so nothing needs shell quoting.
 */
function startElevated(file: string, args: string, cwd: string): Promise<LaunchResult> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    '  Start-Process -FilePath $env:XIL_FILE -ArgumentList $env:XIL_ARGS -WorkingDirectory $env:XIL_CWD | Out-Null',
    '} catch {',
    '  [Console]::Error.WriteLine($_.Exception.Message)',
    '  exit 1',
    '}'
  ].join('\n')
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

  return new Promise((resolve) => {
    execFile(
      powershell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, env: { ...process.env, XIL_FILE: file, XIL_ARGS: args, XIL_CWD: cwd } },
      (err, _stdout, stderr) => {
        if (!err) return resolve({ ok: true })
        const msg = (stderr || err.message).trim()
        if (/cancel/i.test(msg)) {
          resolve({ ok: false, error: 'Windows permission was declined. Ashita needs administrator rights to start the game. Press Play and choose Yes.' })
        } else {
          resolve({ ok: false, error: `Failed to start Ashita: ${msg}` })
        }
      }
    )
  })
}

export async function launchGame(
  cfg: LauncherConfig,
  settings: UserSettings,
  /** The login, or a function that fetches it (called as late as possible: launch tokens expire). */
  getLogin: GameLogin | null | (() => Promise<GameLogin | null>),
  onStatus: (msg: string) => void = () => {}
): Promise<LaunchResult> {
  const dir = settings.installDir
  if (!existsSync(ashitaCli(dir))) return { ok: false, error: 'Ashita is missing. Run the update first.' }
  if (!existsSync(xiloaderPath(dir))) return { ok: false, error: 'xiloader is missing. Run the update first.' }

  // Linux: get the runtime (downloading GE-Proton the first time) and make sure the prefix is ready.
  let runner = null
  if (!isWindows) {
    try {
      runner = await resolveRunner(cfg.linux, settings.wine, onStatus)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    const prepError = await preparePrefix(runner, dir, settings.wine, onStatus)
    if (prepError) return { ok: false, error: prepError }
    onStatus('Starting the game…')
  }

  let login: GameLogin | null
  try {
    login = typeof getLogin === 'function' ? await getLogin() : getLogin
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const creds = login && login.username && (login.password || login.loginToken) ? writeCredentialFile(login) : null
  const list = scanAddons(dir, cfg, settings)
  await writeProfile(dir, cfg, settings, list, { credentialsJson: creds, pivotOverlays: overlaysForLaunch(dir, cfg, settings) })

  // Windows: resolves once the UAC prompt is answered and Ashita has started (or failed to).
  // Linux: Wine/Proton ignores Ashita's administrator request, so it is started directly.
  const result = runner
    ? await startWithWine(runner, dir, settings.wine, ashitaCli(dir), [`${cfg.serverId}.ini`], ashitaDir(dir))
    : await startElevated(ashitaCli(dir), `${cfg.serverId}.ini`, ashitaDir(dir))

  if (creds) {
    if (result.ok) setTimeout(() => removeCredentialFile(creds), CREDENTIALS_TTL_MS).unref()
    else removeCredentialFile(creds)
  }
  return result
}
