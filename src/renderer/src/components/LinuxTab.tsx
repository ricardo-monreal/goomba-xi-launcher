import { useCallback, useEffect, useState } from 'react'
import type { LinuxRuntimeStatus, PrefixComponents, WineSettings } from '../../../shared/types'
import type { TabProps } from './Settings'
import { Info, Section, ToggleRow } from './ui'

const COMPONENTS: { key: keyof PrefixComponents; verb: string; title: string; sub: string }[] = [
  { key: 'vcrun', verb: 'vcrun2022', title: 'Visual C++ 2015-2022', sub: 'The Visual C++ runtime used by xiloader, Ashita and plugins.' },
  { key: 'gdiplus', verb: 'gdiplus', title: 'GDI+', sub: 'The Windows GDI+ runtime used by the game and addon interfaces.' },
  { key: 'fonts', verb: 'allfonts', title: 'All fonts', sub: 'Every winetricks font. Large download; only needed if text looks wrong.' }
]

/** Linux only: which runtime runs the game, the Wine prefix and its components. */
export default function LinuxTab({ state, s, update, commit }: TabProps): JSX.Element {
  const [status, setStatus] = useState<LinuxRuntimeStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const w = s.wine
  const setWine = (patch: Partial<WineSettings>): void => update({ wine: { ...w, ...patch } })
  const commitWine = (patch: Partial<WineSettings>): Promise<void> => commit({ wine: { ...w, ...patch } })

  const reload = useCallback(async () => setStatus(await window.api.linuxStatus()), [])
  useEffect(() => {
    reload()
    return window.api.onLaunchStatus(setMessage)
  }, [reload])

  const runTask = async (task: () => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    setBusy(true)
    setError('')
    setMessage('Starting…')
    const r = await task()
    setBusy(false)
    if (!r.ok) {
      setMessage('')
      setError(r.error ?? 'Something went wrong.')
    }
    await reload()
  }

  const recreate = (): void => {
    if (!window.confirm('Delete the Wine prefix and set it up again? Game files and settings are kept.')) return
    void runTask(() => window.api.linuxRecreate())
  }

  // Runtime dropdown: "managed" or a path (wine binary or Proton folder).
  const runtimeValue = w.runtime === 'managed' ? 'managed' : w.runner || 'auto'
  const choose = async (v: string): Promise<void> => {
    if (v === 'managed') return commitWine({ runtime: 'managed' })
    await commitWine({ runtime: 'custom', runner: v === 'auto' ? '' : v })
  }
  const pickBinary = async (): Promise<void> => {
    const p = await window.api.chooseWineBinary()
    if (p) await commitWine({ runtime: 'custom', runner: p })
  }
  const pickProton = async (): Promise<void> => {
    const p = await window.api.chooseFolder('Choose a Proton folder (it contains a file called "proton")')
    if (p) await commitWine({ runtime: 'custom', runner: p })
  }

  const known = status?.runners.some((r) => r.path === w.runner)

  return (
    <>
      <div className="notice warn small">⚠ Changes on this tab are at your own risk and can cause performance issues or crashes. The defaults work for most people.</div>
      <div className="grid-2">
        <div className="col">
          <Section title="Proton runtime">
            <div className="row stack-row">
              <span className="row-label">
                Runtime
                <Info text="GE-Proton is downloaded and kept up to date by the launcher and runs through umu-launcher, like Steam does. Pick a custom build only if you know you need it." />
              </span>
              <select value={runtimeValue} onChange={(e) => choose(e.target.value)} disabled={busy}>
                <option value="managed">
                  {state.config.linux.protonVersion || status?.protonInstalled || 'GE-Proton'} ({state.config.serverName} official) · Recommended
                </option>
                <option value="auto">Wine on this PC (automatic)</option>
                {status?.runners.map((r) => (
                  <option key={r.path} value={r.path}>
                    {r.label}
                    {r.version ? ` · ${r.version}` : ''}
                  </option>
                ))}
                {w.runtime === 'custom' && w.runner && !known && <option value={w.runner}>{w.runner}</option>}
              </select>
            </div>
            <div className="row stack-row">
              <span className="row-label">Custom runtime</span>
              <input value={w.runtime === 'custom' ? w.runner : ''} placeholder="Path to a wine binary or a Proton folder" readOnly />
              <div className="field-row">
                <button onClick={pickBinary} disabled={busy}>
                  Wine binary…
                </button>
                <button onClick={pickProton} disabled={busy}>
                  Proton folder…
                </button>
              </div>
            </div>
            <p className="muted small section-note">
              {w.runtime === 'managed'
                ? status?.protonInstalled
                  ? `Installed: ${status.protonInstalled}${status.umuInstalled ? ' with umu-launcher' : ''}.`
                  : 'GE-Proton (about 500 MB) and umu-launcher are downloaded the first time you press Play or “Set up now”. The first start also downloads the Steam Linux Runtime.'
                : 'Using a Wine/Proton build installed on this PC. Prefix components are installed with winetricks (cabextract is needed for GDI+ and fonts).'}
            </p>
          </Section>

          <Section title="Logging">
            <ToggleRow
              label="Enable Proton / Wine logging"
              info="Writes detailed messages to wine.log in the install folder (and steam-default.log in your home folder for Proton). Slower; turn on only to troubleshoot."
              checked={w.debugLog}
              onChange={(debugLog) => setWine({ debugLog })}
            />
            <div className="row">
              <span className="row-label">Last game log</span>
              <button onClick={() => window.api.openWineLog()}>Open log</button>
            </div>
          </Section>

          <Section title="Game environment variables">
            <div className="row stack-row">
              <span className="row-label">
                One NAME=value per line
                <Info text="Advanced: extra settings passed to Proton/Wine. Examples: DXVK_HUD=fps, MANGOHUD=1, PROTON_USE_WINED3D=1." />
              </span>
              <textarea rows={4} spellCheck={false} placeholder={'DXVK_HUD=fps'} value={w.extraEnv} onChange={(e) => setWine({ extraEnv: e.target.value })} />
            </div>
          </Section>
        </div>

        <div className="col">
          <Section title="Prefix components">
            {COMPONENTS.map((c) => {
              const done = status?.componentsDone.includes(c.verb)
              return (
                <ToggleRow
                  key={c.key}
                  label={c.title}
                  sub={
                    <>
                      {c.sub}
                      {done && <span className="ok"> Installed.</span>}
                    </>
                  }
                  checked={w.components[c.key]}
                  disabled={busy}
                  onChange={(on) => commitWine({ components: { ...w.components, [c.key]: on } })}
                />
              )
            })}
            <p className="muted small section-note">
              Newly ticked components are installed the next time you press Play or “Set up now”. Unticking doesn’t remove anything; use “Recreate Linux environment” for a clean start. Windows 10 mode is always set.
            </p>
          </Section>

          <Section title="Wine prefix">
            <p className="muted small section-note">
              The prefix is the private Windows folder the game runs in. It’s kept when you change runtimes.
              <br />
              <br />
              Location: <span className="path">{status?.prefix ?? '…'}</span>
              {status && (status.prefixExists ? <span className="ok"> (set up)</span> : <span> (not set up yet)</span>)}
            </p>
            <div className="row stack-row">
              <span className="row-label">
                Custom prefix folder
                <Info text="Leave empty to keep the prefix inside the install folder. A custom prefix is never deleted by the launcher." />
              </span>
              <div className="field-row">
                <input className="grow" value={w.prefix} placeholder="Default (inside the install folder)" readOnly />
                <button
                  disabled={busy}
                  onClick={async () => {
                    const dir = await window.api.chooseFolder('Choose a folder for the Wine prefix')
                    if (dir) await commitWine({ prefix: dir })
                  }}
                >
                  Browse
                </button>
                {w.prefix && (
                  <button disabled={busy} onClick={() => commitWine({ prefix: '' })}>
                    Default
                  </button>
                )}
              </div>
            </div>
            <div className="row">
              <button className="btn-accent" disabled={busy} onClick={() => runTask(() => window.api.linuxPrepare())}>
                {busy ? 'Working…' : 'Set up now'}
              </button>
              <button disabled={busy || !!w.prefix} onClick={recreate} title={w.prefix ? 'Not available for a custom prefix folder' : ''}>
                Recreate Linux environment
              </button>
            </div>
            {(message || error) && <p className={error ? 'error small section-note' : 'small section-note'}>{error || message}</p>}
          </Section>
        </div>
      </div>
    </>
  )
}
