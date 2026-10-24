// XIPivot overlay ("Pivot") pack management. No Electron imports, so it can be tested with plain Node.
//
// Packs live in Ashita/polplugins/DATs/<id>/ (the folder XIPivot reads by default), each containing
// ROM/, ROM2/, ... folders that shadow the game's DAT files. Nothing in the game install is modified.
//
//   DATs/<id>/.pack.json     written on install: { id, name, category, version }
//   DATs/.downloads/         temporary zip downloads
//
// Three kinds of overlays:
//   server   cfg.requiredOverlays, shipped with the client by the patcher, always on, loaded first
//   local    folders the player picked with "Browse", linked into DATs/ with a directory junction
//   catalog  optional packs from the server's pivot.json, downloaded on demand; one per category

import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir, rename, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import yauzl from 'yauzl'
import type { LauncherConfig, LocalOverlay, PivotEntry, PivotPack, PivotProgress, PivotState, UserSettings } from '../shared/types'
import { pivotDatsDir, pivotDll } from './ashita'
import { freeSpace, safeJoin } from './patcher'

const ID_RE = /^[A-Za-z0-9._-]{1,64}$/
const ROM_DIR_RE = /^(rom\d*|sound\d*)$/i
const CUSTOM = 'Custom'
const SERVER = 'Server'

interface PackMeta {
  id: string
  name: string
  category: string
  version?: string
}

// ---------------------------------------------------------------------------------------------
// Catalog

let catalogCache: { url: string; at: number; packs: PivotPack[]; error?: string } | null = null
const CATALOG_TTL_MS = 5 * 60_000

