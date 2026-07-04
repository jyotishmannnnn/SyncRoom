import type { MediaKind } from './types';

export interface ParsedMedia {
  kind: MediaKind;
  url: string;
  providerId?: string;
  title: string;
}

/** Why a pasted link was rejected — surfaced to the user verbatim-ish. */
export type MediaUrlErrorReason =
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'youtube-no-video'
  | 'vimeo-no-video'
  | 'twitch-no-video'
  | 'drive-not-a-file'
  | 'drm-unsupported';

export type MediaUrlResult =
  { ok: true; media: ParsedMedia } | { ok: false; reason: MediaUrlErrorReason };

export const MEDIA_URL_ERROR_TEXT: Record<MediaUrlErrorReason, string> = {
  'invalid-url': 'That does not look like a link. Paste a full URL starting with https://',
  'unsupported-protocol': 'Only http(s) links can be played.',
  'youtube-no-video':
    'That YouTube link has no video in it (playlists and channel pages are not supported — open the video and copy its URL).',
  'vimeo-no-video':
    'That Vimeo link has no video in it — open the video and copy its URL (e.g. vimeo.com/123456789).',
  'twitch-no-video':
    'That Twitch link is not playable here. Use a VOD (twitch.tv/videos/…) or a channel (twitch.tv/name). Clips are not supported.',
  'drive-not-a-file':
    'That Google Drive link is not a single file (folders are not supported — right-click the video file and copy its share link).',
  'drm-unsupported':
    'Netflix, Prime Video, Disney+ and similar subscription services use DRM and cannot be embedded. Use that service’s own watch-party, or share your screen instead.',
};

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeId(url: URL): string | null {
  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;
  if (url.hostname.endsWith('youtu.be')) {
    const id = url.pathname.slice(1).split('/')[0] ?? '';
    return YOUTUBE_ID.test(id) ? id : null;
  }
  const v = url.searchParams.get('v');
  if (v && YOUTUBE_ID.test(v)) return v;
  const parts = url.pathname.split('/').filter(Boolean);
  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) {
    const id = parts[1] ?? '';
    return YOUTUBE_ID.test(id) ? id : null;
  }
  return null;
}

/** Hosts that can carry a Google Drive file reference. */
const DRIVE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
]);

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

export function isDriveHost(url: URL): boolean {
  return DRIVE_HOSTS.has(url.hostname);
}

/**
 * Extracts a file id from every common Drive share shape:
 *   drive.google.com/file/d/<id>/view|preview|edit
 *   drive.google.com/open?id=<id>
 *   drive.google.com/uc?id=<id>[&export=download|view]
 *   docs.google.com/uc?id=<id>
 *   drive.usercontent.google.com/download?id=<id>
 */
export function parseDriveId(url: URL): string | null {
  if (!isDriveHost(url)) return null;
  const m = url.pathname.match(/\/file\/d\/([^/]+)/);
  if (m?.[1] && DRIVE_ID.test(m[1])) return m[1];
  const id = url.searchParams.get('id');
  if (id && DRIVE_ID.test(id)) return id;
  return null;
}

/**
 * Same-origin stream URL for a Drive file, served by the server's `/drive/:id`
 * proxy. Google blocks hotlinking a shared Drive file straight into a <video>
 * (virus-scan interstitial, no CORS, flaky Range support), which forced the
 * un-syncable preview iframe. The proxy resolves all of that server-side and
 * streams seekable bytes back same-origin, so Drive plays in the synced HTML5
 * player. Relative on purpose: dev proxies /drive to the server, prod serves
 * the SPA and the API from the same origin.
 */
export function driveDirectUrl(fileId: string): string {
  return `/drive/${fileId}`;
}

/** Iframe preview URL — always renders, but exposes no playback API (no sync). */
export function driveEmbedUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

/* ------------------------------- Vimeo ------------------------------- */

const VIMEO_HOSTS = new Set([
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com',
  'm.vimeo.com',
]);

export function isVimeoHost(url: URL): boolean {
  return VIMEO_HOSTS.has(url.hostname);
}

/**
 * Extracts a Vimeo numeric id (plus the unlisted-video privacy hash when
 * present) from every common share shape:
 *   vimeo.com/123456789
 *   vimeo.com/123456789/abcdef1234        (unlisted, hash in path)
 *   vimeo.com/channels/<name>/123456789
 *   vimeo.com/groups/<name>/videos/123456789
 *   player.vimeo.com/video/123456789?h=abcdef1234
 */
