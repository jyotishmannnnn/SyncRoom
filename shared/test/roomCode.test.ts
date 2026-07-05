import { describe, expect, it } from 'vitest';
import {
  generateRoomCode,
  isValidDisplayName,
  isValidRoomCode,
  normalizeRoomCode,
  sanitizeDisplayName,
} from '../src/roomCode';

describe('generateRoomCode', () => {
  it('produces a valid meet-style code', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[a-z]{4}-[a-z]{4}$/);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it('is deterministic given a seeded random', () => {
    const fixed = () => 0.5;
    expect(generateRoomCode(fixed)).toBe(generateRoomCode(fixed));
  });
});

describe('isValidRoomCode', () => {
  it('accepts custom codes', () => {
    expect(isValidRoomCode('game-time')).toBe(true);
    expect(isValidRoomCode('team42')).toBe(true);
    expect(isValidRoomCode('a'.repeat(10))).toBe(true);
  });

  it('rejects malformed codes', () => {
    expect(isValidRoomCode('ab')).toBe(false);
    expect(isValidRoomCode('-leading')).toBe(false);
    expect(isValidRoomCode('trailing-')).toBe(false);
    expect(isValidRoomCode('double--hyphen')).toBe(false);
    expect(isValidRoomCode('UPPER')).toBe(false);
    expect(isValidRoomCode('has space')).toBe(false);
    expect(isValidRoomCode('a'.repeat(11))).toBe(false);
    expect(isValidRoomCode('<script>')).toBe(false);
  });
});

describe('normalizeRoomCode', () => {
  it('lowercases and hyphenates whitespace', () => {
    expect(normalizeRoomCode('  Movie Night ')).toBe('movie-night');
  });
});

describe('display names', () => {
  it('strips control characters', () => {
    expect(sanitizeDisplayName('Ana' + String.fromCharCode(0, 31) + 'Bell')).toBe('AnaBell');
  });

  it('validates length after sanitizing', () => {
    expect(isValidDisplayName('  ')).toBe(false);
    expect(isValidDisplayName('J')).toBe(true);
    expect(isValidDisplayName('x'.repeat(41))).toBe(true); // truncated, still valid
  });
});
