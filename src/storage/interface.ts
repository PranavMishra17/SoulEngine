/**
 * Result of a storage operation that creates a versioned entity
 */
export interface StorageVersionResult {
  version: string;
  timestamp: string;
}

/**
 * A version entry in storage history
 */
export interface StorageVersion {
  version: string;
  timestamp: string;
  filename: string;
}

/**
 * Common storage error types
 */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export class StorageNotFoundError extends StorageError {
  constructor(entityType: string, id: string) {
    super(`${entityType} not found: ${id}`);
    this.name = 'StorageNotFoundError';
  }
}

export class StorageValidationError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = 'StorageValidationError';
  }
}

export class StorageLimitError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = 'StorageLimitError';
  }
}
