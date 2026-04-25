import { useParams, useNavigate } from 'react-router-dom';
import { getChildStats } from '../services/storage';
import { Layout } from '../components/Layout';
import { StatsCard } from '../components/StatsCard';
import type { ChildId } from '../types';

export function Home() {
  const { childId } = useParams<{ childId: ChildId }>();
  const navigate = useNavigate();

  if (!childId) return null;

  const stats = getChildStats(childId);
  const accent = childId === 'candie' ? '#F472B6' : '#60A5FA';
  const name = childId === 'candie' ? 'Candie' : 'Will';

  const today = new Date().toISOString().split('T')[0];
  const todayMinutes = Math.round((stats.dailyMinutes[today] ?? 0) * 10) / 10;

  const nextLetterLevel = stats.letterLevels.findIndex(l => l === null || !l.passed);
  const letterRecommendation = nextLetterLevel === -1
    ? 'all passed! Try word practice'
    : `Level ${nextLetterLevel + 1}`;

  return (
    <Layout>
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold" style={{ color: accent }}>
          Hello, {name}!
        </h1>
        <p className="text-gray-500 mt-1">Ready to practice typing?</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        <StatsCard label="Today (min)" value={todayMinutes} color={accent} />
        <StatsCard label="Sessions" value={stats.totalSessions} color={accent} />
        <StatsCard label="Correct" value={stats.totalCorrect} color="#34D399" />
        <StatsCard label="Errors" value={stats.totalErrors} color="#F87171" />
        <StatsCard label="Best Streak" value={stats.bestStreak} color="#FACC15" />
        <StatsCard label="Letter Level" value={letterRecommendation} color={accent} />
      </div>

      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-700 mb-3">Choose Practice</h2>
        <div className="grid gap-3">
          <button
            onClick={() => navigate(`/${childId}/letter`)}
            className="w-full p-4 rounded-2xl bg-white shadow-sm hover:shadow-md transition-all text-left flex items-center gap-4"
          >
            <span className="text-3xl">ABC</span>
            <div>
              <div className="font-bold text-lg text-gray-800">Letter Practice</div>
              <div className="text-sm text-gray-500">Learn keys row by row — 4 levels</div>
            </div>
          </button>

          <button
            onClick={() => navigate(`/${childId}/word`)}
            className="w-full p-4 rounded-2xl bg-white shadow-sm hover:shadow-md transition-all text-left flex items-center gap-4"
          >
            <span className="text-3xl">CAT</span>
            <div>
              <div className="font-bold text-lg text-gray-800">Word Practice</div>
              <div className="text-sm text-gray-500">Type fun English words</div>
            </div>
          </button>

          <button
            onClick={() => navigate(`/${childId}/pinyin`)}
            className="w-full p-4 rounded-2xl bg-white shadow-sm hover:shadow-md transition-all text-left flex items-center gap-4"
          >
            <span className="text-3xl">你好</span>
            <div>
              <div className="font-bold text-lg text-gray-800">Pinyin Practice</div>
              <div className="text-sm text-gray-500">Type pinyin for Chinese words</div>
            </div>
          </button>

          <button
            onClick={() => navigate(`/${childId}/fingers`)}
            className="w-full p-4 rounded-2xl bg-white shadow-sm hover:shadow-md transition-all text-left flex items-center gap-4"
          >
            <span className="text-3xl">👋</span>
            <div>
              <div className="font-bold text-lg text-gray-800">Finger Guide</div>
              <div className="text-sm text-gray-500">Learn which finger types which key</div>
            </div>
          </button>
        </div>
      </div>
    </Layout>
  );
}
