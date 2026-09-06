/**
 * ERR-027 -- a background sweeper kept every short-lived process alive.
 *
 * `InMemoryCooldownStore` starts a 60-second cleanup interval in its
 * constructor, and `src/mcp/exit-handler.ts` constructs one at module load. A
 * referenced interval keeps Node's event loop alive, so importing the module --
 * which `src/conversation/turn.ts` does, and therefore anything that runs a
 * conversation turn -- meant the process never exited.
 *
 * The long-running server never noticed. `npm run eval` printed its whole
 * report and then hung, which is how this was found.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryCooldownStore } from '../../src/mcp/cooldown-store.js';

describe('ERR-027: the cooldown sweeper does not hold the process open', () => {
  it('leaves its cleanup timer unreferenced', () => {
    const store = new InMemoryCooldownStore() as unknown as {
      cleanupInterval: NodeJS.Timeout | null;
    };

    expect(store.cleanupInterval).not.toBeNull();
    expect(store.cleanupInterval!.hasRef()).toBe(false);
  });

  it('still expires entries it is holding', () => {
    const store = new InMemoryCooldownStore();

    store.set('a', Date.now() + 60_000);
    store.set('b', Date.now() - 1);

    expect(store.get('a')).not.toBeNull();
    expect(store.get('b')).toBeNull();
  });
});
