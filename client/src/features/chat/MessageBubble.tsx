import { useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, Copy, Download, Trash2 } from 'lucide-react';
import type { ChatMessage } from '@syncroom/shared';
import { socket } from '@/lib/socket';
import { useRoomStore } from '@/store/room';
import { cn, formatBytes, formatClock } from '@/lib/utils';

export function MessageBubble({
  message,
  participantCount,
}: {
  message: ChatMessage;
  participantCount: number;
}) {
  const selfId = useRoomStore((s) => s.selfId);
  const toast = useRoomStore((s) => s.toast);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );
  const mine = message.senderId === selfId;
  const readByAll = participantCount > 1 && message.readBy.length >= participantCount;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('error', 'Clipboard unavailable.');
    }
  };

  const isImage = message.attachment?.mimeType.startsWith('image/');

  return (
    <div className={cn('group mb-3 flex flex-col', mine ? 'items-end' : 'items-start')}>
      <div className="mb-0.5 flex items-baseline gap-2 px-1 text-xs text-ink-faint">
        <span className="font-medium text-ink-dim">{mine ? 'You' : message.senderName}</span>
        <time>{formatClock(message.ts)}</time>
      </div>

      <div
        className={cn(
          'relative max-w-[85%] rounded-2xl px-3.5 py-2 text-sm',
          mine ? 'rounded-br-md bg-accent text-onaccent' : 'rounded-bl-md bg-surface-overlay',
        )}
      >
        {message.deleted ? (
          <em className={cn('text-xs', mine ? 'text-onaccent/70' : 'text-ink-faint')}>
            Message deleted
          </em>
        ) : (
          <>
            {message.attachment &&
              (isImage ? (
                <img
                  src={message.attachment.dataUrl}
                  alt={message.attachment.name}
                  className="mb-1 max-h-64 rounded-lg"
                  loading="lazy"
                />
              ) : (
                <a
                  href={message.attachment.dataUrl}
                  download={message.attachment.name}
                  className={cn(
                    'mb-1 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs',
                    mine ? 'border-onaccent/30' : 'border-line',
                  )}
                >
                  <Download size={14} />
                  <span className="truncate">{message.attachment.name}</span>
                  <span className="shrink-0 opacity-70">
                    {formatBytes(message.attachment.size)}
                  </span>
                </a>
              ))}
            {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
          </>
        )}
      </div>

      {!message.deleted && (
        <div className="mt-0.5 flex items-center gap-1 px-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          {message.text && (
            <button
              type="button"
              aria-label="Copy message"
              className="cursor-pointer rounded p-2 text-ink-faint transition-colors hover:text-ink"
              onClick={() => void copy()}
            >
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            </button>
          )}
          {mine && (
            <button
              type="button"
              aria-label="Delete message"
              className="cursor-pointer rounded p-2 text-ink-faint transition-colors hover:text-danger"
              onClick={() => socket.emit('chat:delete', message.id)}
            >
              <Trash2 size={13} />
            </button>
          )}
          {mine && (
            <span
              className="flex items-center text-ink-faint"
              title={readByAll ? 'Read by everyone' : 'Delivered'}
            >
              {readByAll ? <CheckCheck size={13} className="text-accent" /> : <Check size={13} />}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
