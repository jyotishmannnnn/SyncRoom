import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import type { Response } from 'express';
import { config } from './config';
import { DriveError, openDriveMedia, type DriveMedia } from './driveClient';

/**
 * On-the-fly Google Drive → HLS transcoder.
 *
 * Browsers can only decode a handful of containers/codecs in <video>
 * (MP4/H.264, WebM, Ogg). A Drive file in anything else (MPEG-2 .MPG, MKV,
 * AVI, HEVC…) can otherwise only play in Drive's own preview iframe, which
 * exposes no playback API and so can't be synchronized. This module re-encodes
 * such a file to H.264/AAC and segments it as HLS, which the client plays
 * through hls.js in the fully-synced HTML5 player.
 *
 * One ffmpeg process per distinct file id, SHARED by every viewer watching it
 * (the encode is keyed on the id, not the request). Sessions are capped and
 * reaped after an idle grace so a watch party can't leave encoders running.
 *
 * Input strategy: streamable containers (MKV, AVI, MPEG-TS…) are piped into
 * ffmpeg's stdin as they download, so the first segment appears within
 * seconds. QuickTime-family containers (MP4/MOV/M4V/3GP) usually keep their
 * moov atom at the END of the file; ffmpeg cannot probe those from a
 * non-seekable pipe ("Cannot determine format of input stream after EOF"),
 * so they are downloaded to disk first and encoded from the file.
 *
 * The playlist endpoint short-polls: while the encode is warming up it throws
 * `pending` (mapped to 503 + Retry-After) instead of holding the request open
 * past proxy timeouts; hls.js retries until the first segment exists.
 */

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;
/** ffmpeg writes seg00000.ts, seg00001.ts…; nothing else is servable. */
const SEGMENT = /^seg\d{5}\.ts$/;
const PLAYLIST = 'index.m3u8';
/** Containers whose index (moov atom) may trail the media, so stdin won't do. */
const SEEKABLE_INPUT_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', '3gp', '3g2']);

export type TranscodeErrorKind = 'bad-id' | 'busy' | 'upstream' | 'ffmpeg' | 'timeout' | 'pending';

export class TranscodeError extends Error {
  constructor(
    readonly kind: TranscodeErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = 'TranscodeError';
  }
}

/** Which input plumbing a filename needs (exported for tests). */
export function inputStrategyFor(filename: string | null): 'pipe' | 'file' {
  const ext = filename ? /\.([A-Za-z0-9]+)$/.exec(filename)?.[1]?.toLowerCase() : undefined;
  return ext && SEEKABLE_INPUT_EXTENSIONS.has(ext) ? 'file' : 'pipe';
}

interface Session {
  id: string;
  dir: string;
  /** Null while a file-strategy download is still in progress. */
  proc: ChildProcess | null;
  abort: AbortController;
  lastAccess: number;
  failed: boolean;
  /** Tail of ffmpeg's stderr, for diagnostics on failure. */
  stderr: string;
  startedAt: number;
  /** Last time input bytes arrived (download) — feeds the stall detector. */
  lastProgressAt: number;
  /** Resolves once the playlist references its first segment; rejects on failure. */
  ready: Promise<void>;
}

function ffmpegArgs(input: string, dir: string): string[] {
  // veryfast/crf 23 keeps a live encode ahead of real-time playback on a
  // shared CPU; yuv420p + high@4.1 is the maximally-compatible H.264 profile.
  // An "event" playlist grows as segments are written, so hls.js can start
  // (and seek within) the encoded range while the tail is still encoding.
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'high',
    '-level',
    '4.1',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-ac',
    '2',
    '-f',
    'hls',
    '-hls_time',
    '4',
    '-hls_list_size',
    '0',
    '-hls_playlist_type',
    'event',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_filename',
    path.join(dir, 'seg%05d.ts'),
    path.join(dir, PLAYLIST),
  ];
}

