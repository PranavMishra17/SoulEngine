import * as crypto from 'crypto';

/**
 * Shared secret encryption module with key rotation support.
 *
 * Provides a versioned envelope format that supports:
 * - Key rotation (decrypt with old key, re-encrypt with new key)
 * - Algorithm versioning (future-proofing)
 * - Backward-compatibility with old local and supabase formats
 *
 * ## Key Rotation Workflow
 *
 * When rotating the ENCRYPTION_KEY:
 *
 * 1. Keep the old key accessible (e.g., ENCRYPTION_KEY_OLD env var)
 * 2. Set the new key in ENCRYPTION_KEY
 * 3. For each stored secret:
 *    - Load the encrypted envelope
 *    - Call rotateSecret(envelope, oldKey, newKey)
 *    - Save the new envelope back to storage
 * 4. Once all secrets are rotated, remove the old key
 *
 * Example rotation script:
 * ```typescript
 * import { rotateSecret } from './storage/crypto/secrets.js';
 *
 * const oldKey = process.env.ENCRYPTION_KEY_OLD!;
 * const newKey = process.env.ENCRYPTION_KEY!;
 *
 * // For local storage:
 * const projects = await listProjects();
 * for (const projectId of projects) {
 *   const secretsPath = getSecretsPath(projectId);
 *   const envelope = JSON.parse(await fs.readFile(secretsPath, 'utf8'));
 *   const rotated = rotateSecret(envelope, oldKey, newKey);
 *   await fs.writeFile(secretsPath, JSON.stringify(rotated, null, 2));
 * }
 *
 * // For supabase storage:
 * const { data } = await supabase.from('project_secrets').select('*');
 * for (const row of data) {
 *   const updates: Record<string, string> = {};
 *   for (const [col, value] of Object.entries(row)) {
 *     if (col.endsWith('_encrypted') && value) {
 *       updates[col] = JSON.stringify(rotateSecret(JSON.parse(value), oldKey, newKey));
 *     }
 *   }
 *   await supabase.from('project_secrets').update(updates).eq('project_id', row.project_id);
 * }
 * ```
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

/**
 * Versioned secret envelope
 */
export interface SecretEnvelope {
  algorithm: string;
  keyVersion: number;
  salt: string;      // base64
  iv: string;        // base64
  authTag: string;   // base64
  ciphertext: string; // base64
}

/**
 * Old local storage format (backward-compatibility)
 */
interface OldLocalFormat {
  iv: string;
  salt: string;
  authTag: string;
  data: string;    // old name for ciphertext
  version: number;
}

/**
 * Custom error for decryption failures
 */
export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

/**
 * Derive encryption key from password and salt using PBKDF2
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt a plaintext secret and return a versioned envelope
 */
export function encryptSecret(
  plaintext: string,
  encryptionKey: string,
  keyVersion: number = 1
): SecretEnvelope {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(encryptionKey, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  return {
    algorithm: ALGORITHM,
    keyVersion,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted,
  };
}

/**
 * Detect if input is an old local format
 */
function isOldLocalFormat(input: any): input is OldLocalFormat {
  return (
    typeof input === 'object' &&
    input.version === 1 &&
    typeof input.data === 'string' &&
    typeof input.iv === 'string' &&
    typeof input.salt === 'string' &&
    typeof input.authTag === 'string' &&
    !input.ciphertext &&
    !input.algorithm
  );
}

/**
 * Detect if input is an old supabase format (colon-delimited string)
 */
function isOldSupabaseFormat(input: any): boolean {
  if (typeof input !== 'string') return false;
  const parts = input.split(':');
  return parts.length === 4 && !input.includes('{');
}

/**
 * Convert old local format to new envelope
 */
function migrateOldLocalFormat(old: OldLocalFormat): SecretEnvelope {
  return {
    algorithm: ALGORITHM,
    keyVersion: old.version,
    salt: old.salt,
    iv: old.iv,
    authTag: old.authTag,
    ciphertext: old.data,
  };
}

/**
 * Convert old supabase format to new envelope
 */
function migrateOldSupabaseFormat(old: string): SecretEnvelope {
  const [salt, iv, authTag, ciphertext] = old.split(':');
  return {
    algorithm: ALGORITHM,
    keyVersion: 1, // Old format didn't have versioning
    salt,
    iv,
    authTag,
    ciphertext,
  };
}

/**
 * Decrypt a secret envelope or old format
 */
export function decryptSecret(
  envelope: SecretEnvelope | OldLocalFormat | string,
  encryptionKey: string
): string {
  try {
    // Handle old formats
    let normalizedEnvelope: SecretEnvelope;

    if (isOldLocalFormat(envelope)) {
      normalizedEnvelope = migrateOldLocalFormat(envelope);
    } else if (isOldSupabaseFormat(envelope)) {
      normalizedEnvelope = migrateOldSupabaseFormat(envelope as string);
    } else {
      normalizedEnvelope = envelope as SecretEnvelope;
    }

    // Perform decryption
    const salt = Buffer.from(normalizedEnvelope.salt, 'base64');
    const key = deriveKey(encryptionKey, salt);
    const iv = Buffer.from(normalizedEnvelope.iv, 'base64');
    const authTag = Buffer.from(normalizedEnvelope.authTag, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(normalizedEnvelope.ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // Sanitize error message to avoid leaking key material
    const baseMessage =
      error instanceof Error && error.message.includes('auth')
        ? 'Decryption failed: authentication tag mismatch (wrong key or tampered data)'
        : 'Decryption failed: invalid key or corrupted data';

    throw new DecryptionError(baseMessage);
  }
}

/**
 * Rotate a secret from one encryption key to another
 *
 * @param envelope - The current encrypted envelope
 * @param oldKey - The current encryption key
 * @param newKey - The new encryption key
 * @returns A new envelope encrypted with the new key and incremented version
 */
export function rotateSecret(
  envelope: SecretEnvelope | OldLocalFormat | string,
  oldKey: string,
  newKey: string
): SecretEnvelope {
  // Decrypt with old key
  const plaintext = decryptSecret(envelope, oldKey);

  // Get the current version
  let currentVersion = 1;
  if (typeof envelope === 'object' && 'keyVersion' in envelope) {
    currentVersion = envelope.keyVersion;
  } else if (isOldLocalFormat(envelope)) {
    currentVersion = envelope.version;
  }

  // Re-encrypt with new key and increment version
  return encryptSecret(plaintext, newKey, currentVersion + 1);
}