export function parseVimeo(url: URL): { id: string; hash?: string } | null {
  if (!isVimeoHost(url)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const idIdx = parts.findIndex((p) => /^\d+$/.test(p));
  if (idIdx === -1) return null;
  const id = parts[idIdx]!;
  let hash = url.searchParams.get('h') ?? undefined;
  const next = parts[idIdx + 1];
  if (!hash && next && /^[A-Za-z0-9]{6,}$/.test(next) && !/^\d+$/.test(next)) hash = next;
  return hash ? { id, hash } : { id };
}

/* ------------------------------- Twitch ------------------------------- */

const TWITCH_HOSTS = new Set([
  'twitch.tv',
  'www.twitch.tv',
  'm.twitch.tv',
  'player.twitch.tv',
  'clips.twitch.tv',
]);

/** Single-segment twitch.tv paths that are site sections, not channels. */
const TWITCH_RESERVED = new Set([
  'videos',
  'directory',
  'downloads',
  'jobs',
  'turbo',
  'settings',
  'subscriptions',
  'wallet',
  'friends',
  'store',
  'p',
  'clips',
  'clip',
]);

export function isTwitchHost(url: URL): boolean {
  return TWITCH_HOSTS.has(url.hostname);
}

/**
 * Resolves a Twitch URL to a seekable VOD (`video`) or a live `channel`.
 * Clips (a distinct, non-drivable embed) are intentionally not matched.
 *   twitch.tv/videos/123456789            -> video
 *   player.twitch.tv/?video=123456789     -> video
 *   twitch.tv/somechannel                 -> channel (live)
 *   player.twitch.tv/?channel=somechannel -> channel (live)
 */
export function parseTwitch(url: URL): { kind: 'video' | 'channel'; ref: string } | null {
  if (!isTwitchHost(url)) return null;
  // clips.twitch.tv is a distinct, non-drivable embed — never a channel/VOD.
  if (url.hostname === 'clips.twitch.tv') return null;
  if (url.hostname === 'player.twitch.tv') {
    const v = (url.searchParams.get('video') ?? '').replace(/^v/, '');
    if (/^\d+$/.test(v)) return { kind: 'video', ref: v };
    const c = url.searchParams.get('channel');
    if (c && /^[A-Za-z0-9_]{2,25}$/.test(c)) return { kind: 'channel', ref: c };
    return null;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'videos' && parts[1] && /^\d+$/.test(parts[1])) {
    return { kind: 'video', ref: parts[1] };
  }
  if (parts.length === 1) {
    const name = parts[0]!;
    if (!TWITCH_RESERVED.has(name.toLowerCase()) && /^[A-Za-z0-9_]{2,25}$/.test(name)) {
      return { kind: 'channel', ref: name };
    }
  }
  return null;
}

/* ---------------------- DRM / non-embeddable services ---------------------- */

/**
 * Subscription streaming services that use DRM and expose no legal embed API —
 * pasting one should get a clear explanation, never a mystifying playback error.
 */
const DRM_HOSTS = [
  'netflix.com',
  'primevideo.com',
  'disneyplus.com',
  'hotstar.com',
  'hulu.com',
  'max.com',
  'hbomax.com',
  'peacocktv.com',
  'paramountplus.com',
  'tv.apple.com',
  'crunchyroll.com',
  'jiocinema.com',
  'sonyliv.com',
  'zee5.com',
  'spotify.com',
];

export function isDrmHost(url: URL): boolean {
  const host = url.hostname.replace(/^www\./, '');
  return DRM_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

const FILE_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v)(?:$|[?#])/i;
const HLS_EXT = /\.m3u8(?:$|[?#])/i;
const DASH_EXT = /\.mpd(?:$|[?#])/i;

function fileNameFromPath(pathname: string): string {
  const last = pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Classifies a pasted URL into a playable media item, or a specific,
 * user-explainable rejection. Provider detection is automatic; the caller
 * never needs to know URL shapes.
 */
export function classifyMediaUrl(raw: string): MediaUrlResult {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported-protocol' };
  }

  if (YOUTUBE_HOSTS.has(url.hostname)) {
    const ytId = parseYouTubeId(url);
    if (!ytId) return { ok: false, reason: 'youtube-no-video' };
    return {
      ok: true,
      media: { kind: 'youtube', url: url.toString(), providerId: ytId, title: `YouTube · ${ytId}` },
    };
  }

  if (isVimeoHost(url)) {
    const v = parseVimeo(url);
    if (!v) return { ok: false, reason: 'vimeo-no-video' };
    return {
      ok: true,
      media: {
        kind: 'vimeo',
        // Canonical URL (with the privacy hash for unlisted videos) — the
        // @vimeo/player SDK accepts this directly via its `url` option.
        url: `https://vimeo.com/${v.id}${v.hash ? `/${v.hash}` : ''}`,
        providerId: v.id,
        title: `Vimeo · ${v.id}`,
      },
    };
  }

  if (isTwitchHost(url)) {
    const t = parseTwitch(url);
    if (!t) return { ok: false, reason: 'twitch-no-video' };
    return {
      ok: true,
      media: {
        kind: 'twitch',
        url: url.toString(),
        // Encoded so the adapter knows whether to embed a VOD or a channel.
        providerId: `${t.kind}:${t.ref}`,
        title: t.kind === 'video' ? `Twitch video · ${t.ref}` : `Twitch · ${t.ref}`,
      },
    };
  }

  if (isDriveHost(url)) {
    const driveId = parseDriveId(url);
    if (!driveId) return { ok: false, reason: 'drive-not-a-file' };
    return {
      ok: true,
      media: {
        kind: 'drive',
        url: driveDirectUrl(driveId),
        providerId: driveId,
        title: 'Google Drive video',
      },
    };
  }

  // DRM services must be caught before the generic "unknown host → file"
  // fallback, or e.g. netflix.com/watch/… would be mistaken for a direct file.
  if (isDrmHost(url)) {
    return { ok: false, reason: 'drm-unsupported' };
  }

  if (HLS_EXT.test(url.pathname)) {
    return {
      ok: true,
      media: { kind: 'hls', url: url.toString(), title: fileNameFromPath(url.pathname) },
    };
  }
  if (DASH_EXT.test(url.pathname)) {
    return {
      ok: true,
      media: { kind: 'dash', url: url.toString(), title: fileNameFromPath(url.pathname) },
    };
  }
  if (FILE_EXT.test(url.pathname)) {
    return {
      ok: true,
      media: { kind: 'file', url: url.toString(), title: fileNameFromPath(url.pathname) },
    };
  }

  // Unknown extension — let the HTML5 player attempt it (servers often omit extensions).
  return {
    ok: true,
    media: {
      kind: 'file',
      url: url.toString(),
      title: fileNameFromPath(url.pathname) || url.hostname,
    },
  };
}

/** Back-compat convenience: media on success, null on any rejection. */
export function parseMediaUrl(raw: string): ParsedMedia | null {
  const result = classifyMediaUrl(raw);
  return result.ok ? result.media : null;
}
