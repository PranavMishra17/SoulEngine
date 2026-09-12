import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import type { LLMProvider, LLMChatRequest, LLMStreamChunk, LLMMessage } from './interface.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('cassette');

export interface CassetteRequest {
  systemPromptPrefix: string;
  systemPrompt: string;
  messages: LLMMessage[];
  toolNames: string[];
}

export interface CassetteEntry {
  key: string;
  request: CassetteRequest;
  chunks: LLMStreamChunk[];
}

export interface Cassette {
  version: 1;
  entries: CassetteEntry[];
}

export class CassetteMissError extends Error {
  constructor(
    public readonly requestedKey: string,
    public readonly nearestEntry: CassetteEntry | null
  ) {
    super(
      nearestEntry
        ? `Cassette miss: requested key ${requestedKey.slice(0, 8)}..., nearest entry is ${nearestEntry.key.slice(0, 8)}... (${nearestEntry.request.messages.length} messages, tools: ${nearestEntry.request.toolNames.join(', ') || 'none'})`
        : `Cassette miss: requested key ${requestedKey.slice(0, 8)}..., cassette is empty`
    );
    this.name = 'CassetteMissError';
  }
}

function computeKey(request: CassetteRequest): string {
  const canonical = JSON.stringify({
    systemPromptPrefix: request.systemPromptPrefix,
    systemPrompt: request.systemPrompt,
    messages: request.messages,
    toolNames: request.toolNames,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function requestToCassetteRequest(request: LLMChatRequest): CassetteRequest {
  return {
    systemPromptPrefix: request.systemPromptPrefix ?? '',
    systemPrompt: request.systemPrompt,
    messages: request.messages,
    toolNames: (request.tools ?? []).map((t) => t.name).sort(),
  };
}

export class RecordingLLMProvider implements LLMProvider {
  constructor(
    private inner: LLMProvider,
    private cassette: Cassette
  ) {}

  get name(): string {
    return `recording(${this.inner.name})`;
  }

  async *streamChat(request: LLMChatRequest): AsyncIterable<LLMStreamChunk> {
    const cassetteRequest = requestToCassetteRequest(request);
    const key = computeKey(cassetteRequest);
    const chunks: LLMStreamChunk[] = [];

    logger.debug({ key: key.slice(0, 8), messageCount: request.messages.length }, 'Recording cassette entry');

    try {
      for await (const chunk of this.inner.streamChat(request)) {
        chunks.push(chunk);
        yield chunk;
      }

      this.cassette.entries.push({ key, request: cassetteRequest, chunks });
      logger.debug({ key: key.slice(0, 8), chunkCount: chunks.length }, 'Cassette entry recorded');
    } catch (error) {
      logger.error(
        { key: key.slice(0, 8), error: error instanceof Error ? error.message : 'Unknown' },
        'Recording failed'
      );
      throw error;
    }
  }
}

export class PlaybackLLMProvider implements LLMProvider {
  constructor(private cassette: Cassette) {}

  get name(): string {
    return 'playback';
  }

  async *streamChat(request: LLMChatRequest): AsyncIterable<LLMStreamChunk> {
    const cassetteRequest = requestToCassetteRequest(request);
    const key = computeKey(cassetteRequest);

    const entry = this.cassette.entries.find((e) => e.key === key);
    if (!entry) {
      const nearest = this.cassette.entries[0] ?? null;
      logger.error(
        {
          requestedKey: key.slice(0, 8),
          nearestKey: nearest?.key.slice(0, 8),
          messageCount: request.messages.length,
          toolNames: cassetteRequest.toolNames,
        },
        'Cassette miss'
      );
      throw new CassetteMissError(key, nearest);
    }

    logger.debug({ key: key.slice(0, 8), chunkCount: entry.chunks.length }, 'Replaying cassette entry');

    for (const chunk of entry.chunks) {
      yield chunk;
    }
  }
}

export async function writeCassette(cassette: Cassette, path: string): Promise<void> {
  try {
    await fs.writeFile(path, JSON.stringify(cassette, null, 2), 'utf-8');
    logger.info({ path, entryCount: cassette.entries.length }, 'Cassette written');
  } catch (error) {
    logger.error(
      { path, error: error instanceof Error ? error.message : 'Unknown' },
      'Failed to write cassette'
    );
    throw error;
  }
}

export async function readCassette(path: string): Promise<Cassette> {
  try {
    const content = await fs.readFile(path, 'utf-8');
    const cassette = JSON.parse(content) as Cassette;
    logger.info({ path, entryCount: cassette.entries.length, version: cassette.version }, 'Cassette loaded');
    return cassette;
  } catch (error) {
    logger.error(
      { path, error: error instanceof Error ? error.message : 'Unknown' },
      'Failed to read cassette'
    );
    throw error;
  }
}
