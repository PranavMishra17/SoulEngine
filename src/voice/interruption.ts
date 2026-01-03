import { createLogger } from '../logger.js';

const logger = createLogger('voice-interruption');

/**
 * State of an interruptible operation
 */
export type InterruptionState = 'idle' | 'processing' | 'interrupted' | 'completed';

/**
 * Callback for when interruption occurs
 */
export type InterruptionCallback = () => void | Promise<void>;

/**
 * InterruptionHandler manages the lifecycle of interruptible voice operations.
 *
 * It provides:
 * - AbortController management for cancellable operations
 * - State tracking (idle, processing, interrupted, completed)
 * - Callback hooks for cleanup on interruption
 */
export class InterruptionHandler {
  private state: InterruptionState = 'idle';
  private abortController: AbortController | null = null;
  private cleanupCallbacks: InterruptionCallback[] = [];
  private readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  /**
   * Start a new interruptible operation
   * @returns AbortSignal to pass to async operations
   */
  startOperation(): AbortSignal {
    if (this.state === 'processing') {
      logger.warn({ id: this.id }, 'Starting new operation while previous is still processing');
      this.interrupt(); // Clean up previous operation
    }

    this.abortController = new AbortController();
    this.state = 'processing';
    this.cleanupCallbacks = [];

    logger.debug({ id: this.id }, 'Started interruptible operation');
    return this.abortController.signal;
  }

  /**
   * Mark the current operation as completed
   */
  completeOperation(): void {
    if (this.state !== 'processing') {
      return;
    }

    this.state = 'completed';
    this.abortController = null;
    this.cleanupCallbacks = [];

    logger.debug({ id: this.id }, 'Operation completed');
  }

  /**
   * Interrupt the current operation
   */
  async interrupt(): Promise<void> {
    if (this.state !== 'processing') {
      logger.debug({ id: this.id, currentState: this.state }, 'No operation to interrupt');
      return;
    }

    logger.debug({ id: this.id }, 'Interrupting operation');

    // Abort the controller
    if (this.abortController) {
      this.abortController.abort();
    }

    // Run cleanup callbacks
    for (const callback of this.cleanupCallbacks) {
      try {
        await callback();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.warn({ id: this.id, error: message }, 'Cleanup callback failed');
      }
    }

    this.state = 'interrupted';
    this.abortController = null;
    this.cleanupCallbacks = [];

    logger.debug({ id: this.id }, 'Operation interrupted');
  }

  /**
   * Register a cleanup callback to run on interruption
   */
  onInterrupt(callback: InterruptionCallback): void {
    if (this.state === 'processing') {
      this.cleanupCallbacks.push(callback);
    }
  }

  /**
   * Check if the current operation is interrupted
   */
  isInterrupted(): boolean {
    return this.state === 'interrupted' || (this.abortController?.signal.aborted ?? false);
  }

  /**
   * Check if an operation is currently in progress
   */
  isProcessing(): boolean {
    return this.state === 'processing';
  }

  /**
   * Get current state
   */
  getState(): InterruptionState {
    return this.state;
  }

  /**
   * Get the abort signal for the current operation (if any)
   */
  getSignal(): AbortSignal | null {
    return this.abortController?.signal ?? null;
  }

  /**
   * Reset to idle state
   */
  reset(): void {
    if (this.state === 'processing') {
      this.interrupt();
    }
    this.state = 'idle';
    this.abortController = null;
    this.cleanupCallbacks = [];
  }
}

/**
 * Create a new interruption handler
 */
export function createInterruptionHandler(id: string): InterruptionHandler {
  return new InterruptionHandler(id);
}

/**
 * Utility to check if an error is an AbortError
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'AbortError';
  }
  return false;
}

/**
 * Utility to wrap an async operation with interruption handling
 */
export async function withInterruption<T>(
  handler: InterruptionHandler,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T | null> {
  const signal = handler.startOperation();

  try {
    const result = await operation(signal);
    handler.completeOperation();
    return result;
  } catch (error) {
    if (isAbortError(error)) {
      // Expected interruption
      return null;
    }
    handler.completeOperation();
    throw error;
  }
}
