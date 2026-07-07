import { parse as parseHtml } from 'node-html-parser';

/**
 * Google Drive media resolver — a small state machine that follows Google's
 * public-file download flow until it has actual video bytes or a precise,
 * unrecoverable error.
 *
 * States:
 *
 *   DIRECT     GET drive.usercontent.google.com/download (original bytes).
 *      │         media → done (source: 'download')
 *      ▼
 *   CLASSIFY   The response was HTML. Parse it (a real HTML parser, never
 *      │       regexes) and decide which page Google served:
 *      │         virus-scan interstitial → CONFIRM
 *      │         "Quota exceeded"        → STREAM
 *      │         sign-in                 → error 'not-public'
 *      │         anything else           → STREAM (best effort)
 *      ▼
 *   CONFIRM    Resubmit the interstitial's hidden <form> (confirm token +
 *      │       uuid), echoing every cookie Google set. Media → done;
 *      │       HTML again → CLASSIFY (one hop only, no loops).
 *      ▼
 *   STREAM     GET drive.google.com/get_video_info?docid=… — the endpoint
 *              Drive's own preview player uses. Its download quota is
 *              separate from the download endpoint's, so files that are
 *              "Quota exceeded" for download usually still stream. Google
 *              serves ITS OWN H.264/AAC MP4 transcode (itag 37/22/18 =
 *              1080p/720p/360p, moov atom up front), fetched from
 *              googlevideo with the DRIVE_STREAM cookie. Media → done
 *              (source: 'stream'); refusal → precise error.
 *
 * Every hop shares one per-request cookie jar. Successful stream resolutions
 * are cached briefly (the signed URLs are reusable) so seeking — dozens of
 * Range requests — doesn't re-run the whole flow against Google each time.
 */

const DOWNLOAD = 'https://drive.usercontent.google.com/download';
const VIDEO_INFO = 'https://drive.google.com/get_video_info';
/** Chrome-ish UA: Google serves the plain no-JS download flow to it. */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SyncRoom/1.0';
/** Highest first; all are H.264/AAC MP4 renditions of the preview stream. */
const ITAG_PREFERENCE = ['37', '22', '18'];
/** How long a resolved stream URL may be reused before re-resolving. */
const STREAM_CACHE_TTL_MS = 10 * 60_000;
const STREAM_CACHE_MAX = 100;

export type DriveErrorKind = 'quota' | 'not-public' | 'not-found' | 'upstream' | 'network';

export class DriveError extends Error {
  constructor(
    readonly kind: DriveErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = 'DriveError';
  }
}

export interface DriveMedia {
  /** Upstream response whose body is the live media stream. */
  response: globalThis.Response;
  /** 'download' = the original file's bytes; 'stream' = Google's own H.264 MP4 preview transcode. */
  source: 'download' | 'stream';
  /** Original filename (display / container detection for 'download' bytes). */
  filename: string | null;
  /** MIME of the bytes actually being served (NOT of the original filename). */
  mime: string | null;
}

/* ------------------------------- helpers ------------------------------- */

/**
 * Extracts the filename from an upstream Content-Disposition header. Google
 * always sends `attachment; filename="…"` (and usually an RFC 5987
 * `filename*=UTF-8''…` twin for non-ASCII names); the starred form is
 * preferred since it survives arbitrary characters. Returns null if the
 * header is absent or names nothing.
 */
export function filenameFromDisposition(res: globalThis.Response): string | null {
  const disposition = res.headers.get('content-disposition');
  if (!disposition) return null;
  const starred = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(disposition)?.[1];
  if (starred) {
    try {
      return decodeURIComponent(starred.trim());
    } catch {
      // Malformed percent-encoding, fall through to the plain form.
    }
  }
  return /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
}

/** Extensions browsers can decode in <video>, mapped to their MIME types. */
const PLAYABLE_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
  mov: 'video/mp4', // Many .mov files are H.264/AAC in an MP4-compatible box.
};

/**
 * Containers no browser's <video> element can decode. Used to fail fast with
 * a helpful message instead of streaming megabytes the player will reject.
 */
export const UNPLAYABLE_EXTENSIONS = new Set([
  'mpg',
  'mpeg',
  'mkv',
  'avi',
  'wmv',
  'flv',
  'ts',
  'm2ts',
  'vob',
  '3gp',
  'rmvb',
]);

export function extensionOf(name: string | null): string | null {
  const ext = name ? /\.([A-Za-z0-9]+)$/.exec(name)?.[1] : undefined;
  return ext ? ext.toLowerCase() : null;
}

/**
 * Maps a filename to the MIME type a browser needs to play it, or null when
 * the extension is unknown or not browser-playable. Drive labels everything
 * `application/octet-stream`, which some browsers refuse to sniff as video,
 * so the proxy restores a real type from the name where it can.
 */
export function videoMimeForFilename(name: string | null): string | null {
  const ext = extensionOf(name);
  return ext ? (PLAYABLE_MIME[ext] ?? null) : null;
}

