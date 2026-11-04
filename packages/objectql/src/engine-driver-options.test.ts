// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The engine → driver hop is a closed contract: a data driver is handed the
 * keys `DriverOptionsSchema` declares and nothing else (the precedent is the
 * closed engine option bags of #4400, one hop further down).
 *
 * The seam under test is the options argument as a driver RECEIVES it, read
 * off a recording driver double — the shape `engine-driver-read-scope.test.ts`
 * uses, since `@objectstack/objectql` cannot import a driver. Each verb is
 * driven with a caller bag that carries its own engine-level keys (`where`,
 * `fields`, `limit`, `multi`, a write-observability callback), because a
 * caller's bag is what the engine builds a driver's options from.
 *
 * Both directions are pinned: nothing undeclared arrives (the rule), and every
 * declared key the engine threads still arrives with its value (the control),
 * so the rule cannot be met by handing the driver nothing. A third block pins
 * that the `after*` hook view of `input.options` stays ADDITIVE (HookContext
 * PHASE contract) — the cut is the driver's, never the hooks'.
 */

import { describe, it, expect } from 'vitest';
import { DriverOptionsSchema } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ObjectQL } from './engine.js';
import {
  declaredDriverOptionKeys,
  mergeDriverOptionsIntoHookView,
  pickDeclaredDriverOptions,
} from './engine-driver-options.js';

const ORG = 'org_a';
const TZ = 'Asia/Shanghai';
const TRX = { handle: 'trx_1' };

/** The caller every verb runs as: an organization, a timezone and an open unit. */
const CALLER: ExecutionContext = {
  userId: 'usr_1',
  tenantId: ORG,
  timezone: TZ,
  transaction: TRX,
} as ExecutionContext;

interface ReceivedCall {
  method: string;
  /** Every own key of the options object exactly as the driver received it. */
  keys: Array<string | symbol>;
  options: Record<string, unknown> | undefined;
}

/**
 * A driver double that records the options argument of every data method it
 * is handed, and otherwise serves one in-memory table.
 */
function makeRecordingDriver(received: ReceivedCall[]) {
  const rows = new Map<string, Record<string, unknown>>();
  let nextId = 0;
  const record = (method: string, options: unknown) => {
    const opts = options && typeof options === 'object' ? (options as Record<string, unknown>) : undefined;
    received.push({ method, keys: opts ? Reflect.ownKeys(opts) : [], options: opts ? { ...opts } : undefined });
  };
  const matching = (where: any) =>
    [...rows.values()].filter((r) => !where || Object.entries(where).every(([k, v]) => k.startsWith('$') || r[k] === v));
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async syncSchema() {},
    async execute(_command: unknown, _params: unknown, options: unknown) { record('execute', options); return []; },
    async find(_o: string, ast: any, options: unknown) {
      record('find', options);
      const hit = matching(ast?.where);
      return typeof ast?.limit === 'number' ? hit.slice(0, ast.limit) : hit;
    },
    async findOne(_o: string, ast: any, options: unknown) { record('findOne', options); return matching(ast?.where)[0] ?? null; },
    async count(_o: string, ast: any, options: unknown) { record('count', options); return matching(ast?.where).length; },
    async create(_o: string, data: any, options: unknown) {
      record('create', options);
      nextId += 1;
      const row = { ...data, id: data.id ?? `r_${nextId}` };
      rows.set(row.id, row);
      return row;
    },
    async bulkCreate(_o: string, data: any[], options: unknown) {
      record('bulkCreate', options);
      return data.map((d) => { nextId += 1; const row = { ...d, id: d.id ?? `r_${nextId}` }; rows.set(row.id, row); return row; });
    },
    async update(_o: string, id: string, data: any, options: unknown) {
      record('update', options);
      const cur = rows.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      rows.set(id, next);
      return next;
    },
    async updateMany(_o: string, ast: any, data: any, options: unknown) {
      record('updateMany', options);
      const hit = matching(ast?.where);
      for (const r of hit) rows.set(r.id as string, { ...r, ...data, id: r.id });
      return hit.length;
    },
    async delete(_o: string, id: string, options: unknown) { record('delete', options); return rows.delete(id); },
    async deleteMany(_o: string, ast: any, options: unknown) {
      record('deleteMany', options);
      const hit = matching(ast?.where);
      for (const r of hit) rows.delete(r.id as string);
      return hit.length;
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
  };
  return driver;
}

