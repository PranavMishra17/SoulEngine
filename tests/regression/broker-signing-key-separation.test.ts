/**
 * Regression: the broker's token-signing secret must be independent of the
 * secret that encrypts developers' BYOK provider keys at rest.
 *
 * Original defect: `getSigningKey()` in src/broker/token.ts fell back to
 * `config.encryptionKey` when BROKER_TOKEN_SECRET was unset. ENCRYPTION_KEY is
 * the master secret used by src/storage/crypto/secrets.ts to AES-256-GCM the
 * developer's OpenAI / Anthropic / ElevenLabs keys. Reusing it to sign broker
 * tokens couples two unrelated security purposes: a weakness or leak in the
 * token-signing path would implicate every stored provider key.
 *
 * Threat model: an attacker who recovers the token-signing secret (via a
 * signing oracle, a log leak, or a timing/implementation flaw in the token
 * path) must NOT thereby gain the ability to decrypt secrets at rest. The two
 * keys must be separately configurable and separately rotatable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ENCRYPTION_ONLY = 'test-encryption-key-min-32-chars-long-secret';
const BROKER_ONLY = 'test-broker-signing-secret-min-32-chars-long';

describe('broker signing key separation', () => {
  const saved = {
    encryption: process.env.ENCRYPTION_KEY,
    broker: process.env.BROKER_TOKEN_SECRET,
  };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (saved.encryption === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = saved.encryption;
    if (saved.broker === undefined) delete process.env.BROKER_TOKEN_SECRET;
    else process.env.BROKER_TOKEN_SECRET = saved.broker;
    vi.resetModules();
  });

  it('refuses to mint a token when only ENCRYPTION_KEY is configured', async () => {
    process.env.ENCRYPTION_KEY = ENCRYPTION_ONLY;
    delete process.env.BROKER_TOKEN_SECRET;

    const { mintBrokerToken } = await import('../../src/broker/token.js');

    expect(() =>
      mintBrokerToken({ projectId: 'proj_separation', scopes: ['llm'] })
    ).toThrow(/BROKER_TOKEN_SECRET/);
  });

  it('mints a token when BROKER_TOKEN_SECRET is configured', async () => {
    process.env.ENCRYPTION_KEY = ENCRYPTION_ONLY;
    process.env.BROKER_TOKEN_SECRET = BROKER_ONLY;

    const { mintBrokerToken, verifyBrokerToken } = await import('../../src/broker/token.js');

    const token = mintBrokerToken({ projectId: 'proj_separation', scopes: ['llm'] });
    expect(token).toBeTruthy();

    const result = verifyBrokerToken(token, ['llm']);
    expect(result.valid).toBe(true);
    expect(result.payload?.projectId).toBe('proj_separation');
  });

  it('does not accept a token signed with the encryption key', async () => {
    // Mint under a configuration where the broker secret IS the encryption key,
    // then verify under a configuration where the two are properly separated.
    // The signature must not carry across — proving the keys are independent.
    process.env.ENCRYPTION_KEY = ENCRYPTION_ONLY;
    process.env.BROKER_TOKEN_SECRET = ENCRYPTION_ONLY;

    const first = await import('../../src/broker/token.js');
    const forged = first.mintBrokerToken({ projectId: 'proj_separation', scopes: ['llm'] });

    vi.resetModules();
    process.env.BROKER_TOKEN_SECRET = BROKER_ONLY;

    const second = await import('../../src/broker/token.js');
    const result = second.verifyBrokerToken(forged, ['llm']);

    expect(result.valid).toBe(false);
  });
});
