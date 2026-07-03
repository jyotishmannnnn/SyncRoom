import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { socket } from '@/lib/socket';
import { canSelfControl, isSelfHost, useRoomStore } from '@/store/room';
import { SyncController, type ControllerPhase } from './SyncController';

/**
 * Thin React binding for the SyncController state machine.
 *
 * - Creates one controller per (media item, control-rights) combination and
 *   disposes it fully on change — provider switches (YouTube → Drive → MP4)
 *   replace the playback session in place, no page refresh, no leaks.
 * - Feeds every authoritative `sync:state` into `applyRemote` (seq-guarded).
 * - Google Drive: when direct playback is impossible, the controller swaps
 *   in the unsynced preview adapter; this hook surfaces that as one banner
 *   plus one (deduplicated) toast.
 * - Autoplay policy blocks surface as a click-to-play overlay; the click
 *   provides the user gesture and `resume()` re-applies authority.
 * - Queue auto-advance is performed by the host only, so a room full of
 *   controllers can never emit duplicate `queue:play` events.
 */
export interface LocalPlayerFacade {
  getPlayhead: () => { time: number; duration: number; seekable: boolean } | null;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  setMuted: (muted: boolean) => void;
  isMuted: () => boolean;
  setNativeControls: (visible: boolean) => void;
}

export function useSyncEngine(containerRef: RefObject<HTMLDivElement | null>): {
  driveFallback: boolean;
  playerReady: boolean;
  autoplayBlocked: boolean;
  resume: () => void;
  /** Per-viewer controls for UI chrome (cinema bar) — never synchronized. */
  player: LocalPlayerFacade;
} {
  const syncState = useRoomStore((s) => s.syncState);
  const canControl = useRoomStore((s) => canSelfControl(s));
  const mediaId = syncState?.media?.id ?? null;

  const [driveFallback, setDriveFallback] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [phase, setPhase] = useState<ControllerPhase>('loading');
  const controllerRef = useRef<SyncController | null>(null);

  /* One controller per media item (or when control rights change the
     player chrome). Everything else reads live state via callbacks. */
  useEffect(() => {
    const container = containerRef.current;
    const store = useRoomStore.getState();
    const media = store.syncState?.media ?? null;
    setDriveFallback(false);
    setAutoplayBlocked(false);
    setPhase('loading');
    if (!container || !media) return;

    const controller = new SyncController({
      container,
      canControl: () => canSelfControl(useRoomStore.getState()),
      isHost: () => isSelfHost(useRoomStore.getState()),
      authoritative: () => useRoomStore.getState().syncState,
      onPhase: setPhase,
      onError: (message) => {
        useRoomStore.getState().toast('error', message, `media-error:${media.id}`);
      },
      onSyncUnavailable: () => {
        setDriveFallback(true);
        setPhase('ready');
        useRoomStore
          .getState()
          .toast(
            'info',
            'Google Drive blocked direct streaming — switched to Drive’s player (not synced).',
            'drive-fallback',
          );
      },
      onAutoplayBlocked: () => setAutoplayBlocked(true),
      onEnded: () => {
        const st = useRoomStore.getState();
        const next = st.queue[0];
        if (next && isSelfHost(st)) socket.emit('queue:play', next.id);
      },
    });
    controllerRef.current = controller;
    void controller.load(media, canControl);

    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [mediaId, canControl, containerRef]);

  /* Every authoritative state flows through the seq-guarded gate. */
  useEffect(() => {
    if (syncState) controllerRef.current?.applyRemote(syncState);
  }, [syncState]);

  const resume = useCallback((): void => {
    setAutoplayBlocked(false);
    controllerRef.current?.resume();
  }, []);

  const player = useMemo<LocalPlayerFacade>(
    () => ({
      getPlayhead: () => controllerRef.current?.getPlayhead() ?? null,
      setVolume: (v) => controllerRef.current?.setVolume(v),
      getVolume: () => controllerRef.current?.getVolume() ?? 1,
      setMuted: (m) => controllerRef.current?.setMuted(m),
      isMuted: () => controllerRef.current?.isMuted() ?? false,
      setNativeControls: (v) => controllerRef.current?.setNativeControls(v),
    }),
    [],
  );

  return { driveFallback, playerReady: phase === 'ready', autoplayBlocked, resume, player };
}
