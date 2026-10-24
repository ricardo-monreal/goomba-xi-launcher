// "Add to Steam Library": adds the launcher to every Steam account on this PC as a non-Steam game,
// by editing userdata/<id>/config/shortcuts.vdf (Steam's binary VDF). Steam must be closed while
// we write, or it overwrites the file on exit; it picks the shortcut up on its next start.
//
// No Electron imports, so it can be tested with plain Node.

import { copyFileSync, existsSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// ---- Binary VDF --------------------------------------------------------------------------------

type VdfValue = string | number | VdfMap
export interface VdfMap {
  [key: string]: VdfValue
}

const T_MAP = 0x00
const T_STRING = 0x01
const T_INT = 0x02
const T_END = 0x08

export function parseVdf(buf: Buffer): VdfMap {
  let i = 0
  const cstr = (): string => {
    const end = buf.indexOf(0, i)
    if (end < 0) throw new Error('shortcuts.vdf is damaged (unterminated string)')
    const s = buf.toString('utf8', i, end)
    i = end + 1
    return s
  }
  const map = (): VdfMap => {
    const out: VdfMap = {}
    while (i < buf.length) {
      const type = buf[i++]
      if (type === T_END) return out
      const key = cstr()
      if (type === T_MAP) out[key] = map()
      else if (type === T_STRING) out[key] = cstr()
      else if (type === T_INT) {
        out[key] = buf.readInt32LE(i)
        i += 4
      } else throw new Error(`shortcuts.vdf has an unknown field type 0x${type.toString(16)}`)
    }
    return out
  }
  return map()
}

export function writeVdf(root: VdfMap): Buffer {
  const parts: Buffer[] = []
  const cstr = (s: string) => parts.push(Buffer.from(s, 'utf8'), Buffer.from([0]))
  const map = (m: VdfMap) => {
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'string') {
        parts.push(Buffer.from([T_STRING]))
        cstr(k)
        cstr(v)
      } else if (typeof v === 'number') {
        parts.push(Buffer.from([T_INT]))
        cstr(k)
        const b = Buffer.alloc(4)
        b.writeInt32LE(v | 0)
        parts.push(b)
      } else {
        parts.push(Buffer.from([T_MAP]))
        cstr(k)
        map(v)
      }
    }
    parts.push(Buffer.from([T_END]))
  }
  map(root)
  return Buffer.concat(parts)
}

// ---- Steam locations ---------------------------------------------------------------------------

function steamRoots(): string[] {
  const home = homedir()
  const roots =
    process.platform === 'win32'
      ? [join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam'), join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Steam')]
      : [join(home, '.steam', 'steam'), join(home, '.local', 'share', 'Steam'), join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam')]
  const seen = new Set<string>()
  return roots.filter((r) => {
    if (!existsSync(join(r, 'userdata'))) return false
    let real = r
    try {
      real = realpathSync(r)
    } catch {
      // keep r
    }
    if (seen.has(real)) return false
    seen.add(real)
    return true
  })
}

export function steamIsRunning(): boolean {
  try {
    if (process.platform === 'win32') {
      return /steam\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH'], { encoding: 'utf8', windowsHide: true }))
    }
    execFileSync('pgrep', ['-x', 'steam'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// Steam's id for a non-Steam shortcut: CRC32 of exe + name with the top bit set (as a signed int32).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(s: string): number {
  let c = 0xffffffff
  for (const b of Buffer.from(s, 'utf8')) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
export const shortcutAppId = (exe: string, name: string): number => (crc32(exe + name) | 0x80000000) | 0

export interface ShortcutTarget {
  name: string
  /** The program Steam starts (the AppImage on Linux, the installed .exe on Windows). */
  exe: string
  startDir: string
  icon?: string
}

/** Adds or updates the shortcut for every Steam user. Returns how many accounts were updated. */
export function addSteamShortcut(target: ShortcutTarget): number {
  if (steamIsRunning()) throw new Error('Quit Steam first, then try again. (Steam overwrites its shortcut list when it exits.)')
  const roots = steamRoots()
  if (!roots.length) throw new Error('Steam isn’t installed for this user, or hasn’t been started yet.')
  const quotedExe = `"${target.exe}"`
  const appid = shortcutAppId(quotedExe, target.name)
  let updated = 0
  for (const steamRoot of roots) {
    const userdata = join(steamRoot, 'userdata')
    for (const user of readdirSync(userdata)) {
      if (!/^\d+$/.test(user) || user === '0') continue
      const configDir = join(userdata, user, 'config')
      try {
        if (!statSync(configDir).isDirectory()) continue
      } catch {
        continue
      }
      const file = join(configDir, 'shortcuts.vdf')
      const doc: VdfMap = existsSync(file) ? parseVdf(readFileSync(file)) : { shortcuts: {} }
      const list = (typeof doc.shortcuts === 'object' ? doc.shortcuts : (doc.shortcuts = {})) as VdfMap
      // Replace an earlier entry for this launcher (same name), otherwise append.
      let key = Object.keys(list).find((k) => {
        const e = list[k] as VdfMap
        return typeof e === 'object' && (e.AppName === target.name || e.appname === target.name)
      })
      if (!key) key = String(Object.keys(list).length)
      list[key] = {
        appid,
        AppName: target.name,
        Exe: quotedExe,
        StartDir: `"${target.startDir}"`,
        icon: target.icon ?? '',
        ShortcutPath: '',
        LaunchOptions: '',
        IsHidden: 0,
        AllowDesktopConfig: 1,
        AllowOverlay: 1,
        OpenVR: 0,
        Devkit: 0,
        DevkitGameID: '',
        DevkitOverrideAppID: 0,
        LastPlayTime: 0,
        FlatpakAppID: '',
        tags: {}
      }
      if (existsSync(file)) copyFileSync(file, file + '.bak')
      const tmp = file + '.tmp'
      writeFileSync(tmp, writeVdf(doc))
      renameSync(tmp, file)
      updated++
    }
  }
  if (!updated) throw new Error('No Steam account folder was found. Start Steam once and sign in, then quit it and try again.')
  return updated
}
