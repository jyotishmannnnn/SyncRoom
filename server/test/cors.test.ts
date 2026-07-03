import { describe, expect, it } from 'vitest';
import { isOriginAllowed, makeOriginCheck, parseAllowedOrigins } from '../src/cors';

describe('parseAllowedOrigins', () => {
  it('defaults to the dev origin', () => {
    expect(parseAllowedOrigins(undefined)).toEqual(['http://localhost:5173']);
  });

  it('splits and trims comma lists', () => {
    expect(parseAllowedOrigins('https://a.app, https://b.app ,')).toEqual([
      'https://a.app',
      'https://b.app',
    ]);
  });
});

describe('isOriginAllowed', () => {
  const allowed = ['https://syncroom.vercel.app', 'https://*.vercel.app'];

  it('matches exact origins', () => {
    expect(isOriginAllowed('https://syncroom.vercel.app', allowed)).toBe(true);
    expect(isOriginAllowed('https://other.example.com', allowed)).toBe(false);
  });

  it('matches wildcard subdomains (Vercel previews)', () => {
    expect(isOriginAllowed('https://syncroom-git-main-user.vercel.app', allowed)).toBe(true);
    expect(isOriginAllowed('https://anything.vercel.app', allowed)).toBe(true);
  });

  it('never lets lookalike hosts through the wildcard', () => {
    expect(isOriginAllowed('https://evilvercel.app', allowed)).toBe(false);
    expect(isOriginAllowed('https://vercel.app', allowed)).toBe(false);
    expect(isOriginAllowed('http://x.vercel.app', allowed)).toBe(false); // scheme mismatch
    expect(isOriginAllowed('https://x.vercel.app.evil.com', allowed)).toBe(false);
  });
});

describe('makeOriginCheck', () => {
  const check = makeOriginCheck(['https://app.example.com']);

  it('allows undefined origin (same-origin, curl, health checks)', () => {
    check(undefined, (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(true);
    });
  });

  it('rejects unknown origins with an error', () => {
    check('https://attacker.example', (err) => {
      expect(err).toBeInstanceOf(Error);
    });
  });
});
