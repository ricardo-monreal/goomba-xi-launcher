import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LaunchRequest, NewsItem, UpdateCheck, UserSettings } from '../shared/types'
import { changePassword, createAccount, validateCredentials, verifyLogin } from './account'
import { scanAddons } from './ashita'
import { loadLauncherConfig, loadSettings, saveSettings } from './config'
import { clearPassword, clearSession, loadPassword, loadSession, savePassword, saveSession } from './credentials'
import { checkPrereqs, detectFfxi } from './ffxi'
import { cleanupCredentialFiles, launchGame } from './launch'
import { CancelledError, checkForUpdates, runUpdate } from './patcher'
import { addLocalOverlay, applyEnable, getCatalog, installPack, listPivot, removePack } from './pivot'
import { catalogKey, getAddonCatalog, installItem, mergeCatalog, removeItem } from './catalog'
import { findRunners, isWindows, linuxStatus, preparePrefix, recreatePrefix, resolveRunner, setRuntimeRoot, setWinetricksUrl, wineLogPath } from './wine'
import { ashitaDir } from './ashita'
import { addSteamShortcut } from './steam'
import * as web from './website'
import type { FolderKind, WebResult } from '../shared/types'

const config = loadLauncherConfig()
// Big Linux runtimes (GE-Proton, umu) go to ~/.local/share/<app>/runtimes, not the settings folder.
setWinetricksUrl(config.linux.winetricksUrl)
if (!isWindows) setRuntimeRoot(join(process.env.XDG_DATA_HOME || join(app.getPath('home'), '.local', 'share'), app.getName(), 'runtimes'))
let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 680,
    minWidth: 900,
    minHeight: 600,
    title: config.serverName,
    backgroundColor: '#0c0e1a',
    autoHideMenuBar: true,
    // Our own title bar (drag area + minimize/close in the top bar), like the in-game launcher look.
    frame: false,
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  // Never let the renderer open new windows or navigate away; send links to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const errorCheck = (e: unknown): UpdateCheck => ({
  ok: false,
  error: e instanceof Error ? e.message : String(e),
  filesToDownload: 0,
  bytesToDownload: 0,
  bytesToWrite: 0,
  filesToDelete: 0
})

const noPatching: UpdateCheck = { ok: true, version: 'n/a', filesToDownload: 0, bytesToDownload: 0, bytesToWrite: 0, filesToDelete: 0 }
let updateAbort: AbortController | null = null

ipcMain.handle('state:get', async () => {
  const settings = loadSettings()
  return {
    config,
    settings,
    ffxi: await detectFfxi(config, settings),
    prereqs: await checkPrereqs(settings),
    platform: process.platform,
    version: app.getVersion()
  }
})

ipcMain.handle('settings:save', (_e, patch: Partial<UserSettings>) => saveSettings(patch))

