/**
 * Vend strategies for the voice providers.
 *
 * The broker holds the game developer's long-lived provider keys server-side and
 * exchanges them for short-lived credentials a game client can hold, so no
 * provider key ever ships inside a distributed build.
 *
 * Only providers that publish an ephemeral-credential API can be vended this way.
 * The LLM vendors do not, which is why completions go through the proxy strategy
 * instead (see routes/broker.ts, POST /llm).
 *
 * Contracts verified against official provider documentation on 2026-09-05.
 */

import { createLogger } from '../logger.js';

const logger = createLogger('broker-vend');

export type VoiceProvider = 'deepgram' | 'cartesia' | 'elevenlabs';

export const VOICE_PROVIDERS: readonly VoiceProvider[] = ['deepgram', 'cartesia', 'elevenlabs'];

export const PROVIDER_ENDPOINTS: Record<VoiceProvider, string> = {
  deepgram: 'https://api.deepgram.com/v1/auth/grant',
  cartesia: 'https://api.cartesia.ai/access-token',
  elevenlabs: 'https://api.elevenlabs.io/v1/single-use-token/tts_websocket',
};

/**
 * Documented upper bounds. Deepgram and Cartesia accept a requested TTL up to an
 * hour; ElevenLabs fixes its own at 15 minutes and takes no TTL parameter.
 */
export const PROVIDER_MAX_TTL_SECONDS: Record<VoiceProvider, number> = {
  deepgram: 3600,
  cartesia: 3600,
  elevenlabs: 900,
};

/** Deepgram's own default when no TTL is requested. */
const DEEPGRAM_DEFAULT_TTL_SECONDS = 30;

/** Required by Cartesia on every request. */
export const CARTESIA_API_VERSION = '2026-08-14';

export interface VendedCredential {
  provider: VoiceProvider;
  /** The short-lived provider credential. */
  credential: string;
  expiresAt: string;
  /**
   * True when the credential is consumed by its first use and a fresh one is
   * required per connection. ElevenLabs behaves this way; the others are
   * time-bound but reusable within their TTL.
   */
  singleUse: boolean;
}

/** Minimal shape of the HTTP boundary, so tests can inject a stub. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

function clampTtl(provider: VoiceProvider, requested: number | undefined, fallback: number): number {
  const max = PROVIDER_MAX_TTL_SECONDS[provider];
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) {
    return Math.min(fallback, max);
  }
  return Math.min(Math.floor(requested), max);
}

function expiryFrom(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/**
 * Build the provider-specific request. Kept separate from dispatch so each
 * provider's exact contract is readable in one place.
 */
function buildRequest(
  provider: VoiceProvider,
  apiKey: string,
  ttlSeconds: number | undefined
): { url: string; init: { method: string; headers: Record<string, string>; body?: string }; ttl: number } {
  switch (provider) {
    case 'deepgram': {
      const ttl = clampTtl('deepgram', ttlSeconds, DEEPGRAM_DEFAULT_TTL_SECONDS);
      return {
        url: PROVIDER_ENDPOINTS.deepgram,
        init: {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl_seconds: ttl }),
        },
        ttl,
      };
    }

    case 'cartesia': {
      const ttl = clampTtl('cartesia', ttlSeconds, PROVIDER_MAX_TTL_SECONDS.cartesia);
      return {
        url: PROVIDER_ENDPOINTS.cartesia,
        init: {
          method: 'POST',
          headers: {
            // Cartesia takes the bare key, with no scheme prefix.
            Authorization: apiKey,
            'Cartesia-Version': CARTESIA_API_VERSION,
            'Content-Type': 'application/json',
          },
          // Least privilege: request the text-to-speech grant only.
          body: JSON.stringify({ grants: { tts: true }, expires_in: ttl }),
        },
        ttl,
      };
    }

    case 'elevenlabs': {
      // The endpoint takes no body and fixes its own 15-minute lifetime.
      return {
        url: PROVIDER_ENDPOINTS.elevenlabs,
        init: {
          method: 'POST',
          headers: { 'xi-api-key': apiKey },
        },
        ttl: PROVIDER_MAX_TTL_SECONDS.elevenlabs,
      };
    }

    default:
      throw new Error(`Unsupported voice provider: ${String(provider)}`);
  }
}

function readCredential(provider: VoiceProvider, payload: unknown): string {
  const body = (payload ?? {}) as Record<string, unknown>;
  // Deepgram returns access_token; Cartesia and ElevenLabs return token.
  const value = provider === 'deepgram' ? body.access_token : body.token;

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Provider ${provider} returned no credential`);
  }
  return value;
}

/**
 * Exchange a long-lived provider key for a short-lived credential.
 *
 * Throws on any failure. Error messages deliberately carry the provider and the
 * HTTP status but never the key, because they reach logs.
 */
export async function vendCredential(
  provider: VoiceProvider,
  apiKey: string,
  ttlSeconds?: number,
  fetchImpl?: FetchLike
): Promise<VendedCredential> {
  if (!VOICE_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported voice provider: ${String(provider)}`);
  }
  if (!apiKey) {
    throw new Error(`No stored API key for provider ${provider}`);
  }

  const doFetch = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const { url, init, ttl } = buildRequest(provider, apiKey, ttlSeconds);

  let response;
  try {
    response = await doFetch(url, init);
  } catch (error) {
    logger.error(
      { provider, error: error instanceof Error ? error.message : 'Unknown' },
      'Credential vend request failed to reach provider'
    );
    throw new Error(`Provider ${provider} was unreachable`);
  }

  if (!response.ok) {
    logger.warn({ provider, status: response.status }, 'Provider refused to issue a credential');
    throw new Error(`Provider ${provider} refused to issue a credential (status ${response.status})`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Provider ${provider} returned an unreadable response`);
  }

  const credential = readCredential(provider, payload);

  // Deepgram reports the lifetime it actually granted; prefer it over our request.
  const grantedTtl =
    provider === 'deepgram' &&
    typeof (payload as Record<string, unknown>).expires_in === 'number'
      ? ((payload as Record<string, unknown>).expires_in as number)
      : ttl;

  logger.info({ provider, ttlSeconds: grantedTtl }, 'Vended short-lived provider credential');

  return {
    provider,
    credential,
    expiresAt: expiryFrom(grantedTtl),
    singleUse: provider === 'elevenlabs',
  };
}
