// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The engine half of the `defaultValue` runtime-token contract (#4560, #4597).
 *
 * `applyFieldDefaults` owns the WHOLE token family (`DEFAULT_VALUE_TOKENS`):
 *
 *   - `current_user` — stamps the acting user's id on insert, and with NO
 *     authenticated user (system / anonymous writes) deliberately leaves the
 *     field UNSET rather than invent an owner.
 *   - `NOW()` — stamps the insert-time clock, in the storage shape the field's
 *     declared type calls for.
 *
 * Both halves are the same crack seen from opposite sides. `current_user` was
 * known to the engine and not to the DDL, so a SQL column
 * `DEFAULT 'current_user'` filled the gap the engine had deliberately left
 * (#4560). `NOW()` was known to the SQL driver and not to the engine, so the
 * literal four characters `NOW()` went to every driver — hidden on SQL by
 * `formatInput`'s safety net, and on memory/mongodb either REJECTED by the
 * engine's own write validator or, on a `readonly`/`system` field that
 * `validateRecord` skips, stored verbatim (#4597).
 *
 * So these tests pin one property above all: a token is resolved by the ENGINE,
 * identically for every datasource, and the spelling it matches is the SPEC's
 * (`DEFAULT_VALUE_TOKENS`) — the same set a driver's DDL consults when deciding
 * which `defaultValue`s may become a physical column DEFAULT.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { DEFAULT_VALUE_TOKEN_CURRENT_USER, DEFAULT_VALUE_TOKEN_NOW } from '@objectstack/spec/data';

/** `YYYY-MM-DDTHH:MM:SS.sssZ` — the canonical stored instant (ADR-0053). */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function makeStubDriver() {
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
    engine.registerDriver(makeStubDriver().driver, true);
    await engine.init();
    engine.registry.registerObject(owned);
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

describe('[#4597] the `NOW()` defaultValue token is engine-owned too', () => {
  let engine: ObjectQL;

  const stamped = {
    name: 'probe_now',
    label: 'Probe',
    fields: {
      id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
      title: { name: 'title', label: 'Title', type: 'text' as const },
      // The issue's exact repro: a plain (NOT readonly) datetime, so the
      // engine's own write validator sees the value it just defaulted.
      seen_at: {
        name: 'seen_at', label: 'Seen At', type: 'datetime' as const,
        defaultValue: DEFAULT_VALUE_TOKEN_NOW,
      },
    },
  };

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeStubDriver().driver, true);
    await engine.init();
    engine.registry.registerObject(stamped);
  });

  it('resolves on a NON-SQL datasource — the insert succeeds and stores a real instant', async () => {
    // Before the fix this threw `ValidationError: seen_at must be a valid
    // datetime (ISO-8601)`: the engine filled the field with the literal
    // string 'NOW()' and its own validator then rejected the insert. The
    // stub driver, like every non-SQL driver, has no `formatInput` safety net
    // to hide it behind.
    const row: any = await engine.insert('probe_now', {}, { context: { isSystem: true } } as any);
    expect(row.seen_at).not.toBe('NOW()');
    expect(row.seen_at).toMatch(ISO_INSTANT);
    expect(Number.isNaN(Date.parse(row.seen_at))).toBe(false);
  });

  it('never overwrites a caller-supplied value', async () => {
    const supplied = '2020-01-02T03:04:05.678Z';
    const row: any = await engine.insert(
      'probe_now', { title: 'A', seen_at: supplied }, { context: { isSystem: true } } as any,
    );
    expect(row.seen_at).toBe(supplied);
  });

  it('an explicit null is treated as "not supplied" and still resolves the token (#2706)', async () => {
    const row: any = await engine.insert(
      'probe_now', { title: 'B', seen_at: null }, { context: { isSystem: true } } as any,
    );
    expect(row.seen_at).toMatch(ISO_INSTANT);
  });

  it('a `readonly` field stores the instant, not the four characters `NOW()`', async () => {
    // The silent half of the bug, and the shape ~100 platform declarations use
    // (`created_at` / `updated_at` are `readonly`). `validateRecord` SKIPS
    // readonly fields, so nothing was rejected — the token text just landed in
    // the column, the #4560 failure mode exactly.
    // Deliberately the ONLY token-defaulted field on the object: with no
    // validated sibling to throw first, an unresolved token raises NOTHING and
    // the write "succeeds" — which is what makes this the silent face.
    engine.registry.registerObject({
      name: 'probe_now_ro',
      label: 'Probe RO',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        title: { name: 'title', label: 'Title', type: 'text' as const },
        created_at: {
          name: 'created_at', label: 'Created At', type: 'datetime' as const,
          defaultValue: DEFAULT_VALUE_TOKEN_NOW, readonly: true,
        },
      },
    } as any);
    const row: any = await engine.insert('probe_now_ro', {}, { context: { isSystem: true } } as any);
    expect(row.created_at).not.toBe('NOW()');
    expect(row.created_at).toMatch(ISO_INSTANT);
  });

  it('resolves ONCE per insert — every defaulted field on a record shares one instant', async () => {
    engine.registry.registerObject({
      ...stamped,
      name: 'probe_now_pair',
      fields: {
        ...stamped.fields,
        also_at: {
          name: 'also_at', label: 'Also At', type: 'datetime' as const,
          defaultValue: DEFAULT_VALUE_TOKEN_NOW,
        },
      },
    } as any);
    const row: any = await engine.insert('probe_now_pair', {}, { context: { isSystem: true } } as any);
    expect(row.seen_at).toMatch(ISO_INSTANT);
    // Same `nowSnapshot`, so the two cannot straddle a millisecond boundary.
    expect(row.also_at).toBe(row.seen_at);
  });

  it('one batch insert shares one instant across rows', async () => {
    const rows: any[] = await engine.insert(
      'probe_now', [{ title: 'A' }, { title: 'B' }], { context: { isSystem: true } } as any,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].seen_at).toMatch(ISO_INSTANT);
    expect(rows[1].seen_at).toBe(rows[0].seen_at);
  });

  it('matches the SPEC predicate, so the tolerant spellings the platform relies on resolve', async () => {
    // `isNowDefaultToken` is case-insensitive and whitespace tolerant — the
    // rule the SQL driver has always applied. The engine consumes that
    // predicate rather than re-deriving a stricter local one, or the two sides
    // would disagree about which declarations are tokens at all.
    engine.registry.registerObject({
      ...stamped,
      name: 'probe_now_lower',
      fields: { ...stamped.fields, seen_at: { ...stamped.fields.seen_at, defaultValue: ' now() ' } },
    } as any);
    const row: any = await engine.insert('probe_now_lower', {}, { context: { isSystem: true } } as any);
    expect(row.seen_at).toMatch(ISO_INSTANT);
  });

  it('resolves into the shape the DECLARED TYPE stores — date and time are not instants', async () => {
    // ADR-0053: a `Field.date` is a calendar day and a `Field.time` a wall
    // clock. `SqlDriver.nowColumnDefault` already emits exactly these two
    // shapes; stamping a full instant here would just move the cross-driver
    // drift instead of closing it (SQL collapses it in `formatInput`,
    // memory/mongodb would not).
    engine.registry.registerObject({
      ...stamped,
      name: 'probe_now_temporal',
      fields: {
        ...stamped.fields,
        on_day: {
          name: 'on_day', label: 'Day', type: 'date' as const,
          defaultValue: DEFAULT_VALUE_TOKEN_NOW,
        },
        at_time: {
          name: 'at_time', label: 'Time', type: 'time' as const,
          defaultValue: DEFAULT_VALUE_TOKEN_NOW,
        },
      },
    } as any);
    const row: any = await engine.insert('probe_now_temporal', {}, { context: { isSystem: true } } as any);
    expect(row.on_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // `HH:MM:SS` or `HH:MM:SS.fff` — a zero-millisecond `.000` is trimmed so
    // the row stays byte-canonical against an equality filter.
    expect(row.at_time).toMatch(/^\d{2}:\d{2}:\d{2}(\.\d{3})?$/);
    expect(row.at_time).not.toMatch(/\.000$/);
    // All three are cut from the one snapshot: the day and the UTC wall clock
    // of the very same instant.
    expect(row.on_day).toBe(row.seen_at.slice(0, 10));
    const timeOfDay: string = row.seen_at.slice(11, 23);
    expect(row.at_time).toBe(timeOfDay.endsWith('.000') ? timeOfDay.slice(0, 8) : timeOfDay);
  });

  it('a NEAR-MISS spelling is a literal, not a token', async () => {
    engine.registry.registerObject({
      ...stamped,
      name: 'probe_now_typo',
      // `type: 'text'` so the literal is storable — the point is that the
      // engine did not treat `NOW` as the token, not what a datetime does
      // with it.
      fields: {
        ...stamped.fields,
        seen_at: { name: 'seen_at', label: 'Seen At', type: 'text' as const, defaultValue: 'NOW' },
      },
    } as any);
    const row: any = await engine.insert('probe_now_typo', {}, { context: { isSystem: true } } as any);
    expect(row.seen_at).toBe('NOW');
  });
});
