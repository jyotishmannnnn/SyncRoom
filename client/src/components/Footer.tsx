import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';

const FOOTER_LINKS = [
  { label: 'Privacy Policy', to: '/privacy' },
  { label: 'Terms of Service', to: '/terms' },
] as const;

export const CONTACT_EMAILS = [
  'jyotishman@havnn.in',
  'aditi@havnn.in',
] as const;

/**
 * Site footer for the marketing/legal pages (the in-room UI keeps its own
 * control bar). Semantic landmark, keyboard-navigable links with visible
 * focus states (global focus-visible outline) and hover states.
 */
export function Footer() {
  return (
    <footer className="relative z-10 border-t border-line/70">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-sm">
          <span className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-onaccent">
              <Logo size={15} title="" />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">
              Havnn
            </span>
          </span>
          <p className="mt-3 text-sm leading-relaxed text-ink-dim">
            Watch YouTube and Google Drive videos together in perfect sync.
          </p>
        </div>

        <nav aria-label="Footer">
          <ul className="flex flex-col gap-3 sm:items-end">
            {FOOTER_LINKS.map((link) => (
              <li key={link.to}>
                <Link
                  to={link.to}
                  className="rounded text-sm text-ink-dim transition-colors hover:text-ink hover:underline"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="border-t border-line/50">
        <p className="mx-auto max-w-6xl px-6 py-4 text-xs text-ink-faint">
          © 2026 HAVNN. All rights reserved.
        </p>
      </div>
    </footer>
  );
}