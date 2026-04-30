import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { VirtualKeyboard } from '../components/VirtualKeyboard';
import { ProgressBar } from '../components/ProgressBar';
import { getChildStats, savePracticeRecord, updateBestStreak } from '../services/storage';
import { PINYIN_WORDS } from '../data/pinyin';
import { PracticeSummary } from './PracticeSummary';
import type { ChildId, PracticeRecord } from '../types';

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function PinyinPractice() {
  const { childId } = useParams<{ childId: ChildId }>();
  const navigate = useNavigate();
  const [started, setStarted] = useState(false);
  const [record, setRecord] = useState<PracticeRecord | null>(null);

  if (!childId) return null;
  const accent = childId === 'candie' ? '#F472B6' : '#60A5FA';

  if (record) {
    return (
      <Layout>
        <PracticeSummary
          record={record}
          accent={accent}
          onRetry={() => { setRecord(null); setStarted(false); }}
          onHome={() => navigate(`/${childId}/home`)}
        />
      </Layout>
    );
  }

  if (!started) {
    return (
      <Layout>
        <h1 className="text-2xl font-bold text-gray-800 mb-4 text-center">Pinyin Practice</h1>
        <div className="bg-white rounded-2xl p-6 shadow-sm mb-6">
          <p className="text-gray-600 mb-4">
            See the Chinese word, then type its pinyin letter by letter. No tones needed!
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {PINYIN_WORDS.map(w => (
              <div key={w.chinese} className="text-gray-500">
                {w.chinese} → {w.pinyin}
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={() => setStarted(true)}
          className="w-full py-4 rounded-full text-white font-bold text-lg transition-all hover:scale-[1.02] active:scale-95"
          style={{ background: accent }}
        >
          Start Practice
        </button>
      </Layout>
    );
  }

  return <PinyinPlay childId={childId} accent={accent} onFinish={r => {
    savePracticeRecord(childId, r);
    updateBestStreak(childId, r.correct);
    setRecord(r);
  }} />;
}

function PinyinPlay({ childId, accent, onFinish }: {
  childId: ChildId;
  accent: string;
  onFinish: (record: PracticeRecord) => void;
}) {
  const [wordList] = useState(() => shuffleArray(PINYIN_WORDS));
  const [wordIndex, setWordIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [allCorrect, setAllCorrect] = useState(0);
  const [allErrors, setAllErrors] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [startTime] = useState(Date.now());
  const [completed, setCompleted] = useState(false);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [done, setDone] = useState(false);

  const currentWord = wordList[wordIndex];
  const pinyin = currentWord?.pinyin ?? '';
  const targetChar = pinyin[charIndex] ?? '';
  const totalChars = wordList.reduce((sum, w) => sum + w.pinyin.length, 0);
  const progress = (wordList.slice(0, wordIndex).reduce((s, w) => s + w.pinyin.length, 0) + charIndex) / totalChars;

  useEffect(() => {
    if (done && !completed) {
      setCompleted(true);
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);
      const accuracy = totalChars > 0 ? Math.round((allCorrect / totalChars) * 100) : 0;
      onFinish({
        date: new Date().toISOString().split('T')[0],
        mode: 'pinyin',
        total: totalChars,
        correct: allCorrect,
        errors: allErrors,
        accuracy,
        durationSeconds,
        passed: accuracy >= 85,
      });
    }
  }, [done]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.repeat || completed || done) return;
    e.preventDefault();

    const key = e.key.toLowerCase();
    if (key === targetChar.toLowerCase()) {
      const newCharIdx = charIndex + 1;
      const newCorrect = allCorrect + 1;
      const newStreak = streak + 1;
      const newBest = Math.max(bestStreak, newStreak);
      setAllCorrect(newCorrect);
      setStreak(newStreak);
      setBestStreak(newBest);
      setFeedback('correct');
      setTimeout(() => setFeedback(null), 300);

      if (newCharIdx >= pinyin.length) {
        const nextWordIdx = wordIndex + 1;
        if (nextWordIdx >= wordList.length) {
          setDone(true);
        } else {
          setWordIndex(nextWordIdx);
          setCharIndex(0);
        }
      } else {
        setCharIndex(newCharIdx);
      }
    } else {
      setAllErrors(e => e + 1);
      setStreak(0);
      setFeedback('wrong');
      setTimeout(() => setFeedback(null), 500);
    }
  }, [targetChar, charIndex, pinyin, wordIndex, wordList, completed, done, allCorrect, streak, bestStreak]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <Layout>
      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mb-4 text-sm text-gray-600">
        <span>Correct: <strong className="text-green-500">{allCorrect}</strong></span>
        <span>Errors: <strong className="text-red-400">{allErrors}</strong></span>
        <span>Streak: <strong style={{ color: accent }}>{streak}</strong></span>
      </div>

      <ProgressBar progress={progress} />

      <div className="my-4 sm:my-6 text-center">
        <div className="text-4xl sm:text-5xl font-bold text-gray-800 mb-3 sm:mb-4">
          {currentWord?.chinese}
        </div>
        <div className="text-sm text-gray-400 mb-2">
          Type the pinyin: {wordIndex + 1} of {wordList.length}
        </div>
        <div className="flex justify-center gap-1">
          {pinyin.split('').map((ch, i) => (
            <span
              key={i}
              className="inline-block text-2xl sm:text-4xl font-bold"
              style={{
                color: i < charIndex ? '#34D399'
                  : i === charIndex ? (feedback === 'wrong' ? '#F87171' : '#374151')
                  : '#D1D5DB',
              }}
            >
              {ch}
            </span>
          ))}
        </div>
        {feedback === 'correct' && (
          <div className="mt-3 text-lg font-bold text-green-500">Great!</div>
        )}
        {feedback === 'wrong' && (
          <div className="mt-3 text-lg font-bold text-amber-500">Try again!</div>
        )}
      </div>

      <VirtualKeyboard
        targetKey={targetChar}
        wrongKey={feedback === 'wrong' ? 'x' : null}
      />
    </Layout>
  );
}
