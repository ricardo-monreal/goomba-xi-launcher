// Generates Ashita v4 boot profiles and startup scripts. No Electron imports.
//
// Expected layout inside installDir (delivered by the patcher):
//   Ashita/ashita-cli.exe
//   Ashita/bootloader/xiloader.exe
//   Ashita/addons/<name>/<name>.lua
//   Ashita/plugins/<name>.dll
//   Ashita/config/boot/<serverId>.ini        <- written here
//   Ashita/scripts/<serverId>.txt            <- written here
//
// Bundled mode additionally has the game itself (run through Ashita's Sandbox plugin):
//   Game/SquareEnix/FINAL FANTASY XI/
//   Game/SquareEnix/PlayOnlineViewer/

import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeMap } from '../shared/controller'
import type { AddonList, GamepadSettings, Language, LauncherConfig, UserSettings } from '../shared/types'
import { findPath, toGamePath } from './wine'

export const ashitaDir = (installDir: string): string => join(installDir, 'Ashita')
// File names are matched case-insensitively so this also works on Linux (e.g. "Ashita-cli.exe").
export const ashitaCli = (installDir: string): string =>
  findPath(ashitaDir(installDir), 'ashita-cli.exe') ?? join(ashitaDir(installDir), 'ashita-cli.exe')
export const xiloaderPath = (installDir: string): string =>
  findPath(ashitaDir(installDir), 'bootloader', 'xiloader.exe') ?? join(ashitaDir(installDir), 'bootloader', 'xiloader.exe')
export const pivotDll = (installDir: string): string =>
  findPath(ashitaDir(installDir), 'polplugins', 'pivot.dll') ?? join(ashitaDir(installDir), 'polplugins', 'pivot.dll')
export const pivotDatsDir = (installDir: string): string => join(ashitaDir(installDir), 'polplugins', 'DATs')

export function bundledPaths(installDir: string): { common: string; pol: string; ffxi: string; tetra: string } {
  const game = join(installDir, 'Game')
  return {
    common: join(game, 'Common'),
    pol: join(game, 'SquareEnix', 'PlayOnlineViewer'),
    ffxi: join(game, 'SquareEnix', 'FINAL FANTASY XI'),
    tetra: join(game, 'SquareEnix', 'TetraMaster')
  }
}

/** The bundled client's region is fixed by the server; retail players pick theirs. */
export const effectiveLanguage = (cfg: LauncherConfig, s: UserSettings): Language =>
  cfg.clientMode === 'bundled' ? cfg.clientLanguage : s.language

// Plugin DLLs that ship with Ashita but are not user-loadable plugins.
// 'addons' is the plugin that runs Lua addons; the launcher loads it automatically.
const NON_PLUGIN_DLLS = new Set(['sandbox', 'pivot', 'addons'])

export function scanAddons(installDir: string, cfg: LauncherConfig, settings: UserSettings): AddonList {
  const root = ashitaDir(installDir)
  const addonDir = join(root, 'addons')
  const pluginDir = join(root, 'plugins')

  const addonNames = existsSync(addonDir)
    ? readdirSync(addonDir).filter((n) => {
        const d = join(addonDir, n)
        return statSync(d).isDirectory() && existsSync(join(d, `${n}.lua`))
      })
    : []
  const pluginNames = existsSync(pluginDir)
    ? readdirSync(pluginDir)
        .filter((n) => n.toLowerCase().endsWith('.dll'))
        .map((n) => n.slice(0, -4))
        .filter((n) => !NON_PLUGIN_DLLS.has(n.toLowerCase()))
    : []

  // Names are compared without case: a catalog item named "TargetLines" may install as
  // targetlines.dll, and Windows (and Ashita's /load) don't care about case either.
  const entry = (name: string, saved: Record<string, boolean>, required: string[], defaults: string[]) => {
    const key = name.toLowerCase()
    const has = (list: string[]) => list.some((n) => n.toLowerCase() === key)
    const savedKey = Object.keys(saved).find((k) => k.toLowerCase() === key)
    const isRequired = has(required)
    return { name, required: isRequired, enabled: isRequired || (savedKey !== undefined ? saved[savedKey] : has(defaults)) }
  }
  const sort = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)

  return {
    addons: addonNames.map((n) => entry(n, settings.addons, cfg.requiredAddons, cfg.defaultAddons)).sort(sort),
    plugins: pluginNames.map((n) => entry(n, settings.plugins, cfg.requiredPlugins, cfg.defaultPlugins)).sort(sort),
    available: []
  }
}

