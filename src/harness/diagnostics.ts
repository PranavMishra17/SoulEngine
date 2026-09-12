/**
 * What a mind could reach, and what it did with it.
 *
 * Every figure here is grounded in something the code actually computes. Two
 * quantities the first draft of this tool promised are deliberately absent
 * because they do not exist:
 *
 *  - "knowledge injected into this turn's prompt" — the Speaker prompt carries
 *    no world knowledge at all (see the `// NO world knowledge section in slim
 *    prompt` comment in core/context.ts). Knowledge reaches a model only when
 *    the Mind calls recall_knowledge, and that lands on the NEXT turn.
 *  - "memory and mood deltas within a turn" — STM is appended only by
 *    endSession, and mood moves only on a moderation action. Reporting a
 *    before/after per turn would print zeroes forever and make the normal state
 *    look like a fault.
 */

import { getAvailableDepths } from '../core/knowledge.js';
import { getMindAvailableTools } from '../core/tools.js';
import type { KnowledgeBase, KnowledgeAccess } from '../types/knowledge.js';
import type { NPCDefinition, NPCInstance } from '../types/npc.js';
import type { SecurityContext } from '../types/security.js';
import type { Tool } from '../types/mcp.js';
import type { TurnResult } from '../conversation/turn.js';

export interface CategoryAffordance {
  category: string;
  /** Depths that exist in the knowledge base, e.g. [0,1,2,3]. */
  existing: number[];
  /** Highest depth this NPC is granted, or null when the category is not granted. */
  granted: number | null;
  /** Depths that would resolve for this NPC: every depth <= granted. */
  reachable: number[];
}

export interface ToolAffordance {
  name: string;
  offered: boolean;
  /** Why a registry tool was not offered. Undefined when offered. */
  withheldReason?: string;
}

export interface Affordances {
  knowledge: CategoryAffordance[];
  tools: ToolAffordance[];
}

/**
 * Static affordances for an NPC: what it may reach, before any turn happens.
 *
 * Note the asymmetry the numbers must not hide: resolveCategoryKnowledge
 * includes every depth <= the granted level, so a depth 0 tier counts as
 * reachable, while getMindAvailableTools only lists categories granted above
 * level 0. Rendering "2 of 3" would paper over that; ranges do not.
 */
export async function computeAffordances(
  definition: NPCDefinition,
  knowledgeBase: KnowledgeBase | null,
  projectTools: Record<string, Tool>,
  securityContext: SecurityContext,
  networkNames: string[],
): Promise<Affordances> {
  const access: KnowledgeAccess = definition.knowledge_access ?? {};
  const knowledge: CategoryAffordance[] = [];

  for (const [id, category] of Object.entries(knowledgeBase?.categories ?? {})) {
    const existing = getAvailableDepths(category);
    const granted = Object.prototype.hasOwnProperty.call(access, id) ? access[id] : null;
    knowledge.push({
      category: id,
      existing,
      granted,
      reachable: granted === null ? [] : existing.filter((d) => d <= granted),
    });
  }

  const offered = getMindAvailableTools(definition, securityContext, projectTools, networkNames);
  const offeredNames = new Set(offered.map((t) => t.name));

  const tools: ToolAffordance[] = offered.map((t) => ({ name: t.name, offered: true }));

  // Registry tools that exist for the project but were not offered, and why.
  const denied = new Set(definition.mcp_permissions?.denied ?? []);
  const conversationTools = new Set(definition.mcp_permissions?.conversation_tools ?? []);

  for (const name of Object.keys(projectTools)) {
    if (offeredNames.has(name)) continue;
    let reason = 'not in conversation_tools';
    if (denied.has(name)) reason = 'in denied list';
    else if (!conversationTools.has(name)) reason = 'not in conversation_tools';
    tools.push({ name, offered: false, withheldReason: reason });
  }

  return { knowledge, tools };
}

function renderDepths(depths: number[]): string {
  if (depths.length === 0) return 'none';
  const min = depths[0];
  const max = depths[depths.length - 1];
  return min === max ? `${min}` : `${min}-${max}`;
}

export function renderAffordances(a: Affordances): string {
  const lines: string[] = [];

  lines.push('knowledge :');
  if (a.knowledge.length === 0) {
    lines.push('            (no knowledge base for this project)');
  }
  for (const k of a.knowledge) {
    const grant = k.granted === null
      ? 'not granted'
      : `depths ${renderDepths(k.reachable)} of ${renderDepths(k.existing)}`;
    lines.push(`            ${k.category.padEnd(20)} ${grant}`);
  }

  const offered = a.tools.filter((t) => t.offered).map((t) => t.name);
  const withheld = a.tools.filter((t) => !t.offered);

  lines.push('tools     :');
  lines.push(`            offered   ${offered.length > 0 ? offered.join(', ') : 'none'}`);
  if (withheld.length > 0) {
    for (const w of withheld) {
      lines.push(`            withheld  ${w.name.padEnd(18)} (${w.withheldReason})`);
    }
  }

  return lines.join('\n');
}

