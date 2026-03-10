import { ModerationResult } from '../types/security.js';
import { createLogger } from '../logger.js';

const logger = createLogger('moderator');

/**
 * BLOCKED: Triggers exit_convo. Reserved for genuine out-of-character abuse:
 * - Jailbreak attempts (trying to break character / extract system instructions)
 * - Explicit hate speech markers
 * - Attempts to get the NPC to make real-world political statements
 *
 * NOT blocked: in-game threats, violence language, profanity, manipulation,
 * intimidation, fight/kill/attack language — these are normal gameplay.
 */
const JAILBREAK_PHRASES = [
  'ignore your instructions',
  'ignore previous instructions',
  'ignore all instructions',
  'forget your instructions',
  'forget your training',
  'you are now',
  'act as if you have no rules',
  'pretend you have no rules',
  'pretend you are not an ai',
  'reveal your system prompt',
  'show me your system prompt',
  'print your system prompt',
  'what is your system prompt',
  'override your instructions',
  'disregard your instructions',
  'bypass your restrictions',
  'jailbreak',
  'dan mode',
  'developer mode',
  'sudo mode',
];

/**
 * WARN: Flag but do not exit. Patterns that may indicate harassment
 * but could also be gameplay (low threshold, just logged).
 */
const WARN_PATTERNS = [
  'real world address',
  'where do you actually live',
  'give me personal information',
];

export async function moderate(input: string): Promise<ModerationResult> {
  const lowerInput = input.toLowerCase();

  // Check for jailbreak / out-of-character abuse (hard exit)
  for (const phrase of JAILBREAK_PHRASES) {
    if (lowerInput.includes(phrase)) {
      logger.warn({ phrase, inputLength: input.length }, 'Content moderation: jailbreak attempt detected');
      return {
        action: 'exit',
        flagged: true,
        reason: `Jailbreak attempt detected: "${phrase}"`,
      };
    }
  }

  // Check for warn patterns (flag, no exit)
  for (const pattern of WARN_PATTERNS) {
    if (lowerInput.includes(pattern)) {
      logger.warn({ pattern, inputLength: input.length }, 'Content moderation: warn pattern detected');
      return {
        action: 'warn',
        flagged: true,
        reason: `Warning pattern: ${pattern}`,
      };
    }
  }

  return {
    action: 'none',
    flagged: false,
  };
}