/** True once the playlist exists AND names at least one segment file. */
async function playlistHasSegment(dir: string): Promise<boolean> {
  try {
    const text = await readFile(path.join(dir, PLAYLIST), 'utf8');
    if (!text.includes('.ts')) return false;
    const files = await readdir(dir);
    return files.some((f) => SEGMENT.test(f));
  } catch {
    return false;
  }
}

/** Can `bin -version` actually run? Distinguishes a real binary from ENOENT. */
function canRunFfmpeg(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawn(bin, ['-version'], { stdio: 'ignore' });
    } catch {
      return resolve(false);
    }
    proc.on('error', () => resolve(false));
    proc.on('exit', (code) => resolve(code === 0));
  });
}

let ffmpegResolution: Promise<string | null> | null = null;

/**
 * Resolves the ffmpeg binary actually usable on this host, once, at first
 * use. `config.ffmpegPath` points at FFMPEG_PATH, then the ffmpeg-static
 * bundled binary, then PATH — but the bundled binary is downloaded by an npm
 * postinstall script and can silently be missing (blocked egress,
 * --ignore-scripts), which previously surfaced only as an opaque transcode
 * failure. Probing with `-version` and falling back to PATH `ffmpeg` turns
 * that into a logged, recoverable condition.
 */
export function resolveFfmpeg(): Promise<string | null> {
  ffmpegResolution ??= (async () => {
    const candidates = [...new Set([config.ffmpegPath, 'ffmpeg'])];
    for (const bin of candidates) {
      if (await canRunFfmpeg(bin)) {
        console.log(`[transcode] using ffmpeg: ${bin}`);
        return bin;
      }
      console.warn(`[transcode] ffmpeg candidate not runnable: ${bin}`);
    }
    console.error(
      '[transcode] NO working ffmpeg found — Drive transcoding disabled. ' +
        'Install ffmpeg or set FFMPEG_PATH.',
    );
    return null;
  })();
  return ffmpegResolution;
}

export class TranscodeManager {
  private readonly sessions = new Map<string, Session>();
  /** In-flight starts, so concurrent first-hits share one encode, not N. */
  private readonly starting = new Map<string, Promise<Session>>();
  private readonly sweeper: ReturnType<typeof setInterval>;

  constructor() {
    this.sweeper = setInterval(() => void this.sweep(), 10_000);
    this.sweeper.unref();
  }

  /**
   * Playlist bytes for a file id, starting the encode on first request.
   * Throws `pending` while the encode is still warming up (the route maps it
   * to 503 + Retry-After and the client retries) so no request is ever held
   * open longer than `transcodePollWaitMs`.
   */
  async getPlaylist(id: string): Promise<Buffer> {
    if (!DRIVE_ID.test(id)) throw new TranscodeError('bad-id');
    const session = await this.ensure(id);
    session.lastAccess = Date.now();
    const ready = await Promise.race([
      session.ready.then(() => true),
      new Promise<false>((resolve) => {
        const t = setTimeout(() => resolve(false), config.transcodePollWaitMs);
        t.unref();
      }),
    ]);
    if (!ready) throw new TranscodeError('pending');
    session.lastAccess = Date.now();
    return readFile(path.join(session.dir, PLAYLIST));
  }

  /**
   * Kicks off an encode without waiting for it (fire-and-forget). Called when
   * the direct-stream proxy rejects a container it knows no browser can play,
   * so by the time the client swaps to the HLS player the first segment is
   * already cooking.
   */
  prewarm(id: string): void {
    if (!DRIVE_ID.test(id)) return;
    void this.ensure(id)
      .then((s) => s.ready)
      .catch((err: unknown) => {
        const kind = err instanceof TranscodeError ? err.kind : 'unknown';
        console.warn(`[transcode] prewarm ${id} failed (${kind})`);
      });
  }

