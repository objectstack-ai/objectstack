// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import type { IDataDriver } from '@objectstack/spec/contracts';
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
  name: string;
  version = '1.0.0';
  writes: RecordedWrite[] = [];
  /** Raw commands `execute()` actually RAN — the escape hatch is forwarded, not refused. */
  executed: unknown[] = [];
  /** Immediate DDL that actually RAN — `dropTable()` / `rotateShards()` are forwarded, not refused (#14126). */
  ddl: RecordedWrite[] = [];

  constructor(name = 'recording') {
    this.name = name;
  }

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

  /** `IDataDriver.dropTable` — immediate DDL, forwarded (#14126). */
  async dropTable(object: string): Promise<void> {
    this.ddl.push({ method: 'dropTable', object });
  }

  /** driver-sql's `rotateShards(objectDef, nowMs)` — takes the object DEFINITION, not its name. */
  async rotateShards(
    objectDef: { name: string },
  ): Promise<{ object: string; current: string; shards: string[]; dropped: string[] }> {
    this.ddl.push({ method: 'rotateShards', object: objectDef.name });
    return { object: objectDef.name, current: `${objectDef.name}__r2026`, shards: [], dropped: [`${objectDef.name}__r2025`] };
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

/**
 * #14126 — the two boundaries the header census named after #13332 / PR
 * #14053, closed under ONE outcome-line rule.
 *
 * Residue 1: only the default datasource is published as `driver.*`; every
 * other driver reaches the engine through `engine.registerDriver` alone, and
 * the engine's driver map is private with no public enumerator. These cases
 * boot a REAL `ObjectQL` — the class `ObjectQLPlugin.init()` publishes as
 * `objectql` / `data` — behind stand-ins for the two seams that matter (the
 * engine plugin that publishes it, and the datasource plugin that registers
 * the default THROUGH it and then republishes it as `driver.*`), so the
 * shadow is measured on the instance the CLI boots, not on a fake.
 *
 * Residue 2: `dropTable()` / `rotateShards()` run `assertSchemaMutable`, not
 * the deferral, and execute immediately. They get `execute()`'s treatment.
 */
describe('the two named boundaries (#14126)', () => {
  const silentLogger = {
    debug() { /* silent */ }, info() { /* silent */ }, warn() { /* silent */ }, error() { /* silent */ },
  };
  const newEngine = () => new ObjectQL({ logger: silentLogger });
  /** The seam `DatasourceConnectionService.connect()` uses: straight to the engine. */
  const registerWith = (engine: ObjectQL, driver: RecordingDriver, isDefault = false): void => {
    engine.registerDriver(driver as unknown as IDataDriver, isDefault);
  };
  /** Declares an object, bound to `datasource` when given, the way a host's `init()` does. */
  const declare = (engine: ObjectQL, name: string, datasource?: string): void => {
    engine.registerObject({
      name,
      label: name,
      ...(datasource ? { datasource } : {}),
      fields: { name: { type: 'text', label: 'Name' } },
    } as unknown as Parameters<ObjectQL['registerObject']>[0]);
  };

  /** Stands in for `ObjectQLPlugin`: publishes the engine in `init()`, discovers `driver.*` in `start()`. */
  function enginePlugin(engine: ObjectQL): Plugin {
    return {
      name: 'com.objectstack.engine.objectql',
      version: '1.0.0',
      init: async (ctx: PluginContext) => {
        ctx.registerService('objectql', engine);
        ctx.registerService('data', engine);
      },
      start: async (ctx: PluginContext) => {
        for (const [name, service] of ctx.getServices().entries()) {
          if (name.startsWith('driver.')) engine.registerDriver(service);
        }
      },
    };
  }

  /**
   * Stands in for `DefaultDatasourcePlugin.init()`: registers the default
   * THROUGH the engine, then republishes the same instance as `driver.<name>`
   * — the real plugin's order, which is what leaves the engine already
   * holding the default when the guard's `init()` runs. `also` runs in the
   * same `init()`, i.e. BEFORE the guard arms.
   */
  function engineDatasourcePlugin(
    engine: ObjectQL,
    driver: RecordingDriver,
    also: (engine: ObjectQL) => void = () => { /* nothing else */ },
  ): Plugin {
    return {
      name: 'com.objectstack.runtime.default-datasource',
      version: '1.0.0',
      dependencies: ['com.objectstack.engine.objectql'],
      init: async (ctx: PluginContext) => {
        registerWith(engine, driver, true);
        ctx.registerService(`driver.${driver.name}`, driver);
        also(engine);
      },
    };
  }

  /**
   * cloud's shape for residue 1: a host plugin whose `init()` connects a
   * SECOND datasource the way `DatasourceConnectionService.connect()` does —
   * straight to `engine.registerDriver`, never `driver.*` — declares an
   * object bound to it, and writes to that object from a `kernel:ready` hook
   * through the engine's own routing. Plus a log-only hook, the shape that
   * must keep running.
   */
  function secondDatasourceHost(reporting: RecordingDriver, log: HookLog): Plugin {
    return {
      name: 'com.example.connects-a-second-datasource',
      version: '1.0.0',
      init: async (ctx: PluginContext) => {
        const engine = ctx.getService<ObjectQL>('objectql');
        registerWith(engine, reporting);
        declare(engine, 'report_row', reporting.name);
        ctx.hook('kernel:ready', async () => {
          log.ran.push('log-only:kernel:ready');
        });
        ctx.hook('kernel:ready', async () => {
          // objectql-mediated: the engine resolves `report_row` to the
          // instance it holds under `reporting`. `insert()` funnels into the
          // same private `getDriver()` and the same call-time `.create`
          // lookup on that instance.
          const driver = engine.getDriverForObject('report_row');
          expect(driver).toBe(reporting);
          await driver!.create('report_row', { name: 'from-kernel:ready' });
          log.ran.push('write:kernel:ready');
        });
      },
    };
  }

  it('RESIDUE 1 — POSITIVE CONTROL: without the guard, a write to an object bound to an engine-registered driver LANDS on a declaration boot', async () => {
    // The fixture must be able to write before a refusal means anything: the
    // same stack, declaration-composed, and no guard at all. This is also the
    // defect as shipped — the `driver.*` scan alone never saw `reporting`.
    const engine = newEngine();
    const dflt = new RecordingDriver();
    const reporting = new RecordingDriver('reporting');
    const log: HookLog = { ran: [] };
    const kernel = newKernel();

    await kernel.use(enginePlugin(engine));
    await kernel.use(engineDatasourcePlugin(engine, dflt));
    await kernel.use(composeForDeclarations(secondDatasourceHost(reporting, log)));
    await kernel.bootstrap();
    await kernel.shutdown();

    expect(reporting.writes).toEqual([{ method: 'create', object: 'report_row' }]);
    expect(log.ran).toContain('write:kernel:ready');
  });

  it('RESIDUE 1 — THE FIX: the engine instance is shadowed, the driver is armed AS it is registered, the SAME instance is held, and the write is refused and reported', async () => {
    const engine = newEngine();
    const dflt = new RecordingDriver();
    const reporting = new RecordingDriver('reporting');
    const log: HookLog = { ran: [] };
    const guard = createDeclarationBootWriteGuard();
    const kernel = newKernel();

    // The measurement the in-lane shape rests on, taken on the real class:
    // an ordinary extensible instance whose `registerDriver` resolves through
    // the prototype — nothing frozen, nothing copied.
    expect(Object.isFrozen(engine)).toBe(false);
    expect(Object.isExtensible(engine)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(engine, 'registerDriver')).toBeUndefined();
    expect(engine.registerDriver).toBe(ObjectQL.prototype.registerDriver);

    await kernel.use(enginePlugin(engine));
    await kernel.use(engineDatasourcePlugin(engine, dflt));
    await kernel.use(guard.plugin as Plugin);
    await kernel.use(composeForDeclarations(secondDatasourceHost(reporting, log)));
    await kernel.bootstrap();

    // One engine under two service names, shadowed ONCE — as an own property
    // on the instance, which is what every caller's call-time lookup finds.
    expect(guard.shadowedEngines).toEqual(['objectql']);
    expect(Object.getOwnPropertyDescriptor(engine, 'registerDriver')).toBeDefined();
    // The SAME instance was forwarded: the engine holds `reporting` itself,
    // not a wrapper — identity is what the engine's held-name rule decides on.
    expect(engine.getDriverByName('reporting')).toBe(reporting);
    expect(engine.getDefaultDriverName()).toBe('recording');

    // Nothing reached either driver…
    expect(reporting.writes).toEqual([]);
    expect(dflt.writes).toEqual([]);
    // …the hooks themselves still ran…
    expect(log.ran).toEqual(['log-only:kernel:ready', 'write:kernel:ready']);
    // …and the refusal is reported under the label of the path that reached
    // the driver — the engine, not a `driver.*` service it never had.
    expect(guard.refusals).toEqual([
      { driver: 'engine.reporting', method: 'create', object: 'report_row', count: 1 },
    ]);

    // HELD: nothing was forwarded and nothing refused the override, so the
    // claim prints — the same sentence the `driver.*` path prints.
    const note = guard.disarm();
    expect(note).toContain(
      'Refused 1 write(s) during the declaration boot — a plan writes nothing: create() on report_row.',
    );

    // disarm() gave the engine its prototype method back, and the driver its own.
    expect(guard.shadowedEngines).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(engine, 'registerDriver')).toBeUndefined();
    expect(engine.registerDriver).toBe(ObjectQL.prototype.registerDriver);
    expect(Object.getOwnPropertyDescriptor(reporting, 'create')).toBeUndefined();
    await reporting.create('report_row', { name: 'after-disarm' });
    expect(reporting.writes).toEqual([{ method: 'create', object: 'report_row' }]);

    await kernel.shutdown();
  });

  it('RESIDUE 1 — a driver the engine ALREADY held when the guard armed is armed too, through the object that resolves to it', async () => {
    // Registered from the plugin ordered BEFORE the guard — never through
    // `driver.*`, and before any shadow existed — with an object bound to it.
    // The guard reaches it through `getDriverForObject()`, the accessor the
    // engine makes public.
    const engine = newEngine();
    const dflt = new RecordingDriver();
    const archive = new RecordingDriver('archive');
    const guard = createDeclarationBootWriteGuard();
    const kernel = newKernel();

    const writer: Plugin = {
      name: 'com.example.writes-to-archive',
      version: '1.0.0',
      init: async (ctx: PluginContext) => {
        ctx.hook('kernel:bootstrapped', async () => {
          const ql = ctx.getService<ObjectQL>('objectql');
          await ql.getDriverForObject('archive_row')!.update('archive_row', 'id1', { name: 'closed' });
        });
      },
    };

    await kernel.use(enginePlugin(engine));
    await kernel.use(engineDatasourcePlugin(engine, dflt, (e) => {
      registerWith(e, archive);
      declare(e, 'archive_row', archive.name);
    }));
    await kernel.use(guard.plugin as Plugin);
    await kernel.use(composeForDeclarations(writer));
    await kernel.bootstrap();

    expect(archive.writes).toEqual([]);
    expect(guard.refusals).toEqual([
      { driver: 'engine.archive', method: 'update', object: 'archive_row', count: 1 },
    ]);
    expect(guard.disarm()).toContain('a plan writes nothing');
    await kernel.shutdown();
  });

  it('RESIDUE 1 — the driver.* default path is unchanged: the default keeps its driver.* label and is armed once, whichever caller reaches it', async () => {
    const engine = newEngine();
    const dflt = new RecordingDriver();
    const guard = createDeclarationBootWriteGuard();
    const kernel = newKernel();

    const writer: Plugin = {
      name: 'com.example.writes-to-the-default-both-ways',
      version: '1.0.0',
      init: async (ctx: PluginContext) => {
        ctx.hook('kernel:ready', async () => {
          // The two callers the instance guard covers, on one object: the
          // plugin resolving `driver.*` directly, and the engine routing to
          // the same instance.
          await ctx.getService<RecordingDriver>('driver.recording').create('sys_thing', {});
          const ql = ctx.getService<ObjectQL>('objectql');
          expect(ql.getDriverForObject('sys_thing')).toBe(dflt);
          await ql.getDriverForObject('sys_thing')!.create('sys_thing', {});
        });
      },
    };

    await kernel.use(enginePlugin(engine));
    await kernel.use(engineDatasourcePlugin(engine, dflt, (e) => declare(e, 'sys_thing')));
    await kernel.use(guard.plugin as Plugin);
    await kernel.use(composeForDeclarations(writer));
    await kernel.bootstrap();

    expect(dflt.writes).toEqual([]);
    // One label — the one it always had. The engine's view of the same
    // instance (already held as the default, and re-registered by the
    // discovery loop in Phase 2) neither re-armed nor relabelled it.
    expect(guard.refusals).toEqual([
      { driver: 'driver.recording', method: 'create', object: 'sys_thing', count: 2 },
    ]);
    expect(guard.disarm()).toContain(
      'Refused 2 write(s) during the declaration boot — a plan writes nothing: create() on sys_thing x2.',
    );
    await kernel.shutdown();
  });

  it('RESIDUE 2 — dropTable()/rotateShards() are FORWARDED and REPORTED, warned once per driver, and the outcome line is withheld', async () => {
    const driver = new RecordingDriver();
    const guard = createDeclarationBootWriteGuard();
    const kernel = newKernel();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* captured */ });
    const seen: unknown[] = [];

    const ddlCaller: Plugin = {
      name: 'com.example.issues-ddl-from-a-hook',
      version: '1.0.0',
      init: async (ctx: PluginContext) => {
        ctx.hook('kernel:ready', async () => {
          const d = ctx.getService<RecordingDriver>('driver.recording');
          seen.push(await d.dropTable('sys_old_table'));
          seen.push(await d.rotateShards({ name: 'sys_log' }));
          seen.push(await d.dropTable('sys_old_table'));
          // An in-run control: the guarded surface still refuses.
          await d.create('sys_thing', { name: 'refused' });
        });
      },
    };

    try {
      await kernel.use(datasourcePlugin(driver));
      await kernel.use(guard.plugin as Plugin);
      await kernel.use(composeForDeclarations(ddlCaller));
      await kernel.bootstrap();

      // FORWARDED: the real methods ran, and their own return values came back.
      expect(driver.ddl).toEqual([
        { method: 'dropTable', object: 'sys_old_table' },
        { method: 'rotateShards', object: 'sys_log' },
        { method: 'dropTable', object: 'sys_old_table' },
      ]);
      expect(seen).toEqual([
        undefined,
        { object: 'sys_log', current: 'sys_log__r2026', shards: [], dropped: ['sys_log__r2025'] },
        undefined,
      ]);
      // …while the contract surface was refused in the same boot.
      expect(driver.writes).toEqual([]);

      // COUNTED per driver/method/object — `rotateShards` names its object
      // through the DEFINITION it takes, not a string.
      expect(guard.immediateDdl).toEqual([
        { driver: 'driver.recording', method: 'dropTable', object: 'sys_old_table', count: 2 },
        { driver: 'driver.recording', method: 'rotateShards', object: 'sys_log', count: 1 },
      ]);

      // WARNED once per driver on stderr, not once per call.
      const ddlWarnings = warn.mock.calls
        .map(([m]) => m)
        .filter((m): m is string => typeof m === 'string' && m.includes('Immediate DDL'));
      expect(ddlWarnings).toHaveLength(1);
      expect(ddlWarnings[0]).toContain('dropTable() on sys_old_table called via driver.recording during the declaration boot');

      // REPORTED — and the claim WITHHELD, in the refusal half and everywhere else.
      const note = guard.disarm();
      expect(note).toContain('Refused 1 write(s) during the declaration boot: create() on sys_thing.');
      expect(note).toContain(
        'Immediate DDL was called 3 time(s) during the declaration boot '
        + '(dropTable() on sys_old_table via driver.recording x2, rotateShards() on sys_log via driver.recording)',
      );
      expect(note).toContain('those calls EXECUTED');
      expect(note).not.toContain('a plan writes nothing');
    } finally {
      warn.mockRestore();
      await kernel.shutdown();
    }
  });

  it('RESIDUE 2 — a forwarded DDL call with no refusal at all is still named: a boot that dropped a table is never a quiet boot', async () => {
    const driver = new RecordingDriver();
    const guard = createDeclarationBootWriteGuard();
    const kernel = newKernel();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* captured */ });

    const dropper: Plugin = {
      name: 'com.example.only-drops',
      version: '1.0.0',
      init: async (ctx: PluginContext) => {
        ctx.hook('kernel:listening', async () => {
          await ctx.getService<RecordingDriver>('driver.recording').dropTable('sys_old_table');
        });
      },
    };

    try {
      await kernel.use(datasourcePlugin(driver));
      await kernel.use(guard.plugin as Plugin);
      await kernel.use(composeForDeclarations(dropper));
      await kernel.bootstrap();

      expect(driver.ddl).toEqual([{ method: 'dropTable', object: 'sys_old_table' }]);
      const note = guard.disarm();
      // Before #14126 this boot produced NO note at all — indistinguishable
      // from a boot in which nothing happened.
      expect(note).not.toBeNull();
      expect(note).toContain('Immediate DDL was called 1 time(s) during the declaration boot (dropTable() on sys_old_table via driver.recording)');
      expect(note).not.toContain('writes nothing');
    } finally {
      warn.mockRestore();
      await kernel.shutdown();
    }
  });

  it('ONE RULE — a driver the guard could not arm is named and withholds the claim, even though every other write was refused', async () => {
    // A frozen instance refuses the own-property shadow; its PROTOTYPE methods
    // still run, so a write through it LANDS — and the run must say so rather
    // than print the claim over it.
    const dflt = new RecordingDriver();
    const frozen = Object.freeze(new RecordingDriver('frozen'));
    const guard = createDeclarationBootWriteGuard();
    const kernel = newKernel();

    const publishesBoth: Plugin = {
      name: 'com.objectstack.runtime.default-datasource',
      version: '1.0.0',
      init: async (ctx: PluginContext) => {
        ctx.registerService('driver.recording', dflt);
        ctx.registerService('driver.frozen', frozen);
      },
    };
    const writer: Plugin = {
      name: 'com.example.writes-to-both',
      version: '1.0.0',
      init: async (ctx: PluginContext) => {
        ctx.hook('kernel:ready', async () => {
          await ctx.getService<RecordingDriver>('driver.recording').create('sys_thing', {});
          await ctx.getService<RecordingDriver>('driver.frozen').create('sys_thing', {});
        });
      },
    };

    await kernel.use(publishesBoth);
    await kernel.use(guard.plugin as Plugin);
    await kernel.use(composeForDeclarations(writer));
    await kernel.bootstrap();

    expect(dflt.writes).toEqual([]);
    expect(frozen.writes).toEqual([{ method: 'create', object: 'sys_thing' }]); // landed — and said so below
    const note = guard.disarm();
    expect(note).toContain('Refused 1 write(s) during the declaration boot: create() on sys_thing.');
    expect(note).toContain('Could NOT guard ');
    expect(note).toContain('driver.frozen.create');
    expect(note).toContain('does NOT claim to have written nothing');
    expect(note).not.toContain('a plan writes nothing');
    await kernel.shutdown();
  });

  it('ONE RULE — an engine that refuses the shadow is named and withholds the claim', async () => {
    class SealedEngine {
      registerDriver(_driver: unknown): void { /* a host engine the guard cannot shadow */ }
    }
    const engine = Object.freeze(new SealedEngine());
    const driver = new RecordingDriver();
    const guard = createDeclarationBootWriteGuard();
    const kernel = newKernel();

    const publishesEngine: Plugin = {
      name: 'com.example.publishes-a-sealed-engine',
      version: '1.0.0',
      init: async (ctx: PluginContext) => { ctx.registerService('objectql', engine); },
    };
    const writer: Plugin = {
      name: 'com.example.writes-to-the-default',
      version: '1.0.0',
      init: async (ctx: PluginContext) => {
        ctx.hook('kernel:ready', async () => {
          await ctx.getService<RecordingDriver>('driver.recording').create('sys_thing', {});
        });
      },
    };

    await kernel.use(publishesEngine);
    await kernel.use(datasourcePlugin(driver));
    await kernel.use(guard.plugin as Plugin);
    await kernel.use(composeForDeclarations(writer));
    await kernel.bootstrap();

    expect(guard.shadowedEngines).toEqual([]);
    expect(driver.writes).toEqual([]);
    const note = guard.disarm();
    expect(note).toContain('Refused 1 write(s) during the declaration boot: create() on sys_thing.');
    expect(note).toContain('Could NOT shadow objectql.registerDriver');
    expect(note).not.toContain('a plan writes nothing');
    await kernel.shutdown();
  });

  it('POSITIVE CONTROL — an embedder with no data plane and read/log-only hooks: nothing to arm, nothing to report, hooks untouched', async () => {
    const guard = createDeclarationBootWriteGuard();
    const kernel = newKernel();
    const log: HookLog = { ran: [] };

    const logOnly: Plugin = {
      name: 'com.example.only-logs',
      version: '1.0.0',
      init: async (ctx: PluginContext) => {
        for (const phase of ['kernel:ready', 'kernel:bootstrapped', 'kernel:listening'] as const) {
          ctx.hook(phase, async () => { log.ran.push(`log-only:${phase}`); });
        }
      },
      start: async () => { log.ran.push('start'); },
    };

    await kernel.use(guard.plugin as Plugin);
    await kernel.use(composeForDeclarations(logOnly));
    await kernel.bootstrap();

    expect(guard.shadowedEngines).toEqual([]);
    expect(guard.refusals).toEqual([]);
    expect(guard.rawExecutions).toEqual([]);
    expect(guard.immediateDdl).toEqual([]);
    expect(log.ran).toEqual(['log-only:kernel:ready', 'log-only:kernel:bootstrapped', 'log-only:kernel:listening']);
    // No note at all: a quiet boot renders byte-identically to before any of this existed.
    expect(guard.disarm()).toBeNull();
    await kernel.shutdown();
  });
});
