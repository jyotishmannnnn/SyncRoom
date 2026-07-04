import type VimeoPlayer from '@vimeo/player';
import type { MediaItem } from '@syncroom/shared';
import type { PlaybackState, PlayerAdapter, PlayerEvent } from './types';

/** Vimeo event payloads (the SDK types data as Record<string, unknown>). */
interface TimePayload {
  seconds: number;
  duration: number;
  percent: number;
}
interface RatePayload {
  playbackRate: number;
}
interface ErrorPayload {
  message: string;
  name: string;
  method: string;
}

/**
 * Vimeo provider via the official @vimeo/player SDK (lazy-loaded, code-split).
 *
 * The SDK is Promise-based, but PlayerAdapter's getters are synchronous, so we
 * mirror the player's state into plain fields updated from the SDK's events
 * (`timeupdate` fires ~4×/s). The SyncController drives this exactly like any
 * other provider — full play/pause/seek/rate sync.
 */
export class VimeoAdapter implements PlayerAdapter {
  private player: VimeoPlayer | null = null;
  private ready = false;
  private cb: ((ev: PlayerEvent) => void) | null = null;
  private time = 0;
  private duration = 0;
  private rate = 1;
  private paused = true;
  private ended = false;
  private buffering = false;

  async load(item: MediaItem, container: HTMLElement, controls: boolean): Promise<void> {
    const { default: Player } = await import('@vimeo/player');
    const mount = document.createElement('div');
    mount.className = 'h-full w-full';
    container.replaceChildren(mount);

    const player = new Player(mount, {
      // classifyMediaUrl always emits `https://vimeo.com/<id>[/<hash>]`, which
      // matches the SDK's branded VimeoUrl template type.
      url: item.url as `https://vimeo.com/${string}`,
      controls,
      autoplay: false,
      muted: false,
    });
    this.player = player;

    player.on<'play', TimePayload>('play', (d) => {
      this.paused = false;
      this.ended = false;
      this.time = d.seconds;
      this.cb?.({ type: 'play', time: d.seconds });
    });
    player.on<'pause', TimePayload>('pause', (d) => {
      this.paused = true;
      this.time = d.seconds;
      this.cb?.({ type: 'pause', time: d.seconds });
    });
    player.on<'ended', TimePayload>('ended', (d) => {
      this.ended = true;
      this.paused = true;
      this.time = d.seconds;
      this.cb?.({ type: 'ended' });
    });
    player.on<'timeupdate', TimePayload>('timeupdate', (d) => {
      this.time = d.seconds;
      this.duration = d.duration;
    });
    player.on<'seeked', TimePayload>('seeked', (d) => {
      this.time = d.seconds;
      this.cb?.({ type: 'seek', time: d.seconds });
    });
    player.on<'playbackratechange', RatePayload>('playbackratechange', (d) => {
      this.rate = d.playbackRate;
      this.cb?.({ type: 'rate', rate: d.playbackRate });
    });
    player.on('bufferstart', () => {
      this.buffering = true;
    });
    player.on('bufferend', () => {
      this.buffering = false;
    });
    player.on<'error', ErrorPayload>('error', (d) => {
      this.cb?.({ type: 'error', message: d.message || 'Vimeo playback error.' });
    });

    try {
      await player.ready();
    } catch {
      throw new Error('This Vimeo video can’t be played (private, removed, or embedding disabled).');
    }
    try {
      this.duration = await player.getDuration();
    } catch {
      /* duration arrives via timeupdate anyway */
    }
    // Make the injected iframe fill the black stage.
    const iframe = mount.querySelector('iframe');
    if (iframe) {
      iframe.style.width = '100%';
      iframe.style.height = '100%';
    }
    this.ready = true;
    this.cb?.({ type: 'ready' });
  }

  play(): void {
    // Vimeo's play() rejects when autoplay is blocked or interrupted — surface
    // the click-to-play overlay; genuine load failures come via the error event.
    void this.player?.play().catch(() => this.cb?.({ type: 'autoplay-blocked' }));
  }
  pause(): void {
    void this.player?.pause().catch(() => {
      /* pausing never meaningfully fails */
    });
  }
  seek(time: number): void {
    this.time = time;
    void this.player?.setCurrentTime(time).catch(() => {
      /* out-of-range seeks are clamped by the SDK */
    });
  }
  setPlaybackRate(rate: number): void {
    this.rate = rate;
    void this.player?.setPlaybackRate(rate).catch(() => {
      /* rate out of the 0–2 range is rejected; ignore */
    });
  }
  getCurrentTime(): number {
    return this.time;
  }
  getDuration(): number {
    return this.duration;
  }
  getPlaybackRate(): number {
    return this.rate;
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
  getState(): PlaybackState {
    if (!this.ready) return 'unstarted';
    if (this.ended) return 'ended';
    if (this.buffering) return 'buffering';
    return this.paused ? 'paused' : 'playing';
  }
  isReady(): boolean {
    return this.ready;
  }
  onEvent(cb: (ev: PlayerEvent) => void): void {
    this.cb = cb;
  }
  destroy(): void {
    void this.player?.destroy().catch(() => {
      /* already torn down */
    });
    this.player = null;
    this.ready = false;
    this.cb = null;
  }
}
