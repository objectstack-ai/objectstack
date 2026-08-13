// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End-to-end integration test for the record-change trigger (#1491).
 *
 * #1491 reported that record-change flows never fired on data writes (observed
 * 7.4.1–7.7.0). The existing unit tests only exercised a *fake* data engine, so
 * they never covered the real path: a flow pulled into the automation engine,
 * the trigger binding to an ObjectQL lifecycle hook on `kernel:ready`, an actual
 * insert firing that hook, and the flow's `update_record` writing back through
 * the live data engine. This test boots a real kernel (ObjectQL + automation +
 * record-change trigger + a real sqlite `:memory:` driver) and asserts the full
 * chain — in BOTH registration orderings, since the engine relies on
 * re-activating already-pulled flows when the trigger registers later.
 *
 * Backend note (#5704 批次 3 / #5785): the driver was a hand-written Map store
 * until this file was migrated to `@objectstack/driver-sql` + better-sqlite3
 * `:memory:`. #1491 was precisely a chain that "worked" in every unit test
 * because a fake sat where the real component belonged, so leaving the storage
 * hop faked was the one shortcut this file could least afford. The concrete
 * fidelity it buys here: a column that was never written now reads back as SQL
 * NULL out of a table whose DDL really ran, instead of `undefined` out of a Map
 * that only ever held keys somebody set.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import type { IDataEngine, IObjectQLEngine } from '@objectstack/spec/contracts';
import { RecordChangeTriggerPlugin } from './plugin.js';

/**
 * `check:slot-lookup` (#4251) — a NEW `kernel.getService(...)` site must carry
 * the slot's real contract type, never an `as any` erasure (this file's other
 * lookups predate the ratchet and are grandfathered by count, not by file —
 * see `scripts/slot-lookup-baseline.json`).
 *
 * `IObjectQLEngine` covers everything the `objectql` slot's PUBLISHED contract
 * promises. Two things the test below also calls are real, public methods on
 * the concrete `ObjectQL` engine but are deliberately NOT part of that
 * contract — `syncSchemas()` (a boot-time operation, not a slot consumer's
 * concern) and `registry.registerObject` (the registry's TEST-time seam;
 * `bulk-write-per-row-context.test.ts` in this same package casts the same
 * gap separately as `TestObjectRegistry`). Naming both here, once, keeps the
 * lookup itself fully typed rather than reaching back for `any`.
 */
type TestObjectQLEngine = IObjectQLEngine & {
  syncSchemas(): Promise<void>;
  registry: IObjectQLEngine['registry'] & {
    registerObject(schema: unknown, packageId?: string, namespace?: string): void;
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The real backend: better-sqlite3 `:memory:` through `@objectstack/driver-sql`,
 * built the canonical way (`examples/app-crm`, `cli db clean`, PR #5715). The
 * database lives and dies inside the process, so every `it` below gets a fresh
 * empty schema without touching the host filesystem.
 */
function makeSqliteDriver(): any {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

/** Every `:memory:` database opened by a test, closed when that test ends. */
const openDrivers: any[] = [];
afterEach(async () => {
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
  }
});

/**
 * Register the driver on an engine whose own `init()` already ran during
 * `kernel.bootstrap()` (that is what "the driver arrives late" means here), so
 * the connect the engine would have performed happens here instead. Each caller
 * then registers its objects and calls `syncSchemas()`.
 *
 * `syncSchemas()` is the production route for objects that become live after
 * boot; the Map store needed no counterpart because a collection materialised on
 * first write, which is exactly the difference this migration is buying.
 */
async function attachSqlite(objectql: any): Promise<any> {
  const driver = makeSqliteDriver();
  await driver.connect();
  objectql.registerDriver(driver, true);
  openDrivers.push(driver);
  return driver;
}

/** A flow that stamps `stamp: 'done'` on the just-created record of `object`. */
function stampFlow(name: string, object: string) {
  return {
    name,
    label: name,
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { objectName: object, triggerType: 'record-after-create' } },
      { id: 'stamp', type: 'update_record', label: 'Stamp', config: { objectName: object, filter: { id: '{record.id}' }, fields: { stamp: 'done' } } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'stamp' },
      { id: 'e2', source: 'stamp', target: 'end' },
    ],
  };
}

/**
 * A `record-after-write` flow (create OR update, #3427) that mirrors the
 * record's live `status` into `mirror` on every write. Its own update_record
 * write-back also fires afterUpdate, so this doubles as coverage that the
 * engine's re-entrancy guard suppresses the self-trigger loop a write flow now
 * exposes (afterUpdate IS bound, unlike a create-only flow).
 */
function mirrorWriteFlow(name: string, object: string) {
  return {
    name,
    label: name,
    type: 'record_change',
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { objectName: object, triggerType: 'record-after-write' } },
      { id: 'mirror', type: 'update_record', label: 'Mirror', config: { objectName: object, filter: { id: '{record.id}' }, fields: { mirror: '{record.status}' } } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'mirror' },
      { id: 'e2', source: 'mirror', target: 'end' },
    ],
  };
}

