import type { GraphicsSettings } from '../../../shared/types'
import type { TabProps } from './Settings'
import { ResolutionRow, Section, SelectRow, ToggleRow } from './ui'

/** Smallest power of two that covers the window, capped at 4096 (what the game handles well). */
function recommendedBackground(w: number, h: number): number {
  let n = 1024
  while (n < Math.max(w, h) && n < 4096) n *= 2
  return n
}

function desktopResolution(): { w: number; h: number } {
  const r = window.devicePixelRatio || 1
  return { w: Math.round(window.screen.width * r), h: Math.round(window.screen.height * r) }
}

export default function GraphicsTab({ s, update }: TabProps): JSX.Element {
  const g = s.graphics
  const set = (patch: Partial<GraphicsSettings>): void => update({ graphics: { ...g, ...patch } })
  const rec = recommendedBackground(g.width, g.height)

  return (
    <div className="grid-2">
      <div className="col">
        <Section title="Resolutions">
          <SelectRow<number>
            label="Window mode"
            value={g.windowMode}
            options={[
              { value: 0, label: 'Fullscreen' },
              { value: 1, label: 'Windowed' },
              { value: 3, label: 'Borderless window' }
            ]}
            onChange={(v) => set({ windowMode: v as 0 | 1 | 3 })}
          />
          <ResolutionRow
            label="Window resolution"
            info="Size of the game window (or screen resolution in fullscreen)."
            w={g.width}
            h={g.height}
            action={{
              label: 'Use desktop',
              onClick: () => {
                const d = desktopResolution()
                set({ width: d.w, height: d.h })
              }
            }}
            onChange={(width, height) => set({ width, height })}
          />
          <ResolutionRow
            label="Background resolution"
            info="Resolution the 3D world is rendered at before it is scaled to the window. Higher is sharper but slower. Powers of two (2048, 4096) work best."
            w={g.bgWidth}
            h={g.bgHeight}
            action={g.bgWidth === rec && g.bgHeight === rec ? undefined : { label: `Recommended (${rec})`, onClick: () => set({ bgWidth: rec, bgHeight: rec }) }}
            onChange={(bgWidth, bgHeight) => set({ bgWidth, bgHeight })}
          />
          <ResolutionRow
            label="Menu resolution"
            info="Resolution of menus, chat and the HUD. Lower than the window makes the UI bigger; equal to the window gives the sharpest text."
            w={g.menuWidth}
            h={g.menuHeight}
            action={g.menuWidth === g.width && g.menuHeight === g.height ? undefined : { label: 'Match window', onClick: () => set({ menuWidth: g.width, menuHeight: g.height }) }}
            onChange={(menuWidth, menuHeight) => set({ menuWidth, menuHeight })}
          />
        </Section>

        <Section title="Quality">
          <SelectRow<number>
            label="Texture compression"
            info="Uncompressed looks best and costs more video memory."
            value={g.textureCompression}
            options={[
              { value: 0, label: 'High compression' },
              { value: 1, label: 'Low compression' },
              { value: 2, label: 'Uncompressed' }
            ]}
            onChange={(v) => set({ textureCompression: v as 0 | 1 | 2 })}
          />
          <SelectRow<number>
            label="Font type"
            value={g.fontCompression}
            options={[
              { value: 0, label: 'Compressed' },
              { value: 1, label: 'Uncompressed' },
              { value: 2, label: 'High quality' }
            ]}
            onChange={(v) => set({ fontCompression: v as 0 | 1 | 2 })}
          />
          <SelectRow<number>
            label="Environment animation"
            info="Animated water, foliage and other environment effects."
            value={g.envAnimations}
            options={[
              { value: 0, label: 'Off' },
              { value: 1, label: 'Normal' },
              { value: 2, label: 'Smooth' }
            ]}
            onChange={(v) => set({ envAnimations: v as 0 | 1 | 2 })}
          />
          <SelectRow<number>
            label="Mip mapping"
            info="Smooths distant textures. 6 is best quality."
            value={g.mipmap}
            options={[0, 1, 2, 3, 4, 5, 6].map((v) => ({ value: v, label: v === 0 ? 'Off' : v === 6 ? '6 (best)' : String(v) }))}
            onChange={(mipmap) => set({ mipmap })}
          />
        </Section>
      </div>

      <div className="col">
        <Section title="Features">
          <ToggleRow label="Bump mapping" info="Adds surface detail to textures." checked={g.bumpMapping} onChange={(bumpMapping) => set({ bumpMapping })} />
          <ToggleRow label="Uncompressed maps" info="Sharper in-game maps. Needed for most HD map packs." checked={g.uncompressedMaps} onChange={(uncompressedMaps) => set({ uncompressedMaps })} />
          <ToggleRow label="Graphics stabilization" info="Reduces flicker on some systems at a small performance cost. Leave off unless you see flickering." checked={g.graphicsStabilization} onChange={(graphicsStabilization) => set({ graphicsStabilization })} />
          <ToggleRow label="Maintain aspect ratio" info="Keeps the picture from stretching when the window shape changes." checked={g.maintainAspect} onChange={(maintainAspect) => set({ maintainAspect })} />
        </Section>
      </div>
    </div>
  )
}
