/**
 * Text harness: drive real NPCs a turn at a time and watch what their minds do.
 *
 *   npm run npc -- world
 *   npm run npc -- talk <npcId> "hello"
 *   npm run npc -- affordances <npcId>
 *   npm run npc -- inspect <npcId>
 *   npm run npc -- endsession <npcId>
 *   npm run npc -- cycle weekly <npcId>
 *   npm run npc -- log --session <id>
 *
 * Each invocation is a separate process. Session state is written to storage
 * after every turn and resumed on the next call, rather than ended and
 * restarted — ending a session summarises, writes a memory and drifts mood,
 * which would fabricate the behaviour this tool exists to observe.
 */

// Must be first: ESM hoists imports above statements, so environment defaults
// only take effect if they live in a module imported ahead of everything else.
import './bootstrap.js';

import { createLogger } from '../logger.js';
import { getStorage } from '../storage/factory.js';
import { persistSession } from '../storage/local/sessions.js';
import {
  startSession,
  resumeSession,
  endSession,
  getSession,
  getSessionContext,
} from '../session/manager.js';
import { runConversationTurn, TurnError } from '../conversation/turn.js';
import { mcpToolRegistry } from '../mcp/registry.js';
import { runDailyPulse, runWeeklyWhisper, runPersonaShift } from '../core/cycles.js';
import { loadState, saveState, type HarnessState } from './state.js';
import { readSessionLog, listLoggedSessions } from '../telemetry/session-log.js';
import { computeAffordances, renderAffordances, renderTurnDiagnostics } from './diagnostics.js';
import { runPlay } from './playground.js';
import { findNpc, resolveProvider, registerProjectTools, explainStorageFailure } from './lookup.js';
import type { NPCDefinition } from '../types/npc.js';
import type { ConversationMode } from '../types/voice.js';

const logger = createLogger('harness');

const DEFAULT_PLAYER_ID = 'harness_player';
const DEFAULT_TURN_CAP = 50;

interface Flags {
  player: string;
  stub: boolean;
  showPrompt: boolean;
  turnCap: number;
  session?: string;
  last?: number;
  clean: boolean;
  npc?: string;
  scenario?: string;
  trials?: number;
  runtime?: 'parallel' | 'single';
  record?: string;
  replay?: string;
  endSession: boolean;
}

function parseFlags(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {
    player: DEFAULT_PLAYER_ID,
    stub: false,
    showPrompt: false,
    turnCap: DEFAULT_TURN_CAP,
    clean: false,
    endSession: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stub') flags.stub = true;
    else if (arg === '--show-prompt') flags.showPrompt = true;
    else if (arg === '--clean') flags.clean = true;
    else if (arg === '--end-session') flags.endSession = true;
    else if (arg === '--player') flags.player = argv[++i] ?? DEFAULT_PLAYER_ID;
    else if (arg === '--session') flags.session = argv[++i];
    else if (arg === '--turn-cap') flags.turnCap = Number(argv[++i]) || DEFAULT_TURN_CAP;
    else if (arg === '--last') flags.last = Number(argv[++i]) || 10;
    else if (arg === '--npc') flags.npc = argv[++i];
    else if (arg === '--scenario') flags.scenario = argv[++i];
    else if (arg === '--trials') flags.trials = Number(argv[++i]);
    else if (arg === '--runtime') flags.runtime = argv[++i] as 'parallel' | 'single';
    else if (arg === '--record') flags.record = argv[++i];
    else if (arg === '--replay') flags.replay = argv[++i];
    else positional.push(arg);
  }
  return { positional, flags };
}

function out(text: string): void {
  process.stdout.write(text + '\n');
}

/** Bring the NPC's session into this process, starting one if needed. */
async function ensureSession(
  state: HarnessState,
  npcId: string,
  playerId: string,
): Promise<{ sessionId: string; projectId: string; started: boolean }> {
  const existing = state.sessions[npcId];

  if (existing) {
    if (getSession(existing.sessionId)) {
      return { sessionId: existing.sessionId, projectId: existing.projectId, started: false };
    }
    try {
      await resumeSession(existing.sessionId, null);
      return { sessionId: existing.sessionId, projectId: existing.projectId, started: false };
    } catch (error) {
      logger.warn(
        { sessionId: existing.sessionId, error: error instanceof Error ? error.message : 'Unknown' },
        'Could not resume session; starting a new one'
      );
      delete state.sessions[npcId];
    }
  }

  const { projectId } = await findNpc(npcId);
  const result = await startSession(projectId, npcId, playerId, undefined, { input: 'text', output: 'text' } as ConversationMode, null);
  state.sessions[npcId] = {
    sessionId: result.session_id,
    projectId,
    npcId,
    playerId,
    turns: 0,
  };
  return { sessionId: result.session_id, projectId, started: true };
}

