import { useEffect } from 'react';

export interface ShortcutMap {
  [key: string]: (() => void) | undefined;
}

export const SHORTCUT_HELP: Array<{ keys: string; action: string }> = [
  { keys: 'M', action: 'Toggle microphone' },
  { keys: 'V', action: 'Toggle camera' },
  { keys: 'S', action: 'Toggle screen share' },
  { keys: 'C', action: 'Toggle chat panel' },
  { keys: 'P', action: 'Toggle people panel' },
  { keys: 'W', action: 'Toggle watch-together panel' },
  { keys: 'F', action: 'Toggle fullscreen' },
  { keys: 'Space', action: 'Play / pause synced media' },
  { keys: '← / →', action: 'Seek synced media −5s / +5s' },
  { keys: 'Esc', action: 'Close panel or dialog' },
];

/**
 * Room-level shortcuts. Ignored while typing in inputs/textareas or when a
 * modifier is held (so browser shortcuts keep working).
 */
export function useKeyboardShortcuts(map: ShortcutMap): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
      const handler = map[key];
      if (handler) {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [map]);
}
