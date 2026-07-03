import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { GripHorizontal } from 'lucide-react';
import type { RemoteFeed } from '@/features/call/usePeerConnections';
import type { PeerStats } from '@/features/call/useCallStats';
import { useRoomStore } from '@/store/room';
import { cn } from '@/lib/utils';
import { VideoTile } from './VideoTile';

export interface FloatingThumbsProps {
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  feeds: RemoteFeed[];
  stats: Record<string, PeerStats>;
}

/**
 * Webcam thumbnails floating over the cinema stage. The whole cluster is
 * draggable (pointer events, clamped to the stage) so it never blocks the
 * part of the movie you care about.
 */
export function FloatingThumbs({ localStream, screenStream, feeds, stats }: FloatingThumbsProps) {
  const selfId = useRoomStore((s) => s.selfId);
  const micOn = useRoomStore((s) => s.micOn);
  const cameraOn = useRoomStore((s) => s.cameraOn);
  const participants = useRoomStore((s) => s.room?.participants ?? []);

  const boxRef = useRef<HTMLDivElement>(null);
  /** null = default anchor (top-right); set on first drag. */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const parent = box.offsetParent?.getBoundingClientRect();
    if (!parent) return;
    dragging.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    setPos({ x: rect.left - parent.left, y: rect.top - parent.top });
    box.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragging.current;
    const box = boxRef.current;
    const parent = box?.offsetParent?.getBoundingClientRect();
    if (!drag || !box || !parent) return;
    const rect = box.getBoundingClientRect();
    const x = Math.min(Math.max(0, e.clientX - parent.left - drag.dx), parent.width - rect.width);
    const y = Math.min(Math.max(0, e.clientY - parent.top - drag.dy), parent.height - rect.height);
    setPos({ x, y });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    dragging.current = null;
    boxRef.current?.releasePointerCapture(e.pointerId);
  };

  const byId = new Map(participants.map((p) => [p.id, p]));
  const self = selfId ? byId.get(selfId) : undefined;
  const cameraFeeds = feeds.filter((f) => f.kind === 'camera' && byId.has(f.peerId));

  return (
    <div
      ref={boxRef}
      role="group"
      aria-label="Participant cameras (draggable)"
      className={cn(
        'absolute z-20 flex max-w-[70%] cursor-grab touch-none select-none flex-col gap-1.5',
        'active:cursor-grabbing',
        pos === null && 'right-4 top-4',
      )}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="mx-auto rounded-full bg-black/50 px-2 py-0.5 text-white/60 backdrop-blur">
        <GripHorizontal size={14} aria-hidden />
      </div>
      <div className="flex flex-wrap justify-end gap-1.5">
        {self && (
          <VideoTile
            stream={screenStream ?? localStream}
            name={self.name}
            isSelf
            isHost={self.isHost}
            micOn={micOn}
            cameraOn={cameraOn}
            isScreen={screenStream !== null}
            className="aspect-video w-40 shadow-2xl"
          />
        )}
        {cameraFeeds.map((f) => {
          const p = byId.get(f.peerId)!;
          return (
            <VideoTile
              key={f.stream.id}
              stream={f.stream}
              name={p.name}
              isHost={p.isHost}
              micOn={p.micOn}
              cameraOn={p.cameraOn}
              stats={stats[f.peerId]}
              className="aspect-video w-40 shadow-2xl"
            />
          );
        })}
      </div>
    </div>
  );
}
