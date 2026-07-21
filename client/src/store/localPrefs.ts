import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Per-tab, session-scoped view preferences.
 * Strictly local: nothing here is broadcast to other participants.
 */
interface LocalPrefs {
  // Keep future local-only preferences here.
}

export const useLocalPrefs = create<LocalPrefs>()(
  persist(
    () => ({}),
    {
      name: 'syncroom:local-prefs',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);