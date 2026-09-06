/**
 * The session log is the durable record of what a character actually did. Its
 * value depends on three properties, so each is pinned here: it appends rather
 * than replaces, it never throws into the caller, and it is on unless
 * deliberately switched off.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  appendSessionLog,
  readSessionLog,
  listLoggedSessions,
  sessionLogPath,
  type SessionLogContext,
} from '../../src/telemetry/session-log.js';

const CONTEXT: SessionLogContext = {
  sessionId: 'sess_testsession',
  projectId: 'proj_test',
  npcId: 'npc_test',
  playerId: 'player_test',
  channel: 'harness',
};

let dir: string;
const savedDir = process.env.SESSION_LOG_DIR;
const savedEnabled = process.env.SESSION_LOG_ENABLED;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-log-'));
  process.env.SESSION_LOG_DIR = dir;
  delete process.env.SESSION_LOG_ENABLED;
});

afterEach(async () => {
  if (savedDir === undefined) delete process.env.SESSION_LOG_DIR;
  else process.env.SESSION_LOG_DIR = savedDir;
  if (savedEnabled === undefined) delete process.env.SESSION_LOG_ENABLED;
  else process.env.SESSION_LOG_ENABLED = savedEnabled;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('session log', () => {
  it('is enabled without any configuration', async () => {
    await appendSessionLog(CONTEXT, 'turn', { reply: 'hello' });
    expect(await readSessionLog(CONTEXT.sessionId)).toHaveLength(1);
  });

  it('appends rather than replacing, so earlier history survives', async () => {
    await appendSessionLog(CONTEXT, 'session_started', { n: 0 });
    await appendSessionLog(CONTEXT, 'turn', { n: 1 });
    await appendSessionLog(CONTEXT, 'turn', { n: 2 });
    await appendSessionLog(CONTEXT, 'session_ended', { n: 3 });

    const records = await readSessionLog(CONTEXT.sessionId);

    expect(records.map((r) => r.type)).toEqual([
      'session_started',
      'turn',
      'turn',
      'session_ended',
    ]);
    expect(records.map((r) => r.data.n)).toEqual([0, 1, 2, 3]);
  });

  it('records who and where, not just what', async () => {
    await appendSessionLog(CONTEXT, 'turn', { reply: 'hi' });
    const [record] = await readSessionLog(CONTEXT.sessionId);

    expect(record.sessionId).toBe(CONTEXT.sessionId);
    expect(record.projectId).toBe(CONTEXT.projectId);
    expect(record.npcId).toBe(CONTEXT.npcId);
    expect(record.playerId).toBe(CONTEXT.playerId);
    expect(record.channel).toBe('harness');
    expect(Date.parse(record.at)).not.toBeNaN();
  });

  it('keeps each session in its own file', async () => {
    await appendSessionLog(CONTEXT, 'turn', { n: 1 });
    await appendSessionLog({ ...CONTEXT, sessionId: 'sess_other' }, 'turn', { n: 2 });

    expect(await readSessionLog(CONTEXT.sessionId)).toHaveLength(1);
    expect(await readSessionLog('sess_other')).toHaveLength(1);
    expect((await listLoggedSessions()).sort()).toEqual(['sess_other', 'sess_testsession']);
  });

  it('can be switched off deliberately', async () => {
    process.env.SESSION_LOG_ENABLED = 'false';
    await appendSessionLog(CONTEXT, 'turn', { reply: 'hello' });
    expect(await readSessionLog(CONTEXT.sessionId)).toEqual([]);
  });

  it('never throws into the caller when the destination is unusable', async () => {
    // A path that cannot be created. Logging must not be able to break a
    // conversation, which is why every failure is swallowed.
    process.env.SESSION_LOG_DIR = path.join(dir, 'a-file');
    await fs.writeFile(path.join(dir, 'a-file'), 'not a directory', 'utf-8');

    await expect(appendSessionLog(CONTEXT, 'turn', { reply: 'hi' })).resolves.toBeUndefined();
  });

  it('survives a malformed line rather than losing the whole history', async () => {
    await appendSessionLog(CONTEXT, 'turn', { n: 1 });
    await fs.appendFile(sessionLogPath(CONTEXT.sessionId), '{ this is not json\n', 'utf-8');
    await appendSessionLog(CONTEXT, 'turn', { n: 2 });

    const records = await readSessionLog(CONTEXT.sessionId);
    expect(records.map((r) => r.data.n)).toEqual([1, 2]);
  });

  it('returns nothing for a session that was never logged', async () => {
    expect(await readSessionLog('sess_missing')).toEqual([]);
  });

  it('refuses to let a crafted session id escape the log directory', async () => {
    const escaped = sessionLogPath('../../etc/passwd');
    expect(path.dirname(escaped)).toBe(dir);
  });
});
