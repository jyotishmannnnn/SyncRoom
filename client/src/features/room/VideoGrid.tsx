import type { Participant } from '@syncroom/shared';
import type { RemoteFeed } from '@/features/call/usePeerConnections';
import type { PeerStats } from '@/features/call/useCallStats';
import { useRoomStore } from '@/store/room';
import { useSettings } from '@/store/settings';
import { cn } from '@/lib/utils';
import { VideoTile } from './VideoTile';

export interface VideoGridProps {
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  feeds: RemoteFeed[];
  stats: Record<string, PeerStats>;
  /** Filmstrip mode: media stage or a screen share owns the main area. */
  strip?: boolean;
}

interface Tile {
  key: string;
  stream: MediaStream | null;
  participant: Participant | undefined;
  isSelf: boolean;
  isScreen: boolean;
  peerId: string | null;
}

const gridCols = (n: number): string => {
  if (n <= 1) return 'grid-cols-1';
  if (n <= 4) return 'grid-cols-2';
  if (n <= 9) return 'grid-cols-3';
  return 'grid-cols-4';
};

export function VideoGrid({
  localStream,
  screenStream,
  feeds,
  stats,
  strip = false,
}: VideoGridProps) {
  const selfId = useRoomStore((s) => s.selfId);
  const micOn = useRoomStore((s) => s.micOn);
  const cameraOn = useRoomStore((s) => s.cameraOn);
  const participants = useRoomStore((s) => s.room?.participants ?? []);
  // Self tile mirrors from the local setting for instant feedback; remote tiles
  // mirror from each participant's broadcast flag (so everyone sees your choice).
  const mirrorSelf = useSettings((s) => s.mirrorVideo);
  const mirroredFor = (t: Tile): boolean =>
    t.isSelf ? mirrorSelf : (t.participant?.mirrored ?? false);

  const byId = new Map(participants.map((p) => [p.id, p]));
  const self = selfId ? byId.get(selfId) : undefined;

  const tiles: Tile[] = [];
  if (screenStream && self) {
    tiles.push({
      key: 'self-screen',
      stream: screenStream,
      participant: self,
      isSelf: true,
      isScreen: true,
      peerId: null,
    });
  }
  tiles.push({
    key: 'self-camera',
    stream: localStream,
    participant: self,
    isSelf: true,
    isScreen: false,
    peerId: null,
  });
  for (const feed of feeds) {
    const p = byId.get(feed.peerId);
    if (!p) continue; // participant already left; feed teardown is in flight
    tiles.push({
      key: `${feed.peerId}-${feed.stream.id}`,
      stream: feed.stream,
      participant: p,
      isSelf: false,
      isScreen: feed.kind === 'screen',
      peerId: feed.peerId,
    });
  }
  // Participants whose media hasn't arrived yet still get a presence tile.
  for (const p of participants) {
    if (p.id === selfId) continue;
    if (!feeds.some((f) => f.peerId === p.id)) {
      tiles.push({
        key: `${p.id}-pending`,
        stream: null,
        participant: p,
        isSelf: false,
        isScreen: false,
        peerId: p.id,
      });
    }
  }

  // Remote screen shares are the hero tile in grid mode.
  const remoteScreen = tiles.find((t) => t.isScreen && !t.isSelf);

  if (strip) {
    return (
      <div className="flex h-full gap-2 overflow-x-auto lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
        {tiles.map((t) => (
          <VideoTile
            key={t.key}
            stream={t.stream}
            name={t.participant?.name ?? 'Unknown'}
            isSelf={t.isSelf}
            isHost={t.participant?.isHost}
            micOn={t.isSelf ? micOn : t.participant?.micOn}
            cameraOn={t.isSelf ? cameraOn : t.participant?.cameraOn}
            isScreen={t.isScreen}
            mirrored={mirroredFor(t)}
            stats={t.peerId ? stats[t.peerId] : undefined}
            className="aspect-video w-44 shrink-0 lg:w-full"
          />
        ))}
      </div>
    );
  }

  if (remoteScreen) {
    const rest = tiles.filter((t) => t !== remoteScreen);
    return (
      <div className="flex h-full flex-col gap-2 lg:flex-row">
        <VideoTile
          stream={remoteScreen.stream}
          name={remoteScreen.participant?.name ?? 'Unknown'}
          isHost={remoteScreen.participant?.isHost}
          isScreen
          stats={remoteScreen.peerId ? stats[remoteScreen.peerId] : undefined}
          className="min-h-0 flex-1"
        />
        <div className="flex gap-2 overflow-x-auto lg:w-48 lg:flex-col lg:overflow-y-auto">
          {rest.map((t) => (
            <VideoTile
              key={t.key}
              stream={t.stream}
              name={t.participant?.name ?? 'Unknown'}
              isSelf={t.isSelf}
              isHost={t.participant?.isHost}
              micOn={t.isSelf ? micOn : t.participant?.micOn}
              cameraOn={t.isSelf ? cameraOn : t.participant?.cameraOn}
              isScreen={t.isScreen}
              mirrored={mirroredFor(t)}
              stats={t.peerId ? stats[t.peerId] : undefined}
              className="aspect-video w-40 shrink-0 lg:w-full"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('grid h-full auto-rows-fr gap-2 sm:gap-3', gridCols(tiles.length))}>
      {tiles.map((t) => (
        <VideoTile
          key={t.key}
          stream={t.stream}
          name={t.participant?.name ?? 'Unknown'}
          isSelf={t.isSelf}
          isHost={t.participant?.isHost}
          micOn={t.isSelf ? micOn : t.participant?.micOn}
          cameraOn={t.isSelf ? cameraOn : t.participant?.cameraOn}
          isScreen={t.isScreen}
          mirrored={mirroredFor(t)}
          stats={t.peerId ? stats[t.peerId] : undefined}
          className="min-h-0"
        />
      ))}
    </div>
  );
}
