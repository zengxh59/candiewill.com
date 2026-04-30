import { useKeyPress } from '../hooks/useKeyPress';
import {
  KEYBOARD_ROWS,
  FINGER_COLORS,
  GAP,
  KEY_HEIGHT,
  keyWidth,
  type KeyDef,
} from '../data/keyboardLayout';

interface VirtualKeyboardProps {
  targetKey?: string | null;
  wrongKey?: string | null;
  correctKey?: string | null;
}

function KeyLabel({ keyDef }: { keyDef: KeyDef }) {
  if (keyDef.shift) {
    return (
      <div className="flex flex-col items-center leading-none" style={{ gap: 1 }}>
        <span style={{ fontSize: 8, opacity: 0.5, lineHeight: 1 }}>{keyDef.shift}</span>
        <span style={{ fontSize: 11, lineHeight: 1 }}>{keyDef.label}</span>
      </div>
    );
  }
  return <span>{keyDef.label}</span>;
}

function getKeyStyle(
  keyDef: KeyDef,
  targetKey: string | null | undefined,
  wrongKey: string | null | undefined,
  correctKey: string | null | undefined,
  pressedKey: string | null,
): React.CSSProperties {
  const w = keyWidth(keyDef.w);
  const lowerId = keyDef.id.toLowerCase();

  // Modifier keys
  if (keyDef.isMod) {
    const base: React.CSSProperties = {
      width: w,
      height: KEY_HEIGHT,
      backgroundColor: '#3a3a3c',
      color: '#9ca3af',
      borderRadius: 5,
      boxShadow: '0 2px 0 #2a2a2c, 0 1px 4px rgba(0,0,0,0.3)',
      fontSize: keyDef.label.length > 3 ? 9 : 10,
      fontWeight: 500,
      letterSpacing: 0.3,
    };
    if (lowerId === pressedKey?.toLowerCase()) {
      return { ...base, transform: 'translateY(2px)', boxShadow: '0 0 1px rgba(0,0,0,0.2)' };
    }
    return base;
  }

  // Regular keys with finger color
  const fingerColor = FINGER_COLORS[keyDef.id] ?? '#6b7280';
  const isLetter = keyDef.id.length === 1 && /[a-z]/i.test(keyDef.id);

  const base: React.CSSProperties = {
    width: w,
    height: KEY_HEIGHT,
    backgroundColor: fingerColor,
    color: '#1f2937',
    borderRadius: 5,
    boxShadow: '0 2px 0 rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.08)',
    fontSize: isLetter ? 14 : 11,
    fontWeight: isLetter ? 600 : 500,
  };

  if (lowerId === targetKey?.toLowerCase()) {
    return {
      ...base,
      boxShadow: '0 0 0 3px #facc15, 0 0 16px rgba(250,204,21,0.5)',
      transform: 'scale(1.08)',
      zIndex: 1,
      fontWeight: 'bold',
    };
  }

  if (lowerId === wrongKey?.toLowerCase()) {
    return {
      ...base,
      boxShadow: '0 0 0 3px #f87171, 0 0 8px rgba(248,113,113,0.4)',
    };
  }

  if (lowerId === correctKey?.toLowerCase()) {
    return {
      ...base,
      boxShadow: '0 0 0 3px #34d399, 0 0 8px rgba(52,211,153,0.4)',
    };
  }

  if (lowerId === pressedKey?.toLowerCase()) {
    return {
      ...base,
      transform: 'translateY(2px)',
      boxShadow: '0 0 1px rgba(0,0,0,0.1)',
      transition: 'all 0.05s',
    };
  }

  return base;
}

export function VirtualKeyboard({ targetKey, wrongKey, correctKey }: VirtualKeyboardProps) {
  const { pressedKey } = useKeyPress();

  return (
    <div className="keyboard-scaler py-4 select-none">
      <div
        style={{
          backgroundColor: '#1d1d1f',
          borderRadius: 12,
          padding: GAP * 2,
          display: 'inline-flex',
          flexDirection: 'column',
          gap: GAP,
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        }}
      >
        {KEYBOARD_ROWS.map((row, ri) => (
          <div key={ri} style={{ display: 'flex', gap: GAP }}>
            {row.map((keyDef, ki) => (
              <div
                key={`${ri}-${ki}`}
                className="flex items-center justify-center relative transition-all duration-75"
                style={getKeyStyle(keyDef, targetKey, wrongKey, correctKey, pressedKey)}
              >
                {(keyDef.id === 'f' || keyDef.id === 'j') && (
                  <span
                    className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded"
                    style={{ width: 10, height: 2, backgroundColor: 'rgba(0,0,0,0.3)' }}
                  />
                )}
                <KeyLabel keyDef={keyDef} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
