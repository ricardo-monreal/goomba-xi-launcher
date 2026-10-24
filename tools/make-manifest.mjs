#!/usr/bin/env node
// Publishes a client folder for the launcher's patcher.
//
// Usage:
//   node tools/make-manifest.mjs <client-dir> <publish-dir> [--gzip] [--version v] [--base-url url] [--prune]
//
// Output:
//   <publish-dir>/manifest.json
//   <publish-dir>/files/<sha256[0:2]>/<sha256>[.gz]
//
// Files are stored by content hash, so:
//   - identical files are stored once,
//   - re-running against the same <publish-dir> only compresses/uploads what changed,
//   - players mid-download keep getting the blobs their (older) manifest points to.
// Upload new blobs first and manifest.json last. --prune removes blobs no longer referenced.
//
// If <publish-dir>/manifest.json already exists, files it listed that are gone now are added
// to "delete" so the launcher removes them from players' machines.

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { availableParallelism } from 'node:os'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const bool = (name) => {
  const i = args.indexOf(name)
  if (i === -1) return false
  args.splice(i, 1)
  return true
}
const version = flag('--version') ?? new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
const baseUrl = flag('--base-url')
const gzip = bool('--gzip')
const prune = bool('--prune')
const [srcDir, outDir] = args

if (!srcDir || !outDir) {
  console.error('Usage: node tools/make-manifest.mjs <client-dir> <publish-dir> [--gzip] [--version v] [--base-url url] [--prune]')
  process.exit(1)
}

// Player-generated files the launcher writes; never ship them even if present in the client dir.
const IGNORE = [
  /^Ashita\/config\/boot\//i,
  /^Ashita\/config\/sandbox\/sps000\.bin$/i,
  /^Ashita\/config\/addons\//i,
  /^Ashita\/config\/pivot\//i,
  /^Ashita\/polplugins\/DATs\/(\.downloads|\.extract-|local-)/i,
  /^Ashita\/scripts\/[^/]+\.txt$/i,
  /^Ashita\/logs\//i,
  /^Ashita\/screenshots\//i,
  /^Game\/SquareEnix\/FINAL FANTASY XI\/USER\//i,
  /^Game\/SquareEnix\/PlayOnlineViewer\/usr\//i,
  /(^|\/)\.DS_Store$/,
  /(^|\/)Thumbs\.db$/i,
  /\.launcher-state\.json$/
]

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

async function sha256(file) {
  const h = createHash('sha256')
  await pipeline(createReadStream(file), h)
  return h.digest('hex')
}

const blobRel = (hash) => `${hash.slice(0, 2)}/${hash}${gzip ? '.gz' : ''}`

// Previous manifest in the same publish dir: reuse hashes for unchanged files (by size+mtime cache).
const manifestPath = join(outDir, 'manifest.json')
const previous = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : null
if (previous && (previous.compression ?? 'none') !== (gzip ? 'gzip' : 'none')) {
  console.error('The existing manifest in this publish dir uses a different --gzip setting. Use a new publish dir.')
  process.exit(1)
}
const cachePath = join(outDir, '.hash-cache.json')
const hashCache = existsSync(cachePath) ? JSON.parse(await readFile(cachePath, 'utf8')) : {}

// Remove half-written blobs left behind by an interrupted earlier run.
if (existsSync(join(outDir, 'files'))) {
  for await (const full of walk(join(outDir, 'files'))) {
    if (full.endsWith('.tmp')) await rm(full, { force: true })
  }
}

const paths = []
for await (const full of walk(srcDir)) {
  const rel = relative(srcDir, full).split(sep).join('/')
  if (!IGNORE.some((re) => re.test(rel))) paths.push(rel)
}
paths.sort((a, b) => a.localeCompare(b))

const files = new Array(paths.length)
let done = 0
let written = 0
let writtenBytes = 0
const t0 = Date.now()

// Identical files (same hash) share one blob. Several workers can reach the same hash at once,
// so the first one writes it and the others wait for that write instead of racing it.
const inflight = new Map()
let tmpCounter = 0

function ensureBlob(hash, full, blob) {
  if (inflight.has(hash)) return inflight.get(hash)
  if (existsSync(blob)) return Promise.resolve()
  const job = (async () => {
    await mkdir(dirname(blob), { recursive: true })
    const tmp = `${blob}.${process.pid}-${++tmpCounter}.tmp`
    try {
      if (gzip) await pipeline(createReadStream(full), createGzip({ level: 6 }), createWriteStream(tmp))
      else await pipeline(createReadStream(full), createWriteStream(tmp))
      try {
        await rename(tmp, blob)
      } catch (err) {
        // On Windows, antivirus or a previous run can leave the target in place; same content, so keep it.
        if (!existsSync(blob)) throw err
      }
    } finally {
      await rm(tmp, { force: true })
    }
    written++
    writtenBytes += (await stat(blob)).size
  })()
  inflight.set(hash, job)
  return job
}

async function processFile(i) {
  const rel = paths[i]
  const full = join(srcDir, rel)
  const st = await stat(full)
  const cached = hashCache[rel]
  const hash = cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs ? cached.sha256 : await sha256(full)
  hashCache[rel] = { size: st.size, mtimeMs: st.mtimeMs, sha256: hash }

  const blob = join(outDir, 'files', blobRel(hash))
  await ensureBlob(hash, full, blob)
  const entry = { path: rel, size: st.size, sha256: hash }
  if (gzip) entry.csize = (await stat(blob)).size
  files[i] = entry
  if (++done % 500 === 0) process.stdout.write(`\r${done}/${paths.length} files`)
}

let next = 0
const workers = Array.from({ length: Math.max(2, Math.min(8, availableParallelism())) }, async () => {
  while (next < paths.length) await processFile(next++)
})
await Promise.all(workers)
process.stdout.write('\r')

const manifest = { version, compression: gzip ? 'gzip' : 'none', layout: 'sha256', files }
if (baseUrl) manifest.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'

if (previous) {
  const now = new Set(paths)
  const removed = (previous.files ?? []).map((f) => f.path).filter((p) => !now.has(p))
  const carried = (previous.delete ?? []).filter((p) => !now.has(p))
  const del = [...new Set([...removed, ...carried])].sort()
  if (del.length) manifest.delete = del
}

await mkdir(outDir, { recursive: true })
const pathSet = new Set(paths)
for (const k of Object.keys(hashCache)) if (!pathSet.has(k)) delete hashCache[k]
await writeFile(cachePath, JSON.stringify(hashCache))
await writeFile(manifestPath + '.tmp', JSON.stringify(manifest))
await rename(manifestPath + '.tmp', manifestPath)

let pruned = 0
if (prune && existsSync(join(outDir, 'files'))) {
  const keep = new Set(files.map((f) => blobRel(f.sha256)))
  for await (const full of walk(join(outDir, 'files'))) {
    const rel = relative(join(outDir, 'files'), full).split(sep).join('/')
    if (!keep.has(rel)) {
      await rm(full)
      pruned++
    }
  }
}

const total = files.reduce((n, f) => n + f.size, 0)
const ctotal = gzip ? files.reduce((n, f) => n + f.csize, 0) : total
const gb = (n) => (n / 1073741824).toFixed(2) + ' GB'
console.log(
  `manifest ${version}: ${files.length} files, ${gb(total)} installed, ${gb(ctotal)} to download` +
    (manifest.delete ? `, ${manifest.delete.length} deletions` : '') +
    `\nnew blobs: ${written} (${gb(writtenBytes)})` +
    (prune ? `, pruned ${pruned}` : '') +
    ` in ${((Date.now() - t0) / 1000).toFixed(1)}s`
)
