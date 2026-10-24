// Linux support: runs Ashita (and through it xiloader and the game) with Proton or Wine.
//
// Two runtimes:
//   managed  GE-Proton downloaded by the launcher, run with umu-launcher (the standard way to use Proton
//            outside Steam; also what Heroic/Lutris/Faugus use). Works on desktops and the Steam Deck.
//   custom   any Wine build on the PC (system wine, Lutris runner) or a Proton folder the player picks.
//
// The Wine prefix lives in <install folder>/wineprefix by default. On first use the launcher installs the
// Windows components the game and Ashita need with winetricks (vcrun2022, gdiplus, fonts) and sets the
// Windows version to 10, then remembers what it installed in <prefix>/.xi-components.json.
//
// No Electron imports, so this can be unit-tested with plain Node.

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, createReadStream, createWriteStream, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join, sep } from 'node:path'
import type { LinuxConfig, LinuxRuntimeStatus, PrefixComponents, WineRunner, WineSettings } from '../shared/types'
import { download } from './pivot'

export const isWindows = process.platform === 'win32'

/** Linux path -> path a Windows program running under Wine understands (Wine maps Z: to /). */
export function toGamePath(p: string): string {
  if (isWindows) return p
  return 'Z:' + p.split(sep).join('\\')
}

/**
 * Finds a file case-insensitively on Linux. Windows is case-insensitive and the game files keep their
 * Windows names (e.g. "Ashita-cli.exe" vs "ashita-cli.exe"), so lookups must ignore case.
 * Returns the real path, or null if it doesn't exist.
 */
export function findPath(base: string, ...parts: string[]): string | null {
  let cur = base
  if (!existsSync(cur)) return null
  for (const part of parts) {
    const direct = join(cur, part)
    if (existsSync(direct)) {
      cur = direct
      continue
    }
    if (isWindows) return null
    let entries: string[]
    try {
      entries = readdirSync(cur)
    } catch {
      return null
    }
    const match = entries.find((e) => e.toLowerCase() === part.toLowerCase())
    if (!match) return null
    cur = join(cur, match)
  }
  return cur
}

// ------------------------------------------------------------------------------------------- paths

let runtimeRoot = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'xi-launcher', 'runtimes')
/** Where GE-Proton, umu-launcher and winetricks are kept (set from the app name at startup). */
export function setRuntimeRoot(dir: string): void {
  runtimeRoot = dir
}
export const getRuntimeRoot = (): string => runtimeRoot

export const prefixPath = (installDir: string, w: WineSettings): string => w.prefix || join(installDir, 'wineprefix')
export const wineLogPath = (installDir: string): string => join(installDir, 'wine.log')

// ------------------------------------------------------------------------------------------- helpers

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter((d) => {
      try {
        return statSync(join(dir, d)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

function which(cmd: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && isFile(join(dir, cmd))) return join(dir, cmd)
  }
  return null
}

function wineVersion(path: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(path, ['--version'], { timeout: 8000, env: { ...process.env, WINEDEBUG: '-all' } }, (err, stdout) => {
      resolve(err ? '' : stdout.trim())
    })
  })
}

