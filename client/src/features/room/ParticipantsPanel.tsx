import { useState } from 'react';
import { Crown, Lock, LockOpen, MicOff, MoreVertical, UserX } from 'lucide-react';
import type { Participant } from '@syncroom/shared';
import { socket } from '@/lib/socket';
import { isSelfHost, useRoomStore } from '@/store/room';
import { Button } from '@/components/ui/Button';
import { initials } from '@/lib/utils';

function ParticipantRow({
  p,
  isSelf,
  amHost,
}: {
  p: Participant;
  isSelf: boolean;
  amHost: boolean;
}) {
  const [menu, setMenu] = useState(false);
  // Everyone can remove another member; only the host can remove the host.
  const canRemove = !isSelf && (amHost || !p.isHost);
  // The menu exists if there is at least one action available on this row.
  const showMenu = !isSelf && (amHost || canRemove);
  return (
    <li className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-overlay">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
        {initials(p.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">
            {p.name}
            {isSelf && ' (you)'}
          </span>
          {p.isHost && (
            <span className="flex items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
              <Crown size={10} /> Host
            </span>
          )}
        </span>
        <span className="block text-xs text-ink-faint">
          {p.screenSharing ? 'Presenting' : p.cameraOn ? 'Camera on' : 'Camera off'}
        </span>
      </span>
      {!p.micOn && <MicOff size={15} className="shrink-0 text-danger" aria-label="Muted" />}
      {showMenu && (
        <span className="relative">
          <button
            type="button"
            aria-label={`Actions for ${p.name}`}
            aria-expanded={menu}
            className="cursor-pointer rounded-lg p-2.5 text-ink-dim transition-colors hover:bg-line/60 hover:text-ink"
            onClick={() => setMenu((v) => !v)}
          >
            <MoreVertical size={16} />
          </button>
          {menu && (
            <span className="glass absolute right-0 top-9 z-20 flex w-44 flex-col rounded-xl p-1 shadow-xl animate-scale-in">
              {amHost && (
                <button
                  type="button"
                  className="cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-surface-overlay"
                  onClick={() => {
                    socket.emit('room:force-mute', p.id);
                    setMenu(false);
                  }}
                >
                  Mute
                </button>
              )}
              {amHost && (
                <button
                  type="button"
                  className="cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-surface-overlay"
                  onClick={() => {
                    socket.emit('room:transfer-host', p.id);
                    setMenu(false);
                  }}
                >
                  Make host
                </button>
              )}
              {canRemove && (
                <button
                  type="button"
                  className="cursor-pointer rounded-lg px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10"
                  onClick={() => {
                    socket.emit('room:kick', p.id);
                    setMenu(false);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <UserX size={14} /> Remove
                  </span>
                </button>
              )}
            </span>
          )}
        </span>
      )}
    </li>
  );
}

export function ParticipantsPanel() {
  const room = useRoomStore((s) => s.room);
  const selfId = useRoomStore((s) => s.selfId);
  const amHost = useRoomStore((s) => isSelfHost(s));
  const [confirmEnd, setConfirmEnd] = useState(false);
  if (!room) return null;

  return (
    <div className="flex h-full flex-col p-4">
      <ul className="flex-1 overflow-y-auto">
        {room.participants.map((p) => (
          <ParticipantRow key={p.id} p={p} isSelf={p.id === selfId} amHost={amHost} />
        ))}
      </ul>

      {amHost && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => socket.emit('room:lock', !room.locked)}
          >
            {room.locked ? <LockOpen size={14} /> : <Lock size={14} />}
            {room.locked ? 'Unlock room' : 'Lock room'}
          </Button>
          {confirmEnd ? (
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                className="flex-1"
                onClick={() => socket.emit('room:end')}
              >
                End for everyone
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmEnd(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="danger" size="sm" onClick={() => setConfirmEnd(true)}>
              End meeting for everyone
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
