import { ModerationResult } from '../types/security.js';
import { createLogger } from '../logger.js';

const logger = createLogger('moderator');

const BLOCKED_KEYWORDS = [
  'hack',
  'exploit',
  'cheat',
  'ddos',
  'spam',
];

const WARN_KEYWORDS = [
  'threat',
  'violence',
  'harass',
];

export async function moderate(input: string): Promise<ModerationResult> {
  const lowerInput = input.toLowerCase();

  for (const keyword of BLOCKED_KEYWORDS) {
    if (lowerInput.includes(keyword)) {
      logger.warn({ keyword, inputLength: input.length }, 'Content moderation: blocked keyword detected');
      return {
        action: 'exit',
        flagged: true,
        reason: `Blocked keyword: ${keyword}`,
      };
    }
  }

  for (const keyword of WARN_KEYWORDS) {
    if (lowerInput.includes(keyword)) {
      logger.warn({ keyword, inputLength: input.length }, 'Content moderation: warning keyword detected');
      return {
        action: 'warn',
        flagged: true,
        reason: `Warning keyword: ${keyword}`,
      };
    }
  }

  return {
    action: 'none',
    flagged: false,
  };
}

