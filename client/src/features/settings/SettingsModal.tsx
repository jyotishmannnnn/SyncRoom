import { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { useMediaDevices } from '@/features/call/useMediaDevices';
import { SHORTCUT_HELP } from '@/hooks/useKeyboardShortcuts';
import { useSettings, type QualityPreset, type ThemeMode } from '@/store/settings';

/** Output-device selection is only possible where the browser exposes setSinkId. */
const CAN_SET_SINK =
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Switches a single camera/mic device on the live call. */
  onDeviceChange?: (kind: 'camera' | 'microphone', deviceId: string) => void;
  /**
   * Re-acquires local media so resolution / frame-rate / audio-processing
   * changes apply to the live call immediately (they're read from settings at
   * capture time). Called after those change and after Reset.
   */
  onReacquire?: () => void;
}

export function SettingsModal({ open, onClose, onDeviceChange, onReacquire }: SettingsModalProps) {
  const settings = useSettings();
  const { cameras, microphones, speakers, refresh } = useMediaDevices();

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Always offer an explicit "Automatic" choice (value ''), so the controlled
  // <select> value always matches an option — otherwise a single-device machine
  // (or a stale/absent stored id) leaves the select on a value no option has,
  // and picking the only shown device fires no change event. Pre-permission
  // placeholder entries (empty deviceId) are dropped so they don't collide.
  const deviceOptions = (list: MediaDeviceInfo[], fallback: string) => [
    { value: '', label: `Automatic (default ${fallback.toLowerCase()})` },
    ...list
      .filter((d) => d.deviceId)
      .map((d, i) => ({ value: d.deviceId, label: d.label || `${fallback} ${i + 1}` })),
  ];

  // Reconcile a stored id against what's actually present; fall back to
  // Automatic ('') when the device is gone or nothing was ever chosen.
  const resolveDevice = (id: string | null, list: MediaDeviceInfo[]) =>
    id && list.some((d) => d.deviceId === id) ? id : '';

  return (
    <Modal open={open} onClose={onClose} title="Settings" wide>
      <div className="grid max-h-[70vh] gap-6 overflow-y-auto pr-1 sm:grid-cols-2">
        <section className="flex flex-col gap-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Appearance
          </h3>
          <Select
            label="Theme"
            value={settings.theme}
            onChange={(e) => settings.update({ theme: e.target.value as ThemeMode })}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'Follow system' },
            ]}
          />
          <Switch
            checked={settings.reduceMotion}
            onChange={(v) => settings.update({ reduceMotion: v })}
            label="Reduce motion"
            description="Turn off animations and transitions"
          />

          <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Devices
          </h3>
          <Select
            label="Camera"
            value={resolveDevice(settings.cameraId, cameras)}
            onChange={(e) => {
              const id = e.target.value || null;
              settings.update({ cameraId: id });
              // A concrete device swaps just that track; Automatic re-captures
              // with the browser default so the choice actually takes effect.
              if (id) onDeviceChange?.('camera', id);
              else onReacquire?.();
            }}
            options={deviceOptions(cameras, 'Camera')}
          />
          <Select
            label="Microphone"
            value={resolveDevice(settings.micId, microphones)}
            onChange={(e) => {
              const id = e.target.value || null;
              settings.update({ micId: id });
              if (id) onDeviceChange?.('microphone', id);
              else onReacquire?.();
            }}
            options={deviceOptions(microphones, 'Microphone')}
          />
          <Select
            label="Speaker"
            value={resolveDevice(settings.speakerId, speakers)}
            onChange={(e) => settings.update({ speakerId: e.target.value || null })}
            options={deviceOptions(speakers, 'Speaker')}
            disabled={!CAN_SET_SINK}
          />
          {!CAN_SET_SINK && (
            <p className="-mt-2 text-xs text-ink-faint">
              This browser can’t switch audio output — it uses your system default.
            </p>
          )}

          <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Video quality
          </h3>
          <Select
            label="Resolution (upper bound)"
            value={settings.quality}
            onChange={(e) => {
              settings.update({ quality: e.target.value as QualityPreset });
              onReacquire?.();
            }}
            options={[
              { value: '720p', label: '720p — light on bandwidth' },
              { value: '1080p', label: '1080p — recommended' },
              { value: '1440p', label: '1440p — high' },
              { value: '2160p', label: '4K — maximum (needs strong upload)' },
            ]}
          />
          <Select
            label="Frame rate"
            value={String(settings.frameRate)}
            onChange={(e) => {
              settings.update({ frameRate: Number(e.target.value) as 30 | 60 });
              onReacquire?.();
            }}
            options={[
              { value: '30', label: '30 fps' },
              { value: '60', label: '60 fps — smooth motion' },
            ]}
          />
          <p className="text-xs text-ink-faint">
            Resolution and frame-rate apply live; your camera briefly re-initializes.
          </p>
        </section>

        <section className="flex flex-col gap-1">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Audio processing
          </h3>
          <Switch
            checked={settings.noiseSuppression}
            onChange={(v) => {
              settings.update({ noiseSuppression: v });
              onReacquire?.();
            }}
            label="Noise suppression"
            description="Filters keyboard, fans and background noise"
          />
          <Switch
            checked={settings.echoCancellation}
            onChange={(v) => {
              settings.update({ echoCancellation: v });
              onReacquire?.();
            }}
            label="Echo cancellation"
            description="Prevents your speakers feeding back into your mic"
          />

          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Call preferences
          </h3>
          <Switch
            checked={settings.mirrorVideo}
            onChange={(v) => settings.update({ mirrorVideo: v })}
            label="Mirror my video"
            description="Flip your video horizontally for everyone in the call"
          />
          <Switch
            checked={settings.startMicOff}
            onChange={(v) => settings.update({ startMicOff: v })}
            label="Join with microphone off"
            description="Start muted every time you enter a room"
          />
          <Switch
            checked={settings.startCameraOff}
            onChange={(v) => settings.update({ startCameraOff: v })}
            label="Join with camera off"
            description="Start with your camera turned off"
          />
          <Switch
            checked={settings.showStats}
            onChange={(v) => settings.update({ showStats: v })}
            label="Show connection stats"
            description="Display link quality and bitrate indicators"
          />

          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Notifications
          </h3>
          <Switch
            checked={settings.notifications}
            onChange={(v) => {
              settings.update({ notifications: v });
              if (v && 'Notification' in window && Notification.permission === 'default') {
                void Notification.requestPermission();
              }
            }}
            label="Chat notifications"
            description="Desktop notification for new messages while the tab is hidden"
          />

          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Keyboard shortcuts
          </h3>
          <ul className="flex flex-col gap-1 text-sm">
            {SHORTCUT_HELP.map((s) => (
              <li key={s.keys} className="flex items-center justify-between">
                <span className="text-ink-dim">{s.action}</span>
                <kbd className="rounded-md border border-line bg-surface-overlay px-2 py-0.5 font-mono text-xs">
                  {s.keys}
                </kbd>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-xs text-ink-faint">Settings are saved on this device.</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            settings.reset();
            onReacquire?.();
          }}
        >
          <RotateCcw size={14} /> Reset to defaults
        </Button>
      </div>
    </Modal>
  );
}
