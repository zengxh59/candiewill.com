import { Routes, Route, Navigate } from 'react-router-dom';
import { getCurrentChild } from './services/storage';
import { ChildSelect } from './pages/ChildSelect';
import { Home } from './pages/Home';
import { LetterPractice } from './pages/LetterPractice';
import { WordPractice } from './pages/WordPractice';
import { PinyinPractice } from './pages/PinyinPractice';
import { FingerGuide } from './pages/FingerGuide';

export default function App() {
  const saved = getCurrentChild();

  return (
    <Routes>
      <Route path="/" element={saved ? <Navigate to={`/${saved}/home`} /> : <ChildSelect />} />
      <Route path="/:childId/home" element={<Home />} />
      <Route path="/:childId/letter" element={<LetterPractice />} />
      <Route path="/:childId/word" element={<WordPractice />} />
      <Route path="/:childId/pinyin" element={<PinyinPractice />} />
      <Route path="/:childId/fingers" element={<FingerGuide />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
