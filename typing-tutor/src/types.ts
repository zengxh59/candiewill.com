export type ChildId = 'candie' | 'will';

export type PracticeMode = 'letter' | 'word' | 'pinyin';

export interface PracticeRecord {
  date: string;
  mode: PracticeMode;
  level?: number;
  total: number;
  correct: number;
  errors: number;
  accuracy: number;
  durationSeconds: number;
  passed: boolean;
}

export interface LetterLevelResult {
  passed: boolean;
  bestAccuracy: number;
}

export interface ChildStats {
  totalSessions: number;
  totalCorrect: number;
  totalErrors: number;
  bestStreak: number;
  lastPracticeAt: string | null;
  modeCount: { letter: number; word: number; pinyin: number };
  dailyMinutes: Record<string, number>;
  letterLevels: (null | LetterLevelResult)[];
}

export interface PracticeState {
  currentIndex: number;
  total: number;
  correct: number;
  errors: number;
  currentStreak: number;
  bestStreak: number;
  startTime: number;
  items: string[];
  targets: string[];
  mode: PracticeMode;
  level?: number;
  completed: boolean;
  feedback: 'correct' | 'wrong' | null;
  feedbackKey: string | null;
}
