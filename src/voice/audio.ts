import { createLogger } from '../logger.js';

const logger = createLogger('voice-audio');

/**
 * Standard audio configuration for the voice pipeline.
 *
 * Input (client -> STT): 16kHz, mono, 16-bit PCM (linear16)
 * Output (TTS -> client): Varies by provider, typically 44.1kHz for Cartesia
 */
export const AUDIO_CONFIG = {
  /** STT input sample rate in Hz */
  sttSampleRate: 16000,
  /** Default TTS output sample rate in Hz (Cartesia default) */
  ttsSampleRate: 44100,
  /** Audio chunk duration in ms for streaming */
  chunkDurationMs: 20,
  /** Number of audio channels (mono) */
  channels: 1,
  /** Bits per sample for PCM */
  bitsPerSample: 16,
} as const;

/**
 * Decode base64-encoded audio from WebSocket message to Buffer.
 *
 * @param base64Data - Base64-encoded audio string
 * @returns Decoded audio buffer
 * @throws Error if base64 decoding fails
 */
export function decodeClientAudio(base64Data: string): Buffer {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    logger.debug({ inputLength: base64Data.length, outputBytes: buffer.length }, 'Client audio decoded');
    return buffer;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: message }, 'Failed to decode client audio');
    throw new Error(`Failed to decode base64 audio: ${message}`);
  }
}

/**
 * Encode TTS audio buffer to base64 for WebSocket transmission.
 *
 * @param buffer - Raw audio buffer
 * @returns Base64-encoded string
 */
export function encodeTtsAudio(buffer: Buffer): string {
  const base64 = buffer.toString('base64');
  logger.debug({ inputBytes: buffer.length, outputLength: base64.length }, 'TTS audio encoded');
  return base64;
}

/**
 * Validate that an audio buffer has reasonable properties.
 *
 * @param buffer - Audio buffer to validate
 * @param expectedSampleRate - Expected sample rate
 * @returns Validation result with any warnings
 */
export function validateAudioBuffer(
  buffer: Buffer,
  expectedSampleRate: number = AUDIO_CONFIG.sttSampleRate
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check for empty buffer
  if (buffer.length === 0) {
    return { valid: false, warnings: ['Empty audio buffer'] };
  }

  // Check for minimum audio duration (at least one sample)
  const bytesPerSample = AUDIO_CONFIG.bitsPerSample / 8;
  const minBytes = bytesPerSample * AUDIO_CONFIG.channels;
  if (buffer.length < minBytes) {
    return { valid: false, warnings: [`Buffer too small: ${buffer.length} bytes`] };
  }

  // Check for reasonable chunk size (warn if too large for streaming)
  const maxChunkDuration = 1000; // 1 second max per chunk
  const maxBytes = (expectedSampleRate * maxChunkDuration * bytesPerSample * AUDIO_CONFIG.channels) / 1000;
  if (buffer.length > maxBytes) {
    warnings.push(`Large audio chunk: ${buffer.length} bytes (>${maxBytes} expected for ${maxChunkDuration}ms)`);
  }

  // Check if buffer length is aligned to sample size
  if (buffer.length % bytesPerSample !== 0) {
    warnings.push(`Buffer length ${buffer.length} not aligned to sample size ${bytesPerSample}`);
  }

  return { valid: true, warnings };
}

/**
 * Calculate audio duration in milliseconds.
 *
 * @param bufferLength - Length of audio buffer in bytes
 * @param sampleRate - Sample rate in Hz
 * @returns Duration in milliseconds
 */
export function calculateAudioDuration(
  bufferLength: number,
  sampleRate: number = AUDIO_CONFIG.sttSampleRate
): number {
  const bytesPerSample = AUDIO_CONFIG.bitsPerSample / 8;
  const samples = bufferLength / (bytesPerSample * AUDIO_CONFIG.channels);
  return (samples / sampleRate) * 1000;
}

/**
 * Split a large audio buffer into smaller chunks for streaming.
 *
 * @param buffer - Full audio buffer
 * @param chunkDurationMs - Target chunk duration in milliseconds
 * @param sampleRate - Sample rate in Hz
 * @returns Array of audio chunks
 */
export function splitAudioIntoChunks(
  buffer: Buffer,
  chunkDurationMs: number = AUDIO_CONFIG.chunkDurationMs,
  sampleRate: number = AUDIO_CONFIG.ttsSampleRate
): Buffer[] {
  const bytesPerSample = AUDIO_CONFIG.bitsPerSample / 8;
  const bytesPerChunk = Math.floor(
    (sampleRate * chunkDurationMs * bytesPerSample * AUDIO_CONFIG.channels) / 1000
  );

  // Ensure chunk size is aligned to sample boundary
  const alignedBytesPerChunk = Math.floor(bytesPerChunk / bytesPerSample) * bytesPerSample;

  if (alignedBytesPerChunk === 0 || buffer.length <= alignedBytesPerChunk) {
    return [buffer];
  }

  const chunks: Buffer[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const end = Math.min(offset + alignedBytesPerChunk, buffer.length);
    chunks.push(buffer.subarray(offset, end));
    offset = end;
  }

  logger.debug(
    { totalBytes: buffer.length, chunkCount: chunks.length, bytesPerChunk: alignedBytesPerChunk },
    'Audio split into chunks'
  );

  return chunks;
}

