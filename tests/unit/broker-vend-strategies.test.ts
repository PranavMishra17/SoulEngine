/**
 * Vend strategies: the broker exchanges the developer's long-lived provider key
 * for a short-lived credential the game client can hold.
 *
 * Contracts verified against official provider documentation on 2026-09-05:
 *  - Deepgram   POST /v1/auth/grant                        Authorization: Token <key>
 *  - Cartesia   POST /access-token                         bare Authorization + Cartesia-Version
 *  - ElevenLabs POST /v1/single-use-token/tts_websocket    xi-api-key, consumed on use
 *
 * These tests never touch the network; the HTTP boundary is injected.
 */
import { describe, it, expect } from 'vitest';
import {
  vendCredential,
  PROVIDER_MAX_TTL_SECONDS,
  type VoiceProvider,
} from '../../src/broker/vend-strategies.js';

interface Captured {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: unknown;
}

function stubFetch(status: number, payload: unknown) {
  const calls: Captured[] = [];
  const impl = async (url: string, init: any) => {
    calls.push({
      url,
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  return { impl, calls };
}

describe('broker vend strategies', () => {
  describe('deepgram', () => {
    it('posts to the grant endpoint with a Token authorization header', async () => {
      const { impl, calls } = stubFetch(200, { access_token: 'dg-jwt', expires_in: 30 });

      const result = await vendCredential('deepgram', 'dg-secret-key', 30, impl);

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://api.deepgram.com/v1/auth/grant');
      expect(calls[0].method).toBe('POST');
      expect(calls[0].headers['Authorization']).toBe('Token dg-secret-key');
      expect(calls[0].body).toEqual({ ttl_seconds: 30 });

      expect(result.credential).toBe('dg-jwt');
      expect(result.singleUse).toBe(false);
      expect(result.provider).toBe('deepgram');
    });

    it('clamps the requested TTL to the documented maximum', async () => {
      const { impl, calls } = stubFetch(200, { access_token: 'dg-jwt', expires_in: 3600 });

      await vendCredential('deepgram', 'dg-secret-key', 99999, impl);

      expect((calls[0].body as any).ttl_seconds).toBe(PROVIDER_MAX_TTL_SECONDS.deepgram);
      expect(PROVIDER_MAX_TTL_SECONDS.deepgram).toBe(3600);
    });
  });

  describe('cartesia', () => {
    it('sends a bare Authorization header, the version header, and a tts-only grant', async () => {
      const { impl, calls } = stubFetch(200, { token: 'ct-token' });

      const result = await vendCredential('cartesia', 'sk_car_secret', 600, impl);

      expect(calls[0].url).toBe('https://api.cartesia.ai/access-token');
      // Bare key, no "Bearer" and no "Token" prefix.
      expect(calls[0].headers['Authorization']).toBe('sk_car_secret');
      expect(calls[0].headers['Cartesia-Version']).toBeTruthy();
      // Least privilege: ask for tts only, never stt or agent.
      expect(calls[0].body).toEqual({ grants: { tts: true }, expires_in: 600 });

      expect(result.credential).toBe('ct-token');
      expect(result.singleUse).toBe(false);
    });

    it('clamps the requested TTL to the documented maximum', async () => {
      const { impl, calls } = stubFetch(200, { token: 'ct-token' });

      await vendCredential('cartesia', 'sk_car_secret', 99999, impl);

      expect((calls[0].body as any).expires_in).toBe(PROVIDER_MAX_TTL_SECONDS.cartesia);
    });
  });

  describe('elevenlabs', () => {
    it('posts to the tts_websocket token endpoint with an xi-api-key header and no body', async () => {
      const { impl, calls } = stubFetch(200, { token: 'sutkn_abc' });

      const result = await vendCredential('elevenlabs', 'el-secret', undefined, impl);

      expect(calls[0].url).toBe('https://api.elevenlabs.io/v1/single-use-token/tts_websocket');
      expect(calls[0].headers['xi-api-key']).toBe('el-secret');
      expect(calls[0].body).toBeUndefined();

      expect(result.credential).toBe('sutkn_abc');
    });

    it('reports the credential as single-use so a client never reuses it', async () => {
      const { impl } = stubFetch(200, { token: 'sutkn_abc' });

      const result = await vendCredential('elevenlabs', 'el-secret', undefined, impl);

      // ElevenLabs consumes the token on use. A client that caches it like the
      // other two would fail on its second connection.
      expect(result.singleUse).toBe(true);
    });

    it('ignores a requested TTL because the provider fixes it at 15 minutes', async () => {
      const { impl, calls } = stubFetch(200, { token: 'sutkn_abc' });

      await vendCredential('elevenlabs', 'el-secret', 3600, impl);

      expect(calls[0].body).toBeUndefined();
      expect(PROVIDER_MAX_TTL_SECONDS.elevenlabs).toBe(900);
    });
  });

  describe('failure handling', () => {
    it.each(['deepgram', 'cartesia', 'elevenlabs'] as VoiceProvider[])(
      'throws without leaking the provider key when %s rejects the request',
      async (provider) => {
        const { impl } = stubFetch(401, { error: 'unauthorized' });
        const secret = 'super-secret-key-value';

        let thrown: unknown;
        try {
          await vendCredential(provider, secret, 60, impl);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        // The message reaches logs and, on a bad day, a response. It must not
        // carry the long-lived key it was built from.
        expect(String(thrown)).not.toContain(secret);
        expect(String(thrown)).toContain(provider);
      }
    );

    it('rejects an unknown provider', async () => {
      const { impl } = stubFetch(200, {});
      await expect(
        vendCredential('nope' as VoiceProvider, 'k', 60, impl)
      ).rejects.toThrow();
    });
  });
});