async function cmdWorld(state: HarnessState): Promise<void> {
  const storage = getStorage(null);
  const projects = await storage.listProjects(undefined);

  if (projects.length === 0) {
    out('No local projects. Run: npm run npc -- seed office');
    return;
  }

  for (const project of projects) {
    const seeded = state.seededProjects.includes(project.id) ? '  [harness-seeded]' : '';
    out(`\n${project.name}  (${project.id})${seeded}`);
    let definitions: NPCDefinition[] = [];
    try {
      definitions = await storage.listDefinitions(project.id);
    } catch (error) {
      out(`  could not list NPCs: ${explainStorageFailure(error)}`);
      continue;
    }
    if (definitions.length === 0) out('  (no NPCs)');
    for (const def of definitions) {
      const open = state.sessions[def.id];
      const marker = open ? `  <- open session ${open.sessionId} (${open.turns} turns)` : '';
      out(`  ${def.id}  ${def.name}${marker}`);
    }
  }
}

async function cmdTalk(state: HarnessState, npcId: string, text: string, flags: Flags): Promise<void> {
  const { sessionId, projectId, started } = await ensureSession(state, npcId, flags.player);
  const entry = state.sessions[npcId];

  if (entry.turns >= flags.turnCap) {
    out(
      `Turn cap reached (${flags.turnCap}) for ${npcId}. The session is still open — raise it with ` +
      `--turn-cap or close it with "endsession ${npcId}".`
    );
    return;
  }

  if (started) out(`(started session ${sessionId} for ${npcId} as ${flags.player})`);

  const provider = await resolveProvider(projectId, flags.stub, out);

  let turn;
  try {
    turn = await runConversationTurn({
      sessionId,
      content: text,
      fallbackProvider: provider,
      toolRegistry: mcpToolRegistry,
      channel: 'harness',
    });
  } catch (error) {
    if (error instanceof TurnError) {
      out(`Turn failed: ${error.message}`);
      return;
    }
    throw error;
  }

  const stored = getSession(sessionId);
  const context = await getSessionContext(sessionId);
  entry.turns += 1;

  out('');
  out(
    renderTurnDiagnostics({
      turnIndex: entry.turns,
      definition: context.definition,
      instance: context.instance,
      sessionId,
      playerId: flags.player,
      turn,
    })
  );

  if (flags.showPrompt) {
    out('');
    out('--- speaker prompt ---');
    out(turn.speakerPrompt);
    out('--- end prompt ---');
  }

  // Persist directly. Ending the session here would summarise and write memory,
  // which is exactly the behaviour we are trying to observe rather than cause.
  if (stored) {
    await persistSession(stored.state);
  }

  await saveState(state);
}

/**
 * The registry is populated lazily by getSessionContext, so a command that never
 * opens a session sees an empty one and would report every configured tool as
 * withheld. Load them the same way the session layer does.
 */

async function cmdAffordances(npcId: string, flags: Flags): Promise<void> {
  const { projectId, definition } = await findNpc(npcId);
  const storage = getStorage(null);
  const knowledgeBase = await storage.getKnowledgeBase(projectId).catch(() => null);
  await registerProjectTools(projectId);
  const projectTools = mcpToolRegistry.getProjectTools(projectId);

  const networkNames: string[] = [];
  for (const entry of definition.network ?? []) {
    try {
      const known = await storage.getDefinition(projectId, entry.npc_id);
      networkNames.push(known.name);
    } catch {
      // Unresolvable network entries are simply absent, as in the mind loop.
    }
  }

  const affordances = await computeAffordances(
    definition,
    knowledgeBase,
    projectTools,
    {
      sanitized: true,
      moderated: true,
      rateLimited: false,
      exitRequested: false,
      moderationFlags: [],
      inputViolations: [],
    },
    networkNames
  );

  out(`${definition.name} (${definition.id}) in ${projectId}`);
  out(renderAffordances(affordances));
  void flags;
}

