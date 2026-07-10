import { Moon, Sun } from 'lucide-react';
import { useSettings } from '@/store/settings';

export function ThemeToggle() {
  const theme = useSettings((s) => s.theme);
  const update = useSettings((s) => s.update);
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <button
      type="button"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface-raised text-ink-dim transition-colors hover:text-ink"
      onClick={() => update({ theme: isDark ? 'light' : 'dark' })}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
