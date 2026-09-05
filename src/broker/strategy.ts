/**
 * Credential strategy interface for the broker
 *
 * Two strategies:
 * 1. vend - Issue short-lived provider credentials (client calls provider directly)
 * 2. proxy - Forward requests server-side (no ephemeral credential API exists)
 *
 * This file defines the interface. Concrete implementations are added per provider.
 */

export type CredentialScope = 'llm' | 'stt' | 'tts' | 'realtime';

export interface VendCredentialRequest {
  projectId: string;
  scope: CredentialScope;
  ttlSeconds?: number;
}

export interface VendCredentialResponse {
  credential: string; // Provider-specific ephemeral token or signed URL
  expiresAt: string;
}

export interface ProxyRequest {
  projectId: string;
  scope: CredentialScope;
  payload: unknown; // Provider-specific request body
}

export interface ProxyResponse {
  result: unknown; // Provider-specific response
}

/**
 * Strategy interface for credential vending
 *
 * Implementations:
 * - OpenAI Realtime: POST /v1/realtime/client_secrets
 * - ElevenLabs: signed URLs
 * - Deepgram: temporary keys
 *
 * Deferred to follow-up items.
 */
export interface VendStrategy {
  vend(request: VendCredentialRequest): Promise<VendCredentialResponse>;
}

/**
 * Strategy interface for request proxying
 *
 * Implementations:
 * - LLM (Anthropic, Gemini, OpenAI chat) - no ephemeral API
 * - STT (future)
 * - TTS (future)
 */
export interface ProxyStrategy {
  proxy(request: ProxyRequest): Promise<ProxyResponse>;
}
