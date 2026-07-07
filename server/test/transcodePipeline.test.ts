import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import ffmpegStatic from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TranscodeError, TranscodeManager } from '../src/transcode';

/**
 * Full-pipeline regression test: real ffmpeg, real HLS output, only the Drive
 * download is stubbed (global fetch returns a local file styled like Google's
 * download endpoint: octet-stream + content-disposition filename).
 *
 * The .mov case is the load-bearing one — QuickTime containers keep their
 * moov atom at the END of the file, which ffmpeg cannot probe from a pipe.
 * Before the download-to-disk strategy this failed with "Cannot determine
 * format of input stream 0:0 after EOF".
 */

const FFMPEG = ffmpegStatic as unknown as string;
let workDir: string;
const realFetch = globalThis.fetch;
let manager: TranscodeManager;

function generate(name: string, args: string[]): Promise<string> {
  const out = path.join(workDir, name);
  return new Promise((resolve, reject) => {
    const p = spawn(
      FFMPEG,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=duration=5:size=320x180:rate=15',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=5',
        ...args,
        '-y',
        out,
      ],
      { stdio: 'ignore' },
    );
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`ffmpeg gen ${code}`))));
  });
}

/** Serve `file` for any drive.usercontent.google.com fetch, like Drive would. */
function stubDriveWith(file: string, filename: string): void {
  globalThis.fetch = (async () =>
    new Response(Readable.toWeb(createReadStream(file)) as unknown as ReadableStream, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    })) as typeof fetch;
}

/** Poll getPlaylist the way hls.js + the 503 route contract does. */
async function playlistWithRetries(id: string, attempts = 30): Promise<Buffer> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await manager.getPlaylist(id);
    } catch (err) {
      if (err instanceof TranscodeError && err.kind === 'pending') {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      throw err;
    }
  }
  throw new Error('playlist never became ready');
}

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'syncroom-e2e-'));
  manager = new TranscodeManager();
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await manager.dispose();
  await rm(workDir, { recursive: true, force: true });
});

describe('transcode pipeline (real ffmpeg)', () => {
  it('transcodes a piped MKV (H.264) to a playable HLS playlist', async () => {
    const src = await generate('sample.mkv', ['-c:v', 'libx264', '-c:a', 'aac']);
    stubDriveWith(src, 'sample.mkv');
    const playlist = (await playlistWithRetries('MKVFILE0001')).toString('utf8');
    expect(playlist).toContain('#EXTM3U');
    expect(playlist).toContain('seg00000.ts');
    expect(manager.segmentPath('MKVFILE0001', 'seg00000.ts')).toBeTruthy();
  }, 60_000);

  it('transcodes a MOV (trailing moov atom) via the download-to-disk strategy', async () => {
    const src = await generate('sample.mov', ['-c:v', 'libx264', '-c:a', 'aac']);
    stubDriveWith(src, 'sample.mov');
    const playlist = (await playlistWithRetries('MOVFILE0001')).toString('utf8');
    expect(playlist).toContain('#EXTM3U');
    expect(playlist).toContain('seg00000.ts');
  }, 60_000);

  // Remaining format matrix. Each uses its own manager: the shared one is
  // capped at maxTranscodeSessions live sessions.
  for (const [name, codecArgs] of [
    ['hevc.mp4', ['-c:v', 'libx265', '-tag:v', 'hvc1', '-c:a', 'aac']],
    ['sample.avi', ['-c:v', 'mpeg4', '-c:a', 'mp3']],
    ['sample.mpg', ['-c:v', 'mpeg2video', '-c:a', 'mp2']],
  ] as const) {
    it(`transcodes ${name} to a playable HLS playlist`, async () => {
      const src = await generate(name, [...codecArgs]);
      stubDriveWith(src, name);
      const own = new TranscodeManager();
      const prev = manager;
      manager = own; // playlistWithRetries uses the module-level manager
      try {
        const playlist = (await playlistWithRetries(`FMT${name.replace(/\W/g, '').toUpperCase()}01`)).toString('utf8');
        expect(playlist).toContain('#EXTM3U');
        expect(playlist).toContain('seg00000.ts');
      } finally {
        manager = prev;
        await own.dispose();
      }
    }, 60_000);
  }

  it('fails with `upstream` when Drive answers with an HTML interstitial', async () => {
    globalThis.fetch = (async () =>
      new Response('<html>sign in</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;
    // Fresh manager: the shared one legitimately holds the two live sessions
    // from the tests above (maxTranscodeSessions), which would answer `busy`.
    const fresh = new TranscodeManager();
    try {
      await expect(fresh.getPlaylist('HTMLFILE0001')).rejects.toMatchObject({
        kind: 'upstream',
      });
    } finally {
      await fresh.dispose();
    }
  }, 30_000);
});
