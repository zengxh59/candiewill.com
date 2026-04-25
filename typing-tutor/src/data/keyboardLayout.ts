export interface KeyDef {
  id: string;
  label: string;
  w: number;
  isMod: boolean;
  shift?: string;
}

export const KEY_SIZE = 36;
export const GAP = 3;
export const KEY_HEIGHT = 36;

export function keyWidth(w: number): number {
  return w * KEY_SIZE + (w - 1) * GAP;
}

const k = (id: string, label: string, w = 1, isMod = false, shift?: string): KeyDef => ({
  id, label, w, isMod, shift,
});

// Total row width target: ~15 units for consistent alignment
export const KEYBOARD_ROWS: KeyDef[][] = [
  // Number row (13×1 + 2 = 15u)
  [
    k('`', '`', 1, false, '~'),
    k('1', '1', 1, false, '!'),
    k('2', '2', 1, false, '@'),
    k('3', '3', 1, false, '#'),
    k('4', '4', 1, false, '$'),
    k('5', '5', 1, false, '%'),
    k('6', '6', 1, false, '^'),
    k('7', '7', 1, false, '&'),
    k('8', '8', 1, false, '*'),
    k('9', '9', 1, false, '('),
    k('0', '0', 1, false, ')'),
    k('-', '-', 1, false, '_'),
    k('=', '=', 1, false, '+'),
    k('Backspace', 'delete', 2, true),
  ],
  // QWERTY row (1.5 + 10 + 2 + 1.5 = 15u)
  [
    k('Tab', 'tab', 1.5, true),
    k('q', 'Q'), k('w', 'W'), k('e', 'E'), k('r', 'R'), k('t', 'T'),
    k('y', 'Y'), k('u', 'U'), k('i', 'I'), k('o', 'O'), k('p', 'P'),
    k('[', '[', 1, false, '{'),
    k(']', ']', 1, false, '}'),
    k('\\', '\\', 1.5, false, '|'),
  ],
  // Home row (1.75 + 9 + 2 + 2.25 = 15u)
  [
    k('CapsLock', 'caps', 1.75, true),
    k('a', 'A'), k('s', 'S'), k('d', 'D'), k('f', 'F'), k('g', 'G'),
    k('h', 'H'), k('j', 'J'), k('k', 'K'), k('l', 'L'),
    k(';', ';', 1, false, ':'),
    k("'", "'", 1, false, '"'),
    k('Enter', 'return', 2.25, true),
  ],
  // Shift row (2.25 + 10 + 2.75 = 15u)
  [
    k('Shift', 'shift', 2.25, true),
    k('z', 'Z'), k('x', 'X'), k('c', 'C'), k('v', 'V'), k('b', 'B'),
    k('n', 'N'), k('m', 'M'),
    k(',', ',', 1, false, '<'),
    k('.', '.', 1, false, '>'),
    k('/', '/', 1, false, '?'),
    k('Shift', 'shift', 2.75, true),
  ],
  // Bottom row (1 + 1 + 1.25 + 1.25 + 6.25 + 1.25 + 1.25 + 1 + 1 = 15u)
  [
    k('fn', 'fn', 1, true),
    k('Control', 'control', 1, true),
    k('Alt', 'option', 1.25, true),
    k('Meta', 'cmd', 1.25, true),
    k(' ', '', 6.25, true),
    k('Meta', 'cmd', 1.25, true),
    k('Alt', 'option', 1.25, true),
    k('ArrowLeft', '←', 1, true),
    k('ArrowRight', '→', 1, true),
  ],
];

export const FINGER_COLORS: Record<string, string> = {
  // Left pinky
  '`': '#fda4af', '1': '#fda4af', q: '#fda4af', a: '#fda4af', z: '#fda4af',
  // Left ring
  '2': '#fdba74', w: '#fdba74', s: '#fdba74', x: '#fdba74',
  // Left middle
  '3': '#fde047', e: '#fde047', d: '#fde047', c: '#fde047',
  // Left index
  '4': '#86efac', '5': '#86efac', r: '#86efac', t: '#86efac',
  f: '#86efac', g: '#86efac', v: '#86efac', b: '#86efac',
  // Right index
  '6': '#67e8f9', '7': '#67e8f9', y: '#67e8f9', u: '#67e8f9',
  h: '#67e8f9', j: '#67e8f9', n: '#67e8f9', m: '#67e8f9',
  // Right middle
  '8': '#a5b4fc', i: '#a5b4fc', k: '#a5b4fc', ',': '#a5b4fc',
  // Right ring
  '9': '#d8b4fe', o: '#d8b4fe', l: '#d8b4fe', '.': '#d8b4fe',
  // Right pinky
  '0': '#f0abfc', '-': '#f0abfc', '=': '#f0abfc', p: '#f0abfc',
  '[': '#f0abfc', ']': '#f0abfc', '\\': '#f0abfc',
  ';': '#f0abfc', "'": '#f0abfc', '/': '#f0abfc',
};

export const FINGER_GROUPS = [
  { label: 'Left Pinky', keys: ['`', '1', 'q', 'a', 'z'], color: '#e11d48', bgColor: '#fda4af' },
  { label: 'Left Ring', keys: ['2', 'w', 's', 'x'], color: '#ea580c', bgColor: '#fdba74' },
  { label: 'Left Middle', keys: ['3', 'e', 'd', 'c'], color: '#ca8a04', bgColor: '#fde047' },
  { label: 'Left Index', keys: ['4', '5', 'r', 't', 'f', 'g', 'v', 'b'], color: '#16a34a', bgColor: '#86efac' },
  { label: 'Right Index', keys: ['6', '7', 'y', 'u', 'h', 'j', 'n', 'm'], color: '#0891b2', bgColor: '#67e8f9' },
  { label: 'Right Middle', keys: ['8', 'i', 'k', ','], color: '#4f46e5', bgColor: '#a5b4fc' },
  { label: 'Right Ring', keys: ['9', 'o', 'l', '.'], color: '#7c3aed', bgColor: '#d8b4fe' },
  { label: 'Right Pinky', keys: ['0', '-', '=', 'p', '[', ']', '\\', ';', "'", '/'], color: '#c026d3', bgColor: '#f0abfc' },
];
