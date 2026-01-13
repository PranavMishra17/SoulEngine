/**
 * Local Storage Module Index
 * 
 * This module provides all storage operations using local file system.
 * Used in development mode.
 */

// Re-export all storage functions
export * from './projects.js';
export * from './definitions.js';
export * from './instances.js';
export * from './knowledge.js';
export * from './mcp-tools.js';
export * from './secrets.js';

// Stub functions for image operations (local mode doesn't support Supabase storage)
export async function uploadNpcImage(
  _projectId: string,
  _npcId: string,
  _imageData: Buffer,
  _contentType: string
): Promise<string> {
  // In local mode, images are stored directly in the project folder
  // This is handled by the NPC routes
  throw new Error('Image upload via this function is not supported in local mode. Use the NPC routes instead.');
}

export async function deleteNpcImage(
  _projectId: string,
  _npcId: string
): Promise<void> {
  // In local mode, images are deleted directly from the project folder
  // This is handled by the NPC routes
}

export async function getNpcImageUrl(
  _projectId: string,
  _npcId: string
): Promise<string | null> {
  // In local mode, image URLs are constructed from the file path
  return null;
}

export async function deleteProjectImages(_projectId: string): Promise<void> {
  // In local mode, project images are deleted with the project folder
}

// Stub client functions for compatibility
export function getSupabaseAdmin(): never {
  throw new Error('Supabase is not available in local mode');
}

export function createUserClient(_accessToken: string): never {
  throw new Error('Supabase is not available in local mode');
}

export function verifyToken(_token: string): Promise<null> {
  // Always return null in local mode (no auth)
  return Promise.resolve(null);
}

export function isSupabaseEnabled(): boolean {
  return false;
}
