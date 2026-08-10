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
 *  - while the engine is LIVE, a CLI-booted stack really does audit (this is
 *    not #4747's rejected option C — "one-shot commands skip the audit" would
 *    make it permanently blind exactly where an operator has no other tool);
 *  - once the stack is torn down, the sweep issues no reads at all.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootSchemaStack } from './schema-migrate.js';

interface LifecycleServiceLike {
  stopped: boolean;
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
        id: 'teardown_smoke',
        name: 'Teardown Smoke',
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

  it('audits while the engine is live, and reads nothing once the stack is down', async () => {
    const stack = await bootSchemaStack({ jsonOutput: false, databaseUrl: `file:${dbFile}`, projectRoot: dir });
    // Resolved BEFORE teardown — the point is what this same instance does
    // afterwards, and service resolution post-shutdown is not the subject.
    const lifecycle = stack.kernel.getService('lifecycle') as LifecycleServiceLike;
    expect(lifecycle).toBeTruthy();

    // ── While the engine is live: the audit runs for real ─────────────────
    // Not "the CLI skips the audit" — it reads, and reports a clean, COMPLETE
    // run. An empty `unreadableObjects` here is a fact about the database,
    // which is precisely what it stopped being before this fix.
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
