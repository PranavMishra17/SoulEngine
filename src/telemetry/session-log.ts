/**
 * Append-only session log.
 *
 * Every conversation, from every entry point, writes a durable record of what
 * happened: when a session began, what was said each turn, what the mind was
 * offered and chose, what it retrieved, what a cycle changed, and how the
 * session ended.
 *
 * Why append-only, and why by default:
 *
 *  - The behaviour this system is judged on — remembering, evolving, acting —
 *    unfolds across sessions and days. Anything that only exists in memory, or
 *    that a later write can overwrite, cannot answer "what actually happened
 *    three sessions ago".
 *  - Records are never mutated or deleted in place. A correction is a new
 *    record, so the history stays reconstructable and a bug in one writer
 *    cannot erase earlier evidence.
 *  - It is on unless explicitly disabled, because telemetry you have to
 *    remember to switch on is telemetry you do not have when you need it.
 *
 * Failure is always swallowed. Logging must never be the reason a conversation
 * breaks — the same rule the token accounting already follows.
 *
 * Records contain conversation content, which is the point of them. They must
 * never contain credentials; writers pass identifiers and text, never keys.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '../logger.js';
import { getConfig } from '../config.js';

const logger = createLogger('session-log');

export type SessionLogEventType =
  | 'session_started'
  | 'turn'
  | 'cycle'
  | 'session_ended';

export interface SessionLogRecord {
  /** ISO timestamp, written here so a reader never depends on file order alone. */
  at: string;
  type: SessionLogEventType;
  sessionId: string;
  projectId: string;
  npcId: string;
  playerId: string;
  /**
   * How the turn arrived: the HTTP route, the voice pipeline, the text
   * harness, or a scripted eval run. A reader must be able to tell a replayed
   * fixture from something a person actually said.
   */
  channel: 'http' | 'voice' | 'harness' | 'eval' | 'unknown';
  /** Event-specific payload. Shapes are additive; readers must tolerate new keys. */
  data: Record<string, unknown>;
}

export interface SessionLogContext {
  sessionId: string;
  projectId: string;
  npcId: string;
  playerId: string;
  channel: SessionLogRecord['channel'];
}

function isEnabled(): boolean {
  // Opt-out rather than opt-in.
  return process.env.SESSION_LOG_ENABLED !== 'false';
}

export function sessionLogDir(): string {
  return process.env.SESSION_LOG_DIR || path.join(getConfig().dataDir, 'session-logs');
}

/**
 * One file per session. That is the unit a reader actually wants, and it keeps
 * concurrent sessions from interleaving into one another's history.
 */
export function sessionLogPath(sessionId: string): string {
  // Session ids are generated hex; reject anything else rather than letting a
  // crafted id escape the directory.
  const safe = /^[A-Za-z0-9_-]+$/.test(sessionId) ? sessionId : 'invalid-session-id';
  return path.join(sessionLogDir(), `${safe}.jsonl`);
}

/**
 * Append one record. Never throws.
 *
 * `fs.appendFile` with the default flag opens with O_APPEND, so concurrent
 * writers do not truncate each other and a record is never written over an
 * earlier one.
 */
export async function appendSessionLog(
  context: SessionLogContext,
  type: SessionLogEventType,
  data: Record<string, unknown>
): Promise<void> {
  if (!isEnabled()) return;

  try {
    const record: SessionLogRecord = {
      at: new Date().toISOString(),
      type,
      sessionId: context.sessionId,
      projectId: context.projectId,
      npcId: context.npcId,
      playerId: context.playerId,
      channel: context.channel,
      data,
    };

    const dir = sessionLogDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(sessionLogPath(context.sessionId), JSON.stringify(record) + '\n', 'utf-8');
  } catch (error) {
    logger.warn(
      {
        sessionId: context.sessionId,
        type,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'Could not append to the session log'
    );
  }
}

/** Read one session's records back, oldest first. Malformed lines are skipped. */
export async function readSessionLog(sessionId: string): Promise<SessionLogRecord[]> {
  try {
    const raw = await fs.readFile(sessionLogPath(sessionId), 'utf-8');
    const records: SessionLogRecord[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as SessionLogRecord);
      } catch {
        // A partially written final line must not lose the rest of the history.
      }
    }
    return records;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn(
        { sessionId, error: error instanceof Error ? error.message : 'Unknown error' },
        'Could not read the session log'
      );
    }
    return [];
  }
}

/** Session ids that have a log, newest file first. */
export async function listLoggedSessions(): Promise<string[]> {
  try {
    const dir = sessionLogDir();
    const entries = await fs.readdir(dir);
    const files = entries.filter((f) => f.endsWith('.jsonl'));

    const withTimes = await Promise.all(
      files.map(async (file) => {
        const stat = await fs.stat(path.join(dir, file)).catch(() => null);
        return { id: file.replace(/\.jsonl$/, ''), mtime: stat?.mtimeMs ?? 0 };
      })
    );

    return withTimes.sort((a, b) => b.mtime - a.mtime).map((e) => e.id);
  } catch {
    return [];
  }
}
