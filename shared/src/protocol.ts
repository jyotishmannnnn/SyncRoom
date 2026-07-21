import type {
  ChatMessage,
  ControlMode,
  JoinRequest,
  JoinResult,
  MediaItem,
  RoomReaction,
  RoomSnapshot,
  SignalPayload,
  SyncState,
} from './types';

/**
 * Sync commands carry the metadata required to prevent feedback loops:
 * the client-generated `eventId` travels through the server and comes back
 * inside the stamped SyncState, so an emitter can recognize its own action.
 * The sender id and timestamp are stamped server-side (never trusted).
 */
export interface SyncTimeCommand {
  time: number;
  eventId?: string;
}

export interface SyncRateCommand {
  rate: number;
  eventId?: string;
}

/** Events the client emits to the server. */
export interface ClientToServerEvents {
  'room:join': (req: JoinRequest, ack: (res: JoinResult) => void) => void;
  'reaction:send': (emoji: string) => void;
  'room:leave': () => void;
  'room:lock': (locked: boolean) => void;
  'room:kick': (participantId: string) => void;
  'room:force-mute': (participantId: string) => void;
  'room:transfer-host': (participantId: string) => void;
  'room:end': () => void;
  'room:control-mode': (mode: ControlMode) => void;
  'presence:update': (flags: {
    micOn?: boolean;
    cameraOn?: boolean;
    screenSharing?: boolean;
    mirrored?: boolean;
  }) => void;

  signal: (payload: SignalPayload) => void;

  'chat:send': (msg: { text: string; attachment?: ChatMessage['attachment'] }) => void;
  'chat:delete': (messageId: string) => void;
  'chat:typing': (typing: boolean) => void;
  'chat:read': (messageIds: string[]) => void;

  'sync:set-media': (url: string) => void;
  'sync:clear': () => void;
  'sync:play': (cmd: SyncTimeCommand) => void;
  'sync:pause': (cmd: SyncTimeCommand) => void;
  'sync:seek': (cmd: SyncTimeCommand) => void;
  'sync:rate': (cmd: SyncRateCommand) => void;

  'queue:add': (url: string) => void;
  'queue:remove': (itemId: string) => void;
  'queue:play': (itemId: string) => void;

  'time:ping': (clientSent: number, ack: (serverNow: number) => void) => void;
}

/** Events the server emits to clients. */
export interface ServerToClientEvents {
  'room:state': (room: RoomSnapshot) => void;
  'room:ended': () => void;
  'room:kicked': () => void;
  'room:force-muted': () => void;
  'reaction:show': (reaction: RoomReaction) => void;

  signal: (payload: SignalPayload) => void;

  'chat:message': (msg: ChatMessage) => void;
  'chat:deleted': (messageId: string) => void;
  'chat:typing': (participantId: string, typing: boolean) => void;
  'chat:read': (participantId: string, messageIds: string[]) => void;

  'sync:state': (state: SyncState) => void;
  'queue:state': (queue: MediaItem[]) => void;

  error: (message: string) => void;
}
