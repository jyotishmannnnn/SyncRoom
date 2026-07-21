import { useState } from 'react';
import { Smile } from 'lucide-react';
import { socket } from '@/lib/socket';
import { IconButton } from '@/components/ui/IconButton';

const REACTIONS = [
  '👍',
  '❤️',
  '😂',
  '😮',
  '👏',
  '🎉',
  '😢',
  '😍',
] as const;

interface ReactionPickerProps {
  /**
   * When true, the picker is positioned above the entire CinemaBar.
   * When false, it is positioned above the reaction button in the
   * normal room controls.
   */
  fullscreen?: boolean;
}

export function ReactionPicker({
  fullscreen = false,
}: ReactionPickerProps) {
  const [open, setOpen] = useState(false);

  const sendReaction = (emoji: string): void => {
    socket.emit('reaction:send', emoji);
    setOpen(false);
  };

  return (
    <div className="relative overflow-visible">
      <IconButton
        label="Send reaction"
        active={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Smile size={19} />
      </IconButton>

      {open && (
        <div
          className={
            fullscreen
              ? 'absolute bottom-[calc(100%+0.75rem)] left-1/2 z-[200] flex -translate-x-1/2 gap-1 whitespace-nowrap rounded-2xl border border-line bg-surface p-2 shadow-2xl'
              : 'absolute bottom-[calc(100%+0.75rem)] left-1/2 z-[200] flex -translate-x-1/2 gap-1 whitespace-nowrap rounded-2xl border border-line bg-surface p-2 shadow-2xl'
          }
        >
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`Send ${emoji} reaction`}
              onClick={() => sendReaction(emoji)}
              className="
                flex
                h-9
                w-9
                cursor-pointer
                items-center
                justify-center
                rounded-xl
                text-xl
                transition-transform
                hover:scale-125
                hover:bg-surface-overlay
              "
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}