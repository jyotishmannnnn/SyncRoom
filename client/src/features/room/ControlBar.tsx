import {
  Camera,
  CameraOff,
  FlipHorizontal2,
  Maximize,
  MessageSquare,
  Mic,
  MicOff,
  Minimize,
  MonitorUp,
  PhoneOff,
  Tv,
  Users,
} from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { useRoomStore } from '@/store/room';
import { useSettings } from '@/store/settings';
import { cn } from '@/lib/utils';
import { ReactionPicker } from './ReactionPicker';

export interface ControlBarProps {
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleShare: () => void;
  onLeave: () => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
}

export function ControlBar({
  onToggleMic,
  onToggleCamera,
  onToggleShare,
  onLeave,
  onToggleFullscreen,
  isFullscreen,
}: ControlBarProps) {
  const micOn = useRoomStore((s) => s.micOn);
  const cameraOn = useRoomStore((s) => s.cameraOn);
  const sharing = useRoomStore((s) => s.sharing);
  const mirrorVideo = useSettings((s) => s.mirrorVideo);
const updateSettings = useSettings((s) => s.update);
  const panel = useRoomStore((s) => s.panel);
  const setPanel = useRoomStore((s) => s.setPanel);
  const unread = useRoomStore((s) => s.unreadChat);

  const togglePanel = (kind: 'chat' | 'people' | 'media'): void =>
    setPanel(panel === kind ? null : kind);

  return (
    <div className="glass mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1.5 rounded-2xl px-2 py-2 shadow-2xl animate-slide-up sm:gap-2 sm:px-3">
      <IconButton
        label={micOn ? 'Mute microphone (M)' : 'Unmute microphone (M)'}
        danger={!micOn}
        onClick={onToggleMic}
      >
        {micOn ? <Mic size={19} /> : <MicOff size={19} />}
      </IconButton>
      <IconButton
        label={cameraOn ? 'Turn camera off (V)' : 'Turn camera on (V)'}
        danger={!cameraOn}
        onClick={onToggleCamera}
      >
        {cameraOn ? <Camera size={19} /> : <CameraOff size={19} />}
      </IconButton>
      <IconButton
        label={mirrorVideo ? 'Unflip camera for everyone' : 'Flip camera for everyone'}
        active={mirrorVideo}
        onClick={() => updateSettings({ mirrorVideo: !mirrorVideo })}
      >
        <FlipHorizontal2 size={19} />
      </IconButton>

      <ReactionPicker />

      <IconButton
        label={sharing ? 'Stop sharing screen (S)' : 'Share screen (S)'}
        active={sharing}
        onClick={onToggleShare}
      >
        <MonitorUp size={19} />
      </IconButton>

      <span className="mx-1 h-7 w-px bg-line" aria-hidden />

      <span className="relative">
        <IconButton label="Chat (C)" active={panel === 'chat'} onClick={() => togglePanel('chat')}>
          <MessageSquare size={19} />
        </IconButton>
        {unread > 0 && (
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center',
              'rounded-full bg-danger px-1 text-[10px] font-bold text-white',
            )}
            aria-label={`${unread} unread messages`}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </span>
      <IconButton
        label="People (P)"
        active={panel === 'people'}
        onClick={() => togglePanel('people')}
      >
        <Users size={19} />
      </IconButton>
      <IconButton
        label="Watch together (W)"
        active={panel === 'media'}
        onClick={() => togglePanel('media')}
      >
        <Tv size={19} />
      </IconButton>
      <IconButton
        label={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
        onClick={onToggleFullscreen}
      >
        {isFullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
      </IconButton>

      <span className="mx-1 h-7 w-px bg-line" aria-hidden />

      <IconButton label="Leave call" danger onClick={onLeave} className="w-14">
        <PhoneOff size={19} />
      </IconButton>
    </div>
  );
}
