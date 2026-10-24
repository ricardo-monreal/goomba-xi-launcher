import { useEffect, useState } from 'react'
import type { FolderKind, PatchProgress } from '../../../shared/types'
import { formatBytes } from '../format'
import type { TabProps } from './Settings'
import { Section } from './ui'

export default function MiscTab({ state }: TabProps): JSX.Element {
  const [verifying, setVerifying] = useState(false)
  const [progress, setProgress] = useState<PatchProgress | null>(null)
  const [verifyMsg, setVerifyMsg] = useState('')
  const [steamMsg, setSteamMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [folderErr, setFolderErr] = useState('')

  useEffect(() => window.api.onPatchProgress((p) => verifying && setProgress(p)), [verifying])

  const verify = async (): Promise<void> => {
    setVerifying(true)
    setVerifyMsg('')
    setProgress(null)
    const r = await window.api.runUpdate({ verify: true })
    setVerifying(false)
    setVerifyMsg(r.ok ? (r.filesToDownload ? `Repaired ${r.filesToDownload} file(s). Everything is up to date.` : 'All files verified. Nothing needed repairing.') : r.cancelled ? 'Stopped.' : r.error ?? 'Verification failed.')
  }

  const open = async (kind: FolderKind): Promise<void> => {
    setFolderErr('')
    const r = await window.api.openFolder(kind)
    if (!r.ok) setFolderErr(r.error ?? 'Couldn’t open that folder.')
  }

  const steam = async (): Promise<void> => {
    setSteamMsg(null)
    const r = await window.api.addToSteam()
    setSteamMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Added.' : r.error ?? 'Couldn’t add the launcher to Steam.' })
  }

  const pct = progress && progress.bytesTotal ? Math.floor((progress.bytesDone / progress.bytesTotal) * 100) : 0

  return (
    <div className="grid-2">
      <div className="col">
        <Section title="Game files">
          <div className="row">
            <span className="row-text">
              <span className="row-label">Verify &amp; Repair</span>
              <span className="row-sub">Check every game file against the server&apos;s list and download any that are damaged or missing.</span>
            </span>
            {verifying ? (
              <button onClick={() => window.api.cancelUpdate()}>Stop</button>
            ) : (
              <button onClick={verify} disabled={!state.config.manifestUrl}>
                Verify files
              </button>
            )}
          </div>
          {(verifying || verifyMsg) && (
            <div className="row stack-row">
              {verifying && progress && (
                <>
                  <div className="bar">
                    <div style={{ width: `${progress.phase === 'checking' && progress.filesTotal ? Math.floor((progress.filesDone / progress.filesTotal) * 100) : pct}%` }} />
                  </div>
                  <span className="muted small">
                    {progress.phase === 'checking'
                      ? `Checking ${progress.filesDone.toLocaleString()} / ${progress.filesTotal.toLocaleString()} files`
                      : `Downloading ${formatBytes(progress.bytesDone)} of ${formatBytes(progress.bytesTotal)}`}
                  </span>
                </>
              )}
              {verifyMsg && <span className="small">{verifyMsg}</span>}
            </div>
          )}
        </Section>

        <Section title="Logging">
          <div className="row">
            <span className="row-label">Ashita logs</span>
            <button className="chip" onClick={() => open('ashitaLogs')}>
              Open
            </button>
          </div>
          {state.platform === 'linux' && (
            <div className="row">
              <span className="row-label">Last Wine / Proton log</span>
              <button className="chip" onClick={() => window.api.openWineLog()}>
                View
              </button>
            </div>
          )}
          <div className="row">
            <span className="row-label">Launcher settings and logs</span>
            <button className="chip" onClick={() => open('launcher')}>
              Open
            </button>
          </div>
        </Section>

        <Section title="Screenshots">
          <div className="row">
            <span className="row-text">
              <span className="row-label">Screenshot folder</span>
              <span className="row-sub">Print Screen in game saves a clean screenshot here.</span>
            </span>
            <button className="chip" onClick={() => open('screenshots')}>
              Open
            </button>
          </div>
        </Section>
      </div>

      <div className="col">
        <Section title="Steam">
          <div className="row">
            <span className="row-text">
              <span className="row-label">Add to Steam Library</span>
              <span className="row-sub">
                Quit Steam first. Restart Steam{state.platform === 'linux' ? ' (or switch to Game Mode on a Steam Deck)' : ''} after adding.
              </span>
            </span>
            <button onClick={steam}>Add</button>
          </div>
          {steamMsg && (
            <p className={`section-note small ${steamMsg.ok ? 'ok' : 'error'}`} style={{ margin: 0 }}>
              {steamMsg.text}
            </p>
          )}
        </Section>

        <Section title="Utilities">
          <div className="row">
            <span className="row-label">Open game folder</span>
            <button className="chip" onClick={() => open('game')}>
              Open
            </button>
          </div>
          {folderErr && <p className="section-note small error" style={{ margin: 0 }}>{folderErr}</p>}
        </Section>

        <Section title="About">
          <p className="section-note small muted">
            {state.config.serverName} Launcher v{state.version}
            <br />
            Built on Ashita v4, xiloader, XIPivot{state.platform === 'linux' ? ', GE-Proton and umu-launcher' : ''}.
          </p>
        </Section>
      </div>
    </div>
  )
}
