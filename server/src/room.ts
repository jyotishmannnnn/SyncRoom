import { randomUUID } from 'node:crypto';
import type {
  ChatAttachment,
  ChatMessage,
  ControlMode,
  MediaItem,
  Participant,
  RoomSnapshot,
  SyncState,
} from '@syncroom/shared';
import { LIMITS, expectedTime, parseMediaUrl } from '@syncroom/shared';

export interface Member {
  participant: Participant;
  /** Stable client key — lets a refreshed tab reclaim this identity. */
  key: string;
  /** Live socket id, or null while inside the reconnect grace window. */
  socketId: string | null;
  disconnectedAt: number | null;
}

/**
 * A single in-memory room. The server is authoritative for membership,
 * host powers, playback sync state, the queue and bounded chat history.
 * Nothing is ever persisted — the room dies with its last participant.
 */
export class Room {
  readonly code: string;
  readonly createdAt: number;
  locked = false;
  // Shared control by default: everyone can play/pause/seek and use the
  // watch-together controls. The host can restrict this to host-only via
  // the "Shared controls" switch.
  controlMode: ControlMode = 'everyone';
  hostId: string;
  members = new Map<string, Member>();
  chat: ChatMessage[] = [];
  queue: MediaItem[] = [];
  sync: SyncState = { media: null, playing: false, time: 0, rate: 1, updatedAt: 0, seq: 0 };

  /** Monotonic per-room sequence — lets clients drop stale sync states. */
  private seqCounter = 0;

  private readonly now: () => number;

  constructor(code: string, now: () => number = Date.now) {
    this.code = code;
    this.now = now;
    this.createdAt = now();
    this.hostId = '';
  }

  addMember(name: string, key: string, socketId: string): Member {
    const existing = [...this.members.values()].find((m) => m.key === key);
    if (existing) {
      // Refresh/reconnect: reclaim identity.
      existing.socketId = socketId;
      existing.disconnectedAt = null;
      return existing;
    }
    const id = randomUUID();
    const member: Member = {
      key,
      socketId,
      disconnectedAt: null,
      participant: {
        id,
        name,
        isHost: this.members.size === 0,
        micOn: true,
        cameraOn: true,
        screenSharing: false,
        mirrored: false,
        joinedAt: this.now(),
      },
    };
    this.members.set(id, member);
    if (member.participant.isHost) this.hostId = id;
    return member;
  }

  findByKey(key: string): Member | undefined {
    return [...this.members.values()].find((m) => m.key === key);
  }

  findBySocket(socketId: string): Member | undefined {
    return [...this.members.values()].find((m) => m.socketId === socketId);
  }

  removeMember(id: string): void {
    const wasHost = this.hostId === id;
    this.members.delete(id);
    if (wasHost) this.electNewHost();
  }

  /** Oldest remaining participant becomes host. */
  private electNewHost(): void {
    const remaining = [...this.members.values()].sort(
      (a, b) => a.participant.joinedAt - b.participant.joinedAt,
    );
    const next = remaining[0];
    this.hostId = next ? next.participant.id : '';
    for (const m of this.members.values()) {
      m.participant.isHost = m.participant.id === this.hostId;
    }
  }

  transferHost(toId: string): boolean {
    const target = this.members.get(toId);
    if (!target) return false;
    this.hostId = toId;
    for (const m of this.members.values()) {
      m.participant.isHost = m.participant.id === toId;
    }
    return true;
  }

  isHost(id: string): boolean {
    return this.hostId === id;
  }

  canControlPlayback(id: string): boolean {
    return this.controlMode === 'everyone' || this.isHost(id);
  }

  get connectedCount(): number {
    return [...this.members.values()].filter((m) => m.socketId !== null).length;
  }

  /**
   * Playback state ops — every mutation is stamped with server time, a
   * monotonic sequence number and the origin metadata. Clients use `seq`
   * to drop stale states and `originId`/`eventId` to recognize echoes of
   * their own actions.
   */

