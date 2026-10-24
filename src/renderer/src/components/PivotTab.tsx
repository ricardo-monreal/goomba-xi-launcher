import { useCallback, useEffect, useState } from 'react'
import type { PivotEntry, PivotProgress, PivotState } from '../../../shared/types'
import { formatBytes } from '../format'
import { Info } from './ui'

export default function PivotTab(): JSX.Element {
  const [state, setState] = useState<PivotState | null>(null)
  const [progress, setProgress] = useState<Record<string, PivotProgress>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')

  const reload = useCallback(async () => setState(await window.api.pivotList()), [])

  useEffect(() => {
    reload()
    return window.api.onPivotProgress((p) => setProgress((prev) => ({ ...prev, [p.id]: p })))
  }, [reload])

  const install = async (p: PivotEntry): Promise<void> => {
    setErrors((e) => ({ ...e, [p.id]: '' }))
    setProgress((prev) => ({ ...prev, [p.id]: { id: p.id, phase: 'downloading', bytesDone: 0, bytesTotal: p.size ?? 0 } }))
    const r = await window.api.pivotInstall(p.id)
    setProgress((prev) => {
      const next = { ...prev }
      delete next[p.id]
      return next
    })
    if (!r.ok && r.error) setErrors((e) => ({ ...e, [p.id]: r.error! }))
    await reload()
  }

  const remove = async (p: PivotEntry): Promise<void> => {
    const what = p.source === 'local' ? 'Remove this folder from the list? Your files are not deleted.' : `Delete ${p.name} from this computer?`
    if (!window.confirm(what)) return
    const r = await window.api.pivotRemove(p.id)
    if (!r.ok && r.error) setErrors((e) => ({ ...e, [p.id]: r.error! }))
    await reload()
  }

  const toggle = async (p: PivotEntry, on: boolean): Promise<void> => setState(await window.api.pivotSetEnabled(p.id, on))

  const browse = async (): Promise<void> => {
    setNotice('')
    const r = await window.api.pivotAddLocal()
    if (!r.ok && r.error) setNotice(r.error)
    await reload()
  }

  const matchPack = (p: PivotEntry): boolean => {
    const q = query.trim().toLowerCase()
    return !q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
  }

  if (!state) return <p className="muted">Loading…</p>

  return (
    <div className="pivot">
      <div className="lib-search">
        <input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button onClick={browse} disabled={!state.available} title="Add a DAT mod folder you already have">
          📁 Add a folder…
        </button>
      </div>
      <span className="muted small">
        HD textures, maps and other DAT overrides powered by XIPivot. Only one can be enabled per category. Changes apply the next time you press Play.
      </span>

      {!state.available && (
        <div className="notice small">
          XIPivot isn’t installed in this client (Ashita/polplugins/pivot.dll is missing). Run the update on the Play page; if this stays, ask the server team to add XIPivot to the client.
        </div>
      )}
      {state.catalogError && <div className="notice small">{state.catalogError}</div>}
      {notice && <div className="notice small">{notice}</div>}
      {state.packs.length === 0 && state.available && <p className="muted">No packs available yet. Use “Add a folder…” to use a DAT mod you already have.</p>}

      {state.categories.filter((cat) => state.packs.some((p) => p.category === cat && matchPack(p))).map((cat) => (
        <section key={cat} className="pivot-cat">
          <h2>{cat}</h2>
          <div className="pack-grid">
            {state.packs
              .filter((p) => p.category === cat && matchPack(p))
              .map((p) => {
                const prog = progress[p.id]
                const pct = prog && prog.bytesTotal > 0 ? Math.floor((prog.bytesDone / prog.bytesTotal) * 100) : 0
                return (
                  <article key={p.id} className={p.enabled ? 'pack card on' : 'pack card'}>
                    <div className="pack-main">
                      <div className="pack-title">
                        <span className="pack-name">{p.name}</span>
                        {(p.author || (p.description && p.source !== 'local')) && (
                          <Info text={[p.source !== 'local' ? p.description : '', p.author ? `By ${p.author}` : ''].filter(Boolean).join('\n')} />
                        )}
                        {p.links &&
                          Object.entries(p.links).map(([label, url]) => (
                            <button key={label} className="link small" title={url} onClick={() => window.api.openExternal(url)}>
                              {label} ↗
                            </button>
                          ))}
                      </div>
                      <div className="muted small">
                        {p.source === 'server' && (p.installed ? 'Always on' : 'Not installed yet. Run the update.')}
                        {p.source === 'local' && (p.installed ? p.description : 'Folder missing. It was moved or deleted.')}
                        {p.source === 'catalog' &&
                          (prog
                            ? `${prog.phase === 'extracting' ? 'Unpacking' : 'Downloading'} ${pct}%${prog.bytesTotal ? ` · ${formatBytes(prog.bytesDone)} of ${formatBytes(prog.bytesTotal)}` : ''}`
                            : p.installed
                              ? `Installed${p.installedVersion ? ` · v${p.installedVersion}` : ''}${p.updateAvailable ? ` · update to v${p.version} available` : ''}`
                              : p.size
                                ? formatBytes(p.size)
                                : '')}
                      </div>
                      {prog && (
                        <div className="bar">
                          <div style={{ width: `${pct}%` }} />
                        </div>
                      )}
                      {errors[p.id] && <div className="error small">{errors[p.id]}</div>}
                    </div>

                    <div className="pack-actions">
                      {p.source === 'catalog' && !p.installed && !prog && (
                        <button className="btn-small" onClick={() => install(p)} disabled={!state.available || !p.url}>
                          ⤓ Download
                        </button>
                      )}
                      {prog && (
                        <button className="btn-small" onClick={() => window.api.pivotCancel(p.id)}>
                          Cancel
                        </button>
                      )}
                      {p.installed && !p.locked && !prog && (
                        <>
                          {p.updateAvailable && (
                            <button className="btn-small" onClick={() => install(p)}>
                              Update
                            </button>
                          )}
                          <button className="icon-btn" title={p.source === 'local' ? 'Remove from list' : 'Delete'} onClick={() => remove(p)}>
                            ✕
                          </button>
                          <input
                            type="checkbox"
                            aria-label={`Enable ${p.name}`}
                            title={p.enabled ? 'Enabled' : 'Disabled'}
                            checked={p.enabled}
                            onChange={(e) => toggle(p, e.target.checked)}
                          />
                        </>
                      )}
                      {p.locked && <span className="tag-pill">server</span>}
                    </div>
                  </article>
                )
              })}
          </div>
        </section>
      ))}
    </div>
  )
}
