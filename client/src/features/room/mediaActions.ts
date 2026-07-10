import { expectedTime } from '@syncroom/shared';
import { socket, serverNow } from '@/lib/socket';
import { canSelfControl, useRoomStore } from '@/store/room';

/** Step used by the seek buttons, arrow keys and double-tap gestures. */
export const SEEK_STEP_S = 5;

/**
 * Local media toggles + relative seek, shared by the control bar, the cinema
 * bar and keyboard shortcuts so every entry point behaves identically.
 *
 * Mic/camera only flip the store flags; RoomPage mirrors them onto
 * `MediaStreamTrack.enabled` and presence. No renegotiation, no reconnect.
 */
export function toggleMic(): void {
  const st = useRoomStore.getState();
  const next = !st.micOn;
  st.setMedia({ micOn: next });
  st.toast('info', next ? 'Microphone On' : 'Microphone Muted', 'mic-toggle');
}

export function toggleCamera(): void {
  const st = useRoomStore.getState();
  const next = !st.cameraOn;
  st.setMedia({ cameraOn: next });
  st.toast('info', next ? 'Camera On' : 'Camera Off', 'camera-toggle');
}

/**
 * Relative seek through the exact same pipeline as the timeline slider: one
 * `sync:seek` socket event, server stays authoritative, permissions apply.
 * Returns whether a seek was actually requested (for gesture feedback).
 */
export function seekBy(deltaSeconds: number): boolean {
  const st = useRoomStore.getState();
  const sync = st.syncState;
  if (!sync?.media || !canSelfControl(st)) return false;
  const time = Math.max(0, expectedTime(sync, serverNow()) + deltaSeconds);
  socket.emit('sync:seek', { time, eventId: crypto.randomUUID() });
  return true;
}
