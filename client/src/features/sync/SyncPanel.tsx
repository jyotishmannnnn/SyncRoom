import { useState, type FormEvent } from 'react';
import { Clapperboard, ListVideo, Play, Plus, Trash2, X } from 'lucide-react';
import { classifyMediaUrl, MEDIA_URL_ERROR_TEXT, PLAYBACK_RATES } from '@syncroom/shared';
import { socket } from '@/lib/socket';
import { canSelfControl, isSelfHost, useRoomStore } from '@/store/room';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';

/**
 * "Watch together" panel: paste a link (YouTube / Google Drive / direct
 * MP4 / HLS / DASH), manage the queue, playback rate and who may control.
 */
export function SyncPanel() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const syncState = useRoomStore((s) => s.syncState);
  const queue = useRoomStore((s) => s.queue);
  const canControl = useRoomStore((s) => canSelfControl(s));
  const isHost = useRoomStore((s) => isSelfHost(s));
  const controlMode = useRoomStore((s) => s.room?.controlMode ?? 'host-only');

  const submit = (e: FormEvent, toQueue: boolean): void => {
    e.preventDefault();
    setError('');
    const classified = classifyMediaUrl(url);
    if (!classified.ok) {
      setError(MEDIA_URL_ERROR_TEXT[classified.reason]);
      return;
    }
    if (toQueue) socket.emit('queue:add', url);
    else socket.emit('sync:set-media', url);
    setUrl('');
  };

  const media = syncState?.media ?? null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <form onSubmit={(e) => submit(e, false)} className="flex flex-col gap-2">
        <Input
          label="Video link"
          placeholder="youtube.com/… or drive.google.com/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={error || undefined}
          hint={canControl ? undefined : 'Only the host can start a video right now.'}
          disabled={!canControl && queue.length === 0}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!canControl || !url.trim()}>
            <Play size={14} /> Play now
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!url.trim()}
            onClick={(e) => submit(e, true)}
          >
            <Plus size={14} /> Add to queue
          </Button>
        </div>
      </form>

      {media && (
        <div className="glass rounded-xl p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 overflow-hidden">
              <Clapperboard size={16} className="shrink-0 text-accent" />
              <p className="truncate text-sm font-medium" title={media.title}>
                {media.title}
              </p>
            </div>
            {canControl && (
              <button
                type="button"
                aria-label="Stop watching"
                className="cursor-pointer rounded-md p-2 text-ink-faint transition-colors hover:text-danger"
                onClick={() => socket.emit('sync:clear')}
              >
                <X size={16} />
              </button>
            )}
          </div>
          {canControl && (
            <div className="mt-3 flex items-center gap-2">
              <label htmlFor="rate" className="text-xs text-ink-faint">
                Speed
              </label>
              <select
                id="rate"
                className="h-8 cursor-pointer rounded-lg border border-line bg-surface-raised px-2 text-sm"
                value={syncState?.rate ?? 1}
                onChange={(e) =>
                  socket.emit('sync:rate', {
                    rate: Number(e.target.value),
                    eventId: crypto.randomUUID(),
                  })
                }
              >
                {PLAYBACK_RATES.map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {isHost && (
        <Switch
          checked={controlMode === 'everyone'}
          onChange={(v) => socket.emit('room:control-mode', v ? 'everyone' : 'host-only')}
          label="Shared controls"
          description="Let everyone play, pause and seek"
        />
      )}

      <div className="flex-1">
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          <ListVideo size={14} /> Up next ({queue.length})
        </h3>
        {queue.length === 0 ? (
          <p className="text-sm text-ink-faint">
            Queue is empty. Anyone can add links;{' '}
            {controlMode === 'everyone' ? 'anyone' : 'the host'} plays them.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {queue.map((item) => (
              <li
                key={item.id}
                className="group flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2"
              >
                <p className="truncate text-sm" title={item.title}>
                  {item.title}
                </p>
                {canControl && (
                  <span className="flex shrink-0 gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label={`Play ${item.title}`}
                      className="cursor-pointer rounded-md p-2 text-ink-dim transition-colors hover:text-accent"
                      onClick={() => socket.emit('queue:play', item.id)}
                    >
                      <Play size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${item.title}`}
                      className="cursor-pointer rounded-md p-2 text-ink-dim transition-colors hover:text-danger"
                      onClick={() => socket.emit('queue:remove', item.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
