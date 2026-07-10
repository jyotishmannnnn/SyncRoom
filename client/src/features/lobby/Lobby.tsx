import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CameraOff, Loader2, Mic, MicOff, Video } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { VideoBackground } from '@/components/VideoBackground';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useMediaDevices } from '@/features/call/useMediaDevices';
import type { LocalMedia } from '@/features/call/useLocalMedia';
import { getSavedName } from '@/lib/session';
import { useSettings } from '@/store/settings';
import { useRoomStore } from '@/store/room';
import { cn } from '@/lib/utils';

const MEDIA_ERROR_TEXT: Record<string, string> = {
  denied: 'Camera/microphone permission denied. You can still join and listen.',
  'not-found': 'No camera found, joining with microphone only.',
  'in-use': 'Your camera is in use by another app, joining with microphone only.',
  unknown: 'Could not start your devices. You can still join.',
};

export function Lobby({
  code,
  local,
  joining,
  joinError,
  autoJoin,
  onJoin,
}: {
  code: string;
  local: LocalMedia;
  joining: boolean;
  joinError: string;
  autoJoin: boolean;
  onJoin: (name: string) => void;
}) {
  const [name, setName] = useState(getSavedName());
  const [nameError, setNameError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const { cameras, microphones } = useMediaDevices();
  const settings = useSettings();
  const micOn = useRoomStore((s) => s.micOn);
  const cameraOn = useRoomStore((s) => s.cameraOn);
  const setMedia = useRoomStore((s) => s.setMedia);
  const autoJoined = useRef(false);

  /* Acquire the preview once on mount. */
  useEffect(() => {
    void local.acquire().then(() => {
      if (autoJoin && !autoJoined.current && getSavedName()) {
        autoJoined.current = true;
        onJoin(getSavedName());
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (el && el.srcObject !== local.stream) el.srcObject = local.stream;
  }, [local.stream]);

  useEffect(() => {
    local.setTrackEnabled('audio', micOn);
    local.setTrackEnabled('video', cameraOn);
  }, [micOn, cameraOn, local]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Enter a name so people know who you are.');
      return;
    }
    onJoin(name.trim());
  };

  const deviceOptions = (list: MediaDeviceInfo[], fallback: string) =>
    list.length > 0
      ? list.map((d, i) => ({ value: d.deviceId, label: d.label || `${fallback} ${i + 1}` }))
      : [{ value: '', label: `Default ${fallback.toLowerCase()}` }];

  return (
    <div className="flex min-h-dvh justify-center overflow-y-auto p-4">
      <VideoBackground />
      <div className="my-auto grid w-full max-w-4xl gap-6 py-4 lg:grid-cols-[3fr_2fr]">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-surface-overlay shadow-2xl ring-1 ring-line animate-scale-in">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn(
              'h-full w-full object-cover',
              settings.mirrorVideo && 'mirror',
              !cameraOn && 'invisible',
            )}
          />
          {!cameraOn && (
            <div className="absolute inset-0 flex items-center justify-center text-ink-faint">
              <CameraOff size={40} />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 bg-gradient-to-t from-black/60 to-transparent p-4">
            <button
              type="button"
              aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
              onClick={() => setMedia({ micOn: !micOn })}
              className={cn(
                'flex h-11 w-11 cursor-pointer items-center justify-center rounded-full transition-all active:scale-95',
                micOn ? 'bg-white/20 text-white backdrop-blur' : 'bg-danger text-white',
              )}
            >
              {micOn ? <Mic size={18} /> : <MicOff size={18} />}
            </button>
            <button
              type="button"
              aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
              onClick={() => setMedia({ cameraOn: !cameraOn })}
              className={cn(
                'flex h-11 w-11 cursor-pointer items-center justify-center rounded-full transition-all active:scale-95',
                cameraOn ? 'bg-white/20 text-white backdrop-blur' : 'bg-danger text-white',
              )}
            >
              {cameraOn ? <Camera size={18} /> : <CameraOff size={18} />}
            </button>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="glass flex flex-col gap-4 rounded-2xl p-6 animate-slide-up"
        >
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-onaccent">
              <Video size={16} />
            </span>
            Ready to join?
          </h1>
          <p className="font-mono text-sm text-ink-dim">{code}</p>

          {local.error && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              {MEDIA_ERROR_TEXT[local.error]}
            </p>
          )}
          {joinError && (
            <p
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {joinError}
            </p>
          )}

          <Input
            label="Your name"
            value={name}
            maxLength={40}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              setNameError('');
            }}
            error={nameError || undefined}
          />
          <Select
            label="Camera"
            value={settings.cameraId ?? ''}
            onChange={(e) => {
              settings.update({ cameraId: e.target.value || null });
              if (e.target.value) void local.switchCamera(e.target.value);
            }}
            options={deviceOptions(cameras, 'Camera')}
          />
          <Select
            label="Microphone"
            value={settings.micId ?? ''}
            onChange={(e) => {
              settings.update({ micId: e.target.value || null });
              if (e.target.value) void local.switchMicrophone(e.target.value);
            }}
            options={deviceOptions(microphones, 'Microphone')}
          />

          <Button type="submit" size="lg" disabled={joining} className="mt-2">
            {joining ? <Loader2 size={16} className="animate-spin" /> : null}
            {joining ? 'Joining…' : 'Join now'}
          </Button>
        </form>
      </div>
    </div>
  );
}
