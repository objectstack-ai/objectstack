// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27703] The mention gate's withheld users reach the AUTHOR's write answer.
 *
 * The transport, as built:
 *
 *   createData / updateData → pass THIS write's `onMentionsWithheld` listener
 *                             (`WriteObservabilityOptions`) in the engine bag
 *   engine (insert / update) → never calls it; hands the caller's bag to every
 *                             `after*` hook on `ctx.input.options` (widened by
 *                             `buildDriverOptions`, never stripped)
 *   the mention writer       → calls it with the ids its gate withheld
 *                             (plugin-audit; pinned there against the real gate)
 *   createData / updateData → answer the ids as `withheldMentions`, omit-when-empty
 *
 * A REAL `ObjectQL` engine and the REAL `ObjectStackProtocolImplementation` run
 * below. The one stand-in is the writer: an `after*` hook that reports what a
 * mention gate would have withheld (the `withhold` column of the written row),
 * so these pins hold the transport, and plugin-audit's hold the verdict.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { CreateDataResponseSchema, UpdateDataResponseSchema } from '@objectstack/spec/api';
import { ObjectQL } from './engine.js';

const NOTE = {
  name: 'wm_note',
  label: 'Note',
  fields: {
    body: { name: 'body', label: 'Body', type: 'text' },
    withhold: { name: 'withhold', label: 'Withhold', type: 'text' },
  },
};

function makeMemoryDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) return true;
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      return (row[k] ?? null) === (expected ?? null);
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = [...storeFor(object).values()].filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const row = { ...data, id: (data.id as string) ?? `r_${nextId}` };
      storeFor(object).set(row.id as string, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const row = { ...storeFor(object).get(id), ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

let engine: ObjectQL;
let protocol: ObjectStackProtocolImplementation;
let storeFor: ReturnType<typeof makeMemoryDriver>['storeFor'];
/** Set by a test: the hook writes a nested note carrying this `withhold` inside the outer write. */
let nestedWithhold: string | undefined;

/** The stand-in mention writer: reports the written row's `withhold` ids to THIS write's listener. */
const standInWriter = async (ctx: any) => {
  const ids = String(ctx.result?.withhold ?? '').split(',').filter(Boolean);
  if (ids.length > 0) ctx.input?.options?.onMentionsWithheld?.(ids);
  if (nestedWithhold !== undefined && ctx.event === 'afterInsert') {
    const withhold = nestedWithhold;
    nestedWithhold = undefined;
    await engine.insert(NOTE.name, { body: 'nested', withhold });
  }
};

beforeEach(async () => {
  engine = new ObjectQL({ logger: { info() {}, debug() {}, warn() {}, error() {} } } as any);
  const d = makeMemoryDriver();
  storeFor = d.storeFor;
  engine.registerDriver(d.driver, true);
  await engine.init();
  engine.registry.registerObject(NOTE as never, 'com.objectstack.test.27703');
  engine.registerHook('afterInsert', standInWriter, { object: NOTE.name });
  engine.registerHook('afterUpdate', standInWriter, { object: NOTE.name });
  protocol = new ObjectStackProtocolImplementation(engine as never);
  nestedWithhold = undefined;
});

describe('[#27703] createData answers the withheld ids as `withheldMentions`', () => {
  it('answers the ids the after-hook reported on this write, and the answer conforms', async () => {
    const answer: any = await protocol.createData({ object: NOTE.name, data: { body: 'hi', withhold: 'u_bob,u_dave' } });
    expect(answer.withheldMentions).toEqual(['u_bob', 'u_dave']);
    expect(CreateDataResponseSchema.safeParse(answer).success).toBe(true);
  });

  it('control: nothing reported → no `withheldMentions` key at all', async () => {
    const answer: any = await protocol.createData({ object: NOTE.name, data: { body: 'hi' } });
    expect('withheldMentions' in answer).toBe(false);
  });

  it('nothing is stored: the persisted row carries no member beyond what was written', async () => {
    const answer: any = await protocol.createData({ object: NOTE.name, data: { body: 'hi', withhold: 'u_bob' } });
    const stored = storeFor(NOTE.name).get(answer.id)!;
    expect(Object.keys(stored).sort()).not.toContain('withheldMentions');
    expect('withheldMentions' in answer.record).toBe(false);
  });

  it('a nested write a hook makes inside this one adds nothing to the outer answer, though it DID report', async () => {
    nestedWithhold = 'u_nested';
    const answer: any = await protocol.createData({ object: NOTE.name, data: { body: 'outer' } });
    expect(nestedWithhold).toBeUndefined(); // the nested note was written, carrying a withheld id …
    expect([...storeFor(NOTE.name).values()].some((r) => r.withhold === 'u_nested')).toBe(true);
    expect('withheldMentions' in answer).toBe(false); // … and the outer answer was told nothing.
  });

  it('each request answers only its own: a second create is not told the first one\'s ids', async () => {
    const first: any = await protocol.createData({ object: NOTE.name, data: { body: 'a', withhold: 'u_bob' } });
    const second: any = await protocol.createData({ object: NOTE.name, data: { body: 'b' } });
    expect(first.withheldMentions).toEqual(['u_bob']);
    expect('withheldMentions' in second).toBe(false);
  });
});

describe('[#27703] updateData answers the withheld ids as `withheldMentions`', () => {
  it('answers the ids the afterUpdate hook reported, de-duplicated, and the answer conforms', async () => {
    const created: any = await protocol.createData({ object: NOTE.name, data: { body: 'hi' } });
    const answer: any = await protocol.updateData({
      object: NOTE.name, id: created.id, data: { withhold: 'u_bob,u_bob,u_dave' },
    });
    expect(answer.withheldMentions).toEqual(['u_bob', 'u_dave']);
    expect(UpdateDataResponseSchema.safeParse(answer).success).toBe(true);
  });

  it('control: nothing reported → no `withheldMentions` key at all', async () => {
    const created: any = await protocol.createData({ object: NOTE.name, data: { body: 'hi' } });
    const answer: any = await protocol.updateData({ object: NOTE.name, id: created.id, data: { body: 'edited' } });
    expect('withheldMentions' in answer).toBe(false);
  });
});
