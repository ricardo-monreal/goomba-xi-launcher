#!/usr/bin/env node
// Builds the launcher's addons.json and pivot.json from file-server/catalog-sources.json and the
// zips you host, filling in each download's size and SHA-256.
//
//   node tools/make-catalogs.mjs --files /srv/files/launcher --base-url https://files.goomba-xi.com/launcher
//        [--sources file-server/catalog-sources.json] [--out /srv/files/launcher]
//
// <files>/addons/*.zip and <files>/packs/*.zip are the downloads ("file" in the sources, relative
// to --files). The catalogs are written to --out (default: --files). Only addons on the approved
// list (client-config/approved-addons.json, Ashita entries) are published.

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, d) => {
  const i = argv.indexOf(n)
  return i === -1 ? d : argv[i + 1]
}
const files = opt('--files')
const baseUrl = (opt('--base-url') ?? '').replace(/\/$/, '')
const sourcesFile = opt('--sources', join(root, 'file-server', 'catalog-sources.json'))
const outDir = opt('--out', files)
if (!files || !baseUrl) {
  console.error('Usage: node tools/make-catalogs.mjs --files <dir> --base-url <url> [--sources <json>] [--out <dir>]')
  process.exit(1)
}

const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })

const norm = (s) => s.toLowerCase().replace(/ \(.*\)$/, '').replace(/[^a-z0-9]/g, '')
const approved = new Set(
  JSON.parse(readFileSync(join(root, 'client-config', 'approved-addons.json'), 'utf8'))
    .filter((a) => a.programs.includes('Ashita'))
    .map((a) => norm(a.name))
)
const sources = JSON.parse(readFileSync(sourcesFile, 'utf8'))
const warnings = []

async function publish(entry) {
  const { file, ...rest } = entry
  const path = join(files, file)
  if (!existsSync(path)) {
    warnings.push(`missing ${file} (${entry.name}); left out`)
    return null
  }
  return { ...rest, url: `${baseUrl}/${file.split('\\').join('/')}`, size: statSync(path).size, sha256: await sha256(path) }
}

const addons = []
for (const a of sources.addons ?? []) {
  if (!approved.has(norm(a.name))) {
    warnings.push(`${a.name} isn't on the approved list; left out`)
    continue
  }
  const p = await publish(a)
  if (p) addons.push(p)
}
const packs = []
for (const p of sources.packs ?? []) {
  if (!/^[A-Za-z0-9._-]+$/.test(p.id)) {
    warnings.push(`pack id "${p.id}" may only use letters, digits, ".", "_" and "-"; left out`)
    continue
  }
  const out = await publish(p)
  if (out) packs.push(out)
}

writeFileSync(join(outDir, 'addons.json'), JSON.stringify(addons, null, 2) + '\n')
writeFileSync(join(outDir, 'pivot.json'), JSON.stringify(packs, null, 2) + '\n')
for (const w of warnings) console.warn(`warning: ${w}`)
console.log(`Wrote ${addons.length} addons to ${join(outDir, 'addons.json')} and ${packs.length} packs to ${join(outDir, 'pivot.json')}`)
