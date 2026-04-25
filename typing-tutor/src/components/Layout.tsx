import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ChildId } from '../types';

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { childId } = useParams<{ childId: ChildId }>();

  return (
    <div className="min-h-screen" style={{ background: '#FFF8F0' }}>
      {childId && (
        <header className="flex items-center justify-between px-6 py-3 bg-white/80 backdrop-blur-sm shadow-sm">
          <button
            onClick={() => navigate(`/${childId}/home`)}
            className="text-lg font-bold"
            style={{ color: childId === 'candie' ? '#F472B6' : '#60A5FA' }}
          >
            {childId === 'candie' ? 'Candie' : 'Will'} Typing
          </button>
          <nav className="flex gap-3">
            <button
              onClick={() => navigate(`/${childId}/home`)}
              className="px-3 py-1 rounded-full text-sm font-medium hover:bg-gray-100 transition"
            >
              Home
            </button>
            <button
              onClick={() => navigate(`/${childId}/fingers`)}
              className="px-3 py-1 rounded-full text-sm font-medium hover:bg-gray-100 transition"
            >
              Fingers
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-3 py-1 rounded-full text-sm font-medium hover:bg-gray-100 transition"
            >
              Switch
            </button>
          </nav>
        </header>
      )}
      <main className="max-w-3xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