/** Keeps only Ashita commands (/...) and comments (#...), one per line. */
export function sanitizeCommands(lines: string[]): string[] {
  return lines
    .map((l) => l.replace(/[\r\n]/g, '').trim())
    .filter((l) => l.startsWith('/') || l.startsWith('#'))
}

/**
 * Ashita startup script: plugins, then addons, then keybinds; after a short wait (so addons
 * have registered their commands) the frame rate and any server/player commands.
 */
export function buildScript(list: AddonList, cfg?: Pick<LauncherConfig, 'scriptBinds' | 'scriptCommands'>, s?: Pick<UserSettings, 'frameRate' | 'customCommands'>): string {
  const want60 = s?.frameRate === 60
  const addons = list.addons.filter((x) => x.enabled).map((x) => x.name)
  // 60fps is set through the fps addon, so it has to be loaded even if the player turned it off.
  if (want60 && !addons.includes('fps') && list.addons.some((a) => a.name === 'fps')) addons.push('fps')

  const lines = ['# Generated by the launcher. Changes will be overwritten on every launch.', '']
  for (const p of list.plugins.filter((x) => x.enabled)) lines.push(`/load ${p.name}`)
  // Lua addons only run once the "addons" plugin is loaded.
  if (addons.length > 0) lines.push('/load addons')
  lines.push('')
  for (const a of addons) lines.push(`/addon load ${a}`)
  lines.push('')
  lines.push(...sanitizeCommands(cfg?.scriptBinds ?? []))
  lines.push('', '# Addons need a moment to register their commands before the lines below run.', '/wait 3')
  if (want60 && addons.includes('fps')) lines.push('/fps 1')
  lines.push(...sanitizeCommands(cfg?.scriptCommands ?? []))
  lines.push(...sanitizeCommands((s?.customCommands ?? '').split('\n')))
  lines.push('')
  return lines.join('\r\n')
}

const b = (v: boolean): number => (v ? 1 : 0)

function iniSection(name: string, values: Record<string, string | number>): string {
  const body = Object.entries(values)
    .map(([k, v]) => `${k} = ${v}`)
    .join('\r\n')
  return `[${name}]\r\n${body}\r\n`
}

export interface BootOptions {
  /** Path to the xiloader JSON credentials file, or null to let xiloader prompt. */
  credentialsJson: string | null
  /** XIPivot overlay folder names in load order, or null when Pivot isn't used. */
  pivotOverlays?: string[] | null
}

const GUID_RE = /^\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$/

/** padmode000 / padsin000 / padguid000 for [ffxi.registry]. */
export function padRegistry(p: GamepadSettings): Record<string, string | number> {
  const padmode = [p.enabled, p.forceFeedback, p.sliders, p.hatSwitches, p.whenInactive, p.type === 'xinput'].map(b).join(',')
  let padsin: string | number = -1
  if (p.type === 'xinput') padsin = normalizeMap(p.mapXInput, 'xinput').join(',')
  else if (p.dinputCustomized) padsin = normalizeMap(p.mapDInput, 'dinput').join(',')
  const guid = p.deviceGuid.trim()
  return { padmode000: padmode, padsin000: padsin, padguid000: GUID_RE.test(guid) ? guid : -1 }
}

/** XIPivot config (Ashita/config/pivot/<name>.ini). Overlays load in order; first match wins. */
export function buildPivotIni(overlays: string[]): string {
  const safe = overlays.filter((o) => /^[A-Za-z0-9 ._-]+$/.test(o))
  return [
    '; Generated by the launcher. Changes will be overwritten on every launch.',
    iniSection('settings', { debug_log: 'false', redirect_fopens: 'true' }),
    iniSection('overlays', Object.fromEntries(safe.map((o, i) => [String(i), o])))
  ].join('\r\n')
}

