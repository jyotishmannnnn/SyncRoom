import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Paperclip, SendHorizonal, Smile } from 'lucide-react';
import { LIMITS } from '@syncroom/shared';
import { socket } from '@/lib/socket';
import { useRoomStore } from '@/store/room';
import { formatBytes, readFileAsDataUrl } from '@/lib/utils';
import { MessageBubble } from './MessageBubble';

const EMOJI = [
  '😀',
  '😂',
  '😍',
  '🥳',
  '😎',
  '🤯',
  '😭',
  '😅',
  '👍',
  '👎',
  '👏',
  '🙌',
  '🔥',
  '❤️',
  '💯',
  '✨',
  '🎬',
  '🍿',
  '🎉',
  '😴',
  '🤔',
  '👀',
  '💀',
  '🫡',
];

export function ChatPanel() {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const chat = useRoomStore((s) => s.chat);
  const typing = useRoomStore((s) => s.typing);
  const selfId = useRoomStore((s) => s.selfId);
  const participants = useRoomStore((s) => s.room?.participants ?? []);
  const toast = useRoomStore((s) => s.toast);
  const listRef = useRef<HTMLDivElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Auto-scroll on new messages; mark visible messages read exactly once. */
  const sentReads = useRef<Set<string>>(new Set());
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    if (!selfId) return;
    const unread = chat
      .filter((m) => !m.readBy.includes(selfId) && !sentReads.current.has(m.id))
      .map((m) => m.id);
    if (unread.length > 0) {
      unread.forEach((id) => sentReads.current.add(id));
      socket.emit('chat:read', unread);
      // Optimistic local update, the server only echoes reads to others.
      useRoomStore.getState().markRead(selfId, unread);
    }
  }, [chat, selfId]);

  /* Typing indicator: emit only on the idle→typing transition (one event),
     plus a single "stopped" event after 2s of silence, not per keystroke. */
  const typingActive = useRef(false);
  useEffect(
    () => () => {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
    },
    [],
  );
  const emitTyping = useCallback((): void => {
    if (!typingActive.current) {
      typingActive.current = true;
      socket.emit('chat:typing', true);
    }
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      typingActive.current = false;
      socket.emit('chat:typing', false);
    }, 2000);
  }, []);

  const attachFile = useCallback(
    (file: File): void => {
      if (file.size > LIMITS.MAX_ATTACHMENT_BYTES) {
        toast('error', `File too large, max ${formatBytes(LIMITS.MAX_ATTACHMENT_BYTES)}.`);
        return;
      }
      setPendingFile(file);
    },
    [toast],
  );

  const send = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const body = text.trim();
    if (!body && !pendingFile) return;
    let attachment;
    if (pendingFile) {
      try {
        attachment = {
          name: pendingFile.name,
          size: pendingFile.size,
          mimeType: pendingFile.type || 'application/octet-stream',
          dataUrl: await readFileAsDataUrl(pendingFile),
        };
      } catch {
        toast('error', 'Could not read that file.');
        return;
      }
    }
    socket.emit('chat:send', { text: body, attachment });
    setText('');
    setPendingFile(null);
    setShowEmoji(false);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    if (typingActive.current) {
      typingActive.current = false;
      socket.emit('chat:typing', false);
    }
  };

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) attachFile(file);
  };

  const typingNames = participants
    .filter((p) => p.id !== selfId && typing[p.id])
    .map((p) => p.name);

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10 text-sm font-medium text-accent">
          Drop to share
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto p-4">
        {chat.length === 0 ? (
          <p className="mt-8 text-center text-sm text-ink-faint">
            No messages yet. Say hi, or drop a file anywhere in this panel.
          </p>
        ) : (
          chat.map((m) => (
            <MessageBubble key={m.id} message={m} participantCount={participants.length} />
          ))
        )}
      </div>

      <div className="h-5 px-4 text-xs text-ink-faint" aria-live="polite">
        {typingNames.length > 0 && (
          <span className="animate-pulse-soft">
            {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…
          </span>
        )}
      </div>

      {pendingFile && (
        <div className="mx-4 mb-2 flex items-center justify-between rounded-lg border border-line bg-surface-raised px-3 py-2 text-xs">
          <span className="truncate">
            {pendingFile.name} · {formatBytes(pendingFile.size)}
          </span>
          <button
            type="button"
            className="shrink-0 cursor-pointer rounded p-2 font-medium text-danger"
            onClick={() => setPendingFile(null)}
          >
            Remove
          </button>
        </div>
      )}

      {showEmoji && (
        <div className="glass mx-4 mb-2 grid grid-cols-6 gap-1 rounded-xl p-2 animate-scale-in sm:grid-cols-8">
          {EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={`Insert ${e}`}
              className="cursor-pointer rounded-lg p-1.5 text-lg transition-transform hover:scale-125"
              onClick={() => setText((t) => t + e)}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => void send(e)}
        className="flex items-center gap-2 border-t border-line p-3 min-w-0"
      >
        <button
          type="button"
          aria-label="Attach file"
          className="cursor-pointer rounded-full p-2.5 text-ink-dim transition-colors hover:bg-surface-overlay hover:text-ink"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip size={18} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) attachFile(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          aria-label="Emoji picker"
          aria-expanded={showEmoji}
          className="cursor-pointer rounded-full p-2.5 text-ink-dim transition-colors hover:bg-surface-overlay hover:text-ink"
          onClick={() => setShowEmoji((v) => !v)}
        >
          <Smile size={18} />
        </button>
        <input
          aria-label="Chat message"
          className="h-10 min-w-0 flex-1 rounded-full border border-line bg-surface-raised px-4 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none"
          placeholder="Message everyone"
          value={text}
          maxLength={LIMITS.MAX_CHAT_LENGTH}
          onChange={(e) => {
            setText(e.target.value);
            emitTyping();
          }}
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={!text.trim() && !pendingFile}
          className="shrink-0 cursor-pointer rounded-full bg-accent p-2.5 text-onaccent transition-all hover:bg-accent-hover active:scale-95 disabled:opacity-40"
        >
          <SendHorizonal size={18} />
        </button>
      </form>
    </div>
  );
}
