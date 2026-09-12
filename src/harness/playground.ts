import { promises as fs } from 'fs';
import { createLogger } from '../logger.js';
import { runConversationTurn, TurnError, type TurnResult } from '../conversation/turn.js';
import { startSession, endSession, getSession, getSessionContext } from '../session/manager.js';
import { mcpToolRegistry } from '../mcp/registry.js';
import { createMemory } from '../core/memory.js';
import { computeAffordances, type ToolAffordance } from './diagnostics.js';
import { findNpc, resolveProvider } from './lookup.js';
import { RecordingLLMProvider, PlaybackLLMProvider, readCassette, writeCassette, type Cassette } from '../providers/llm/cassette.js';
import { materialiseScenario, teardownProject, type ScratchWorld } from '../eval/scratch-project.js';
import { persistSession } from '../storage/local/sessions.js';
import { PlaygroundScenarioSchema, type PlaygroundScenario, type PlaygroundExpectation } from '../schema/eval.js';
import type { LLMProvider } from '../providers/llm/interface.js';
import type { MoodVector, RelationshipState } from '../types/npc.js';
import type { SecurityContext } from '../types/security.js';
import type { SessionState } from '../types/session.js';
import { CONVERSATION_MODES } from '../types/voice.js';

const logger = createLogger('playground');

export type InputCommand =
  | { type: 'say'; text: string }
  | { type: 'event'; text: string; salience?: number }
  | { type: 'inspect' }
  | { type: 'end' }
  | { type: 'error'; code: string; message: string };

export function parseInputLine(line: string): InputCommand {
  try {
    const parsed = JSON.parse(line);

    if ('say' in parsed && typeof parsed.say === 'string') {
      return { type: 'say', text: parsed.say };
    }

    if ('event' in parsed && typeof parsed.event === 'object') {
      const { text, salience } = parsed.event;
      if (typeof text !== 'string') {
        return { type: 'error', code: 'bad-input', message: 'event.text must be a string' };
      }
      return { type: 'event', text, salience };
    }

    if ('inspect' in parsed) {
      return { type: 'inspect' };
    }

    if ('state' in parsed) {
      return { type: 'error', code: 'unsupported', message: 'quest state arrives with backlog 7.9' };
    }

    if ('end' in parsed) {
      return { type: 'end' };
    }

    return { type: 'error', code: 'bad-input', message: 'unknown command or missing required field' };
  } catch (error) {
    return { type: 'error', code: 'bad-input', message: 'invalid JSON' };
  }
}

interface TurnSnapshot {
  mood: MoodVector;
  relationship: RelationshipState | null;
  stmCount: number;
  ltmCount: number;
}

export interface TurnRecord {
  type: 'turn';
  turn: number;
  sessionId: string;
  input: string;
  reply: string;
  followUp: string | null;
  tools: {
    offered: string[];
    called: Array<{ name: string; arguments: Record<string, unknown>; status: string }>;
    denied: string[];
  };
  timings: {
    mindMs: number | null;
    speakerMs: number;
    speakerTtftMs: number | null;
    followUpMs: number | null;
    followUpTtftMs: number | null;
    wallMs: number;
  };
  usage: {
    speaker?: { input_tokens: number; output_tokens: number; cached_input_tokens?: number };
    mind?: { input_tokens: number; output_tokens: number };
    followUp?: { input_tokens: number; output_tokens: number; cached_input_tokens?: number };
  };
  security: {
    moderationAction: string;
    sanitizationViolations: string[];
  };
  exit: {
    requested: boolean;
    forcedByModeration: boolean;
    reason: string | null;
  };
  deferred: {
    injected: string | null;
    forNextTurn: string | null;
  };
  delta: {
    mood: { before: MoodVector; after: MoodVector };
    relationship: { before: RelationshipState | null; after: RelationshipState | null };
    memories: { stm: [number, number]; ltm: [number, number] };
  };
}

