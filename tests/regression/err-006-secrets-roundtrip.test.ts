/**
 * ERR-006 Regression Test: Rotatable, portable encrypted secrets
 *
 * Verifies:
 * - Round-trip correctness (encrypt → decrypt returns original)
 * - Key rotation (decrypt with old key fails gracefully, new key succeeds)
 * - Wrong-key decryption fails with clear error, no leaked material
 * - Backward-compatibility with old local and supabase formats
 */

import { describe, it, expect } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  rotateSecret,
  SecretEnvelope,
  DecryptionError,
} from '../../src/storage/crypto/secrets.js';

describe('ERR-006: Shared secret crypto with key rotation', () => {
  const testKey1 = 'test-encryption-key-version-1';
  const testKey2 = 'test-encryption-key-version-2';
  const plaintext = 'sk-test-api-key-12345';
  const plaintextObj = { gemini: 'key1', openai: 'key2' };

  it('round-trip: encrypt with key A → decrypt with key A returns original', () => {
    const envelope = encryptSecret(plaintext, testKey1, 1);
    const decrypted = decryptSecret(envelope, testKey1);
    expect(decrypted).toBe(plaintext);
  });

  it('round-trip: encrypt JSON object → decrypt returns original', () => {
    const json = JSON.stringify(plaintextObj);
    const envelope = encryptSecret(json, testKey1, 1);
    const decrypted = decryptSecret(envelope, testKey1);
    expect(JSON.parse(decrypted)).toEqual(plaintextObj);
  });

  it('envelope includes keyVersion and algorithm', () => {
    const envelope = encryptSecret(plaintext, testKey1, 1);
    expect(envelope.keyVersion).toBe(1);
    expect(envelope.algorithm).toBe('aes-256-gcm');
    expect(envelope.salt).toBeDefined();
    expect(envelope.iv).toBeDefined();
    expect(envelope.authTag).toBeDefined();
    expect(envelope.ciphertext).toBeDefined();
  });

  it('rotate: decrypt with old key fails, new key succeeds', () => {
    const envelope = encryptSecret(plaintext, testKey1, 1);
    const rotated = rotateSecret(envelope, testKey1, testKey2);

    // Rotated envelope should have incremented version
    expect(rotated.keyVersion).toBe(2);

    // Decrypt with new key succeeds
    const decrypted = decryptSecret(rotated, testKey2);
    expect(decrypted).toBe(plaintext);

    // Decrypt with old key fails gracefully
    expect(() => decryptSecret(rotated, testKey1)).toThrow(DecryptionError);
  });

  it('wrong key: decrypt fails with clear error, no leaked material', () => {
    const envelope = encryptSecret(plaintext, testKey1, 1);

    try {
      decryptSecret(envelope, 'wrong-key');
      expect.fail('Should have thrown DecryptionError');
    } catch (error) {
      expect(error).toBeInstanceOf(DecryptionError);
      const msg = (error as Error).message.toLowerCase();
      // Error message should NOT leak plaintext or key material
      expect(msg).not.toContain(plaintext);
      expect(msg).not.toContain(testKey1);
      // Should mention decryption failure
      expect(msg).toMatch(/decrypt|auth|key/);
    }
  });

  it('tampered authTag: decrypt fails with integrity error', () => {
    const envelope = encryptSecret(plaintext, testKey1, 1);
    // Tamper with the authTag
    const tampered: SecretEnvelope = {
      ...envelope,
      authTag: Buffer.from('tampered', 'utf8').toString('base64'),
    };

    expect(() => decryptSecret(tampered, testKey1)).toThrow(DecryptionError);
  });

  it('backward-compat: old local format (version 1 JSON) decrypts correctly', () => {
    // Simulate old local format: {iv, salt, authTag, data, version: 1}
    // We'll create one using the new module but in old shape, then verify it decrypts
    const oldEnvelope = encryptSecret(plaintext, testKey1, 1);

    // Convert to old local format (keys: iv, salt, authTag, data, version)
    const oldFormat = {
      iv: oldEnvelope.iv,
      salt: oldEnvelope.salt,
      authTag: oldEnvelope.authTag,
      data: oldEnvelope.ciphertext,  // old format used 'data' instead of 'ciphertext'
      version: 1,
    };

    // The shared module should handle this old format
    const decrypted = decryptSecret(oldFormat as any, testKey1);
    expect(decrypted).toBe(plaintext);
  });

  it('backward-compat: old supabase format (colon-delimited) decrypts correctly', () => {
    // Simulate old supabase format: "salt:iv:authTag:ciphertext"
    const envelope = encryptSecret(plaintext, testKey1, 1);
    const oldFormat = `${envelope.salt}:${envelope.iv}:${envelope.authTag}:${envelope.ciphertext}`;

    // The shared module should handle this old format
    const decrypted = decryptSecret(oldFormat as any, testKey1);
    expect(decrypted).toBe(plaintext);
  });

  it('each encryption uses unique salt and IV (no reuse)', () => {
    const env1 = encryptSecret(plaintext, testKey1, 1);
    const env2 = encryptSecret(plaintext, testKey1, 1);

    // Same plaintext and key, but different salt/IV
    expect(env1.salt).not.toBe(env2.salt);
    expect(env1.iv).not.toBe(env2.iv);
    expect(env1.ciphertext).not.toBe(env2.ciphertext);

    // Both decrypt correctly
    expect(decryptSecret(env1, testKey1)).toBe(plaintext);
    expect(decryptSecret(env2, testKey1)).toBe(plaintext);
  });
});
