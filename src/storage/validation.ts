/**
 * Shared validation utilities for storage backends
 */

/**
 * Validate NPC ID format
 *
 * NPC IDs must follow the format: npc_<segment1>_<segment2>
 * where each segment is lowercase alphanumeric.
 *
 * Examples:
 * - Valid: npc_abc123_def456
 * - Invalid: npc_onlyone (missing second segment)
 * - Invalid: npc_ABC_def (uppercase not allowed)
 * - Invalid: npc_abc_def_ghi (too many segments)
 */
export function isValidNpcId(npcId: string): boolean {
  return /^npc_[a-z0-9]+_[a-z0-9]+$/.test(npcId);
}

/**
 * Validate project ID format
 *
 * Project IDs must follow the format: proj_<alphanumeric>
 */
export function isValidProjectId(projectId: string): boolean {
  return /^proj_[a-z0-9]+$/.test(projectId);
}
