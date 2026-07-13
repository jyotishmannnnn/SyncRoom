import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Footer } from '@/components/Footer';
import { ThemeToggle } from '@/components/ThemeToggle';

export interface LegalLayoutProps {
  title: string;
  /** Human-readable "last updated" date shown under the title. */
  updated: string;
  children: ReactNode;
}

/** Shared frame for the legal pages: header, prose column, footer. */
export function LegalLayout({ title, updated, children }: LegalLayoutProps) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} | HAVNN`;
    return () => {
      document.title = prev;
    };
  }, [title]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Link
          to="/"
          className="flex items-center gap-2.5 rounded-lg transition-opacity hover:opacity-80"
          aria-label="Havnn home"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-onaccent">
            <Logo size={20} title="" />
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">Havnn</span>
        </Link>
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-16">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded text-sm text-ink-dim transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} /> Back to home
        </Link>
        <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-ink-faint">Last updated: {updated}</p>
        <div className="mt-8 flex flex-col gap-8">{children}</div>
      </main>

      <Footer />
    </div>
  );
}

/** A titled section of legal copy, consistent spacing and type. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-ink-dim">
        {children}
      </div>
    </section>
  );
}
