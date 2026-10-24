// FFXI gamepad configuration, shared by the main process (writes the boot ini) and the UI.
//
// The game stores its pad setup in three registry values, which Ashita lets us override from the
// boot profile's [ffxi.registry] section (see https://docs.ashitaxi.com/usage/configurations/):
//   padmode000 = enable, force feedback, sliders, hat switches, active when unfocused, xinput
//   padsin000  = 27 comma-separated button codes, one per in-game action (order below)
//   padguid000 = DirectInput GUID of the device to use, or -1 for automatic

export type PadType = 'xinput' | 'dinput'

/** Where a control sits on a controller, used to draw the diagram. */
export type Physical =
  | 'faceBottom' | 'faceRight' | 'faceLeft' | 'faceTop'
  | 'dUp' | 'dDown' | 'dLeft' | 'dRight' | 'dpadH' | 'dpadV'
  | 'lb' | 'rb' | 'lt' | 'rt' | 'l3' | 'r3'
  | 'start' | 'back' | 'home' | 'touchpad' | 'mute'
  | 'lsH' | 'lsV' | 'rsH' | 'rsV'

export interface PadButton {
  code: number
  label: string
  physical?: Physical
}

/** The 27 in-game actions, in padsin000 order. `group` collapses directional actions on the diagram. */
export const PAD_ACTIONS: { label: string; short: string; group?: string }[] = [
  { label: 'Toggle auto-run', short: 'Autorun' },
  { label: 'Macro palette (Ctrl)', short: 'Macro (Ctrl)' },
  { label: 'Toggle first/third person', short: 'Change view' },
  { label: 'Macro palette (Alt)', short: 'Macro (Alt)' },
  { label: 'Toggle /heal, lock target', short: 'Heal / Lock' },
  { label: 'Cancel', short: 'Cancel' },
  { label: 'Main menu', short: 'Main menu' },
  { label: 'Select / confirm', short: 'Confirm' },
  { label: 'Select active window', short: 'Active window' },
  { label: 'Toggle menu visibility', short: 'Hide menus' },
  { label: 'Navigate menus with movement stick (hold)', short: 'Menu stick (hold)' },
  { label: 'Move camera with movement stick (hold)', short: 'Camera stick (hold)' },
  { label: 'Logout window', short: 'Logout' },
  { label: 'Move up', short: 'Move up', group: 'Move' },
  { label: 'Move down', short: 'Move down', group: 'Move' },
  { label: 'Move left', short: 'Move left', group: 'Move' },
  { label: 'Move right', short: 'Move right', group: 'Move' },
  { label: 'Camera up', short: 'Camera up', group: 'Camera' },
  { label: 'Camera down', short: 'Camera down', group: 'Camera' },
  { label: 'Camera left', short: 'Camera left', group: 'Camera' },
  { label: 'Camera right', short: 'Camera right', group: 'Camera' },
  { label: 'Menu up / target', short: 'Menu up', group: 'Menu' },
  { label: 'Menu down / target', short: 'Menu down', group: 'Menu' },
  { label: 'Menu left / target', short: 'Menu left', group: 'Menu' },
  { label: 'Menu right / target', short: 'Menu right', group: 'Menu' },
  { label: 'Screenshot (menus hidden)', short: 'Screenshot' },
  { label: 'Toggle movement / menu / camera controls', short: 'Toggle controls' }
]

export const NONE = -1

// Button codes from the Ashita documentation. For axes, the sign picks the direction;
// the docs mark which sign is "reversed" for each mode.
export const XINPUT_BUTTONS: PadButton[] = [
  { code: NONE, label: 'None' },
  { code: 3, label: 'A', physical: 'faceBottom' },
  { code: 0, label: 'B', physical: 'faceRight' },
  { code: 1, label: 'X', physical: 'faceLeft' },
  { code: 2, label: 'Y', physical: 'faceTop' },
  { code: 8, label: 'LB', physical: 'lb' },
  { code: 11, label: 'RB', physical: 'rb' },
  { code: 9, label: 'LT', physical: 'lt' },
  { code: 12, label: 'RT', physical: 'rt' },
  { code: 10, label: 'Left stick click (L3)', physical: 'l3' },
  { code: 13, label: 'Right stick click (R3)', physical: 'r3' },
  { code: 14, label: 'Start', physical: 'start' },
  { code: 15, label: 'Back', physical: 'back' },
  { code: 6, label: 'D-pad up', physical: 'dUp' },
  { code: 7, label: 'D-pad down', physical: 'dDown' },
  { code: 5, label: 'D-pad left', physical: 'dLeft' },
  { code: 4, label: 'D-pad right', physical: 'dRight' },
  { code: 32, label: 'Left stick ↔', physical: 'lsH' },
  { code: -32, label: 'Left stick ↔ (inverted)', physical: 'lsH' },
  { code: -33, label: 'Left stick ↕', physical: 'lsV' },
  { code: 33, label: 'Left stick ↕ (inverted)', physical: 'lsV' },
  { code: 35, label: 'Right stick ↔', physical: 'rsH' },
  { code: -35, label: 'Right stick ↔ (inverted)', physical: 'rsH' },
  { code: -36, label: 'Right stick ↕', physical: 'rsV' },
  { code: 36, label: 'Right stick ↕ (inverted)', physical: 'rsV' }
]

