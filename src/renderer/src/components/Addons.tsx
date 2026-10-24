import { useCallback, useEffect, useState } from 'react'
import type { AddonEntry, AddonList, CatalogItem, CatalogProgress, UserSettings } from '../../../shared/types'
import { formatBytes } from '../format'
import PivotTab from './PivotTab'
import { Info, Tabs } from './ui'

interface Props {
  save: (patch: Partial<UserSettings>) => Promise<void>
}

type Tab = 'addons' | 'plugins' | 'pivot'
type Filter = 'all' | 'installed' | 'updates' | 'available'
type Kind = 'addons' | 'plugins'

const keyOf = (type: 'addon' | 'plugin', name: string): string => `${type}:${name.toLowerCase()}`
const typeOf = (kind: Kind): 'addon' | 'plugin' => (kind === 'addons' ? 'addon' : 'plugin')

function Links({ links }: { links?: Record<string, string> }): JSX.Element | null {
  if (!links) return null
  return (
    <>
      {Object.entries(links).map(([label, url]) => (
        <button key={label} className="link small" title={url} onClick={() => window.api.openExternal(url)}>
          {label} ↗
        </button>
      ))}
    </>
  )
}

export default function Addons({ save }: Props): JSX.Element {
  const [list, setList] = useState<AddonList | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [tab, setTab] = useState<Tab>('addons')
  const [progress, setProgress] = useState<Record<string, CatalogProgress>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const reload = useCallback(async () => setList(await window.api.listAddons()), [])

  useEffect(() => {
    reload()
    return window.api.onCatalogProgress((p) => setProgress((prev) => ({ ...prev, [p.key]: p })))
  }, [reload])

  useEffect(() => {
    setQuery('')
    setFilter('all')
  }, [tab])

  const toggle = async (kind: Kind, entry: AddonEntry, on: boolean): Promise<void> => {
    if (entry.required || !list) return
    const next = { ...list, [kind]: list[kind].map((e) => (e.name === entry.name ? { ...e, enabled: on } : e)) }
    setList(next)
    await save({ [kind]: Object.fromEntries(next[kind].map((e) => [e.name, e.enabled])) })
  }

  const install = async (key: string): Promise<void> => {
    setErrors((e) => ({ ...e, [key]: '' }))
    setProgress((p) => ({ ...p, [key]: { key, phase: 'downloading', bytesDone: 0, bytesTotal: 0 } }))
    const r = await window.api.catalogInstall(key)
    setProgress((p) => {
      const next = { ...p }
      delete next[key]
      return next
    })
    if (!r.ok && r.error) setErrors((e) => ({ ...e, [key]: r.error! }))
    await reload()
  }

  const remove = async (key: string, name: string): Promise<void> => {
    if (!window.confirm(`Remove ${name} from this computer?`)) return
    const r = await window.api.catalogRemove(key)
    if (!r.ok && r.error) setErrors((e) => ({ ...e, [key]: r.error! }))
    await reload()
  }

  const matches = (name: string, desc?: string): boolean => {
    const q = query.trim().toLowerCase()
    return !q || name.toLowerCase().includes(q) || (desc ?? '').toLowerCase().includes(q)
  }

  const status = (key: string): JSX.Element | null => {
    const p = progress[key]
    if (!p) return errors[key] ? <div className="error small">{errors[key]}</div> : null
    const pct = p.bytesTotal > 0 ? Math.floor((p.bytesDone / p.bytesTotal) * 100) : 0
    return (
      <>
        <div className="muted small">
          {p.phase === 'extracting' ? 'Installing…' : `Downloading${pct ? ` ${pct}%` : '…'}${p.bytesTotal ? ` · ${formatBytes(p.bytesTotal)}` : ''}`}
        </div>
        <div className="bar">
          <div style={{ width: `${p.phase === 'extracting' ? 100 : pct}%` }} />
        </div>
      </>
    )
  }

  const installedCard = (kind: Kind, e: AddonEntry): JSX.Element => {
    const key = keyOf(typeOf(kind), e.name)
    const busy = !!progress[key]
    return (
      <article key={key} className={e.enabled ? 'item on' : 'item'}>
        <div className="item-main">
          <div className="item-title">
            <span className="item-name">{e.name}</span>
            {e.version && <span className="item-ver">v{e.version}</span>}
            {(e.description || e.author) && <Info text={[e.description, e.author ? `By ${e.author}` : ''].filter(Boolean).join('\n')} />}
            <Links links={e.links} />
            {e.required && <span className="tag-pill">required</span>}
          </div>
          {e.updateAvailable && !busy && <div className="muted small">Update available</div>}
          {status(key)}
        </div>
        <div className="item-actions">
          {e.updateAvailable && !busy && (
            <button className="btn-small" onClick={() => install(key)}>
              Update
            </button>
          )}
          {e.fromCatalog && !e.required && !busy && (
            <button className="icon-btn" title="Remove" onClick={() => remove(key, e.name)}>
              ✕
            </button>
          )}
          <input
            type="checkbox"
            aria-label={`Enable ${e.name}`}
            title={e.required ? 'Required by the server' : e.enabled ? 'Enabled' : 'Disabled'}
            checked={e.enabled}
            disabled={e.required || busy}
            onChange={(ev) => toggle(kind, e, ev.target.checked)}
          />
        </div>
      </article>
    )
  }

  const availableCard = (i: CatalogItem): JSX.Element => {
    const key = keyOf(i.type, i.name)
    const busy = !!progress[key]
    return (
      <article key={key} className="item">
        <div className="item-main">
          <div className="item-title">
            <span className="item-name">{i.name}</span>
            {i.version && <span className="item-ver">v{i.version}</span>}
            {(i.description || i.author) && <Info text={[i.description, i.author ? `By ${i.author}` : ''].filter(Boolean).join('\n')} />}
            <Links links={i.links} />
          </div>
          {!busy && i.size ? <div className="muted small">{formatBytes(i.size)}</div> : null}
          {status(key)}
        </div>
        <div className="item-actions">
          <button className="btn-small" disabled={busy} onClick={() => install(key)}>
            ⤓ Install
          </button>
        </div>
      </article>
    )
  }

  const library = (kind: Kind, hint: string): JSX.Element => {
    if (!list) return <p className="muted">Loading…</p>
    const type = typeOf(kind)
    const installed = list[kind].filter((e) => matches(e.name, e.description))
    const shownInstalled =
      filter === 'available' ? [] : filter === 'updates' ? installed.filter((e) => e.updateAvailable) : installed
    const available = filter === 'installed' || filter === 'updates' ? [] : list.available.filter((i) => i.type === type && matches(i.name, i.description))
    const filters: { id: Filter; label: string }[] = [
      { id: 'all', label: 'All' },
      { id: 'installed', label: 'Installed' },
      { id: 'updates', label: 'Updates' },
      { id: 'available', label: 'Available' }
    ]
    return (
      <div className="lib">
        <div className="lib-search">
          <input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="filters">
          {filters.map((f) => (
            <button key={f.id} className={filter === f.id ? 'filter active' : 'filter'} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="muted small">
          {hint} {list[kind].filter((e) => e.enabled).length} enabled. Changes apply the next time you press Play.
        </span>
        {list.catalogError && <div className="notice small">{list.catalogError}</div>}

        {shownInstalled.length > 0 && (
          <section className="lib-group">
            <h2>Installed</h2>
            <div className="item-grid">{shownInstalled.map((e) => installedCard(kind, e))}</div>
          </section>
        )}
        {available.length > 0 && (
          <section className="lib-group">
            <h2>Available</h2>
            <div className="item-grid">{available.map(availableCard)}</div>
          </section>
        )}
        {shownInstalled.length === 0 && available.length === 0 && (
          <p className="muted">{list[kind].length === 0 && !query ? 'None installed yet. Run the update from the Play page.' : 'Nothing matches.'}</p>
        )}
      </div>
    )
  }

  return (
    <div className="page wide">
      <Tabs
        tabs={[
          { id: 'addons', label: 'Addons' },
          { id: 'plugins', label: 'Plugins' },
          { id: 'pivot', label: 'Pivot' }
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'addons' && library('addons', 'Lua addons, loaded when the game starts.')}
      {tab === 'plugins' && library('plugins', 'Native Ashita plugins (.dll), loaded when the game starts.')}
      {tab === 'pivot' && <PivotTab />}
    </div>
  )
}
