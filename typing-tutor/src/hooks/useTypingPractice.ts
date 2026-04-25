import { useState, useCallback, useEffect, useRef } from 'react';
import type { PracticeMode, PracticeRecord, PracticeState } from '../types';

interface UseTypingPracticeOptions {
  mode: PracticeMode;
  level?: number;
  items: string[];
  targets: string[];
  onWrong?: (correctKey: string) => void;
}

const ENCOURAGEMENTS_CORRECT = [
  'Great job!',
  'Awesome!',
  'You got it!',
  'Wonderful!',
  'Keep going!',
  'Nice one!',
  'Well done!',
  'Fantastic!',
];

const ENCOURAGEMENTS_WRONG = [
  'Try again!',
  'Almost!',
  'You can do it!',
  "Don't give up!",
  'Keep trying!',
];

function getRandomEncouragement(pool: string[]) {
  return pool[Math.floor(Math.random() * pool.length)];
}

export function useTypingPractice({ mode, level, items, targets, onWrong }: UseTypingPracticeOptions) {
  const [state, setState] = useState<PracticeState>({
    currentIndex: 0,
    total: items.length,
    correct: 0,
    errors: 0,
    currentStreak: 0,
    bestStreak: 0,
    startTime: Date.now(),
    items,
    targets,
    mode,
    level,
    completed: false,
    feedback: null,
    feedbackKey: null,
  });

  const [encouragement, setEncouragement] = useState('');
  const feedbackTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingForRetry = useRef(false);

  useEffect(() => {
    return () => {
      if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
    };
  }, []);

  const handleKey = useCallback((key: string) => {
    if (state.completed) return;

    const target = state.targets[state.currentIndex];
    const lowerKey = key.toLowerCase();

    if (waitingForRetry.current) {
      if (lowerKey === target.toLowerCase()) {
        waitingForRetry.current = false;
        setState(s => {
          const newStreak = s.currentStreak + 1;
          const newBest = Math.max(s.bestStreak, newStreak);
          const nextIndex = s.currentIndex + 1;
          const done = nextIndex >= s.total;
          return {
            ...s,
            currentIndex: nextIndex,
            correct: s.correct + 1,
            currentStreak: newStreak,
            bestStreak: newBest,
            feedback: 'correct',
            feedbackKey: lowerKey,
            completed: done,
          };
        });
        setEncouragement(getRandomEncouragement(ENCOURAGEMENTS_CORRECT));
        if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
        feedbackTimeout.current = setTimeout(() => {
          setState(s => ({ ...s, feedback: null, feedbackKey: null }));
        }, 400);
      }
      return;
    }

    if (lowerKey === target.toLowerCase()) {
      setState(s => {
        const newStreak = s.currentStreak + 1;
        const newBest = Math.max(s.bestStreak, newStreak);
        const nextIndex = s.currentIndex + 1;
        const done = nextIndex >= s.total;
        return {
          ...s,
          currentIndex: nextIndex,
          correct: s.correct + 1,
          currentStreak: newStreak,
          bestStreak: newBest,
          feedback: 'correct',
          feedbackKey: lowerKey,
          completed: done,
        };
      });
      setEncouragement(getRandomEncouragement(ENCOURAGEMENTS_CORRECT));
      if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
      feedbackTimeout.current = setTimeout(() => {
        setState(s => ({ ...s, feedback: null, feedbackKey: null }));
      }, 400);
    } else {
      waitingForRetry.current = true;
      setState(s => ({
        ...s,
        errors: s.errors + 1,
        currentStreak: 0,
        feedback: 'wrong',
        feedbackKey: lowerKey,
      }));
      setEncouragement(getRandomEncouragement(ENCOURAGEMENTS_WRONG));
      onWrong?.(target);
      if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
      feedbackTimeout.current = setTimeout(() => {
        setState(s => ({ ...s, feedback: null }));
      }, 800);
    }
  }, [state, onWrong]);

  const getRecord = useCallback((): PracticeRecord => {
    const durationSeconds = Math.round((Date.now() - state.startTime) / 1000);
    const accuracy = state.total > 0 ? Math.round((state.correct / state.total) * 100) : 0;
    const passed = accuracy >= 85;
    return {
      date: new Date().toISOString().split('T')[0],
      mode,
      level,
      total: state.total,
      correct: state.correct,
      errors: state.errors,
      accuracy,
      durationSeconds,
      passed,
    };
  }, [state, mode, level]);

  const elapsed = Math.round((Date.now() - state.startTime) / 1000);

  const currentTarget = !state.completed && state.currentIndex < state.targets.length
    ? state.targets[state.currentIndex]
    : null;

  const currentItem = !state.completed && state.currentIndex < state.items.length
    ? state.items[state.currentIndex]
    : null;

  const progress = state.total > 0 ? state.currentIndex / state.total : 0;

  return {
    ...state,
    elapsed,
    currentTarget,
    currentItem,
    progress,
    encouragement,
    handleKey,
    getRecord,
  };
}