function run(file: string, args: string[], env: NodeJS.ProcessEnv, opts: { cwd?: string; timeoutMs?: number; log?: string } = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(file, args, { env, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return resolve({ code: -1, out: e instanceof Error ? e.message : String(e) })
    }
    const logStream = opts.log ? createWriteStream(opts.log, { flags: 'a' }) : null
    let out = ''
    const keep = (d: Buffer): void => {
      out = (out + d.toString()).slice(-12000)
      logStream?.write(d)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const t = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 300_000)
    child.on('error', (e) => {
      clearTimeout(t)
      logStream?.end()
      resolve({ code: -1, out: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(t)
      logStream?.end()
      resolve({ code, out })
    })
  })
}

const lastLines = (s: string, n = 3): string => s.split('\n').map((l) => l.trim()).filter(Boolean).slice(-n).join(' ')

function extraEnv(w: WineSettings): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of (w.extraEnv || '').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

// ------------------------------------------------------------------------------------------- custom runtimes (detected)

/** Wine builds and Proton folders found on this PC, best guess first. */
export async function findRunners(): Promise<WineRunner[]> {
  if (isWindows) return []
  const home = homedir()
  const found: WineRunner[] = []
  const add = (path: string, label: string, kind: 'wine' | 'umu' = 'wine', protonPath?: string): void => {
    if (isFile(path) && !found.some((f) => f.path === path && f.protonPath === protonPath)) found.push({ path, label, version: '', kind, protonPath })
  }

  // System Wine (wine / wine-staging / WineHQ packages)
  for (const dir of (process.env.PATH ?? '').split(delimiter)) if (dir) add(join(dir, 'wine'), 'System Wine')
  for (const p of ['/usr/bin/wine', '/usr/local/bin/wine', '/opt/wine-staging/bin/wine', '/opt/wine-stable/bin/wine', '/opt/wine-devel/bin/wine']) {
    add(p, 'System Wine')
  }

  // Lutris runners (wine-ge, …)
  for (const base of [join(home, '.local/share/lutris/runners/wine'), join(home, '.var/app/net.lutris.Lutris/data/lutris/runners/wine')]) {
    for (const d of subdirs(base)) add(join(base, d, 'bin', 'wine'), `Lutris: ${d}`)
  }

  // Proton builds from Steam (GE-Proton via ProtonUp-Qt, Valve Proton): their bundled wine binary.
  const steamRoots = [join(home, '.steam/root'), join(home, '.steam/steam'), join(home, '.local/share/Steam'), join(home, '.var/app/com.valvesoftware.Steam/data/Steam')]
  for (const root of steamRoots) {
    const compat = join(root, 'compatibilitytools.d')
    for (const d of subdirs(compat)) add(join(compat, d, 'files', 'bin', 'wine'), `${d} (wine)`)
    const common = join(root, 'steamapps', 'common')
    for (const d of subdirs(common).filter((n) => /^Proton/i.test(n))) add(join(common, d, 'files', 'bin', 'wine'), `${d} (wine)`)
  }

  return Promise.all(found.map(async (f) => ({ ...f, version: await wineVersion(f.path) })))
}

// ------------------------------------------------------------------------------------------- managed runtime (GE-Proton + umu)

const GE_REPO = 'GloriousEggroll/proton-ge-custom'
const UMU_REPO = 'Open-Wine-Components/umu-launcher'
const umuPath = (): string => join(runtimeRoot, 'umu', 'umu-run')

/** GE-Proton folders already downloaded, newest first. */
// GE-Proton now publishes ARM builds ("GE-Proton11-11-aarch64") next to the normal x86_64 ones.
const ARM_RE = /aarch64|arm64/i
const rightArch = (name: string): boolean => (process.arch === 'arm64' ? ARM_RE.test(name) : !ARM_RE.test(name))

export function installedProtons(): string[] {
  return subdirs(runtimeRoot)
    .filter((d) => /^GE-Proton/i.test(d) && rightArch(d) && isFile(join(runtimeRoot, d, 'proton')))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
}

/**
 * The downloaded folder for a pinned GE-Proton version. Releases that also ship ARM builds name
 * their files with a CPU suffix ("GE-Proton11-5-x86_64"), so the folder may not equal the tag.
 */
function installedProton(version: string): string | null {
  const v = version.toLowerCase()
  return installedProtons().find((d) => d.toLowerCase() === v || d.toLowerCase().startsWith(`${v}-`)) ?? null
}

async function githubRelease(repo: string, tag: string): Promise<{ tag: string; assets: { name: string; url: string; size: number }[] }> {
  const api = `https://api.github.com/repos/${repo}/releases/${tag ? `tags/${encodeURIComponent(tag)}` : 'latest'}`
  const res = await fetch(api, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'xi-launcher' }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status} for ${repo}${tag ? ` ${tag}` : ''}`)
  const j = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string; size: number }[] }
  return { tag: j.tag_name, assets: j.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })) }
}

function sha512(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha512')
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

const pct = (done: number, total: number): string => (total > 0 ? ` ${Math.floor((done / total) * 100)}%` : '')

/** Downloads GE-Proton if needed. Returns its folder. */
export async function ensureProton(cfg: LinuxConfig, onStatus: (msg: string) => void): Promise<string> {
  await mkdir(runtimeRoot, { recursive: true })
  // Clean up builds for the wrong CPU (an earlier version could download the ARM build by mistake).
  for (const d of subdirs(runtimeRoot)) if (/^GE-Proton/i.test(d) && !rightArch(d)) await rm(join(runtimeRoot, d), { recursive: true, force: true })
  const wanted = cfg.protonVersion.trim()
  if (wanted) {
    const have = installedProton(wanted)
    if (have) return join(runtimeRoot, have)
  }
  if (!wanted && !cfg.protonUrl) {
    const have = installedProtons()
    if (have.length) return join(runtimeRoot, have[0])
  }

  let url: string
  let name: string
  let checksumUrl = ''
  let size = 0
  if (cfg.protonUrl) {
    url = cfg.protonUrl
    name = basename(new URL(url).pathname).replace(/\.tar\.(gz|xz|zst)$/i, '')
    if (!rightArch(name)) throw new Error(`linux.protonUrl points to ${name}, which is for a different CPU than this PC (${process.arch}).`)
    if (isFile(join(runtimeRoot, name, 'proton'))) return join(runtimeRoot, name)
  } else {
    onStatus('Looking up GE-Proton…')
    const rel = await githubRelease(GE_REPO, wanted)
    const tars = rel.assets.filter((a) => /\.tar\.gz$/i.test(a.name) && rightArch(a.name))
    // Prefer the plain "<tag>.tar.gz" build.
    const tar = tars.find((a) => a.name === `${rel.tag}.tar.gz`) ?? tars[0]
    if (!tar) throw new Error(`No GE-Proton download for this PC (${process.arch}) found in release ${rel.tag}.`)
    url = tar.url
    size = tar.size
    name = tar.name.replace(/\.tar\.gz$/i, '')
    checksumUrl = rel.assets.find((a) => a.name === `${name}.sha512sum`)?.url ?? ''
  }

  const dl = join(runtimeRoot, '.downloads')
  await mkdir(dl, { recursive: true })
  const file = join(dl, `${name}.tar.gz`)
  try {
    await download(url, file, (done, total) => onStatus(`Downloading ${name}…${pct(done, total)}`), size)
    if (checksumUrl) {
      onStatus(`Checking ${name}…`)
      const expected = (await (await fetch(checksumUrl)).text()).trim().split(/\s+/)[0].toLowerCase()
      if (/^[0-9a-f]{128}$/.test(expected) && (await sha512(file)) !== expected) throw new Error('The GE-Proton download is corrupted (checksum mismatch). Try again.')
    }
    onStatus(`Unpacking ${name}…`)
    const r = await run('tar', ['-xzf', file, '-C', runtimeRoot], process.env, { timeoutMs: 15 * 60_000 })
    if (r.code !== 0) throw new Error(`Couldn't unpack GE-Proton: ${lastLines(r.out)}`)
  } finally {
    await rm(file, { force: true })
  }
  if (!isFile(join(runtimeRoot, name, 'proton'))) {
    const found = installedProtons()[0]
    if (!found) throw new Error('GE-Proton was unpacked but its "proton" script is missing.')
    return join(runtimeRoot, found)
  }
  return join(runtimeRoot, name)
}

