import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { HomePage } from '@/features/home/HomePage';

/* The room (WebRTC, players, panels) is by far the heaviest route, split it. */
const RoomPage = lazy(() =>
  import('@/features/room/RoomPage').then((m) => ({ default: m.RoomPage })),
);
/* Legal pages are rarely visited, keep them out of the initial bundle. */
const PrivacyPage = lazy(() =>
  import('@/features/legal/PrivacyPage').then((m) => ({ default: m.PrivacyPage })),
);
const TermsPage = lazy(() =>
  import('@/features/legal/TermsPage').then((m) => ({ default: m.TermsPage })),
);

function PageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Loader2 size={28} className="animate-spin text-ink-faint" />
    </div>
  );
}

export default function App() {
  useTheme();
  return (
    <BrowserRouter>
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/room/:code" element={<RoomPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
