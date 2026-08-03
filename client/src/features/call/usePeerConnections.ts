import { useCallback, useEffect, useRef, useState } from 'react';
import type { SignalPayload } from '@syncroom/shared';
import { socket } from '@/lib/socket';
import { QUALITY_MAX_BITRATE, useSettings } from '@/store/settings';
import { useRoomStore } from '@/store/room';

export interface RemoteFeed {
  peerId: string;
  stream: MediaStream;
  kind: 'camera' | 'screen';
}

interface PeerRecord {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Their stream-id → purpose map, learned from their signals. */
  remoteMeta: Record<string, 'camera' | 'screen'>;
  camSenders: Partial<Record<'audio' | 'video', RTCRtpSender>>;
  screenSenders: Partial<Record<'audio' | 'video', RTCRtpSender>>;
}

/**
 * ICE configuration, tuned to keep media direct (P2P) and only relay when a
 * direct path is impossible.
 *
 * We list STUN first and TURN (if configured) second. With the default
 * `iceTransportPolicy: 'all'`, the browser gathers host + server-reflexive
 * (STUN) candidates and always *prefers* a direct connection; a TURN `relay`
 * candidate is used only when no direct pair can be established (strict/
 * symmetric NAT, ~10-15% of pairs). We never set `iceTransportPolicy: 'relay'`,
 * which would force every call through TURN and defeat the point of P2P.
 * VITE_TURN_URL may list several URLs (comma-separated), e.g. UDP + TCP/443.
 */
function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
  if (turnUrl) {
    const urls = turnUrl
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length > 0) {
      servers.push({
        urls,
        username: (import.meta.env.VITE_TURN_USERNAME as string | undefined) ?? '',
        credential: (import.meta.env.VITE_TURN_CREDENTIAL as string | undefined) ?? '',
      });
    }
  }
  return servers;
}

/**
 * Full-mesh WebRTC with the "perfect negotiation" pattern. Each remote
 * participant gets one RTCPeerConnection carrying the camera stream and,
 * when active, a separate screen-share stream (identified via streamMeta
 * piggybacked on signaling).
 *
 * P2P mesh = no SFU in the media path: original encoder quality end-to-end,
 * lowest possible latency, zero media-server cost. See ARCHITECTURE.md for
 * the SFU trade-off discussion.
 */