/**
 * A `record-after-write` flow whose START CONDITION uses the create/update
 * discrimination the write trigger enables (mirrors the showcase
 * `UrgentTaskAlertFlow`): fire when a record is created urgent (`previous == null`)
 * OR escalated to urgent (`previous.priority != 'urgent'`) — but NOT on a later
 * save while already urgent. Validates that `previous == null` is truthy on the
 * afterInsert leg (previous is absent on create) and that the engine's start-node
 * condition gate short-circuits before touching `previous.priority` there.
 */
function urgentAlertFlow(name: string, object: string) {
  return {
    name,
    label: name,
    type: 'record_change',
    nodes: [
      {
        id: 'start',
        type: 'start',
        label: 'Start',
        config: {
          objectName: object,
          triggerType: 'record-after-write',
          condition: "priority == 'urgent' && (previous == null || previous.priority != 'urgent')",
        },
      },
      { id: 'alert', type: 'update_record', label: 'Alert', config: { objectName: object, filter: { id: '{record.id}' }, fields: { alerted: 'yes' } } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'alert' },
      { id: 'e2', source: 'alert', target: 'end' },
    ],
  };
}

const objectDef = (name: string) => ({
  name,
  label: name,
  fields: {
    status: { name: 'status', label: 'S', type: 'text' },
    stamp: { name: 'stamp', label: 'St', type: 'text' },
    mirror: { name: 'mirror', label: 'M', type: 'text' },
    priority: { name: 'priority', label: 'P', type: 'text' },
    alerted: { name: 'alerted', label: 'A', type: 'text' },
  },
});

/**
 * #4953 (services half) — a `record-before-*` flow's `record` used to be
 * JUST the incoming patch (`inputData`, see `record-change-trigger.ts`
 * `buildContext`), never merged with the prior row and never materialized
 * over the object's declared fields. `tag` here is untouched by the update
 * below (only `note` is written), so BEFORE the fix `record.tag != null`
 * read a record with no `tag` key at all and FAULTED — the flow's own
 * error-isolation try/catch (`RecordChangeTrigger.start`'s handler) swallows
 * that fault, so the only observable symptom was "the flow silently never
 * fires", never a visible error.
 */
const beforeHookObjectDef = (name: string) => ({
  name,
  label: name,
  fields: {
    tag: { name: 'tag', label: 'Tag', type: 'text' },
    note: { name: 'note', label: 'Note', type: 'text' },
    // Declared, but never given a value anywhere below — the "genuinely no
    // value" case `materializeDeclaredFields` fills with an explicit `null`
    // rather than leaving it an absent (fault-on-access) key.
    nickname: { name: 'nickname', label: 'Nickname', type: 'text' },
  },
});

/**
 * #3760 — the fail-open this trigger was the dominant carrier of.
 *
 * `isSystem` does NOT suppress trigger dispatch (only `skipTriggers` does), and
 * the trigger forwards `session.userId` with no fallback. So a write made with a
 * system context — any plugin/service write, a `runAs:'system'` flow's own data
 * node — fires the record-change flows bound to that object with
 * `userId: undefined`. A flow left at the spec default
 * `runAs:'user'` then presented NO principal to ObjectQL, and the data security
 * middleware skips when there is no principal: the flow read and wrote every row.
 *
 * Nothing flags this at authoring time and nothing can — whether a given write
 * carries a user is only knowable at run time — so the runtime refusal is the
 * only net. This test drives the real kernel end-to-end rather than the seam, so
 * it fails if ANY link is re-opened: dispatch suppression, identity forwarding,
 * or the refusal itself.
 */
