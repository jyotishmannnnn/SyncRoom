import { afterEach, describe, expect, it } from 'vitest';
import { inputStrategyFor, TranscodeError, TranscodeManager } from '../src/transcode';

/**
 * Validation-layer tests only: these never spawn ffmpeg or hit the network.
 * The full encode is exercised end-to-end against a live server, not in unit
 * tests (it needs ffmpeg + a real Drive file).
 */

const VALID_ID = 'FILEID12345';

let manager: TranscodeManager | null = null;
afterEach(async () => {
  await manager?.dispose();
  manager = null;
});

describe('TranscodeManager input validation', () => {
  it('rejects a malformed file id before starting any encode', async () => {
    manager = new TranscodeManager();
    await expect(manager.getPlaylist('short')).rejects.toBeInstanceOf(TranscodeError);
    await expect(manager.getPlaylist('short')).rejects.toMatchObject({ kind: 'bad-id' });
  });

  it('returns null for a segment request with a bad id', () => {
    manager = new TranscodeManager();
    expect(manager.segmentPath('nope!', 'seg00000.ts')).toBeNull();
  });

  it('returns null for a non-segment filename (path-traversal / stray files)', () => {
    manager = new TranscodeManager();
    expect(manager.segmentPath(VALID_ID, 'evil.txt')).toBeNull();
    expect(manager.segmentPath(VALID_ID, '../secret')).toBeNull();
    expect(manager.segmentPath(VALID_ID, 'index.m3u8')).toBeNull();
  });

  it('returns null for a valid segment name when no session exists yet', () => {
    manager = new TranscodeManager();
    expect(manager.segmentPath(VALID_ID, 'seg00000.ts')).toBeNull();
  });
});

describe('inputStrategyFor', () => {
  it('downloads QuickTime-family containers to disk (moov may trail the media)', () => {
    expect(inputStrategyFor('movie.mp4')).toBe('file');
    expect(inputStrategyFor('clip.MOV')).toBe('file');
    expect(inputStrategyFor('phone.3gp')).toBe('file');
    expect(inputStrategyFor('video.m4v')).toBe('file');
  });

  it('pipes streamable containers straight into ffmpeg', () => {
    expect(inputStrategyFor('show.mkv')).toBe('pipe');
    expect(inputStrategyFor('old.avi')).toBe('pipe');
    expect(inputStrategyFor('cam.mpg')).toBe('pipe');
    expect(inputStrategyFor('stream.ts')).toBe('pipe');
    expect(inputStrategyFor(null)).toBe('pipe');
    expect(inputStrategyFor('noextension')).toBe('pipe');
  });
});
