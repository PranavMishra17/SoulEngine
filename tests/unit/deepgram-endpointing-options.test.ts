/**
 * The endpointing budget is a project setting. These tests prove that the
 * values a caller puts on STTSessionConfig are the values the Deepgram live
 * connection is opened with, and that omitting them yields the historical
 * defaults (utterance_end_ms 1000, endpointing 500).
 *
 * The Deepgram SDK is mocked at the module boundary so no network is touched;
 * the fake connection fires Open on the next tick so connect() resolves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const liveMock = vi.fn();

vi.mock('@deepgram/sdk', async () => {
  const actual = await vi.importActual<typeof import('@deepgram/sdk')>('@deepgram/sdk');
  return {
    ...actual,
    createClient: vi.fn(() => ({ listen: { live: liveMock } })),
  };
});

import { LiveTranscriptionEvents } from '@deepgram/sdk';
import { DeepgramSttProvider } from '../../src/providers/stt/deepgram.js';
import type { STTSessionConfig, STTSessionEvents } from '../../src/providers/stt/interface.js';

function fakeConnection() {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const conn = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    send: vi.fn(),
    keepAlive: vi.fn(),
    requestClose: vi.fn(),
  };
  // connect() registers its Open handlers synchronously after live() returns,
  // so firing on the next macrotask reaches all of them.
  setTimeout(() => {
    for (const h of handlers.get(LiveTranscriptionEvents.Open) ?? []) h();
  }, 0);
  return conn;
}

const events: STTSessionEvents = {
  onTranscript: () => {},
  onError: () => {},
  onClose: () => {},
  onOpen: () => {},
};

async function openSession(sessionConfig: STTSessionConfig) {
  liveMock.mockImplementation(() => fakeConnection());
  const provider = new DeepgramSttProvider({ apiKey: 'test-key' });
  const session = await provider.createSession(sessionConfig, events);
  session.close();
  expect(liveMock).toHaveBeenCalledTimes(1);
  return liveMock.mock.calls[0][0] as Record<string, unknown>;
}

describe('Deepgram endpointing options', () => {
  beforeEach(() => {
    liveMock.mockReset();
  });

  it('opens the live connection with the configured utterance_end_ms and endpointing', async () => {
    const options = await openSession({ utteranceEndMs: 600, endpointingMs: 300 });
    expect(options).toEqual(expect.objectContaining({ utterance_end_ms: 600, endpointing: 300 }));
  });

  it('falls back to 1000 / 500 when the session config carries no endpointing values', async () => {
    const options = await openSession({});
    expect(options).toEqual(expect.objectContaining({ utterance_end_ms: 1000, endpointing: 500 }));
  });

  it('applies each value independently', async () => {
    const options = await openSession({ endpointingMs: 250 });
    expect(options).toEqual(expect.objectContaining({ utterance_end_ms: 1000, endpointing: 250 }));
  });
});