async function cmdInspect(state: HarnessState, npcId: string, flags: Flags): Promise<void> {
  const { projectId, definition } = await findNpc(npcId);
  const storage = getStorage(null);
  const instances = await storage.listInstancesForNpc(projectId, npcId);
  const instance = instances.find((i) => i.player_id === flags.player);

  out(`${definition.name} (${definition.id})`);
  out(`anchor    : ${definition.core_anchor?.backstory?.slice(0, 200) ?? '(none)'}`);

  if (!instance) {
    const others = instances.map((i) => i.player_id).filter((p) => p !== flags.player);
    out(`instance  : none yet for player "${flags.player}" - talk to create one`);
    if (others.length > 0) {
      out(`            (other players with a mind here: ${others.join(', ')})`);
    }
    return;
  }

  const m = instance.current_mood;
  out(`instance  : ${instance.id}  player ${instance.player_id}`);
  out(`mood      : v/a/d ${m.valence.toFixed(2)}/${m.arousal.toFixed(2)}/${m.dominance.toFixed(2)}`);
  out(`STM (${instance.short_term_memory?.length ?? 0}):`);
  for (const mem of instance.short_term_memory ?? []) {
    out(`  [${mem.salience?.toFixed(2) ?? '?'}] ${mem.content}`);
  }
  out(`LTM (${instance.long_term_memory?.length ?? 0}):`);
  for (const mem of instance.long_term_memory ?? []) {
    out(`  [${mem.salience?.toFixed(2) ?? '?'}] ${mem.content}`);
  }
  void state;
}

async function cmdEndSession(state: HarnessState, npcId: string, flags: Flags): Promise<void> {
  const entry = state.sessions[npcId];
  if (!entry) {
    out(`No open session for ${npcId}.`);
    return;
  }

  if (!getSession(entry.sessionId)) {
    await resumeSession(entry.sessionId, null);
  }

  const provider = await resolveProvider(entry.projectId, flags.stub);
  const result = await endSession(entry.sessionId, provider, false);

  // memorySaved is false when summarisation fails, and the call still succeeds.
  out(`session   : ${entry.sessionId} ended after ${entry.turns} turns`);
  // memorySaved is false when summarisation fails, and endSession still succeeds.
  out(`memory    : saved=${result.memorySaved}  version=${result.version}`);

  // The memory itself lands on the stored instance, so read it back.
  const storage = getStorage(null);
  const { projectId, npcId: id } = entry;
  const instances = await storage.listInstancesForNpc(projectId, id).catch(() => []);
  const instance = instances.find((i) => i.player_id === entry.playerId);
  const newest = instance?.short_term_memory?.[instance.short_term_memory.length - 1];
  if (result.memorySaved && newest) {
    out(`            salience ${newest.salience?.toFixed(2) ?? '?'}`);
    out(`            ${newest.content}`);
  } else {
    out('            (no memory produced - summarisation may have failed)');
  }

  delete state.sessions[npcId];
  await saveState(state);
}

async function cmdCycle(state: HarnessState, kind: string, npcId: string, flags: Flags): Promise<void> {
  if (state.sessions[npcId]) {
    out(
      `${npcId} has an open session. Cycles operate on stored instance state, and an open session ` +
      `holds a snapshot that would overwrite the result. Run "endsession ${npcId}" first.`
    );
    return;
  }

  const { projectId, definition } = await findNpc(npcId);
  const storage = getStorage(null);
  const instances = await storage.listInstancesForNpc(projectId, npcId);
  const instance = instances.find((i) => i.player_id === flags.player);

  if (!instance) {
    // Running a cycle against another player's mind would be the same mistake
    // ERR-024 was: one player's history leaking into another's character.
    out(`No instance for ${npcId} and player "${flags.player}". Talk to it first.`);
    return;
  }

  const before = {
    stm: instance.short_term_memory?.length ?? 0,
    ltm: instance.long_term_memory?.length ?? 0,
    mood: { ...instance.current_mood },
  };

  const provider = await resolveProvider(projectId, flags.stub, out);

  // The cycle functions mutate the instance in place and return a summary.
  if (kind === 'daily') {
    const result = await runDailyPulse(instance, provider, definition.name, undefined);
    out(`takeaway  : ${result.takeaway || '(none)'}`);
  } else if (kind === 'weekly') {
    const threshold = definition.salience_threshold ?? 0.5;
    const result = await runWeeklyWhisper(instance, undefined, threshold, provider, {
      name: definition.name,
      backstory: definition.core_anchor?.backstory ?? '',
      principles: definition.core_anchor?.principles ?? [],
      salienceThreshold: threshold,
    });
    out(`threshold : ${threshold}`);
    out(`promoted  : ${result.memoriesPromoted}  retained: ${result.memoriesRetained}  discarded: ${result.memoriesDiscarded}`);
    if (flags.stub) out('            (stub mode: any promoted content is stub text)');
  } else if (kind === 'persona') {
    const result = await runPersonaShift(
      instance,
      provider,
      definition.name,
      definition.core_anchor?.backstory ?? '',
      definition.core_anchor?.principles ?? []
    );
    const changed = Object.keys(result.traitChanges ?? {});
    out(`shifted   : ${changed.length > 0 ? changed.join(', ') : 'no traits changed'}`);
  } else {
    out(`Unknown cycle "${kind}". Use daily, weekly or persona.`);
    return;
  }

  await storage.saveInstance(instance);

  const after = {
    stm: instance.short_term_memory?.length ?? 0,
    ltm: instance.long_term_memory?.length ?? 0,
    mood: instance.current_mood,
  };
  out(`STM       : ${before.stm} -> ${after.stm}`);
  out(`LTM       : ${before.ltm} -> ${after.ltm}`);
  out(
    `mood      : ${before.mood.valence.toFixed(2)}/${before.mood.arousal.toFixed(2)}/${before.mood.dominance.toFixed(2)}` +
    ` -> ${after.mood.valence.toFixed(2)}/${after.mood.arousal.toFixed(2)}/${after.mood.dominance.toFixed(2)}`
  );
}

