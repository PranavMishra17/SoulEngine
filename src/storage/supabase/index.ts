/**
 * Supabase Storage Module Index
 * 
 * This module provides all storage operations using Supabase as the backend.
 * Used in production mode.
 */

// Re-export all storage functions
export * from './projects.js';
export * from './definitions.js';
export * from './instances.js';
export * from './knowledge.js';
export * from './mcp-tools.js';
export * from './secrets.js';
export * from './images.js';

// Export client utilities
export { getSupabaseAdmin, createUserClient, verifyToken, isSupabaseEnabled } from './client.js';
