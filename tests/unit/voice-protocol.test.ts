import { describe, it, expect } from 'vitest';
import { buildReadyMessage } from '../../src/ws/handler.js';
import { CONVERSATION_MODES } from '../../src/types/voice.js';

/**
 * Voice protocol versioning and authoritative audio format.
 *
 * The `ready` handshake message must carry:
 *   - protocol_version: a non-empty string clients can use for compatibility checks
 *   - audio_format.input:  { sampleRate, encoding, channels } -- what the server expects FROM the client
 *   - audio_format.output: { sampleRate, encoding, channels } -- what the server sends TO the client
 *
 * These fields must be present regardless of which TTS/STT provider is active,
 * eliminating the need for clients to hardcode per-provider values.
 */
describe('Voice WebSocket protocol: ready message', () => {
  it('includes a non-empty protocol_version string', () => {
    const msg = buildReadyMessage({
      sessionId: 'sess_test_001',
      npcName: 'Aria',
      voiceConfig: { provider: 'cartesia', voice_id: 'v1', speed: 1.0 },
      mode: CONVERSATION_MODES.VOICE_VOICE,
      ttsProvider: 'cartesia',
    });

    expect(msg.protocol_version).toBeDefined();
    expect(typeof msg.protocol_version).toBe('string');
    expect(msg.protocol_version.length).toBeGreaterThan(0);
  });

  it('includes audio_format with input and output sub-objects', () => {
    const msg = buildReadyMessage({
      sessionId: 'sess_test_001',
      npcName: 'Aria',
      voiceConfig: { provider: 'cartesia', voice_id: 'v1', speed: 1.0 },
      mode: CONVERSATION_MODES.VOICE_VOICE,
      ttsProvider: 'cartesia',
    });

    expect(msg.audio_format).toBeDefined();
    expect(msg.audio_format.input).toBeDefined();
    expect(msg.audio_format.output).toBeDefined();
  });

  it('audio_format.input has sampleRate, encoding, channels', () => {
    const msg = buildReadyMessage({
      sessionId: 'sess_test_001',
      npcName: 'Aria',
      voiceConfig: { provider: 'cartesia', voice_id: 'v1', speed: 1.0 },
      mode: CONVERSATION_MODES.VOICE_VOICE,
      ttsProvider: 'cartesia',
    });

    expect(typeof msg.audio_format.input.sampleRate).toBe('number');
    expect(msg.audio_format.input.sampleRate).toBeGreaterThan(0);
    expect(typeof msg.audio_format.input.encoding).toBe('string');
    expect(msg.audio_format.input.encoding.length).toBeGreaterThan(0);
    expect(typeof msg.audio_format.input.channels).toBe('number');
    expect(msg.audio_format.input.channels).toBeGreaterThan(0);
  });

  it('audio_format.output has sampleRate, encoding, channels', () => {
    const msg = buildReadyMessage({
      sessionId: 'sess_test_001',
      npcName: 'Aria',
      voiceConfig: { provider: 'cartesia', voice_id: 'v1', speed: 1.0 },
      mode: CONVERSATION_MODES.VOICE_VOICE,
      ttsProvider: 'cartesia',
    });

    expect(typeof msg.audio_format.output.sampleRate).toBe('number');
    expect(msg.audio_format.output.sampleRate).toBeGreaterThan(0);
    expect(typeof msg.audio_format.output.encoding).toBe('string');
    expect(msg.audio_format.output.encoding.length).toBeGreaterThan(0);
    expect(typeof msg.audio_format.output.channels).toBe('number');
    expect(msg.audio_format.output.channels).toBeGreaterThan(0);
  });

  it('output sampleRate differs by provider (cartesia=44100, elevenlabs=16000)', () => {
    const cartesiaMsg = buildReadyMessage({
      sessionId: 'sess_test_002',
      npcName: 'Aria',
      voiceConfig: { provider: 'cartesia', voice_id: 'v1', speed: 1.0 },
      mode: CONVERSATION_MODES.VOICE_VOICE,
      ttsProvider: 'cartesia',
    });

    const elevenMsg = buildReadyMessage({
      sessionId: 'sess_test_003',
      npcName: 'Aria',
      voiceConfig: { provider: 'elevenlabs', voice_id: 'v2', speed: 1.0 },
      mode: CONVERSATION_MODES.VOICE_VOICE,
      ttsProvider: 'elevenlabs',
    });

    expect(cartesiaMsg.audio_format.output.sampleRate).toBe(44100);
    expect(elevenMsg.audio_format.output.sampleRate).toBe(16000);
  });

  it('input sampleRate is always the STT (Deepgram) rate of 16000', () => {
    const msg = buildReadyMessage({
      sessionId: 'sess_test_004',
      npcName: 'Aria',
      voiceConfig: { provider: 'cartesia', voice_id: 'v1', speed: 1.0 },
      mode: CONVERSATION_MODES.VOICE_VOICE,
      ttsProvider: 'cartesia',
    });

    expect(msg.audio_format.input.sampleRate).toBe(16000);
  });

  it('ready message still carries session_id, npc_name, voice_config, mode (backward compat)', () => {
    const msg = buildReadyMessage({
      sessionId: 'sess_backward',
      npcName: 'Bob',
      voiceConfig: { provider: 'cartesia', voice_id: 'vc1', speed: 0.9 },
      mode: CONVERSATION_MODES.TEXT_TEXT,
      ttsProvider: 'cartesia',
    });

    expect(msg.type).toBe('ready');
    expect(msg.session_id).toBe('sess_backward');
    expect(msg.npc_name).toBe('Bob');
    expect(msg.voice_config).toEqual({ provider: 'cartesia', voice_id: 'vc1', speed: 0.9 });
    expect(msg.mode).toEqual(CONVERSATION_MODES.TEXT_TEXT);
  });
});
