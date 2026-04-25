import type { ChildId, ChildStats, PracticeRecord } from '../types';

const KEYS = {
  currentChild: 'cw_currentChild',
  stats: (id: ChildId) => `cw_stats_${id}`,
  history: (id: ChildId) => `cw_history_${id}`,
} as const;

function defaultStats(): ChildStats {
  return {
    totalSessions: 0,
    totalCorrect: 0,
    totalErrors: 0,
    bestStreak: 0,
    lastPracticeAt: null,
    modeCount: { letter: 0, word: 0, pinyin: 0 },
    dailyMinutes: {},
    letterLevels: [null, null, null, null],
  };
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function setCurrentChild(id: ChildId): void {
  localStorage.setItem(KEYS.currentChild, id);
}

export function getCurrentChild(): ChildId | null {
  return readJSON<ChildId | null>(KEYS.currentChild, null);
}

export function getChildStats(id: ChildId): ChildStats {
  return readJSON<ChildStats>(KEYS.stats(id), defaultStats());
}

export function getPracticeHistory(id: ChildId): PracticeRecord[] {
  return readJSON<PracticeRecord[]>(KEYS.history(id), []);
}

export function savePracticeRecord(id: ChildId, record: PracticeRecord): void {
  const stats = getChildStats(id);
  const history = getPracticeHistory(id);

  history.push(record);

  stats.totalSessions += 1;
  stats.totalCorrect += record.correct;
  stats.totalErrors += record.errors;
  stats.lastPracticeAt = new Date().toISOString();
  stats.modeCount[record.mode] += 1;

  if (record.level !== undefined) {
    const existing = stats.letterLevels[record.level];
    if (!existing || record.accuracy > existing.bestAccuracy) {
      stats.letterLevels[record.level] = {
        passed: record.passed,
        bestAccuracy: record.accuracy,
      };
    } else if (record.passed && !existing.passed) {
      existing.passed = true;
    }
  }

  const today = record.date;
  const prevMinutes = stats.dailyMinutes[today] ?? 0;
  stats.dailyMinutes[today] = prevMinutes + record.durationSeconds / 60;

  localStorage.setItem(KEYS.stats(id), JSON.stringify(stats));
  localStorage.setItem(KEYS.history(id), JSON.stringify(history));
}

export function updateBestStreak(id: ChildId, streak: number): void {
  const stats = getChildStats(id);
  if (streak > stats.bestStreak) {
    stats.bestStreak = streak;
    localStorage.setItem(KEYS.stats(id), JSON.stringify(stats));
  }
}
