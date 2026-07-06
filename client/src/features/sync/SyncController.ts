import type { MediaItem, SyncState } from '@syncroom/shared';
import { correctionFor, DRIFT_CHECK_INTERVAL_MS, expectedTime } from '@syncroom/shared';
import { socket, serverNow } from '@/lib/socket';
import type { PlaybackState, PlayerAdapter, PlayerEvent } from './adapters/types';
import { YouTubeAdapter } from './adapters/youtube';
import { VimeoAdapter } from './adapters/vimeo';
import { TwitchAdapter } from './adapters/twitch';
import { Html5Adapter } from './adapters/html5';
import { DriveEmbedAdapter } from './adapters/driveEmbed';
import { useSyncDebug } from './debug';

export type ControllerPhase = 'loading' | 'ready' | 'error';

export interface SyncControllerOptions {
  container: HTMLElement;
  /** Live permission checks, read at event time, never captured. */
  canControl: () => boolean;
  isHost: () => boolean;
  /** Latest authoritative state (from the room store). */
  authoritative: () => SyncState | null;
  onPhase: (phase: ControllerPhase) => void;
  onError: (message: string) => void;
  onEnded: () => void;
  /** Fired once when the provider degrades to an unsynced fallback (Drive). */
  onSyncUnavailable: () => void;
  /** Fired when autoplay policy blocks playback, UI shows a click-to-play. */
  onAutoplayBlocked: () => void;
  /** Test seam: overrides the provider registry. */
  adapterFactory?: (media: MediaItem) => PlayerAdapter;
}

interface Intent {
  kind: 'play' | 'pause' | 'seek' | 'rate';
  value: number;
  expiresAt: number;
}

/** How long a programmatic command may take before its echo stops matching. */
const INTENT_TTL_MS: Record<Intent['kind'], number> = {
  play: 5000, // buffering can delay the actual `play` event substantially
  pause: 3000,
  seek: 3000,
  rate: 2500,
};

/** Position error tolerated before we issue a corrective seek on apply. */
const APPLY_SEEK_THRESHOLD_S = 0.5;
/** Trailing debounce for user seeks (scrubbing emits once, at the end). */
const SEEK_DEBOUNCE_MS = 400;
/** Host re-anchors authority only when its player truly diverged. */
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_DRIFT_S = 0.25;
/**
 * Drive direct-stream stall watchdog: fall back to the preview iframe only
 * after this long with NO download progress. It is re-armed on every progress
 * event, so a large, slowly-streaming file (e.g. a non-faststart MP4 whose moov
 * atom is range-fetched through the proxy) keeps loading instead of being
 * wrongly abandoned as "unsyncable".
 */
const DRIVE_STALL_TIMEOUT_MS = 20_000;

/** Provider registry, the ONLY place that maps media kinds to adapters. */
function adapterFor(media: MediaItem): PlayerAdapter {
  switch (media.kind) {
    case 'youtube':
      return new YouTubeAdapter();
    case 'vimeo':
      return new VimeoAdapter();
    case 'twitch':
      return new TwitchAdapter();
    case 'drive-embed':
      return new DriveEmbedAdapter();
    default:
      return new Html5Adapter(); // file, hls, dash, drive (direct stream)
  }
}

/**
 * Provider-agnostic MediaController, the sync state machine.
 *
 * Invariants:
 *  1. One user action → exactly one emitted sync event (seeks debounced,
 *     identical consecutive emissions collapsed).
 *  2. One received sync state → at most one adapter command per dimension,
 *     and only if that dimension actually changes (diff-based apply).
 *  3. Adapter events caused by our own commands are consumed by the intent
 *     ledger and never re-emitted, feedback loops are structurally
 *     impossible.
 *  4. Stale/out-of-order states are dropped via the server's monotonic `seq`.
 *
 * The controller talks to providers exclusively through PlayerAdapter and
 * respects capability probes: a `canSync() === false` provider (Drive preview
 * iframe) is rendered but never driven; `canSeek/canSetRate === false`
 * dimensions are skipped (live streams).
 */
export class SyncController {
  private readonly opts: SyncControllerOptions;
  private adapter: PlayerAdapter | null = null;
  private media: MediaItem | null = null;
  private disposed = false;

  private lastSeq = 0;
  private intents: Intent[] = [];
  private nudging = false;

  private seekDebounce: ReturnType<typeof setTimeout> | null = null;
  private pendingSeekTime = 0;
  private lastEmit: { op: string; value: number; at: number } | null = null;
  private driftTimer: ReturnType<typeof setInterval> | null = null;
  private loadTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastHeartbeatAt = 0;
  /** Consecutive stalled play attempts, beyond 1 we assume autoplay policy. */
  private stalledPlays = 0;
  private fellBack = false;