  /**
   * Absolute path of an already-encoded segment, or null if the id/name is
   * invalid or the session/segment isn't present yet (hls.js will retry).
   */
  segmentPath(id: string, name: string): string | null {
    if (!DRIVE_ID.test(id) || !SEGMENT.test(name)) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    session.lastAccess = Date.now();
    return path.join(session.dir, name);
  }

  private ensure(id: string): Promise<Session> {
    const existing = this.sessions.get(id);
    if (existing && !existing.failed) return Promise.resolve(existing);
    let pending = this.starting.get(id);
    if (!pending) {
      pending = this.start(id).finally(() => this.starting.delete(id));
      this.starting.set(id, pending);
    }
    return pending;
  }

  private async start(id: string): Promise<Session> {
    if (!config.transcodeEnabled) throw new TranscodeError('ffmpeg', 'transcoding disabled');
    const ffmpeg = await resolveFfmpeg();
    if (!ffmpeg) throw new TranscodeError('ffmpeg', 'no ffmpeg binary available');
    // Reap a dead session for this id before counting toward the cap.
    const stale = this.sessions.get(id);
    if (stale?.failed) await this.evict(id);
    if (this.sessions.size >= config.maxTranscodeSessions) {
      console.warn(`[transcode] ${id}: rejected, at capacity (${this.sessions.size})`);
      throw new TranscodeError('busy');
    }

    const dir = await mkdtemp(path.join(tmpdir(), `syncroom-hls-${id}-`));
    const abort = new AbortController();

    let media: DriveMedia;
    try {
      // Full file, no Range: the encoder reads start-to-end. The drive client
      // guarantees actual media bytes or throws a precise DriveError (quota,
      // not-public, not-found, upstream) — HTML can never reach ffmpeg.
      media = await openDriveMedia(id, undefined, abort.signal);
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      const detail = err instanceof DriveError ? `${err.kind}: ${err.message}` : String(err);
      console.warn(`[transcode] ${id}: Drive fetch failed (${detail})`);
      throw new TranscodeError('upstream', `Drive download failed (${detail})`);
    }
    const upstream = media.response;

    const filename = media.filename;
    // Google's preview-stream fallback is always a faststart MP4 (moov atom
    // up front, built for streaming), so it pipes fine whatever the original
    // filename's extension claims.
    const strategy = media.source === 'stream' ? 'pipe' : inputStrategyFor(filename);
    const size = upstream.headers.get('content-length') ?? '?';
    console.log(
      `[transcode] ${id}: start (file="${filename ?? 'unknown'}", ${size} bytes, ` +
        `source=${media.source}, strategy=${strategy})`,
    );

    const session: Session = {
      id,
      dir,
      proc: null,
      abort,
      lastAccess: Date.now(),
      failed: false,
      stderr: '',
      startedAt: Date.now(),
      lastProgressAt: Date.now(),
      ready: undefined as unknown as Promise<void>,
    };

    const attachProc = (proc: ChildProcess): void => {
      session.proc = proc;
      proc.stderr?.on('data', (chunk: Buffer) => {
        session.stderr = (session.stderr + chunk.toString()).slice(-2000);
      });
      // spawn failure (e.g. ffmpeg vanished) surfaces here, not as a throw.
      proc.on('error', (err) => {
        session.stderr += ` [spawn error: ${String(err)}]`;
        session.failed = true;
      });
    };

    const body = Readable.fromWeb(upstream.body as unknown as NodeWebReadableStream<Uint8Array>);
    body.on('data', () => {
      session.lastProgressAt = Date.now();
    });

    if (strategy === 'pipe') {
      // Encode while downloading: first segment appears within seconds.
      const proc = spawn(ffmpeg, ffmpegArgs('pipe:0', dir), {
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      attachProc(proc);
      // EPIPE is expected when ffmpeg exits early (bad input); swallow it so
      // it doesn't crash the process.
      body.on('error', () => proc.kill('SIGKILL'));
      if (proc.stdin) {
        proc.stdin.on('error', () => {});
        body.pipe(proc.stdin);
      }
      proc.on('exit', () => body.destroy());
    } else {
      // QuickTime family: moov atom may trail the media, ffmpeg needs a
      // seekable input. Download fully, then encode from disk.
      const inputPath = path.join(dir, 'input.bin');
      const sink = createWriteStream(inputPath);
      const failDownload = (err: unknown): void => {
        session.stderr += ` [download error: ${String(err)}]`;
        session.failed = true;
        sink.destroy();
      };
      body.on('error', failDownload);
      sink.on('error', failDownload);
      sink.on('finish', () => {
        if (session.failed) return;
        const secs = ((Date.now() - session.startedAt) / 1000).toFixed(1);
        console.log(`[transcode] ${id}: download complete in ${secs}s, starting encode`);
        session.lastProgressAt = Date.now();
        attachProc(spawn(ffmpeg, ffmpegArgs(inputPath, dir), { stdio: ['ignore', 'ignore', 'pipe'] }));
      });
      body.pipe(sink);
    }

    session.ready = this.awaitPlaylist(session);
    // Don't leave an unhandled rejection if nobody is awaiting yet.
    session.ready.catch(() => {});
    this.sessions.set(id, session);
    return session;
  }

  private awaitPlaylist(session: Session): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const fail = (err: TranscodeError): void => {
        session.failed = true;
        console.warn(
          `[transcode] ${session.id}: FAILED (${err.kind}) ${err.message}` +
            (session.stderr ? ` | ffmpeg stderr: …${session.stderr.slice(-300)}` : ''),
        );
        reject(err);
      };
      const tick = async (): Promise<void> => {
        if (await playlistHasSegment(session.dir)) {
          const secs = ((Date.now() - session.startedAt) / 1000).toFixed(1);
          console.log(`[transcode] ${session.id}: first segment ready after ${secs}s`);
          return resolve();
        }
        // ffmpeg gone (spawn error or non-zero exit) with no playlist = failure.
        if (session.failed || (session.proc && session.proc.exitCode !== null)) {
          return fail(
            new TranscodeError(
              'ffmpeg',
              `ffmpeg exited with code ${session.proc?.exitCode ?? '?'}: ${session.stderr.slice(-300)}`,
            ),
          );
        }
        const now = Date.now();
        // Stall detector: no input bytes AND no first segment for the window.
        if (now - session.lastProgressAt > config.transcodeStartTimeoutMs) {
          return fail(new TranscodeError('timeout', 'no download progress / no first segment'));
        }
        // Absolute ceiling so a glacial download can't hold a slot forever.
        if (now - session.startedAt > config.transcodeMaxStartMs) {
          return fail(new TranscodeError('timeout', 'first segment not ready within ceiling'));
        }
        setTimeout(() => void tick(), 250);
      };
      void tick();
    });
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (s.failed || now - s.lastAccess > config.transcodeIdleMs) await this.evict(id);
    }
  }

  private async evict(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    session.abort.abort();
    session.proc?.kill('SIGKILL');
    await rm(session.dir, { recursive: true, force: true }).catch(() => {});
  }

  /** Tear down every session (process shutdown). */
  async dispose(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all([...this.sessions.keys()].map((id) => this.evict(id)));
  }

  /**
   * Streams a playlist or segment to an Express response. Keeps route handlers
   * thin and centralizes content-type / cache headers.
   */
  async serve(id: string, file: string, res: Response): Promise<void> {
    if (file === PLAYLIST) {
      const playlist = await this.getPlaylist(id);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store');
      res.send(playlist);
      return;
    }
    const segPath = this.segmentPath(id, file);
    if (!segPath) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'no-store');
    const stream = createReadStream(segPath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.destroy();
    });
    stream.pipe(res);
  }
}

export const transcodeManager = new TranscodeManager();
