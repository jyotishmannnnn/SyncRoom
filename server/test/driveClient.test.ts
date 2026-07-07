import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyDrivePage,
  clearStreamCache,
  CookieJar,
  DriveError,
  filenameFromDisposition,
  isUnplayableContainer,
  openDriveMedia,
  videoMimeForFilename,
} from '../src/driveClient';

/** Minimal stand-in for Google's "can't scan for viruses" interstitial. */
const INTERSTITIAL = `<!doctype html><html><head><title>Google Drive - Virus scan warning</title></head><body>
  <form id="download-form" action="https://drive.usercontent.google.com/download" method="get">
    <input type="hidden" name="id" value="FILEID12345">
    <input type="hidden" name="export" value="download">
    <input type="hidden" name="authuser" value="0">
    <input type="hidden" name="confirm" value="abc123token">
    <input type="hidden" name="uuid" value="uuid-xyz-789">
  </form>
</body></html>`;

/** Shape of the real page Google serves when the download quota is spent. */
const QUOTA_PAGE = `<!DOCTYPE html><html><head><title>Google Drive - Quota exceeded</title></head>
<body><p>Sorry, you can't view or download this file at this time.</p></body></html>`;

const SIGN_IN_PAGE = `<html><head><title>Sign in - Google Accounts</title></head><body></body></html>`;

function htmlResponse(html: string, setCookies: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(html, { status: 200, headers });
}

function videoResponse(status = 206): Response {
  return new Response('BINARY', {
    status,
    headers: { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' },
  });
}

function videoInfoResponse(body: string, setCookies: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'text/plain; charset=utf-8' });
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(body, { status: 200, headers });
}

beforeEach(() => clearStreamCache());
afterEach(() => vi.restoreAllMocks());

describe('classifyDrivePage', () => {
  it('recognizes the quota-exceeded page by its title', () => {
    expect(classifyDrivePage(QUOTA_PAGE, 'https://drive.usercontent.google.com/download')).toEqual(
      { kind: 'quota' },
    );
  });

  it('rebuilds the confirm URL from the virus-scan form fields', () => {
    const page = classifyDrivePage(INTERSTITIAL, 'https://drive.usercontent.google.com/download');
    expect(page.kind).toBe('virus-scan');
    const url = new URL((page as { confirmUrl: string }).confirmUrl);
    expect(url.searchParams.get('confirm')).toBe('abc123token');
    expect(url.searchParams.get('uuid')).toBe('uuid-xyz-789');
    expect(url.searchParams.get('export')).toBe('download');
    expect(url.searchParams.get('id')).toBe('FILEID12345');
  });

  it('recognizes sign-in by final URL and by title', () => {
    expect(classifyDrivePage('<html></html>', 'https://accounts.google.com/ServiceLogin?x')).toEqual(
      { kind: 'sign-in' },
    );
    expect(classifyDrivePage(SIGN_IN_PAGE, 'https://drive.google.com/x')).toEqual({
      kind: 'sign-in',
    });
  });

  it('classifies anything else as unknown, keeping the title for diagnostics', () => {
    expect(classifyDrivePage('<html><head><title>Weird</title></head></html>', 'https://x')).toEqual(
      { kind: 'unknown', title: 'Weird' },
    );
  });
});

describe('CookieJar', () => {
  it('collapses Set-Cookie headers into name=value pairs across responses', () => {
    const jar = new CookieJar();
    jar.absorb(htmlResponse('x', ['download_warning_abc=yes; Path=/; HttpOnly']));
    jar.absorb(htmlResponse('x', ['NID=511=token; Domain=.google.com; HttpOnly']));
    expect(jar.header()).toBe('download_warning_abc=yes; NID=511=token');
  });

  it('returns null when empty', () => {
    expect(new CookieJar().header()).toBeNull();
  });
});

describe('filenameFromDisposition', () => {
  it('parses the quoted filename form', () => {
    const res = new Response('x', {
      headers: { 'content-disposition': 'attachment; filename="movie night.mp4"' },
    });
    expect(filenameFromDisposition(res)).toBe('movie night.mp4');
  });

  it('prefers the RFC 5987 filename* form and decodes its percent-encoding', () => {
    const res = new Response('x', {
      headers: {
        'content-disposition': `attachment; filename="fallback.mp4"; filename*=UTF-8''caf%C3%A9%20night.mp4`,
      },
    });
    expect(filenameFromDisposition(res)).toBe('café night.mp4');
  });

  it('returns null when the header is absent', () => {
    expect(filenameFromDisposition(new Response('x'))).toBeNull();
  });
});

