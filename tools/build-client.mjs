#!/usr/bin/env node
// Assembles a self-contained, Sandbox-ready client folder from a clean retail install.
//
// Usage:
//   node tools/build-client.mjs \
//     --ffxi     "C:/Program Files (x86)/PlayOnline/SquareEnix/FINAL FANTASY XI" \
//     --pol      "C:/Program Files (x86)/PlayOnline/SquareEnix/PlayOnlineViewer" \
//     --ashita   ./vendor/Ashita-v4beta \
//     --xiloader ./vendor/xiloader.exe \
//     [--overlay ./overlay]   files copied on top of the result (custom addons, DATs, sandbox.ini, ...)
//     [--era ./vendor/Era-DATs]  Phoenix Era-DATs checkout; its ROM folders become the "era" XIPivot overlay
//     [--allowlist ./client-config/approved-addons.json]  remove every addon/plugin not on the list
//                             (default: that file; pass --no-allowlist to keep everything)
//     [--link]                hard-link instead of copy (same drive only; saves ~15 GB of disk)
//     --out ./client
//
// Result (this is exactly what ends up in each player's install folder):
//   client/Ashita/...                                  Ashita v4 + polplugins/sandbox.dll
//   client/Ashita/bootloader/xiloader.exe              LandSandBoat xiloader
//   client/Game/SquareEnix/FINAL FANTASY XI/...
//   client/Game/SquareEnix/PlayOnlineViewer/...
//   client/Ashita/polplugins/DATs/era/ROM...            Era-DATs (always-on overlay, see requiredOverlays)
//   client/client.json                                 build info read by the launcher
//
// Then publish it with:  node tools/make-manifest.mjs ./client ./publish --gzip

import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { copyFile, link, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

const argv = process.argv.slice(2)
const opt = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : argv[i + 1]
}
const has = (name) => argv.includes(name)

const src = {
  ffxi: opt('--ffxi'),
  pol: opt('--pol'),
  ashita: opt('--ashita'),
  xiloader: opt('--xiloader'),
  overlay: opt('--overlay'),
  era: opt('--era')
}
const allowlistFile = has('--no-allowlist') ? null : (opt('--allowlist') ?? join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'client-config', 'approved-addons.json'))
const out = opt('--out')
const useLinks = has('--link')

if (!src.ffxi || !src.pol || !src.ashita || !src.xiloader || !out) {
  console.error('Usage: node tools/build-client.mjs --ffxi <dir> --pol <dir> --ashita <dir> --xiloader <exe> [--era <Era-DATs dir>] [--overlay <dir>] [--allowlist <json> | --no-allowlist] [--link] --out <dir>')
  process.exit(1)
}

// --- Sanity checks: fail early with a clear message instead of shipping a broken client.
const mustExist = [
  [src.ffxi, 'FFXiMain.dll', 'FFXI folder'],
  [src.ffxi, 'ffxi.dll', 'FFXI folder'],
  [src.ffxi, 'ROM/0/0.DAT', 'FFXI folder'],
  [src.pol, 'viewer/com/polcore.dll', 'PlayOnlineViewer folder'],
  [src.ashita, 'ashita-cli.exe', 'Ashita folder'],
  [src.ashita, 'polplugins/sandbox.dll', 'Ashita folder'],
  [src.ashita, 'config/sandbox/sandbox.registry.ini', 'Ashita folder']
]
// Case-insensitive lookup so the checks behave the same on Windows, macOS and Linux
// (e.g. Ashita ships "Ashita-cli.exe", FFXI ships "FFXiMain.dll").
function existsCI(dir, rel) {
  let cur = dir
  for (const part of rel.split('/')) {
    if (!existsSync(cur)) return false
    const hit = readdirSync(cur).find((n) => n.toLowerCase() === part.toLowerCase())
    if (!hit) return false
    cur = join(cur, hit)
  }
  return true
}

const missing = []
for (const [dir, file, what] of mustExist) {
  if (!existsCI(dir, file)) missing.push(`${what}: ${join(dir, file)}`)
}
if (!existsSync(src.xiloader)) missing.push(`xiloader: ${src.xiloader}`)
if (src.overlay && !existsSync(src.overlay)) missing.push(`overlay: ${src.overlay}`)
if (src.era && !existsCI(src.era, 'ROM')) missing.push(`Era-DATs (ROM folder): ${src.era}`)
if (allowlistFile && !existsSync(allowlistFile)) missing.push(`addon allowlist: ${allowlistFile}`)
if (missing.length) {
  console.error('Missing required files:\n  ' + missing.join('\n  '))
  process.exit(1)
}

// --- Things that must never be shipped. Paths are relative to each source root, "/" separated.
const EXCLUDE = {
  ffxi: [
    /^USER\//i, // per-player character settings, macros, chat filters
    /^screenshots\//i,
    /\.log$/i,
    /\.tmp$/i
  ],
  pol: [
    /^usr\//i, // PlayOnline accounts, saved logins
    /^data\/icon\/cicn_m000\.png$/i, // local encryption key for saved POL passwords
    /\.log$/i,
    /\.tmp$/i
  ],
  ashita: [
    /^\.git\//,
    /^\.github\//,
    /^config\/boot\//i, // written by the launcher at every launch
    /^config\/sandbox\/sps000\.bin$/i, // saved POL credentials
    /^config\/addons\//i, // per-character addon settings
    /^config\/pivot\//i, // written by the launcher from the player's Pivot choices
    /^scripts\/[^/]+\.txt$/i, // launcher writes <serverId>.txt; Ashita's samples aren't needed
    /^bootloader\//i, // old v3 bootloader; replaced by LandSandBoat xiloader below
    /^logs\//i,
    /^screenshots\//i,
    /^docs\//i
  ],
  common: [/(^|\/)Thumbs\.db$/i, /(^|\/)desktop\.ini$/i, /(^|\/)\.DS_Store$/]
}