export function validateCatalog(raw: unknown): PivotPack[] {
  const list = Array.isArray(raw) ? raw : (raw as { packs?: unknown })?.packs
  if (!Array.isArray(list)) throw new Error('pivot.json must be an array of packs (or { "packs": [...] })')
  const seen = new Set<string>()
  const out: PivotPack[] = []
  for (const p of list as Partial<PivotPack>[]) {
    if (!p || typeof p !== 'object') continue
    if (typeof p.id !== 'string' || !ID_RE.test(p.id) || p.id.startsWith('local-') || p.id.startsWith('.')) continue
    if (typeof p.url !== 'string' || !/^https?:\/\//.test(p.url)) continue
    if (seen.has(p.id)) continue
    seen.add(p.id)
    const links = p.links && typeof p.links === 'object'
      ? Object.fromEntries(Object.entries(p.links).filter(([, v]) => typeof v === 'string' && /^https?:\/\//.test(v)))
      : undefined
    out.push({
      id: p.id,
      name: typeof p.name === 'string' && p.name ? p.name : p.id,
      category: typeof p.category === 'string' && p.category ? p.category : 'Other',
      description: typeof p.description === 'string' ? p.description : undefined,
      author: typeof p.author === 'string' ? p.author : undefined,
      links,
      url: p.url,
      size: typeof p.size === 'number' && p.size > 0 ? p.size : undefined,
      sha256: typeof p.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(p.sha256) ? p.sha256.toLowerCase() : undefined,
      version: typeof p.version === 'string' ? p.version : undefined
    })
  }
  return out
}

export async function getCatalog(url: string, force = false): Promise<{ packs: PivotPack[]; error?: string }> {
  if (!url) return { packs: [] }
  if (!force && catalogCache && catalogCache.url === url && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache
  }
  try {
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const packs = validateCatalog(await res.json())
    catalogCache = { url, at: Date.now(), packs }
  } catch (e) {
    // Keep showing what we had before if the catalog is temporarily unreachable.
    const error = `Couldn't load the pack list: ${e instanceof Error ? e.message : String(e)}`
    catalogCache = { url, at: Date.now(), packs: catalogCache?.url === url ? catalogCache.packs : [], error }
  }
  return catalogCache
}

// ---------------------------------------------------------------------------------------------
// Installed state

const packDir = (installDir: string, id: string): string => join(pivotDatsDir(installDir), id)

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function readMeta(installDir: string, id: string): PackMeta | null {
  try {
    return JSON.parse(readFileSync(join(packDir(installDir, id), '.pack.json'), 'utf8'))
  } catch {
    return null
  }
}

/** Every catalog pack installed on disk (has .pack.json), including ones no longer in the catalog. */
function installedPacks(installDir: string): PackMeta[] {
  const root = pivotDatsDir(installDir)
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((n) => ID_RE.test(n) && !n.startsWith('.') && !n.startsWith('local-'))
    .map((n) => readMeta(installDir, n))
    .filter((m): m is PackMeta => !!m)
}

export function listPivot(installDir: string, cfg: LauncherConfig, s: UserSettings, catalog: PivotPack[], catalogError?: string): PivotState {
  const packs: PivotEntry[] = []

  for (const id of cfg.requiredOverlays.filter((o) => ID_RE.test(o))) {
    packs.push({
      id, name: id, category: SERVER, url: '', source: 'server',
      installed: isDir(packDir(installDir, id)), updateAvailable: false, enabled: true, locked: true,
      description: 'Shipped with the game by the server.'
    })
  }

  const known = new Set<string>()
  for (const p of catalog) {
    known.add(p.id)
    const meta = readMeta(installDir, p.id)
    const installed = !!meta && isDir(packDir(installDir, p.id))
    packs.push({
      ...p, source: 'catalog', installed, installedVersion: meta?.version,
      updateAvailable: installed && !!p.version && meta?.version !== p.version,
      enabled: installed && !!s.pivot.enabled[p.id], locked: false
    })
  }
  // Installed packs that the catalog no longer lists (or the catalog is offline): still usable.
  for (const meta of installedPacks(installDir)) {
    if (known.has(meta.id)) continue
    packs.push({
      id: meta.id, name: meta.name, category: meta.category, version: meta.version, url: '', source: 'catalog',
      installed: true, installedVersion: meta.version, updateAvailable: false,
      enabled: !!s.pivot.enabled[meta.id], locked: false
    })
  }

  for (const l of s.pivot.local) {
    packs.push({
      id: l.id, name: l.name, category: CUSTOM, url: '', description: l.path, source: 'local',
      installed: isDir(packDir(installDir, l.id)), updateAvailable: false,
      enabled: s.pivot.enabled[l.id] !== false, locked: false
    })
  }

  const categories: string[] = []
  for (const p of packs) if (!categories.includes(p.category)) categories.push(p.category)
  // Server first, catalog categories in catalog order, Custom last.
  categories.sort((a, b) => (a === SERVER ? -1 : b === SERVER ? 1 : a === CUSTOM ? 1 : b === CUSTOM ? -1 : 0))

  return { available: existsSync(pivotDll(installDir)), packs, categories, catalogError }
}

/** Overlay folder names for the Pivot config, in load order (first match wins), or null if Pivot is off. */
export function overlaysForLaunch(installDir: string, cfg: LauncherConfig, s: UserSettings): string[] | null {
  if (!existsSync(pivotDll(installDir))) return null
  const out: string[] = []
  // Server content first so custom server DATs always win over cosmetic packs.
  for (const id of cfg.requiredOverlays) if (ID_RE.test(id) && isDir(packDir(installDir, id))) out.push(id)
  for (const l of s.pivot.local) if (s.pivot.enabled[l.id] !== false && isDir(packDir(installDir, l.id))) out.push(l.id)
  for (const m of installedPacks(installDir)) if (s.pivot.enabled[m.id]) out.push(m.id)
  return out
}

/** Enabling a catalog pack turns off the others in its category. Returns the new enabled map. */
export function applyEnable(installDir: string, s: UserSettings, id: string, enabled: boolean, catalog: PivotPack[]): Record<string, boolean> {
  const next = { ...s.pivot.enabled, [id]: enabled }
  if (!enabled) return next
  const category = readMeta(installDir, id)?.category ?? catalog.find((p) => p.id === id)?.category
  if (!category || category === CUSTOM) return next
  for (const m of installedPacks(installDir)) if (m.id !== id && m.category === category) next[m.id] = false
  return next
}

// ---------------------------------------------------------------------------------------------
// Install / remove

/** Finds the folder in an extracted zip that holds ROM/ (zips often wrap everything in one folder). */
function findOverlayRoot(dir: string, depth = 0): string | null {
  const entries = readdirSync(dir, { withFileTypes: true })
  if (entries.some((e) => e.isDirectory() && ROM_DIR_RE.test(e.name))) return dir
  if (depth >= 3) return null
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = findOverlayRoot(join(dir, e.name), depth + 1)
      if (hit) return hit
    }
  }
  return null
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => (err || !zip ? reject(err) : resolve(zip)))
  )
}

export async function extractZip(file: string, dest: string, onBytes: (n: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  // First pass: total size for the progress bar (reads only the zip's central directory).
  const zip = await openZip(file)
  let total = 0
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (e: yauzl.Entry) => {
      total += e.uncompressedSize
      zip.readEntry()
    })
    zip.once('end', resolve)
    zip.once('error', reject)
    zip.readEntry()
  })
  // Second pass: extract.
  const zip2 = await openZip(file)
  let done = 0
  await new Promise<void>((resolve, reject) => {
      zip2.on('entry', async (e: yauzl.Entry) => {
        try {
          if (signal?.aborted) throw new Error('Cancelled.')
          const name = e.fileName.replace(/\\/g, '/')
          if (name.endsWith('/')) {
            await mkdir(safeJoin(dest, name.slice(0, -1) || '.'), { recursive: true })
          } else {
            const out = safeJoin(dest, name)
            await mkdir(dirname(out), { recursive: true })
            const stream = await new Promise<Readable>((res, rej) => zip2.openReadStream(e, (err, s) => (err || !s ? rej(err) : res(s))))
            const meter = new Transform({
              transform(chunk: Buffer, _enc, cb) {
                done += chunk.length
                onBytes(done, total)
                cb(null, chunk)
              }
            })
            await pipeline(stream, meter, createWriteStream(out), { signal })
          }
          zip2.readEntry()
        } catch (err) {
          zip2.close()
          reject(err)
        }
      })
      zip2.once('end', resolve)
      zip2.once('error', reject)
      zip2.readEntry()
    })
}

