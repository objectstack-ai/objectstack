// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21498] On a real kernel, the boot scan reports an interrupted run with its
 * plan in hand, because the plan's OWNER registered it first.
 *
 * `migration-recovery-plugin.test.ts` pins the plugin against a fake context.
 * What it cannot see is the composition this card is about: the `migration-plans`
 * registry is this plugin's, but the plan in it comes from another package —
 * `@objectstack/metadata-protocol` owns `metadata.recorded-by-sentinel-to-null`
 * and hands it over from `assembleMetadataProtocol`, the seam every
 * `ObjectQLPlugin` kernel runs. Two kernel facts decide whether the scan sees
 * it: the registry is registered in this plugin's `init()`, which the kernel
 * orders AFTER the engine's, and the owner hands the plan over at
 * `kernel:ready`, where this plugin's scan also runs.
 *
 * So the pin boots the real chain — `ObjectQLPlugin` (and with it the
 * protocol assembly), `PlatformObjectsPlugin` (the journal object), this
 * plugin — over an in-memory SQLite database holding the journal rows a crash
 * inside chunk 0 leaves behind, and reads what the scan said:
 *
 *  - the run is reported, by id, at boot;
 *  - it is described as RESUMABLE (`Resume with: …`), not as owned by "no
 *    loaded plugin" — the owner's registration landed before the scan read
 *    the registry;
 *  - the registry hands the plan back after boot, which is the lookup
 *    `os migrate resume` makes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type MigrationPlanProvider, type PluginContext } from '@objectstack/core';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { RECORDED_BY_SENTINEL_PLAN_ID } from '@objectstack/metadata-protocol';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { DriverPlugin } from './driver-plugin.js';
import { MigrationRecoveryPlugin } from './migration-recovery-plugin.js';

const RUN_ID = 'run_21498_interrupted';
const SYSTEM = { context: { isSystem: true } };

/**
 * Writes the two journal rows a process killed inside chunk 0 leaves behind:
 * `run_started` and the autonomous `chunk_started(0)` — no `chunk_done`, no
 * `run_failed`. Runs in `start()`, after the engine's, so the rows exist
 * before `kernel:ready`; and it captures every warning the kernel logs.
 */
class InterruptedRunFixture {
  readonly name = 'test.migration-recovery.interrupted-run';
  readonly version = '1.0.0';
  readonly dependencies = ['com.objectstack.engine.objectql', 'com.objectstack.platform-objects'];
  readonly warnings: string[] = [];

  async init(ctx: PluginContext): Promise<void> {
    const logger = ctx.logger as { warn: (...args: unknown[]) => unknown };
    const warn = logger.warn.bind(logger);
    logger.warn = (...args: unknown[]) => {
      this.warnings.push(String(args[0]));
      return warn(...args);
    };
  }

  async start(ctx: PluginContext): Promise<void> {
    const ql = ctx.getService('objectql') as {
      insert: (object: string, data: Record<string, unknown>, options: unknown) => Promise<unknown>;
    };
    await ql.insert('sys_migration_journal', {
      run_id: RUN_ID,
      seq: 0,
      kind: 'run_started',
      plan_hash: 'h',
      detail: JSON.stringify({ planId: RECORDED_BY_SENTINEL_PLAN_ID, onCrash: 'resume', chunks: [] }),
      created_at: '2026-10-03T00:00:00.000Z',
    }, SYSTEM);
    await ql.insert('sys_migration_journal', {
      run_id: RUN_ID,
      seq: 1,
      kind: 'chunk_started',
      chunk_index: 0,
      attempt: 1,
      created_at: '2026-10-03T00:00:01.000Z',
    }, SYSTEM);
  }
}

describe('MigrationRecoveryPlugin on a real kernel — the owner registers before the scan (#21498)', () => {
  let kernel: ObjectKernel;
  const fixture = new InterruptedRunFixture();

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    await kernel.use(new DriverPlugin(new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    })));
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new PlatformObjectsPlugin() as never);
    await kernel.use(new MigrationRecoveryPlugin());
    await kernel.use(fixture as never);
    await kernel.bootstrap();
  });

  afterAll(async () => {
    if (kernel?.getState() === 'running') await kernel.shutdown();
  });

  it('reports the interrupted run at boot, as resumable', () => {
    const report = fixture.warnings.filter((w) => w.includes(`'${RUN_ID}'`));
    expect(report, fixture.warnings.join('\n')).toHaveLength(1);
    expect(report[0]).toContain(`plan '${RECORDED_BY_SENTINEL_PLAN_ID}'`);
    expect(report[0]).toContain(`Resume with: os migrate resume --run ${RUN_ID}`);
    expect(report[0]).not.toContain('No loaded plugin registers');
  });

  it('hands the plan back after boot — the lookup `os migrate resume` makes', () => {
    const plans = kernel.getService('migration-plans') as MigrationPlanProvider;
    expect(plans.get(RECORDED_BY_SENTINEL_PLAN_ID)?.id).toBe(RECORDED_BY_SENTINEL_PLAN_ID);
  });
});
