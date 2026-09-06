/**
 * ERR-024 — every player shared one NPC mind.
 *
 * Instance ids were derived as:
 *
 *     Buffer.from(`${npcId}:${playerId}`).toString('base64url').substring(0, 12)
 *
 * Twelve base64 characters encode nine bytes. The input begins with the NPC id
 * followed by a colon, which is already longer than nine bytes for any real id,
 * so the player id never reached the hash at all. Verified against live data:
 * `test-player`, `harness_player`, `someone_else` and an empty player all
 * produced `inst_bnBjX21qeHFr`, which decodes to the string "npc_mjxqk".
 *
 * Consequences, both P0:
 *   - Every player talking to an NPC shared its memories, mood, relationships
 *     and personality drift. In a shipped game each player would inherit every
 *     other player's history.
 *   - Two NPCs whose ids agree on their first nine characters collided with
 *     each other as well.
 *
 * Both storage backends carried the identical line.
 */
import { describe, it, expect } from 'vitest';
import { generateInstanceId, legacyInstanceId } from '../../src/storage/instance-id.js';

const NPC = 'npc_mjxqkqbn_18i72y';

describe('ERR-024: instance ids must distinguish players', () => {
  it('gives different players different instances', () => {
    const a = generateInstanceId(NPC, 'test-player');
    const b = generateInstanceId(NPC, 'harness_player');
    const c = generateInstanceId(NPC, 'someone_else');

    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('does not collapse an empty player id into a real one', () => {
    expect(generateInstanceId(NPC, '')).not.toBe(generateInstanceId(NPC, 'test-player'));
  });

  it('distinguishes NPCs that share a long id prefix', () => {
    // The old scheme truncated to nine bytes, so these were the same instance.
    const a = generateInstanceId('npc_mjxqkqbn_18i72y', 'p1');
    const b = generateInstanceId('npc_mjxqkzzz_999999', 'p1');

    expect(a).not.toBe(b);
  });

  it('is deterministic, because sessions rely on resolving the same instance', () => {
    expect(generateInstanceId(NPC, 'p1')).toBe(generateInstanceId(NPC, 'p1'));
  });

  it('keeps the id prefix so existing paths and logs stay readable', () => {
    expect(generateInstanceId(NPC, 'p1')).toMatch(/^inst_[0-9a-f]{16}$/);
  });
});

describe('ERR-024: the broken scheme is retained only for reading old data', () => {
  it('reproduces the exact id observed in live data', () => {
    expect(legacyInstanceId(NPC, 'test-player')).toBe('inst_bnBjX21qeHFr');
  });

  it('still shows the collision, which is why it is read-only', () => {
    // Pinned deliberately: this documents what the fallback has to tolerate.
    expect(legacyInstanceId(NPC, 'harness_player')).toBe(legacyInstanceId(NPC, 'test-player'));
  });
});
