/**
 * Project Ownership Middleware
 *
 * Enforces tenant isolation by verifying that the authenticated user
 * owns the project they are trying to access.
 *
 * Security: Fail-closed approach
 * - When auth is enabled and user_id doesn't match project owner → 404
 * - When auth is disabled (local mode) → allow all access
 * - Returns 404 (not 403) to avoid leaking project existence
 */

import { Context } from 'hono';
import { createLogger } from '../logger.js';
import type { Project } from '../types/project.js';
import { isAuthEnabled } from './auth.js';

const logger = createLogger('ownership-middleware');

/**
 * Verify that the authenticated user owns the project.
 * Returns 404 if ownership check fails to avoid leaking project existence.
 *
 * @param project - The project to check ownership for
 * @param userId - The authenticated user ID (null if not authenticated)
 * @returns true if access is allowed, false otherwise
 */
export function verifyProjectOwnership(
  project: Project,
  userId: string | null
): boolean {
  // In local mode (no auth), allow all access
  if (!isAuthEnabled()) {
    return true;
  }

  // In authenticated mode, verify ownership
  // If project has no owner (shouldn't happen in Supabase mode), deny access
  if (!project.user_id) {
    logger.warn(
      { projectId: project.id, userId },
      'Project has no owner in authenticated mode'
    );
    return false;
  }

  // Check if the requesting user owns the project
  if (project.user_id !== userId) {
    logger.warn(
      { projectId: project.id, ownerId: project.user_id, requesterId: userId },
      'Project access denied: ownership mismatch'
    );
    return false;
  }

  return true;
}

/**
 * Middleware to verify project ownership.
 * Expects the project to already be loaded and set in context.
 *
 * Usage:
 *   1. Load the project in your route handler
 *   2. Call requireProjectOwnership(c, project) before proceeding
 *   3. Returns 404 response if ownership check fails
 */
export function requireProjectOwnership(
  c: Context,
  project: Project
): Response | null {
  const userId = c.get('userId');

  if (!verifyProjectOwnership(project, userId)) {
    // Return 404 to avoid leaking project existence
    return c.json({ error: 'Project not found' }, 404);
  }

  return null;
}