/** Tenant-scoped by default: the registry injects `organization_id`. */
const TASK = { name: 'dopt_task', fields: { title: { type: 'text' }, status: { type: 'text' } } } as any;

async function makeEngine() {
  const received: ReceivedCall[] = [];
  const engine = new ObjectQL();
  engine.registerDriver(makeRecordingDriver(received), true);
  await engine.init();
  engine.registry.registerObject(TASK, 'com.example.driver-options');
  engine.setTenancyPostureProvider(() => 'isolated');
  return { engine, received };
}

/** Drive every verb the rule names, each with its caller bag's own keys. */
async function driveEveryVerb(engine: ObjectQL): Promise<void> {
  const [a] = (await engine.insert('dopt_task', [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo' }], {
    context: CALLER,
    onFieldsDropped: () => {},
  } as any)) as Array<Record<string, unknown>>;
  await engine.find('dopt_task', { where: { status: 'todo' }, fields: ['title'], limit: 5, offset: 0, context: CALLER });
  await engine.findOne('dopt_task', { where: { id: a!.id }, context: CALLER });
  await engine.count('dopt_task', { where: { status: 'todo' } }, { context: CALLER });
  await engine.update('dopt_task', { id: a!.id, title: 'a2' }, { context: CALLER, onFieldsDropped: () => {} } as any);
  await engine.update('dopt_task', { status: 'done' }, { where: { status: 'todo' }, multi: true, context: CALLER } as any);
  await engine.delete('dopt_task', { where: { id: a!.id }, context: CALLER } as any);
  await engine.delete('dopt_task', { where: { status: 'done' }, multi: true, context: CALLER } as any);
}

describe('a data driver receives the declared driver options and nothing else', () => {
  it('the hop key set is DriverOptionsSchema\'s declared keys; the only shape keys it leaves out admit no value', () => {
    const shape = DriverOptionsSchema.shape as Record<string, { safeParse(v: unknown): { success: boolean } }>;
    const declared = declaredDriverOptionKeys();
    for (const key of declared) expect(Object.keys(shape)).toContain(key);
    for (const key of ['transaction', 'tenantId', 'tenantIds', 'timezone', 'preserveAudit', 'bypassTenantAudit']) {
      expect(declared.has(key), key).toBe(true);
    }
    // What is left out is a retired tombstone: it refuses every value.
    const left = Object.keys(shape).filter((k) => !declared.has(k));
    expect(left.length).toBeGreaterThan(0);
    for (const key of left) {
      for (const probe of [1, 'x', true, {}, [], null]) {
        expect(shape[key]!.safeParse(probe).success, `${key} accepted ${JSON.stringify(probe)}`).toBe(false);
      }
    }
  });

  it('find, findOne, insert, update and delete hand the driver only declared option keys', async () => {
    const { engine, received } = await makeEngine();
    await driveEveryVerb(engine);

    const methods = new Set(received.map((c) => c.method));
    // Not vacuous: every verb the rule names really reached the driver.
    for (const m of ['find', 'findOne', 'create', 'update', 'delete', 'updateMany', 'deleteMany', 'count']) {
      expect(methods.has(m) || (m === 'create' && methods.has('bulkCreate')), `driver.${m} was called`).toBe(true);
    }
    const declared = declaredDriverOptionKeys();
    for (const call of received) {
      for (const key of call.keys) {
        expect(typeof key === 'string' && declared.has(key), `driver.${call.method} received undeclared key ${String(key)}`).toBe(true);
      }
    }
  });

  it('the raw execute door hands the driver only declared option keys', async () => {
    const { engine, received } = await makeEngine();
    await engine.execute('SELECT 1', { object: 'dopt_task', args: [], transaction: TRX });
    const call = received.find((c) => c.method === 'execute');
    expect(call).toBeDefined();
    expect(call!.keys).toEqual(['transaction']);
    expect(call!.options!.transaction).toBe(TRX);
  });
});