  private stamp(patch: Partial<SyncState>, originId?: string, eventId?: string): void {
    this.sync = {
      ...this.sync,
      ...patch,
      seq: ++this.seqCounter,
      updatedAt: this.now(),
      originId,
      eventId,
    };
  }

  setMedia(url: string, addedBy: string, eventId?: string): MediaItem | null {
    const parsed = parseMediaUrl(url);
    if (!parsed) return null;
    const item: MediaItem = {
      id: randomUUID(),
      url: parsed.url,
      kind: parsed.kind,
      title: parsed.title,
      providerId: parsed.providerId,
      addedBy,
    };
    this.stamp({ media: item, playing: false, time: 0, rate: 1 }, addedBy, eventId);
    return item;
  }

  clearMedia(originId?: string): void {
    this.stamp({ media: null, playing: false, time: 0, rate: 1 }, originId);
  }

  play(time: number, originId?: string, eventId?: string): void {
    this.stamp({ playing: true, time }, originId, eventId);
  }

  pause(time: number, originId?: string, eventId?: string): void {
    this.stamp({ playing: false, time }, originId, eventId);
  }

  seek(time: number, originId?: string, eventId?: string): void {
    this.stamp({ time }, originId, eventId);
  }

  setRate(rate: number, originId?: string, eventId?: string): void {
    // Re-anchor time so the rate change doesn't retroactively shift position.
    const t = expectedTime(this.sync, this.now());
    this.stamp({ rate, time: t }, originId, eventId);
  }

  /** Queue ops. */

  queueAdd(url: string, addedBy: string): MediaItem | null {
    if (this.queue.length >= LIMITS.MAX_QUEUE_ITEMS) return null;
    const parsed = parseMediaUrl(url);
    if (!parsed) return null;
    const item: MediaItem = {
      id: randomUUID(),
      url: parsed.url,
      kind: parsed.kind,
      title: parsed.title,
      providerId: parsed.providerId,
      addedBy,
    };
    this.queue.push(item);
    return item;
  }

  queueRemove(itemId: string): boolean {
    const before = this.queue.length;
    this.queue = this.queue.filter((i) => i.id !== itemId);
    return this.queue.length !== before;
  }

  queuePlay(itemId: string, originId?: string): MediaItem | null {
    const item = this.queue.find((i) => i.id === itemId);
    if (!item) return null;
    this.queue = this.queue.filter((i) => i.id !== itemId);
    this.stamp({ media: item, playing: false, time: 0, rate: 1 }, originId);
    return item;
  }

  /** Chat ops — history is bounded; attachments live only in this buffer. */

  addChat(senderId: string, text: string, attachment?: ChatAttachment): ChatMessage | null {
    const sender = this.members.get(senderId);
    if (!sender) return null;
    const msg: ChatMessage = {
      id: randomUUID(),
      senderId,
      senderName: sender.participant.name,
      text,
      attachment,
      ts: this.now(),
      deleted: false,
      readBy: [senderId],
    };
    this.chat.push(msg);
    if (this.chat.length > LIMITS.MAX_CHAT_HISTORY) this.chat.shift();
    return msg;
  }

  deleteChat(messageId: string, requesterId: string): boolean {
    const msg = this.chat.find((m) => m.id === messageId);
    if (!msg || msg.senderId !== requesterId || msg.deleted) return false;
    msg.deleted = true;
    msg.text = '';
    delete msg.attachment;
    return true;
  }

  markRead(readerId: string, messageIds: string[]): string[] {
    const updated: string[] = [];
    for (const id of messageIds) {
      const msg = this.chat.find((m) => m.id === id);
      if (msg && !msg.readBy.includes(readerId)) {
        msg.readBy.push(readerId);
        updated.push(id);
      }
    }
    return updated;
  }

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      locked: this.locked,
      hostId: this.hostId,
      controlMode: this.controlMode,
      participants: [...this.members.values()]
        .filter((m) => m.socketId !== null)
        .map((m) => m.participant),
      sync: this.sync,
      queue: this.queue,
      createdAt: this.createdAt,
    };
  }
}