export function buildTurnRecord(
  turnResult: TurnResult,
  before: TurnSnapshot,
  after: TurnSnapshot,
  turnNumber: number,
  sessionId: string,
  sanitizedInput: string,
  offeredTools: ToolAffordance[],
  deniedTools: ToolAffordance[]
): TurnRecord {
  // Tool results are keyed by call id; a call with no result was refused or failed.
  const resultIds = new Set(turnResult.toolResults.map((r) => r.tool_call_id));
  const primaryReply = turnResult.followUpText
    ? turnResult.responseText.slice(0, turnResult.responseText.length - turnResult.followUpText.length).trimEnd()
    : turnResult.responseText;

  return {
    type: 'turn',
    turn: turnNumber,
    sessionId,
    input: sanitizedInput,
    reply: primaryReply,
    followUp: turnResult.followUpText,
    tools: {
      offered: offeredTools.filter((t) => t.offered).map((t) => t.name),
      called: turnResult.toolCalls.map((tc) => ({
        name: tc.name,
        arguments: tc.arguments,
        status: tc.id && resultIds.has(tc.id) ? 'completed' : 'no-result',
      })),
      denied: deniedTools.map((t) => t.name),
    },
    timings: turnResult.timings,
    usage: turnResult.usage,
    security: {
      moderationAction: turnResult.moderationAction,
      sanitizationViolations: turnResult.sanitizationViolations,
    },
    // Two exit paths exist today: the Mind's exit_convo (carries a result) and a
    // moderation-forced exit (only flags the security context). Report both.
    exit: {
      requested: (turnResult.exitConvoResult?.triggered ?? false) || turnResult.securityContext.exitRequested,
      forcedByModeration:
        (turnResult.exitConvoResult?.forcedByModeration ?? false) ||
        (turnResult.securityContext.exitRequested && !turnResult.exitConvoResult),
      reason:
        turnResult.exitConvoResult?.reason ??
        (turnResult.securityContext.exitRequested ? 'moderation' : null),
    },
    deferred: {
      injected: turnResult.deferredContextInjected,
      forNextTurn: turnResult.deferredContextForNextTurn,
    },
    delta: {
      mood: { before: before.mood, after: after.mood },
      relationship: { before: before.relationship, after: after.relationship },
      memories: {
        stm: [before.stmCount, after.stmCount],
        ltm: [before.ltmCount, after.ltmCount],
      },
    },
  };
}

interface EvaluationResult {
  turn: number;
  check: string;
  passed: boolean;
  detail?: string;
}

export function evaluateExpectations(
  records: TurnRecord[],
  expectations: PlaygroundExpectation[]
): EvaluationResult[] {
  const results: EvaluationResult[] = [];

  for (const expect of expectations) {
    const record = records.find((r) => r.turn === expect.turn);
    if (!record) {
      results.push({
        turn: expect.turn,
        check: 'turn-missing',
        passed: false,
        detail: `turn ${expect.turn} not found in records`,
      });
      continue;
    }

    if (expect.toolsCalled) {
      const called = record.tools.called.map((c) => c.name);
      const allFound = expect.toolsCalled.every((t) => called.includes(t));
      results.push({
        turn: expect.turn,
        check: 'toolsCalled',
        passed: allFound,
        detail: allFound ? undefined : `expected ${expect.toolsCalled.join(', ')}, got ${called.join(', ')}`,
      });
    }

    if (expect.toolsNotCalled) {
      const called = record.tools.called.map((c) => c.name);
      const noneFound = expect.toolsNotCalled.every((t) => !called.includes(t));
      results.push({
        turn: expect.turn,
        check: 'toolsNotCalled',
        passed: noneFound,
        detail: noneFound ? undefined : `expected none of ${expect.toolsNotCalled.join(', ')}, but found some`,
      });
    }

    if (expect.recallFacts) {
      const reply = record.reply.toLowerCase();
      const allFound = expect.recallFacts.every((fact) => reply.includes(fact.toLowerCase()));
      results.push({
        turn: expect.turn,
        check: 'recallFacts',
        passed: allFound,
        detail: allFound ? undefined : `some facts not found in reply`,
      });
    }

    if (expect.replyMatches) {
      const regex = new RegExp(expect.replyMatches, 'i');
      const matches = regex.test(record.reply);
      results.push({
        turn: expect.turn,
        check: 'replyMatches',
        passed: matches,
        detail: matches ? undefined : `reply did not match pattern: ${expect.replyMatches}`,
      });
    }

    if (expect.exitRequested !== undefined) {
      const matches = record.exit.requested === expect.exitRequested;
      results.push({
        turn: expect.turn,
        check: 'exitRequested',
        passed: matches,
        detail: matches ? undefined : `expected ${expect.exitRequested}, got ${record.exit.requested}`,
      });
    }

    if (expect.moderationAction) {
      const matches = record.security.moderationAction === expect.moderationAction;
      results.push({
        turn: expect.turn,
        check: 'moderationAction',
        passed: matches,
        detail: matches ? undefined : `expected ${expect.moderationAction}, got ${record.security.moderationAction}`,
      });
    }
  }

  return results;
}

