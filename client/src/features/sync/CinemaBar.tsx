import { useEffect, useState, type CSSProperties } from 'react';
import {
  Maximize,
  MessageSquare,
  Minimize,
  Pause,
  PhoneOff,
  Play,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { expectedTime } from '@syncroom/shared';
import { socket, serverNow } from '@/lib/socket';
import { canSelfControl, useRoomStore } from '@/store/room';
import { cn, formatDuration } from '@/lib/utils';
import type { LocalPlayerFacade } from './useSyncEngine';

/** Range input with a filled track (via the --fill custom property). */
function Range({
  value,
  max,
  onCommit,
  onScrub,
  label,
  disabled,
  className,
}: {
  value: number;
  max: number;
  onCommit: (v: number) => void;
  onScrub?: (v: number) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <input
      type="range"
      className={cn('cinema-range', disabled && 'pointer-events-none opacity-50', className)}
      style={{ '--fill': `${pct}%` } as CSSProperties}
      aria-label={label}
      min={0}
      max={max || 1}
      step={0.05}
      value={Math.min(value, max || 1)}
      disabled={disabled}
      onChange={(e) => onScrub?.(Number(e.target.value))}
      onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => {
        if (e.key.startsWith('Arrow')) onCommit(Number((e.target as HTMLInputElement).value));
      }}
    />
  );
}

export interface CinemaBarProps {
  player: LocalPlayerFacade;
  visible: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onLeave: () => void;
  /** Pauses the auto-hide timer while the pointer rests on the bar. */
  onHoverChange: (hovering: boolean) => void;
}

/**
 * YouTube-style floating control bar over the shared player.
 * Play/pause/seek are user actions routed through the normal sync pipeline
 * (one socket event each); volume and fullscreen are strictly local.
 */
export function CinemaBar({
  player,
  visible,
  isFullscreen,
  onToggleFullscreen,
  onLeave,
  onHoverChange,
}: CinemaBarProps) {
  const syncState = useRoomStore((s) => s.syncState);
  const canControl = useRoomStore((s) => canSelfControl(s));
  const panel = useRoomStore((s) => s.panel);
  const setPanel = useRoomStore((s) => s.setPanel);
  const unread = useRoomStore((s) => s.unreadChat);

  const [playhead, setPlayhead] = useState<{
    time: number;
    duration: number;
    seekable: boolean;
  } | null>(null);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  /* Light polling only while the bar is visible. */
  useEffect(() => {
    if (!visible) return;
    const read = (): void => {
      setPlayhead(player.getPlayhead());
      setVolume(player.getVolume());
      setMuted(player.isMuted());
    };
    read();
    const t = setInterval(read, 500);
    return () => clearInterval(t);
  }, [visible, player]);

  const playing = syncState?.playing ?? false;

  const togglePlay = (): void => {
    if (!syncState?.media || !canControl) return;
    const eventId = crypto.randomUUID();
    if (playing) {
      socket.emit('sync:pause', { time: expectedTime(syncState, serverNow()), eventId });
    } else {
      socket.emit('sync:play', { time: syncState.time, eventId });
    }
  };

  const commitSeek = (t: number): void => {
    setScrubTime(null);
    if (!canControl) return;
    socket.emit('sync:seek', { time: t, eventId: crypto.randomUUID() });
  };

  const applyVolume = (v: number): void => {
    setVolume(v);
    player.setVolume(v);
    if (v > 0 && muted) {
      setMuted(false);
      player.setMuted(false);
    }
  };

  const time = scrubTime ?? playhead?.time ?? 0;
  const duration = playhead?.duration ?? 0;

  return (
    <div
      className={cn(
        'absolute inset-x-0 bottom-0 z-20 px-3 pb-3 transition-all duration-300',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
      )}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-1.5 rounded-2xl bg-black/70 px-4 py-2.5 shadow-2xl backdrop-blur-md">
        {/* Timeline */}
        <div className="flex items-center gap-3">
          <span className="w-12 text-right font-mono text-[11px] text-white/80">
            {formatDuration(time)}
          </span>
          <Range
            className="h-1 flex-1"
            value={time}
            max={duration}
            label="Seek"
            disabled={!canControl || !(playhead?.seekable ?? false)}
            onScrub={setScrubTime}
            onCommit={commitSeek}
          />
          <span className="w-12 font-mono text-[11px] text-white/60">
            {formatDuration(duration)}
          </span>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={playing ? 'Pause for everyone' : 'Play for everyone'}
            title={canControl ? undefined : 'Only the host can control playback'}
            disabled={!canControl}
            onClick={togglePlay}
            className="cursor-pointer rounded-full p-2.5 text-white transition-colors hover:bg-white/15 disabled:opacity-40"
          >
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>

          <button
            type="button"
            aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
            onClick={() => {
              const next = !(muted || volume === 0);
              setMuted(next);
              player.setMuted(next);
            }}
            className="cursor-pointer rounded-full p-2.5 text-white transition-colors hover:bg-white/15"
          >
            {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <Range
            className="hidden h-1 w-20 sm:block"
            value={muted ? 0 : volume}
            max={1}
            label="Volume"
            onScrub={applyVolume}
            onCommit={applyVolume}
          />

          <span className="flex-1" />

          {isFullscreen && (
            <>
              <span className="relative">
                <button
                  type="button"
                  aria-label="Chat overlay"
                  onClick={() => setPanel(panel === 'chat' ? null : 'chat')}
                  className={cn(
                    'cursor-pointer rounded-full p-2.5 text-white transition-colors hover:bg-white/15',
                    panel === 'chat' && 'bg-white/20',
                  )}
                >
                  <MessageSquare size={18} />
                </button>
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </span>
              <button
                type="button"
                aria-label="Participants overlay"
                onClick={() => setPanel(panel === 'people' ? null : 'people')}
                className={cn(
                  'cursor-pointer rounded-full p-2.5 text-white transition-colors hover:bg-white/15',
                  panel === 'people' && 'bg-white/20',
                )}
              >
                <Users size={18} />
              </button>
              <button
                type="button"
                aria-label="Leave room"
                onClick={onLeave}
                className="cursor-pointer rounded-full bg-danger/90 p-2.5 text-white transition-colors hover:bg-danger"
              >
                <PhoneOff size={18} />
              </button>
            </>
          )}

          <button
            type="button"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={onToggleFullscreen}
            className="cursor-pointer rounded-full p-2.5 text-white transition-colors hover:bg-white/15"
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
