import { createLogger } from '../logger.js';
import type { PersonalityBaseline, MoodVector } from '../types/npc.js';

const logger = createLogger('personality-engine');

/**
 * Bounds for trait modifiers
 */
const MODIFIER_MIN = -0.3;
const MODIFIER_MAX = 0.3;

/**
 * Trait modifier type - partial personality baseline
 */
export type TraitModifiers = Partial<PersonalityBaseline>;

/**
 * Big Five trait names for iteration
 */
const TRAIT_NAMES: (keyof PersonalityBaseline)[] = [
  'openness',
  'conscientiousness',
  'extraversion',
  'agreeableness',
  'neuroticism',
];

/**
 * Clamp a value between min and max bounds
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamp a trait value to valid range [0, 1]
 */
function clampTrait(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * Clamp a modifier value to valid range [-0.3, +0.3]
 */
export function clampModifier(value: number): number {
  return clamp(value, MODIFIER_MIN, MODIFIER_MAX);
}

/**
 * Apply trait modifiers to a baseline personality.
 * Modifiers are bounded to [-0.3, +0.3] and final values are clamped to [0, 1].
 *
 * @param baseline - The NPC's baseline personality (Big Five)
 * @param modifiers - Partial modifiers to apply
 * @returns New personality with modifiers applied
 */
export function applyTraitModifiers(
  baseline: PersonalityBaseline,
  modifiers: TraitModifiers
): PersonalityBaseline {
  const result: PersonalityBaseline = { ...baseline };

  for (const trait of TRAIT_NAMES) {
    const modifier = modifiers[trait];
    if (modifier !== undefined) {
      const clampedModifier = clampModifier(modifier);
      result[trait] = clampTrait(baseline[trait] + clampedModifier);
    }
  }

  logger.debug({ modifiers, result }, 'Trait modifiers applied');

  return result;
}

/**
 * Calculate the difference between current and baseline personality.
 * Useful for tracking drift over time.
 */
export function calculateTraitDrift(
  baseline: PersonalityBaseline,
  current: PersonalityBaseline
): TraitModifiers {
  const drift: TraitModifiers = {};

  for (const trait of TRAIT_NAMES) {
    const difference = current[trait] - baseline[trait];
    if (Math.abs(difference) > 0.001) {
      drift[trait] = difference;
    }
  }

  return drift;
}

/**
 * Mood influence configuration
 */
export interface MoodInfluence {
  /** How valence affects behavior descriptions */
  valenceEffect: string;
  /** How arousal affects behavior descriptions */
  arousalEffect: string;
  /** How dominance affects behavior descriptions */
  dominanceEffect: string;
}

/**
 * Get mood influence descriptions based on current mood vector.
 * These are used to color the NPC's behavior in the prompt.
 */
export function getMoodInfluence(mood: MoodVector): MoodInfluence {
  const influence: MoodInfluence = {
    valenceEffect: '',
    arousalEffect: '',
    dominanceEffect: '',
  };

  // Valence: positive/negative affect
  if (mood.valence > 0.5) {
    influence.valenceEffect = 'feeling positive and pleasant';
  } else if (mood.valence > 0.2) {
    influence.valenceEffect = 'feeling generally okay';
  } else if (mood.valence > -0.2) {
    influence.valenceEffect = 'feeling neutral';
  } else if (mood.valence > -0.5) {
    influence.valenceEffect = 'feeling somewhat down';
  } else {
    influence.valenceEffect = 'feeling negative or upset';
  }

  // Arousal: energy level
  if (mood.arousal > 0.7) {
    influence.arousalEffect = 'highly alert and energized';
  } else if (mood.arousal > 0.4) {
    influence.arousalEffect = 'moderately engaged';
  } else {
    influence.arousalEffect = 'calm and subdued';
  }

  // Dominance: sense of control
  if (mood.dominance > 0.7) {
    influence.dominanceEffect = 'feeling in control and confident';
  } else if (mood.dominance > 0.4) {
    influence.dominanceEffect = 'feeling balanced';
  } else {
    influence.dominanceEffect = 'feeling uncertain or vulnerable';
  }

  return influence;
}

/**
 * Format mood for prompt injection
 */
export function formatMoodForPrompt(mood: MoodVector): string {
  const influence = getMoodInfluence(mood);

  return `Current emotional state:
- Valence (pleasure): ${mood.valence.toFixed(2)} - ${influence.valenceEffect}
- Arousal (energy): ${mood.arousal.toFixed(2)} - ${influence.arousalEffect}
- Dominance (control): ${mood.dominance.toFixed(2)} - ${influence.dominanceEffect}`;
}

/**
 * Big Five trait descriptions for prompt generation
 */
const TRAIT_DESCRIPTIONS: Record<keyof PersonalityBaseline, { low: string; high: string }> = {
  openness: {
    low: 'practical and conventional, preferring familiar routines',
    high: 'curious and imaginative, open to new experiences',
  },
  conscientiousness: {
    low: 'flexible and spontaneous, sometimes disorganized',
    high: 'disciplined and organized, focused on goals',
  },
  extraversion: {
    low: 'reserved and introspective, preferring solitude',
    high: 'outgoing and energetic, enjoying social interaction',
  },
  agreeableness: {
    low: 'skeptical and competitive, sometimes challenging',
    high: 'cooperative and trusting, prioritizing harmony',
  },
  neuroticism: {
    low: 'emotionally stable and calm, resilient to stress',
    high: 'emotionally reactive, prone to anxiety or mood swings',
  },
};

/**
 * Get a description for a single trait based on its value
 */
function getTraitDescription(trait: keyof PersonalityBaseline, value: number): string {
  const descriptions = TRAIT_DESCRIPTIONS[trait];

  if (value < 0.3) {
    return descriptions.low;
  } else if (value > 0.7) {
    return descriptions.high;
  } else {
    // Middle range - blend both
    return `balanced between being ${descriptions.low.split(',')[0]} and ${descriptions.high.split(',')[0]}`;
  }
}

/**
 * Generate a personality description for prompt injection.
 * Combines baseline traits with any modifiers for a complete picture.
 *
 * @param baseline - Base personality traits
 * @param modifiers - Optional trait modifiers from experiences
 * @returns Human-readable personality description
 */
export function generatePersonalityDescription(
  baseline: PersonalityBaseline,
  modifiers?: TraitModifiers
): string {
  // Apply modifiers if present
  const active = modifiers ? applyTraitModifiers(baseline, modifiers) : baseline;

  const descriptions: string[] = [];

  for (const trait of TRAIT_NAMES) {
    const value = active[trait];
    const description = getTraitDescription(trait, value);
    descriptions.push(`- ${capitalize(trait)}: ${description}`);
  }

  // Add note about modifiers if significant
  if (modifiers) {
    const significantChanges = Object.entries(modifiers)
      .filter(([, value]) => Math.abs(value as number) > 0.1)
      .map(([trait, value]) => {
        const direction = (value as number) > 0 ? 'increased' : 'decreased';
        return `${trait} has ${direction}`;
      });

    if (significantChanges.length > 0) {
      descriptions.push(`\nRecent experiences have shifted personality: ${significantChanges.join(', ')}.`);
    }
  }

  return descriptions.join('\n');
}

/**
 * Capitalize first letter
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Update trait modifiers based on an experience.
 * This is a building block for Persona Shift cycles.
 *
 * @param currentModifiers - Current trait modifiers
 * @param traitChanges - New changes to apply
 * @returns Updated modifiers (still bounded)
 */
export function updateTraitModifiers(
  currentModifiers: TraitModifiers,
  traitChanges: TraitModifiers
): TraitModifiers {
  const updated: TraitModifiers = { ...currentModifiers };

  for (const trait of TRAIT_NAMES) {
    const change = traitChanges[trait];
    if (change !== undefined) {
      const current = currentModifiers[trait] ?? 0;
      updated[trait] = clampModifier(current + change);
    }
  }

  logger.debug({ previous: currentModifiers, changes: traitChanges, updated }, 'Trait modifiers updated');

  return updated;
}

/**
 * Check if personality has drifted significantly from baseline.
 * Used for health monitoring and alerts.
 *
 * @param modifiers - Current trait modifiers
 * @param threshold - Drift threshold (default 0.25)
 * @returns True if any trait has drifted beyond threshold
 */
export function hasSignificantDrift(modifiers: TraitModifiers, threshold: number = 0.25): boolean {
  for (const trait of TRAIT_NAMES) {
    const modifier = modifiers[trait];
    if (modifier !== undefined && Math.abs(modifier) >= threshold) {
      logger.warn({ trait, modifier, threshold }, 'Significant personality drift detected');
      return true;
    }
  }

  return false;
}

/**
 * Calculate a composite mood score for sorting/comparison.
 * Higher scores indicate more positive, energized states.
 */
export function calculateMoodScore(mood: MoodVector): number {
  // Weighted combination favoring valence
  return mood.valence * 0.5 + mood.arousal * 0.25 + mood.dominance * 0.25;
}

/**
 * Blend two mood vectors with a given weight.
 *
 * @param current - Current mood
 * @param target - Target mood to blend toward
 * @param weight - Weight for target (0 = all current, 1 = all target)
 * @returns Blended mood vector
 */
export function blendMoods(current: MoodVector, target: MoodVector, weight: number): MoodVector {
  const w = clamp(weight, 0, 1);
  const inverse = 1 - w;

  return {
    valence: clamp(current.valence * inverse + target.valence * w, -1, 1),
    arousal: clamp(current.arousal * inverse + target.arousal * w, 0, 1),
    dominance: clamp(current.dominance * inverse + target.dominance * w, 0, 1),
  };
}
