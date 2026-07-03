import type { MediaItem } from '@syncroom/shared';
import type { PlaybackState, PlayerAdapter, PlayerEvent } from './types';

/* Minimal typings for the pieces of the YouTube IFrame API we use. */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlaybackRate(): number;
  getPlayerState(): number;
  setVolume(volume: number): void; // 0..100
  getVolume(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: () => void;
        onStateChange: (e: { data: number }) => void;
        onError: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => reject(new Error('YouTube API failed to load'));
    document.head.appendChild(script);
    setTimeout(() => reject(new Error('YouTube API timed out')), 15_000);
  });
  return apiPromise;
}

const YT_ERRORS: Record<number, string> = {
  2: 'Invalid YouTube video.',
  5: 'This video cannot be played in an embedded player.',
  100: 'Video not found or private.',
  101: 'The owner disabled embedded playback for this video.',
  150: 'The owner disabled embedded playback for this video.',
};

export class YouTubeAdapter implements PlayerAdapter {
  private player: YTPlayer | null = null;
  private ready = false;
  private cb: ((ev: PlayerEvent) => void) | null = null;
  private lastTime = 0;
  private seekWatch: ReturnType<typeof setInterval> | null = null;
  private lastRate = 1;

  async load(item: MediaItem, container: HTMLElement, controls: boolean): Promise<void> {
    const yt = await loadYouTubeApi();
    const mount = document.createElement('div');
    mount.className = 'h-full w-full';
    container.replaceChildren(mount);

    await new Promise<void>((resolve, reject) => {
      this.player = new yt.Player(mount, {
        videoId: item.providerId ?? '',
        playerVars: {
          controls: controls ? 1 : 0,
          disablekb: controls ? 0 : 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            this.ready = true;
            this.cb?.({ type: 'ready' });
            resolve();
          },
          onStateChange: (e) => this.handleState(yt, e.data),
          onError: (e) => {
            const message = YT_ERRORS[e.data] ?? 'YouTube playback error.';
            this.cb?.({ type: 'error', message });
            reject(new Error(message));
          },
        },
      });
    });

    // Poll for user seeks (the IFrame API has no seek event): a jump larger
    // than what wall-clock playback explains is reported as a seek.
    this.seekWatch = setInterval(() => {
      if (!this.player || !this.ready) return;
      const t = this.player.getCurrentTime();
      const rate = this.player.getPlaybackRate();
      if (rate !== this.lastRate) {
        this.lastRate = rate;
        this.cb?.({ type: 'rate', rate });
      }
      if (Math.abs(t - this.lastTime) > 1.8 * Math.max(rate, 1)) {
        this.cb?.({ type: 'seek', time: t });
      }
      this.lastTime = t;
    }, 750);
  }

  private handleState(yt: YTNamespace, state: number): void {
    if (!this.player) return;
    const time = this.player.getCurrentTime();
    if (state === yt.PlayerState.PLAYING) this.cb?.({ type: 'play', time });
    else if (state === yt.PlayerState.PAUSED) this.cb?.({ type: 'pause', time });
    else if (state === yt.PlayerState.ENDED) this.cb?.({ type: 'ended' });
  }

  play(): void {
    this.player?.playVideo();
  }
  pause(): void {
    this.player?.pauseVideo();
  }
  seek(time: number): void {
    this.lastTime = time;
    this.player?.seekTo(time, true);
  }
  setPlaybackRate(rate: number): void {
    this.lastRate = rate;
    this.player?.setPlaybackRate(rate);
  }
  getCurrentTime(): number {
    return this.player?.getCurrentTime() ?? 0;
  }
  getDuration(): number {
    return this.player?.getDuration() ?? 0;
  }
  getPlaybackRate(): number {
    return this.player?.getPlaybackRate() ?? 1;
  }
  canSync(): boolean {
    return true;
  }
  canSeek(): boolean {
    return true;
  }
  canSetRate(): boolean {
    return true;
  }
  setVolume(volume: number): void {
    this.player?.setVolume(Math.round(Math.min(1, Math.max(0, volume)) * 100));
  }
  getVolume(): number {
    return (this.player?.getVolume() ?? 100) / 100;
  }
  setMuted(muted: boolean): void {
    if (muted) this.player?.mute();
    else this.player?.unMute();
  }
  isMuted(): boolean {
    return this.player?.isMuted() ?? false;
  }
  setNativeControls(_visible: boolean): void {
    // The IFrame API only accepts `controls` at construction; toggling would
    // reload the player and interrupt playback, so YouTube keeps its chrome.
  }
  getState(): PlaybackState {
    // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
    switch (this.player?.getPlayerState()) {
      case 1:
        return 'playing';
      case 2:
        return 'paused';
      case 3:
        return 'buffering';
      case 0:
        return 'ended';
      default:
        return 'unstarted';
    }
  }
  isReady(): boolean {
    return this.ready;
  }
  onEvent(cb: (ev: PlayerEvent) => void): void {
    this.cb = cb;
  }
  destroy(): void {
    if (this.seekWatch) clearInterval(this.seekWatch);
    this.player?.destroy();
    this.player = null;
    this.ready = false;
    this.cb = null;
  }
}
