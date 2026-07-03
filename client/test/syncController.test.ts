import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem, SyncState } from '@syncroom/shared';
import { DRIFT_CHECK_INTERVAL_MS } from '@syncroom/shared';

/* Capture every socket emission; serverNow follows the (fake) clock. */
const emitted: Array<{ event: string; payload: unknown }> = [];
vi.mock('@/lib/socket', () => ({
  socket: { emit: (event: string, payload: unknown) => emitted.push({ event, payload }) },
  serverNow: () => Date.now(),
  clock: { lastRtt: 0, offset: 0 },
}));

import type { PlaybackState, PlayerAdapter, PlayerEvent } from '@/features/sync/adapters/types';
import { SyncController, type SyncControllerOptions } from '@/features/sync/SyncController';

const MEDIA: MediaItem = {
  id: 'm1',
  url: 'https://x/a.mp4',
  kind: 'file',
  title: 'a',
  addedBy: 'h',
};

class FakeAdapter implements PlayerAdapter {
  calls: string[] = [];
  state: PlaybackState = 'paused';
  time = 0;
  rate = 1;
  ready = true;
  caps = { sync: true, seek: true, rate: true };
  private cb: ((ev: PlayerEvent) => void) | null = null;

  load(): Promise<void> {
    return Promise.resolve();
  }
  play(): void {
    this.calls.push('play');
    this.state = 'playing';
  }
  pause(): void {
    this.calls.push('pause');
    this.state = 'paused';
  }
  seek(time: number): void {
    this.calls.push(`seek:${time.toFixed(1)}`);
    this.time = time;
  }
  setPlaybackRate(rate: number): void {
    this.calls.push(`rate:${rate.toFixed(3)}`);
    this.rate = rate;
  }
  getCurrentTime(): number {
    return this.time;
  }
  getDuration(): number {
    return 600;
  }
  getPlaybackRate(): number {
    return this.rate;
  }
  getState(): PlaybackState {
    return this.state;
  }
  canSync(): boolean {
    return this.caps.sync;
  }
  canSeek(): boolean {
    return this.caps.seek;
  }
  canSetRate(): boolean {
    return this.caps.rate;
  }
  volume = 1;
  muted = false;
  nativeControls = true;
  setVolume(v: number): void {
    this.volume = v;
  }
  getVolume(): number {
    return this.volume;
  }
  setMuted(m: boolean): void {
    this.muted = m;
  }
  isMuted(): boolean {
    return this.muted;
  }
  setNativeControls(v: boolean): void {
    this.nativeControls = v;
  }
  isReady(): boolean {
    return this.ready;
  }
  onEvent(cb: (ev: PlayerEvent) => void): void {
    this.cb = cb;
  }
  destroy(): void {
    this.cb = null;
  }
  /** Simulates the underlying player firing an event. */
  fire(ev: PlayerEvent): void {
    this.cb?.(ev);
  }
}

function state(patch: Partial<SyncState>): SyncState {
  return {
    media: MEDIA,
    playing: false,
    time: 0,
    rate: 1,
    updatedAt: Date.now(),
    seq: 1,
    ...patch,
  };
}

function syncEmits(): Array<{ event: string; payload: unknown }> {
  return emitted.filter((e) => e.event.startsWith('sync:'));
}

interface Harness {
  controller: SyncController;
  adapter: FakeAdapter;
  auth: { current: SyncState | null };
  flags: { canControl: boolean; isHost: boolean };
}

async function setup(overrides: Partial<SyncControllerOptions> = {}): Promise<Harness> {
  const adapter = new FakeAdapter();
  const auth = { current: null as SyncState | null };
  const flags = { canControl: true, isHost: false };
  const container = { isConnected: false } as unknown as HTMLElement;
  const controller = new SyncController({
    container,
    canControl: () => flags.canControl,
    isHost: () => flags.isHost,
    authoritative: () => auth.current,
    onPhase: () => {},
    onError: () => {},
    onEnded: () => {},
    onSyncUnavailable: () => {},
    onAutoplayBlocked: () => {},
    adapterFactory: () => adapter,
    ...overrides,
  });
  await controller.load(MEDIA, true);
  return { controller, adapter, auth, flags };
}

let harness: Harness;

beforeEach(async () => {
  vi.useFakeTimers();
  emitted.length = 0;
  harness = await setup();
});

afterEach(() => {
  harness.controller.dispose();
  vi.useRealTimers();
});

