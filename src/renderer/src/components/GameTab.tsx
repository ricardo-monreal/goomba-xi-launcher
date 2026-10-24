import type { Language, SoundSettings } from '../../../shared/types'
import type { TabProps } from './Settings'
import { Info, Section, SelectRow, ToggleRow } from './ui'

export default function GameTab({ state, s, update, commit }: TabProps): JSX.Element {
  const bundled = state.config.clientMode === 'bundled'
  const g = s.graphics
  const setSound = (patch: Partial<SoundSettings>): void => update({ sound: { ...s.sound, ...patch } })

  const browse = async (key: 'installDir' | 'ffxiPath', title: string): Promise<void> => {
    const dir = await window.api.chooseFolder(title)
    if (dir) await commit({ [key]: dir })
  }

  return (
    <div className="grid-2">
      <div className="col">
        <Section title="Folders">
          <div className="row stack-row">
            <span className="row-label">
              {bundled ? 'Install folder' : 'Server files (Ashita, xiloader, addons)'}
              <Info text={bundled ? 'The game is installed here. Changing it does not move existing files: move the folder yourself first, or the launcher will download the game again.' : 'Where the launcher keeps Ashita, xiloader and addons.'} />
            </span>
            <div className="field-row">
              <input className="grow" value={s.installDir} readOnly />
              <button onClick={() => browse('installDir', 'Choose the install folder')}>Browse</button>
            </div>
          </div>
          {!bundled && (
            <>
              <div className="row stack-row">
                <span className="row-label">
                  FINAL FANTASY XI folder
                  <Info text="Leave empty to detect it from the registry." />
                </span>
                <div className="field-row">
                  <input className="grow" value={s.ffxiPath} placeholder={state.ffxi.source === 'registry' ? state.ffxi.path : 'Detect automatically'} readOnly />
                  <button onClick={() => browse('ffxiPath', 'Select your FINAL FANTASY XI folder')}>Browse</button>
                  {s.ffxiPath && <button onClick={() => commit({ ffxiPath: '' })}>Clear</button>}
                </div>
              </div>
              <SelectRow<Language>
                label="Client region"
                value={s.language}
                options={[
                  { value: 'US', label: 'North America (US)' },
                  { value: 'EU', label: 'Europe (EU)' },
                  { value: 'JP', label: 'Japan (JP)' }
                ]}
                onChange={(language) => commit({ language })}
              />
            </>
          )}
        </Section>

        <Section title="In game">
          <SelectRow<number>
            label="Frame rate"
            info="60 fps uses Ashita's fps addon (/fps 1). The game runs at 30 fps by default. Some cutscenes and animations can look slightly fast at 60."
            value={s.frameRate}
            options={[
              { value: 60, label: '60 fps' },
              { value: 30, label: '30 fps (game default)' }
            ]}
            onChange={(v) => update({ frameRate: v as 30 | 60 })}
          />
          <div className="row stack-row">
            <span className="row-label">
              Startup commands
              <Info text="Ashita commands run every time the game starts, one per line (e.g. /bind F10 /hideui or /fps hide). Lines that don't start with / are ignored." />
            </span>
            <textarea
              rows={4}
              spellCheck={false}
              placeholder={'/fps hide\n/bind ^F10 /hideui'}
              value={s.customCommands}
              onChange={(e) => update({ customCommands: e.target.value })}
            />
          </div>
        </Section>

        <Section title="Launcher">
          <ToggleRow label="Close the launcher after the game starts" checked={s.closeOnLaunch} onChange={(closeOnLaunch) => update({ closeOnLaunch })} />
        </Section>
      </div>

      <div className="col">
        <Section title="Sound">
          <ToggleRow label="Sound enabled" checked={s.sound.enabled} onChange={(enabled) => setSound({ enabled })} />
          <ToggleRow label="Play sound in the background" info="Keep sound playing while the game window isn't focused." checked={s.sound.alwaysOn} disabled={!s.sound.enabled} onChange={(alwaysOn) => setSound({ alwaysOn })} />
          <div className={s.sound.enabled ? 'row stack-row' : 'row stack-row disabled'}>
            <span className="row-label">
              Max simultaneous sounds: {s.sound.maxSounds}
              <Info text="12 is lowest, 20 is highest." />
            </span>
            <input type="range" min={12} max={20} value={s.sound.maxSounds} disabled={!s.sound.enabled} onChange={(e) => setSound({ maxSounds: Number(e.target.value) })} />
          </div>
        </Section>

        <Section title="Gameplay">
          <ToggleRow label="Play opening movie" checked={g.openingMovie} onChange={(openingMovie) => update({ graphics: { ...g, openingMovie } })} />
          <ToggleRow label="Simplified character creation visuals" info="Uses lighter visuals on the character creation screen." checked={g.simplifiedCharCreation} onChange={(simplifiedCharCreation) => update({ graphics: { ...g, simplifiedCharCreation } })} />
          <ToggleRow label="Hardware mouse" info="Uses the Windows cursor instead of the game's software cursor. Smoother on most systems." checked={g.hardwareMouse} onChange={(hardwareMouse) => update({ graphics: { ...g, hardwareMouse } })} />
        </Section>
      </div>
    </div>
  )
}
