import * as crypto from 'crypto';
import { getSupabaseAdmin } from './client.js';
import { createLogger } from '../../logger.js';
import { getConfig } from '../../config.js';
import { StorageError, StorageValidationError } from '../interface.js';

const logger = createLogger('supabase-secrets');

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
 * Derive encryption key from password and salt
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt a single API key
 */
function encryptKey(value: string, encryptionKey: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(encryptionKey, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(value, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  // Format: salt:iv:authTag:data
  return `${salt.toString('base64')}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt a single API key
 */
function decryptKey(encrypted: string, encryptionKey: string): string {
  const parts = encrypted.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted key format');
  }

  const [saltB64, ivB64, authTagB64, data] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const key = deriveKey(encryptionKey, salt);
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(data, 'base64', 'utf8');
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
  const supabase = getSupabaseAdmin();

  try {
    const encryptionKey = getEncryptionKey();

    const updateData: Record<string, string | null> = {
      gemini_key_encrypted: keys.gemini ? encryptKey(keys.gemini, encryptionKey) : null,
      openai_key_encrypted: keys.openai ? encryptKey(keys.openai, encryptionKey) : null,
      anthropic_key_encrypted: keys.anthropic ? encryptKey(keys.anthropic, encryptionKey) : null,
      grok_key_encrypted: keys.grok ? encryptKey(keys.grok, encryptionKey) : null,
      deepgram_key_encrypted: keys.deepgram ? encryptKey(keys.deepgram, encryptionKey) : null,
      cartesia_key_encrypted: keys.cartesia ? encryptKey(keys.cartesia, encryptionKey) : null,
      elevenlabs_key_encrypted: keys.elevenlabs ? encryptKey(keys.elevenlabs, encryptionKey) : null,
    };

    const { error } = await supabase
      .from('project_secrets')
      .upsert({
        project_id: projectId,
        ...updateData,
      }, {
        onConflict: 'project_id',
      });

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration, keyCount: Object.keys(keys).filter(k => keys[k as keyof ApiKeys]).length }, 'API keys saved');
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageValidationError || error instanceof StorageError) throw error;
    
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
  const supabase = getSupabaseAdmin();

  try {
    const encryptionKey = getEncryptionKey();

    const { data, error } = await supabase
      .from('project_secrets')
      .select('*')
      .eq('project_id', projectId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No secrets found
        logger.debug({ projectId }, 'No API keys found, returning empty');
        return {};
      }
      throw new StorageError(`Database error: ${error.message}`);
    }

    const keys: ApiKeys = {};

    if (data.gemini_key_encrypted) {
      keys.gemini = decryptKey(data.gemini_key_encrypted, encryptionKey);
    }
    if (data.openai_key_encrypted) {
      keys.openai = decryptKey(data.openai_key_encrypted, encryptionKey);
    }
    if (data.anthropic_key_encrypted) {
      keys.anthropic = decryptKey(data.anthropic_key_encrypted, encryptionKey);
    }
    if (data.grok_key_encrypted) {
      keys.grok = decryptKey(data.grok_key_encrypted, encryptionKey);
    }
    if (data.deepgram_key_encrypted) {
      keys.deepgram = decryptKey(data.deepgram_key_encrypted, encryptionKey);
    }
    if (data.cartesia_key_encrypted) {
      keys.cartesia = decryptKey(data.cartesia_key_encrypted, encryptionKey);
    }
    if (data.elevenlabs_key_encrypted) {
      keys.elevenlabs = decryptKey(data.elevenlabs_key_encrypted, encryptionKey);
    }

    const duration = Date.now() - startTime;
    logger.debug({ projectId, duration }, 'API keys loaded');

    return keys;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageValidationError || error instanceof StorageError) throw error;
    
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
    const duration = Date.now() - startTime;
    if (error instanceof StorageValidationError || error instanceof StorageError) throw error;
    
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
  const supabase = getSupabaseAdmin();

  try {
    const { error } = await supabase
      .from('project_secrets')
      .delete()
      .eq('project_id', projectId);

    if (error) {
      throw new StorageError(`Database error: ${error.message}`);
    }

    const duration = Date.now() - startTime;
    logger.info({ projectId, duration }, 'API keys deleted');
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageError) throw error;
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to delete API keys');
    throw new StorageError(`Failed to delete API keys: ${errorMessage}`);
  }
}

/**
 * Check if API keys exist for a project
 */
export async function hasApiKeys(projectId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  const { count, error } = await supabase
    .from('project_secrets')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId);

  if (error) {
    return false;
  }

  return (count || 0) > 0;
}