describe('videoMimeForFilename / isUnplayableContainer', () => {
  it('maps browser-playable extensions to MIME types', () => {
    expect(videoMimeForFilename('movie.mp4')).toBe('video/mp4');
    expect(videoMimeForFilename('clip.webm')).toBe('video/webm');
    expect(videoMimeForFilename('old.mpg')).toBeNull();
    expect(videoMimeForFilename(null)).toBeNull();
  });

  it('flags known-unplayable containers, but not playable ones or null', () => {
    expect(isUnplayableContainer('old.mpg')).toBe(true);
    expect(isUnplayableContainer('rip.mkv')).toBe(true);
    expect(isUnplayableContainer('movie.mp4')).toBe(false);
    expect(isUnplayableContainer(null)).toBe(false);
  });
});

describe('openDriveMedia state machine', () => {
  it('streams directly when the first response is already the file', async () => {
    const fetchMock = vi.fn(async () => videoResponse());
    vi.stubGlobal('fetch', fetchMock);

    const media = await openDriveMedia('DIRECTFILE01', undefined, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(media.source).toBe('download');
    expect(media.response.status).toBe(206);
  });

  it('echoes the interstitial cookie + confirm token, preserving Range (large files)', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
      if (calls.length === 1) {
        return htmlResponse(INTERSTITIAL, ['download_warning_abc=yes; Path=/; HttpOnly']);
      }
      return videoResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const media = await openDriveMedia('LARGEFILE001', 'bytes=0-', new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls[1]!.url).toContain('confirm=abc123token');
    expect(calls[1]!.headers.cookie).toContain('download_warning_abc=yes');
    expect(calls[1]!.headers.range).toBe('bytes=0-');
    expect(media.source).toBe('download');
  });

  it('falls back to the preview stream when the download quota is exhausted', async () => {
    const streamUrl37 = 'https://rr1.example.googlevideo/videoplayback?itag=37';
    const fmtStreamMap = encodeURIComponent(
      `18|https://rr1.example.googlevideo/videoplayback?itag=18,37|${streamUrl37}`,
    );
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.includes('usercontent.google.com/download')) return htmlResponse(QUOTA_PAGE);
      if (url.includes('get_video_info')) {
        return videoInfoResponse(
          `status=ok&title=Show.S01E01.mkv&fmt_stream_map=${fmtStreamMap}`,
          ['DRIVE_STREAM=streamtoken; Domain=.drive.google.com; Path=/'],
        );
      }
      return videoResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const media = await openDriveMedia('QUOTAFILE001', 'bytes=100-', new AbortController().signal);

    expect(media.source).toBe('stream');
    expect(media.mime).toBe('video/mp4');
    expect(media.filename).toBe('Show.S01E01.mkv');
    // Highest itag wins, the DRIVE_STREAM cookie is echoed, Range forwarded.
    const streamCall = calls.find((c) => c.url.includes('videoplayback'))!;
    expect(streamCall.url).toContain('itag=37');
    expect(streamCall.headers.cookie).toContain('DRIVE_STREAM=streamtoken');
    expect(streamCall.headers.range).toBe('bytes=100-');
  });

  it('reports a precise quota error when the stream is also refused', async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('usercontent.google.com/download')) return htmlResponse(QUOTA_PAGE);
      return videoInfoResponse('status=fail&reason=Download+quota+exceeded+for+this+file');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      openDriveMedia('QUOTAFILE002', undefined, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'quota' });
  });

  it('maps a sign-in interstitial to not-public', async () => {
    const fetchMock = vi.fn(async () => htmlResponse(SIGN_IN_PAGE));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      openDriveMedia('PRIVATEFILE1', undefined, new AbortController().signal),
    ).rejects.toBeInstanceOf(DriveError);
    await expect(
      openDriveMedia('PRIVATEFILE1', undefined, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'not-public' });
  });

  it('reuses a cached stream resolution instead of re-running the flow', async () => {
    const fmtStreamMap = encodeURIComponent('18|https://rr1.example.googlevideo/videoplayback?itag=18');
    let infoCalls = 0;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('usercontent.google.com/download')) return htmlResponse(QUOTA_PAGE);
      if (url.includes('get_video_info')) {
        infoCalls += 1;
        return videoInfoResponse(`status=ok&title=t.mkv&fmt_stream_map=${fmtStreamMap}`);
      }
      return videoResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    await openDriveMedia('CACHEDFILE01', undefined, new AbortController().signal);
    const second = await openDriveMedia('CACHEDFILE01', 'bytes=0-', new AbortController().signal);
    expect(second.source).toBe('stream');
    expect(infoCalls).toBe(1); // second request went straight to the cached URL
  });
});
