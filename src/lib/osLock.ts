export const OS_LOCK_PROFILE_KEY = 'nammu-lock-profile';
export const OS_LOCK_STATE_KEY = 'nammu-os-locked';

const PASSWORD_ITERATIONS = 120_000;

export interface OsLockProfile {
  username: string;
  displayName: string;
  passwordSalt: string;
  passwordHash: string;
  passwordIterations: number;
}

export function normalizeLockUsername(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 32);
}

export function getLockDisplayName(username: string): string {
  const words = username
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  return words.join(' ') || 'Nammu User';
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[a-f0-9]+$/i.test(hex) || hex.length % 2 !== 0) return new Uint8Array();
  return Uint8Array.from(hex.match(/.{2}/g) || [], (byte) => Number.parseInt(byte, 16));
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const saltBuffer = salt.buffer.slice(
    salt.byteOffset,
    salt.byteOffset + salt.byteLength,
  ) as ArrayBuffer;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations },
    keyMaterial,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function createLockProfile(
  usernameInput: string,
  password: string,
): Promise<OsLockProfile> {
  const username = normalizeLockUsername(usernameInput);
  if (username.length < 2) throw new Error('Username must contain at least 2 characters.');
  if (password.length < 6) throw new Error('Password must contain at least 6 characters.');

  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    username,
    displayName: getLockDisplayName(username),
    passwordSalt: bytesToHex(salt),
    passwordHash: await derivePasswordHash(password, salt, PASSWORD_ITERATIONS),
    passwordIterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyLockPassword(
  profile: OsLockProfile,
  password: string,
): Promise<boolean> {
  const salt = hexToBytes(profile.passwordSalt);
  if (!salt.length || !profile.passwordHash) return false;
  const hash = await derivePasswordHash(
    password,
    salt,
    profile.passwordIterations || PASSWORD_ITERATIONS,
  );
  return hash === profile.passwordHash;
}

export function getStoredLockProfile(): OsLockProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(OS_LOCK_PROFILE_KEY);
    if (!stored) return null;
    const profile = JSON.parse(stored) as Partial<OsLockProfile>;
    if (
      typeof profile.username !== 'string' ||
      typeof profile.displayName !== 'string' ||
      typeof profile.passwordSalt !== 'string' ||
      typeof profile.passwordHash !== 'string'
    ) {
      return null;
    }
    return {
      username: normalizeLockUsername(profile.username),
      displayName: profile.displayName,
      passwordSalt: profile.passwordSalt,
      passwordHash: profile.passwordHash,
      passwordIterations: Number(profile.passwordIterations) || PASSWORD_ITERATIONS,
    };
  } catch {
    return null;
  }
}

export function saveLockProfile(profile: OsLockProfile): void {
  localStorage.setItem(OS_LOCK_PROFILE_KEY, JSON.stringify(profile));
}

export function getStoredLockState(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(OS_LOCK_STATE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveLockState(locked: boolean): void {
  if (locked) localStorage.setItem(OS_LOCK_STATE_KEY, 'true');
  else localStorage.removeItem(OS_LOCK_STATE_KEY);
}
