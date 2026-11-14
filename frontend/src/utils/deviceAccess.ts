// Device approval rules for the screens. The server checks the same limits (backend/lib/devices.js); keep them equal.
import type { DeviceState } from '../api';

export const DEVICE_NAME_MAX = 80;
export const DEVICE_NOTE_MAX = 300;
export const DEVICE_MEMO_MAX = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AccessRequest { name: string; email: string; note: string }

// The first problem with a request, or '' when it can be sent
export function accessRequestError(request: AccessRequest): string {
  const email = request.email.trim();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return 'Enter the email address on your STOP account.';
  if (!request.name.trim()) return 'Enter your name so the office knows who is asking.';
  if (request.name.trim().length > DEVICE_NAME_MAX) return `Your name must be ${DEVICE_NAME_MAX} characters or fewer.`;
  if (request.note.trim().length > DEVICE_NOTE_MAX) return `The note must be ${DEVICE_NOTE_MAX} characters or fewer.`;
  return '';
}

// Which screen a device sees before the login: the request form, the waiting screen, a refusal, or the login itself
export type DeviceScreen = 'request' | 'waiting' | 'denied' | 'revoked' | 'login';

export function deviceScreen(state: DeviceState): DeviceScreen {
  switch (state) {
    case 'approved': return 'login';
    case 'pending': return 'waiting';
    case 'denied': return 'denied';
    case 'revoked': return 'revoked';
    default: return 'request'; // none, expired
  }
}

// A short label for a browser's User-Agent, e.g. "Chrome on Windows", for the DEV tab
export function describeUserAgent(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  if (!ua) return 'Unknown browser';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'unknown system';
  return `${browser} on ${os}`;
}