/** True when the filename's container is known to be un-playable in <video>. */
export function isUnplayableContainer(name: string | null): boolean {
  const ext = extensionOf(name);
  return !!ext && UNPLAYABLE_EXTENSIONS.has(ext);
}

/** Name=value cookie jar shared across the hops of one resolution flow. */
export class CookieJar {
  private readonly store = new Map<string, string>();

  absorb(res: globalThis.Response): void {
    const jar =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : ((): string[] => {
            const raw = res.headers.get('set-cookie');
            return raw ? [raw] : [];
          })();
    for (const cookie of jar) {
      const pair = cookie.split(';', 1)[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq > 0) this.store.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  header(): string | null {
    if (this.store.size === 0) return null;
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

/* --------------------------- page classification --------------------------- */

export type DrivePage =
  | { kind: 'virus-scan'; confirmUrl: string }
  | { kind: 'quota' }
  | { kind: 'sign-in' }
  | { kind: 'unknown'; title: string };

/**
 * Decides which of Google's HTML pages the download endpoint served, using a
 * real HTML parse (element tree + text content), never regexes over markup.
 */
export function classifyDrivePage(html: string, finalUrl: string): DrivePage {
  if (finalUrl.includes('accounts.google.com')) return { kind: 'sign-in' };

  const root = parseHtml(html);
  const title = (root.querySelector('title')?.text ?? '').trim();
  const lowerTitle = title.toLowerCase();

  if (lowerTitle.includes('quota exceeded')) return { kind: 'quota' };
  if (lowerTitle.includes('sign in') || lowerTitle.includes('sign-in')) {
    return { kind: 'sign-in' };
  }

  // Virus-scan interstitial: a <form> posting back to the download endpoint
  // with hidden fields (id, export, confirm token, uuid). Rebuild its target
  // URL from the parsed form, field by field.
  for (const form of root.querySelectorAll('form')) {
    const action = form.getAttribute('action') ?? '';
    if (!action.includes('download')) continue;
    const url = new URL(action, DOWNLOAD);
    for (const input of form.querySelectorAll('input')) {
      const name = input.getAttribute('name');
      if (name) url.searchParams.set(name, input.getAttribute('value') ?? '');
    }
    if (url.searchParams.get('id')) return { kind: 'virus-scan', confirmUrl: url.toString() };
  }

  return { kind: 'unknown', title };
}

/* ------------------------------ stream cache ------------------------------ */

interface CachedStream {
  url: string;
  cookie: string | null;
  filename: string | null;
  expiresAt: number;
}

const streamCache = new Map<string, CachedStream>();

function cacheStream(id: string, entry: CachedStream): void {
  if (streamCache.size >= STREAM_CACHE_MAX) {
    const oldest = streamCache.keys().next().value;
    if (oldest !== undefined) streamCache.delete(oldest);
  }
  streamCache.set(id, entry);
}

/** Test seam: wipe the resolved-stream cache. */
export function clearStreamCache(): void {
  streamCache.clear();
}

/* ------------------------------ state machine ------------------------------ */

function isHtml(res: globalThis.Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('text/html');
}

async function get(
  url: string,
  jar: CookieJar,
  range: string | undefined,
  signal: AbortSignal,
): Promise<globalThis.Response> {
  const headers: Record<string, string> = { 'user-agent': USER_AGENT };
  if (range) headers.range = range;
  const cookie = jar.header();
  if (cookie) headers.cookie = cookie;
  let res: globalThis.Response;
  try {
    res = await fetch(url, { headers, redirect: 'follow', signal });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new DriveError('network', `fetch failed: ${String(err)}`);
  }
  jar.absorb(res);
  return res;
}

function downloadMedia(res: globalThis.Response): DriveMedia {
  const filename = filenameFromDisposition(res);
  const ct = res.headers.get('content-type') ?? '';
  const mime =
    !ct || ct.includes('application/octet-stream') ? videoMimeForFilename(filename) : ct;
  return { response: res, source: 'download', filename, mime };
}

/**
 * STREAM state: resolve and open Google's preview-player rendition of the
 * file. `get_video_info` answers `status=ok` with an itag|url map (and sets
 * the DRIVE_STREAM cookie the googlevideo host requires) even when the
 * download endpoint is quota-blocked, or `status=fail` with a reason we can
 * surface precisely.
 */
async function openStream(
  id: string,
  jar: CookieJar,
  range: string | undefined,
  signal: AbortSignal,
  why: string,
): Promise<DriveMedia> {
  const cached = streamCache.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    const res = await streamFetch(cached.url, cached.cookie, range, signal);
    if (res) {
      return { response: res, source: 'stream', filename: cached.filename, mime: 'video/mp4' };
    }
    streamCache.delete(id); // signed URL went stale; resolve fresh below
  }

  const infoRes = await get(`${VIDEO_INFO}?docid=${encodeURIComponent(id)}`, jar, undefined, signal);
  const info = new URLSearchParams(await infoRes.text());
  const status = info.get('status');
  if (status !== 'ok') {
    const reason = (info.get('reason') ?? 'no reason given').trim();
    const lower = reason.toLowerCase();
    console.warn(`[drive] ${id}: stream fallback refused (${why}): status=${status} reason="${reason}"`);
    if (lower.includes('quota') || lower.includes('too many')) {
      throw new DriveError('quota', `Drive download quota exceeded and preview stream refused: ${reason}`);
    }
    if (lower.includes('permission') || lower.includes('private') || lower.includes('sign')) {
      throw new DriveError('not-public', reason);
    }
    throw new DriveError('upstream', `get_video_info: ${reason}`);
  }

  const streams = new Map<string, string>();
  for (const entry of (info.get('fmt_stream_map') ?? '').split(',')) {
    const sep = entry.indexOf('|');
    if (sep > 0) streams.set(entry.slice(0, sep), entry.slice(sep + 1));
  }
  const url = ITAG_PREFERENCE.map((itag) => streams.get(itag)).find(Boolean);
  if (!url) {
    throw new DriveError('upstream', 'get_video_info returned ok but no playable streams');
  }

  const cookie = jar.header();
  const filename = info.get('title');
  const res = await streamFetch(url, cookie, range, signal);
  if (!res) {
    throw new DriveError(
      'quota',
      'Drive download quota exceeded and the preview stream URL was refused',
    );
  }
  const chosen = [...streams.entries()].find(([, u]) => u === url)?.[0];
  console.log(`[drive] ${id}: serving preview stream (itag ${chosen}) — ${why}`);
  cacheStream(id, { url, cookie, filename, expiresAt: Date.now() + STREAM_CACHE_TTL_MS });
  return { response: res, source: 'stream', filename, mime: 'video/mp4' };
}

/** Fetch a googlevideo stream URL; null when it doesn't answer with media. */
async function streamFetch(
  url: string,
  cookie: string | null,
  range: string | undefined,
  signal: AbortSignal,
): Promise<globalThis.Response | null> {
  const headers: Record<string, string> = { 'user-agent': USER_AGENT };
  if (cookie) headers.cookie = cookie;
  if (range) headers.range = range;
  let res: globalThis.Response;
  try {
    res = await fetch(url, { headers, redirect: 'follow', signal });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new DriveError('network', `stream fetch failed: ${String(err)}`);
  }
  if ((res.status !== 200 && res.status !== 206) || isHtml(res) || !res.body) {
    res.body?.cancel().catch(() => {});
    return null;
  }
  return res;
}

/**
 * Follows Google's download flow (DIRECT → CLASSIFY → CONFIRM → STREAM) until
 * video bytes are open or a precise DriveError is thrown. `range` is
 * forwarded so browser seeks hit the media host directly.
 */
export async function openDriveMedia(
  id: string,
  range: string | undefined,
  signal: AbortSignal,
): Promise<DriveMedia> {
  const jar = new CookieJar();

  // A previous request already established that only the stream works; skip
  // straight to it instead of bouncing off the quota page on every seek.
  if (streamCache.has(id)) return openStream(id, jar, range, signal, 'cached resolution');

  // DIRECT
  let res = await get(`${DOWNLOAD}?id=${encodeURIComponent(id)}&export=download&confirm=t`, jar, range, signal);

  if (!isHtml(res)) {
    if (res.status === 404) throw new DriveError('not-found', 'Drive file not found');
    if (res.status === 200 || res.status === 206) {
      if (!res.body) throw new DriveError('upstream', `download returned ${res.status} with no body`);
      return downloadMedia(res);
    }
    if (res.status === 403) throw new DriveError('not-public', `download returned 403`);
    throw new DriveError('upstream', `download returned ${res.status}`);
  }

  // CLASSIFY (+ at most one CONFIRM hop)
  for (let hop = 0; hop < 2; hop += 1) {
    const page = classifyDrivePage(await res.text(), res.url);
    switch (page.kind) {
      case 'virus-scan': {
        if (hop > 0) throw new DriveError('upstream', 'confirm flow looped back to interstitial');
        console.log(`[drive] ${id}: virus-scan interstitial, resubmitting confirm form`);
        res = await get(page.confirmUrl, jar, range, signal);
        if (!isHtml(res)) {
          if ((res.status === 200 || res.status === 206) && res.body) return downloadMedia(res);
          throw new DriveError('upstream', `confirm request returned ${res.status}`);
        }
        continue; // classify the new HTML page
      }
      case 'quota':
        console.warn(`[drive] ${id}: download quota exceeded, trying preview stream`);
        return openStream(id, jar, range, signal, 'download quota exceeded');
      case 'sign-in':
        throw new DriveError('not-public', 'Drive asked for sign-in (file is not public)');
      case 'unknown':
        console.warn(
          `[drive] ${id}: unrecognized interstitial (title="${page.title}"), trying preview stream`,
        );
        return openStream(id, jar, range, signal, `unrecognized page "${page.title}"`);
    }
  }
  throw new DriveError('upstream', 'download flow did not converge');
}
