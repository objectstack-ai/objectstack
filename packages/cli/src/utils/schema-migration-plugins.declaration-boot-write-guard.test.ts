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
 * A driver with the row-write surface of `IDataDriver`, recording what it
 * was asked to do. Methods live on the PROTOTYPE, like every real driver's, so
 * the guard is exercised against the shape it actually meets: an own property
 * shadowing a prototype method, restored by `delete` rather than by rewrite.
 */
class RecordingDriver {
  name = 'recording';
  version = '1.0.0';
  writes: RecordedWrite[] = [];
  /** Raw commands `execute()` actually RAN — the escape hatch is forwarded, not refused. */
  executed: unknown[] = [];

  async execute(command: unknown): Promise<unknown> {
    this.executed.push(command);
    return { ran: command };
  }

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

    // The refusal is reported, per phase, rather than swallowed — and with no
    // raw execute() forwarded this run, the outcome claim HELD and is printed.
    const note = guard.disarm();
    expect(note).toContain('Refused 3 write(s)');
    expect(note).toContain('a plan writes nothing');
    expect(note).toContain('create() on sys_ai_model x3');

    await kernel.shutdown();
  });

  it('execute() — the contract\'s raw escape hatch — is FORWARDED and REPORTED, never silent (#14053 R1)', async () => {
    // `execute()` is a REQUIRED member of `IDataDriver`
    // (`packages/spec/src/contracts/data-driver.ts`, "Raw Execution (Escape
    // Hatch)") — not a driver-sql extension. The guard cannot classify a raw
    // command as read-vs-write (the contract admits any native shape), so it
    // must not refuse — but the one unacceptable outcome is the SILENT one: a
    // raw write landing while the run claims "a plan writes nothing". This
    // pins all three properties: forwarded, counted, and the claim dropped.
    const driver = new RecordingDriver();
    const guard = createDeclarationBootWriteGuard();
    const kernel = newKernel();
    const seen: unknown[] = [];
    const RAW = "INSERT INTO sys_metadata (id) VALUES ('landed')";

    const rawCaller: Plugin = {
      name: 'com.example.calls-execute',
      version: '1.0.0',
      init: async (ctx: PluginContext) => {
        ctx.hook('kernel:ready', async () => {
          const d = ctx.getService<RecordingDriver>('driver.recording');
          seen.push(await d.execute(RAW));
          // An in-run control: the guarded surface still refuses.
          await d.create('sys_thing', { name: 'refused' });
        });
      },
    };

    await kernel.use(datasourcePlugin(driver));
    await kernel.use(guard.plugin as Plugin);
    await kernel.use(composeForDeclarations(rawCaller));
    await kernel.bootstrap();

    // FORWARDED: the real driver ran the raw command, and its own return
    // value came back to the caller.
    expect(driver.executed).toEqual([RAW]);
    expect(seen).toEqual([{ ran: RAW }]);
    // …while the contract surface was refused in the same boot.
    expect(driver.writes).toEqual([]);

    // COUNTED, per driver, on the guard's own surface.
    expect(guard.rawExecutions).toEqual([{ driver: 'driver.recording', count: 1 }]);

    // REPORTED — and the flat claim is DROPPED: neither the refusal half nor
    // any other part of the note may print "a plan writes nothing" over a run
    // in which a raw command went through unclassified.
    const note = guard.disarm();
    expect(note).toContain('Refused 1 write(s) during the declaration boot:');
    expect(note).toContain('Raw execute() was called 1 time(s) during the declaration boot');
    expect(note).toContain('1 via driver.recording');
    expect(note).not.toContain('a plan writes nothing');

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
    const beforeExecute = Object.getPrototypeOf(driver).execute;

    await kernel.use(datasourcePlugin(driver));
    await kernel.use(guard.plugin as Plugin);
    await kernel.bootstrap();

    expect(Object.getOwnPropertyDescriptor(driver, 'create')).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(driver, 'execute')).toBeDefined();
    // Nothing was refused and no raw execute() was CALLED (the forwarding
    // shadow was installed, but installation alone is not an event) — so no
    // note at all, and a quiet boot renders byte-identically to before.
    expect(guard.disarm()).toBeNull();

    // The shadowing own properties are GONE, not overwritten with a copy: the
    // instance is back to resolving through its prototype.
    expect(Object.getOwnPropertyDescriptor(driver, 'create')).toBeUndefined();
    expect(driver.create).toBe(before);
    expect(Object.getOwnPropertyDescriptor(driver, 'execute')).toBeUndefined();
    expect(driver.execute).toBe(beforeExecute);

    await driver.create('sys_thing', {});
    expect(driver.writes).toEqual([{ method: 'create', object: 'sys_thing' }]);

    await kernel.shutdown();
  });
});
