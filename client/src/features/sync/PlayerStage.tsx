import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { AlertTriangle, FastForward, Loader2, Play, Rewind } from 'lucide-react';
import { useRoomStore } from '@/store/room';
import { SEEK_STEP_S, seekBy } from '@/features/room/mediaActions';
import { cn } from '@/lib/utils';
import { ChatPanel } from '@/features/chat/ChatPanel';
import { ParticipantsPanel } from '@/features/room/ParticipantsPanel';
import { useSyncEngine } from './useSyncEngine';
import { CinemaBar } from './CinemaBar';
import { DebugOverlay } from './DebugOverlay';

const INACTIVITY_HIDE_MS = 3000;

export interface PlayerStageProps {
  /** Fullscreen target, owned by RoomPage so shortcuts/buttons can toggle it. */
  fsRef: RefObject<HTMLDivElement>;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onLeave: () => void;
  /** Floating webcam cluster, rendered only in fullscreen. */
  thumbs?: ReactNode;
}

/**
 * The shared viewing surface + cinema chrome.
 *
 * - All providers render into the same inner container via their adapter.
 * - A floating control bar (play/pause/timeline/volume/fullscreen…) fades
 *   after 3s of inactivity and returns on pointer movement; the cursor hides
 *   with it. Double-click toggles fullscreen.
 * - In fullscreen, chat/participants stay reachable as overlays and webcam
 *   thumbnails float (draggable), the meeting never stops.
 * - Fullscreen is strictly local: nothing here emits sync events, and the
 *   wrapper survives provider switches, so fullscreen persists across them.
 */