export const DINPUT_BUTTONS: PadButton[] = [
  { code: NONE, label: 'None' },
  { code: 1, label: 'Cross (✕)', physical: 'faceBottom' },
  { code: 2, label: 'Circle (○)', physical: 'faceRight' },
  { code: 0, label: 'Square (□)', physical: 'faceLeft' },
  { code: 3, label: 'Triangle (△)', physical: 'faceTop' },
  { code: 4, label: 'L1', physical: 'lb' },
  { code: 5, label: 'R1', physical: 'rb' },
  { code: 6, label: 'L2', physical: 'lt' },
  { code: 7, label: 'R2', physical: 'rt' },
  { code: 10, label: 'L3', physical: 'l3' },
  { code: 11, label: 'R3', physical: 'r3' },
  { code: 8, label: 'Select / Share', physical: 'back' },
  { code: 9, label: 'Start / Options', physical: 'start' },
  { code: 12, label: 'PS / Home button', physical: 'home' },
  { code: 13, label: 'Touchpad button', physical: 'touchpad' },
  { code: 14, label: 'Mute button', physical: 'mute' },
  { code: 41, label: 'D-pad ↕', physical: 'dpadV' },
  { code: -41, label: 'D-pad ↕ (inverted)', physical: 'dpadV' },
  { code: 40, label: 'D-pad ↔', physical: 'dpadH' },
  { code: -40, label: 'D-pad ↔ (inverted)', physical: 'dpadH' },
  { code: 32, label: 'Left stick ↔', physical: 'lsH' },
  { code: -32, label: 'Left stick ↔ (inverted)', physical: 'lsH' },
  { code: 33, label: 'Left stick ↕', physical: 'lsV' },
  { code: -33, label: 'Left stick ↕ (inverted)', physical: 'lsV' },
  { code: 34, label: 'Right stick ↔', physical: 'rsH' },
  { code: -34, label: 'Right stick ↔ (inverted)', physical: 'rsH' },
  { code: 37, label: 'Right stick ↕', physical: 'rsV' },
  { code: -37, label: 'Right stick ↕ (inverted)', physical: 'rsV' }
]

export const buttonsFor = (t: PadType): PadButton[] => (t === 'xinput' ? XINPUT_BUTTONS : DINPUT_BUTTONS)

/**
 * XInput default layout (the common private-server layout):
 * LB autorun, LT/RT macro palettes, L3 heal/lock, R3 change view, A confirm, B cancel,
 * X main menu, Y active window, Back hide menus, Start logout, RB screenshot,
 * left stick move, right stick camera, D-pad menus.
 */
export const DEFAULT_XINPUT_MAP = [8, 9, 13, 12, 10, 0, 1, 3, 2, 15, -1, -1, 14, -33, -33, 32, 32, -36, -36, 35, 35, 6, 7, 5, 4, 11, -1]

/**
 * Same layout for DirectInput (PlayStation-style) pads. Only written to the game when the player
 * customizes it; otherwise the game's own DirectInput defaults are used. Axis directions on
 * DirectInput pads vary by device, so players may need to pick an "(inverted)" entry.
 */
export const DEFAULT_DINPUT_MAP = [4, 6, 11, 7, 10, 2, 0, 1, 3, 8, -1, -1, 9, 33, 33, 32, 32, 37, 37, 34, 34, 41, 41, 40, 40, 5, -1]

export const defaultMapFor = (t: PadType): number[] => [...(t === 'xinput' ? DEFAULT_XINPUT_MAP : DEFAULT_DINPUT_MAP)]

/** Repairs a stored mapping (wrong length / unknown codes) against the given pad type. */
export function normalizeMap(map: number[] | undefined | null, t: PadType): number[] {
  const valid = new Set(buttonsFor(t).map((b) => b.code))
  const def = defaultMapFor(t)
  if (!Array.isArray(map) || map.length !== PAD_ACTIONS.length) return def
  return map.map((c, i) => (Number.isInteger(c) && valid.has(c) ? c : def[i]))
}

/** Labels to draw next to each physical control, e.g. { faceBottom: 'Confirm', lsV: 'Move' }. */
export function diagramLabels(map: number[], t: PadType): Partial<Record<Physical, string>> {
  const byCode = new Map(buttonsFor(t).map((b) => [b.code, b.physical]))
  const acc = new Map<Physical, string[]>()
  map.forEach((code, i) => {
    const phys = byCode.get(code)
    if (!phys) return
    const a = PAD_ACTIONS[i]
    const name = a.group ?? a.short
    const list = acc.get(phys) ?? []
    if (!list.includes(name)) list.push(name)
    acc.set(phys, list)
  })
  // A directional group that spans both axes of one stick is just "Move" / "Camera" on that stick.
  const out: Partial<Record<Physical, string>> = {}
  for (const [phys, names] of acc) out[phys] = names.join(' / ')
  // Single-direction D-pad buttons keep their specific label (Menu up, Menu left, ...).
  map.forEach((code, i) => {
    const phys = byCode.get(code)
    if (phys && ['dUp', 'dDown', 'dLeft', 'dRight'].includes(phys) && acc.get(phys)?.length === 1) {
      out[phys] = PAD_ACTIONS[i].short
    }
  })
  return out
}
