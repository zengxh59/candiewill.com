import type { PracticeRecord } from '../types';
import { StatsCard } from '../components/StatsCard';

interface PracticeSummaryProps {
  record: PracticeRecord;
  accent: string;
  onRetry: () => void;
  onNext?: () => void;
  onHome: () => void;
}

const PASS_MESSAGES = [
  'Amazing work! You did it!',
  'You are a typing star!',
  'Wonderful job! Keep it up!',
  'Fantastic! You passed!',
  'Brilliant! You are getting so good!',
];

const FAIL_MESSAGES = [
  'Great effort! Try again to pass!',
  'You are doing great! Keep practicing!',
  'Almost there! You can do it!',
  'Nice try! Practice makes perfect!',
];

export function PracticeSummary({ record, accent, onRetry, onNext, onHome }: PracticeSummaryProps) {
  const message = record.passed
    ? PASS_MESSAGES[Math.floor(Math.random() * PASS_MESSAGES.length)]
    : FAIL_MESSAGES[Math.floor(Math.random() * FAIL_MESSAGES.length)];

  const stars = record.passed
    ? record.accuracy >= 95 ? 3 : record.accuracy >= 90 ? 2 : 1
    : 0;

  return (
    <div className="text-center py-6">
      {record.passed && (
        <div className="text-5xl mb-4">
          {'⭐'.repeat(stars)}
        </div>
      )}

      <h1 className="text-3xl font-bold mb-2" style={{ color: accent }}>
        {record.passed ? 'You Passed!' : 'Practice Complete'}
      </h1>

      <p className="text-lg text-gray-600 mb-8">{message}</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        <StatsCard label="Questions" value={record.total} />
        <StatsCard label="Correct" value={record.correct} color="#34D399" />
        <StatsCard label="Errors" value={record.errors} color="#F87171" />
        <StatsCard label="Accuracy" value={`${record.accuracy}%`} color={record.passed ? '#34D399' : '#F87171'} />
        <StatsCard label="Time" value={`${record.durationSeconds}s`} />
        <StatsCard
          label="Result"
          value={record.passed ? 'PASSED' : 'Keep Going'}
          color={record.passed ? '#34D399' : '#F59E0B'}
        />
      </div>

      <div className="flex flex-col gap-3 max-w-xs mx-auto">
        {onNext && (
          <button
            onClick={onNext}
            className="w-full py-3 rounded-full text-white font-bold text-lg transition-all hover:scale-[1.02] active:scale-95"
            style={{ background: accent }}
          >
            Next Level
          </button>
        )}
        <button
          onClick={onRetry}
          className="w-full py-3 rounded-full font-bold text-lg border-2 transition-all hover:scale-[1.02] active:scale-95"
          style={{ borderColor: accent, color: accent }}
        >
          Try Again
        </button>
        <button
          onClick={onHome}
          className="w-full py-3 rounded-full font-bold text-lg text-gray-500 hover:text-gray-700 transition"
        >
          Back to Home
        </button>
      </div>
    </div>
  );
}