export function PlayerStage({
  fsRef,
  isFullscreen,
  onToggleFullscreen,
  onLeave,
  thumbs,
}: PlayerStageProps) {
  const media = useRoomStore((s) => s.syncState?.media ?? null);
  const playing = useRoomStore((s) => s.syncState?.playing ?? false);
  const panel = useRoomStore((s) => s.panel);
  const setPanel = useRoomStore((s) => s.setPanel);

  const containerRef = useRef<HTMLDivElement>(null);
  const { driveFallback, playerReady, autoplayBlocked, resume, player } =
    useSyncEngine(containerRef);

  /* ---------------- inactivity: fade controls, hide cursor ---------------- */
  const [active, setActive] = useState(true);
  const [barHover, setBarHover] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poke = useCallback((): void => {
    setActive(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setActive(false), INACTIVITY_HIDE_MS);
  }, []);

  useEffect(() => {
    poke();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [poke]);

  /* Fullscreen transitions relayout the bar away from the pointer without a
     mouseleave, which would latch barHover=true and keep the controls stuck
     visible forever (or, with a dead idle timer, stuck hidden). Reset the
     hover latch and restart the idle timer on every transition so fading
     keeps working after any number of fullscreen toggles. */
  useEffect(() => {
    setBarHover(false);
    poke();
  }, [isFullscreen, poke]);

  const barVisible = active || barHover || !playing;
  const hideCursor = isFullscreen && !barVisible && panel === null;

  /* ---------- touch: YouTube-style double-tap seek on the side zones ---------- */
  const lastTap = useRef<{ at: number; zone: 'left' | 'mid' | 'right' } | null>(null);
  const lastPointerType = useRef('mouse');
  const [tapSeek, setTapSeek] = useState<'back' | 'fwd' | null>(null);
  const tapSeekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (tapSeekTimer.current) clearTimeout(tapSeekTimer.current);
    },
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    poke(); // single tap / click always reveals the controls
    lastPointerType.current = e.pointerType;
    if (e.pointerType !== 'touch') return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, a, [role="dialog"], aside')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const zone = x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'mid';
    const now = performance.now();
    const prev = lastTap.current;
    lastTap.current = { at: now, zone };
    if (!prev || now - prev.at > 350 || prev.zone !== zone || zone === 'mid') return;
    lastTap.current = null; // consume: a third tap starts a new gesture
    // Same permission-checked sync:seek pipeline as the timeline slider.
    if (seekBy(zone === 'left' ? -SEEK_STEP_S : SEEK_STEP_S)) {
      setTapSeek(zone === 'left' ? 'back' : 'fwd');
      if (tapSeekTimer.current) clearTimeout(tapSeekTimer.current);
      tapSeekTimer.current = setTimeout(() => setTapSeek(null), 700);
    }
  };

  /* The cinema bar owns the surface for HTML5 media: native controls stay
     off so double-click can't trigger the browser's video-element fullscreen
     (which would bypass the cinema layout). YouTube keeps its own chrome,
     the IFrame API can't toggle it without reloading. */
  useEffect(() => {
    if (playerReady) player.setNativeControls(false);
  }, [playerReady, player]);

  const onDoubleClick = (e: ReactMouseEvent): void => {
    /* Touch double-taps are the seek gesture above, never fullscreen. */
    if (lastPointerType.current === 'touch') return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, a, [role="dialog"], aside')) return;
    onToggleFullscreen();
  };

  if (!media) return null;

  const panelTitle = panel === 'chat' ? 'Chat' : 'People';

  return (
    <div
      ref={fsRef}
      className={cn(
        'relative flex h-full w-full flex-col overflow-hidden bg-black',
        isFullscreen ? 'rounded-none' : 'rounded-2xl',
        hideCursor && 'cursor-idle',
      )}
      onPointerMove={poke}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {driveFallback && (
        <div className="glass z-10 flex items-center gap-2 px-4 py-2 text-xs text-warning">
          <AlertTriangle size={14} className="shrink-0" />
          {driveFallback === 'unsupported'
            ? 'This video’s format can’t be played in a browser (likely MKV or H.265/HEVC), so it can’t be synced. Re-save it as an MP4 (H.264), or use a YouTube/Vimeo/direct-MP4 link. Playing in Drive’s own player for now.'
            : driveFallback === 'network'
              ? 'Couldn’t load this Drive file for synced playback. Make sure it’s shared “Anyone with the link” and not in Trash. Playing in Drive’s own player for now.'
              : driveFallback === 'timeout'
                ? 'This Drive file is taking too long to start (it may be very large). Playing in Drive’s own player, reload to retry synced playback.'
                : 'This Google Drive file can’t be synced, Drive’s own player has no controls we can drive, so everyone presses play themselves. For synced playback, use a direct MP4, YouTube or Vimeo link.'}
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
          className="absolute inset-0 z-30 flex cursor-pointer flex-col items-center justify-center gap-3 bg-black/70 text-white"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-onaccent shadow-xl transition-transform hover:scale-105">
            <Play size={26} className="ml-1" />
          </span>
          <span className="text-sm font-medium">Click to join playback</span>
          <span className="text-xs text-white/60">
            Your browser blocked autoplay, one click syncs you up.
          </span>
        </button>
      )}

      <DebugOverlay />
      <div ref={containerRef} className="min-h-0 w-full flex-1" />

      {/* Double-tap seek feedback (visual only, seek already sent). */}
      {tapSeek && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 z-20 flex w-1/3 items-center justify-center',
            tapSeek === 'back' ? 'left-0' : 'right-0',
          )}
        >
          <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-4 py-2 text-sm font-semibold text-white backdrop-blur animate-scale-in">
            {tapSeek === 'back' ? <Rewind size={16} /> : <FastForward size={16} />}
            {tapSeek === 'back' ? `−${SEEK_STEP_S}s` : `+${SEEK_STEP_S}s`}
          </span>
        </div>
      )}

      {/* Cinema chrome, strictly local, never emits fullscreen state. */}
      {!driveFallback && (
        <CinemaBar
          player={player}
          visible={barVisible}
          isFullscreen={isFullscreen}
          onToggleFullscreen={onToggleFullscreen}
          onLeave={onLeave}
          onHoverChange={setBarHover}
        />
      )}

      {isFullscreen && thumbs}

      {/* Chat / participants without leaving fullscreen. */}
      {isFullscreen && (panel === 'chat' || panel === 'people') && (
        <aside
          aria-label={panelTitle}
          className="glass absolute bottom-24 right-4 top-4 z-20 flex w-80 max-w-[85vw] flex-col overflow-hidden rounded-2xl shadow-2xl animate-slide-in-right"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">{panelTitle}</h2>
            <button
              type="button"
              aria-label="Close panel"
              className="cursor-pointer rounded-lg px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-surface-overlay hover:text-ink"
              onClick={() => setPanel(null)}
            >
              Esc
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {panel === 'chat' ? <ChatPanel /> : <ParticipantsPanel />}
          </div>
        </aside>
      )}
    </div>
  );
}
