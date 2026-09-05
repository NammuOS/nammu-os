import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const DESKTOP_VAULT_FORMAT_VERSION = 1;
const KEY_PATTERN = /^[a-f0-9]{64}$/;
const REFERENCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const MAX_PLAINTEXT_BYTES = 512 * 1024;

export class CredentialVaultLockedError extends Error {
  constructor() {
    super('The credential vault is locked.');
    this.name = 'CredentialVaultLockedError';
  }
}

function decodeMasterKey(value) {
  if (Buffer.isBuffer(value)) {
    if (value.length !== 32) {
      throw new Error('The credential vault master key is invalid.');
    }
    return Buffer.from(value);
  }
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) {
    throw new Error('The credential vault master key is invalid.');
  }
  return Buffer.from(value, 'hex');
}

function validateReference(reference) {
  if (typeof reference !== 'string' || !REFERENCE_PATTERN.test(reference)) {
    throw new Error('The credential reference is invalid.');
  }
  return reference;
}

function additionalData(reference) {
  return Buffer.from(`nammu-credential-v${DESKTOP_VAULT_FORMAT_VERSION}:${reference}`, 'utf8');
}

function parseEnvelope(value) {
  let envelope;
  try {
    envelope = JSON.parse(value);
  } catch {
    throw new Error('The stored credential envelope is invalid.');
  }
  if (
    envelope?.version !== DESKTOP_VAULT_FORMAT_VERSION ||
    envelope?.algorithm !== 'aes-256-gcm' ||
    typeof envelope?.nonce !== 'string' ||
    typeof envelope?.tag !== 'string' ||
    typeof envelope?.ciphertext !== 'string'
  ) {
    throw new Error('The stored credential envelope uses an unsupported format.');
  }
  return envelope;
}

export function createCredentialVault(database, initialMasterKey) {
  let masterKey = decodeMasterKey(initialMasterKey);
  const readEntry = database.prepare(
    'SELECT envelope FROM credential_vault_entries WHERE credential_ref = ?',
  );
  const upsertEntry = database.prepare(`
    INSERT INTO credential_vault_entries (credential_ref, envelope, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(credential_ref) DO UPDATE
    SET envelope = excluded.envelope, updated_at = excluded.updated_at
  `);
  const deleteEntry = database.prepare(
    'DELETE FROM credential_vault_entries WHERE credential_ref = ?',
  );

  const requireKey = () => {
    if (!masterKey) throw new CredentialVaultLockedError();
    return masterKey;
  };

  return Object.freeze({
    store(reference, credential) {
      const safeReference = validateReference(reference);
      requireKey();
      const serialized = JSON.stringify(credential);
      if (typeof serialized !== 'string') {
        throw new Error('The credential payload must be JSON serializable.');
      }
      const plaintext = Buffer.from(serialized, 'utf8');
      if (plaintext.length === 0 || plaintext.length > MAX_PLAINTEXT_BYTES) {
        plaintext.fill(0);
        throw new Error('The credential payload size is invalid.');
      }
      const nonce = randomBytes(12);
      try {
        const cipher = createCipheriv('aes-256-gcm', requireKey(), nonce);
        cipher.setAAD(additionalData(safeReference));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const envelope = JSON.stringify({
          version: DESKTOP_VAULT_FORMAT_VERSION,
          algorithm: 'aes-256-gcm',
          nonce: nonce.toString('base64url'),
          tag: cipher.getAuthTag().toString('base64url'),
          ciphertext: ciphertext.toString('base64url'),
        });
        const timestamp = new Date().toISOString();
        upsertEntry.run(safeReference, envelope, timestamp, timestamp);
      } finally {
        plaintext.fill(0);
      }
      return safeReference;
    },

    retrieve(reference) {
      const safeReference = validateReference(reference);
      const key = requireKey();
      const row = readEntry.get(safeReference);
      if (!row) return null;
      const envelope = parseEnvelope(row.envelope);
      const nonce = Buffer.from(envelope.nonce, 'base64url');
      const tag = Buffer.from(envelope.tag, 'base64url');
      const ciphertext = Buffer.from(envelope.ciphertext, 'base64url');
      if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
        throw new Error('The stored credential envelope is invalid.');
      }
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(additionalData(safeReference));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      try {
        return JSON.parse(plaintext.toString('utf8'));
      } finally {
        plaintext.fill(0);
      }
    },

    delete(reference) {
      const safeReference = validateReference(reference);
      requireKey();
      return deleteEntry.run(safeReference).changes > 0;
    },

    lock() {
      masterKey?.fill(0);
      masterKey = null;
    },

    unlock(masterKeyHex) {
      const nextKey = decodeMasterKey(masterKeyHex);
      masterKey?.fill(0);
      masterKey = nextKey;
    },

    get locked() {
      return masterKey === null;
    },
  });
}