  constructor(opts: SyncControllerOptions) {
    this.opts = opts;
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                          */
  /* ------------------------------------------------------------------ */

  async load(media: MediaItem, controls: boolean): Promise<void> {
    this.media = media;
    this.opts.onPhase('loading');
    useSyncDebug.getState().set({ provider: media.kind, phase: 'loading' });

    const adapter = (this.opts.adapterFactory ?? adapterFor)(media);
    this.adapter = adapter;
    adapter.onEvent((ev) => this.onPlayerEvent(ev));

    // Drive direct streams sometimes hang without ever erroring (interstitial
    // page, quota); a stall-watchdog degrades to the preview iframe if no bytes
    // arrive, but progress events keep re-arming it so a slow load survives.
    if (media.kind === 'drive') this.armDriveWatchdog();

    try {
      await adapter.load(media, this.opts.container, controls);
    } catch (err) {
      if (this.disposed || this.adapter !== adapter) return;
      if (media.kind === 'drive') {
        this.fallbackToDriveEmbed();
      } else {
        this.opts.onPhase('error');
        this.opts.onError(err instanceof Error ? err.message : 'Could not load this video.');
      }
      return;
    }

    if (this.disposed || this.adapter !== adapter) return;
    this.driftTimer ??= setInterval(() => this.driftTick(), DRIFT_CHECK_INTERVAL_MS);
  }

  /**
   * Swaps the failed direct-stream adapter for the unsynced Drive preview
   * iframe. Same interface, same container, the rest of the app only sees
   * `canSync() === false`.
   */
  private fallbackToDriveEmbed(): void {
    if (this.disposed || this.fellBack || !this.media) return;
    this.fellBack = true;
    this.clearLoadTimeout();
    this.adapter?.destroy();

    const embed = new DriveEmbedAdapter();
    this.adapter = embed;
    embed.onEvent((ev) => this.onPlayerEvent(ev));
    void embed.load({ ...this.media, kind: 'drive-embed' }, this.opts.container);
    useSyncDebug.getState().set({ provider: 'drive-embed' });
    this.opts.onSyncUnavailable();
  }

  /* ------------------------------------------------------------------ */
  /* Local UI facade, powers the cinema bar. Everything here is         */
  /* per-viewer (volume, playhead readout, chrome); nothing emits.       */
  /* ------------------------------------------------------------------ */

  getPlayhead(): { time: number; duration: number; seekable: boolean } | null {
    const a = this.adapter;
    if (!a?.isReady() || !a.canSync()) return null;
    return { time: a.getCurrentTime(), duration: a.getDuration(), seekable: a.canSeek() };
  }

  setVolume(volume: number): void {
    this.adapter?.setVolume(volume);
  }
  getVolume(): number {
    return this.adapter?.getVolume() ?? 1;
  }
  setMuted(muted: boolean): void {
    this.adapter?.setMuted(muted);
  }
  isMuted(): boolean {
    return this.adapter?.isMuted() ?? false;
  }
  /** Hide/show the provider's own chrome while the cinema bar is active. */
  setNativeControls(visible: boolean): void {
    this.adapter?.setNativeControls(visible);
  }

  /** User clicked the "click to play" overlay, a gesture is now available. */
  resume(): void {
    this.stalledPlays = 0;
    const state = this.opts.authoritative();
    if (state) this.applyState(state);
  }

  dispose(): void {
    this.disposed = true;
    if (this.driftTimer) clearInterval(this.driftTimer);
    this.driftTimer = null;
    this.clearLoadTimeout();
    if (this.seekDebounce) clearTimeout(this.seekDebounce);
    this.seekDebounce = null;
    this.adapter?.destroy();
    this.adapter = null;
    this.intents = [];
    // Remove any player DOM the adapter left behind (iframe/video element).
    if (this.opts.container.isConnected) this.opts.container.replaceChildren();
  }

  private clearLoadTimeout(): void {
    if (this.loadTimeout) clearTimeout(this.loadTimeout);
    this.loadTimeout = null;
  }

  /**
   * (Re)arm the Drive stall-watchdog: only fall back to the unsynced preview
   * iframe after DRIVE_STALL_TIMEOUT_MS with no download progress. Called on
   * load and reset on every progress event, so a slow-but-streaming file loads.
   */
  private armDriveWatchdog(): void {
    this.clearLoadTimeout();
    this.loadTimeout = setTimeout(() => {
      if (!this.disposed && !this.adapter?.isReady()) this.fallbackToDriveEmbed();
    }, DRIVE_STALL_TIMEOUT_MS);
  }

  /* ------------------------------------------------------------------ */
  /* Inbound: authoritative state → player (diff-based)                 */
  /* ------------------------------------------------------------------ */

  /** Entry point for `sync:state` events. Drops stale/out-of-order states. */
  applyRemote(state: SyncState): void {
    const debug = useSyncDebug.getState();
    if (state.seq <= this.lastSeq) {
      debug.bump('dropped', `stale seq ${state.seq} (have ${this.lastSeq})`);
      return;
    }
    this.lastSeq = state.seq;
    debug.bump(
      'received',
      `seq ${state.seq}: ${state.playing ? 'play' : 'pause'}@${state.time.toFixed(1)}`,
    );
    this.applyState(state);
  }

  /**
   * Reconciles the player with `state`, issuing only the commands whose
   * dimension actually differs. Every command registers an intent so the
   * resulting player event is recognized as an echo.
   */
  private applyState(state: SyncState): void {
    const a = this.adapter;
    if (!a?.isReady() || !state.media || !a.canSync()) return;

    // 1. Rate, skip while a drift nudge is deliberately off-rate.
    if (a.canSetRate() && !this.nudging && Math.abs(a.getPlaybackRate() - state.rate) > 0.001) {
      this.intend('rate', state.rate);
      a.setPlaybackRate(state.rate);
    }

    // 2. Position.
    const target = state.playing ? expectedTime(state, serverNow()) : state.time;
    if (a.canSeek() && Math.abs(a.getCurrentTime() - target) > APPLY_SEEK_THRESHOLD_S) {
      this.intend('seek', target);
      a.seek(target);
    }

    // 3. Play/pause, only when the actual player state differs.
    const ps = a.getState();
    if (state.playing) {
      if (ps !== 'playing' && ps !== 'buffering') {
        this.intend('play', target);
        a.play();
      }
    } else if (ps === 'playing' || ps === 'buffering') {
      this.intend('pause', state.time);
      a.pause();
      if (this.nudging) {
        this.nudging = false;
        this.intend('rate', state.rate);
        a.setPlaybackRate(state.rate);
      }
    }
  }

  /** Re-assert authority after a non-controller poked the player. */
  private reassert(): void {
    const state = this.opts.authoritative();
    if (state) this.applyState(state);
  }

  /* ------------------------------------------------------------------ */
  /* Outbound: player events → sync events (intent-filtered)            */
  /* ------------------------------------------------------------------ */

  private onPlayerEvent(ev: PlayerEvent): void {
    if (this.disposed) return;
    const debug = useSyncDebug.getState();

    switch (ev.type) {
      case 'ready': {
        this.clearLoadTimeout();
        this.opts.onPhase('ready');
        debug.set({ phase: 'ready' });
        const state = this.opts.authoritative();
        if (state) {
          // Late join / (re)load: adopt the current seq and reconcile once.
          this.lastSeq = Math.max(this.lastSeq, state.seq);
          this.applyState(state);
        }
        return;
      }
      case 'error':
        if (this.media?.kind === 'drive' && !this.fellBack) {
          this.fallbackToDriveEmbed();
        } else {
          this.opts.onPhase('error');
          this.opts.onError(ev.message);
        }
        return;
      case 'autoplay-blocked':
        this.opts.onAutoplayBlocked();
        return;
      case 'ended':
        this.opts.onEnded();
        return;
      case 'loadprogress':
        // Bytes are flowing for a Drive direct stream, it's loading (just
        // slowly). Reset the stall-watchdog so we don't drop to the unsynced
        // iframe while the file is still downloading its metadata.
        if (this.media?.kind === 'drive' && !this.fellBack && !this.adapter?.isReady()) {
          this.armDriveWatchdog();
        }
        return;
      default:
        break;
    }

    // Playback resumed, clear the autoplay stall counter.
    if (ev.type === 'play') this.stalledPlays = 0;

    // Echo of one of our own commands? Consume it, never re-broadcast.
    if (this.consumeIntent(ev)) return;

    if (!this.opts.canControl()) {
      // A non-controller managed to move the player (e.g. keyboard on the
      // iframe), snap back to authority instead of emitting anything.
      this.reassert();
      return;
    }

    // Genuine user action by a controller → exactly one sync event.
    const auth = this.opts.authoritative();
    switch (ev.type) {
      case 'play':
        this.emit('play', ev.time);
        break;
      case 'pause':
        this.emit('pause', ev.time);
        break;
      case 'seek':
        this.debouncedSeek(ev.time);
        break;
      case 'rate':
        if (!auth || Math.abs(auth.rate - ev.rate) > 0.001) this.emit('rate', ev.rate);
        break;
    }
  }

  private intend(kind: Intent['kind'], value: number): void {
    this.pruneIntents();
    this.intents.push({ kind, value, expiresAt: Date.now() + INTENT_TTL_MS[kind] });
  }

  private pruneIntents(): void {
    const now = Date.now();
    this.intents = this.intents.filter((i) => i.expiresAt > now);
  }

  private consumeIntent(ev: PlayerEvent): boolean {
    this.pruneIntents();
    const idx = this.intents.findIndex((i) => {
      if (ev.type === 'play' || ev.type === 'pause') return i.kind === ev.type;
      if (ev.type === 'seek') return i.kind === 'seek' && Math.abs(i.value - ev.time) < 1.5;
      if (ev.type === 'rate') return i.kind === 'rate' && Math.abs(i.value - ev.rate) < 0.011;
      return false;
    });
    if (idx === -1) return false;
    this.intents.splice(idx, 1);
    return true;
  }

  /** Scrub-friendly: emit a single SEEK after the user stops seeking. */
  private debouncedSeek(time: number): void {
    this.pendingSeekTime = time;
    if (this.seekDebounce) clearTimeout(this.seekDebounce);
    this.seekDebounce = setTimeout(() => {
      this.seekDebounce = null;
      this.emit('seek', this.pendingSeekTime);
    }, SEEK_DEBOUNCE_MS);
  }

  private emit(op: 'play' | 'pause' | 'seek' | 'rate', value: number): void {
    // Collapse identical consecutive emissions (double-fired player events).
    const now = Date.now();
    if (
      this.lastEmit &&
      this.lastEmit.op === op &&
      Math.abs(this.lastEmit.value - value) < 0.25 &&
      now - this.lastEmit.at < 500
    ) {
      return;
    }
    this.lastEmit = { op, value, at: now };

    const eventId = crypto.randomUUID();
    if (op === 'rate') socket.emit('sync:rate', { rate: value, eventId });
    else socket.emit(`sync:${op}`, { time: value, eventId });
    useSyncDebug.getState().bump('sent', `sent ${op}@${value.toFixed(2)}`);
  }

  /* ------------------------------------------------------------------ */
  /* Drift loop: gentle correction for guests, sparse anchor for host   */
  /* ------------------------------------------------------------------ */

  private driftTick(): void {
    const a = this.adapter;
    const state = this.opts.authoritative();
    const debug = useSyncDebug.getState();
    if (!a?.isReady() || !state?.media || !a.canSync()) return;

    debug.set({ playback: a.getState(), time: a.getCurrentTime() });
    if (!state.playing) return;

    const ps: PlaybackState = a.getState();
    if (ps === 'buffering') return; // don't fight the buffer

    // Autoplay stall: authority says playing but the player never started.
    // One retry (some players need a nudge after load), then surface the
    // click-to-play overlay, never a retry storm.
    if (ps === 'paused' || ps === 'unstarted') {
      this.stalledPlays += 1;
      if (this.stalledPlays === 1) {
        this.intend('play', a.getCurrentTime());
        a.play();
      } else if (this.stalledPlays === 2) {
        this.opts.onAutoplayBlocked();
      }
      return;
    }

    const target = expectedTime(state, serverNow());
    const driftS = a.getCurrentTime() - target;
    debug.set({ driftMs: Math.round(driftS * 1000) });

    if (this.opts.isHost()) {
      // The host IS the truth: never self-correct; instead re-anchor server
      // authority when the player position diverged (e.g. after buffering),
      // at most once per heartbeat interval, and only if actually needed.
      const now = Date.now();
      if (
        Math.abs(driftS) > HEARTBEAT_DRIFT_S &&
        now - this.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS &&
        ps === 'playing'
      ) {
        this.lastHeartbeatAt = now;
        this.emit('play', a.getCurrentTime());
      }
      return;
    }

    const action = correctionFor(a.getCurrentTime(), target, state.rate);
    if (action.type === 'seek') {
      if (!a.canSeek()) return; // live edge, nothing sensible to do
      this.intend('seek', action.to);
      a.seek(action.to);
      if (this.nudging) {
        this.nudging = false;
        this.intend('rate', state.rate);
        a.setPlaybackRate(state.rate);
      }
    } else if (action.type === 'nudge') {
      if (!a.canSetRate()) return;
      if (Math.abs(a.getPlaybackRate() - action.rate) > 0.001) {
        this.intend('rate', action.rate);
        a.setPlaybackRate(action.rate);
      }
      this.nudging = true;
    } else if (this.nudging) {
      this.nudging = false;
      this.intend('rate', state.rate);
      a.setPlaybackRate(state.rate);
    }
  }
}
