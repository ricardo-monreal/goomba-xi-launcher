import { ReactNode, useEffect, useState } from 'react'

export function Info({ text }: { text: string }): JSX.Element {
  return (
    <span className="info" title={text} aria-label={text} tabIndex={0}>
      i
    </span>
  )
}

interface ToggleRowProps {
  label: string
  info?: string
  /** Optional second line under the label. */
  sub?: ReactNode
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}

export function ToggleRow({ label, info, sub, checked, disabled, onChange }: ToggleRowProps): JSX.Element {
  return (
    <label className={disabled ? 'row toggle-row disabled' : 'row toggle-row'}>
      <span className="row-text">
        <span className="row-label">
          {label}
          {info && <Info text={info} />}
        </span>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

interface SelectRowProps<T extends string | number> {
  label: string
  info?: string
  value: T
  options: { value: T; label: string }[]
  disabled?: boolean
  onChange: (v: T) => void
}

export function SelectRow<T extends string | number>({ label, info, value, options, disabled, onChange }: SelectRowProps<T>): JSX.Element {
  return (
    <div className={disabled ? 'row stack-row disabled' : 'row stack-row'}>
      <span className="row-label">
        {label}
        {info && <Info text={info} />}
      </span>
      <select
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const hit = options.find((o) => String(o.value) === e.target.value)
          if (hit) onChange(hit.value)
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Integer input that only commits valid, clamped values on blur/Enter. */
export function IntInput({ value, min, max, suffix, onChange }: { value: number; min: number; max: number; suffix?: string; onChange: (v: number) => void }): JSX.Element {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (): void => {
    const n = Math.round(Number(text))
    if (!Number.isFinite(n)) return setText(String(value))
    const clamped = Math.min(max, Math.max(min, n))
    setText(String(clamped))
    if (clamped !== value) onChange(clamped)
  }
  return (
    <div className="int-input">
      <input
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </div>
  )
}

interface ResRowProps {
  label: string
  info?: string
  w: number
  h: number
  action?: { label: string; onClick: () => void }
  onChange: (w: number, h: number) => void
}

export function ResolutionRow({ label, info, w, h, action, onChange }: ResRowProps): JSX.Element {
  return (
    <div className="row stack-row">
      <span className="row-label">
        {label}
        {info && <Info text={info} />}
        {action && (
          <button type="button" className="chip" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </span>
      <div className="pair">
        <IntInput value={w} min={640} max={7680} suffix="Width" onChange={(v) => onChange(v, h)} />
        <IntInput value={h} min={480} max={4320} suffix="Height" onChange={(v) => onChange(w, v)} />
      </div>
    </div>
  )
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {action}
      </div>
      <div className="section-body">{children}</div>
    </section>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }): JSX.Element {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'tab active' : 'tab'} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}
