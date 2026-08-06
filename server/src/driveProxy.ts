import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import {
  DriveError,
  extensionOf,
  isUnplayableContainer,
  openDriveMedia,
  openDrivePreviewStream,
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
/** Google's preview-transcode itags: 37=1080p, 22=720p, 18=360p. */
const VALID_ITAG = /^\d{1,3}$/;

/** Response headers the client-side quality picker reads off `/drive/:id`. */
export const QUALITY_HEADERS = ['X-Drive-Source', 'X-Drive-Itag', 'X-Drive-Available-Itags'];

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
  // Only meaningful when Google serves this file via its preview transcode
  // (source='stream'); the direct-download path has exactly one rendition
  // (the original upload) and ignores this. Malformed/unknown values just
  // fall back to the best available itag inside driveClient, never an error.
  const rawItag = req.query.itag;
  const itag = typeof rawItag === 'string' && VALID_ITAG.test(rawItag) ? rawItag : undefined;

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  let media;
  try {
    media = await openDriveMedia(id, req.headers.range, controller.signal, itag);
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

  // The original container can't play in <video> (MKV, AVI…). Before burning
  // CPU on a local ffmpeg re-encode, try Google's own preview rendition of the
  // file: it's H.264/AAC MP4 (browser-playable), faststart, Range-capable, and
  // encoded on Google's hardware — a local re-encode of e.g. 10-bit HEVC runs
  // slower than real time on this box, which stalls playback mid-watch. Only
  // when Drive has no preview stream does the 415 → HLS-transcode path run.
  // Only the ORIGINAL file's bytes can be unplayable — the preview-stream
  // fallback is always an H.264 MP4, whatever the original filename says.
  if (media.source === 'download' && isUnplayableContainer(media.filename)) {
    media.response.body?.cancel().catch(() => {});
    const ext = extensionOf(media.filename);
    console.log(
      `[drive] ${id}: state=UNPLAYABLE container .${ext} → trying Google preview stream before transcoding`,
    );
    try {
      media = await openDrivePreviewStream(
        id,
        req.headers.range,
        controller.signal,
        `unplayable container .${ext}`,
        itag,
      );
      console.log(`[drive] ${id}: state=UNPLAYABLE ✓ preview stream open, serving H.264 MP4 directly`);
    } catch (err) {
      if (res.headersSent || controller.signal.aborted) return;
      const detail = err instanceof DriveError ? `${err.kind}: ${err.message}` : String(err);
      console.warn(
        `[drive] ${id}: state=UNPLAYABLE ✗ no preview stream (${detail}) → 415, prewarming ffmpeg HLS transcode`,
      );
      hooks.onUnplayable?.(id);
      res.status(415).json({
        error: `This video format (${ext}) can’t be played in a browser directly; it will be converted for synced playback.`,
        code: 'unplayable-format',
      });
      return;
    }
  }

  const upstream = media.response;
  console.log(
    `[drive] ${id}: state=SERVE source=${media.source} status=${upstream.status} ` +
      `mime=${media.mime ?? 'unknown'} file="${media.filename ?? 'unknown'}"`,
  );
  res.status(upstream.status === 206 ? 206 : 200);
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  const mime = media.mime ?? videoMimeForFilename(media.filename);
  res.setHeader('Content-Type', mime ?? upstream.headers.get('content-type') ?? 'video/mp4');
  if (!res.getHeader('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  // Tells the client-side quality menu what's actually selectable for THIS
  // file: 'download' → one rendition (the original upload), no picker to
  // show; 'stream' → whichever of Google's 1080p/720p/360p renditions exist.
  res.setHeader('X-Drive-Source', media.source);
  if (media.itag) res.setHeader('X-Drive-Itag', media.itag);
  if (media.availableItags?.length) {
    res.setHeader('X-Drive-Available-Itags', media.availableItags.join(','));
  }

  const body = Readable.fromWeb(upstream.body as unknown as NodeWebReadableStream<Uint8Array>);
  body.on('error', () => res.destroy());
  body.pipe(res);
}