describe('a system write must not fire a record-change flow UNSCOPED (#3760)', () => {
  it("refuses the flow's data op when the triggering write carried isSystem and no user", async () => {
    const kernel = new ObjectKernel({ logLevel: 'silent' });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();

    const objectql = kernel.getService('objectql') as any;
    const data = kernel.getService('data') as any;
    const automation = kernel.getService<AutomationEngine>('automation');

    await attachSqlite(objectql);
    objectql.registry.registerObject(objectDef('sysw'), 'test', 'test');
    await objectql.syncSchemas();
    // No `runAs` — the spec default 'user'. This is the shape an author (very
    // often an AI) writes without realising it can run without a user.
    automation.registerFlow('sysw_stamp', stampFlow('sysw_stamp', 'sysw') as any);

    // A SYSTEM write: elevated, no userId, and NOT skipTriggers — so it still
    // dispatches. Elevation is not what makes it user-less; presenting no
    // principal is. A service that elevates *and* knows its actor can name one
    // (the approvals status mirror does since #3783) and lands in the scoped
    // branch instead — this is the shape that genuinely has nobody behind it.
    const created = await data.insert(
      'sysw',
      { status: 'new' },
      { context: { isSystem: true, positions: [], permissions: [] } },
    );
    const id = Array.isArray(created) ? created[0]?.id : created?.id ?? created;
    await sleep(200);

    // The flow's update_record must NOT have landed. Before #3760 `stamp` was
    // 'done' here — written by a run with no principal at all.
    //
    // "Never written" reads as SQL NULL, not `undefined`: the column exists
    // because the DDL declared it, and only a write puts a value in it. The Map
    // store had no column concept, so an unwritten key was simply absent — the
    // one place this migration changes the SHAPE of the answer rather than the
    // answer. The property under test is unchanged and is asserted exactly, not
    // loosened to `toBeFalsy()`: no value landed, and in particular not 'done'.
    const row = await data.findOne('sysw', { where: { id } });
    expect(row, 'the record itself must exist — only the flow write is refused').toBeTruthy();
    expect(row?.stamp ?? null, 'a user-less run wrote to the record — the fail-open is back').toBeNull();
  }, 15000);

  it('the same flow still works normally when a real user made the write', async () => {
    const kernel = new ObjectKernel({ logLevel: 'silent' });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();

    const objectql = kernel.getService('objectql') as any;
    const data = kernel.getService('data') as any;
    const automation = kernel.getService<AutomationEngine>('automation');

    await attachSqlite(objectql);
    objectql.registry.registerObject(objectDef('sysw2'), 'test', 'test');
    await objectql.syncSchemas();
    automation.registerFlow('sysw2_stamp', stampFlow('sysw2_stamp', 'sysw2') as any);

    const created = await data.insert('sysw2', { status: 'new' }, { context: { userId: 'u_trigger' } });
    const id = Array.isArray(created) ? created[0]?.id : created?.id ?? created;
    await sleep(200);

    // The refusal is scoped to the user-less case — it must not break the
    // ordinary record-change flow, which is the overwhelming majority.
    const row = await data.findOne('sysw2', { where: { id } });
    expect(row?.stamp).toBe('done');
  }, 15000);
});

