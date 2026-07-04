import { describe, expect, it } from 'vitest';
import { classifyMediaUrl, driveEmbedUrl, parseMediaUrl } from '../src/mediaUrl';

describe('parseMediaUrl', () => {
  it('parses standard YouTube watch URLs', () => {
    const m = parseMediaUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(m?.kind).toBe('youtube');
    expect(m?.providerId).toBe('dQw4w9WgXcQ');
  });

  it('parses youtu.be short links and shorts', () => {
    expect(parseMediaUrl('https://youtu.be/dQw4w9WgXcQ?t=42')?.providerId).toBe('dQw4w9WgXcQ');
    expect(parseMediaUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.providerId).toBe(
      'dQw4w9WgXcQ',
    );
    expect(parseMediaUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')?.kind).toBe('youtube');
  });

  it('rejects lookalike hosts', () => {
    expect(parseMediaUrl('https://evil-youtube.com/watch?v=dQw4w9WgXcQ')?.kind).not.toBe('youtube');
  });

  it('parses Google Drive share links into the same-origin stream proxy path', () => {
    const m = parseMediaUrl('https://drive.google.com/file/d/1a2B3c4D5e6F7g8H9/view?usp=sharing');
    expect(m?.kind).toBe('drive');
    expect(m?.providerId).toBe('1a2B3c4D5e6F7g8H9');
    expect(m?.url).toBe('/drive/1a2B3c4D5e6F7g8H9');
    expect(driveEmbedUrl('1a2B3c4D5e6F7g8H9')).toContain('/preview');
  });

  it('classifies direct files, HLS and DASH', () => {
    expect(parseMediaUrl('https://cdn.example.com/movie.mp4')?.kind).toBe('file');
    expect(parseMediaUrl('https://cdn.example.com/movie.webm?sig=abc')?.kind).toBe('file');
    expect(parseMediaUrl('https://cdn.example.com/live/stream.m3u8')?.kind).toBe('hls');
    expect(parseMediaUrl('https://cdn.example.com/vod/manifest.mpd')?.kind).toBe('dash');
  });

  it('rejects non-http protocols and garbage', () => {
    expect(parseMediaUrl('javascript:alert(1)')).toBeNull();
    expect(parseMediaUrl('ftp://example.com/movie.mp4')).toBeNull();
    expect(parseMediaUrl('not a url')).toBeNull();
  });
});

describe('classifyMediaUrl — Drive URL coverage', () => {
  const ID = '1a2B3c4D5e6F7g8H9';
  const shapes = [
    `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
    `https://drive.google.com/file/d/${ID}/preview`,
    `https://drive.google.com/file/d/${ID}/edit`,
    `https://drive.google.com/open?id=${ID}`,
    `https://drive.google.com/uc?id=${ID}&export=download`,
    `https://drive.google.com/uc?export=view&id=${ID}`,
    `https://docs.google.com/uc?id=${ID}`,
    `https://drive.usercontent.google.com/download?id=${ID}&export=download`,
  ];

  it.each(shapes)('detects the file id in %s', (shape) => {
    const r = classifyMediaUrl(shape);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.media.kind).toBe('drive');
      expect(r.media.providerId).toBe(ID);
    }
  });

  it('rejects Drive folders with a specific reason', () => {
    const r = classifyMediaUrl('https://drive.google.com/drive/folders/1AbCdEfGhIjKl');
    expect(r).toEqual({ ok: false, reason: 'drive-not-a-file' });
  });
});

describe('classifyMediaUrl — Vimeo', () => {
  it('parses standard, unlisted and player Vimeo URLs', () => {
    expect(parseMediaUrl('https://vimeo.com/123456789')?.kind).toBe('vimeo');
    expect(parseMediaUrl('https://vimeo.com/123456789')?.providerId).toBe('123456789');
    // Unlisted video: id + privacy hash in the path.
    const unlisted = parseMediaUrl('https://vimeo.com/123456789/abcdef1234');
    expect(unlisted?.providerId).toBe('123456789');
    expect(unlisted?.url).toBe('https://vimeo.com/123456789/abcdef1234');
    // Player embed URL with the hash in the query string.
    expect(parseMediaUrl('https://player.vimeo.com/video/123456789?h=abcdef1234')?.kind).toBe(
      'vimeo',
    );
    // Channel / group nesting still resolves the numeric id.
    expect(parseMediaUrl('https://vimeo.com/channels/staffpicks/123456789')?.providerId).toBe(
      '123456789',
    );
  });

  it('rejects Vimeo links without a video id', () => {
    expect(classifyMediaUrl('https://vimeo.com/channels/staffpicks')).toEqual({
      ok: false,
      reason: 'vimeo-no-video',
    });
  });
});

describe('classifyMediaUrl — Twitch', () => {
  it('detects VODs, channels and the player embed', () => {
    const vod = classifyMediaUrl('https://www.twitch.tv/videos/123456789');
    expect(vod.ok && vod.media.kind).toBe('twitch');
    expect(vod.ok && vod.media.providerId).toBe('video:123456789');

    const live = classifyMediaUrl('https://twitch.tv/somestreamer');
    expect(live.ok && live.media.providerId).toBe('channel:somestreamer');

    const player = classifyMediaUrl('https://player.twitch.tv/?video=v123456789&parent=x');
    expect(player.ok && player.media.providerId).toBe('video:123456789');
  });

  it('rejects Twitch clips and section pages', () => {
    expect(classifyMediaUrl('https://clips.twitch.tv/SomeClipSlug')).toEqual({
      ok: false,
      reason: 'twitch-no-video',
    });
    expect(classifyMediaUrl('https://www.twitch.tv/directory')).toEqual({
      ok: false,
      reason: 'twitch-no-video',
    });
  });
});

describe('classifyMediaUrl — DRM streaming services', () => {
  it('rejects Netflix, Prime Video and Disney+ with a clear reason', () => {
    for (const link of [
      'https://www.netflix.com/watch/80100172',
      'https://www.primevideo.com/detail/0ABCDEFGH',
      'https://www.disneyplus.com/video/abc-123',
    ]) {
      expect(classifyMediaUrl(link)).toEqual({ ok: false, reason: 'drm-unsupported' });
    }
  });
});

describe('classifyMediaUrl — specific rejections', () => {
  it('explains YouTube links without a video', () => {
    expect(classifyMediaUrl('https://www.youtube.com/playlist?list=PL123abc')).toEqual({
      ok: false,
      reason: 'youtube-no-video',
    });
    expect(classifyMediaUrl('https://www.youtube.com/@somechannel')).toEqual({
      ok: false,
      reason: 'youtube-no-video',
    });
  });

  it('distinguishes bad URLs from bad protocols', () => {
    expect(classifyMediaUrl('not a url')).toEqual({ ok: false, reason: 'invalid-url' });
    expect(classifyMediaUrl('ftp://x.com/a.mp4')).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    });
  });
});
