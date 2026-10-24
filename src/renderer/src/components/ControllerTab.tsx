import { useState } from 'react'
import { buttonsFor, defaultMapFor, PAD_ACTIONS, PadType } from '../../../shared/controller'
import type { GamepadSettings } from '../../../shared/types'
import ControllerDiagram from './ControllerDiagram'
import type { TabProps } from './Settings'
import { Info, Section, SelectRow, ToggleRow } from './ui'

const GUID_RE = /^\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$/

export default function ControllerTab({ s, update }: TabProps): JSX.Element {
  const p = s.gamepad
  const set = (patch: Partial<GamepadSettings>): void => update({ gamepad: { ...p, ...patch } })
  const [customOpen, setCustomOpen] = useState(false)
  const [guidMode, setGuidMode] = useState<'auto' | 'custom'>(p.deviceGuid ? 'custom' : 'auto')
  const [guidText, setGuidText] = useState(p.deviceGuid)

  const off = !p.enabled
  const map = p.type === 'xinput' ? p.mapXInput : p.mapDInput
  const usingGameDefaults = p.type === 'dinput' && !p.dinputCustomized
  const buttons = buttonsFor(p.type)

  const setMapping = (i: number, code: number): void => {
    const next = [...map]
    next[i] = code
    set(p.type === 'xinput' ? { mapXInput: next } : { mapDInput: next, dinputCustomized: true })
  }

  const reset = (): void => {
    if (p.type === 'xinput') set({ mapXInput: defaultMapFor('xinput') })
    else set({ mapDInput: defaultMapFor('dinput'), dinputCustomized: false })
  }

  const guidValid = GUID_RE.test(guidText.trim())

  return (
    <div className="grid-controller">
      <div className="col">
        <Section title="Controller" action={<button className="link small" onClick={reset} disabled={off}>↺ Reset buttons to default</button>}>
          <ToggleRow label="Enable gamepad" checked={p.enabled} onChange={(enabled) => set({ enabled })} />
          <ToggleRow
            label="Gamepad enumeration"
            info="Lets the game look for controllers. If you get small stutters and don't use a controller, disable the gamepad instead. Both turn this off."
            checked={p.enumeration}
            disabled={off}
            onChange={(enumeration) => set({ enumeration })}
          />
          <ToggleRow label="Active while unfocused" info="Keep the controller working when the game window is in the background." checked={p.whenInactive} disabled={off} onChange={(whenInactive) => set({ whenInactive })} />

          <SelectRow<PadType>
            label="Type"
            info="XInput: Xbox and most modern pads. DirectInput: older pads and PlayStation controllers without Steam Input or DS4Windows."
            value={p.type}
            disabled={off}
            options={[
              { value: 'xinput', label: 'XInput (Xbox and most modern pads)' },
              { value: 'dinput', label: 'DirectInput (PlayStation / older pads)' }
            ]}
            onChange={(type) => set({ type })}
          />

          <div className={off ? 'row stack-row disabled' : 'row stack-row'}>
            <span className="row-label">
              Controller
              <Info text="Auto uses the first controller Windows reports. If you have several (or a wheel/joystick), enter the DirectInput GUID of the one to use. The FFXI gamepad config tool shows it." />
            </span>
            <select
              value={guidMode}
              disabled={off}
              onChange={(e) => {
                const m = e.target.value as 'auto' | 'custom'
                setGuidMode(m)
                if (m === 'auto') set({ deviceGuid: '' })
              }}
            >
              <option value="auto">Auto (first controller found)</option>
              <option value="custom">Specific device (GUID)…</option>
            </select>
            {guidMode === 'custom' && (
              <>
                <input
                  placeholder="{00000000-0000-0000-0000-000000000000}"
                  value={guidText}
                  disabled={off}
                  spellCheck={false}
                  onChange={(e) => setGuidText(e.target.value)}
                  onBlur={() => set({ deviceGuid: guidValid ? guidText.trim() : '' })}
                />
                {guidText && !guidValid && <span className="error small">Not a valid GUID. It looks like {'{8-4-4-4-12 hex digits}'}.</span>}
              </>
            )}
          </div>

          <ToggleRow label="Force feedback" info="Controller rumble." checked={p.forceFeedback} disabled={off} onChange={(forceFeedback) => set({ forceFeedback })} />
          <ToggleRow label="Sliders" info="Use slider axes on pads that have them (rare)." checked={p.sliders} disabled={off} onChange={(sliders) => set({ sliders })} />
          <ToggleRow label="Hat switches" info="Treat a hat switch as the D-pad. Some DirectInput pads report their D-pad this way." checked={p.hatSwitches} disabled={off} onChange={(hatSwitches) => set({ hatSwitches })} />

          <button type="button" className={customOpen ? 'row collapse-row open' : 'row collapse-row'} disabled={off} onClick={() => setCustomOpen(!customOpen)}>
            <span>Customize buttons</span>
            <span aria-hidden>{customOpen ? '▴' : '▾'}</span>
          </button>
          {customOpen && !off && (
            <div className="mapping">
              {usingGameDefaults && (
                <p className="muted small">Using the game’s built-in DirectInput layout. Changing any action below switches to your own layout.</p>
              )}
              {PAD_ACTIONS.map((a, i) => (
                <label key={i} className="map-row">
                  <span>{a.label}</span>
                  <select value={String(map[i])} onChange={(e) => setMapping(i, Number(e.target.value))}>
                    {buttons.map((b) => (
                      <option key={b.code} value={String(b.code)}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="col pad-col">
        <ControllerDiagram type={p.type} map={map} dimmed={off || usingGameDefaults} />
        {off && <p className="muted small center">Enable the gamepad to use a controller in game.</p>}
        {!off && usingGameDefaults && <p className="muted small center">DirectInput uses the game’s own default layout until you customize it.</p>}
      </div>
    </div>
  )
}
