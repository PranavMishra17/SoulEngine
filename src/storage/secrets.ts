import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { createLogger } from '../logger.js';
import { getConfig } from '../config.js';
import { StorageError, StorageValidationError } from './interface.js';

const logger = createLogger('secrets-storage');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

/**
 * API keys stored for a project
 */
export interface ApiKeys {
  // LLM providers
  gemini?: string;
  openai?: string;
  anthropic?: string;
  grok?: string;
  // STT providers
  deepgram?: string;
  // TTS providers
  cartesia?: string;
  elevenlabs?: string;
}

/**
 * Internal encrypted data structure
 */
interface EncryptedData {
  iv: string;
  salt: string;
  authTag: string;
  data: string;
  version: number;
}

/**
 * Get the path to a project's secrets file
 */
function getSecretsPath(projectId: string): string {
  const config = getConfig();
  return path.join(config.dataDir, 'projects', projectId, 'secrets.enc');
}

/**
 * Derive encryption key from password and salt
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt data using AES-256-GCM
 */
function encrypt(data: string, encryptionKey: string): EncryptedData {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(encryptionKey, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    authTag: authTag.toString('base64'),
    data: encrypted,
    version: 1,
  };
}

/**
 * Decrypt data using AES-256-GCM
 */
function decrypt(encryptedData: EncryptedData, encryptionKey: string): string {
  const salt = Buffer.from(encryptedData.salt, 'base64');
  const key = deriveKey(encryptionKey, salt);
  const iv = Buffer.from(encryptedData.iv, 'base64');
  const authTag = Buffer.from(encryptedData.authTag, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData.data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Get the encryption key from config
 */
function getEncryptionKey(): string {
  const config = getConfig();
  if (!config.encryptionKey) {
    throw new StorageValidationError(
      'ENCRYPTION_KEY environment variable is required for secrets storage'
    );
  }
  return config.encryptionKey;
}

/**
 * Save API keys for a project (encrypted)
 */
export async function saveApiKeys(projectId: string, keys: ApiKeys): Promise<void> {
  const startTime = Date.now();
  const secretsPath = getSecretsPath(projectId);

  try {
    const encryptionKey = getEncryptionKey();
    const data = JSON.stringify(keys);
    const encryptedData = encrypt(data, encryptionKey);

    await fs.writeFile(secretsPath, JSON.stringify(encryptedData, null, 2), 'utf-8');

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration, keyCount: Object.keys(keys).length }, 'API keys saved');
  } catch (error) {
    if (error instanceof StorageValidationError) {
      throw error;
    }

    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to save API keys');
    throw new StorageError(`Failed to save API keys: ${errorMessage}`);
  }
}

/**
 * Load API keys for a project (decrypted)
 */
export async function loadApiKeys(projectId: string): Promise<ApiKeys> {
  const startTime = Date.now();
  const secretsPath = getSecretsPath(projectId);

  try {
    const encryptionKey = getEncryptionKey();
    const content = await fs.readFile(secretsPath, 'utf-8');
    const encryptedData = JSON.parse(content) as EncryptedData;
    const decrypted = decrypt(encryptedData, encryptionKey);
    const keys = JSON.parse(decrypted) as ApiKeys;

    const duration = Date.now() - startTime;
    logger.debug({ projectId, duration }, 'API keys loaded');

    return keys;
  } catch (error) {
    const duration = Date.now() - startTime;

    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug({ projectId, duration }, 'No API keys file found, returning empty');
      return {};
    }

    if (error instanceof StorageValidationError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to load API keys');
    throw new StorageError(`Failed to load API keys: ${errorMessage}`);
  }
}

/**
 * Update specific API keys for a project (merges with existing)
 */
export async function updateApiKeys(projectId: string, updates: Partial<ApiKeys>): Promise<ApiKeys> {
  const startTime = Date.now();

  try {
    const existing = await loadApiKeys(projectId);
    const merged: ApiKeys = { ...existing };

    // Only update non-undefined values
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        merged[key as keyof ApiKeys] = value;
      }
    }

    await saveApiKeys(projectId, merged);

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration }, 'API keys updated');

    return merged;
  } catch (error) {
    if (error instanceof StorageValidationError || error instanceof StorageError) {
      throw error;
    }

    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to update API keys');
    throw new StorageError(`Failed to update API keys: ${errorMessage}`);
  }
}

/**
 * Delete API keys for a project
 */
export async function deleteApiKeys(projectId: string): Promise<void> {
  const startTime = Date.now();
  const secretsPath = getSecretsPath(projectId);

  try {
    await fs.unlink(secretsPath);

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration }, 'API keys deleted');
  } catch (error) {
    const duration = Date.now() - startTime;

    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist, nothing to delete
      logger.debug({ projectId, duration }, 'No API keys file to delete');
      return;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to delete API keys');
    throw new StorageError(`Failed to delete API keys: ${errorMessage}`);
  }
}

/**
 * Check if API keys exist for a project
 */
export async function hasApiKeys(projectId: string): Promise<boolean> {
  const secretsPath = getSecretsPath(projectId);
  try {
    await fs.access(secretsPath);
    return true;
  } catch {
    return false;
  }
}
