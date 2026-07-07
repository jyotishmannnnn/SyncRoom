import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import {
  DriveError,
  extensionOf,
  isUnplayableContainer,
  openDriveMedia,
  videoMimeForFilename,
} from './driveClient';

/**
 * Google Drive streaming proxy.
 *
 * Google blocks hotlinking a shared Drive file straight into a <video> element
 * (virus-scan interstitial, no CORS, unreliable Range support, per-file
 * download quotas), which forced SyncRoom into Drive's API-less preview
 * iframe, where playback can't be synchronized. This endpoint resolves the
 * file server-side through the driveClient state machine (direct download →
 * confirm-token interstitial → preview-stream fallback when the download
 * quota is exhausted) and streams the bytes back to the client with Range
 * support. The <video> then plays a same-origin, seekable source and stays
 * fully in sync, no API key required.
 *
 * It is not a general proxy: the upstream hosts are fixed to Google's
 * download/preview origins and the id is format-validated, so it can't be
 * pointed elsewhere.
 */

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

/** Upstream headers worth forwarding so the browser can seek and cache. */
const PASS_HEADERS = [
  'content-length',
  'accept-ranges',
  'content-range',
  'last-modified',
  'etag',
];

export interface DriveProxyHooks {
  /**
   * Fired when the file's container is known to be un-playable in <video>
   * (the request 415s). The caller uses it to prewarm the HLS transcode, so
   * the first segment is already encoding by the time the client swaps
   * players.
   */
  onUnplayable?: (id: string) => void;
}

function statusForDriveError(err: DriveError): { status: number; error: string } {
  switch (err.kind) {
    case 'not-found':
      return { status: 404, error: 'This Drive file does not exist (or was deleted).' };
    case 'not-public':
      return {
        status: 403,
        error: 'This Drive file is not accessible, is it shared “Anyone with the link”?',
      };
    case 'quota':
      return {
        status: 429,
        error:
          'Google is rate-limiting downloads of this file (download quota exceeded). Try again later.',
      };
    default:
      return { status: 502, error: 'Could not fetch this file from Google Drive.' };
  }
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

  let media;
  try {
    media = await openDriveMedia(id, req.headers.range, controller.signal);
  } catch (err) {
    if (res.headersSent || controller.signal.aborted) return;
    if (err instanceof DriveError) {
      console.warn(`[drive] ${id}: ${err.kind}: ${err.message}`);
      const { status, error } = statusForDriveError(err);
      res.status(status).json({ error, code: err.kind });
    } else {
      console.warn(`[drive] ${id}: unexpected failure: ${String(err)}`);
      res.status(502).json({ error: 'Could not reach Google Drive.' });
    }
    return;
  }

  // Fail fast on containers no browser can decode: a clear error beats
  // streaming megabytes only for the <video> element to reject them. Only the
  // ORIGINAL file's bytes can be unplayable — the preview-stream fallback is
  // always an H.264 MP4, whatever the original filename says.
  if (media.source === 'download' && isUnplayableContainer(media.filename)) {
    media.response.body?.cancel().catch(() => {});
    const ext = extensionOf(media.filename);
    console.log(`[drive] ${id}: unplayable container (${ext}), prewarming transcode`);
    hooks.onUnplayable?.(id);
    res.status(415).json({
      error: `This video format (${ext}) can’t be played in a browser directly; it will be converted for synced playback.`,
      code: 'unplayable-format',
    });
    return;
  }

  const upstream = media.response;
  res.status(upstream.status === 206 ? 206 : 200);
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  const mime = media.mime ?? videoMimeForFilename(media.filename);
  res.setHeader('Content-Type', mime ?? upstream.headers.get('content-type') ?? 'video/mp4');
  if (!res.getHeader('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const body = Readable.fromWeb(upstream.body as unknown as NodeWebReadableStream<Uint8Array>);
  body.on('error', () => res.destroy());
  body.pipe(res);
}