interface TrialResult {
  passed: boolean;
  records: TurnRecord[];
  evaluations: EvaluationResult[];
}

export interface SummaryRecord {
  type: 'summary';
  scenario: string;
  trials: number;
  passed: number;
  passK: number;
  perExpectation: Array<{ turn: number; check: string; passRate: number }>;
  latency: {
    wallMs: { p50: number; p95: number };
    speakerMs: { p50: number; p95: number };
    speakerTtftMs: { p50: number; p95: number };
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = ((sorted.length - 1) * p) / 100;
  const base = Math.floor(pos);
  const rest = pos - base;

  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  } else {
    return sorted[base];
  }
}

export function summarise(
  scenarioName: string,
  trialResults: TrialResult[],
  _expectations: PlaygroundExpectation[]
): SummaryRecord {
  const passed = trialResults.filter((t) => t.passed).length;
  const passK = trialResults.every((t) => t.passed) ? 1 : 0;

  const allEvaluations = trialResults.flatMap((t) => t.evaluations);
  const expectationMap = new Map<string, { total: number; passed: number }>();

  for (const result of allEvaluations) {
    const key = `${result.turn}-${result.check}`;
    const entry = expectationMap.get(key) ?? { total: 0, passed: 0 };
    entry.total += 1;
    if (result.passed) entry.passed += 1;
    expectationMap.set(key, entry);
  }

  const perExpectation = Array.from(expectationMap.entries()).map(([key, { total, passed }]) => {
    const [turn, check] = key.split('-');
    return { turn: parseInt(turn, 10), check, passRate: passed / total };
  });

  const allRecords = trialResults.flatMap((t) => t.records);
  const wallValues = allRecords.map((r) => r.timings.wallMs);
  const speakerValues = allRecords.map((r) => r.timings.speakerMs);
  const speakerTtftValues = allRecords.map((r) => r.timings.speakerTtftMs).filter((v): v is number => v !== null);

  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;

  for (const record of allRecords) {
    if (record.usage.speaker) {
      inputTokens += record.usage.speaker.input_tokens;
      outputTokens += record.usage.speaker.output_tokens;
      cachedInputTokens += record.usage.speaker.cached_input_tokens ?? 0;
    }
    if (record.usage.mind) {
      inputTokens += record.usage.mind.input_tokens;
      outputTokens += record.usage.mind.output_tokens;
    }
    if (record.usage.followUp) {
      inputTokens += record.usage.followUp.input_tokens;
      outputTokens += record.usage.followUp.output_tokens;
      cachedInputTokens += record.usage.followUp.cached_input_tokens ?? 0;
    }
  }

  return {
    type: 'summary',
    scenario: scenarioName,
    trials: trialResults.length,
    passed,
    passK,
    perExpectation,
    latency: {
      wallMs: { p50: percentile(wallValues, 50), p95: percentile(wallValues, 95) },
      speakerMs: { p50: percentile(speakerValues, 50), p95: percentile(speakerValues, 95) },
      speakerTtftMs: { p50: percentile(speakerTtftValues, 50), p95: percentile(speakerTtftValues, 95) },
    },
    usage: { inputTokens, outputTokens, cachedInputTokens },
  };
}


