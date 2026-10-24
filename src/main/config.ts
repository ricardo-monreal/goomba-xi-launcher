import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { defaultMapFor, normalizeMap } from '../shared/controller'
import type { GamepadSettings, LauncherConfig, UserSettings } from '../shared/types'

/** Ashita's standard keybinds (from its scripts/default.txt). */
const DEFAULT_BINDS = [
  '/bind insert /ashita',
  '/bind SYSRQ /screenshot hide',
  '/bind $^v /paste',
  '/bind F11 /ambient',
  '/bind F12 /fps'
]

/** Server-wide settings shipped with the launcher (launcher.config.json). */
export function loadLauncherConfig(): LauncherConfig {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  const raw = JSON.parse(readFileSync(join(base, 'launcher.config.json'), 'utf8'))
  const cfg: LauncherConfig = {
    clientMode: 'retail',
    clientLanguage: 'US',
    serverId: 'server',
    serverName: 'LandSandBoat Server',
    serverHost: '127.0.0.1',
    manifestUrl: '',
    newsUrl: '',
    links: {},
    hairpin: false,
    ports: {},
    requiredPlugins: [],
    defaultPlugins: [],
    requiredAddons: [],
    defaultAddons: [],
    pivotCatalogUrl: '',
    requiredOverlays: [],
    scriptBinds: DEFAULT_BINDS,
    scriptCommands: [],
    verifyLogin: true,
    allowAccountCreation: true,
    registerUrl: '',
    accountUrl: '',
    addonCatalogUrl: '',
    theme: 'goomba',
    websiteUrl: '',
    ...raw,
    linux: { protonVersion: '', protonUrl: '', umuUrl: '', winetricksUrl: '', ...(raw.linux ?? {}) }
  }
  // Ashita's winefix plugin smooths over Wine/Proton quirks; on by default on Linux only.
  if (process.platform === 'linux' && !cfg.defaultPlugins.includes('winefix')) cfg.defaultPlugins = [...cfg.defaultPlugins, 'winefix']
  if (!/^[A-Za-z0-9_-]+$/.test(cfg.serverId)) {
    throw new Error('launcher.config.json: serverId may only contain letters, digits, "-" and "_"')
  }
  if (cfg.clientMode !== 'bundled' && cfg.clientMode !== 'retail') {
    throw new Error('launcher.config.json: clientMode must be "bundled" or "retail"')
  }
  if (cfg.websiteUrl && !/^https?:\/\//.test(cfg.websiteUrl)) {
    throw new Error('launcher.config.json: websiteUrl must start with https:// (or http:// for a test server)')
  }
  if (cfg.clientMode === 'bundled' && !cfg.manifestUrl) {
    throw new Error('launcher.config.json: clientMode "bundled" needs a manifestUrl to download the game from')
  }
  return cfg
}

function defaultSettings(): UserSettings {
  return {
    installDir: join(app.getPath('home'), 'Games', app.getName()),
    ffxiPath: '',
    language: 'US',
    graphics: {
      width: 1920,
      height: 1080,
      bgWidth: 2048,
      bgHeight: 2048,
      menuWidth: 1920,
      menuHeight: 1080,
      windowMode: 3,
      mipmap: 6,
      bumpMapping: true,
      envAnimations: 2,
      textureCompression: 2,
      fontCompression: 2,
      maintainAspect: true,
      uncompressedMaps: true,
      graphicsStabilization: false,
      hardwareMouse: true,
      openingMovie: false,
      simplifiedCharCreation: false
    },
    sound: { enabled: true, alwaysOn: true, maxSounds: 20 },
    gamepad: {
      enabled: false,
      type: 'xinput',
      enumeration: true,
      whenInactive: false,
      forceFeedback: true,
      sliders: false,
      hatSwitches: false,
      deviceGuid: '',
      mapXInput: defaultMapFor('xinput'),
      mapDInput: defaultMapFor('dinput'),
      dinputCustomized: false
    },
    addons: {},
    plugins: {},
    pivot: { enabled: {}, local: [] },
    frameRate: 60,
    customCommands: '',
    rememberMe: false,
    lastUsername: '',
    closeOnLaunch: false,
    wine: { runtime: 'managed', runner: '', prefix: '', debugLog: false, extraEnv: '', components: { vcrun: true, gdiplus: true, fonts: false } }
  }
}

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

let cached: UserSettings | null = null

export function loadSettings(): UserSettings {
  if (cached) return cached
  const defaults = defaultSettings()
  let stored: Partial<UserSettings> = {}
  try {
    if (existsSync(settingsFile())) stored = JSON.parse(readFileSync(settingsFile(), 'utf8'))
  } catch {
    // Corrupt settings file: fall back to defaults rather than refusing to start.
  }
  cached = mergeSettings(defaults, stored)
  return cached
}

function mergeGamepad(base: GamepadSettings, patch: Partial<GamepadSettings> & { xinput?: boolean }): GamepadSettings {
  const { xinput, ...rest } = patch
  const g: GamepadSettings = { ...base, ...rest }
  // Settings saved by launcher 0.2 used a boolean "xinput" instead of "type".
  if (rest.type === undefined && typeof xinput === 'boolean') g.type = xinput ? 'xinput' : 'dinput'
  g.mapXInput = normalizeMap(g.mapXInput, 'xinput')
  g.mapDInput = normalizeMap(g.mapDInput, 'dinput')
  return g
}

/** Merges on/off maps whose keys are addon or plugin names, treating names that differ only in case as one. */
function mergeNames(base: Record<string, boolean>, patch: Record<string, boolean> | undefined): Record<string, boolean> {
  if (!patch) return { ...base }
  const changed = new Set(Object.keys(patch).map((k) => k.toLowerCase()))
  const kept = Object.fromEntries(Object.entries(base).filter(([k]) => !changed.has(k.toLowerCase())))
  return { ...kept, ...patch }
}

function mergeSettings(base: UserSettings, patch: Partial<UserSettings>): UserSettings {
  return {
    ...base,
    ...patch,
    graphics: { ...base.graphics, ...(patch.graphics ?? {}) },
    sound: { ...base.sound, ...(patch.sound ?? {}) },
    gamepad: mergeGamepad(base.gamepad, patch.gamepad ?? {}),
    wine: { ...base.wine, ...(patch.wine ?? {}), components: { ...base.wine.components, ...(patch.wine?.components ?? {}) } },
    addons: mergeNames(base.addons, patch.addons),
    plugins: mergeNames(base.plugins, patch.plugins),
    pivot: {
      enabled: { ...base.pivot.enabled, ...(patch.pivot?.enabled ?? {}) },
      local: patch.pivot?.local ?? base.pivot.local
    }
  }
}

export function saveSettings(patch: Partial<UserSettings>): UserSettings {
  const next = mergeSettings(loadSettings(), patch)
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmp = settingsFile() + '.tmp'
  writeFileSync(tmp, JSON.stringify(next, null, 2))
  renameSync(tmp, settingsFile())
  cached = next
  return next
}
