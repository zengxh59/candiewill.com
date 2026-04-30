import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { VirtualKeyboard } from '../components/VirtualKeyboard';
import { ProgressBar } from '../components/ProgressBar';
import { useTypingPractice } from '../hooks/useTypingPractice';
import { getChildStats, savePracticeRecord, updateBestStreak } from '../services/storage';
import { LETTER_LEVELS } from '../data/letters';
import { PracticeSummary } from './PracticeSummary';
import type { ChildId, PracticeRecord } from '../types';

function generateLevelItems(level: number): { items: string[]; targets: string[] } {
  const keys = LETTER_LEVELS[level].keys;
  const items: string[] = [];
  for (let i = 0; i < 20; i++) {
    items.push(keys[Math.floor(Math.random() * keys.length)]);
  }
  return { items, targets: [...items] };
}

export function LetterPractice() {
  const { childId } = useParams<{ childId: ChildId }>();
  const navigate = useNavigate();
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [record, setRecord] = useState<PracticeRecord | null>(null);

  if (!childId) return null;

  function startLevel(level: number) {
    setSelectedLevel(level);
  }

  const stats = getChildStats(childId);
  const accent = childId === 'candie' ? '#F472B6' : '#60A5FA';

  if (record) {
    return (
      <Layout>
        <PracticeSummary
          record={record}
          accent={accent}
          onRetry={() => {
            setRecord(null);
            startLevel(record.level ?? 0);
          }}
          onNext={record.passed && (record.level ?? 0) < 3 ? () => {
            setRecord(null);
            startLevel((record.level ?? 0) + 1);
          } : undefined}
          onHome={() => navigate(`/${childId}/home`)}
        />
      </Layout>
    );
  }

  if (selectedLevel === null) {
    return (
      <Layout>
        <h1 className="text-2xl font-bold text-gray-800 mb-6 text-center">Letter Practice</h1>
        <div className="grid gap-3">
          {LETTER_LEVELS.map((lvl, i) => {
            const result = stats.letterLevels[i];
            const unlocked = i === 0 || (stats.letterLevels[i - 1]?.passed ?? false);
            const passed = result?.passed ?? false;

            return (
              <button
                key={i}
                disabled={!unlocked}
                onClick={() => startLevel(i)}
                className={`w-full p-4 rounded-2xl shadow-sm transition-all flex items-center justify-between ${
                  unlocked
                    ? 'bg-white hover:shadow-md active:scale-[0.98]'
                    : 'bg-gray-100 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="text-left">
                  <div className="font-bold text-lg text-gray-800">
                    Level {i + 1}: {lvl.name}
                  </div>
                  <div className="text-sm text-gray-500">
                    Keys: {lvl.keys.join(' ').toUpperCase()}
                  </div>
                </div>
                <div className="text-2xl">
                  {passed ? '⭐' : unlocked ? '→' : '🔒'}
                </div>
              </button>
            );
          })}
        </div>
      </Layout>
    );
  }

  return <LevelPlay childId={childId} level={selectedLevel} accent={accent} onFinish={r => {
    savePracticeRecord(childId, r);
    updateBestStreak(childId, r.correct);
    setRecord(r);
  }} />;
}

function LevelPlay({ childId, level, accent, onFinish }: {
  childId: ChildId;
  level: number;
  accent: string;
  onFinish: (record: PracticeRecord) => void;
}) {
  const [{ items, targets }] = useState(() => generateLevelItems(level));

  const practice = useTypingPractice({
    mode: 'letter',
    level,
    items,
    targets,
  });

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.key === 'Escape') return;
    e.preventDefault();
    practice.handleKey(e.key);
  }, [practice.handleKey]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (practice.completed) {
      onFinish(practice.getRecord());
    }
  }, [practice.completed]);

  return (
    <Layout>
      <div className="text-center mb-2">
        <span className="text-sm font-medium px-3 py-1 rounded-full" style={{ backgroundColor: accent + '20', color: accent }}>
          Level {level + 1}: {LETTER_LEVELS[level].name}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mb-4 text-sm text-gray-600">
        <span>Correct: <strong className="text-green-500">{practice.correct}</strong></span>
        <span>Errors: <strong className="text-red-400">{practice.errors}</strong></span>
        <span>Streak: <strong style={{ color: accent }}>{practice.currentStreak}</strong></span>
        <span>Time: <strong>{practice.elapsed}s</strong></span>
      </div>

      <ProgressBar progress={practice.progress} />

      <div className="my-4 sm:my-6 text-center">
        {practice.currentTarget && (
          <div
            className="inline-block text-6xl sm:text-8xl font-bold rounded-2xl p-3 sm:p-6 transition-all duration-200"
            style={{
              color: practice.feedback === 'correct' ? '#34D399'
                : practice.feedback === 'wrong' ? '#F87171'
                : '#374151',
              backgroundColor: practice.feedback === 'correct' ? '#ECFDF5'
                : practice.feedback === 'wrong' ? '#FEF2F2'
                : '#FFFFFF',
            }}
          >
            {practice.currentTarget.toUpperCase()}
          </div>
        )}
        {practice.encouragement && (
          <div className={`mt-3 text-xl font-bold ${
            practice.feedback === 'correct' ? 'text-green-500' : 'text-amber-500'
          }`}>
            {practice.encouragement}
          </div>
        )}
      </div>

      <p className="text-center text-gray-400 text-sm mb-2">
        Press the highlighted key on your keyboard
      </p>

      <VirtualKeyboard
        targetKey={practice.currentTarget}
        wrongKey={practice.feedback === 'wrong' ? practice.feedbackKey : null}
        correctKey={practice.feedback === 'correct' ? practice.feedbackKey : null}
      />
    </Layout>
  );
}