// ---------------------------------------------------------------------------
// Runtime: opening sessions, choosing providers, driving turns and scenarios.
// Everything above this line is pure and unit-tested without a session.
// ---------------------------------------------------------------------------

export interface PlayOptions {
  /** A parsed scenario. Takes precedence over scenarioPath. */
  scenario?: PlaygroundScenario;
  /** Path to a scenario JSON file. */
  scenarioPath?: string;
  /** Existing NPC to talk to when the scenario does not embed one. */
  npcId?: string;
  /** Player identity for the session; scenario.player.id wins when both are present. */
  playerId?: string;
  /** Use the scripted stub provider instead of a real one. */
  stub?: boolean;
  /** Number of trials for a scenario run; overrides the scenario's own value. */
  trials?: number;
  /** Record every provider call into this cassette file. */
  record?: string;
  /** Serve every provider call from this cassette file; needs no API key. */
  replay?: string;
  /** End (summarise) the session on exit instead of persisting it for resumption. */
  endSession?: boolean;
  /** Where to send human-facing notes (provider fallbacks and the like). Defaults to the logger. */
  note?: (message: string) => void;
}

export type OutputSink = (record: Record<string, unknown> | TurnRecord | SummaryRecord) => void;

export interface PlayResult {
  /** Present after a scenario run; null after an interactive run. */
  summary: SummaryRecord | null;
}

const DEFAULT_PLAYER_ID = 'playground-player';
const DEFAULT_EVENT_SALIENCE = 0.5;
const EVENT_MECHANISM = 'memory-stopgap';

/** Affordances are computed before the turn, when no moderation has happened yet. */
const NEUTRAL_SECURITY: SecurityContext = {
  sanitized: false,
  moderated: false,
  rateLimited: false,
  exitRequested: false,
  moderationFlags: [],
  inputViolations: [],
};

interface ProviderChoice {
  provider: LLMProvider;
  /** True when the turn's own provider resolution is bypassed (cassette modes). */
  overridden: boolean;
  /** The cassette being recorded, written out when the run ends. */
  recording: Cassette | null;
}

interface Target {
  world: ScratchWorld;
  /** True when this run created the project and must delete it afterwards. */
  scratch: boolean;
}

async function loadScenario(options: PlayOptions): Promise<PlaygroundScenario | null> {
  if (options.scenario) return options.scenario;
  if (!options.scenarioPath) return null;
  const content = await fs.readFile(options.scenarioPath, 'utf-8');
  const result = PlaygroundScenarioSchema.safeParse(JSON.parse(content));
  if (!result.success) {
    throw new Error(`Invalid scenario ${options.scenarioPath}: ${result.error.message}`);
  }
  return result.data;
}

async function chooseProvider(projectId: string, options: PlayOptions): Promise<ProviderChoice> {
  const note = options.note ?? ((message: string) => logger.info({ note: message }, 'playground'));
  if (options.replay) {
    const cassette = await readCassette(options.replay);
    return { provider: new PlaybackLLMProvider(cassette), overridden: true, recording: null };
  }
  const base = await resolveProvider(projectId, options.stub ?? false, note);
  if (options.record) {
    const recording: Cassette = { version: 1, entries: [] };
    return { provider: new RecordingLLMProvider(base, recording), overridden: true, recording };
  }
  return { provider: base, overridden: false, recording: null };
}

/**
 * Decide which project and NPC the run talks to. An embedded scenario NPC is
 * materialised into a scratch project that is deleted afterwards; an existing
 * NPC is used in place and never deleted.
 */
