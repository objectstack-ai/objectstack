// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import {
  composeForDeclarations,
  createDeclarationBootWriteGuard,
} from './schema-migration-plugins.js';

/**
 * #13332 — the declaration boot writes nothing, as a property of the
 * MECHANISM.
 *
 * `composeForDeclarations` suppresses a host plugin's `start()` and nothing
 * else, while `packages/core/src/kernel.ts` fires three phases unconditionally
 * after the suppressed start pass:
 *
 * ```
 * :402   Phase 3     trigger('kernel:ready')
 * :404   Phase 3.5   trigger('kernel:bootstrapped')
 * :416   Phase 4     trigger('kernel:listening')
 * ```
 *
 * A writing hook REGISTERED from `init()` survives the suppression on all
 * three. This file boots a REAL `ObjectKernel` — the same class
 * `bootSchemaStack` boots — with a recording driver, and pins both directions:
 *
 *  - the POSITIVE CONTROL first, because a green "no write" over a fixture
 *    that could not have written proves nothing. The same fixture plugin, on a
 *    boot composed the way a SERVED boot composes it, writes on every one of
 *    the three phases;
 *  - the declaration boot then refuses every one of those writes at the driver
 *    — while the log-only hooks the same plugin registered still run, which is
 *    the property this shape was chosen for over neutralising `init()` hooks.
 */

/** The row-write members of the data-driver contract, as the fixture exercises them. */
interface RecordedWrite {
  method: string;
  object: string;
}

/**
 * A driver with the row-write surface of `IDataSourceDriver`, recording what it
 * was asked to do. Methods live on the PROTOTYPE, like every real driver's, so
 * the guard is exercised against the shape it actually meets: an own property
 * shadowing a prototype method, restored by `delete` rather than by rewrite.
 */
class RecordingDriver {
  name = 'recording';
  version = '1.0.0';
  writes: RecordedWrite[] = [];

  async create(object: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.writes.push({ method: 'create', object });
    return { id: 'generated', ...data };
  }

  async update(object: string, id: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.writes.push({ method: 'update', object });
    return { ...data, id };
  }

  async upsert(object: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.writes.push({ method: 'upsert', object });
    return { id: 'generated', ...data };
  }

  async delete(object: string, _id: string): Promise<boolean> {
    this.writes.push({ method: 'delete', object });
    return true;
  }

  async bulkCreate(object: string, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    this.writes.push({ method: 'bulkCreate', object });
    return rows;
  }

  async bulkUpdate(
    object: string,
    updates: Array<{ id: string; data: Record<string, unknown> }>,
  ): Promise<Record<string, unknown>[]> {
    this.writes.push({ method: 'bulkUpdate', object });
    return updates.map((u) => ({ ...u.data, id: u.id }));
  }

  async bulkDelete(object: string, _ids: string[]): Promise<void> {
    this.writes.push({ method: 'bulkDelete', object });
  }

  async updateMany(object: string): Promise<number> {
    this.writes.push({ method: 'updateMany', object });
    return 1;
  }

  async deleteMany(object: string): Promise<number> {
    this.writes.push({ method: 'deleteMany', object });
    return 1;
  }

  /** A read, to prove the guard leaves the read half of the contract alone. */
  async find(_object: string): Promise<Record<string, unknown>[]> {
    return [];
  }
}

/**
 * Stands in for `DefaultDatasourcePlugin`: connects a driver in `init()` and
 * publishes it as `driver.<name>`, which is the surface `ObjectQLPlugin`'s
 * discovery loop and `os migrate`'s `findSqlDriver` both read.
 */
function datasourcePlugin(driver: RecordingDriver): Plugin {
  return {
    name: 'com.objectstack.runtime.default-datasource',
    version: '1.0.0',
    init: async (ctx: PluginContext) => {
      ctx.registerService(`driver.${driver.name}`, driver);
    },
  };
}

/** What the fixture host plugin recorded about its own hooks having run. */
interface HookLog {
  ran: string[];
}

/**
 * cloud's measured shape: a host plugin that registers its WRITING hook from
 * `init()` — on each of the three phases the kernel fires unconditionally
 * after the suppressed start pass — plus a log-only hook on each, the
 * `control-plane-email-guard` shape that must keep running.
 *
 * It also seeds from `start()`, the shape `composeForDeclarations` already
 * suppressed, so one fixture covers both halves.
 */
