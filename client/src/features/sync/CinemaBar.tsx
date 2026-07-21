import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Camera,
  CameraOff,
  FlipHorizontal2,
  Maximize,
  MessageSquare,
  Mic,
  MicOff,
  Minimize,
  Pause,
  PhoneOff,
  Play,
  Rewind,
  FastForward,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { expectedTime } from '@syncroom/shared';
import { socket, serverNow } from '@/lib/socket';
import { canSelfControl, useRoomStore } from '@/store/room';
import { useSettings } from '@/store/settings';
import {
  SEEK_STEP_S,
  seekBy,
  toggleCamera,
  toggleMic,
} from '@/features/room/mediaActions';
import { cn, formatDuration } from '@/lib/utils';
import { ReactionPicker } from '@/features/room/ReactionPicker';
import type { LocalPlayerFacade } from './useSyncEngine';

/** Range input with a filled track via the --fill custom property. */
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

  /*
   * A commit MUST follow every scrub, otherwise the caller's scrub state
   * sticks and the timeline freezes on it.
   */
  const dirty = useRef(false);

  const commit = (el: HTMLInputElement): void => {
    if (!dirty.current) return;

    dirty.current = false;
    onCommit(Number(el.value));
  };

  return (
    <input
      type="range"
      className={cn(
        'cinema-range',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      style={{ '--fill': `${pct}%` } as CSSProperties}
      aria-label={label}
      min={0}
      max={max || 1}
      step={0.05}
      value={Math.min(value, max || 1)}
      disabled={disabled}
      onChange={(e) => {
        dirty.current = true;
        onScrub?.(Number(e.target.value));
      }}
      onPointerUp={(e) => commit(e.target as HTMLInputElement)}
      onPointerCancel={(e) => commit(e.target as HTMLInputElement)}
      onKeyUp={(e) => commit(e.target as HTMLInputElement)}
      onBlur={(e) => commit(e.target)}
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
 *
 * Play/pause/seek are user actions routed through the normal sync pipeline
 * (one socket event each); volume and fullscreen are strictly local.
 *
 * The reaction picker is available in both normal and fullscreen modes.
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

  const micOn = useRoomStore((s) => s.micOn);
  const cameraOn = useRoomStore((s) => s.cameraOn);

  const mirrorVideo = useSettings((s) => s.mirrorVideo);
  const updateSettings = useSettings((s) => s.update);

  const [playhead, setPlayhead] = useState<{
    time: number;
    duration: number;
    seekable: boolean;
  } | null>(null);

  const [scrubTime, setScrubTime] = useState<number | null>(null);

  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  /*
   * Light polling only while the bar is visible.
   */
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
      socket.emit('sync:pause', {
        time: expectedTime(syncState, serverNow()),
        eventId,
      });
    } else {
      socket.emit('sync:play', {
        time: syncState.time,
        eventId,
      });
    }
  };

  const commitSeek = (t: number): void => {
    setScrubTime(null);

    if (!canControl) return;

    socket.emit('sync:seek', {
      time: t,
      eventId: crypto.randomUUID(),
    });
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
        /*
         * High z-index ensures the CinemaBar and reaction picker sit
         * above other video overlays.
         *
         * overflow-visible is required so the reaction menu can extend
         * upward outside the control bar.
         */
        'absolute inset-x-0 bottom-0 z-[100] overflow-visible px-3 pb-3 transition-all duration-300',
        visible
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-3 opacity-0',
      )}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <div
        className="
          relative
          mx-auto
          flex
          max-w-4xl
          flex-col
          gap-1.5
          overflow-visible
          rounded-2xl
          bg-black/70
          px-4
          py-2.5
          shadow-2xl
          backdrop-blur-md
        "
      >
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
          {/* Play / Pause */}
          <button
            type="button"
            aria-label={playing ? 'Pause for everyone' : 'Play for everyone'}
            title={
              canControl
                ? undefined
                : 'Only the host can control playback'
            }
            disabled={!canControl}
            onClick={togglePlay}
            className="
              cursor-pointer
              rounded-full
              p-2.5
              text-white
              transition-colors
              hover:bg-white/15
              disabled:opacity-40
            "
          >
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>

          {/* Rewind */}
          <button
            type="button"
            aria-label={`Rewind ${SEEK_STEP_S} seconds`}
            title={
              canControl
                ? `Rewind ${SEEK_STEP_S} seconds (←)`
                : 'Only the host can control playback'
            }
            disabled={
              !canControl || !(playhead?.seekable ?? false)
            }
            onClick={() => seekBy(-SEEK_STEP_S)}
            className="
              cursor-pointer
              rounded-full
              p-2.5
              text-white
              transition-colors
              hover:bg-white/15
              disabled:opacity-40
            "
          >
            <Rewind size={18} />
          </button>

          {/* Forward */}
          <button
            type="button"
            aria-label={`Forward ${SEEK_STEP_S} seconds`}
            title={
              canControl
                ? `Forward ${SEEK_STEP_S} seconds (→)`
                : 'Only the host can control playback'
            }
            disabled={
              !canControl || !(playhead?.seekable ?? false)
            }
            onClick={() => seekBy(SEEK_STEP_S)}
            className="
              cursor-pointer
              rounded-full
              p-2.5
              text-white
              transition-colors
              hover:bg-white/15
              disabled:opacity-40
            "
          >
            <FastForward size={18} />
          </button>

          {/* Mute / Unmute */}
          <button
            type="button"
            aria-label={
              muted || volume === 0
                ? 'Unmute'
                : 'Mute'
            }
            onClick={() => {
              const next = !(muted || volume === 0);

              setMuted(next);
              player.setMuted(next);
            }}
            className="
              cursor-pointer
              rounded-full
              p-2.5
              text-white
              transition-colors
              hover:bg-white/15
            "
          >
            {muted || volume === 0 ? (
              <VolumeX size={18} />
            ) : (
              <Volume2 size={18} />
            )}
          </button>

          {/* Volume */}
          <Range
            className="hidden h-1 w-20 sm:block"
            value={muted ? 0 : volume}
            max={1}
            label="Volume"
            onScrub={applyVolume}
            onCommit={applyVolume}
          />

          <span className="flex-1" />

          {/*
           * Reaction Picker
           *
           * This is intentionally OUTSIDE the fullscreen-only block.
           * Therefore reactions are available in both normal and fullscreen
           * modes.
           *
           * The updated ReactionPicker uses:
           * - bottom-14 in normal mode
           * - bottom-12 in fullscreen mode
           *
           * This prevents the emoji menu from overlapping the timeline
           * in normal viewing mode.
           */}
          <ReactionPicker fullscreen={isFullscreen} />

          {/* Fullscreen-only controls */}
          {isFullscreen && (
            <>
              {/* Global Camera Flip */}
              <button
                type="button"
                aria-label={
                  mirrorVideo
                    ? 'Unflip camera for everyone'
                    : 'Flip camera for everyone'
                }
                title={
                  mirrorVideo
                    ? 'Unflip camera for everyone'
                    : 'Flip camera for everyone'
                }
                onClick={() =>
                  updateSettings({
                    mirrorVideo: !mirrorVideo,
                  })
                }
                className={cn(
                  'cursor-pointer rounded-full p-2.5 text-white transition-colors hover:bg-white/15',
                  mirrorVideo && 'bg-white/20',
                )}
              >
                <FlipHorizontal2 size={18} />
              </button>

              {/* Microphone */}
              <button
                type="button"
                aria-label={
                  micOn
                    ? 'Mute microphone'
                    : 'Unmute microphone'
                }
                title={
                  micOn
                    ? 'Mute microphone (M)'
                    : 'Unmute microphone (M)'
                }
                onClick={toggleMic}
                className={cn(
                  'cursor-pointer rounded-full p-2.5 text-white transition-colors hover:bg-white/15',
                  !micOn && 'bg-danger/90 hover:bg-danger',
                )}
              >
                {micOn ? (
                  <Mic size={18} />
                ) : (
                  <MicOff size={18} />
                )}
              </button>

              {/* Camera */}
              <button
                type="button"
                aria-label={
                  cameraOn
                    ? 'Turn camera off'
                    : 'Turn camera on'
                }
                title={
                  cameraOn
                    ? 'Turn camera off (V)'
                    : 'Turn camera on (V)'
                }
                onClick={toggleCamera}
                className={cn(
                  'cursor-pointer rounded-full p-2.5 text-white transition-colors hover:bg-white/15',
                  !cameraOn && 'bg-danger/90 hover:bg-danger',
                )}
              >
                {cameraOn ? (
                  <Camera size={18} />
                ) : (
                  <CameraOff size={18} />
                )}
              </button>

              {/* Chat */}
              <span className="relative">
                <button
                  type="button"
                  aria-label="Chat overlay"
                  onClick={() =>
                    setPanel(
                      panel === 'chat'
                        ? null
                        : 'chat',
                    )
                  }
                  className={cn(
                    'cursor-pointer rounded-full p-2.5 text-white transition-colors hover:bg-white/15',
                    panel === 'chat' && 'bg-white/20',
                  )}
                >
                  <MessageSquare size={18} />
                </button>

                {unread > 0 && (
                  <span
                    className="
                      absolute
                      -right-0.5
                      -top-0.5
                      flex
                      h-4
                      min-w-4
                      items-center
                      justify-center
                      rounded-full
                      bg-danger
                      px-1
                      text-[9px]
                      font-bold
                      text-white
                    "
                  >
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </span>

              {/* Participants */}
              <button
                type="button"
                aria-label="Participants overlay"
                onClick={() =>
                  setPanel(
                    panel === 'people'
                      ? null
                      : 'people',
                  )
                }
                className={cn(
                  'cursor-pointer rounded-full p-2.5 text-white transition-colors hover:bg-white/15',
                  panel === 'people' && 'bg-white/20',
                )}
              >
                <Users size={18} />
              </button>

              {/* Leave Room */}
              <button
                type="button"
                aria-label="Leave room"
                onClick={onLeave}
                className="
                  cursor-pointer
                  rounded-full
                  bg-danger/90
                  p-2.5
                  text-white
                  transition-colors
                  hover:bg-danger
                "
              >
                <PhoneOff size={18} />
              </button>
            </>
          )}

          {/* Fullscreen Toggle */}
          <button
            type="button"
            aria-label={
              isFullscreen
                ? 'Exit fullscreen'
                : 'Fullscreen'
            }
            onClick={onToggleFullscreen}
            className="
              cursor-pointer
              rounded-full
              p-2.5
              text-white
              transition-colors
              hover:bg-white/15
            "
          >
            {isFullscreen ? (
              <Minimize size={18} />
            ) : (
              <Maximize size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}