describe('control: the declared keys the engine threads still reach the driver', () => {
  it('transaction, tenantId and timezone arrive on find, findOne, insert, update and delete', async () => {
    const { engine, received } = await makeEngine();
    await driveEveryVerb(engine);

    for (const method of ['find', 'findOne', 'update', 'delete']) {
      const call = received.find((c) => c.method === method);
      expect(call, `driver.${method} was called`).toBeDefined();
      expect(call!.options!.transaction, method).toBe(TRX);
      expect(call!.options!.tenantId, method).toBe(ORG);
      expect(call!.options!.timezone, method).toBe(TZ);
    }
    const insert = received.find((c) => c.method === 'bulkCreate' || c.method === 'create');
    expect(insert!.options!.transaction).toBe(TRX);
    expect(insert!.options!.tenantId).toBe(ORG);
    expect(insert!.options!.timezone).toBe(TZ);
  });

  it('preserveAudit and a caller\'s explicit bypassTenantAudit arrive unchanged', async () => {
    const { engine, received } = await makeEngine();
    const [row] = (await engine.insert('dopt_task', [{ title: 'a' }], { context: CALLER } as any)) as Array<Record<string, unknown>>;
    await engine.update(
      'dopt_task',
      { id: row!.id, title: 'b' },
      { context: { ...CALLER, preserveAudit: true }, bypassTenantAudit: true } as any,
    );
    const update = received.filter((c) => c.method === 'update').at(-1)!;
    expect(update.options!.preserveAudit).toBe(true);
    expect(update.options!.bypassTenantAudit).toBe(true);
  });
});

describe('the after* hook view of input.options stays additive', () => {
  it('an afterFind hook still reads the caller\'s own keys beside the driver options', async () => {
    const { engine } = await makeEngine();
    const seen: Array<Record<string, unknown>> = [];
    engine.registerHook('afterFind', async (ctx: any) => { seen.push(ctx.input.options); }, { object: 'dopt_task' });
    await engine.find('dopt_task', { where: { status: 'todo' }, limit: 3, context: CALLER });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.limit).toBe(3);
    expect(seen[0]!.where).toEqual({ status: 'todo' });
    expect(seen[0]!.tenantId).toBe(ORG);
  });

  it('an afterUpdate hook still reads a write-observability callback the caller passed', async () => {
    const { engine } = await makeEngine();
    const [row] = (await engine.insert('dopt_task', [{ title: 'a' }], { context: CALLER } as any)) as Array<Record<string, unknown>>;
    const callback = () => {};
    let seenCallback: unknown;
    engine.registerHook('afterUpdate', async (ctx: any) => { seenCallback = ctx.input.options?.onMentionsWithheld; }, { object: 'dopt_task' });
    await engine.update('dopt_task', { id: row!.id, title: 'b' }, { context: CALLER, onMentionsWithheld: callback } as any);
    expect(seenCallback).toBe(callback);
  });

  it('merging adds the driver options and answers the caller\'s own bag when nothing is added', () => {
    const bag = { where: { a: 1 }, tenantId: ORG };
    expect(mergeDriverOptionsIntoHookView(bag, pickDeclaredDriverOptions(bag))).toBe(bag);
    expect(mergeDriverOptionsIntoHookView(bag, { tenantId: ORG, timezone: TZ })).toEqual({ where: { a: 1 }, tenantId: ORG, timezone: TZ });
    expect(mergeDriverOptionsIntoHookView(undefined, { tenantId: ORG })).toEqual({ tenantId: ORG });
    expect(mergeDriverOptionsIntoHookView(bag, undefined)).toBe(bag);
  });
});
