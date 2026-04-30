import { useNavigate } from 'react-router-dom';
import { setCurrentChild } from '../services/storage';
import type { ChildId } from '../types';

export function ChildSelect() {
  const navigate = useNavigate();

  function selectChild(id: ChildId) {
    setCurrentChild(id);
    navigate(`/${id}/home`);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: '#FFF8F0' }}>
      <h1 className="text-4xl font-bold mb-2 text-gray-800">Candie Will Typing</h1>
      <p className="text-lg text-gray-500 mb-10">Who is practicing today?</p>

      <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
        <button
          onClick={() => selectChild('candie')}
          className="flex flex-col items-center gap-4 p-6 sm:p-8 rounded-3xl bg-white shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95"
        >
          <div
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center text-3xl sm:text-4xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #F472B6, #EC4899)' }}
          >
            C
          </div>
          <span className="text-xl sm:text-2xl font-bold" style={{ color: '#F472B6' }}>Candie</span>
        </button>

        <button
          onClick={() => selectChild('will')}
          className="flex flex-col items-center gap-4 p-6 sm:p-8 rounded-3xl bg-white shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95"
        >
          <div
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center text-3xl sm:text-4xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #60A5FA, #3B82F6)' }}
          >
            W
          </div>
          <span className="text-xl sm:text-2xl font-bold" style={{ color: '#60A5FA' }}>Will</span>
        </button>
      </div>
    </div>
  );
}
