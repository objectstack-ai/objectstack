// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4747] A one-shot CLI stack tears down through the KERNEL, and the ADR-0057
 * sweep stops with it.
 *
 * The bug this pins, end to end on the real `bootSchemaStack` path:
 *
 *   $ os migrate recorded-by --json      # exits 0, prints valid JSON …
 *   ERROR Find operation failed {"object":"sys_metadata", …}
 *   WARN  [integrity] dangling-reference audit could not list an object …
 *   WARN  [integrity] stored references that resolve to nothing (#4551)
 *         {"unreadableObjects":["sys_metadata","sys_view_definition"], …}
 *
 * Two silent no-ops stacked up to produce it. `shutdown()` called
 * `(runtime as any).stop?.()` and `Runtime` has no `stop`; the one thing that
 * would have disarmed the sweep was `ObjectQLPlugin.stop()`, a hook the kernel
 * never calls (the Plugin contract is `init`/`start`/`destroy`). So the kernel
 * stayed "running" with every timer armed while the command closed its driver,
 * and 60s later the sweep read a pool that was gone — filing both objects as
 * `unreadableObjects` on a completely healthy run.
 *
 * Two assertions matter here and they pull in opposite directions on purpose:
 *
 *  - while the engine is LIVE, the stack really does audit;
 *  - once the stack is torn down, the sweep issues no reads at all.
 *
 * ## [#21391] A one-shot boot arms no sweep at all
 *
 * The family ruling on #21391 took the sweep off every one-shot boot: it used
 * to be armed on an unref'd 60-second timer, so "a one-shot never sweeps" was a
 * timing fact, and a run longer than a minute did reap, rotate and audit in the
 * middle of a dry run. `bootSchemaStack` now passes `armLifecycleSweep: false`,
 * and `lifecycle.enabled` is the service's master switch, so the one-shot stack
 * neither arms the schedule nor answers an explicit `sweep()`. That is the
 * first case below. The two directions above, which are #4747's fix, are
 * pinned on the composition that still sweeps: the same standalone stack
 * booted without the one-shot policy, torn down through the same
 * `kernel.shutdown()` path.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootSchemaStack } from './schema-migrate.js';

// [#10126] Pay the first transform of this dist-resolved workspace dep at
// MODULE LOAD: the served composition reaches it through a dynamic `import()`
// inside a clocked `it()` body (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';

interface LifecycleServiceLike {
  stopped: boolean;
  /** The schedule's two timers. TypeScript-private, read on purpose: they ARE the arming. */
  initialTimer?: unknown;
  timer?: unknown;
  sweep(): Promise<{ danglingReferences?: { unreadableObjects: string[]; aborted?: boolean } }>;
}

describe('[#4747] bootSchemaStack teardown disarms the ADR-0057 sweep', () => {
  let dir: string;
  let dbFile: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-teardown-'));
    mkdirSync(join(dir, 'dist'), { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });
    dbFile = join(dir, 'data', 'app.db');
    writeFileSync(
      join(dir, 'dist', 'objectstack.json'),
      JSON.stringify({
        // #8687: manifest fields under `manifest:` — the flat spelling is refused.
        manifest: { id: 'com.example.teardown-smoke', name: 'Teardown Smoke', version: '0.0.0', type: 'app' },
        objects: [
          {
            name: 'td_note',
            fields: {
              title: { type: 'text', required: true },
              // A real reference field, so the audit has something to read
              // rather than skipping the object outright.
              owner: { type: 'lookup', reference: 'td_person' },
            },
          },
          { name: 'td_person', fields: { name: { type: 'text' } } },
        ],
      }),
    );
    savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  });

  afterAll(() => {
    process.env.OS_ARTIFACT_PATH = savedEnv.OS_ARTIFACT_PATH;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('a one-shot stack arms no sweep, and its teardown still closes the kernel and the pool (#21391)', async () => {
    const stack = await bootSchemaStack({ jsonOutput: false, databaseUrl: `file:${dbFile}`, projectRoot: dir });
    const lifecycle = stack.kernel.getService('lifecycle') as LifecycleServiceLike;
    expect(lifecycle).toBeTruthy();
    expect(lifecycle.initialTimer).toBeUndefined();
    expect(lifecycle.timer).toBeUndefined();
    // The master switch is off, so an explicit sweep is inert too.
    expect((await lifecycle.sweep()).danglingReferences).toBeUndefined();

    await stack.shutdown();
    expect(stack.kernel.isRunning()).toBe(false);
    expect(lifecycle.stopped).toBe(true);
    const engine = stack.kernel.getService('objectql') as {
      find(object: string, options: Record<string, unknown>): Promise<unknown[]>;
    };
    await expect(engine.find('td_note', { limit: 1, context: { isSystem: true } })).rejects.toThrow();
  }, 120_000);

  it('audits while the engine is live, and reads nothing once the stack is down', async () => {
    // The standalone stack WITHOUT the one-shot policy — the composition that
    // still sweeps — torn down through `kernel.shutdown()`, the path
    // `bootSchemaStack().shutdown()` takes since #4747.
    const { createStandaloneStack, Runtime } = await import('@objectstack/runtime');
    const served = await createStandaloneStack({ projectRoot: dir, databaseUrl: `file:${dbFile}`, skipSeedData: true });
    const runtime = new Runtime({ cluster: false });
    const kernel = runtime.getKernel();
    for (const plugin of served.plugins) await kernel.use(plugin as any);
    await runtime.start();
    const stack = { kernel, shutdown: async () => { await kernel.shutdown(); } };
    // Resolved BEFORE teardown — the point is what this same instance does
    // afterwards, and service resolution post-shutdown is not the subject.
    const lifecycle = stack.kernel.getService('lifecycle') as LifecycleServiceLike;
    expect(lifecycle).toBeTruthy();

    // ── While the engine is live: the audit runs for real ─────────────────
    // It reads, and reports a clean, COMPLETE run. An empty
    // `unreadableObjects` here is a fact about the database, which is
    // precisely what it stopped being before #4747.
    expect(lifecycle.stopped).toBe(false);
    const live = await lifecycle.sweep();
    expect(live.danglingReferences).toBeDefined();
    expect(live.danglingReferences!.unreadableObjects).toEqual([]);
    expect(live.danglingReferences!.aborted).toBe(false);

    // ── Teardown ──────────────────────────────────────────────────────────
    await stack.shutdown();

    // The kernel really shut down. `(runtime as any).stop?.()` left it running
    // and every plugin undestroyed, which is how a missing teardown managed to
    // look exactly like a performed one.
    expect(stack.kernel.isRunning()).toBe(false);
    expect(lifecycle.stopped).toBe(true);

    // The sweep the timer would have fired 60s later: no engine reads, so no
    // `ERROR Find operation failed` on a successful command, and no object
    // filed as unreadable for the crime of being asked after closing time.
    const afterDown = await lifecycle.sweep();
    expect(afterDown.danglingReferences).toBeUndefined();

    // …and this is not vacuous: the pool really is closed, so a read issued
    // here really would fail. The silence above is the fix, not an absence of
    // anything to read.
    const engine = stack.kernel.getService('objectql') as {
      find(object: string, options: Record<string, unknown>): Promise<unknown[]>;
    };
    await expect(engine.find('td_note', { limit: 1, context: { isSystem: true } })).rejects.toThrow();
  }, 120_000);
});
