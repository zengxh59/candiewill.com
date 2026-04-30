import { useState } from 'react';
import { Layout } from '../components/Layout';
import {
  KEYBOARD_ROWS,
  FINGER_GROUPS,
  GAP,
  KEY_HEIGHT,
  keyWidth,
  type KeyDef,
} from '../data/keyboardLayout';

function KeyLabel({ keyDef, dimmed }: { keyDef: KeyDef; dimmed: boolean }) {
  if (keyDef.shift) {
    return (
      <div className="flex flex-col items-center leading-none" style={{ gap: 1 }}>
        <span style={{ fontSize: 8, opacity: dimmed ? 0.3 : 0.5, lineHeight: 1 }}>{keyDef.shift}</span>
        <span style={{ fontSize: 11, lineHeight: 1 }}>{keyDef.label}</span>
      </div>
    );
  }
  return <span>{keyDef.label}</span>;
}

export function FingerGuide() {
  const [activeGroup, setActiveGroup] = useState<number | null>(null);
  const active = activeGroup !== null ? FINGER_GROUPS[activeGroup] : null;

  return (
    <Layout>
      <h1 className="text-2xl font-bold text-gray-800 mb-6 text-center">Finger Guide</h1>

      <p className="text-center text-gray-500 mb-6">
        Tap a finger group below to see which keys it types!
      </p>

      <div className="grid grid-cols-2 gap-3 mb-8">
        {FINGER_GROUPS.map((group, i) => (
          <button
            key={i}
            onClick={() => setActiveGroup(activeGroup === i ? null : i)}
            className={`p-4 rounded-2xl transition-all text-left ${
              activeGroup === i ? 'shadow-lg scale-[1.02]' : 'shadow-sm hover:shadow-md'
            }`}
            style={{
              backgroundColor: activeGroup === i ? group.bgColor : '#FFFFFF',
              borderWidth: 2,
              borderColor: activeGroup === i ? group.color : 'transparent',
            }}
          >
            <div className="font-bold text-sm mb-1" style={{ color: group.color }}>
              {group.label}
            </div>
            <div className="flex gap-1 flex-wrap">
              {group.keys.map(kk => (
                <span
                  key={kk}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-md text-xs font-bold text-white"
                  style={{ backgroundColor: group.color }}
                >
                  {kk === '\\' ? '\\' : kk.toUpperCase()}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <div className="keyboard-scaler">
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
              {row.map((keyDef, ki) => {
                const group = FINGER_GROUPS.find(g => g.keys.includes(keyDef.id));
                const isActive = active?.keys.includes(keyDef.id);
                const dimmed = activeGroup !== null && !isActive && !keyDef.isMod;
                const w = keyWidth(keyDef.w);
                const isLetter = keyDef.id.length === 1 && /[a-z]/i.test(keyDef.id);

                return (
                  <div
                    key={`${ri}-${ki}`}
                    className="flex items-center justify-center relative transition-all duration-200"
                    style={{
                      width: w,
                      height: KEY_HEIGHT,
                      borderRadius: 5,
                      fontSize: keyDef.isMod ? (keyDef.label.length > 3 ? 9 : 10) : (isLetter ? 14 : 11),
                      fontWeight: keyDef.isMod ? 500 : (isLetter ? 600 : 500),
                      letterSpacing: keyDef.isMod ? 0.3 : 0,
                      backgroundColor: keyDef.isMod
                        ? '#3a3a3c'
                        : (isActive && group ? group.bgColor : (group?.bgColor ?? '#6b7280')),
                      color: keyDef.isMod ? '#9ca3af' : '#1f2937',
                      opacity: dimmed ? 0.3 : 1,
                      boxShadow: isActive
                        ? `0 0 0 2px ${group?.color}, 0 0 10px ${group?.color}40`
                        : keyDef.isMod
                          ? '0 2px 0 #2a2a2c, 0 1px 4px rgba(0,0,0,0.3)'
                          : '0 2px 0 rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.08)',
                    }}
                  >
                    {(keyDef.id === 'f' || keyDef.id === 'j') && (
                      <span
                        className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded"
                        style={{ width: 10, height: 2, backgroundColor: 'rgba(0,0,0,0.3)' }}
                      />
                    )}
                    <KeyLabel keyDef={keyDef} dimmed={dimmed} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {active && (
        <div className="mt-4 p-4 rounded-2xl text-center" style={{ backgroundColor: active.bgColor }}>
          <span className="font-bold" style={{ color: active.color }}>{active.label}</span>
          <span className="text-gray-600"> types: </span>
          <span className="font-bold" style={{ color: active.color }}>
            {active.keys.map(kk => kk === '\\' ? '\\' : kk.toUpperCase()).join(' ')}
          </span>
        </div>
      )}
    </Layout>
  );
}
