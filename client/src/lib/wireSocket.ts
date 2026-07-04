import { socket } from './socket';
import { useRoomStore } from '@/store/room';
import { useSettings } from '@/store/settings';

/**
 * Attaches the shared socket's server events to the room store.
 * Called once for the app lifetime; idempotent via the `wired` latch.
 */
let wired = false;

export function wireSocketToStore(): void {
  if (wired) return;
  wired = true;
  const store = useRoomStore;

  socket.on('room:state', (room) => store.getState().setRoom(room));
  socket.on('sync:state', (s) => store.getState().setSyncState(s));
  socket.on('queue:state', (q) => store.getState().setQueue(q));

  socket.on('chat:message', (msg) => {
    const st = store.getState();
    st.addChat(msg);
    if (
      useSettings.getState().notifications &&
      document.visibilityState === 'hidden' &&
      msg.senderId !== st.selfId &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      new Notification(`${msg.senderName} · Havnn`, {
        body: msg.attachment ? `Sent ${msg.attachment.name}` : msg.text.slice(0, 120),
      });
    }
  });
  socket.on('chat:deleted', (id) => store.getState().markDeleted(id));
  socket.on('chat:read', (readerId, ids) => store.getState().markRead(readerId, ids));
  socket.on('chat:typing', (participantId, typing) =>
    store.getState().setTyping(participantId, typing),
  );

  socket.on('room:kicked', () => store.getState().setEnding('kicked'));
  socket.on('room:ended', () => store.getState().setEnding('ended'));
  socket.on('room:force-muted', () => {
    store.getState().setMedia({ micOn: false });
    store.getState().toast('info', 'The host muted your microphone.');
  });

  socket.on('error', (message) => store.getState().toast('error', message));

  socket.on('disconnect', (reason) => {
    if (reason !== 'io client disconnect') {
      store.getState().toast('info', 'Connection lost, reconnecting…');
    }
  });
}
