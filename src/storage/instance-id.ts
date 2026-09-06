/**
 * How an NPC instance is addressed.
 *
 * An instance is one NPC's mind as it exists for one player: its memories,
 * mood, relationships and personality drift. The id must therefore depend on
 * both the NPC and the player, and must not collide across either.
 *
 * The previous scheme did neither. See ERR-024.
 */

import { createHash } from 'crypto';

/** Hex characters kept from the digest. 64 bits is far beyond collision range here. */
const ID_LENGTH = 16;

/**
 * Deterministic instance id for an (NPC, player) pair.
 *
 * Deterministic because sessions resolve an instance by recomputing this rather
 * than storing a pointer; the same pair must always land on the same mind.
 */
export function generateInstanceId(npcId: string, playerId: string): string {
  const digest = createHash('sha256').update(`${npcId}:${playerId}`).digest('hex');
  return `inst_${digest.slice(0, ID_LENGTH)}`;
}

/**
 * The superseded scheme, retained only so existing data can still be found.
 *
 * It base64-encoded `npcId:playerId` and truncated to twelve characters — nine
 * bytes — which for any real NPC id is consumed before reaching the colon. The
 * player id never influenced the result, so every player shared one instance,
 * and NPCs agreeing on their first nine characters shared one too.
 *
 * Never generate new ids with this. It exists for the read-side fallback, which
 * additionally verifies that the stored instance really does belong to the
 * player asking for it.
 */
export function legacyInstanceId(npcId: string, playerId: string): string {
  const hash = Buffer.from(`${npcId}:${playerId}`).toString('base64url').substring(0, 12);
  return `inst_${hash}`;
}
