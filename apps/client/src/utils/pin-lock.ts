const PIN_KEY_PREFIX = 'notoc.pin.';
const PIN_SALT = 'notoc-pin-salt:v1';

export const PIN_LENGTH = 6;

type StoredPin = {
  hash: string;
  createdAt: string;
};

function storageKey(userId: string) {
  return `${PIN_KEY_PREFIX}${userId}`;
}

async function digestHex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(buffer));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPin(userId: string, pin: string): Promise<string> {
  return digestHex(`${PIN_SALT}|${userId}|${pin}`);
}

export function hasPin(userId: string): boolean {
  try {
    return Boolean(localStorage.getItem(storageKey(userId)));
  } catch {
    return false;
  }
}

export function readPin(userId: string): StoredPin | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredPin;
  } catch {
    return null;
  }
}

export async function savePin(userId: string, pin: string): Promise<void> {
  const hash = await hashPin(userId, pin);
  const payload: StoredPin = { hash, createdAt: new Date().toISOString() };
  localStorage.setItem(storageKey(userId), JSON.stringify(payload));
}

export function removePin(userId: string): void {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}

export async function verifyPin(userId: string, pin: string): Promise<boolean> {
  const stored = readPin(userId);
  if (!stored) return false;
  const candidate = await hashPin(userId, pin);
  return candidate === stored.hash;
}

export function isPinFormatValid(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}