ipcMain.handle('dialog:folder', async (_e, title: string) => {
  const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('update:check', async (e) => {
  if (!config.manifestUrl) return noPatching
  try {
    return await checkForUpdates(loadSettings().installDir, config.manifestUrl, {}, (p) => e.sender.send('update:progress', p))
  } catch (err) {
    return errorCheck(err)
  }
})

ipcMain.handle('update:run', async (e, opts: { verify?: boolean }) => {
  if (!config.manifestUrl) return noPatching
  if (updateAbort) return errorCheck(new Error('An update is already running.'))
  updateAbort = new AbortController()
  const send = (p: unknown): void => {
    if (!e.sender.isDestroyed()) e.sender.send('update:progress', p)
  }
  try {
    return await runUpdate(loadSettings().installDir, config.manifestUrl, send, { verify: !!opts?.verify, signal: updateAbort.signal })
  } catch (err) {
    const r = errorCheck(err)
    if (err instanceof CancelledError) r.cancelled = true
    send({ phase: r.cancelled ? 'cancelled' : 'error', message: r.error, filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 })
    return r
  } finally {
    updateAbort = null
  }
})

ipcMain.handle('update:cancel', () => updateAbort?.abort())

ipcMain.handle('news:get', async (): Promise<NewsItem[]> => {
  if (!config.newsUrl) return []
  try {
    const res = await fetch(config.newsUrl, { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data.slice(0, 20) : []
  } catch {
    return []
  }
})

ipcMain.handle('addons:list', async () => {
  const s = loadSettings()
  const catalog = await getAddonCatalog(config.addonCatalogUrl)
  return mergeCatalog(s.installDir, scanAddons(s.installDir, config, s), catalog.items, catalog.error)
})

// ---- Addon / plugin catalog --------------------------------------------------------------------

const catalogDownloads = new Map<string, AbortController>()

ipcMain.handle('catalog:install', async (e, key: string) => {
  const s = loadSettings()
  const { items } = await getAddonCatalog(config.addonCatalogUrl, true)
  const item = items.find((i) => catalogKey(i.type, i.name) === key)
  if (!item) return { ok: false, error: 'That item is no longer in the list.' }
  if (catalogDownloads.has(key)) return { ok: false, error: 'Already downloading.' }
  const ac = new AbortController()
  catalogDownloads.set(key, ac)
  try {
    await installItem(s.installDir, item, (p) => e.sender.send('catalog:progress', p), ac.signal)
    // Turn it on right away.
    const kind = item.type === 'addon' ? 'addons' : 'plugins'
    saveSettings({ [kind]: { ...s[kind], [item.name]: true } })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    catalogDownloads.delete(key)
  }
})

ipcMain.handle('catalog:remove', async (_e, key: string) => {
  try {
    await removeItem(loadSettings().installDir, key)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('creds:get', () => {
  const s = loadSettings()
  return { username: s.lastUsername, password: s.rememberMe ? loadPassword() : '' }
})

const authTarget = () => ({ host: config.serverHost, port: config.ports.auth ?? 54231 })

// ---- Website account (websiteUrl) ---------------------------------------------------------------

/** Session token for this run; also saved (encrypted) when the player ticked "remember me". */
let webToken = ''
const sessionToken = (): string => webToken || (webToken = loadSession())

async function webMe(): Promise<WebResult> {
  if (!config.websiteUrl) return { ok: false, error: 'No website is configured.' }
  const token = sessionToken()
  if (!token) return { ok: false, signedOut: true }
  try {
    return { ok: true, me: await web.me(config.websiteUrl, token) }
  } catch (e) {
    if (e instanceof web.SignedOutError) {
      webToken = ''
      clearSession()
      return { ok: false, signedOut: true, error: e.message }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

ipcMain.handle('web:signin', async (_e, username: string, password: string, remember: boolean): Promise<WebResult> => {
  try {
    const token = await web.signIn(config.websiteUrl, username, password)
    webToken = token
    if (remember) saveSession(token)
    else clearSession()
    saveSettings({ rememberMe: remember, lastUsername: username.trim() })
    return await webMe()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('web:me', () => webMe())

ipcMain.handle('web:signout', async () => {
  const token = sessionToken()
  webToken = ''
  clearSession()
  if (token) await web.signOut(config.websiteUrl, token)
})

ipcMain.handle('server:status', async () => ({ online: config.websiteUrl ? await web.status(config.websiteUrl) : null }))

// ---- Window, folders, Steam --------------------------------------------------------------------

ipcMain.handle('win:minimize', () => win?.minimize())
ipcMain.handle('win:close', () => win?.close())

ipcMain.handle('folder:open', async (_e, kind: FolderKind) => {
  const s = loadSettings()
  const dirs: Record<FolderKind, string> = {
    launcher: app.getPath('userData'),
    game: s.installDir,
    ashitaLogs: join(ashitaDir(s.installDir), 'logs'),
    screenshots: join(ashitaDir(s.installDir), 'screenshots')
  }
  const dir = dirs[kind]
  if (!dir || !existsSync(dir)) return { ok: false, error: 'That folder doesn’t exist yet. Install and play the game first.' }
  const err = await shell.openPath(dir)
  return err ? { ok: false, error: err } : { ok: true }
})

ipcMain.handle('steam:add', () => {
  // On Linux the AppImage path; on Windows the installed launcher .exe.
  const exe = process.env.APPIMAGE || process.execPath
  if (!app.isPackaged) return { ok: false, error: 'Only available in an installed launcher, not in development.' }
  try {
    const n = addSteamShortcut({ name: config.serverName, exe, startDir: dirname(exe) })
    return { ok: true, message: `Added to Steam${n > 1 ? ` for ${n} accounts` : ''}. Start Steam (or switch to Game Mode) to find ${config.serverName} in your library.` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('game:launch', async (_e, req: LaunchRequest) => {
  if (updateAbort) return { ok: false, error: 'Wait for the update to finish first.' }

  if (config.websiteUrl) {
    const ffxiCheck = await detectFfxi(config, loadSettings())
    if (!ffxiCheck.found) return { ok: false, error: ffxiCheck.error ?? 'FINAL FANTASY XI install not found.' }
    if (!sessionToken()) return { ok: false, error: 'Sign in first.' }
    // The single-use launch token is fetched just before Ashita starts (it expires in minutes).
    const getLogin = async () => {
      try {
        const t = await web.launchToken(config.websiteUrl, sessionToken())
        return { username: t.username, loginToken: t.loginToken }
      } catch (e) {
        if (e instanceof web.SignedOutError) {
          webToken = ''
          clearSession()
        }
        throw e
      }
    }
    const result = await launchGame(config, loadSettings(), getLogin, (msg) => _e.sender.send('launch:status', msg))
    if (result.ok && loadSettings().closeOnLaunch) setTimeout(() => app.quit(), 35_000)
    return result
  }

  const username = req.username ?? ''
  const password = req.password ?? ''
  const invalid = validateCredentials(username, password)
  if (invalid) return { ok: false, error: invalid }

  const ffxi = await detectFfxi(config, loadSettings())
  if (!ffxi.found) return { ok: false, error: ffxi.error ?? 'FINAL FANTASY XI install not found.' }

  // Check the account first, so a wrong password shows here instead of in xiloader's console.
  if (config.verifyLogin) {
    const check = await verifyLogin(authTarget(), username, password)
    if (!check.ok) return check
  }

  const remember = !!req.remember
  const settings = saveSettings({ rememberMe: remember, lastUsername: remember ? username : '' })
  if (remember) savePassword(password)
  else clearPassword()

  const result = await launchGame(config, settings, { username, password }, (msg) => _e.sender.send('launch:status', msg))
  if (result.ok && settings.closeOnLaunch) setTimeout(() => app.quit(), 35_000)
  return result
})

// ---- Linux / Wine ------------------------------------------------------------------------------

ipcMain.handle('wine:runners', () => (isWindows ? [] : findRunners()))

ipcMain.handle('linux:status', () => {
  const s = loadSettings()
  return linuxStatus(s.installDir, s.wine)
})

/** Download the runtime and set up the prefix now (instead of on the first Play). */
async function prepareLinux(sender: Electron.WebContents) {
  const s = loadSettings()
  const status = (msg: string) => sender.send('launch:status', msg)
  try {
    const runner = await resolveRunner(config.linux, s.wine, status)
    const err = await preparePrefix(runner, s.installDir, s.wine, status)
    if (err) return { ok: false, error: err }
    status('Linux environment ready.')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

ipcMain.handle('linux:prepare', (e) => prepareLinux(e.sender))

ipcMain.handle('linux:recreate', async (e) => {
  const s = loadSettings()
  const err = await recreatePrefix(s.installDir, s.wine)
  if (err) return { ok: false, error: err }
  return prepareLinux(e.sender)
})

ipcMain.handle('wine:choose', async () => {
  const r = await dialog.showOpenDialog(win!, { title: 'Choose a wine binary (…/bin/wine)', properties: ['openFile', 'showHiddenFiles'] })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('wine:log', async () => {
  const log = wineLogPath(loadSettings().installDir)
  if (existsSync(log)) await shell.openPath(log)
})

ipcMain.handle('account:create', (_e, username: string, password: string) => createAccount(authTarget(), username, password))
ipcMain.handle('account:changePassword', (_e, username: string, password: string, newPassword: string) =>
  changePassword(authTarget(), username, password, newPassword)
)

// ---- Pivot (HD / DAT overlay packs) ---------------------------------------------------------

const pivotDownloads = new Map<string, AbortController>()

async function pivotState(force = false) {
  const s = loadSettings()
  const { packs, error } = await getCatalog(config.pivotCatalogUrl, force)
  return listPivot(s.installDir, config, s, packs, error)
}

ipcMain.handle('pivot:list', () => pivotState(true))

ipcMain.handle('pivot:install', async (e, id: string) => {
  if (pivotDownloads.has(id)) return { ok: false, error: 'Already downloading.' }
  const { packs } = await getCatalog(config.pivotCatalogUrl)
  const pack = packs.find((p) => p.id === id)
  if (!pack) return { ok: false, error: 'This pack is no longer available.' }
  const ac = new AbortController()
  pivotDownloads.set(id, ac)
  const send = (p: unknown): void => {
    if (!e.sender.isDestroyed()) e.sender.send('pivot:progress', p)
  }
  try {
    await installPack(loadSettings().installDir, pack, send, ac.signal)
    // A freshly installed pack is switched on (and replaces any other pack in its category).
    const s = loadSettings()
    saveSettings({ pivot: { ...s.pivot, enabled: applyEnable(s.installDir, s, id, true, packs) } })
    return { ok: true }
  } catch (err) {
    const error = ac.signal.aborted ? 'Download cancelled.' : err instanceof Error ? err.message : String(err)
    send({ id, phase: 'error', message: error, bytesDone: 0, bytesTotal: 0 })
    return { ok: false, error }
  } finally {
    pivotDownloads.delete(id)
  }
})

ipcMain.handle('pivot:cancel', (_e, id: string) => pivotDownloads.get(id)?.abort())

ipcMain.handle('pivot:remove', async (_e, id: string) => {
  try {
    const s = loadSettings()
    await removePack(s.installDir, id)
    const enabled = { ...s.pivot.enabled }
    delete enabled[id]
    saveSettings({ pivot: { enabled, local: s.pivot.local.filter((l) => l.id !== id) } })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('pivot:enable', async (_e, id: string, enabled: boolean) => {
  const s = loadSettings()
  const { packs } = await getCatalog(config.pivotCatalogUrl)
  saveSettings({ pivot: { ...s.pivot, enabled: applyEnable(s.installDir, s, id, enabled, packs) } })
  return pivotState()
})

ipcMain.handle('pivot:addLocal', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Choose a DAT mod folder (the one containing ROM, ROM2, ...)',
    properties: ['openDirectory']
  })
  if (r.canceled || !r.filePaths[0]) return { ok: false }
  try {
    const s = loadSettings()
    const local = await addLocalOverlay(s.installDir, r.filePaths[0])
    saveSettings({
      pivot: { enabled: { ...s.pivot.enabled, [local.id]: true }, local: [...s.pivot.local.filter((l) => l.id !== local.id), local] }
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('shell:open', (_e, url: string) => {
  if (/^https?:\/\//.test(url)) return shell.openExternal(url)
})

// Don't quit in the middle of writing game files without asking.
app.on('before-quit', (e) => {
  if ((!updateAbort && pivotDownloads.size === 0) || !win) return
  const choice = dialog.showMessageBoxSync(win, {
    type: 'question',
    buttons: ['Keep downloading', 'Quit'],
    defaultId: 0,
    message: 'An update is still running.',
    detail: 'You can quit now; the download will continue from where it stopped next time.'
  })
  if (choice === 0) e.preventDefault()
  else {
    updateAbort?.abort()
    for (const ac of pivotDownloads.values()) ac.abort()
  }
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
app.on('will-quit', cleanupCredentialFiles)
