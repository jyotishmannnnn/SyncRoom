import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Per-tab, session-scoped view preferences. Strictly local: nothing here is
 * ever broadcast to other participants or sent over the socket.
 */
interface LocalPrefs {
  /** Extra CSS-only flip of the local camera preview (on top of the mirror
      setting). Applied via `transform: scaleX(-1)`, never touches tracks. */
  flipPreview: boolean;
  toggleFlipPreview: () => void;
}

export const useLocalPrefs = create<LocalPrefs>()(
  persist(
    (set) => ({
      flipPreview: false,
      toggleFlipPreview: () => set((s) => ({ flipPreview: !s.flipPreview })),
    }),
    { name: 'syncroom:local-prefs', storage: createJSONStorage(() => sessionStorage) },
  ),
);
