import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';

/**
 * Google Drive streaming proxy.
 *
 * Google blocks hotlinking a shared Drive file straight into a <video> element
 * (virus-scan interstitial, no CORS, unreliable Range support), which forced
 * SyncRoom into Drive's API-less preview iframe, where playback can't be
 * synchronized. This endpoint fetches the public file server-side (resolving
 * the confirm-token interstitial for large files) and streams the bytes back
 * to the client with Range support. The <video> then plays a same-origin,
 * seekable source and stays fully in sync, no API key required.
 *
 * It is not a general proxy: the upstream host is fixed to Google's download
 * origin and the id is format-validated, so it can't be pointed elsewhere.
 */

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;
const DOWNLOAD = 'https://drive.usercontent.google.com/download';
/** Upstream headers worth forwarding so the browser can seek and cache. */
const PASS_HEADERS = [
  'content-type',
  'content-length',
  'accept-ranges',
  'content-range',
  'last-modified',
  'etag',
];

/**
 * Extracts the hidden form fields from Drive's "can't scan for viruses" page.
 * Attribute order inside each <input> is not guaranteed, so name and value are
 * matched independently per tag.
 */
export function parseConfirmForm(html: string): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (const tag of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = /\bname="([^"]*)"/i.exec(tag[0])?.[1];
    if (!name) continue;
    params[name] = /\bvalue="([^"]*)"/i.exec(tag[0])?.[1] ?? '';
  }
  return params.id ? params : null;
}

/**
 * Builds the confirm-download URL from the interstitial HTML. Prefers the
 * hidden <form> fields (they carry the per-file confirm token + uuid); if the
 * markup shape changes, falls back to scraping a `confirm=…` link so a Google
 * template tweak degrades to best-effort instead of an outright failure.
 */
export function confirmUrlFrom(html: string, id: string): string | null {
  const params = parseConfirmForm(html);
  if (params) {
    const url = new URL(DOWNLOAD);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
  }
  const token = /[?&](?:amp;)?confirm=([\w-]+)/i.exec(html)?.[1];
  if (!token) return null;
  const url = new URL(DOWNLOAD);
  url.searchParams.set('id', id);
  url.searchParams.set('export', 'download');
  url.searchParams.set('confirm', token);
  const uuid = /[?&](?:amp;)?uuid=([\w-]+)/i.exec(html)?.[1];
  if (uuid) url.searchParams.set('uuid', uuid);
  return url.toString();
}

/**
 * Collapses a response's Set-Cookie headers into a single Cookie request
 * header (name=value pairs only). Google's large-file interstitial sets a
 * download-warning cookie that the confirm request is rejected without, so it
 * must be echoed, otherwise the second fetch loops straight back to HTML.
 */
export function cookieHeaderFrom(res: globalThis.Response): string | null {
  const jar =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : ((): string[] => {
          const raw = res.headers.get('set-cookie');
          return raw ? [raw] : [];
        })();
  const pairs = jar
    .map((c) => c.split(';', 1)[0]?.trim())
    .filter((p): p is string => !!p && p.includes('='));
  return pairs.length ? pairs.join('; ') : null;
}

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

function extensionOf(name: string | null): string | null {
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

export async function fetchDrive(
  id: string,
  range: string | undefined,
  signal: AbortSignal,
): Promise<globalThis.Response> {
  const headers: Record<string, string> = { 'user-agent': 'Mozilla/5.0 (SyncRoom)' };
  if (range) headers.range = range;

  const first = await fetch(
    `${DOWNLOAD}?id=${encodeURIComponent(id)}&export=download&confirm=t`,
    { headers, redirect: 'follow', signal },
  );
  const ct = first.headers.get('content-type') ?? '';
  if (!ct.includes('text/html')) return first;

  // Large-file virus-scan interstitial, resubmit the form it returned (carries
  // the per-file confirm token + uuid) to get the actual bytes, echoing any
  // cookie Google set on it, the confirm request 404s/loops back to HTML
  // without it.
  const confirmUrl = confirmUrlFrom(await first.text(), id);
  if (!confirmUrl) return first;
  const cookie = cookieHeaderFrom(first);
  const confirmHeaders: Record<string, string> = { ...headers };
  if (cookie) confirmHeaders.cookie = cookie;
  return fetch(confirmUrl, { headers: confirmHeaders, redirect: 'follow', signal });
}

export interface DriveProxyHooks {
  /**
   * Fired when the file's container is known to be un-playable in <video>
   * (the request 415s). The caller uses it to prewarm the HLS transcode, so
   * the first segment is already encoding by the time the client swaps
   * players.
   */
  onUnplayable?: (id: string) => void;
}

export async function driveProxy(
  req: Request,
  res: Response,
  hooks: DriveProxyHooks = {},
): Promise<void> {
  const id = String(req.params.id ?? '');
  if (!DRIVE_ID.test(id)) {
    res.status(400).json({ error: 'Invalid Drive file id.' });
    return;
  }

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  let upstream: globalThis.Response;
  try {
    upstream = await fetchDrive(id, req.headers.range, controller.signal);
  } catch (err) {
    if (!res.headersSent) {
      console.warn(`[drive] ${id}: fetch failed: ${String(err)}`);
      res.status(502).json({ error: 'Could not reach Google Drive.' });
    }
    return;
  }

  const ct = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok && upstream.status !== 206) {
    console.warn(`[drive] ${id}: upstream status ${upstream.status} (not accessible)`);
    res.status(upstream.status === 404 ? 404 : 403).json({
      error: 'This Drive file is not accessible, is it shared “Anyone with the link”?',
    });
    return;
  }
  if (ct.includes('text/html') || !upstream.body) {
    // Still a sign-in / interstitial page rather than a media stream.
    console.warn(`[drive] ${id}: upstream returned HTML (sign-in/quota interstitial)`);
    res.status(403).json({ error: 'Drive did not return a playable video for this file.' });
    return;
  }

  // Fail fast on containers no browser can decode: a clear error beats
  // streaming megabytes only for the <video> element to reject them. The
  // client reacts by requesting the HLS transcode of the same file, which we
  // prewarm here so its first segment is already cooking.
  const filename = filenameFromDisposition(upstream);
  if (isUnplayableContainer(filename)) {
    const ext = extensionOf(filename);
    console.log(`[drive] ${id}: unplayable container (${ext}), prewarming transcode`);
    hooks.onUnplayable?.(id);
    res.status(415).json({
      error: `This video format (${ext}) can’t be played in a browser directly; it will be converted for synced playback.`,
      code: 'unplayable-format',
    });
    return;
  }

  res.status(upstream.status); // 200, or 206 for a satisfied Range request
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  // Drive labels everything application/octet-stream; restore a real video
  // type from the filename so browsers don't refuse to sniff it. Must come
  // after the PASS_HEADERS loop so it wins over the upstream content-type.
  if (!ct || ct.includes('application/octet-stream')) {
    const mime = videoMimeForFilename(filename);
    if (mime) res.setHeader('Content-Type', mime);
  }
  if (!res.getHeader('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const body = Readable.fromWeb(upstream.body as unknown as NodeWebReadableStream<Uint8Array>);
  body.on('error', () => res.destroy());
  body.pipe(res);
}
