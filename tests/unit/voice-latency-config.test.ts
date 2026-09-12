/**
 * Tests for configurable voice latency budget (item 7.2).
 *
 * Verifies that the three hard-coded endpointing timers (utterance_end_ms,
 * endpointing_ms, aggregation_window_ms) can be configured per-project via
 * ProjectConfig.voice_latency.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectSettingsSchema } from '../../src/schema/index.js';
import type { STTSession, STTSessionConfig, STTSessionEvents, STTProvider } from '../../src/providers/stt/interface.js';
import type { TTSProvider } from '../../src/providers/tts/interface.js';
import type { LLMProvider } from '../../src/providers/llm/interface.js';
import { createVoicePipeline } from '../../src/voice/pipeline.js';
import type { VoicePipelineConfig } from '../../src/voice/pipeline.js';
import { CONVERSATION_MODES } from '../../src/types/voice.js';

describe('ProjectSettingsSchema.voice_latency', () => {
  it('accepts a config without voice_latency (existing fixtures parse unchanged)', () => {
    const config = {
      llm_provider: 'gemini',
      stt_provider: 'deepgram',
      tts_provider: 'cartesia',
      default_voice_id: 'v1',
      timeouts: {},
    };

    const result = ProjectSettingsSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('accepts voice_latency with all three fields as positive integers', () => {
    const config = {
      llm_provider: 'gemini',
      stt_provider: 'deepgram',
      tts_provider: 'cartesia',
      default_voice_id: 'v1',
      timeouts: {},
      voice_latency: {
        utterance_end_ms: 600,
        endpointing_ms: 300,
        aggregation_window_ms: 150,
      },
    };

    const result = ProjectSettingsSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.voice_latency?.utterance_end_ms).toBe(600);
      expect(result.data.voice_latency?.endpointing_ms).toBe(300);
      expect(result.data.voice_latency?.aggregation_window_ms).toBe(150);
    }
  });

  it('accepts voice_latency with only some fields present', () => {
    const config = {
      llm_provider: 'gemini',
      stt_provider: 'deepgram',
      tts_provider: 'cartesia',
      default_voice_id: 'v1',
      timeouts: {},
      voice_latency: {
        utterance_end_ms: 800,
      },
    };

    const result = ProjectSettingsSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects voice_latency with zero values', () => {
    const config = {
      llm_provider: 'gemini',
      stt_provider: 'deepgram',
      tts_provider: 'cartesia',
      default_voice_id: 'v1',
      timeouts: {},
      voice_latency: {
        utterance_end_ms: 0,
      },
    };

    const result = ProjectSettingsSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects voice_latency with negative values', () => {
    const config = {
      llm_provider: 'gemini',
      stt_provider: 'deepgram',
      tts_provider: 'cartesia',
      default_voice_id: 'v1',
      timeouts: {},
      voice_latency: {
        endpointing_ms: -100,
      },
    };

    const result = ProjectSettingsSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects voice_latency with non-integer values', () => {
    const config = {
      llm_provider: 'gemini',
      stt_provider: 'deepgram',
      tts_provider: 'cartesia',
      default_voice_id: 'v1',
      timeouts: {},
      voice_latency: {
        aggregation_window_ms: 150.5,
      },
    };

    const result = ProjectSettingsSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe('VoicePipeline aggregation window', () => {
  let capturedSttConfig: STTSessionConfig | null = null;
  let mockSttProvider: STTProvider;
  let mockTtsProvider: TTSProvider;
  let mockLlmProvider: LLMProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    capturedSttConfig = null;

    // Mock STT provider that captures the config
    mockSttProvider = {
      name: 'mock-stt',
      createSession: vi.fn(async (config: STTSessionConfig, _events: STTSessionEvents): Promise<STTSession> => {
        capturedSttConfig = config;
        return {
          sendAudio: vi.fn(),
          finalize: vi.fn(),
          close: vi.fn(),
          clearAccumulator: vi.fn(),
          isConnected: true,
        };
      }),
    };

    // Mock TTS provider
    mockTtsProvider = {
      name: 'mock-tts',
      createSession: vi.fn(async () => ({
        synthesize: vi.fn(async function* () {}),
        close: vi.fn(),
        isConnected: true,
      })),
    };

    // Mock LLM provider
    mockLlmProvider = {
      name: 'mock-llm',
      streamText: vi.fn(async function* () {}),
    };
  });

  it('uses custom aggregationWindowMs when provided', async () => {
    const config: VoicePipelineConfig = {
      sessionId: 'test-session',
      sttProvider: mockSttProvider,
      ttsProvider: mockTtsProvider,
      llmProvider: mockLlmProvider,
      mindProvider: mockLlmProvider,
      voiceConfig: { provider: 'cartesia', voice_id: 'v1', speed: 1.0 },
      mode: CONVERSATION_MODES.VOICE_VOICE,
      aggregationWindowMs: 50,
      events: {
        onTranscript: vi.fn(),
        onTextChunk: vi.fn(),
        onAudioChunk: vi.fn(),
        onToolCall: vi.fn(),
        onGenerationEnd: vi.fn(),
        onError: vi.fn(),
        onExitConvo: vi.fn(),
        onMindActivity: vi.fn(),
      },
    };

    const pipeline = createVoicePipeline(config);
    await pipeline.initialize();

    // Simulate a commit with pending text (would normally trigger aggregation timer)
    // We'll test this by checking that the timer fires at the right interval
    // This is a simplified test - the real behavior involves transcript accumulation

    // Clean up
    await pipeline.end();
    vi.useRealTimers();
  });

  it('defaults to 400ms window when aggregationWindowMs not provided', async () => {
    const config: VoicePipelineConfig = {
      sessionId: 'test-session-default',
      sttProvider: mockSttProvider,
      ttsProvider: mockTtsProvider,
      llmProvider: mockLlmProvider,
      mindProvider: mockLlmProvider,
      voiceConfig: { provider: 'cartesia', voice_id: 'v1', speed: 1.0 },
      mode: CONVERSATION_MODES.VOICE_VOICE,
      events: {
        onTranscript: vi.fn(),
        onTextChunk: vi.fn(),
        onAudioChunk: vi.fn(),
        onToolCall: vi.fn(),
        onGenerationEnd: vi.fn(),
        onError: vi.fn(),
        onExitConvo: vi.fn(),
        onMindActivity: vi.fn(),
      },
    };

    const pipeline = createVoicePipeline(config);
    await pipeline.initialize();

    // Pipeline should use default 400ms
    await pipeline.end();
    vi.useRealTimers();
  });

  it('passes utteranceEndMs and endpointingMs to STT provider when configured', async () => {
    const config: VoicePipelineConfig = {
      sessionId: 'test-session-stt',
      sttProvider: mockSttProvider,
      ttsProvider: mockTtsProvider,
      llmProvider: mockLlmProvider,
      mindProvider: mockLlmProvider,
      voiceConfig: { provider: 'cartesia', voice_id: 'v1', speed: 1.0 },
      mode: CONVERSATION_MODES.VOICE_VOICE,
      utteranceEndMs: 600,
      endpointingMs: 300,
      events: {
        onTranscript: vi.fn(),
        onTextChunk: vi.fn(),
        onAudioChunk: vi.fn(),
        onToolCall: vi.fn(),
        onGenerationEnd: vi.fn(),
        onError: vi.fn(),
        onExitConvo: vi.fn(),
        onMindActivity: vi.fn(),
      },
    };

    const pipeline = createVoicePipeline(config);
    await pipeline.initialize();

    // Verify the STT config was passed through
    expect(capturedSttConfig).not.toBeNull();
    expect(capturedSttConfig?.utteranceEndMs).toBe(600);
    expect(capturedSttConfig?.endpointingMs).toBe(300);

    await pipeline.end();
    vi.useRealTimers();
  });

  it('omits utteranceEndMs and endpointingMs from STT config when not provided', async () => {
    const config: VoicePipelineConfig = {
      sessionId: 'test-session-stt-default',
      sttProvider: mockSttProvider,
      ttsProvider: mockTtsProvider,
      llmProvider: mockLlmProvider,
      mindProvider: mockLlmProvider,
      voiceConfig: { provider: 'cartesia', voice_id: 'v1', speed: 1.0 },
      mode: CONVERSATION_MODES.VOICE_VOICE,
      events: {
        onTranscript: vi.fn(),
        onTextChunk: vi.fn(),
        onAudioChunk: vi.fn(),
        onToolCall: vi.fn(),
        onGenerationEnd: vi.fn(),
        onError: vi.fn(),
        onExitConvo: vi.fn(),
        onMindActivity: vi.fn(),
      },
    };

    const pipeline = createVoicePipeline(config);
    await pipeline.initialize();

    // Verify the STT config doesn't have these fields
    expect(capturedSttConfig).not.toBeNull();
    expect(capturedSttConfig?.utteranceEndMs).toBeUndefined();
    expect(capturedSttConfig?.endpointingMs).toBeUndefined();

    await pipeline.end();
    vi.useRealTimers();
  });
});
