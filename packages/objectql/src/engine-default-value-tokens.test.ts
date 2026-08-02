// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The engine half of the `defaultValue` runtime-token contract (#4560).
 *
 * `applyFieldDefaults` owns the `current_user` token: it stamps the acting
 * user's id on insert, and with NO authenticated user (system / anonymous
 * writes) it deliberately leaves the field UNSET rather than invent an owner.
 *
 * That "leave it unset" is only worth anything if nothing downstream fills the
 * gap behind the engine's back — which is exactly what a SQL column
 * `DEFAULT 'current_user'` did (#4560). These tests pin the engine side of the
 * agreement, and that the token spelling it matches is the SPEC's
 * (`DEFAULT_VALUE_TOKENS`), the same set a driver's DDL consults when deciding
 * which `defaultValue`s may become a physical column DEFAULT.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { DEFAULT_VALUE_TOKEN_CURRENT_USER } from '@objectstack/spec/data';

function makeMemoryDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string) { return Array.from(storeFor(object).values()); },
    findStream() { throw new Error('not implemented'); },
    async findOne(object: string) { return storeFor(object).values().next().value ?? null; },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update() { return null; },
    async upsert(object: string, data: Record<string, unknown>) { return this.create(object, data); },
    async delete() { return true; },
    async count(object: string) { return storeFor(object).size; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany() { return 0; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

const owned = {
  name: 'tok_doc',
  label: 'Doc',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    owner: {
      name: 'owner', label: 'Owner', type: 'user' as const,
      reference: 'sys_user', defaultValue: DEFAULT_VALUE_TOKEN_CURRENT_USER,
    },
  },
};

describe('[#4560] the `current_user` defaultValue token is engine-owned', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver().driver, true);
    await engine.init();
    engine.registry.registerObject(owned as any);
  });

  it('stamps the acting user id on an authenticated insert', async () => {
    const row: any = await engine.insert('tok_doc', { title: 'A' }, { context: { userId: 'usr_7' } } as any);
    expect(row.owner).toBe('usr_7');
  });

  it('leaves the field UNSET on a system/anonymous insert — never the literal token', async () => {
    // The seed-replay / package-install / boot-provisioning shape. This is the
    // decision a column DEFAULT used to override, writing the literal string
    // `current_user` into a lookup('sys_user') column (#4560).
    const row: any = await engine.insert('tok_doc', { title: 'B' }, { context: { isSystem: true } } as any);
    expect(row.owner).toBeUndefined();
    expect(row.owner).not.toBe('current_user');
  });

  it('an explicit null is treated as "not supplied" and still resolves the token (#2706)', async () => {
    const row: any = await engine.insert('tok_doc', { title: 'C', owner: null }, { context: { userId: 'usr_9' } } as any);
    expect(row.owner).toBe('usr_9');
  });

  it('a NEAR-MISS spelling is a literal, not a token — it is an authoring error, not an alias', async () => {
    engine.registry.registerObject({
      ...owned,
      name: 'tok_typo',
      fields: { ...owned.fields, owner: { ...owned.fields.owner, defaultValue: 'CURRENT_USER' } },
    } as any);
    const row: any = await engine.insert('tok_typo', { title: 'D' }, { context: { userId: 'usr_1' } } as any);
    // Deliberately NOT resolved: widening the match would make a genuinely
    // intended literal unstorable. Lint catches the typo at authoring time.
    expect(row.owner).toBe('CURRENT_USER');
  });
});
