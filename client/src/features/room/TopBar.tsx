import { useState } from 'react';
import {
  Check,
  Copy,
  Lock,
  Settings,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Users,
} from 'lucide-react';
import { useRoomStore } from '@/store/room';
import { useSettings } from '@/store/settings';
import type { PeerStats } from '@/features/call/useCallStats';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';

export function TopBar({
  stats,
  onOpenSettings,
}: {
  stats: Record<string, PeerStats>;
  onOpenSettings: () => void;
}) {
  const room = useRoomStore((s) => s.room);
  const showStats = useSettings((s) => s.showStats);
  const [copied, setCopied] = useState(false);
  if (!room) return null;

  const values = Object.values(stats);
  const worst = values.reduce<PeerStats | null>(
    (acc, s) => (!acc || s.rttMs > acc.rttMs ? s : acc),
    null,
  );
  const overall =
    values.length === 0
      ? null
      : values.some((s) => s.quality === 'poor')
        ? 'poor'
        : values.some((s) => s.quality === 'fair')
          ? 'fair'
          : 'good';

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${room.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <header className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-onaccent">
          <Logo size={18} title="Havnn" />
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy room link"
          className="group flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-surface-overlay"
        >
          <span className="truncate font-mono text-sm font-medium">{room.code}</span>
          {copied ? (
            <Check size={14} className="shrink-0 text-success" />
          ) : (
            <Copy size={14} className="shrink-0 text-ink-faint group-hover:text-ink" />
          )}
        </button>
        {room.locked && (
          <Lock size={14} className="shrink-0 text-warning" aria-label="Room locked" />
        )}
      </div>

      <div className="flex items-center gap-2">
        {showStats && overall && worst && (
          <span
            className={cn(
              'hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs sm:flex',
              overall === 'good' && 'text-success',
              overall === 'fair' && 'text-warning',
              overall === 'poor' && 'text-danger',
            )}
            title={`Worst link: ${worst.rttMs}ms RTT · ${worst.packetLossPct}% loss · ${worst.outboundKbps} kbps out`}
          >
            {overall === 'good' ? (
              <SignalHigh size={14} />
            ) : overall === 'fair' ? (
              <SignalMedium size={14} />
            ) : (
              <SignalLow size={14} />
            )}
            {worst.rttMs}ms · {worst.packetLossPct}% · {Math.round(worst.outboundKbps / 100) / 10}
            Mbps
          </span>
        )}
        <span className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-dim">
          <Users size={14} /> {room.participants.length}
        </span>
        <ThemeToggle />
        <button
          type="button"
          aria-label="Settings"
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface-raised text-ink-dim transition-colors hover:text-ink"
          onClick={onOpenSettings}
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}
