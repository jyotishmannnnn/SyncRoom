import type { MediaItem } from '@syncroom/shared';
import { driveEmbedUrl } from '@syncroom/shared';
import type { PlaybackState, PlayerAdapter, PlayerEvent } from './types';

/**
 * Google Drive preview iframe — the graceful degradation target when Drive
 * refuses direct streaming (virus-scan interstitial, quota, size).
 *
 * Drive's embedded player exposes NO playback API (no postMessage protocol,
 * no events, cross-origin frame), so nothing can be observed or driven:
 * `canSync()` is false and the SyncController leaves this player alone.
 * Each viewer controls their own playback; the UI shows one clear banner
 * explaining that limitation.
 */
export class DriveEmbedAdapter implements PlayerAdapter {
  private cb: ((ev: PlayerEvent) => void) | null = null;
  private ready = false;

  load(item: MediaItem, container: HTMLElement): Promise<void> {
    const iframe = document.createElement('iframe');
    iframe.src = driveEmbedUrl(item.providerId ?? '');
    iframe.className = 'h-full w-full border-0';
    iframe.allow = 'autoplay; fullscreen';
    iframe.title = 'Google Drive player';
    container.replaceChildren(iframe);
    this.ready = true;
    this.cb?.({ type: 'ready' });
    return Promise.resolve();
  }

  /* No playback API exists — every control is a deliberate no-op. */
  play(): void {}
  pause(): void {}
  seek(_time: number): void {}
  setPlaybackRate(_rate: number): void {}
  getCurrentTime(): number {
    return 0;
  }
  getDuration(): number {
    return 0;
  }
  getPlaybackRate(): number {
    return 1;
  }
  getState(): PlaybackState {
    return 'unstarted';
  }
  canSync(): boolean {
    return false;
  }
  canSeek(): boolean {
    return false;
  }
  canSetRate(): boolean {
    return false;
  }
  setVolume(_volume: number): void {}
  getVolume(): number {
    return 1;
  }
  setMuted(_muted: boolean): void {}
  isMuted(): boolean {
    return false;
  }
  setNativeControls(_visible: boolean): void {}
  isReady(): boolean {
    return this.ready;
  }
  onEvent(cb: (ev: PlayerEvent) => void): void {
    this.cb = cb;
  }
  destroy(): void {
    this.ready = false;
    this.cb = null;
  }
}
