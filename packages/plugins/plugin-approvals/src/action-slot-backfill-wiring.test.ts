// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21411 — the action-slot backfill is WIRED: `ApprovalsServicePlugin.start()`
 * registers it on `kernel:ready`, hands it the plugin's own engine, and logs a
 * failure at `error`.
 *
 * `action-slot-backfill.integration.test.ts` proves what the repair does. This
 * file proves it runs at all — a repair module nothing calls is code `grep`
 * finds and production never executes, and every slot reader would then miss
 * the rows it exists to move, silently. The module is replaced by a spy so the
 * assertion is about the call, not about the repair.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const backfill = vi.hoisted(() => ({
  fn: vi.fn(async (_engine: unknown) => ({ literalsMoved: 0, sentinelsCleared: 0, votesStamped: 0 })),
}));

vi.mock('./action-slot-backfill.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./action-slot-backfill.js')>()),
  backfillActionSlots: backfill.fn,
}));

import { ApprovalsServicePlugin } from './approvals-plugin.js';

function fakeContext(engine: unknown) {
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const logged = { info: [] as string[], warn: [] as string[], error: [] as string[] };
  const ctx: any = {
    hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
    getService: (name: string) => {
      if (name === 'objectql') return engine;
      throw new Error(`no service '${name}'`);
    },
    registerService: () => {},
    logger: {
      info: (msg: string) => { logged.info.push(String(msg)); },
      warn: (msg: string) => { logged.warn.push(String(msg)); },
      error: (msg: string) => { logged.error.push(String(msg)); },
      debug: () => {},
    },
  };
  const fire = async (name: string) => { for (const fn of hooks[name] ?? []) await fn(); };
  return { ctx, fire, logged };
}

/**
 * Enough engine for `start()` with `disableAutoHooks`: the service only needs
 * an object to hold, and the one boot-time read that reaches it (the
 * approver-index rebuild) finds nothing. The repair itself is the spy above,
 * so nothing here writes — and a double with no write verbs makes no claim
 * about how writes dispatch.
 */
function fakeEngine() {
  return { find: async () => [] };
}

describe('the action-slot backfill is wired on kernel:ready (#21411)', () => {
  beforeEach(() => { backfill.fn.mockClear(); });

  it('runs once at kernel:ready, never before, against the plugin\'s own engine', async () => {
    const engine = fakeEngine();
    const { ctx, fire } = fakeContext(engine);
    await new ApprovalsServicePlugin({ disableAutoHooks: true }).start(ctx);

    expect(backfill.fn, 'not at start(): the registries are still filling').not.toHaveBeenCalled();
    await fire('kernel:ready');
    expect(backfill.fn).toHaveBeenCalledTimes(1);
    expect(backfill.fn.mock.calls[0][0]).toBe(engine);
  });

  it('a run that only cleared machine sentinels still reports what it wrote', async () => {
    backfill.fn.mockResolvedValueOnce({ literalsMoved: 0, sentinelsCleared: 2, votesStamped: 0 });
    const { ctx, fire, logged } = fakeContext(fakeEngine());
    await new ApprovalsServicePlugin({ disableAutoHooks: true }).start(ctx);
    await fire('kernel:ready');
    expect(logged.info.some((m) => m.includes('action slots backfilled'))).toBe(true);
  });

  it('a failed run is logged at error, naming what stays wrong and the fix', async () => {
    backfill.fn.mockRejectedValueOnce(new Error('driver went away'));
    const { ctx, fire, logged } = fakeContext(fakeEngine());
    await new ApprovalsServicePlugin({ disableAutoHooks: true }).start(ctx);
    await fire('kernel:ready');

    const line = logged.error.find((m) => m.includes('action-slot backfill failed'));
    expect(line, `error lines: ${JSON.stringify(logged.error)}`).toBeDefined();
    expect(line).toMatch(/multi-approver tallies/);
    expect(line).toMatch(/restart/);
    expect(logged.warn.some((m) => m.includes('action-slot backfill'))).toBe(false);
  });
});
