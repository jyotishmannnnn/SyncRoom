import type { MediaItem } from '@syncroom/shared';

export type PlayerEvent =
  | { type: 'ready' }
  | { type: 'play'; time: number }
  | { type: 'pause'; time: number }
  | { type: 'seek'; time: number }
  | { type: 'rate'; rate: number }
  | { type: 'ended' }
  | { type: 'autoplay-blocked' }
  | { type: 'error'; message: string };

export type PlaybackState = 'unstarted' | 'playing' | 'paused' | 'buffering' | 'ended';

/**
 * Uniform facade over every media provider (YouTube IFrame, HTML5 <video>
 * incl. hls.js/dash.js, Drive preview iframe). The SyncController drives
 * adapters purely through this interface, it never knows which provider is
 * behind it. Adding a provider = implementing this interface.
 *
 * Capability probes (`canSync/canSeek/canSetRate`) let the controller degrade
 * gracefully: a provider that exposes no playback API (Drive preview iframe)
 * reports canSync() === false and is simply left alone; a live HLS stream
 * reports canSeek() === false and never receives seek commands.
 */
export interface PlayerAdapter {
  load(item: MediaItem, container: HTMLElement, controls: boolean): Promise<void>;
  play(): void;
  pause(): void;
  seek(time: number): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlaybackRate(): number;
  getState(): PlaybackState;
  /** Whether playback can be observed AND driven programmatically at all. */
  canSync(): boolean;
  canSeek(): boolean;
  canSetRate(): boolean;
  /** Local audio control, never synchronized (each viewer owns their volume). */
  setVolume(volume: number): void; // 0..1
  getVolume(): number;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Toggle the provider's built-in control chrome (cinema bar takes over). */
  setNativeControls(visible: boolean): void;
  isReady(): boolean;
  onEvent(cb: (ev: PlayerEvent) => void): void;
  destroy(): void;
}
