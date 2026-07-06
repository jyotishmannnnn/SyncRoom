import type { MediaItem } from '@syncroom/shared';
import type { PlaybackState, PlayerAdapter, PlayerEvent } from './types';

type HlsInstance = {
  loadSource(url: string): void;
  attachMedia(el: HTMLVideoElement): void;
  destroy(): void;
};
type DashInstance = {
  initialize(el: HTMLVideoElement, url: string, autoplay: boolean): void;
  reset(): void;
};

/**
 * HTML5 <video> adapter covering direct files (MP4/WebM), HLS via hls.js
 * (lazy-loaded), MPEG-DASH via dash.js (lazy-loaded) and Google Drive
 * direct-download URLs. Engines are only downloaded when needed.
 */
export class Html5Adapter implements PlayerAdapter {
  private video: HTMLVideoElement | null = null;
  private hls: HlsInstance | null = null;
  private dash: DashInstance | null = null;
  private ready = false;
  private cb: ((ev: PlayerEvent) => void) | null = null;

  async load(item: MediaItem, container: HTMLElement, controls: boolean): Promise<void> {
    const video = document.createElement('video');
    video.className = 'h-full w-full bg-black';
    video.controls = controls;
    video.playsInline = true;
    // NB: no `crossOrigin`, media elements can play cross-origin sources
    // without CORS headers, and Google Drive (plus many direct-file hosts)
    // don't send them. Requesting anonymous CORS made those loads fail and
    // forced Drive into the unsynced iframe fallback. We never read pixels
    // from this element, so anonymous CORS buys us nothing here.
    video.preload = 'auto';
    container.replaceChildren(video);
    this.video = video;

    video.addEventListener('loadedmetadata', () => {
      this.ready = true;
      this.cb?.({ type: 'ready' });
    });
    // Bytes are arriving. Used by the controller's Drive stall-watchdog to
    // distinguish "loading slowly" (large non-faststart file streaming through
    // the proxy) from "genuinely stuck", so a slow file isn't wrongly dropped
    // to the unsynced iframe before its metadata is ready.
    video.addEventListener('progress', () => this.cb?.({ type: 'loadprogress' }));
    video.addEventListener('loadeddata', () => this.cb?.({ type: 'loadprogress' }));
    video.addEventListener('play', () => this.cb?.({ type: 'play', time: video.currentTime }));
    video.addEventListener('pause', () => {
      if (!video.ended) this.cb?.({ type: 'pause', time: video.currentTime });
    });
    // Echo filtering happens in the SyncController's intent ledger, not here,
    // adapters report everything, uniformly across providers.
    video.addEventListener('seeked', () => this.cb?.({ type: 'seek', time: video.currentTime }));
    video.addEventListener('ratechange', () =>
      this.cb?.({ type: 'rate', rate: video.playbackRate }),
    );
    video.addEventListener('ended', () => this.cb?.({ type: 'ended' }));
    video.addEventListener('error', () => {
      const code = video.error?.code;
      const message =
        code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? 'This format is not supported (or the host blocks direct playback).'
          : code === MediaError.MEDIA_ERR_NETWORK
            ? 'Network error while loading the video.'
            : 'Could not play this video.';
      this.cb?.({ type: 'error', message });
    });

    if (item.kind === 'hls' && !video.canPlayType('application/vnd.apple.mpegurl')) {
      const { default: Hls } = await import('hls.js');
      if (!Hls.isSupported()) {
        this.cb?.({ type: 'error', message: 'HLS is not supported in this browser.' });
        return;
      }
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(item.url);
      hls.attachMedia(video);
      this.hls = hls;
    } else if (item.kind === 'dash') {
      const dashjs = await import('dashjs');
      const player = dashjs.MediaPlayer().create();
      player.initialize(video, item.url, false);
      this.dash = player;
    } else {
      video.src = item.url;
    }
  }

  play(): void {
    void this.video?.play().catch((err: unknown) => {
      // NotAllowedError = autoplay policy; anything else is a real failure.
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        this.cb?.({ type: 'autoplay-blocked' });
      } else {
        this.cb?.({ type: 'error', message: 'Could not start playback.' });
      }
    });
  }
  pause(): void {
    this.video?.pause();
  }
  seek(time: number): void {
    if (this.video) this.video.currentTime = time;
  }
  setPlaybackRate(rate: number): void {
    if (this.video) this.video.playbackRate = rate;
  }
  getCurrentTime(): number {
    return this.video?.currentTime ?? 0;
  }
  getDuration(): number {
    return this.video?.duration ?? 0;
  }
  getPlaybackRate(): number {
    return this.video?.playbackRate ?? 1;
  }
  canSync(): boolean {
    return true;
  }
  canSeek(): boolean {
    // Live streams (HLS/DASH without a finite duration) are not seekable.
    return this.video !== null && Number.isFinite(this.video.duration);
  }
  canSetRate(): boolean {
    return this.canSeek(); // rate control is meaningless on live edges too
  }
  setVolume(volume: number): void {
    if (this.video) this.video.volume = Math.min(1, Math.max(0, volume));
  }
  getVolume(): number {
    return this.video?.volume ?? 1;
  }
  setMuted(muted: boolean): void {
    if (this.video) this.video.muted = muted;
  }
  isMuted(): boolean {
    return this.video?.muted ?? false;
  }
  setNativeControls(visible: boolean): void {
    if (this.video) this.video.controls = visible;
  }
  getState(): PlaybackState {
    const v = this.video;
    if (!v || v.readyState === 0) return 'unstarted';
    if (v.ended) return 'ended';
    if (v.seeking || (!v.paused && v.readyState < 3)) return 'buffering';
    return v.paused ? 'paused' : 'playing';
  }
  isReady(): boolean {
    return this.ready;
  }
  onEvent(cb: (ev: PlayerEvent) => void): void {
    this.cb = cb;
  }
  destroy(): void {
    this.hls?.destroy();
    this.dash?.reset();
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
    this.video = null;
    this.ready = false;
    this.cb = null;
  }
}
