#!/usr/bin/env node
// Points launcher.config.json (and the sample news file) at your Goomba XI servers, so you don't
// have to edit every URL by hand before building the launcher.
//
//   node tools/configure.mjs --server 10.2.5.64 --files http://10.2.5.65
//   node tools/configure.mjs --server goomba-xi.com --website https://goomba-xi.com --files https://files.goomba-xi.com
//
//   --server   game server address (the login server; also the website on a home network)
//   --website  website URL. Default http://<server>
//   --files    file server base URL (the Debian LXC), without /launcher
//   --show     print the current addresses and change nothing
//
// Then build: npm run dist (Windows) or npm run dist:linux (AppImage).

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(root, 'launcher.config.json')
const newsPath = join(root, 'file-server', 'news.json')

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const config = JSON.parse(readFileSync(configPath, 'utf8'))

const show = () => {
  for (const key of ['serverHost', 'websiteUrl', 'registerUrl', 'accountUrl', 'manifestUrl', 'newsUrl', 'addonCatalogUrl', 'pivotCatalogUrl']) {
    console.log(`  ${key.padEnd(16)} ${config[key]}`)
  }
}

if (args.includes('--show') || args.length === 0) {
  show()
  if (args.length === 0) console.log('\nusage: node tools/configure.mjs --server <address> --files <url> [--website <url>]')
  process.exit(0)
}

const server = opt('server')
const files = opt('files')?.replace(/\/+$/, '')
if (!server || !files) {
  console.error('both --server and --files are needed (see the top of this file)')
  process.exit(2)
}
if (!/^https?:\/\//.test(files)) {
  console.error(`--files must be a URL starting with http:// or https://, got "${files}"`)
  process.exit(2)
}
const website = (opt('website') ?? `http://${server}`).replace(/\/+$/, '')

config.serverHost = server
config.websiteUrl = website
config.registerUrl = `${website}/register`
config.accountUrl = `${website}/account`
config.manifestUrl = `${files}/launcher/client/manifest.json`
config.newsUrl = `${files}/launcher/news.json`
config.addonCatalogUrl = `${files}/launcher/addons.json`
config.pivotCatalogUrl = `${files}/launcher/pivot.json`
config.links = { ...(config.links ?? {}), Website: website }
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')

try {
  const news = JSON.parse(readFileSync(newsPath, 'utf8'))
  for (const item of news) if (item.url) item.url = item.url.replace(/^https?:\/\/[^/]+/, website)
  writeFileSync(newsPath, JSON.stringify(news, null, 2) + '\n')
} catch {
  // no sample news file; nothing to update
}

console.log('launcher.config.json now points at:')
show()
console.log('\nBuild with: npm run dist (Windows) or npm run dist:linux (Linux AppImage)')
