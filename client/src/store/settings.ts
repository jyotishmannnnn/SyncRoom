import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'dark' | 'light' | 'system';
export type QualityPreset = '720p' | '1080p' | '1440p' | '2160p';

export interface Settings {
  theme: ThemeMode;
  cameraId: string | null;
  micId: string | null;
  speakerId: string | null;
  quality: QualityPreset;
  frameRate: 30 | 60;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  notifications: boolean;
  /** Mirror the local self-view (like every meeting app). */
  mirrorVideo: boolean;
  /** Enter rooms with the microphone muted. */
  startMicOff: boolean;
  /** Enter rooms with the camera off. */
  startCameraOff: boolean;
  /** Show per-tile and header connection-quality indicators. */
  showStats: boolean;
  /** Disable in-app animations/transitions (on top of the OS setting). */
  reduceMotion: boolean;
}

interface SettingsStore extends Settings {
  update: (patch: Partial<Settings>) => void;
  /** Restore every setting to its factory default. */
  reset: () => void;
}

/** Factory defaults, reused by the "Reset to defaults" action. */
export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  cameraId: null,
  micId: null,
  speakerId: null,
  quality: '1080p',
  frameRate: 60,
  noiseSuppression: true,
  echoCancellation: true,
  notifications: true,
  mirrorVideo: true,
  startMicOff: false,
  startCameraOff: false,
  showStats: true,
  reduceMotion: false,
};

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    { name: 'syncroom:settings' },
  ),
);

/** getUserMedia video constraints for a preset (ideal, browser may downscale). */
export const QUALITY_CONSTRAINTS: Record<QualityPreset, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '2160p': { width: 3840, height: 2160 },
};

/** Encoder bitrate ceilings (bps), generous, favors quality over bandwidth. */
export const QUALITY_MAX_BITRATE: Record<QualityPreset, number> = {
  '720p': 4_000_000,
  '1080p': 8_000_000,
  '1440p': 14_000_000,
  '2160p': 25_000_000,
};