export function buildBootIni(installDir: string, cfg: LauncherConfig, s: UserSettings, opts: BootOptions): string {
  const g = s.graphics
  const lang = effectiveLanguage(cfg, s)
  const args = [`--server ${cfg.serverHost}`, `--lang ${lang}`, '--hide']
  if (cfg.hairpin) args.push('--hairpin')
  if (cfg.ports.auth) args.push(`--authport ${cfg.ports.auth}`)
  if (cfg.ports.data) args.push(`--dataport ${cfg.ports.data}`)
  if (cfg.ports.view) args.push(`--viewport ${cfg.ports.view}`)
  if (opts.credentialsJson) args.push(`--json "${toGamePath(opts.credentialsJson)}"`)

  const langNum = { JP: 1, US: 2, EU: 3 }[lang]
  const pad = s.gamepad
  const bundled = cfg.clientMode === 'bundled'
  const pivot = !!opts.pivotOverlays && opts.pivotOverlays.length > 0

  // Sandbox virtualizes the PlayOnline/FFXI registry keys and COM registrations inside the
  // bootloader process, pointing them at the bundled folders. See Ashita docs/sandbox/README.md.
  // XIPivot redirects DAT reads to overlay folders (HD textures, maps, UI) without touching the game files.
  const polplugins = [
    iniSection('ashita.polplugins', { sandbox: b(bundled), pivot: b(pivot) }),
    ...(pivot ? [iniSection('ashita.polplugins.args', { pivot: cfg.serverId })] : []),
    ...(bundled
      ? [iniSection('sandbox.paths', Object.fromEntries(Object.entries(bundledPaths(installDir)).map(([k, v]) => [k, toGamePath(v)])))]
      : [])
  ]

  return [
    '; Generated by the launcher. Changes will be overwritten on every launch.',
    iniSection('ashita.launcher', { autoclose: 1, name: cfg.serverName }),
    iniSection('ashita.boot', {
      file: toGamePath(xiloaderPath(installDir)),
      command: args.join(' '),
      gamemodule: 'ffximain.dll',
      script: `${cfg.serverId}.txt`,
      args: ''
    }),
    iniSection('ashita.language', { playonline: langNum, ashita: langNum === 1 ? 1 : 2 }),
    iniSection('ashita.logging', { level: 3, crashdumps: 1 }),
    iniSection('ashita.taskpool', { threadcount: -1 }),
    iniSection('ashita.resources', { 'offsets.use_overrides': 1, 'pointers.use_overrides': 1, 'resources.use_overrides': 1 }),
    iniSection('ashita.window.startpos', { x: -1, y: -1 }),
    iniSection('ashita.input', {
      'gamepad.allowbackground': b(pad.enabled && pad.whenInactive),
      'gamepad.disableenumeration': b(!(pad.enabled && pad.enumeration)),
      'keyboard.blockinput': 0,
      'keyboard.blockbindsduringinput': 1,
      'keyboard.silentbinds': 0,
      'keyboard.windowskeyenabled': 0,
      'mouse.blockinput': 0,
      'mouse.unhook': 1
    }),
    iniSection('ashita.misc', { 'addons.silent': 1, 'aliases.silent': 1, 'plugins.silent': 1 }),
    ...polplugins,
    iniSection('ffxi.registry', {
      '0000': g.mipmap,
      '0001': g.width,
      '0002': g.height,
      '0003': g.bgWidth,
      '0004': g.bgHeight,
      '0007': b(s.sound.enabled),
      '0011': g.envAnimations,
      '0017': b(g.bumpMapping),
      '0018': g.textureCompression,
      '0019': b(g.uncompressedMaps),
      '0021': b(g.hardwareMouse),
      '0022': b(g.openingMovie),
      '0023': b(g.simplifiedCharCreation),
      '0029': s.sound.maxSounds,
      '0034': g.windowMode,
      '0035': b(s.sound.alwaysOn),
      '0036': g.fontCompression,
      '0037': g.menuWidth,
      '0038': g.menuHeight,
      '0040': b(g.graphicsStabilization),
      '0044': b(g.maintainAspect),
      ...padRegistry(pad)
    })
  ].join('\r\n')
}

export async function writeProfile(installDir: string, cfg: LauncherConfig, s: UserSettings, list: AddonList, opts: BootOptions): Promise<void> {
  const root = ashitaDir(installDir)
  await mkdir(join(root, 'config', 'boot'), { recursive: true })
  await mkdir(join(root, 'scripts'), { recursive: true })
  if (cfg.clientMode === 'bundled') {
    // Sandbox expects these to exist even though nothing is shipped in them.
    const p = bundledPaths(installDir)
    await mkdir(p.common, { recursive: true })
    await mkdir(p.tetra, { recursive: true })
  }
  if (opts.pivotOverlays && opts.pivotOverlays.length > 0) {
    await mkdir(join(root, 'config', 'pivot'), { recursive: true })
    await writeFile(join(root, 'config', 'pivot', `${cfg.serverId}.ini`), buildPivotIni(opts.pivotOverlays))
  }
  await writeFile(join(root, 'config', 'boot', `${cfg.serverId}.ini`), buildBootIni(installDir, cfg, s, opts))
  await writeFile(join(root, 'scripts', `${cfg.serverId}.txt`), buildScript(list, cfg, s))
}