async function resolveTarget(scenario: PlaygroundScenario | null, options: PlayOptions): Promise<Target> {
  if (scenario?.npc) {
    const world = await materialiseScenario(scenario.name, scenario.npc, null);
    return { world, scratch: true };
  }
  const npcId = scenario?.npcId ?? options.npcId;
  if (!npcId) {
    throw new Error('Give --npc <id>, or a scenario with an embedded npc or an npcId');
  }
  const { projectId } = await findNpc(npcId);
  const playerId = scenario?.player?.id ?? options.playerId ?? DEFAULT_PLAYER_ID;
  return { world: { projectId, npcId, playerId }, scratch: false };
}

async function openSession(world: ScratchWorld): Promise<string> {
  const started = await startSession(
    world.projectId,
    world.npcId,
    world.playerId,
    undefined,
    CONVERSATION_MODES.TEXT_TEXT,
    null
  );
  return started.session_id;
}

/** Persist for resumption, or end with summarisation when asked. Returns whether it summarised. */
async function closeSession(sessionId: string, provider: LLMProvider, summarize: boolean): Promise<boolean> {
  if (summarize) {
    await endSession(sessionId, provider);
    return true;
  }
  const stored = getSession(sessionId);
  if (stored) await persistSession(stored.state);
  return false;
}

function snapshot(state: SessionState): TurnSnapshot {
  const instance = state.instance;
  return {
    mood: instance.current_mood,
    relationship: instance.relationships[state.player_id] ?? null,
    stmCount: instance.short_term_memory.length,
    ltmCount: instance.long_term_memory.length,
  };
}

async function currentTools(sessionId: string): Promise<ToolAffordance[]> {
  const context = await getSessionContext(sessionId);
  const projectTools = mcpToolRegistry.getProjectTools(context.project.id);
  const affordances = await computeAffordances(
    context.definition,
    context.knowledgeBase,
    projectTools,
    NEUTRAL_SECURITY,
    []
  );
  return affordances.tools;
}

function requireSession(sessionId: string) {
  const stored = getSession(sessionId);
  if (!stored) throw new Error(`Session ${sessionId} is not open`);
  return stored;
}

async function executeTurn(
  sessionId: string,
  playerInput: string,
  choice: ProviderChoice,
  turnNumber: number
): Promise<TurnRecord> {
  const before = snapshot(requireSession(sessionId).state);
  const tools = await currentTools(sessionId);

  const result = await runConversationTurn({
    sessionId,
    content: playerInput,
    fallbackProvider: choice.provider,
    toolRegistry: mcpToolRegistry,
    channel: 'playground',
    providers: choice.overridden ? { speaker: choice.provider, mind: choice.provider } : undefined,
  });

  const after = snapshot(requireSession(sessionId).state);
  return buildTurnRecord(
    result,
    before,
    after,
    turnNumber,
    sessionId,
    playerInput,
    tools.filter((t) => t.offered),
    tools.filter((t) => !t.offered)
  );
}

/**
 * World-event stopgap: the event becomes a short-term memory on the live
 * instance, which the next turn's prompt assembly reads. The scoped fact table
 * with TTL replaces this (backlog 7.8); the output record says which mechanism
 * was used so nobody mistakes one for the other.
 */
async function injectEvent(sessionId: string, text: string, salience: number): Promise<void> {
  const stored = requireSession(sessionId);
  stored.state.instance.short_term_memory.push(createMemory(text, 'short_term', salience));
  await persistSession(stored.state);
  logger.info({ sessionId, salience, length: text.length }, 'World event injected as memory');
}

async function stateRecord(sessionId: string, turns: number, choice: ProviderChoice): Promise<Record<string, unknown>> {
  const stored = requireSession(sessionId);
  const snap = snapshot(stored.state);
  const tools = await currentTools(sessionId);
  return {
    type: 'state',
    sessionId,
    turns,
    npcId: stored.state.definition_id,
    playerId: stored.state.player_id,
    mood: snap.mood,
    relationship: snap.relationship,
    memories: { stm: snap.stmCount, ltm: snap.ltmCount },
    tools: tools.filter((t) => t.offered).map((t) => t.name),
    providers: { name: choice.provider.name, overridden: choice.overridden },
  };
}

function errorRecord(code: string, error: unknown): Record<string, unknown> {
  return { type: 'error', code, message: error instanceof Error ? error.message : String(error) };
}

