import { useRef } from 'react';
import { AlertTriangle, Loader2, Play } from 'lucide-react';
import { useRoomStore } from '@/store/room';
import { useSyncEngine } from './useSyncEngine';
import { DebugOverlay } from './DebugOverlay';

/**
 * The shared viewing surface. All providers (YouTube, HTML5/HLS/DASH, Drive
 * direct or preview) render into the same container via their adapter; this
 * component only owns the chrome: loading state, the one-time Drive
 * degradation banner, and the autoplay click-to-play overlay.
 */
export function PlayerStage() {
  const media = useRoomStore((s) => s.syncState?.media ?? null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { driveFallback, playerReady, autoplayBlocked, resume } = useSyncEngine(containerRef);

  if (!media) return null;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl bg-black">
      {driveFallback && (
        <div className="glass z-10 flex items-center gap-2 px-4 py-2 text-xs text-warning">
          <AlertTriangle size={14} className="shrink-0" />
          This Google Drive file can’t be synced — Drive’s own player has no controls we can drive,
          so everyone presses play themselves. For synced playback, make sure it’s shared “Anyone
          with the link”, or use a direct MP4, YouTube or Vimeo link.
        </div>
      )}
      {!playerReady && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60">
          <Loader2 className="animate-spin text-ink-dim" size={32} />
        </div>
      )}
      {autoplayBlocked && (
        <button
          type="button"
          onClick={resume}
          className="absolute inset-0 z-20 flex cursor-pointer flex-col items-center justify-center gap-3 bg-black/70 text-white"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent shadow-xl transition-transform hover:scale-105">
            <Play size={26} className="ml-1" />
          </span>
          <span className="text-sm font-medium">Click to join playback</span>
          <span className="text-xs text-white/60">
            Your browser blocked autoplay — one click syncs you up.
          </span>
        </button>
      )}
      <DebugOverlay />
      <div ref={containerRef} className="min-h-0 w-full flex-1" />
    </div>
  );
}
