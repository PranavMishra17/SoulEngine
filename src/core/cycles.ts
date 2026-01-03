import { createLogger } from '../logger.js';
import type { NPCInstance, MoodVector, DailyPulse, PersonalityBaseline } from '../types/npc.js';
import type { LLMProvider } from '../providers/llm/interface.js';
import { pruneLTM, promoteToLTM } from './memory.js';
import { blendMoods, updateTraitModifiers } from './personality.js';

const logger = createLogger('cycles');

/**
 * Daily pulse result
 */
export interface DailyPulseResult {
  success: boolean;
  previousMood: MoodVector;
  newMood: MoodVector;
  takeaway: string;
  timestamp: string;
}

/**
 * Weekly whisper result
 */
export interface WeeklyWhisperResult {
  success: boolean;
  memoriesRetained: number;
  memoriesDiscarded: number;
  memoriesPromoted: number;
  timestamp: string;
}

/**
 * Persona shift result
 */
export interface PersonaShiftResult {
  success: boolean;
  traitChanges: Partial<PersonalityBaseline>;
  relationshipChanges: Record<string, { before: number; after: number }>;
  timestamp: string;
}

/**
 * Context for daily pulse generation
 */
export interface DayContext {
  /** Key events that happened */
  events?: string[];
  /** General mood of interactions */
  overallMood?: 'positive' | 'neutral' | 'negative';
  /** Notable interactions */
  interactions?: string[];
}

/**
 * Run the Daily Pulse cycle.
 *
 * This lightweight cycle:
 * 1. Captures a mood baseline from recent activity
 * 2. Generates a single-sentence takeaway about the day
 * 3. Updates the instance's daily_pulse field
 *
 * Token cost: ~200 tokens
 */