/**
 * Concatenate multiple audio buffers into one.
 *
 * @param buffers - Array of audio buffers
 * @returns Combined buffer
 */
export function concatenateAudioBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) {
    return Buffer.alloc(0);
  }
  if (buffers.length === 1) {
    return buffers[0];
  }
  return Buffer.concat(buffers);
}

/**
 * Trim leading and trailing silence from PCM audio.
 * Silence is defined as samples below the threshold.
 *
 * @param buffer - PCM audio buffer (16-bit signed integers)
 * @param silenceThreshold - Amplitude threshold (0-1, relative to max)
 * @returns Trimmed buffer
 */
export function trimSilence(
  buffer: Buffer,
  silenceThreshold: number = 0.01
): Buffer {
  const bytesPerSample = AUDIO_CONFIG.bitsPerSample / 8;
  const sampleCount = Math.floor(buffer.length / bytesPerSample);

  if (sampleCount === 0) {
    return buffer;
  }

  // Convert threshold to absolute value (16-bit max is 32767)
  const maxAmplitude = 32767;
  const threshold = Math.floor(silenceThreshold * maxAmplitude);

  // Find first non-silent sample
  let start = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = buffer.readInt16LE(i * bytesPerSample);
    if (Math.abs(sample) > threshold) {
      start = i;
      break;
    }
  }

  // Find last non-silent sample
  let end = sampleCount - 1;
  for (let i = sampleCount - 1; i >= start; i--) {
    const sample = buffer.readInt16LE(i * bytesPerSample);
    if (Math.abs(sample) > threshold) {
      end = i;
      break;
    }
  }

  // Return trimmed buffer
  const startByte = start * bytesPerSample;
  const endByte = (end + 1) * bytesPerSample;

  logger.debug(
    {
      originalSamples: sampleCount,
      trimmedSamples: end - start + 1,
      startTrimmed: start,
      endTrimmed: sampleCount - end - 1
    },
    'Audio silence trimmed'
  );

  return buffer.subarray(startByte, endByte);
}

/**
 * Simple linear interpolation resampler.
 * Use only when necessary as this is a basic implementation.
 *
 * @param buffer - Input PCM audio buffer (16-bit)
 * @param fromRate - Source sample rate
 * @param toRate - Target sample rate
 * @returns Resampled buffer
 */
export function resampleLinear(
  buffer: Buffer,
  fromRate: number,
  toRate: number
): Buffer {
  if (fromRate === toRate) {
    return buffer;
  }

  const bytesPerSample = AUDIO_CONFIG.bitsPerSample / 8;
  const inputSamples = Math.floor(buffer.length / bytesPerSample);
  const ratio = toRate / fromRate;
  const outputSamples = Math.floor(inputSamples * ratio);
  const outputBuffer = Buffer.alloc(outputSamples * bytesPerSample);

  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = i / ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples - 1);
    const fraction = srcIndex - srcIndexFloor;

    const sample1 = buffer.readInt16LE(srcIndexFloor * bytesPerSample);
    const sample2 = buffer.readInt16LE(srcIndexCeil * bytesPerSample);
    const interpolated = Math.round(sample1 + (sample2 - sample1) * fraction);

    // Clamp to 16-bit range
    const clamped = Math.max(-32768, Math.min(32767, interpolated));
    outputBuffer.writeInt16LE(clamped, i * bytesPerSample);
  }

  logger.debug(
    { fromRate, toRate, inputSamples, outputSamples },
    'Audio resampled'
  );

  return outputBuffer;
}

/**
 * Convert Float32 PCM to Int16 PCM.
 * Used when TTS provider returns float audio.
 *
 * @param float32Buffer - Float32 PCM buffer
 * @returns Int16 PCM buffer
 */
export function float32ToInt16(float32Buffer: Buffer): Buffer {
  const float32Array = new Float32Array(
    float32Buffer.buffer,
    float32Buffer.byteOffset,
    float32Buffer.length / 4
  );

  const int16Buffer = Buffer.alloc(float32Array.length * 2);

  for (let i = 0; i < float32Array.length; i++) {
    // Clamp float to [-1, 1] range and scale to Int16
    const clamped = Math.max(-1, Math.min(1, float32Array[i]));
    const int16Value = Math.round(clamped * 32767);
    int16Buffer.writeInt16LE(int16Value, i * 2);
  }

  return int16Buffer;
}

/**
 * Convert Int16 PCM to Float32 PCM.
 *
 * @param int16Buffer - Int16 PCM buffer
 * @returns Float32 PCM buffer
 */
export function int16ToFloat32(int16Buffer: Buffer): Buffer {
  const sampleCount = int16Buffer.length / 2;
  const float32Buffer = Buffer.alloc(sampleCount * 4);

  for (let i = 0; i < sampleCount; i++) {
    const int16Value = int16Buffer.readInt16LE(i * 2);
    const floatValue = int16Value / 32768;
    float32Buffer.writeFloatLE(floatValue, i * 4);
  }

  return float32Buffer;
}
