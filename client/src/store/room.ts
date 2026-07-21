import { create } from 'zustand';
import type {
  ChatMessage,
  MediaItem,
  Participant,
  RoomReaction,
  RoomSnapshot,
  SyncState,
} from '@syncroom/shared';

export type PanelKind = 'chat' | 'people' | 'media' | null;

export interface Toast {
  id: number;
  /** Stable identity, an identical toast renews this one instead of stacking. */
  key: string;
  kind: 'info' | 'error' | 'success';
  text: string;
  /** Bumped on renewal so the auto-dismiss timer restarts. */
  renewedAt: number;
}

interface RoomStore {
  /** Session */
  selfId: string | null;
  joined: boolean;
  ending: 'kicked' | 'ended' | null;

  /** Server-authoritative state */
  room: RoomSnapshot | null;
  chat: ChatMessage[];
  syncState: SyncState | null;
  queue: MediaItem[];
  typing: Record<string, boolean>;

  /** Local media flags (mirrored to the server as presence) */
  micOn: boolean;
  cameraOn: boolean;
  sharing: boolean;

  /** UI */
  panel: PanelKind;
  toasts: Toast[];
  unreadChat: number;
  reactions: RoomReaction[];

  setJoined: (selfId: string, room: RoomSnapshot, chat: ChatMessage[]) => void;
  setRoom: (room: RoomSnapshot) => void;
  setSyncState: (s: SyncState) => void;
  setQueue: (q: MediaItem[]) => void;
  addChat: (msg: ChatMessage) => void;
  markDeleted: (messageId: string) => void;
  markRead: (readerId: string, ids: string[]) => void;
  setTyping: (participantId: string, typing: boolean) => void;
  setMedia: (flags: Partial<{ micOn: boolean; cameraOn: boolean; sharing: boolean }>) => void;
  setPanel: (panel: PanelKind) => void;
  clearUnread: () => void;
  toast: (kind: Toast['kind'], text: string, key?: string) => void;
  dismissToast: (id: number) => void;
  setEnding: (reason: 'kicked' | 'ended') => void;
  reset: () => void;
  showReaction: (reaction: RoomReaction) => void;
  removeReaction: (reactionId: string) => void;
}

let toastId = 0;

const initial = {
  selfId: null,
  joined: false,
  ending: null,
  room: null,
  chat: [],
  syncState: null,
  queue: [],
  typing: {},
  micOn: true,
  cameraOn: true,
  sharing: false,
  panel: null as PanelKind,
  toasts: [] as Toast[],
  unreadChat: 0,
  reactions: [] as RoomReaction[],
};

export const useRoomStore = create<RoomStore>((set) => ({
  ...initial,

  setJoined: (selfId, room, chat) =>
    set({
      selfId,
      room,
      chat,
      joined: true,
      ending: null,
      syncState: room.sync,
      queue: room.queue,
    }),
  setRoom: (room) => set({ room, queue: room.queue }),
  setSyncState: (syncState) => set({ syncState }),
  setQueue: (queue) => set({ queue }),

  addChat: (msg) =>
    set((s) => ({
      chat: [...s.chat, msg],
      unreadChat: s.panel === 'chat' ? 0 : s.unreadChat + 1,
    })),
  markDeleted: (messageId) =>
    set((s) => ({
      chat: s.chat.map((m) =>
        m.id === messageId ? { ...m, deleted: true, text: '', attachment: undefined } : m,
      ),
    })),
  markRead: (readerId, ids) =>
    set((s) => ({
      chat: s.chat.map((m) =>
        ids.includes(m.id) && !m.readBy.includes(readerId)
          ? { ...m, readBy: [...m.readBy, readerId] }
          : m,
      ),
    })),
  setTyping: (participantId, typing) =>
    set((s) => ({ typing: { ...s.typing, [participantId]: typing } })),

  setMedia: (flags) => set(flags),
  setPanel: (panel) => set((s) => ({ panel, unreadChat: panel === 'chat' ? 0 : s.unreadChat })),
  clearUnread: () => set({ unreadChat: 0 }),

  // Deduplicated: an identical toast (same key, default = kind+text) renews
  // the visible one, resets its timer and refreshes the text, instead of
  // stacking. At most one identical toast can ever be on screen.
  toast: (kind, text, key) =>
    set((s) => {
      const k = key ?? `${kind}:${text}`;
      const existing = s.toasts.find((t) => t.key === k);
      if (existing) {
        return {
          toasts: s.toasts.map((t) => (t.key === k ? { ...t, text, renewedAt: Date.now() } : t)),
        };
      }
      return {
        toasts: [
          ...s.toasts.slice(-3),
          { id: ++toastId, key: k, kind, text, renewedAt: Date.now() },
        ],
      };
    }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    setEnding: (reason) => set({ ending: reason }),

  showReaction: (reaction) =>
    set((s) => ({
      reactions: [...s.reactions, reaction],
    })),

  removeReaction: (reactionId) =>
    set((s) => ({
      reactions: s.reactions.filter(
        (reaction) => reaction.id !== reactionId,
      ),
    })),

  reset: () => set({ ...initial }),
}));

/** Convenience selectors. */
export function selfParticipant(s: {
  room: RoomSnapshot | null;
  selfId: string | null;
}): Participant | null {
  return s.room?.participants.find((p) => p.id === s.selfId) ?? null;
}

export function isSelfHost(s: { room: RoomSnapshot | null; selfId: string | null }): boolean {
  return s.room !== null && s.selfId !== null && s.room.hostId === s.selfId;
}

export function canSelfControl(s: { room: RoomSnapshot | null; selfId: string | null }): boolean {
  if (!s.room || !s.selfId) return false;
  return s.room.controlMode === 'everyone' || s.room.hostId === s.selfId;
}