describe('record-change trigger — end-to-end (#1491)', () => {
  it('fires a record-after-create flow registered AFTER the trigger (engine.registerFlow path)', async () => {
    const kernel = new ObjectKernel({ logLevel: 'silent' });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();

    const objectql = kernel.getService('objectql') as any;
    const data = kernel.getService('data') as any;
    const automation = kernel.getService<AutomationEngine>('automation');

    await attachSqlite(objectql);
    objectql.registry.registerObject(objectDef('wid'), 'test', 'test');
    await objectql.syncSchemas();
    automation.registerFlow('stamp_flow', stampFlow('stamp_flow', 'wid') as any);

    // The flow bound to the trigger…
    expect((automation as any).getActiveTriggerBindings()).toContainEqual({
      flowName: 'stamp_flow',
      triggerType: 'record_change',
    });

    const created = await data.insert('wid', { status: 'new' }, { context: { userId: 'u_trigger' } });
    const id = Array.isArray(created) ? created[0]?.id : created?.id ?? created;
    await sleep(200);

    const row = await data.findOne('wid', { where: { id } });
    expect(row?.stamp).toBe('done');
  }, 15000);

  it('fires a flow PULLED FROM THE REGISTRY at automation.start(), bound when the trigger registers on kernel:ready (production ordering)', async () => {
    const flowDef = stampFlow('stamp_flow2', 'wid2');

    // Seeds the driver + object + flow into the registry in start(), which runs
    // before AutomationServicePlugin.start() pulls flows — the production
    // sequence (metadata seeds → automation pulls → trigger binds on
    // kernel:ready via re-activation of the already-registered flow).
    const seeder = {
      name: 'test.seeder',
      type: 'standard',
      version: '1.0.0',
      dependencies: ['com.objectstack.engine.objectql'],
      async init() {},
      async start(ctx: any) {
        const ql = ctx.getService('objectql');
        await attachSqlite(ql);
        ql.registry.registerObject(objectDef('wid2'), 'test', 'test');
        ql.registry.registerItem('flow', flowDef, 'name', 'test');
        await ql.syncSchemas();
      },
    };

    const kernel = new ObjectKernel({ logLevel: 'silent' });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(seeder as any);
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();

    const data = kernel.getService('data') as any;
    const automation = kernel.getService<AutomationEngine>('automation');

    // The registry-pulled flow bound to the trigger after kernel:ready.
    expect((automation as any).getActiveTriggerBindings()).toContainEqual({
      flowName: 'stamp_flow2',
      triggerType: 'record_change',
    });

    const created = await data.insert('wid2', { status: 'new' }, { context: { userId: 'u_trigger' } });
    const id = Array.isArray(created) ? created[0]?.id : created?.id ?? created;
    await sleep(200);

    const row = await data.findOne('wid2', { where: { id } });
    expect(row?.stamp).toBe('done');
  }, 15000);

  it('a single record-after-write flow fires on BOTH create and update (#3427)', async () => {
    const kernel = new ObjectKernel({ logLevel: 'silent' });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();

    const objectql = kernel.getService('objectql') as any;
    const data = kernel.getService('data') as any;
    const automation = kernel.getService<AutomationEngine>('automation');

    await attachSqlite(objectql);
    objectql.registry.registerObject(objectDef('wid3'), 'test', 'test');
    await objectql.syncSchemas();
    automation.registerFlow('mirror_write', mirrorWriteFlow('mirror_write', 'wid3') as any);

    expect((automation as any).getActiveTriggerBindings()).toContainEqual({
      flowName: 'mirror_write',
      triggerType: 'record_change',
    });

    // Create — the afterInsert leg fires; the flow mirrors status → mirror.
    const created = await data.insert('wid3', { status: 'a' }, { context: { userId: 'u_trigger' } });
    const id = Array.isArray(created) ? created[0]?.id : created?.id ?? created;
    await sleep(200);
    expect((await data.findOne('wid3', { where: { id } }))?.mirror).toBe('a');

    // Update — the afterUpdate leg of the SAME flow fires; mirror re-syncs. (The
    // flow's own write-back does not loop: the re-entrancy guard suppresses it.)
    await data.update('wid3', { id, status: 'b' }, { context: { userId: 'u_trigger' } });
    await sleep(200);
    expect((await data.findOne('wid3', { where: { id } }))?.mirror).toBe('b');
  }, 15000);

  it('record-after-write start condition uses `previous == null` to discriminate create vs update (#3427)', async () => {
    const kernel = new ObjectKernel({ logLevel: 'silent' });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();

    const objectql = kernel.getService('objectql') as any;
    const data = kernel.getService('data') as any;
    const automation = kernel.getService<AutomationEngine>('automation');

    await attachSqlite(objectql);
    objectql.registry.registerObject(objectDef('wid5'), 'test', 'test');
    await objectql.syncSchemas();
    automation.registerFlow('urgent_alert', urgentAlertFlow('urgent_alert', 'wid5') as any);

    // Create leg — a brand-new URGENT record: `previous == null` makes the
    // condition true, so the flow fires on afterInsert (the create-discrimination
    // pattern the docs/showcase advertise).
    const urgent = await data.insert('wid5', { priority: 'urgent' }, { context: { userId: 'u_trigger' } });
    const urgentId = Array.isArray(urgent) ? urgent[0]?.id : urgent?.id ?? urgent;
    await sleep(200);
    expect((await data.findOne('wid5', { where: { id: urgentId } }))?.alerted).toBe('yes');

    // Create leg — a NON-urgent record: the condition is false, no fire.
    const low = await data.insert('wid5', { priority: 'low' }, { context: { userId: 'u_trigger' } });
    const lowId = Array.isArray(low) ? low[0]?.id : low?.id ?? low;
    await sleep(200);
    expect((await data.findOne('wid5', { where: { id: lowId } }))?.alerted).toBeFalsy();

    // Update leg — escalate that low record to urgent: `previous.priority` was
    // 'low', so the transition guard fires the flow on afterUpdate.
    await data.update('wid5', { id: lowId, priority: 'urgent' }, { context: { userId: 'u_trigger' } });
    await sleep(200);
    expect((await data.findOne('wid5', { where: { id: lowId } }))?.alerted).toBe('yes');
  }, 15000);

  /**
   * #4953 (services half) — a REAL-engine (SqlDriver) measurement of the
   * `record-before-*` seam. `record-before-write` dispatches on `beforeUpdate`
   * BEFORE the driver has anything to echo back (`ctx.result` is unset), so
   * `hydrateComputedFields` never runs either — this leg is entirely on
   * `buildContext`'s own prior-row fold + `materializeDeclaredFields` to be
   * total, with no assist from the after-row merge #1872 fixed.
   */
  it('a record-before-write start condition sees an UNTOUCHED declared field\'s real value, and a NEVER-SET one as null — not a fault (#4953)', async () => {
    // `{ logger: { level: 'silent' } }`, not this file's OTHER `{ logLevel:
    // 'silent' }` — `ObjectKernelConfig` declares only `logger`
    // (`packages/core/src/kernel.ts`); the sibling spelling is an untyped
    // excess property `tsc` never catches on this test-hiding package (a
    // pre-existing `check:type-check-debt` TEST_DEBT site, not this PR's to
    // sweep) and, measurably, does NOTHING — `createLogger(config.logger)`
    // never reads it, so every sibling `it` below actually logs at its
    // default level despite the option.
    const kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();

    // Typed via the slot's contract (`check:slot-lookup` ratchet, #4251) —
    // see the `TestObjectQLEngine` doc comment at the top of this file for
    // why it is `IObjectQLEngine` PLUS the two concrete-engine members the
    // published contract omits, rather than `as any`.
    const objectql = kernel.getService<TestObjectQLEngine>('objectql');
    const data = kernel.getService<IDataEngine>('data');
    const automation = kernel.getService<AutomationEngine>('automation');

    await attachSqlite(objectql);
    objectql.registry.registerObject(beforeHookObjectDef('bfw'), 'test', 'test');
    objectql.registry.registerObject(
      { name: 'bfw_audit', label: 'bfw audit', fields: { seen_tag: { name: 'seen_tag', label: 'T', type: 'text' } } },
      'test', 'test',
    );
    await objectql.syncSchemas();

    automation.registerFlow('before_write_probe', {
      name: 'before_write_probe', label: 'Before-update probe', type: 'record_change',
      nodes: [
        {
          id: 'start', type: 'start', label: 'Start',
          // `record-before-update` ONLY (not `-write`, which would also bind
          // `beforeInsert` — the insert leg would trivially satisfy this same
          // condition too and double the audit count, muddying the measurement).
          config: {
            objectName: 'bfw', triggerType: 'record-before-update',
            // `tag` is NOT in THIS write's payload (only `note` is written) —
            // BEFORE the fix this read a record with no `tag` key and
            // FAULTED. `nickname` is declared but never given a value
            // ANYWHERE (not on insert, not on this update): a materialized
            // `null`, not a fabrication.
            condition: "record.tag != null && record.nickname == null",
          },
        },
        {
          id: 'log', type: 'create_record', label: 'Log',
          config: { objectName: 'bfw_audit', fields: { seen_tag: '{record.tag}' } },
        },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'log' }, { id: 'e2', source: 'log', target: 'end' }],
    } as any);

    const created = await data.insert('bfw', { tag: 'keep', note: 'x' }, { context: { userId: 'u_trigger' } });
    const id = Array.isArray(created) ? created[0]?.id : created?.id ?? created;
    await sleep(200);

    // Update touches ONLY `note` — `tag` never appears in this write's payload.
    await data.update('bfw', { id, note: 'y' }, { context: { userId: 'u_trigger' } });
    await sleep(200);

    const audit: any[] = await data.find('bfw_audit', {});
    expect(audit).toHaveLength(1);
    // The condition read `record.tag`'s REAL persisted value ('keep', folded
    // from the prior row) — not a fabricated null, and not a fault.
    expect(audit[0]?.seen_tag).toBe('keep');
  }, 15000);
});