describe('diff-based apply (no redundant API calls)', () => {
  it('plays a paused player exactly once, never an already-playing one', () => {
    const { controller, adapter, auth } = harness;
    auth.current = state({ playing: true, seq: 1 });
    controller.applyRemote(auth.current);
    expect(adapter.calls.filter((c) => c === 'play')).toHaveLength(1);

    // Same intent re-broadcast with a new seq while already playing → no call.
    auth.current = state({ playing: true, seq: 2 });
    controller.applyRemote(auth.current);
    expect(adapter.calls.filter((c) => c === 'play')).toHaveLength(1);
  });

  it('skips seeks within the threshold and redundant rate sets', () => {
    const { controller, adapter, auth } = harness;
    adapter.time = 100;
    auth.current = state({ playing: false, time: 100.2, rate: 1, seq: 1 });
    controller.applyRemote(auth.current);
    expect(adapter.calls).toHaveLength(0); // 0.2s < 0.5s threshold, rate equal
  });

  it('drops stale and duplicate sequence numbers', () => {
    const { controller, adapter, auth } = harness;
    auth.current = state({ playing: true, seq: 5 });
    controller.applyRemote(auth.current);
    const callsAfterFirst = adapter.calls.length;
    controller.applyRemote(state({ playing: false, seq: 5 })); // duplicate
    controller.applyRemote(state({ playing: false, seq: 4 })); // stale
    expect(adapter.calls.length).toBe(callsAfterFirst);
  });
});

describe('echo prevention (intent ledger)', () => {
  it('never re-broadcasts player events caused by synchronization', () => {
    const { controller, adapter, auth } = harness;
    auth.current = state({ playing: true, seq: 1 });
    controller.applyRemote(auth.current); // issues play() + intent
    adapter.fire({ type: 'play', time: 0 }); // the echo
    expect(syncEmits()).toHaveLength(0);
  });

  it('emits exactly one event for a genuine user action, collapsing duplicates', () => {
    const { adapter, auth } = harness;
    auth.current = state({ playing: false, seq: 1 });
    adapter.fire({ type: 'play', time: 10 }); // user pressed play — no intent
    adapter.fire({ type: 'play', time: 10 }); // double-fired player event
    const plays = syncEmits().filter((e) => e.event === 'sync:play');
    expect(plays).toHaveLength(1);
    expect((plays[0]!.payload as { eventId?: string }).eventId).toBeTruthy();
  });

  it('non-controllers never emit — the player snaps back to authority', () => {
    const { adapter, auth, flags } = harness;
    flags.canControl = false;
    auth.current = state({ playing: false, time: 0, seq: 1 });
    adapter.state = 'playing'; // someone poked the iframe
    adapter.fire({ type: 'play', time: 3 });
    expect(syncEmits()).toHaveLength(0);
    expect(adapter.calls).toContain('pause'); // re-asserted authority
  });

  it('debounces scrubbing into a single SEEK', () => {
    const { adapter, auth } = harness;
    auth.current = state({ playing: false, seq: 1 });
    adapter.fire({ type: 'seek', time: 10 });
    adapter.fire({ type: 'seek', time: 20 });
    adapter.fire({ type: 'seek', time: 30 });
    vi.advanceTimersByTime(500);
    const seeks = syncEmits().filter((e) => e.event === 'sync:seek');
    expect(seeks).toHaveLength(1);
    expect((seeks[0]!.payload as { time: number }).time).toBe(30);
  });
});