export async function download(url: string, dest: string, onBytes: (done: number, total: number) => void, expectedSize = 0, sha256?: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || expectedSize
  const hash = createHash('sha256')
  let done = 0
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      done += chunk.length
      hash.update(chunk)
      onBytes(done, total)
      cb(null, chunk)
    }
  })
  await pipeline(Readable.fromWeb(res.body as WebReadableStream), meter, createWriteStream(dest), { signal })
  if (sha256 && hash.digest('hex') !== sha256) throw new Error('The downloaded file is corrupted (checksum mismatch). Try again.')
}

/** Removes a pack folder. Junctions/symlinks are unlinked, never followed. */
export async function removeDir(path: string): Promise<void> {
  let st
  try {
    st = lstatSync(path)
  } catch {
    return
  }
  if (st.isSymbolicLink()) {
    try {
      await rmdir(path) // Windows directory junction
    } catch {
      await unlink(path) // POSIX symlink
    }
    return
  }
  await rm(path, { recursive: true, force: true })
}

export async function installPack(installDir: string, pack: PivotPack, onProgress: (p: PivotProgress) => void, signal?: AbortSignal): Promise<void> {
  const dats = pivotDatsDir(installDir)
  const downloads = join(dats, '.downloads')
  const tmp = join(dats, `.extract-${pack.id}`)
  const zipPath = join(downloads, `${pack.id}.zip`)
  await mkdir(downloads, { recursive: true })

  const free = await freeSpace(dats)
  const need = (pack.size ?? 0) * 3 // zip + extracted copy + headroom
  if (free !== undefined && need > 0 && free < need) {
    throw new Error(`Not enough disk space: about ${(need / 1073741824).toFixed(1)} GB needed, ${(free / 1073741824).toFixed(1)} GB free.`)
  }

  let last = 0
  const emit = (p: PivotProgress, force = false): void => {
    const now = Date.now()
    if (force || now - last > 120) {
      last = now
      onProgress(p)
    }
  }

  try {
    await download(pack.url, zipPath, (d, t) => emit({ id: pack.id, phase: 'downloading', bytesDone: d, bytesTotal: t }), pack.size, pack.sha256, signal)
    await removeDir(tmp)
    await mkdir(tmp, { recursive: true })
    await extractZip(zipPath, tmp, (d, t) => emit({ id: pack.id, phase: 'extracting', bytesDone: d, bytesTotal: t }), signal)

    const root = findOverlayRoot(tmp)
    if (!root) throw new Error('This pack has no ROM folders, so it isn’t a Pivot overlay.')

    const target = packDir(installDir, pack.id)
    await removeDir(target)
    await rename(root, target)
    const meta: PackMeta = { id: pack.id, name: pack.name, category: pack.category, version: pack.version }
    await writeFile(join(target, '.pack.json'), JSON.stringify(meta, null, 2))
    emit({ id: pack.id, phase: 'done', bytesDone: 1, bytesTotal: 1 }, true)
  } finally {
    await removeDir(tmp)
    await rm(zipPath, { force: true })
  }
}

export async function removePack(installDir: string, id: string): Promise<void> {
  if (!ID_RE.test(id) || id.startsWith('.')) throw new Error('Invalid pack id.')
  await removeDir(packDir(installDir, id))
}

/** Links a folder the player picked into DATs/ (a junction on Windows, no copy, no admin rights). */
export async function addLocalOverlay(installDir: string, folder: string): Promise<LocalOverlay> {
  const root = isDir(folder) ? findOverlayRoot(folder) : null
  if (!root) throw new Error('That folder has no ROM folders. Pick the folder that contains ROM, ROM2, ...')
  const name = basename(root) || 'Custom'
  const slug = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(0, 40) || 'custom'
  const id = `local-${slug}-${createHash('sha1').update(root).digest('hex').slice(0, 6)}`
  const link = packDir(installDir, id)
  await mkdir(pivotDatsDir(installDir), { recursive: true })
  await removeDir(link)
  await symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir')
  return { id, name, path: root }
}
