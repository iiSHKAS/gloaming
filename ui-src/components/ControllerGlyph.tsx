export type PadLayout = 'xbox' | 'playstation';
export type PadGlyphName = 'south' | 'east' | 'west' | 'north' | 'dpad-h' | 'dpad-up' | 'dpad-down' | 'dpad-left' | 'dpad-right' | 'triggers' | 'shoulders';

const FACE = {
  xbox: {south: ['A', '#3fb950'], east: ['B', '#f04c4c'], west: ['X', '#3d8bfd'], north: ['Y', '#f2c230']},
  playstation: {south: ['✕', '#6aa7ff'], east: ['○', '#ff6b6b'], west: ['□', '#ff8ad0'], north: ['△', '#3ddc97']},
} as const;

const label = {
  south: {xbox: 'A', playstation: 'Cross'}, east: {xbox: 'B', playstation: 'Circle'},
  west: {xbox: 'X', playstation: 'Square'}, north: {xbox: 'Y', playstation: 'Triangle'},
};

/** Button icon in the vocabulary of the pad that is actually connected. */
export function ControllerGlyph({name, layout}: {name: PadGlyphName; layout: PadLayout}) {
  if (name === 'south' || name === 'east' || name === 'west' || name === 'north') {
    const [text, color] = FACE[layout][name];
    return <svg className="pad-glyph" viewBox="0 0 32 32" role="img" aria-label={label[name][layout]}>
      <circle cx="16" cy="16" r="14" fill="#14161a" stroke={color} strokeWidth="2.4"/>
      <text x="16" y="16" textAnchor="middle" dominantBaseline="central" fill={color} fontSize={layout === 'xbox' ? 17 : 16} fontWeight="800" fontFamily="system-ui,sans-serif">{text}</text>
    </svg>;
  }
  if (name === 'triggers') return <PillGlyph texts={layout === 'xbox' ? ['LT', 'RT'] : ['L2', 'R2']}/>;
  if (name === 'shoulders') return <PillGlyph texts={layout === 'xbox' ? ['LB', 'RB'] : ['L1', 'R1']}/>;
  const arms = {'dpad-h': ['left', 'right'], 'dpad-up': ['up'], 'dpad-down': ['down'], 'dpad-left': ['left'], 'dpad-right': ['right']}[name];
  return <svg className="pad-glyph" viewBox="0 0 32 32" role="img" aria-label={`D-pad ${arms.join(' ')}`}>
    <path d="M12 3h8v9h9v8h-9v9h-8v-9H3v-8h9z" fill="#14161a" stroke="#d7dbe0" strokeWidth="2" strokeLinejoin="round"/>
    {arms.includes('up') && <path d="M16 6l4 5h-8z" fill="#fff"/>}
    {arms.includes('down') && <path d="M16 26l4-5h-8z" fill="#fff"/>}
    {arms.includes('left') && <path d="M6 16l5-4v8z" fill="#fff"/>}
    {arms.includes('right') && <path d="M26 16l-5-4v8z" fill="#fff"/>}
  </svg>;
}

/** One or two rounded caps (shoulders, triggers, menu buttons) with their labels. */
function PillGlyph({texts}: {texts: string[]}) {
  const width = texts.map(text => Math.max(34, text.length * 9 + 18));
  const total = width.reduce((sum, n) => sum + n + 6, -6) + 2;
  let x = 1;
  return <svg className="pad-glyph" style={{width: total}} viewBox={`0 0 ${total} 32`} role="img" aria-label={texts.join(' ')}>
    {texts.map((text, index) => {
      const left = x; x += width[index] + 6;
      return <g key={text}>
        <rect x={left} y="3" width={width[index]} height="26" rx="9" fill="#14161a" stroke="#d7dbe0" strokeWidth="2"/>
        <text x={left + width[index] / 2} y="16" textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize="13" fontWeight="800" fontFamily="system-ui,sans-serif">{text}</text>
      </g>;
    })}
  </svg>;
}

/** Glyph for a raw evdev button name as stored in the config (BTN_SOUTH, BTN_TL2, …). */
export function ButtonGlyph({button, layout}: {button: string; layout: PadLayout}) {
  const named: Record<string, PadGlyphName> = {
    BTN_SOUTH: 'south', BTN_EAST: 'east', BTN_WEST: 'west', BTN_NORTH: 'north',
    BTN_DPAD_UP: 'dpad-up', BTN_DPAD_DOWN: 'dpad-down', BTN_DPAD_LEFT: 'dpad-left', BTN_DPAD_RIGHT: 'dpad-right',
  };
  if (named[button]) return <ControllerGlyph name={named[button]} layout={layout}/>;
  const xbox = layout === 'xbox';
  const text: Record<string, string> = {
    BTN_TL: xbox ? 'LB' : 'L1', BTN_TR: xbox ? 'RB' : 'R1', BTN_TL2: xbox ? 'LT' : 'L2', BTN_TR2: xbox ? 'RT' : 'R2',
    BTN_SELECT: xbox ? 'View' : 'Create', BTN_START: xbox ? 'Menu' : 'Options', BTN_MODE: xbox ? 'Guide' : 'PS',
    BTN_THUMBL: 'L3', BTN_THUMBR: 'R3',
  };
  return <PillGlyph texts={[text[button] ?? button]}/>;
}