export function usePeerConnections(options: {
  active: boolean;
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
}): {
  feeds: RemoteFeed[];
  peersRef: React.MutableRefObject<Map<string, PeerRecord>>;
  syncAllTracks: () => void;
} {
  const { active, localStream, screenStream } = options;
  const [feeds, setFeeds] = useState<RemoteFeed[]>([]);
  const peersRef = useRef<Map<string, PeerRecord>>(new Map());
  const localRef = useRef<{ cam: MediaStream | null; screen: MediaStream | null }>({
    cam: null,
    screen: null,
  });
  localRef.current = { cam: localStream, screen: screenStream };

  const selfId = useRoomStore((s) => s.selfId);
  const participants = useRoomStore((s) => s.room?.participants);

  const streamMeta = useCallback((): Record<string, 'camera' | 'screen'> => {
    const meta: Record<string, 'camera' | 'screen'> = {};
    const { cam, screen } = localRef.current;
    if (cam) meta[cam.id] = 'camera';
    if (screen) meta[screen.id] = 'screen';
    return meta;
  }, []);

  const removeFeedsFor = useCallback((peerId: string, streamId?: string): void => {
    setFeeds((prev) =>
      prev.filter(
        (f) => f.peerId !== peerId || (streamId !== undefined && f.stream.id !== streamId),
      ),
    );
  }, []);

  const applySenderQuality = useCallback(
    (sender: RTCRtpSender, kind: 'camera' | 'screen'): void => {
      if (sender.track?.kind !== 'video') return;
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      const preset = useSettings.getState().quality;
      params.encodings.forEach((enc) => {
        enc.maxBitrate = QUALITY_MAX_BITRATE[preset];
      });
      params.degradationPreference = kind === 'screen' ? 'maintain-resolution' : 'balanced';
      sender.setParameters(params).catch(() => {
        /* older browsers may reject degradationPreference; harmless */
      });
    },
    [],
  );

  /** Ensures every peer connection carries the current local tracks. */
  const syncAllTracks = useCallback((): void => {
    const { cam, screen } = localRef.current;
    for (const peer of peersRef.current.values()) {
      const { pc } = peer;

      const syncSet = (
        stream: MediaStream | null,
        senders: Partial<Record<'audio' | 'video', RTCRtpSender>>,
        kind: 'camera' | 'screen',
      ): void => {
        if (stream) {
          for (const track of stream.getTracks()) {
            const slot = track.kind as 'audio' | 'video';
            const existing = senders[slot];
            if (!existing) {
              console.log("[ADD TRACK]", {
                source: kind, // camera or screen
                trackKind: track.kind, // audio or video
                trackId: track.id,
                streamId: stream.id,
                enabled: track.enabled,
                readyState: track.readyState,
              });
              const sender = pc.addTrack(track, stream);
              senders[slot] = sender;
              applySenderQuality(sender, kind);
            } else if (existing.track !== track) {
              void existing.replaceTrack(track);
              applySenderQuality(existing, kind);
            }
          }
        } else {
          for (const slot of ['audio', 'video'] as const) {
            const sender = senders[slot];
            if (sender) {
              try {
                pc.removeTrack(sender);
              } catch {
                /* pc may be closed */
              }
              delete senders[slot];
            }
          }
        }
      };
      console.log(
        "[LOCAL CAM]", 
        cam?.getTracks().map(t => ({
          kind: t.kind,
          enabled: t.enabled,
          readyState: t.readyState
        }))
      );
      syncSet(cam, peer.camSenders, 'camera');
      syncSet(screen, peer.screenSenders, 'screen');
    }
  }, [applySenderQuality]);

  const createPeer = useCallback(
    (peerId: string): PeerRecord => {
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      pc.onsignalingstatechange = () => {
        console.log("[SIGNAL STATE]", peerId, pc.signalingState);
      };

      pc.onconnectionstatechange = () => {
        console.log("[CONNECTION STATE]", peerId, pc.connectionState);
      };
      const peer: PeerRecord = {
        pc,
        polite: (selfId ?? '') < peerId,
        makingOffer: false,
        ignoreOffer: false,
        remoteMeta: {},
        camSenders: {},
        screenSenders: {},
      };

      pc.onnegotiationneeded = async (): Promise<void> => {
        console.log("[NEGOTIATION]", {
          peerId,
          selfId,
          signalingState: pc.signalingState,
          iceConnectionState: pc.iceConnectionState,
        });

        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();

          if (pc.localDescription) {
            console.log("[SIGNAL OUT]", {
              type: pc.localDescription.type,
              to: peerId,
              from: selfId,
            });

            socket.emit('signal', {
              to: peerId,
              from: selfId ?? '',
              description: pc.localDescription.toJSON() as SignalPayload['description'],
              streamMeta: streamMeta(),
            });
          }
        } catch (err) {
          console.error("[NEGOTIATION ERROR]", err);
        } finally {
          peer.makingOffer = false;
        }
      };

      pc.onicecandidate = (ev): void => {
        console.log("[ICE OUT]", ev.candidate);
        if (ev.candidate) {
          socket.emit('signal', {
            to: peerId,
            from: selfId ?? '',
            candidate: ev.candidate.toJSON(),
          });
        }
      };

      pc.oniceconnectionstatechange = (): void => {
        console.log("[ICE STATE]", peerId, pc.iceConnectionState);

        if (pc.iceConnectionState === "failed") {
          console.log("[ICE RESTART]", peerId);
          pc.restartIce();
        }

      };

      pc.ontrack = (ev): void => {
        console.log("[TRACK]", ev.track.kind, ev.streams);
        let stream = ev.streams[0];

        if (!stream) {
          stream = new MediaStream([ev.track]);
        }
        const kind = peer.remoteMeta[stream.id] ?? 'camera';
        setFeeds((prev) => {
          const without = prev.filter((f) => !(f.peerId === peerId && f.stream.id === stream.id));
          return [...without, { peerId, stream, kind }];
        });
        stream.onremovetrack = (): void => {
          if (stream.getTracks().length === 0) removeFeedsFor(peerId, stream.id);
        };
      };

      peersRef.current.set(peerId, peer);
      return peer;
    },
    [selfId, streamMeta, removeFeedsFor],
  );

  /** Incoming signaling, one listener for all peers. */
  useEffect(() => {
    if (!active) return;

    const onSignal = async (payload: SignalPayload): Promise<void> => {
      console.log("[SIGNAL IN]", payload);

      const peerId = payload.from;
      if (!peerId || peerId === selfId) return;
      let peer = peersRef.current.get(peerId);
      if (!peer) {
        peer = createPeer(peerId);
        syncAllTracks();
      }
      if (payload.streamMeta) peer.remoteMeta = { ...peer.remoteMeta, ...payload.streamMeta };
      const { pc } = peer;

      try {
        if (payload.description) {
          const description = payload.description as RTCSessionDescriptionInit;
          const collision =
            description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
          peer.ignoreOffer = !peer.polite && collision;
          if (peer.ignoreOffer) return;
          await pc.setRemoteDescription(description);
          if (description.type === 'offer') {
            await pc.setLocalDescription();
            if (pc.localDescription) {
              socket.emit('signal', {
                to: peerId,
                from: selfId ?? '',
                description: pc.localDescription.toJSON() as SignalPayload['description'],
                streamMeta: streamMeta(),
              });
            }
          }
        } else if (payload.candidate) {
          try {
            console.log("[ICE IN]", payload.candidate);
            await pc.addIceCandidate(payload.candidate as RTCIceCandidateInit);
          } catch (err) {
            if (!peer.ignoreOffer) throw err;
          }
        }
      } catch {
        /* a broken negotiation recovers via ICE restart / next offer */
      }
    };

    const handler = (payload: SignalPayload): void => {
      void onSignal(payload);
    };
    socket.on('signal', handler);
    return () => {
      socket.off('signal', handler);
    };
  }, [active, selfId, createPeer, streamMeta, syncAllTracks]);

  /** Open connections to newcomers; tear down leavers. */
  useEffect(() => {
    if (!active || !selfId) return;
    const current = new Set((participants ?? []).map((p) => p.id));
    current.delete(selfId);

    for (const peerId of current) {
      if (!peersRef.current.has(peerId)) {
        createPeer(peerId);
      }
    }
    for (const [peerId, peer] of peersRef.current) {
      if (!current.has(peerId)) {
        peer.pc.close();
        peersRef.current.delete(peerId);
        removeFeedsFor(peerId);
      }
    }
    syncAllTracks();
  }, [active, selfId, participants, createPeer, removeFeedsFor, syncAllTracks]);

  /** Keep senders in step with the local streams. */
  useEffect(() => {
    syncAllTracks();
  }, [localStream, screenStream, syncAllTracks]);

  /** Full teardown when the call ends AND on unmount (no leaked RTCPeerConnections). */
  useEffect(() => {
    const peers = peersRef.current; // stable Map instance for the hook's lifetime
    if (!active) {
      for (const peer of peers.values()) peer.pc.close();
      peers.clear();
      setFeeds([]);
    }
    return () => {
      for (const peer of peers.values()) peer.pc.close();
      peers.clear();
    };
  }, [active]);

  return { feeds, peersRef, syncAllTracks };
}

export type PeersRef = ReturnType<typeof usePeerConnections>['peersRef'];
