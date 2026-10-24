import { diagramLabels, PadType, Physical } from '../../../shared/controller'

interface Props {
  type: PadType
  map: number[]
  dimmed?: boolean
}

type Anchor = 'start' | 'middle' | 'end'

// Where each control's label goes (x, y, text-anchor) in SVG units.
const LABEL_POS: Partial<Record<Physical, [number, number, Anchor]>> = {
  lt: [330, 40, 'middle'],
  rt: [770, 40, 'middle'],
  lb: [225, 150, 'end'],
  rb: [872, 150, 'start'],
  l3: [330, 188, 'middle'],
  lsV: [330, 354, 'middle'],
  lsH: [330, 388, 'middle'],
  r3: [665, 494, 'middle'],
  rsV: [665, 528, 'middle'],
  rsH: [665, 562, 'middle'],
  back: [480, 294, 'middle'],
  start: [620, 294, 'middle'],
  home: [550, 160, 'middle'],
  touchpad: [550, 124, 'middle'],
  mute: [550, 330, 'middle'],
  faceTop: [800, 174, 'middle'],
  faceLeft: [712, 328, 'end'],
  faceRight: [905, 270, 'start'],
  faceBottom: [800, 388, 'middle'],
  dUp: [435, 330, 'middle'],
  dDown: [435, 522, 'middle'],
  dLeft: [362, 432, 'end'],
  dRight: [508, 432, 'start'],
  dpadV: [435, 330, 'middle'],
  dpadH: [362, 432, 'end']
}

const FACE: Record<PadType, Record<'top' | 'left' | 'right' | 'bottom', string>> = {
  xinput: { top: 'Y', left: 'X', right: 'B', bottom: 'A' },
  dinput: { top: '△', left: '□', right: '○', bottom: '✕' }
}

function Tag({ x, y, anchor, text, muted }: { x: number; y: number; anchor: Anchor; text: string; muted?: boolean }): JSX.Element {
  const label = text.toUpperCase()
  const w = label.length * 10.6 + 22
  const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2
  return (
    <g className={muted ? 'tag muted-tag' : 'tag'}>
      <rect x={left} y={y - 15} width={w} height={30} rx={3} />
      <text x={left + w / 2} y={y + 6} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

export default function ControllerDiagram({ type, map, dimmed }: Props): JSX.Element {
  const labels = diagramLabels(map, type)
  const face = FACE[type]
  const stickAxis = (h?: string, v?: string): string[] => (h && h === v ? [h] : [v, h].filter((x): x is string => !!x))

  const tags: JSX.Element[] = []
  const put = (phys: Physical, text?: string, muted = false, dy = 0): void => {
    const pos = LABEL_POS[phys]
    if (!pos || !text) return
    tags.push(<Tag key={`${phys}-${dy}`} x={pos[0]} y={pos[1] + dy} anchor={pos[2]} text={text} muted={muted} />)
  }

  for (const p of ['lt', 'rt', 'lb', 'rb', 'l3', 'r3', 'back', 'start', 'home', 'touchpad', 'mute', 'faceTop', 'faceLeft', 'faceRight', 'faceBottom', 'dUp', 'dDown', 'dLeft', 'dRight'] as Physical[]) {
    put(p, labels[p])
  }
  // Sticks: show their axis actions under the stick, merged when both axes do the same thing.
  stickAxis(labels.lsH, labels.lsV).forEach((t, i) => put('lsV', t, true, i * 34))
  stickAxis(labels.rsH, labels.rsV).forEach((t, i) => put('rsV', t, true, i * 34))
  // DirectInput D-pad is two axes rather than four buttons.
  if (labels.dpadV) put('dpadV', labels.dpadV)
  if (labels.dpadH && labels.dpadH !== labels.dpadV) put('dpadH', labels.dpadH)

  return (
    <svg className={dimmed ? 'pad dimmed' : 'pad'} viewBox="90 0 930 640" role="img" aria-label="Controller button layout">
      {/* triggers */}
      <path className="pad-trigger" d="M290 70 q40 -18 80 0 l8 72 h-96 z" />
      <path className="pad-trigger" d="M730 70 q40 -18 80 0 l8 72 h-96 z" />
      {/* bumpers */}
      <path className="pad-bumper" d="M245 168 q40 -42 135 -36 l10 26 q-90 -2 -128 34 z" />
      <path className="pad-bumper" d="M855 168 q-40 -42 -135 -36 l-10 26 q90 -2 128 34 z" />
      {/* body */}
      <path
        className="pad-body"
        d="M300 160 Q550 120 800 160 Q900 175 925 300 Q960 470 955 560 Q950 620 885 615 Q840 610 790 520 Q760 470 700 470 H400 Q340 470 310 520 Q260 610 215 615 Q150 620 145 560 Q140 470 175 300 Q200 175 300 160 Z"
      />
      {/* left stick */}
      <circle className="pad-well" cx={330} cy={270} r={62} />
      <circle className="pad-stick" cx={330} cy={270} r={44} />
      {/* right stick */}
      <circle className="pad-well" cx={665} cy={410} r={62} />
      <circle className="pad-stick" cx={665} cy={410} r={44} />
      {/* d-pad */}
      <g className="pad-dpad">
        <rect x={413} y={360} width={44} height={144} rx={6} />
        <rect x={363} y={410} width={144} height={44} rx={6} />
      </g>
      {/* center buttons */}
      <circle className="pad-small" cx={480} cy={250} r={16} />
      <circle className="pad-small" cx={620} cy={250} r={16} />
      <circle className="pad-home" cx={550} cy={200} r={22} />
      {/* face buttons */}
      <g className="pad-face">
        <circle cx={800} cy={222} r={30} />
        <circle cx={745} cy={277} r={30} />
        <circle cx={855} cy={277} r={30} />
        <circle cx={800} cy={332} r={30} />
        <text x={800} y={233}>{face.top}</text>
        <text x={745} y={288}>{face.left}</text>
        <text x={855} y={288}>{face.right}</text>
        <text x={800} y={343}>{face.bottom}</text>
      </g>
      {tags}
    </svg>
  )
}