describe('drift correction', () => {
  // The derived target advances with the (fake) wall clock: after one tick
  // (2s) a state anchored at time=100 expects position 102.
  it('nudges rate gently for small drift, restores when aligned', () => {
    const { adapter, auth } = harness;
    auth.current = state({ playing: true, time: 100, seq: 1 });
    adapter.state = 'playing';
    adapter.time = 102.3; // will be 300ms ahead of the derived target (102)
    vi.advanceTimersByTime(DRIFT_CHECK_INTERVAL_MS);
    const nudge = adapter.calls.find((c) => c.startsWith('rate:'));
    expect(nudge).toBeDefined();
    expect(Number(nudge!.split(':')[1])).toBeLessThan(1);
    expect(adapter.calls.filter((c) => c.startsWith('seek:'))).toHaveLength(0);

    // Aligned again → restore authoritative rate.
    adapter.time = 104; // matches the derived target after the second tick
    vi.advanceTimersByTime(DRIFT_CHECK_INTERVAL_MS);
    expect(adapter.calls.at(-1)).toBe('rate:1.000');
  });

  it('hard seeks exactly once past 500ms drift', () => {
    const { adapter, auth } = harness;
    auth.current = state({ playing: true, time: 100, seq: 1 });
    adapter.state = 'playing';
    adapter.time = 101; // 1s behind the derived target (102)
    vi.advanceTimersByTime(DRIFT_CHECK_INTERVAL_MS);
    expect(adapter.calls.filter((c) => c.startsWith('seek:'))).toHaveLength(1);
    expect(syncEmits()).toHaveLength(0); // corrections never hit the wire
  });

  it('host re-anchors once when drifted, never self-corrects', () => {
    const { adapter, auth, flags } = harness;
    flags.isHost = true;
    auth.current = state({ playing: true, time: 100, seq: 1 });
    adapter.state = 'playing';
    adapter.time = 95; // host buffered behind the derived state
    vi.advanceTimersByTime(DRIFT_CHECK_INTERVAL_MS);
    expect(adapter.calls.filter((c) => c.startsWith('seek:'))).toHaveLength(0);
    const anchors = syncEmits().filter((e) => e.event === 'sync:play');
    expect(anchors).toHaveLength(1);
    // Next tick, still inside the heartbeat interval → no second anchor.
    vi.advanceTimersByTime(DRIFT_CHECK_INTERVAL_MS);
    expect(syncEmits().filter((e) => e.event === 'sync:play')).toHaveLength(1);
  });
});

describe('capability degradation', () => {
  it('leaves canSync()=false providers (Drive preview) completely alone', () => {
    const { controller, adapter, auth } = harness;
    adapter.caps = { sync: false, seek: false, rate: false };
    auth.current = state({ playing: true, seq: 1 });
    controller.applyRemote(auth.current);
    vi.advanceTimersByTime(DRIFT_CHECK_INTERVAL_MS * 3);
    expect(adapter.calls).toHaveLength(0);
    expect(syncEmits()).toHaveLength(0);
  });

  it('never seeks or rate-nudges live streams (canSeek/canSetRate false)', () => {
    const { adapter, auth } = harness;
    adapter.caps = { sync: true, seek: false, rate: false };
    auth.current = state({ playing: true, time: 100, seq: 1 });
    adapter.state = 'playing';
    adapter.time = 200; // hopelessly "drifted" — but it's live
    vi.advanceTimersByTime(DRIFT_CHECK_INTERVAL_MS);
    expect(adapter.calls.filter((c) => c.startsWith('seek:'))).toHaveLength(0);
    expect(adapter.calls.filter((c) => c.startsWith('rate:'))).toHaveLength(0);
  });
});

describe('local UI facade (cinema bar) never synchronizes', () => {
  it('volume, mute, native-controls and playhead reads emit nothing', () => {
    const { controller, adapter } = harness;
    controller.setVolume(0.5);
    controller.setMuted(true);
    controller.setNativeControls(false);
    const playhead = controller.getPlayhead();
    expect(adapter.volume).toBe(0.5);
    expect(adapter.muted).toBe(true);
    expect(adapter.nativeControls).toBe(false);
    expect(playhead).toEqual({ time: 0, duration: 600, seekable: true });
    expect(emitted).toHaveLength(0);
  });
});

describe('autoplay handling', () => {
  it('retries a stalled play once, then surfaces click-to-play — no retry storm', async () => {
    const onAutoplayBlocked = vi.fn();
    harness.controller.dispose();
    harness = await setup({ onAutoplayBlocked });
    const { adapter, auth } = harness;

    auth.current = state({ playing: true, seq: 1 });
    adapter.state = 'paused';
    // Make play() ineffective, as under autoplay policy.
    adapter.play = () => {
      adapter.calls.push('play');
    };
    vi.advanceTimersByTime(DRIFT_CHECK_INTERVAL_MS); // retry once
    vi.advanceTimersByTime(DRIFT_CHECK_INTERVAL_MS); // give up → overlay
    vi.advanceTimersByTime(DRIFT_CHECK_INTERVAL_MS * 3); // no further attempts
    expect(adapter.calls.filter((c) => c === 'play')).toHaveLength(1);
    expect(onAutoplayBlocked).toHaveBeenCalledTimes(1);
  });
});
