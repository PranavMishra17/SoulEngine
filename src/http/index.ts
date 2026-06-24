/**
 * HTTP utilities barrel export.
 *
 * Centralizes shared HTTP concerns:
 * - envelope: standard { error: { code, message } } response shape and ApiErrorCode enum
 * - pagination: consistent limit/cursor pagination parsing and response wrapping
 * - versioning: /api/v1 canonical path + /api deprecation alias
 */

export { ApiErrorCode, errorResponse } from './envelope.js';
export type { ApiErrorCode as ApiErrorCodeType, ApiErrorBody } from './envelope.js';

export { parsePagination, paginatedResponse } from './pagination.js';
export type { PaginationParams, PaginatedResult } from './pagination.js';

export { applyVersioning, API_VERSION } from './versioning.js';
