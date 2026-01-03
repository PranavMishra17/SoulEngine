export interface SanitizationResult {
  sanitized: string;
  violations: string[];
  truncated: boolean;
}

export interface ModerationResult {
  action: 'none' | 'warn' | 'exit';
  flagged: boolean;
  reason?: string;
}

export interface SecurityContext {
  sanitized: boolean;
  moderated: boolean;
  rateLimited: boolean;
  exitRequested: boolean;
  /** Flags from moderation (reasons for flagging) */
  moderationFlags: string[];
  /** Violations from input sanitization */
  inputViolations: string[];
}

