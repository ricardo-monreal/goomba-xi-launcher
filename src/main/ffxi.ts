import { execFile } from 'node:child_process'
import type { FfxiStatus, Language, LauncherConfig, Prereqs, UserSettings } from '../shared/types'
import { bundledPaths } from './ashita'
import { describeRunner, findPath } from './wine'

// PlayOnline registry roots per region. xiloader reads these same keys to find
// polcore, so a working retail install must have them.
const REG_ROOTS: Record<Language, string> = {
  US: 'PlayOnlineUS',
  JP: 'PlayOnline',
  EU: 'PlayOnlineEU'
}

/** Returns true if the folder looks like a FINAL FANTASY XI install. */
export function isFfxiFolder(dir: string): boolean {
  return !!dir && !!findPath(dir, 'FFXiMain.dll')
}

function regQuery(key: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null)
    // /reg:32 makes this work for the 32-bit (WOW6432Node) view on 64-bit Windows.
    execFile('reg', ['query', key, '/v', value, '/reg:32'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const line = stdout.split(/\r?\n/).find((l) => l.trim().startsWith(value))
      const m = line?.match(/REG_\w+\s+(.*)$/)
      resolve(m ? m[1].trim() : null)
    })
  })
}

export async function detectFfxi(cfg: LauncherConfig, s: UserSettings): Promise<FfxiStatus> {
  if (cfg.clientMode === 'bundled') {
    const { ffxi, pol } = bundledPaths(s.installDir)
    if (isFfxiFolder(ffxi) && findPath(pol, 'viewer', 'com', 'polcore.dll')) {
      return { found: true, path: ffxi, source: 'bundled' }
    }
    return { found: false, path: ffxi, source: 'bundled', error: 'The game is not installed yet.' }
  }

  if (s.ffxiPath) {
    return isFfxiFolder(s.ffxiPath)
      ? { found: true, path: s.ffxiPath, source: 'override' }
      : { found: false, path: s.ffxiPath, source: 'override', error: 'FFXiMain.dll was not found in the selected folder.' }
  }
  if (process.platform !== 'win32') {
    return { found: false, path: '', source: 'none', error: 'On Linux, choose your FINAL FANTASY XI folder in Settings → Game.' }
  }
  // 0001 = FINAL FANTASY XI folder under the PlayOnline InstallFolder key.
  const path = await regQuery(`HKLM\\SOFTWARE\\${REG_ROOTS[s.language]}\\InstallFolder`, '0001')
  if (path && isFfxiFolder(path)) return { found: true, path, source: 'registry' }
  return {
    found: false,
    path: path ?? '',
    source: 'none',
    error: path
      ? `Registry points to ${path}, but FFXiMain.dll is missing there.`
      : `No ${s.language} PlayOnline/FFXI install found in the registry. Install the retail client first.`
  }
}

export const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x86.exe'

/** xiloader is built with VS2022 and needs the x86 VC++ 14.3x+ runtime. */
export async function checkPrereqs(s: UserSettings): Promise<Prereqs> {
  if (process.platform !== 'win32') return { wine: await describeRunner(s.wine) }
  const key = 'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\X86'
  const [installed, minor] = await Promise.all([regQuery(key, 'Installed'), regQuery(key, 'Minor')])
  if (installed === null) return { vcRedistX86: false }
  return { vcRedistX86: parseInt(installed, 16) === 1 && parseInt(minor ?? '0', 16) >= 30 }
}
