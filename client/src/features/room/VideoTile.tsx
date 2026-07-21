import { useEffect, useRef, useState } from 'react';
import { Crown, MicOff, PictureInPicture2 } from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { useSettings } from '@/store/settings';
import type { PeerStats } from '@/features/call/useCallStats';
import { useRoomStore } from '@/store/room';

export interface VideoTileProps {
  stream: MediaStream | null;
  name: string;
  isSelf?: boolean;
  isHost?: boolean;
  micOn?: boolean;
  cameraOn?: boolean;
  isScreen?: boolean;

  /**
   * Whether this participant's camera should be mirrored.
   *
   * IMPORTANT:
   * This should represent the participant's own mirror preference.
   * It must not be changed when entering or leaving fullscreen.
   */
  mirrored?: boolean;

  stats?: PeerStats;
  className?: string;
  participantId?: string;
}

const qualityColor = {
  good: 'bg-success',
  fair: 'bg-warning',
  poor: 'bg-danger',
} as const;

export function VideoTile({
  stream,
  name,
  isSelf = false,
  isHost = false,
  micOn = true,
  cameraOn = true,
  isScreen = false,
  mirrored = false,
  stats,
  className,
  participantId,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const speakerId = useSettings((s) => s.speakerId);
  const showStats = useSettings((s) => s.showStats);

  const allReactions = useRoomStore((state) => state.reactions);

  const reactions = participantId
    ? allReactions.filter(
        (reaction) => reaction.participantId === participantId,
      )
    : [];

  const [pipActive, setPipActive] = useState(false);

  /*
   * IMPORTANT MIRRORING RULE
   *
   * We only mirror a camera video.
   *
   * Screen shares are NEVER mirrored.
   *
   * The mirror value itself does not depend on fullscreen.
   */
  const shouldMirror =
    Boolean(mirrored) &&
    !isScreen;

  /*
   * Attach MediaStream to the video element.
   *
   * Fullscreen transitions must not replace the stream
   * or change the mirror state.
   */
  useEffect(() => {
    const el = videoRef.current;

    if (!el) return;

    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }

    if (!stream) return;

    const resume = (): void => {
      if (
        el.isConnected &&
        el.srcObject === stream &&
        el.paused
      ) {
        void el.play().catch(() => {});
      }
    };

    resume();

    el.addEventListener('pause', resume);

    return () => {
      el.removeEventListener('pause', resume);
    };
  }, [stream]);

  /*
   * Re-assert playback after fullscreen changes.
   *
   * This is ONLY for playback.
   *
   * It does NOT modify mirroring.
   */
  useEffect(() => {
    const el = videoRef.current;

    if (!el || !stream) return;

    const resume = (): void => {
      if (
        el.isConnected &&
        el.srcObject === stream &&
        el.paused
      ) {
        void el.play().catch(() => {});
      }
    };

    document.addEventListener(
      'fullscreenchange',
      resume,
    );

    document.addEventListener(
      'webkitfullscreenchange',
      resume,
    );

    return () => {
      document.removeEventListener(
        'fullscreenchange',
        resume,
      );

      document.removeEventListener(
        'webkitfullscreenchange',
        resume,
      );
    };
  }, [stream]);

  /*
   * Set remote audio output device.
   */
  useEffect(() => {
    const el = videoRef.current;

    if (
      el &&
      !isSelf &&
      speakerId &&
      'setSinkId' in el
    ) {
      el.setSinkId(speakerId).catch(() => {
        /*
         * Output device may no longer exist.
         * Browser falls back to default device.
         */
      });
    }
  }, [speakerId, isSelf]);

  const showVideo =
    stream !== null &&
    (cameraOn || isScreen);

  /*
   * Picture-in-Picture state.
   */
  useEffect(() => {
    const el = videoRef.current;

    if (!el) return;

    const resume = (): void => {
      if (el.paused) {
        void el.play().catch(() => {});
      }
    };

    const onEnter = (): void => {
      setPipActive(true);
      resume();
    };

    const onLeave = (): void => {
      setPipActive(false);
      resume();
    };

    el.addEventListener(
      'enterpictureinpicture',
      onEnter,
    );

    el.addEventListener(
      'leavepictureinpicture',
      onLeave,
    );

    return () => {
      el.removeEventListener(
        'enterpictureinpicture',
        onEnter,
      );

      el.removeEventListener(
        'leavepictureinpicture',
        onLeave,
      );
    };
  }, []);

  /*
   * Enter / exit Picture-in-Picture.
   */
  const pip = async (): Promise<void> => {
    const el = videoRef.current;

    if (!el) return;

    try {
      if (
        document.pictureInPictureElement === el
      ) {
        await document.exitPictureInPicture();
        return;
      }

      if (el.paused) {
        await el.play().catch(() => {});
      }

      await el.requestPictureInPicture();

      if (el.paused) {
        void el.play().catch(() => {});
      }
    } catch {
      /*
       * PiP unsupported or blocked.
       * Non-fatal.
       */
    }
  };

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl bg-surface-overlay',
        'shadow-lg ring-1 ring-line/60 animate-scale-in',
        className,
      )}
    >
      {/* ================================================================
          REACTIONS
          ================================================================ */}

      {reactions.length > 0 && (
        <div
          className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
          aria-hidden="true"
        >
          {reactions.map((reaction) => (
            <span
              key={reaction.id}
              className="
                absolute
                bottom-10
                left-1/2
                -translate-x-1/2
                text-5xl
                drop-shadow-lg
                animate-reaction-float
              "
            >
              {reaction.emoji}
            </span>
          ))}
        </div>
      )}

      {/* ================================================================
          VIDEO
          ================================================================ */}

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        className={cn(
          'h-full w-full',

          /*
           * Camera videos fill the tile.
           * Screen shares preserve their aspect ratio.
           */
          isScreen
            ? 'object-contain bg-black'
            : 'object-cover',

          /*
           * IMPORTANT:
           *
           * Mirroring is applied ONLY according to the participant's
           * mirror preference.
           *
           * Fullscreen does not affect this.
           *
           * Screen shares are never mirrored.
           */
          shouldMirror && 'mirror',

          /*
           * Keep the video element mounted when camera is off.
           */
          !showVideo && 'invisible',
        )}
      />

      {/* ================================================================
          CAMERA OFF / PIP COVER
          ================================================================ */}

      {(!showVideo || pipActive) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-overlay">
          <div
            className="
              flex
              h-16
              w-16
              items-center
              justify-center
              rounded-full
              bg-accent/20
              text-xl
              font-semibold
              text-accent
            "
          >
            {initials(name) || '?'}
          </div>

          {pipActive && showVideo && (
            <span className="text-xs text-ink-faint">
              In picture-in-picture
            </span>
          )}
        </div>
      )}

      {/* ================================================================
          TILE INFORMATION / CONTROLS
          ================================================================ */}

      <div
        className="
          absolute
          inset-x-0
          bottom-0
          flex
          items-center
          justify-between
          gap-2
          bg-gradient-to-t
          from-black/70
          to-transparent
          p-2.5
        "
      >
        <span
          className="
            flex
            min-w-0
            items-center
            gap-1.5
            text-xs
            font-medium
            text-white
          "
        >
          {isHost && (
            <Crown
              size={12}
              className="shrink-0 text-warning"
              aria-label="Host"
            />
          )}

          <span className="truncate">
            {name}
            {isSelf && ' (you)'}
            {isScreen && ' · screen'}
          </span>

          {!micOn && !isScreen && (
            <MicOff
              size={12}
              className="shrink-0 text-danger"
              aria-label="Muted"
            />
          )}
        </span>

        <span className="flex items-center gap-1.5">
          {/* Connection quality */}
          {showStats && stats && (
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                qualityColor[stats.quality],
              )}
              title={`RTT ${stats.rttMs}ms · loss ${stats.packetLossPct}% · ${stats.outboundKbps}kbps`}
              aria-label={`Connection ${stats.quality}`}
            />
          )}

          {/* Picture-in-Picture */}
          {showVideo && (
            <button
              type="button"
              aria-label={`Picture in picture: ${name}`}
              className="
                cursor-pointer
                rounded-md
                p-1.5
                text-white/70
                opacity-100
                transition-all
                hover:text-white
                sm:opacity-0
                sm:group-hover:opacity-100
              "
              onClick={() => void pip()}
            >
              <PictureInPicture2 size={14} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}