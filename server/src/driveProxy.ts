import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';

/**
 * Google Drive streaming proxy.
 *
 * Google blocks hotlinking a shared Drive file straight into a <video> element
 * (virus-scan interstitial, no CORS, unreliable Range support), which forced
 * SyncRoom into Drive's API-less preview iframe — where playback can't be
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
function parseConfirmForm(html: string): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (const tag of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = /\bname="([^"]*)"/i.exec(tag[0])?.[1];
    if (!name) continue;
    params[name] = /\bvalue="([^"]*)"/i.exec(tag[0])?.[1] ?? '';
  }
  return params.id ? params : null;
}

async function fetchDrive(
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

  // Large-file virus-scan interstitial — resubmit the form it returned
  // (carries the per-file confirm token + uuid) to get the actual bytes.
  const params = parseConfirmForm(await first.text());
  if (!params) return first;
  const url = new URL(DOWNLOAD);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return fetch(url, { headers, redirect: 'follow', signal });
}

export async function driveProxy(req: Request, res: Response): Promise<void> {
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
  } catch {
    if (!res.headersSent) res.status(502).json({ error: 'Could not reach Google Drive.' });
    return;
  }

  const ct = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok && upstream.status !== 206) {
    res.status(upstream.status === 404 ? 404 : 403).json({
      error: 'This Drive file is not accessible — is it shared “Anyone with the link”?',
    });
    return;
  }
  if (ct.includes('text/html') || !upstream.body) {
    // Still a sign-in / interstitial page rather than a media stream.
    res.status(403).json({ error: 'Drive did not return a playable video for this file.' });
    return;
  }

  res.status(upstream.status); // 200, or 206 for a satisfied Range request
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!res.getHeader('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const body = Readable.fromWeb(upstream.body as unknown as NodeWebReadableStream<Uint8Array>);
  body.on('error', () => res.destroy());
  body.pipe(res);
}