function findFile(dir: string, name: string, depth = 0): string | null {
  if (depth > 4) return null
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (n === name && isFile(p)) return p
    if (statSync(p).isDirectory()) {
      const hit = findFile(p, name, depth + 1)
      if (hit) return hit
    }
  }
  return null
}

/** Downloads umu-launcher (the zipapp build, needs python3) if needed. Returns the umu-run path. */
export async function ensureUmu(cfg: LinuxConfig, onStatus: (msg: string) => void): Promise<string> {
  if (isFile(umuPath())) return umuPath()
  if (!which('python3')) throw new Error('python3 is needed to run Proton. Install it (sudo dnf install python3 / sudo apt install python3) and try again.')
  let url = cfg.umuUrl
  if (!url) {
    onStatus('Looking up umu-launcher…')
    const rel = await githubRelease(UMU_REPO, '')
    const asset = rel.assets.find((a) => /zipapp.*\.tar(\.gz)?$/i.test(a.name))
    if (!asset) throw new Error(`No umu-launcher zipapp download found in release ${rel.tag}.`)
    url = asset.url
  }
  const dl = join(runtimeRoot, '.downloads')
  const tmp = join(dl, 'umu-extract')
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  const file = join(dl, 'umu.tar')
  try {
    await download(url, file, (done, total) => onStatus(`Downloading umu-launcher…${pct(done, total)}`))
    const r = await run('tar', ['-xf', file, '-C', tmp], process.env)
    if (r.code !== 0) throw new Error(`Couldn't unpack umu-launcher: ${lastLines(r.out)}`)
    const found = findFile(tmp, 'umu-run')
    if (!found) throw new Error('umu-run was not found in the umu-launcher download.')
    await mkdir(dirname(umuPath()), { recursive: true })
    renameSync(found, umuPath())
    chmodSync(umuPath(), 0o755)
  } finally {
    await rm(tmp, { recursive: true, force: true })
    await rm(file, { force: true })
  }
  return umuPath()
}

