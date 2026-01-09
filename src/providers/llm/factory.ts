import { createLogger } from '../../logger.js';
import type { LLMProvider, LLMProviderType, LLMFactoryConfig } from './interface.js';
import { createGeminiProvider } from './gemini.js';
import { createOpenAIProvider } from './openai.js';
import { createAnthropicProvider } from './anthropic.js';
import { createGrokProvider } from './grok.js';

const logger = createLogger('llm-factory');

/**
 * Create an LLM provider based on the specified type
 * @param config Factory configuration including provider type
 * @returns The created LLM provider
 * @throws Error if provider type is unknown or API key missing
 */
export function createLlmProvider(config: LLMFactoryConfig): LLMProvider {
  const { provider, ...providerConfig } = config;

  logger.info({ provider, model: providerConfig.model }, 'Creating LLM provider');

  switch (provider) {
    case 'gemini':
      return createGeminiProvider(providerConfig);

    case 'openai':
      return createOpenAIProvider(providerConfig);

    case 'anthropic':
      return createAnthropicProvider(providerConfig);

    case 'grok':
      return createGrokProvider(providerConfig);

    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unknown LLM provider type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Get the default LLM provider type
 */
export function getDefaultLlmProviderType(): LLMProviderType {
  return 'gemini';
}

/**
 * Check if an LLM provider type is supported
 */
export function isLlmProviderSupported(provider: string): provider is LLMProviderType {
  return ['gemini', 'openai', 'anthropic', 'grok'].includes(provider);
}

/**
 * Get all supported LLM provider types
 */
export function getSupportedLlmProviders(): LLMProviderType[] {
  return ['gemini', 'openai', 'anthropic', 'grok'];
}

/**
 * Get default model for a provider type
 */
export function getDefaultModel(provider: LLMProviderType): string {
  switch (provider) {
    case 'gemini':
      return 'gemini-2.5-flash';
    case 'openai':
      return 'gpt-4o';
    case 'anthropic':
      return 'claude-3-5-sonnet-20241022';
    case 'grok':
      return 'grok-beta';
    default:
      return 'gemini-2.5-flash';
  }
}

/**
 * Get available models for a provider type
 */
export function getModelsForProvider(provider: LLMProviderType): { id: string; name: string }[] {
  switch (provider) {
    case 'gemini':
      return [
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Fast)' },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Smart)' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      ];
    case 'openai':
      return [
        { id: 'gpt-4o', name: 'GPT-4o (Recommended)' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast)' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (Economy)' },
      ];
    case 'anthropic':
      return [
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Recommended)' },
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus (Smart)' },
        { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku (Fast)' },
      ];
    case 'grok':
      return [
        { id: 'grok-beta', name: 'Grok Beta' },
        { id: 'grok-2', name: 'Grok 2' },
      ];
    default:
      return [];
  }
}