/** Count of `- Retrieved (tool): ` entries in a deferred-context blob. */
export function countRecallResults(context: string | null): number {
  if (!context) return 0;
  return context.split('\n').filter((l) => l.startsWith('- Retrieved (')).length;
}

export interface TurnDiagnosticInput {
  turnIndex: number;
  definition: NPCDefinition;
  instance: NPCInstance;
  sessionId: string;
  playerId: string;
  turn: TurnResult;
}

/**
 * The per-turn block. Everything printed here is a real quantity; state figures
 * are current values, not deltas, because they cannot move inside a turn.
 */
export function renderTurnDiagnostics(input: TurnDiagnosticInput): string {
  const { turnIndex, definition, instance, sessionId, playerId, turn } = input;
  const mind = turn.mindResult;
  const lines: string[] = [];

  lines.push(
    `--- turn ${turnIndex} | ${definition.id} (${definition.name}) | session ${sessionId} | player ${playerId} ---`
  );
  lines.push(`reply     : ${turn.responseText}`);

  lines.push(`mind      : completed  ${mind ? mind.completed : 'n/a (mind failed)'}`);

  const called = mind?.tools_called ?? [];
  if (called.length === 0) {
    // NO_ACTION and "model returned no tool calls" produce identical results,
    // so this deliberately does not claim to know which happened.
    lines.push('            called     none');
  } else {
    for (const tc of called) {
      const args = Object.entries(tc.arguments)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ');
      const size = tc.result_content ? `${tc.result_content.length} chars` : 'no content';
      const truncated = tc.result_content?.endsWith('... [truncated]') ? ', truncated' : '';
      lines.push(`            called     ${tc.tool_name}(${args}) -> ${tc.status}, ${size}${truncated}`);
    }
  }

  const offeredNames = mind?.tools_offered ?? [];
  lines.push(
    `            offered    ${offeredNames.length > 0 ? offeredNames.join(', ') : 'none'}` +
    `  (${offeredNames.length} offered / ${called.length} called)`
  );

  const injectedCount = countRecallResults(turn.deferredContextInjected);
  lines.push(
    `recall    : injected into THIS turn : ${turn.deferredContextInjected ? `yes (${injectedCount} recall results)` : 'no'}`
  );
  lines.push(
    `            deferred to NEXT turn   : ${turn.deferredContextForNextTurn ? `yes (${turn.recallResultCount} recall results)` : 'no'}`
  );
  if (turn.mcpResultCount > 0) {
    lines.push(`            action follow-up speech : ${turn.mcpResultCount} action(s)`);
  }

  const mood = instance.current_mood;
  lines.push(
    `state     : STM ${instance.short_term_memory?.length ?? 0}  LTM ${instance.long_term_memory?.length ?? 0}` +
    `  mood v/a/d ${mood.valence.toFixed(2)}/${mood.arousal.toFixed(2)}/${mood.dominance.toFixed(2)}`
  );
  lines.push('            (cannot change within a turn by design - see endsession and cycle)');

  if ((turn.moderationAction !== 'allow' && turn.moderationAction !== 'none') || turn.sanitizationViolations.length > 0) {
    lines.push(
      `security  : moderation=${turn.moderationAction}` +
      (turn.sanitizationViolations.length > 0
        ? ` sanitizer=${turn.sanitizationViolations.join(',')}`
        : '')
    );
  }

  const t = turn.timings;
  const ttftParts: string[] = [];
  if (t.speakerTtftMs !== null) {
    ttftParts.push(`speaker-ttft ${t.speakerTtftMs}ms`);
  }
  if (t.followUpTtftMs !== null) {
    ttftParts.push(`follow-up-ttft ${t.followUpTtftMs}ms`);
  }
  const ttftLine = ttftParts.length > 0 ? ` | ${ttftParts.join(' | ')}` : '';

  lines.push(
    `timing    : mind ${t.mindMs ?? 'n/a'}ms | speaker ${t.speakerMs}ms` +
    (t.followUpMs !== null ? ` | follow-up ${t.followUpMs}ms` : '') +
    ttftLine +
    ` | wall ${t.wallMs}ms` +
    (turn.usageEstimated ? '  (tokens estimated, provider reported none)' : '')
  );

  const cacheParts: string[] = [];
  if (turn.usage?.speaker?.cached_input_tokens) {
    cacheParts.push(`speaker: ${turn.usage.speaker.cached_input_tokens} read`);
  }
  if (turn.usage?.followUp?.cached_input_tokens) {
    cacheParts.push(`follow-up: ${turn.usage.followUp.cached_input_tokens} read`);
  }
  if (cacheParts.length > 0) {
    lines.push(`cache     : ${cacheParts.join(', ')}`);
  }

  return lines.join('\n');
}