const stats = { files: 0, bytes: 0, skipped: 0 }

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) yield* walk(full)
    else if (e.isFile()) yield full
  }
}

async function place(from, to) {
  await mkdir(dirname(to), { recursive: true })
  await rm(to, { force: true })
  if (useLinks) {
    try {
      await link(from, to)
      return
    } catch {
      // Different drive or unsupported filesystem: fall back to copying.
    }
  }
  await copyFile(from, to)
}

async function copyTree(name, from, to, excludes) {
  const rules = [...excludes, ...EXCLUDE.common]
  let n = 0
  for await (const file of walk(from)) {
    const rel = relative(from, file).split(sep).join('/')
    if (rules.some((re) => re.test(rel))) {
      stats.skipped++
      continue
    }
    await place(file, join(to, rel))
    const { size } = await stat(file)
    stats.files++
    stats.bytes += size
    if (++n % 2000 === 0) process.stdout.write(`\r  ${name}: ${n} files`)
  }
  console.log(`\r  ${name}: ${n} files`)
}

const outDir = resolve(out)
if (existsSync(outDir)) {
  console.log(`Clearing ${outDir}`)
  await rm(outDir, { recursive: true, force: true })
}

console.log('Building client…')
await copyTree('Ashita', src.ashita, join(outDir, 'Ashita'), EXCLUDE.ashita)
await place(src.xiloader, join(outDir, 'Ashita', 'bootloader', 'xiloader.exe'))
stats.files++
await copyTree('FINAL FANTASY XI', src.ffxi, join(outDir, 'Game', 'SquareEnix', 'FINAL FANTASY XI'), EXCLUDE.ffxi)
await copyTree('PlayOnlineViewer', src.pol, join(outDir, 'Game', 'SquareEnix', 'PlayOnlineViewer'), EXCLUDE.pol)
if (src.era) {
  // Only the DAT folders; README and the YAML sources stay out of the client.
  for (const rom of readdirSync(src.era).filter((d) => /^ROM\d*$/i.test(d))) {
    await copyTree(`Era-DATs ${rom}`, join(src.era, rom), join(outDir, 'Ashita', 'polplugins', 'DATs', 'era', rom), [/\.(yml|yaml|md|txt)$/i])
  }
}
if (src.overlay) await copyTree('overlay', src.overlay, outDir, [])

// --- Approved addons only. Ashita ships tools the server doesn't allow (automation, packet
// tools); anything not on the allowlist is removed so players can't turn it on by accident.
// Infrastructure the launcher itself needs is always kept.
const KEEP_PLUGINS = ['addons', 'thirdparty', 'winefix']
const KEEP_POLPLUGINS = ['sandbox', 'pivot']
const removed = []
if (allowlistFile) {
  const norm = (s) => s.toLowerCase().replace(/ \(.*\)$/, '').replace(/[^a-z0-9]/g, '')
  const approved = new Set(
    JSON.parse(await readFile(allowlistFile, 'utf8'))
      .filter((a) => a.programs.includes('Ashita'))
      .map((a) => norm(a.name))
  )
  const prune = async (dir, isDll, keep) => {
    if (!existsSync(dir)) return
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const name = isDll ? (e.isFile() && /\.dll$/i.test(e.name) ? e.name.slice(0, -4) : null) : e.isDirectory() ? e.name : null
      if (name === null || keep.includes(name.toLowerCase()) || approved.has(norm(name))) continue
      await rm(join(dir, e.name), { recursive: true, force: true })
      removed.push(`${relative(outDir, join(dir, e.name)).split(sep).join('/')}`)
    }
  }
  await prune(join(outDir, 'Ashita', 'addons'), false, [])
  await prune(join(outDir, 'Ashita', 'plugins'), true, KEEP_PLUGINS)
  await prune(join(outDir, 'Ashita', 'polplugins'), true, KEEP_POLPLUGINS)
  console.log(removed.length ? `  Removed ${removed.length} tools that aren't on the approved list:\n    ${removed.join('\n    ')}` : '  All addons and plugins are on the approved list.')
}

// A short fingerprint of the game binaries, so you can tell builds apart.
const fp = createHash('sha256')
for (const f of ['FFXiMain.dll', 'ffxi.dll']) fp.update(await readFile(join(src.ffxi, f)))

const info = {
  builtAt: new Date().toISOString(),
  ffxiFingerprint: fp.digest('hex').slice(0, 16),
  files: stats.files,
  bytes: stats.bytes,
  eraDats: !!src.era,
  removedUnapproved: removed
}
await writeFile(join(outDir, 'client.json'), JSON.stringify(info, null, 2))

console.log(`Done: ${stats.files} files, ${(stats.bytes / 1073741824).toFixed(2)} GB (${stats.skipped} excluded) → ${outDir}`)
console.log(`Next: node tools/make-manifest.mjs "${out}" ./publish --gzip`)
