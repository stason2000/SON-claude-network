/**
 * Opt-in API-key sync: passphrase encryption done BEFORE anything is uploaded.
 *
 *   key  = scrypt(passphrase, random 16-byte salt, N=2^15, r=8, p=1) → 32 bytes
 *   box  = AES-256-GCM(key, random 12-byte IV, AAD = "son-sync-apikeys-v1")
 *
 * The passphrase is never stored or logged; callers pass it per operation.
 * A wrong passphrase (or any tampering) fails the GCM tag check and surfaces as
 * SyncError('wrongPassphrase') — never as partial plaintext.
 *
 * `changeHash` is an HMAC-SHA256 of the plaintext under a separate scrypt key
 * with a FIXED salt, so two devices with the same passphrase compute the same
 * value for the same keys (needed for three-way change detection) while the
 * manifest never carries a plain hash of secrets.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto';
import { SyncError } from './errors';

const AAD = Buffer.from('son-sync-apikeys-v1', 'utf8');
const HMAC_SALT = Buffer.from('son-sync-apikeys-hmac-v1', 'utf8');
const DEFAULT_N = 1 << 15;
const R = 8;
const P = 1;
const ALLOWED_N = new Set([1 << 14, 1 << 15, 1 << 16, 1 << 17]);
export const MIN_PASSPHRASE = 8;

function scrypt(pass: string, salt: Buffer, N: number): Buffer {
  return scryptSync(pass.normalize('NFKC'), salt, 32, { N, r: R, p: P, maxmem: 256 * N * R + 1024 * 1024 });
}

export function checkPassphrase(pass: unknown): string {
  if (typeof pass !== 'string' || pass.length === 0) throw new SyncError('passphraseRequired');
  if (pass.length < MIN_PASSPHRASE) throw new SyncError('passphraseTooShort');
  if (pass.length > 1024) throw new SyncError('invalidInput');
  return pass;
}

export function encryptWithPassphrase(plaintext: Buffer, passphrase: string, N = DEFAULT_N): Buffer {
  checkPassphrase(passphrase);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scrypt(passphrase, salt, N);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(AAD);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  const tag = c.getAuthTag();
  const env = {
    v: 1, alg: 'aes-256-gcm', kdf: 'scrypt', N, r: R, p: P,
    salt: salt.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64')
  };
  return Buffer.from(JSON.stringify(env), 'utf8');
}

export function decryptWithPassphrase(envelope: Buffer, passphrase: string): Buffer {
  checkPassphrase(passphrase);
  let env: Record<string, unknown>;
  try { env = JSON.parse(envelope.toString('utf8')); } catch { throw new SyncError('badRemote'); }
  if (!env || env.v !== 1 || env.alg !== 'aes-256-gcm' || env.kdf !== 'scrypt' || env.r !== R || env.p !== P
    || typeof env.N !== 'number' || !ALLOWED_N.has(env.N)
    || typeof env.salt !== 'string' || typeof env.iv !== 'string' || typeof env.tag !== 'string' || typeof env.ct !== 'string') {
    throw new SyncError('badRemote');
  }
  const salt = Buffer.from(env.salt, 'base64');
  const iv = Buffer.from(env.iv, 'base64');
  const tag = Buffer.from(env.tag, 'base64');
  const ct = Buffer.from(env.ct, 'base64');
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new SyncError('badRemote');
  const key = scrypt(passphrase, salt, env.N);
  try {
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(AAD);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch {
    throw new SyncError('wrongPassphrase');
  }
}

/** Derive the change-detection HMAC key once per operation (scrypt is slow on purpose). */
export function hmacKeyFor(passphrase: string): Buffer {
  checkPassphrase(passphrase);
  return scrypt(passphrase, HMAC_SALT, DEFAULT_N);
}

export function changeHash(hmacKey: Buffer, plaintext: Buffer): string {
  return createHmac('sha256', hmacKey).update(plaintext).digest('hex');
}