export async function runDailyPulse(
  instance: NPCInstance,
  llmProvider: LLMProvider,
  npcName: string,
  dayContext?: DayContext
): Promise<DailyPulseResult> {
  const startTime = Date.now();
  logger.info({ instanceId: instance.id, npcName }, 'Running daily pulse');

  const previousMood = { ...instance.current_mood };

  try {
    // Build prompt for takeaway generation
    const recentMemories = instance.short_term_memory.slice(-5);
    const memoryContext = recentMemories.map((m) => `- ${m.content}`).join('\n');

    const contextInfo = dayContext
      ? `\nToday's events: ${dayContext.events?.join(', ') ?? 'None notable'}
Overall mood of interactions: ${dayContext.overallMood ?? 'neutral'}`
      : '';

    const prompt = `You are ${npcName}. Reflect briefly on your day.

Recent memories:
${memoryContext || '- Nothing particularly memorable happened today'}
${contextInfo}

In ONE sentence (15-25 words), express your main takeaway from today. Be personal and emotional, not robotic. Example: "It was nice to finally have a quiet afternoon, though I can't shake the feeling something's off."

Your takeaway:`;

    // Generate takeaway
    let takeaway = '';
    for await (const chunk of llmProvider.streamChat({
      systemPrompt: 'You are a helpful assistant generating character reflections.',
      messages: [{ role: 'user', content: prompt }],
    })) {
      takeaway += chunk.text;
    }

    takeaway = takeaway.trim();

    // Update mood with gentle drift toward neutral
    const neutralMood: MoodVector = { valence: 0.5, arousal: 0.5, dominance: 0.5 };
    let newMood = blendMoods(previousMood, neutralMood, 0.2);

    // Adjust based on day context
    if (dayContext?.overallMood === 'positive') {
      const positiveMood: MoodVector = { valence: 0.7, arousal: 0.6, dominance: 0.6 };
      newMood = blendMoods(newMood, positiveMood, 0.15);
    } else if (dayContext?.overallMood === 'negative') {
      const negativeMood: MoodVector = { valence: 0.3, arousal: 0.6, dominance: 0.4 };
      newMood = blendMoods(newMood, negativeMood, 0.15);
    }

    // Create daily pulse
    const timestamp = new Date().toISOString();
    const dailyPulse: DailyPulse = {
      mood: newMood,
      takeaway,
      timestamp,
    };

    // Update instance
    instance.daily_pulse = dailyPulse;
    instance.current_mood = newMood;

    const duration = Date.now() - startTime;
    logger.info({ instanceId: instance.id, duration, takeawayLength: takeaway.length }, 'Daily pulse completed');

    return {
      success: true,
      previousMood,
      newMood,
      takeaway,
      timestamp,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ instanceId: instance.id, error: errorMessage, duration }, 'Daily pulse failed');

    return {
      success: false,
      previousMood,
      newMood: previousMood,
      takeaway: '',
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Run the Weekly Whisper cycle.
 *
 * This cycle:
 * 1. Reviews all STM memories
 * 2. Selects the most salient ones to retain
 * 3. REPLACES STM with the retained memories (aggressive pruning)
 * 4. Promotes high-salience memories to LTM
 *
 * Token cost: ~500 tokens
 */
export async function runWeeklyWhisper(
  instance: NPCInstance,
  retainCount: number = 3
): Promise<WeeklyWhisperResult> {
  const startTime = Date.now();
  logger.info({ instanceId: instance.id, retainCount }, 'Running weekly whisper');

  try {
    const originalSTMCount = instance.short_term_memory.length;

    // Sort by salience (highest first)
    const sortedMemories = [...instance.short_term_memory].sort((a, b) => b.salience - a.salience);

    // Retain top N memories
    const retained = sortedMemories.slice(0, retainCount);
    const discarded = sortedMemories.slice(retainCount);

    // Promote high-salience memories to LTM (salience >= 0.7)
    const toPromote = retained.filter((m) => m.salience >= 0.7);
    let promoted = 0;

    for (const memory of toPromote) {
      const promotedMemory = promoteToLTM(memory);
      instance.long_term_memory.push(promotedMemory);
      promoted++;
    }

    // Prune LTM if over limit
    const ltmPruneResult = pruneLTM(instance.long_term_memory);
    instance.long_term_memory = ltmPruneResult.kept;

    // REPLACE STM with retained memories (this is the aggressive pruning)
    instance.short_term_memory = retained;

    // Update cycle metadata
    instance.cycle_metadata.last_weekly = new Date().toISOString();

    const duration = Date.now() - startTime;
    logger.info(
      {
        instanceId: instance.id,
        duration,
        originalSTM: originalSTMCount,
        retained: retained.length,
        discarded: discarded.length,
        promoted,
        finalLTM: instance.long_term_memory.length,
      },
      'Weekly whisper completed'
    );

    return {
      success: true,
      memoriesRetained: retained.length,
      memoriesDiscarded: discarded.length,
      memoriesPromoted: promoted,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ instanceId: instance.id, error: errorMessage, duration }, 'Weekly whisper failed');

    return {
      success: false,
      memoriesRetained: instance.short_term_memory.length,
      memoriesDiscarded: 0,
      memoriesPromoted: 0,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Run the Persona Shift cycle.
 *
 * This major recalibration:
 * 1. Reviews accumulated experiences (LTM)
 * 2. Generates trait modifications based on patterns
 * 3. Updates relationships based on interaction history
 * 4. NEVER modifies the Core Anchor
 *
 * Token cost: ~1000 tokens
 */
export async function runPersonaShift(
  instance: NPCInstance,
  llmProvider: LLMProvider,
  npcName: string,
  backstory: string,
  principles: string[]
): Promise<PersonaShiftResult> {
  const startTime = Date.now();
  logger.info({ instanceId: instance.id, npcName }, 'Running persona shift');

  const traitChanges: Partial<PersonalityBaseline> = {};
  const relationshipChanges: Record<string, { before: number; after: number }> = {};

  try {
    // Analyze LTM for patterns
    const ltmContent = instance.long_term_memory
      .slice(-20) // Last 20 LTM memories
      .map((m) => `- ${m.content}`)
      .join('\n');

    const stmContent = instance.short_term_memory
      .slice(-10) // Last 10 STM memories
      .map((m) => `- ${m.content}`)
      .join('\n');

    const prompt = `You are analyzing ${npcName}'s psychological development.

CORE IDENTITY (IMMUTABLE - DO NOT CHANGE):
Backstory: ${backstory}
Principles: ${principles.join('; ')}

RECENT EXPERIENCES:
Long-term memories:
${ltmContent || '- No significant long-term memories yet'}

Short-term memories:
${stmContent || '- No significant short-term memories yet'}

Current trait modifiers: ${JSON.stringify(instance.trait_modifiers)}

Based on these experiences, suggest subtle personality trait adjustments.
Each adjustment must be between -0.1 and +0.1 (small changes only).

Output as JSON with the format:
{
  "trait_changes": {
    "openness": 0.05,
    "conscientiousness": -0.02,
    "extraversion": 0,
    "agreeableness": 0.03,
    "neuroticism": -0.05
  },
  "reasoning": "Brief explanation of why these changes occurred"
}

Only include traits that should change. Small, believable evolution only.`;

    // Generate trait adjustments
    let responseText = '';
    for await (const chunk of llmProvider.streamChat({
      systemPrompt: 'You are a psychology expert analyzing character development. Output only valid JSON.',
      messages: [{ role: 'user', content: prompt }],
    })) {
      responseText += chunk.text;
    }

    // Parse the response
    try {
      // Extract JSON from response (may have markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          trait_changes: Partial<PersonalityBaseline>;
          reasoning: string;
        };

        // Apply trait changes with bounds checking
        for (const [trait, change] of Object.entries(parsed.trait_changes ?? {})) {
          if (typeof change === 'number') {
            // Clamp to [-0.1, +0.1] per cycle
            const clampedChange = Math.max(-0.1, Math.min(0.1, change));
            if (clampedChange !== 0) {
              traitChanges[trait as keyof PersonalityBaseline] = clampedChange;
            }
          }
        }

        logger.debug({ reasoning: parsed.reasoning }, 'Persona shift reasoning');
      }
    } catch (parseError) {
      logger.warn({ response: responseText.slice(0, 200) }, 'Failed to parse persona shift response');
    }

    // Apply trait changes to instance (accumulate modifiers)
    const updatedModifiers = updateTraitModifiers(instance.trait_modifiers, traitChanges);
    instance.trait_modifiers = updatedModifiers;

    // Update relationships based on sentiment
    for (const [playerId, relationship] of Object.entries(instance.relationships)) {
      const before = relationship.sentiment;

      // Slight drift based on trust and familiarity
      let drift = 0;
      if (relationship.trust > 0.6 && relationship.familiarity > 0.5) {
        drift = 0.05; // Relationship improving
      } else if (relationship.trust < 0.3) {
        drift = -0.05; // Relationship declining
      }

      if (drift !== 0) {
        relationship.sentiment = Math.max(-1, Math.min(1, relationship.sentiment + drift));
        relationshipChanges[playerId] = { before, after: relationship.sentiment };
      }
    }

    // Update cycle metadata
    instance.cycle_metadata.last_persona_shift = new Date().toISOString();

    const duration = Date.now() - startTime;
    logger.info(
      {
        instanceId: instance.id,
        duration,
        traitChangeCount: Object.keys(traitChanges).length,
        relationshipChangeCount: Object.keys(relationshipChanges).length,
      },
      'Persona shift completed'
    );

    return {
      success: true,
      traitChanges,
      relationshipChanges,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ instanceId: instance.id, error: errorMessage, duration }, 'Persona shift failed');

    return {
      success: false,
      traitChanges: {},
      relationshipChanges: {},
      timestamp: new Date().toISOString(),
    };
  }
}
