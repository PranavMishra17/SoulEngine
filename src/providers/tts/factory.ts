import { createLogger } from '../../logger.js';
import type { TTSProvider, TTSProviderConfig, TTSProviderType } from './interface.js';
import { createCartesiaProvider } from './cartesia.js';
import { createElevenLabsProvider } from './elevenlabs.js';

const logger = createLogger('tts-factory');

/**
 * Configuration for creating a TTS provider via factory
 */
export interface TTSFactoryConfig extends TTSProviderConfig {
  /** Provider type to create */
  provider: TTSProviderType;
}

/**
 * Create a TTS provider based on the specified type
 * @param config Factory configuration including provider type
 * @returns The created TTS provider
 * @throws Error if provider type is unknown
 */
export function createTtsProvider(config: TTSFactoryConfig): TTSProvider {
  const { provider, ...providerConfig } = config;

  logger.info({ provider }, 'Creating TTS provider');

  switch (provider) {
    case 'cartesia':
      return createCartesiaProvider(providerConfig);

    case 'elevenlabs':
      return createElevenLabsProvider(providerConfig);

    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unknown TTS provider type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Get the default TTS provider type
 * Cartesia is the default due to low latency and cost-effectiveness
 */
export function getDefaultTtsProviderType(): TTSProviderType {
  return 'cartesia';
}
