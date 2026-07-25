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
 * record-change trigger + in-memory driver) and asserts the full chain — in BOTH
 * registration orderings, since the engine relies on re-activating already-pulled
 * flows when the trigger registers later.
 */

import { describe, it, expect } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { RecordChangeTriggerPlugin } from './plugin.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A tiny equality-WHERE in-memory driver — enough to exercise the real engine's
 * insert/update/find path without pulling a driver package as a dependency
 * (mirrors objectql's own real-engine test helper). One record store per object.
 */
function makeMemoryDriver(): any {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    if (Array.isArray(where.$and)) return where.$and.every((w: any) => matches(row, w));
    if (Array.isArray(where.$or)) return where.$or.some((w: any) => matches(row, w));
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      const a = row[k] === undefined ? null : row[k];
      const b = expected === undefined ? null : expected;
      if (a !== b) return false;
    }
    return true;
  };
  return {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
    },
    findStream() { throw new Error('not implemented'); },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) throw new Error(`not found: ${object}/${id}`);
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return updated;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
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

    objectql.registerDriver(makeMemoryDriver(), true);
    objectql.registry.registerObject(objectDef('wid'), 'test', 'test');
    automation.registerFlow('stamp_flow', stampFlow('stamp_flow', 'wid') as any);

    // The flow bound to the trigger…
    expect((automation as any).getActiveTriggerBindings()).toContainEqual({
      flowName: 'stamp_flow',
      triggerType: 'record_change',
    });

    const created = await data.insert('wid', { status: 'new' });
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
        ql.registerDriver(makeMemoryDriver(), true);
        ql.registry.registerObject(objectDef('wid2'), 'test', 'test');
        ql.registry.registerItem('flow', flowDef, 'name', 'test');
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

    const created = await data.insert('wid2', { status: 'new' });
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

    objectql.registerDriver(makeMemoryDriver(), true);
    objectql.registry.registerObject(objectDef('wid3'), 'test', 'test');
    automation.registerFlow('mirror_write', mirrorWriteFlow('mirror_write', 'wid3') as any);

    expect((automation as any).getActiveTriggerBindings()).toContainEqual({
      flowName: 'mirror_write',
      triggerType: 'record_change',
    });

    // Create — the afterInsert leg fires; the flow mirrors status → mirror.
    const created = await data.insert('wid3', { status: 'a' });
    const id = Array.isArray(created) ? created[0]?.id : created?.id ?? created;
    await sleep(200);
    expect((await data.findOne('wid3', { where: { id } }))?.mirror).toBe('a');

    // Update — the afterUpdate leg of the SAME flow fires; mirror re-syncs. (The
    // flow's own write-back does not loop: the re-entrancy guard suppresses it.)
    await data.update('wid3', { id, status: 'b' });
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

    objectql.registerDriver(makeMemoryDriver(), true);
    objectql.registry.registerObject(objectDef('wid5'), 'test', 'test');
    automation.registerFlow('urgent_alert', urgentAlertFlow('urgent_alert', 'wid5') as any);

    // Create leg — a brand-new URGENT record: `previous == null` makes the
    // condition true, so the flow fires on afterInsert (the create-discrimination
    // pattern the docs/showcase advertise).
    const urgent = await data.insert('wid5', { priority: 'urgent' });
    const urgentId = Array.isArray(urgent) ? urgent[0]?.id : urgent?.id ?? urgent;
    await sleep(200);
    expect((await data.findOne('wid5', { where: { id: urgentId } }))?.alerted).toBe('yes');

    // Create leg — a NON-urgent record: the condition is false, no fire.
    const low = await data.insert('wid5', { priority: 'low' });
    const lowId = Array.isArray(low) ? low[0]?.id : low?.id ?? low;
    await sleep(200);
    expect((await data.findOne('wid5', { where: { id: lowId } }))?.alerted).toBeFalsy();

    // Update leg — escalate that low record to urgent: `previous.priority` was
    // 'low', so the transition guard fires the flow on afterUpdate.
    await data.update('wid5', { id: lowId, priority: 'urgent' });
    await sleep(200);
    expect((await data.findOne('wid5', { where: { id: lowId } }))?.alerted).toBe('yes');
  }, 15000);
});