// ------------------------------------------------------------------------------------------- choosing the runtime

/** Which runtime to use, without downloading anything (for status display). */
export async function describeRunner(w: WineSettings): Promise<WineRunner | null> {
  if (w.runtime === 'managed') {
    const p = installedProtons()[0]
    return { path: umuPath(), label: 'GE-Proton (managed)', version: p ?? 'downloads on first Play', kind: 'umu', protonPath: p ? join(runtimeRoot, p) : undefined }
  }
  return pickCustomRunner(w)
}

async function pickCustomRunner(w: WineSettings): Promise<WineRunner | null> {
  if (w.runner) {
    // A Proton folder (has a "proton" script) is run with umu; anything else is a wine binary.
    if (isFile(join(w.runner, 'proton'))) return { path: umuPath(), label: basename(w.runner), version: basename(w.runner), kind: 'umu', protonPath: w.runner }
    if (isFile(w.runner)) return { path: w.runner, label: 'Selected', version: await wineVersion(w.runner), kind: 'wine' }
  }
  return (await findRunners())[0] ?? null
}

/** The runtime to launch with, downloading GE-Proton / umu when needed. */
export async function resolveRunner(cfg: LinuxConfig, w: WineSettings, onStatus: (msg: string) => void): Promise<WineRunner> {
  if (w.runtime === 'managed' || (w.runner && isFile(join(w.runner, 'proton')))) {
    const protonPath = w.runtime === 'managed' ? await ensureProton(cfg, onStatus) : w.runner
    const umu = await ensureUmu(cfg, onStatus)
    return { path: umu, label: basename(protonPath), version: basename(protonPath), kind: 'umu', protonPath }
  }
  const r = await pickCustomRunner(w)
  if (!r) throw new Error('No Wine was found. Choose "GE-Proton (recommended)" in Settings → Linux, or install Wine (sudo dnf install wine).')
  return r
}

// ------------------------------------------------------------------------------------------- environment

function baseEnv(runner: WineRunner, prefix: string, w: WineSettings): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WINEPREFIX: prefix,
    // No Mono/Gecko install dialogs; the game doesn't need .NET or the HTML engine.
    WINEDLLOVERRIDES: 'mscoree,mshtml=',
    WINEDEBUG: w.debugLog ? 'err+all,fixme-all' : '-all'
  }
  if (runner.kind === 'umu') {
    env.PROTONPATH = runner.protonPath
    env.GAMEID = 'umu-default'
    env.STORE = 'none'
    if (w.debugLog) {
      env.UMU_LOG = '1'
      env.PROTON_LOG = '1'
    }
  } else {
    const server = join(dirname(runner.path), 'wineserver')
    env.WINE = runner.path
    if (isFile(server)) env.WINESERVER = server
    env.PATH = `${dirname(runner.path)}${delimiter}${process.env.PATH ?? ''}`
  }
  return { ...env, ...extraEnv(w) }
}