async function cmdLog(state: HarnessState, flags: Flags, npcId?: string): Promise<void> {
  const sessionId = flags.session ?? (npcId ? state.sessions[npcId]?.sessionId : undefined);

  if (!sessionId) {
    // Sessions are logged by the engine regardless of who drove them, so a
    // harness with no open session can still show what has been recorded.
    const sessions = await listLoggedSessions();
    if (sessions.length === 0) {
      out('No session logs yet.');
      return;
    }
    out('Give --session <id>. Recorded sessions, newest first:');
    for (const id of sessions.slice(0, flags.last ?? 20)) out(`  ${id}`);
    return;
  }

  const records = await readSessionLog(sessionId);
  const slice = flags.last ? records.slice(-flags.last) : records;
  for (const r of slice) out(JSON.stringify(r));
  out(`(${slice.length} of ${records.length} records from ${sessionId})`);
}

async function cmdPlay(flags: Flags): Promise<void> {
  const input = async function* () {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    for await (const line of rl) {
      yield line;
    }
  };

  // stdout carries only JSON records; notes and logs go to stderr.
  const output = (record: unknown) => {
    process.stdout.write(JSON.stringify(record) + '\n');
  };
  const note = (message: string) => process.stderr.write(message + '\n');

  const result = await runPlay(
    {
      scenarioPath: flags.scenario,
      npcId: flags.npc,
      playerId: flags.player,
      stub: flags.stub,
      trials: flags.trials,
      runtime: flags.runtime,
      record: flags.record,
      replay: flags.replay,
      endSession: flags.endSession,
      note,
    },
    input(),
    output
  );

  // A scenario is a CI gate: every trial must pass every expectation.
  if (result.summary && result.summary.passK !== 1) process.exitCode = 1;
}

async function main(): Promise<void> {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const command = positional[0];
  const state = await loadState();

  try {
    switch (command) {
      case 'world':
        await cmdWorld(state);
        break;
      case 'talk':
        if (!positional[1] || !positional[2]) {
          out('Usage: talk <npcId> "<text>"');
          break;
        }
        await cmdTalk(state, positional[1], positional[2], flags);
        break;
      case 'affordances':
        if (!positional[1]) { out('Usage: affordances <npcId>'); break; }
        await cmdAffordances(positional[1], flags);
        break;
      case 'inspect':
        if (!positional[1]) { out('Usage: inspect <npcId>'); break; }
        await cmdInspect(state, positional[1], flags);
        break;
      case 'endsession':
        if (!positional[1]) { out('Usage: endsession <npcId>'); break; }
        await cmdEndSession(state, positional[1], flags);
        break;
      case 'cycle':
        if (!positional[1] || !positional[2]) { out('Usage: cycle daily|weekly|persona <npcId>'); break; }
        await cmdCycle(state, positional[1], positional[2], flags);
        break;
      case 'log':
        await cmdLog(state, flags, positional[1]);
        break;
      case 'play':
        await cmdPlay(flags);
        break;
      default:
        out('Commands: world | talk | affordances | inspect | endsession | cycle | log | play');
        out('Flags: --player <id> --stub --show-prompt --turn-cap <n> --session <id> --last <n>');
        out('Play flags: --npc <id> --scenario <file> --trials <k> --runtime parallel|single --record <file> --replay <file> --end-session');
    }
  } catch (error) {
    out(`Error: ${explainStorageFailure(error)}`);
    process.exitCode = 1;
  }
}

void main();
