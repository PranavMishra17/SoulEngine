import { createLogger } from '../logger.js';

const logger = createLogger('sentence-detector');

/**
 * Common abbreviations that should not trigger sentence breaks.
 * These patterns end with periods but are not sentence endings.
 */
const ABBREVIATIONS = new Set([
  // Titles
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'rev', 'hon', 'gen', 'col', 'lt', 'sgt',
  // Common abbreviations
  'st', 'ave', 'blvd', 'rd', 'apt', 'no', 'vs', 'etc', 'eg', 'ie', 'al', 'inc', 'ltd', 'co',
  // Time
  'am', 'pm',
  // Measurements
  'ft', 'in', 'oz', 'lb', 'kg', 'km', 'cm', 'mm', 'ml',
]);

/**
 * Sentence boundary detection patterns.
 * Order matters - more specific patterns should come first.
 */
const SENTENCE_ENDINGS = /([.!?;])\s+(?=[A-Z"'(])|([.!?;])$/;

/**
 * Pattern to detect if the buffer ends with a number followed by period.
 * These are often not sentence endings (e.g., "3.14", "version 2.0").
 */
const NUMBER_PERIOD_END = /\d+\.$/;

/**
 * Pattern to detect abbreviation at end of buffer.
 */
const ABBREVIATION_PERIOD_PATTERN = /\b([a-zA-Z]{1,4})\.$/i;

/**
 * Sentence detector for streaming LLM output.
 *
 * Accumulates text chunks and emits complete sentences for TTS synthesis.
 * Handles common edge cases like abbreviations and decimal numbers.
 */
export class SentenceDetector {
  private buffer: string = '';
  private readonly minSentenceLength: number;
  private readonly maxBufferLength: number;

  /**
   * @param minSentenceLength - Minimum characters before considering a sentence complete
   * @param maxBufferLength - Maximum buffer size before forcing output
   */
  constructor(minSentenceLength: number = 10, maxBufferLength: number = 500) {
    this.minSentenceLength = minSentenceLength;
    this.maxBufferLength = maxBufferLength;
  }

  /**
   * Add a text chunk from the LLM stream.
   *
   * @param chunk - Text chunk to process
   * @returns Array of complete sentences extracted from the buffer
   */
  addChunk(chunk: string): string[] {
    if (!chunk) {
      return [];
    }

    this.buffer += chunk;
    return this.extractSentences();
  }

  /**
   * Flush any remaining text from the buffer.
   * Called at end of LLM generation.
   *
   * @returns Remaining buffered text, or null if empty
   */
  flush(): string | null {
    const remaining = this.buffer.trim();
    this.buffer = '';

    if (remaining.length > 0) {
      logger.debug({ length: remaining.length }, 'Flushing remaining buffer');
      return remaining;
    }

    return null;
  }

  /**
   * Clear the buffer without returning content.
   * Used when interrupting generation.
   */
  clear(): void {
    if (this.buffer.length > 0) {
      logger.debug({ discardedLength: this.buffer.length }, 'Buffer cleared');
    }
    this.buffer = '';
  }

  /**
   * Get current buffer content (for debugging).
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Extract complete sentences from the buffer.
   */
  private extractSentences(): string[] {
    const sentences: string[] = [];

    // Force output if buffer is too large
    if (this.buffer.length > this.maxBufferLength) {
      const forcedSplit = this.forceSplit();
      if (forcedSplit) {
        sentences.push(forcedSplit);
      }
    }

    // Look for sentence boundaries
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    // Create a working copy of the pattern for exec
    const pattern = new RegExp(SENTENCE_ENDINGS.source, 'g');

    while ((match = pattern.exec(this.buffer)) !== null) {
      const potentialEnd = match.index + match[0].length;
      const potentialSentence = this.buffer.slice(lastIndex, potentialEnd).trim();

      // Validate this is a real sentence boundary
      if (this.isValidSentenceEnd(potentialSentence, match.index)) {
        if (potentialSentence.length >= this.minSentenceLength) {
          sentences.push(potentialSentence);
          lastIndex = potentialEnd;
        }
      }
    }

    // Update buffer to remaining text
    if (lastIndex > 0) {
      this.buffer = this.buffer.slice(lastIndex);
    }

    if (sentences.length > 0) {
      logger.debug(
        { sentenceCount: sentences.length, remainingBuffer: this.buffer.length },
        'Sentences extracted'
      );
    }

    return sentences;
  }

  /**
   * Check if a potential sentence ending is valid.
   * Filters out abbreviations and decimal numbers.
   */
  private isValidSentenceEnd(sentence: string, periodIndex: number): boolean {
    // Check for decimal numbers
    if (NUMBER_PERIOD_END.test(sentence)) {
      // Look ahead to see if there's more number coming
      const afterPeriod = this.buffer.slice(periodIndex + 1, periodIndex + 3);
      if (/^\d/.test(afterPeriod)) {
        return false; // Decimal number, not sentence end
      }
    }

    // Check for abbreviations
    const abbrevMatch = sentence.match(ABBREVIATION_PERIOD_PATTERN);
    if (abbrevMatch) {
      const potentialAbbrev = abbrevMatch[1].toLowerCase();
      if (ABBREVIATIONS.has(potentialAbbrev)) {
        return false; // Known abbreviation
      }
    }

    // Check for initials (single letter followed by period)
    if (/\b[A-Z]\.$/.test(sentence)) {
      // Could be initial (J. Smith) - check if next char is uppercase
      const nextChar = this.buffer[periodIndex + 2];
      if (nextChar && /[A-Z]/.test(nextChar)) {
        return false; // Likely an initial
      }
    }

    return true;
  }

  /**
   * Force a split when buffer is too large.
   * Tries to find a reasonable break point.
   */
  private forceSplit(): string | null {
    // Try to find a comma or other natural break point
    const breakPoints = [
      this.buffer.lastIndexOf(', ', this.maxBufferLength),
      this.buffer.lastIndexOf('; ', this.maxBufferLength),
      this.buffer.lastIndexOf(' - ', this.maxBufferLength),
      this.buffer.lastIndexOf(': ', this.maxBufferLength),
      this.buffer.lastIndexOf(' ', this.maxBufferLength),
    ];

    // Find the best break point (latest one that's valid)
    const bestBreak = Math.max(...breakPoints.filter((i) => i > this.minSentenceLength));

    if (bestBreak > 0) {
      const sentence = this.buffer.slice(0, bestBreak + 1).trim();
      this.buffer = this.buffer.slice(bestBreak + 1);
      logger.debug({ forcedLength: sentence.length }, 'Forced split at break point');
      return sentence;
    }

    // No good break point - split at max length
    const sentence = this.buffer.slice(0, this.maxBufferLength);
    this.buffer = this.buffer.slice(this.maxBufferLength);
    logger.warn({ length: sentence.length }, 'Hard split at max buffer length');
    return sentence;
  }
}

/**
 * Create a new sentence detector with default settings.
 */
export function createSentenceDetector(
  minSentenceLength?: number,
  maxBufferLength?: number
): SentenceDetector {
  return new SentenceDetector(minSentenceLength, maxBufferLength);
}