/** Runs a Windows program (or a wine built-in like "reg") in the prefix and waits for it. */
function runInPrefix(runner: WineRunner, prefix: string, w: WineSettings, args: string[], log: string, timeoutMs = 600_000) {
  return run(runner.path, args, baseEnv(runner, prefix, w), { timeoutMs, log })
}

// ------------------------------------------------------------------------------------------- prefix setup

const COMPONENT_VERBS: Record<keyof PrefixComponents, string> = { vcrun: 'vcrun2022', gdiplus: 'gdiplus', fonts: 'allfonts' }
const DONE_FILE = '.xi-components.json'

function recorded(prefix: string): string[] {
  try {
    const v = JSON.parse(readFileSync(join(prefix, DONE_FILE), 'utf8'))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** The Wine prefix root (Proton keeps it in a "pfx" folder). */
function prefixRoot(prefix: string): string {
  return !existsSync(join(prefix, 'system.reg')) && existsSync(join(prefix, 'pfx', 'system.reg')) ? join(prefix, 'pfx') : prefix
}

function readText(p: string): string {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

/** A real Microsoft DLL, not Wine's built-in stand-in (those contain "Wine placeholder DLL" / "Wine builtin DLL"). */
function isNativeDll(p: string): boolean {
  try {
    const b = readFileSync(p)
    return b.length > 0 && !b.includes('Wine placeholder DLL') && !b.includes('Wine builtin DLL')
  } catch {
    return false
  }
}

/**
 * Checks the prefix itself for each component instead of trusting exit codes
 * (umu-run can report success even when Proton failed to start).
 */
export function verifyComponent(prefix: string, verb: string): boolean {
  const root = prefixRoot(prefix)
  const userReg = readText(join(root, 'user.reg'))
  const sysReg = readText(join(root, 'system.reg'))
  // 32-bit DLLs live in syswow64 in a 64-bit prefix, in system32 in a 32-bit one.
  const dll32 = (n: string): string =>
    existsSync(join(root, 'drive_c', 'windows', 'syswow64')) ? join(root, 'drive_c', 'windows', 'syswow64', n) : join(root, 'drive_c', 'windows', 'system32', n)
  switch (verb) {
    case 'win10':
      return /"Version"="win10"/i.test(userReg) || /"CurrentBuildNumber"="(1\d{4}|2\d{4})"/.test(sysReg)
    case 'vcrun2022':
      return isNativeDll(dll32('vcruntime140.dll')) && isNativeDll(dll32('msvcp140.dll'))
    case 'gdiplus':
      return isNativeDll(dll32('gdiplus.dll'))
    case 'allfonts': {
      try {
        return readdirSync(join(root, 'drive_c', 'windows', 'Fonts')).filter((f) => /\.tt[fc]$/i.test(f)).length > 40
      } catch {
        return false
      }
    }
    default:
      return recorded(prefix).includes(verb)
  }
}

/** Components that are really installed in the prefix. */
function doneComponents(prefix: string): string[] {
  return [...new Set([...recorded(prefix), 'win10', 'vcrun2022', 'gdiplus', 'allfonts'])].filter((v) => verifyComponent(prefix, v))
}

function saveDone(prefix: string): string[] {
  const all = doneComponents(prefix)
  writeFileSync(join(prefix, DONE_FILE), JSON.stringify(all))
  return all
}

const DEFAULT_WINETRICKS_URL = 'https://raw.githubusercontent.com/Winetricks/winetricks/master/src/winetricks'
let winetricksUrl = DEFAULT_WINETRICKS_URL
/** Where to download winetricks from (launcher.config.json linux.winetricksUrl; empty = GitHub). */
export function setWinetricksUrl(url: string): void {
  winetricksUrl = url.trim() || DEFAULT_WINETRICKS_URL
}

/** winetricks for custom Wine: the system one, or a copy downloaded into the runtime folder. */
async function winetricksPath(onStatus: (msg: string) => void): Promise<string | null> {
  const sys = which('winetricks')
  if (sys) return sys
  const local = join(runtimeRoot, 'winetricks')
  if (isFile(local)) return local
  try {
    onStatus('Downloading winetricks…')
    await mkdir(runtimeRoot, { recursive: true })
    await download(winetricksUrl, local, () => {})
    chmodSync(local, 0o755)
    return local
  } catch {
    return null
  }
}

const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x86.exe'

/** Last-resort installs when winetricks isn't available or fails. */
async function fallbackSetup(runner: WineRunner, prefix: string, w: WineSettings, verbs: string[], log: string, onStatus: (msg: string) => void): Promise<string[]> {
  const ok: string[] = []
  if (verbs.includes('win10')) {
    const r = await runInPrefix(runner, prefix, w, ['reg', 'add', 'HKCU\\Software\\Wine', '/v', 'Version', '/d', 'win10', '/f'], log, 180_000)
    if (r.code === 0) ok.push('win10')
  }
  if (verbs.includes('vcrun2022')) {
    onStatus('Installing the Visual C++ runtime…')
    const installer = join(runtimeRoot, '.downloads', 'vc_redist.x86.exe')
    try {
      await mkdir(dirname(installer), { recursive: true })
      if (!isFile(installer)) await download(VC_REDIST_URL, installer, () => {})
      const r = await runInPrefix(runner, prefix, w, [installer, '/install', '/quiet', '/norestart'], log)
      // 0 = installed, 1638 = newer already there, 3010 = needs reboot (fine under Wine)
      if (r.code === 0 || r.code === 1638 || r.code === 3010) ok.push('vcrun2022')
    } catch {
      /* reported by the caller */
    }
  }
  return ok
}

/**
 * Creates the prefix on first use and installs the selected components (plus Windows 10 mode).
 * Returns an error message, or null when the game can start. Missing optional components only warn.
 */
export async function preparePrefix(runner: WineRunner, installDir: string, w: WineSettings, onStatus: (msg: string) => void): Promise<string | null> {
  const prefix = prefixPath(installDir, w)
  const log = join(installDir, 'wine-setup.log')
  await mkdir(prefix, { recursive: true })
  writeFileSync(log, `# ${new Date().toISOString()} setup with ${runner.label} (${runner.version})\n`)

  const done = doneComponents(prefix)
  const wanted = ['win10', ...Object.entries(w.components).filter(([, on]) => on).map(([k]) => COMPONENT_VERBS[k as keyof PrefixComponents])]
  let todo = wanted.filter((v) => !done.includes(v))
  const firstTime = !existsSync(join(prefixRoot(prefix), 'system.reg'))

  if (runner.kind !== 'umu' && firstTime) {
    onStatus('Setting up Wine for the first time… (about a minute)')
    const r = await runInPrefix(runner, prefix, w, ['wineboot', '--init'], log, 300_000)
    const server = join(dirname(runner.path), 'wineserver')
    if (isFile(server)) await run(server, ['-w'], baseEnv(runner, prefix, w), { timeoutMs: 120_000 })
    if (!existsSync(join(prefixRoot(prefix), 'system.reg'))) return `Wine couldn't create its settings folder (${prefix}). ${lastLines(r.out)} See ${log}`
  }
  if (!todo.length) return null

  // Fonts and GDI+ need cabextract when using the system winetricks.
  if (runner.kind !== 'umu' && !which('cabextract')) {
    const skipped: string[] = todo.filter((v) => v === 'gdiplus' || v === 'allfonts')
    if (skipped.length) {
      onStatus(`Skipping ${skipped.join(', ')}: install "cabextract" to add them.`)
      todo = todo.filter((v) => !skipped.includes(v))
    }
  }

  onStatus(
    runner.kind === 'umu'
      ? firstTime
        ? 'Setting up the Linux environment… The first time this downloads the Steam Linux Runtime and can take several minutes.'
        : `Installing ${todo.join(', ')}…`
      : `Installing ${todo.join(', ')} with winetricks… (a few minutes)`
  )

  if (runner.kind === 'umu') {
    // umu runs GE-Proton's bundled winetricks: "umu-run winetricks <verbs>".
    await runInPrefix(runner, prefix, w, ['winetricks', '-q', ...todo], log, 45 * 60_000)
  } else {
    const wt = await winetricksPath(onStatus)
    if (wt) await run(wt, ['-q', '--unattended', ...todo], baseEnv(runner, prefix, w), { timeoutMs: 45 * 60_000, log })
  }

  // Check what actually landed in the prefix; retry what's missing the direct way.
  const rest = todo.filter((v) => !verifyComponent(prefix, v))
  if (rest.length) {
    appendFileSync(log, `\n# not installed after winetricks: ${rest.join(', ')}; trying the direct way\n`)
    await fallbackSetup(runner, prefix, w, rest, log, onStatus)
  }
  const nowDone = saveDone(prefix)
  const missing = todo.filter((v) => !nowDone.includes(v))
  appendFileSync(log, `\n# installed: ${nowDone.join(', ') || 'nothing'}${missing.length ? `; missing: ${missing.join(', ')}` : ''}\n`)

  if (missing.includes('vcrun2022')) {
    return `The Visual C++ runtime couldn't be installed into the Wine prefix, and the game can't start without it. See ${log}, or try "Recreate Linux environment" in Settings → Linux.`
  }
  if (missing.includes('win10') && firstTime && runner.kind === 'umu' && !existsSync(join(prefixRoot(prefix), 'system.reg'))) {
    return `The Linux environment couldn't be set up. See ${log}`
  }
  if (missing.length) onStatus(`Couldn't install ${missing.join(', ')} (see wine-setup.log). Starting anyway…`)
  return null
}

/** Deletes the launcher's own prefix so it is rebuilt on the next Play. A custom prefix folder is never deleted. */
export async function recreatePrefix(installDir: string, w: WineSettings): Promise<string | null> {
  if (w.prefix) return 'This is a custom prefix folder, so the launcher won’t delete it. Clear the prefix setting (Default) to use a fresh one.'
  await rm(prefixPath(installDir, w), { recursive: true, force: true })
  return null
}

export async function linuxStatus(installDir: string, w: WineSettings): Promise<LinuxRuntimeStatus> {
  const prefix = prefixPath(installDir, w)
  return {
    protonInstalled: installedProtons()[0] ?? '',
    umuInstalled: isFile(umuPath()),
    prefix,
    prefixExists: existsSync(join(prefixRoot(prefix), 'system.reg')),
    componentsDone: doneComponents(prefix),
    runners: await findRunners()
  }
}

// ------------------------------------------------------------------------------------------- launch

/**
 * Starts Ashita with the runtime and resolves after a few seconds: ok if it is still running (the game is
 * starting), or an error with the end of the log if it exited straight away.
 */
export async function startWithWine(
  runner: WineRunner,
  installDir: string,
  w: WineSettings,
  exe: string,
  args: string[],
  cwd: string
): Promise<{ ok: boolean; error?: string }> {
  const prefix = prefixPath(installDir, w)
  const logFile = wineLogPath(installDir)
  const log = createWriteStream(logFile, { flags: 'w' })
  log.write(`# ${new Date().toISOString()} ${runner.kind === 'umu' ? `umu-run + ${runner.protonPath}` : runner.path} (${runner.version || 'unknown version'})\n# WINEPREFIX=${prefix}\n`)

  let child
  try {
    child = spawn(runner.path, [exe, ...args], { cwd, env: baseEnv(runner, prefix, w), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    return { ok: false, error: `Couldn't start the game: ${e instanceof Error ? e.message : String(e)}` }
  }
  child.stdout?.pipe(log, { end: false })
  child.stderr?.pipe(log, { end: false })

  const exited = await new Promise<number | null | 'running'>((resolve) => {
    const t = setTimeout(() => resolve('running'), 8000)
    child.on('error', () => {
      clearTimeout(t)
      resolve(-1)
    })
    child.on('exit', (code) => {
      clearTimeout(t)
      resolve(code)
    })
  })
  child.unref()

  if (exited === 'running' || exited === 0) return { ok: true }
  await new Promise((r) => setTimeout(r, 300))
  let tail = ''
  try {
    tail = lastLines((await readFile(logFile, 'utf8')).split('\n').filter((l) => !l.startsWith('#')).join('\n'), 4)
  } catch {
    /* no log */
  }
  return { ok: false, error: `The game exited right away (code ${exited}). ${tail ? `Last messages: ${tail}` : ''} Full log: ${logFile}` }
}
