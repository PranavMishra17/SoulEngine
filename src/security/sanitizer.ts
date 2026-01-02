import { SanitizationResult } from '../types/security.js';
import { getConfig } from '../config.js';
import { createLogger } from '../logger.js';

const logger = createLogger('sanitizer');

const INJECTION_PATTERNS = [
  /<script[^>]*>.*?<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /eval\s*\(/gi,
  /expression\s*\(/gi,
  /vbscript:/gi,
  /data:text\/html/gi,
];

export function sanitize(input: string): SanitizationResult {
  const config = getConfig();
  const maxLength = config.security.maxInputLength;
  const violations: string[] = [];
  let sanitized = input;

  if (sanitized.length > maxLength) {
    violations.push(`Input length ${sanitized.length} exceeds maximum ${maxLength}`);
    sanitized = sanitized.substring(0, maxLength);
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      violations.push(`Injection pattern detected: ${pattern.source}`);
      sanitized = sanitized.replace(pattern, '');
    }
  }

  if (violations.length > 0) {
    logger.warn({ violations, inputLength: input.length }, 'Input sanitization violations detected');
  }

  return {
    sanitized,
    violations,
    truncated: input.length > maxLength,
  };
}

