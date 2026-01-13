import { getSupabaseAdmin } from './client.js';
import { createLogger } from '../../logger.js';
import { StorageError } from '../interface.js';

const logger = createLogger('supabase-images');

const BUCKET_NAME = 'npc-images';

/**
 * Upload an NPC profile image
 * @returns The public URL of the uploaded image
 */
export async function uploadNpcImage(
  projectId: string,
  npcId: string,
  imageData: Buffer,
  contentType: string
): Promise<string> {
  const startTime = Date.now();
  const supabase = getSupabaseAdmin();

  try {
    // Determine file extension from content type
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
    };
    
    const ext = extMap[contentType] || 'png';
    const filename = `${projectId}/${npcId}_profile.${ext}`;

    // Delete existing image first (if any)
    await supabase.storage
      .from(BUCKET_NAME)
      .remove([filename]);

    // Upload new image
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filename, imageData, {
        contentType,
        upsert: true,
      });

    if (error) {
      throw new StorageError(`Storage error: ${error.message}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filename);

    const duration = Date.now() - startTime;
    logger.info({ projectId, npcId, filename, duration }, 'NPC image uploaded');

    return urlData.publicUrl;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageError) throw error;
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, error: errorMessage, duration }, 'Failed to upload NPC image');
    throw new StorageError(`Failed to upload NPC image: ${errorMessage}`);
  }
}

/**
 * Delete an NPC profile image
 */
export async function deleteNpcImage(
  projectId: string,
  npcId: string
): Promise<void> {
  const startTime = Date.now();
  const supabase = getSupabaseAdmin();

  try {
    // List files matching the NPC ID pattern
    const { data: files, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list(projectId, {
        search: `${npcId}_profile`,
      });

    if (listError) {
      throw new StorageError(`Storage error: ${listError.message}`);
    }

    if (!files || files.length === 0) {
      logger.debug({ projectId, npcId }, 'No NPC image to delete');
      return;
    }

    // Delete all matching files
    const filesToDelete = files.map(f => `${projectId}/${f.name}`);
    
    const { error: deleteError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove(filesToDelete);

    if (deleteError) {
      throw new StorageError(`Storage error: ${deleteError.message}`);
    }

    const duration = Date.now() - startTime;
    logger.info({ projectId, npcId, filesDeleted: filesToDelete.length, duration }, 'NPC image deleted');
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageError) throw error;
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, npcId, error: errorMessage, duration }, 'Failed to delete NPC image');
    throw new StorageError(`Failed to delete NPC image: ${errorMessage}`);
  }
}

/**
 * Get the public URL for an NPC profile image
 */
export async function getNpcImageUrl(
  projectId: string,
  npcId: string
): Promise<string | null> {
  const supabase = getSupabaseAdmin();

  try {
    // List files matching the NPC ID pattern
    const { data: files, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(projectId, {
        search: `${npcId}_profile`,
      });

    if (error || !files || files.length === 0) {
      return null;
    }

    // Get public URL for the first matching file
    const filename = `${projectId}/${files[0].name}`;
    const { data } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filename);

    return data.publicUrl;
  } catch {
    return null;
  }
}

/**
 * Delete all images for a project
 */
export async function deleteProjectImages(projectId: string): Promise<void> {
  const startTime = Date.now();
  const supabase = getSupabaseAdmin();

  try {
    // List all files in the project folder
    const { data: files, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list(projectId);

    if (listError) {
      throw new StorageError(`Storage error: ${listError.message}`);
    }

    if (!files || files.length === 0) {
      logger.debug({ projectId }, 'No project images to delete');
      return;
    }

    // Delete all files
    const filesToDelete = files.map(f => `${projectId}/${f.name}`);
    
    const { error: deleteError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove(filesToDelete);

    if (deleteError) {
      throw new StorageError(`Storage error: ${deleteError.message}`);
    }

    const duration = Date.now() - startTime;
    logger.info({ projectId, filesDeleted: filesToDelete.length, duration }, 'Project images deleted');
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof StorageError) throw error;
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ projectId, error: errorMessage, duration }, 'Failed to delete project images');
    throw new StorageError(`Failed to delete project images: ${errorMessage}`);
  }
}
