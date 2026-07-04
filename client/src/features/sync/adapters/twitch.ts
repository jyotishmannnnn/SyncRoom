import type { MediaItem } from '@syncroom/shared';
import type { PlaybackState, PlayerAdapter, PlayerEvent } from './types';

/* Minimal typings for the pieces of the Twitch Embed API we use. */
interface TwitchPlayerInstance {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  isPaused(): boolean;
  getEnded(): boolean;
  addEventListener(event: string, cb: () => void): void;
  destroy?: () => void;
}
interface TwitchPlayerCtor {
  new (el: string | HTMLElement, opts: Record<string, unknown>): TwitchPlayerInstance;
  READY: string;
  PLAY: string;
  PAUSE: string;
  ENDED: string;
  SEEK: string;
  PLAYBACK_BLOCKED: string;
}
interface TwitchNamespace {
  Player: TwitchPlayerCtor;
}
declare global {
  interface Window {
    Twitch?: TwitchNamespace;
  }
}

let apiPromise: Promise<TwitchNamespace> | null = null;

function loadTwitchApi(): Promise<TwitchNamespace> {
  if (window.Twitch?.Player) return Promise.resolve(window.Twitch);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://player.twitch.tv/js/embed/v1.js';
    script.onload = () => {
      if (window.Twitch?.Player) resolve(window.Twitch);
      else reject(new Error('Twitch player failed to load'));
    };
    script.onerror = () => reject(new Error('Twitch player failed to load'));
    document.head.appendChild(script);
    setTimeout(() => reject(new Error('Twitch player timed out')), 15_000);
  });
  return apiPromise;
}

let mountSeq = 0;

/**
 * Twitch provider via the official embed player. `providerId` is encoded as
 * `video:<id>` (a seekable VOD) or `channel:<name>` (a live stream). Live
 * streams report canSeek()/canSetRate() === false — the SyncController keeps
 * play/pause in lock-step and simply skips seek/rate for them. Twitch exposes
 * no playback-rate control, so canSetRate() is always false.
 */
export class TwitchAdapter implements PlayerAdapter {
  private player: TwitchPlayerInstance | null = null;
  private ready = false;
  private live = false;
  private cb: ((ev: PlayerEvent) => void) | null = null;

  async load(item: MediaItem, container: HTMLElement): Promise<void> {
    const ns = await loadTwitchApi();
    const sep = (item.providerId ?? '').indexOf(':');
    const kind = sep === -1 ? 'video' : (item.providerId ?? '').slice(0, sep);
    const ref = sep === -1 ? (item.providerId ?? '') : (item.providerId ?? '').slice(sep + 1);
    this.live = kind === 'channel';

    const mount = document.createElement('div');
    mount.id = `twitch-mount-${++mountSeq}`;
    mount.className = 'h-full w-full';
    container.replaceChildren(mount);

    const opts: Record<string, unknown> = {
      width: '100%',
      height: '100%',
      autoplay: false,
      muted: false,
      // Required by Twitch: the domain(s) the player is embedded on.
      parent: [window.location.hostname],
    };
    if (this.live) opts.channel = ref;
    else opts.video = ref;

    const player = new ns.Player(mount.id, opts);
    this.player = player;

    player.addEventListener(ns.Player.READY, () => {
      this.ready = true;
      this.cb?.({ type: 'ready' });
    });
    player.addEventListener(ns.Player.PLAY, () =>
      this.cb?.({ type: 'play', time: this.getCurrentTime() }),
    );
    player.addEventListener(ns.Player.PAUSE, () =>
      this.cb?.({ type: 'pause', time: this.getCurrentTime() }),
    );
    player.addEventListener(ns.Player.ENDED, () => this.cb?.({ type: 'ended' }));
    // SEEK fires for user scrubs and our own seek() alike; the SyncController's
    // intent ledger consumes the echoes of commands it issued.
    player.addEventListener(ns.Player.SEEK, () =>
      this.cb?.({ type: 'seek', time: this.getCurrentTime() }),
    );
    player.addEventListener(ns.Player.PLAYBACK_BLOCKED, () =>
      this.cb?.({ type: 'autoplay-blocked' }),
    );
  }

  play(): void {
    this.player?.play();
  }
  pause(): void {
    this.player?.pause();
  }
  seek(time: number): void {
    if (!this.live) this.player?.seek(time);
  }
  setPlaybackRate(): void {
    /* Twitch exposes no playback-rate control. */
  }
  getCurrentTime(): number {
    try {
      return this.player?.getCurrentTime() ?? 0;
    } catch {
      return 0;
    }
  }
  getDuration(): number {
    try {
      const d = this.player?.getDuration() ?? 0;
      return Number.isFinite(d) ? d : 0;
    } catch {
      return 0;
    }
  }
  getPlaybackRate(): number {
    return 1;
  }
  canSync(): boolean {
    return true;
  }
  canSeek(): boolean {
    return !this.live;
  }
  canSetRate(): boolean {
    return false;
  }
  getState(): PlaybackState {
    if (!this.ready || !this.player) return 'unstarted';
    try {
      if (this.player.getEnded()) return 'ended';
      return this.player.isPaused() ? 'paused' : 'playing';
    } catch {
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
    try {
      this.player?.destroy?.();
    } catch {
      /* older embeds lack destroy() */
    }
    this.player = null;
    this.ready = false;
    this.cb = null;
  }
}
