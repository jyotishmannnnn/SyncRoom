/**
 * Room codes follow the Google Meet convention: two lowercase letter groups
 * (`abcd-efgh`). Custom codes allow 4-10 chars of lowercase letters, digits
 * and hyphens (no leading/trailing/double hyphen).
 */

/** Unambiguous lowercase alphabet (no i/l/o/q). */
const ALPHABET = 'abcdefghjkmnprstuvwxyz';

export const ROOM_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ROOM_CODE_MIN = 4;
export const ROOM_CODE_MAX = 10;

export function isValidRoomCode(code: string): boolean {
  return (
    typeof code === 'string' &&
    code.length >= ROOM_CODE_MIN &&
    code.length <= ROOM_CODE_MAX &&
    ROOM_CODE_PATTERN.test(code)
  );
}

/** Normalizes user input (trim, lowercase, collapse whitespace to hyphens). */
export function normalizeRoomCode(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '-');
}

export function generateRoomCode(random: () => number = Math.random): string {
  const group = (len: number) =>
    Array.from({ length: len }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join('');
  return `${group(4)}-${group(4)}`;
}

export const DISPLAY_NAME_MIN = 1;
export const DISPLAY_NAME_MAX = 40;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

export function sanitizeDisplayName(name: string): string {
  return name.replace(CONTROL_CHARS, '').trim().slice(0, DISPLAY_NAME_MAX);
}

export function isValidDisplayName(name: string): boolean {
  const clean = sanitizeDisplayName(name);
  return clean.length >= DISPLAY_NAME_MIN && clean.length <= DISPLAY_NAME_MAX;
}
