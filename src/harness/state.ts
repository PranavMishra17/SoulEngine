/**
 * Harness state and per-session telemetry.
 *
 * Each CLI invocation is a fresh process, so the link between one turn and the
 * next lives on disk. Sessions themselves are held in an in-memory Map by the
 * session layer and are only written to disk by endSession — which summarises,
 * writes a memory and drifts mood. Ending a session per turn would manufacture
 * exactly the memory behaviour this tool exists to observe, so the harness
 * persists session state directly instead and resumes it next time.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '../logger.js';
import { getConfig } from '../config.js';

const logger = createLogger('harness-state');

export interface HarnessSession {
  sessionId: string;
  projectId: string;
  npcId: string;
  playerId: string;
  /** User messages sent this session, counted against the turn cap. */
  turns: number;
}

export interface HarnessState {
  /** One open session per NPC; seeded worlds make multi-NPC the normal case. */
  sessions: Record<string, HarnessSession>;
  /** Projects this harness created, so `world` can mark them and `--clean` remove them. */
  seededProjects: string[];
}

const EMPTY: HarnessState = { sessions: {}, seededProjects: [] };

export function harnessDir(): string {
  return path.join(getConfig().dataDir, 'harness');
}

function statePath(): string {
  return path.join(harnessDir(), 'state.json');
}

export async function loadState(): Promise<HarnessState> {
  try {
    const raw = await fs.readFile(statePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HarnessState>;
    return {
      sessions: parsed.sessions ?? {},
      seededProjects: parsed.seededProjects ?? [],
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn({ error: error instanceof Error ? error.message : 'Unknown' }, 'Could not read harness state');
    }
    return { ...EMPTY, sessions: {}, seededProjects: [] };
  }
}

export async function saveState(state: HarnessState): Promise<void> {
  await fs.mkdir(harnessDir(), { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify(state, null, 2), 'utf-8');
}

/** One JSONL per session id — the natural unit for later cross-session analysis. */
export async function appendTelemetry(sessionId: string, record: unknown): Promise<void> {
  try {
    const dir = path.join(harnessDir(), 'telemetry');
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(path.join(dir, `${sessionId}.jsonl`), JSON.stringify(record) + '\n', 'utf-8');
  } catch (error) {
    // Telemetry must never break a turn.
    logger.warn({ sessionId, error: error instanceof Error ? error.message : 'Unknown' }, 'Telemetry append failed');
  }
}

export async function readTelemetry(sessionId: string): Promise<unknown[]> {
  try {
    const raw = await fs.readFile(path.join(harnessDir(), 'telemetry', `${sessionId}.jsonl`), 'utf-8');
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
  } catch {
    return [];
  }
}
