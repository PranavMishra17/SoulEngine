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

import * as fs from 'fs/promises';
import * as path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';

// Local file-based image storage
export async function uploadNpcImage(
  projectId: string,
  npcId: string,
  imageData: Buffer,
  contentType: string
): Promise<string> {
  // Determine file extension from content type
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  const ext = extMap[contentType] || 'png';
  const filename = `${npcId}_profile.${ext}`;

  const npcDir = path.join(DATA_DIR, 'projects', projectId, 'npcs');
  const filePath = path.join(npcDir, filename);

  // Ensure directory exists
  await fs.mkdir(npcDir, { recursive: true });

  // Delete old avatar files with different extensions
  try {
    const files = await fs.readdir(npcDir);
    for (const file of files) {
      if (file.startsWith(`${npcId}_profile.`) && file !== filename) {
        await fs.unlink(path.join(npcDir, file)).catch(() => {});
      }
    }
  } catch {
    // Directory may not exist yet
  }

  // Write the file
  await fs.writeFile(filePath, imageData);

  // Return the filename (not full URL in local mode)
  return filename;
}

export async function deleteNpcImage(
  projectId: string,
  npcId: string
): Promise<void> {
  const npcDir = path.join(DATA_DIR, 'projects', projectId, 'npcs');
  
  try {
    const files = await fs.readdir(npcDir);
    for (const file of files) {
      if (file.startsWith(`${npcId}_profile.`)) {
        await fs.unlink(path.join(npcDir, file)).catch(() => {});
      }
    }
  } catch {
    // Directory may not exist
  }
}

export async function getNpcImageUrl(
  projectId: string,
  npcId: string
): Promise<string | null> {
  const npcDir = path.join(DATA_DIR, 'projects', projectId, 'npcs');
  
  try {
    const files = await fs.readdir(npcDir);
    const imageFile = files.find(f => f.startsWith(`${npcId}_profile.`));
    if (imageFile) {
      return imageFile;
    }
  } catch {
    // Directory may not exist
  }
  
  return null;
}

export async function deleteProjectImages(projectId: string): Promise<void> {
  const npcDir = path.join(DATA_DIR, 'projects', projectId, 'npcs');
  
  try {
    const files = await fs.readdir(npcDir);
    for (const file of files) {
      if (file.includes('_profile.')) {
        await fs.unlink(path.join(npcDir, file)).catch(() => {});
      }
    }
  } catch {
    // Directory may not exist
  }
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
