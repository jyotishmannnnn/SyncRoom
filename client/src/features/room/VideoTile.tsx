import { useEffect, useRef, useState } from 'react';
import { Crown, MicOff, PictureInPicture2 } from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { useSettings } from '@/store/settings';
import type { PeerStats } from '@/features/call/useCallStats';

export interface VideoTileProps {
  stream: MediaStream | null;
  name: string;
  isSelf?: boolean;
  isHost?: boolean;
  micOn?: boolean;
  cameraOn?: boolean;
  isScreen?: boolean;
  /** This participant chose to flip their video, shown mirrored to everyone. */
  mirrored?: boolean;
  stats?: PeerStats;
  className?: string;
}

const qualityColor = { good: 'bg-success', fair: 'bg-warning', poor: 'bg-danger' } as const;

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
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const speakerId = useSettings((s) => s.speakerId);
  const showStats = useSettings((s) => s.showStats);
  const [pipActive, setPipActive] = useState(false);

  /* Attach the stream and keep the element rendering it. Browsers can pause
     a <video> playing a live MediaStream around fullscreen transitions (the
     element is re-laid-out while the compositor switches surfaces) even
     though every track stays live — the remote side keeps receiving frames
     while this preview looks frozen. Re-asserting play() on pause events and
     fullscreen flips fixes the rendering without ever touching the stream. */
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    if (!stream) return;
    const resume = (): void => {
      if (el.isConnected && el.srcObject === stream && el.paused) {
        void el.play().catch(() => {});
      }
    };
    resume();
    el.addEventListener('pause', resume);
    document.addEventListener('fullscreenchange', resume);
    document.addEventListener('webkitfullscreenchange', resume);
    return () => {
      el.removeEventListener('pause', resume);
      document.removeEventListener('fullscreenchange', resume);
      document.removeEventListener('webkitfullscreenchange', resume);
    };
  }, [stream]);

  useEffect(() => {
    const el = videoRef.current;
    if (el && !isSelf && speakerId && 'setSinkId' in el) {
      el.setSinkId(speakerId).catch(() => {
        /* device may be gone; browser falls back to default */
      });
    }
  }, [speakerId, isSelf]);

  const showVideo = stream !== null && (cameraOn || isScreen);

  /* Track PiP so we can hide the inline element while it is mirrored to the
     PiP window, that suppresses the browser's big "Playing in picture-in-
     picture" placeholder text (it's painted inside the source <video>). We
     also re-assert playback across the transition: some browsers pause the
     inline element, and a MediaStream tile that isn't playing opens a paused
     PiP window. */
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const resume = (): void => {
      if (el.paused) void el.play().catch(() => {});
    };
    const onEnter = (): void => {
      setPipActive(true);
      resume();
    };
    const onLeave = (): void => {
      setPipActive(false);
      resume();
    };
    el.addEventListener('enterpictureinpicture', onEnter);
    el.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      el.removeEventListener('enterpictureinpicture', onEnter);
      el.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, []);

  const pip = async (): Promise<void> => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement === el) {
        await document.exitPictureInPicture();
        return;
      }
      // A live tile must be actively playing to enter PiP cleanly, a paused
      // element opens a paused PiP window (or throws). Start it first, then
      // keep it playing once the transition completes.
      if (el.paused) await el.play().catch(() => {});
      await el.requestPictureInPicture();
      if (el.paused) void el.play().catch(() => {});
    } catch {
      /* PiP unsupported or blocked, non-fatal */
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
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        className={cn(
          'h-full w-full',
          isScreen ? 'object-contain bg-black' : 'object-cover',
          mirrored && !isScreen && 'mirror',
          !showVideo && 'invisible',
        )}
      />
      {/* Opaque cover shown for camera-off tiles and, crucially, while the
          tile is in PiP. Covering (rather than hiding) the still-visible
          <video> masks the browser's big "Playing in picture-in-picture"
          text without ever detaching rendering, so closing PiP snaps back
          instantly instead of lingering on a placeholder. */}
      {(!showVideo || pipActive) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-overlay">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/20 text-xl font-semibold text-accent">
            {initials(name) || '?'}
          </div>
          {pipActive && showVideo && (
            <span className="text-xs text-ink-faint">In picture-in-picture</span>
          )}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-white">
          {isHost && <Crown size={12} className="shrink-0 text-warning" aria-label="Host" />}
          <span className="truncate">
            {name}
            {isSelf && ' (you)'}
            {isScreen && ' · screen'}
          </span>
          {!micOn && !isScreen && (
            <MicOff size={12} className="shrink-0 text-danger" aria-label="Muted" />
          )}
        </span>
        <span className="flex items-center gap-1.5">
          {showStats && stats && (
            <span
              className={cn('h-2 w-2 rounded-full', qualityColor[stats.quality])}
              title={`RTT ${stats.rttMs}ms · loss ${stats.packetLossPct}% · ${stats.outboundKbps}kbps`}
              aria-label={`Connection ${stats.quality}`}
            />
          )}
          {showVideo && (
            <button
              type="button"
              aria-label={`Picture in picture: ${name}`}
              className="cursor-pointer rounded-md p-1.5 text-white/70 opacity-100 transition-all hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
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