function writingHostPlugin(log: HookLog): Plugin {
  const PHASES = ['kernel:ready', 'kernel:bootstrapped', 'kernel:listening'] as const;
  return {
    name: 'com.example.writes-from-init',
    version: '1.0.0',
    init: async (ctx: PluginContext) => {
      for (const phase of PHASES) {
        ctx.hook(phase, async () => {
          log.ran.push(`log-only:${phase}`);
        });
        ctx.hook(phase, async () => {
          const driver = ctx.getService<RecordingDriver>('driver.recording');
          await driver.create('sys_ai_model', { name: `from-${phase}` });
          log.ran.push(`write:${phase}`);
        });
      }
    },
    start: async (ctx: PluginContext) => {
      const driver = ctx.getService<RecordingDriver>('driver.recording');
      await driver.create('sys_permission_set', { name: 'from-start' });
      log.ran.push('write:start');
    },
  };
}

const newKernel = () => new ObjectKernel({
  logger: { level: 'error' },
  gracefulShutdown: false,
  skipSystemValidation: true,
});

describe('the declaration boot writes nothing (#13332)', () => {
  it('POSITIVE CONTROL: the same fixture writes on every phase when nothing suppresses it', async () => {
    // A served boot: the host plugin composed as-is, no declaration wrapper and
    // no write guard. Without this leg, the assertion below would be green over
    // a fixture that could not have written in the first place.
    const driver = new RecordingDriver();
    const log: HookLog = { ran: [] };
    const kernel = newKernel();

    await kernel.use(datasourcePlugin(driver));
    await kernel.use(writingHostPlugin(log));
    await kernel.bootstrap();
    await kernel.shutdown();

    expect(driver.writes.map((w) => w.method + ':' + w.object)).toEqual([
      'create:sys_permission_set', // start()
      'create:sys_ai_model',       // kernel:ready
      'create:sys_ai_model',       // kernel:bootstrapped
      'create:sys_ai_model',       // kernel:listening
    ]);
    expect(log.ran).toContain('write:kernel:ready');
    expect(log.ran).toContain('write:kernel:bootstrapped');
    expect(log.ran).toContain('write:kernel:listening');
  });

  it('THE DEFECT: suppressing start() alone leaves all three phases writing', async () => {
    // The state of the world before this card: `composeForDeclarations` and
    // nothing else. `start()`'s seed is gone; the three `init()`-registered
    // hooks are untouched. This is the shape the guarantee was measured
    // against, so it is pinned rather than described.
    const driver = new RecordingDriver();
    const log: HookLog = { ran: [] };
    const kernel = newKernel();

    await kernel.use(datasourcePlugin(driver));
    await kernel.use(composeForDeclarations(writingHostPlugin(log)));
    await kernel.bootstrap();
    await kernel.shutdown();

    expect(log.ran).not.toContain('write:start');
    expect(driver.writes.map((w) => w.object)).toEqual([
      'sys_ai_model',
      'sys_ai_model',
      'sys_ai_model',
    ]);
  });

  it('THE FIX: the guard refuses every one of them, and the log-only hooks still run', async () => {
    const driver = new RecordingDriver();
    const log: HookLog = { ran: [] };
    const guard = createDeclarationBootWriteGuard();
    const kernel = newKernel();

    // The composition order `buildSchemaMigrationPlugins` produces: the guard
    // ahead of every host plugin, so its `init()` is ordered first.
    await kernel.use(datasourcePlugin(driver));
    await kernel.use(guard.plugin as Plugin);
    await kernel.use(composeForDeclarations(writingHostPlugin(log)));
    await kernel.bootstrap();

    // The whole point: nothing reached the driver.
    expect(driver.writes).toEqual([]);

    // …and the hooks themselves still RAN. This is what separates suppressing
    // the WRITE from neutralising the HOOK: a read/log-only hook keeps working
    // on the path an operator reads before a production apply.
    expect(log.ran).toEqual([
      'log-only:kernel:ready',
      'write:kernel:ready',
      'log-only:kernel:bootstrapped',
      'write:kernel:bootstrapped',
      'log-only:kernel:listening',
      'write:kernel:listening',
    ]);

    // The refusal is reported, per phase, rather than swallowed.
    const note = guard.disarm();
    expect(note).toContain('Refused 3 write(s)');
    expect(note).toContain('create() on sys_ai_model x3');

    await kernel.shutdown();
  });

  it('covers the whole row-write contract, not just create()', async () => {
    const driver = new RecordingDriver();
    const guard = createDeclarationBootWriteGuard();
    const kernel = newKernel();

    const exerciser: Plugin = {
      name: 'com.example.exercises-the-contract',
      version: '1.0.0',
      init: async (ctx: PluginContext) => {
        ctx.hook('kernel:bootstrapped', async () => {
          const d = ctx.getService<RecordingDriver>('driver.recording');
          await d.create('t', {});
          await d.update('t', 'id1', {});
          await d.upsert('t', {});
          await d.delete('t', 'id1');
          await d.bulkCreate('t', [{}]);
          await d.bulkUpdate('t', [{ id: 'id1', data: {} }]);
          await d.bulkDelete('t', ['id1']);
          await d.updateMany('t');
          await d.deleteMany('t');
          // A read, which must go straight through.
          await d.find('t');
        });
      },
    };

    await kernel.use(datasourcePlugin(driver));
    await kernel.use(guard.plugin as Plugin);
    await kernel.use(composeForDeclarations(exerciser));
    await kernel.bootstrap();

    expect(driver.writes).toEqual([]);
    expect(guard.refusals.map((r) => r.method).sort()).toEqual([
      'bulkCreate', 'bulkDelete', 'bulkUpdate',
      'create', 'delete', 'deleteMany',
      'update', 'updateMany', 'upsert',
    ]);

    guard.disarm();
    await kernel.shutdown();
  });

  it('a refused call hands back a contract-shaped value instead of throwing', async () => {
    // `context.trigger()` dispatches boot hooks PROPAGATING, so a throwing
    // refusal would abort the bootstrap and leave the operator with no plan at
    // all on the command whose job is to be read before a production apply.
    const driver = new RecordingDriver();
    const guard = createDeclarationBootWriteGuard();
    const kernel = newKernel();
    const seen: unknown[] = [];

    const reader: Plugin = {
      name: 'com.example.reads-back',
      version: '1.0.0',
      init: async (ctx: PluginContext) => {
        ctx.hook('kernel:ready', async () => {
          const d = ctx.getService<RecordingDriver>('driver.recording');
          seen.push(await d.create('sys_thing', { name: 'x' }));
          seen.push(await d.update('sys_thing', 'id1', { name: 'y' }));
          seen.push(await d.delete('sys_thing', 'id1'));
          seen.push(await d.deleteMany('sys_thing'));
        });
      },
    };

    await kernel.use(datasourcePlugin(driver));
    await kernel.use(guard.plugin as Plugin);
    await kernel.use(composeForDeclarations(reader));
    await kernel.bootstrap();

    expect(seen).toEqual([{ name: 'x' }, { name: 'y', id: 'id1' }, false, 0]);
    guard.disarm();
    await kernel.shutdown();
  });

  it('disarm() gives the driver its own methods back, byte for byte', async () => {
    // `apply` flushes the DDL the operator confirmed AFTER the bootstrap, and
    // the #13028 coverage pass runs there too. A guard left on would refuse the
    // one write these commands exist to make.
    const driver = new RecordingDriver();
    const guard = createDeclarationBootWriteGuard();
    const kernel = newKernel();

    const before = Object.getPrototypeOf(driver).create;

    await kernel.use(datasourcePlugin(driver));
    await kernel.use(guard.plugin as Plugin);
    await kernel.bootstrap();

    expect(Object.getOwnPropertyDescriptor(driver, 'create')).toBeDefined();
    expect(guard.disarm()).toBeNull(); // nothing was refused — no note at all

    // The shadowing own property is GONE, not overwritten with a copy: the
    // instance is back to resolving through its prototype.
    expect(Object.getOwnPropertyDescriptor(driver, 'create')).toBeUndefined();
    expect(driver.create).toBe(before);

    await driver.create('sys_thing', {});
    expect(driver.writes).toEqual([{ method: 'create', object: 'sys_thing' }]);

    await kernel.shutdown();
  });
});