/**
 * Drive one NPC from a stream of JSON-lines commands, or from a scenario's
 * scripted player when the scenario has one. Returns the scenario summary so
 * the CLI can set the process exit code; the library never touches it.
 */
export async function runPlay(
  options: PlayOptions,
  input: AsyncIterable<string> | Iterable<string>,
  output: OutputSink
): Promise<PlayResult> {
  const scenario = await loadScenario(options);
  if (scenario?.player?.script) {
    return { summary: await runScenario(scenario, options, output) };
  }

  const target = await resolveTarget(scenario, options);
  const choice = await chooseProvider(target.world.projectId, options);
  let sessionId: string | null = null;
  let turns = 0;

  try {
    sessionId = await openSession(target.world);

    for await (const line of input) {
      const command = parseInputLine(line);
      try {
        if (command.type === 'error') {
          output({ type: 'error', code: command.code, message: command.message });
        } else if (command.type === 'say') {
          turns += 1;
          output(await executeTurn(sessionId, command.text, choice, turns));
        } else if (command.type === 'event') {
          await injectEvent(sessionId, command.text, command.salience ?? DEFAULT_EVENT_SALIENCE);
          output({ type: 'event', accepted: true, mechanism: EVENT_MECHANISM });
        } else if (command.type === 'inspect') {
          output(await stateRecord(sessionId, turns, choice));
        } else if (command.type === 'end') {
          break;
        }
      } catch (error) {
        if (error instanceof TurnError) {
          output(errorRecord('turn-failed', error));
          continue;
        }
        throw error;
      }
    }

    const summarized = await closeSession(sessionId, choice.provider, options.endSession ?? false);
    output({ type: 'end', sessionId, turns, summarized });
    if (choice.recording && options.record) await writeCassette(choice.recording, options.record);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Playground run failed');
    output(errorRecord('play-failed', error));
  } finally {
    if (target.scratch) await teardownProject(target.world.projectId, null);
  }
  return { summary: null };
}

async function runScenario(
  scenario: PlaygroundScenario,
  options: PlayOptions,
  output: OutputSink
): Promise<SummaryRecord> {
  const trials = options.trials ?? scenario.trials ?? 1;
  const expectations = scenario.expect ?? [];
  const script = scenario.player?.script ?? [];
  const trialResults: TrialResult[] = [];
  let recording: Cassette | null = null;

  for (let trial = 1; trial <= trials; trial++) {
    let target: Target | null = null;
    try {
      target = await resolveTarget(scenario, options);
      const choice = await chooseProvider(target.world.projectId, options);
      recording = choice.recording ?? recording;
      const sessionId = await openSession(target.world);
      const records: TurnRecord[] = [];

      for (let i = 0; i < script.length; i++) {
        const turnNumber = i + 1;
        const record = await executeTurn(sessionId, script[i], choice, turnNumber);
        records.push(record);
        output({ ...record, trial });
        for (const event of scenario.events ?? []) {
          if (event.afterTurn !== turnNumber) continue;
          await injectEvent(sessionId, event.text, event.salience ?? DEFAULT_EVENT_SALIENCE);
          output({ type: 'event', accepted: true, mechanism: EVENT_MECHANISM, trial });
        }
      }

      await closeSession(sessionId, choice.provider, options.endSession ?? false);
      const evaluations = evaluateExpectations(records, expectations);
      trialResults.push({ passed: evaluations.every((e) => e.passed), records, evaluations });
    } catch (error) {
      logger.error({ trial, error: error instanceof Error ? error.message : String(error) }, 'Trial failed');
      output({ ...errorRecord('trial-failed', error), trial });
      trialResults.push({ passed: false, records: [], evaluations: [] });
    } finally {
      if (target?.scratch) await teardownProject(target.world.projectId, null);
    }
  }

  const summary = summarise(scenario.name, trialResults, expectations);
  output(summary);
  if (recording && options.record) await writeCassette(recording, options.record);
  return summary;
}
