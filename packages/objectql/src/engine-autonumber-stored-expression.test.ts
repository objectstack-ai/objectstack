// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25073 — a stored field whose `expression` reads an `autonumber` stores the
 * value computed WITH the number, on every insert path.
 *
 * Before this card the stored-expression passes ran before the number
 * existed: before `beforeInsert` and again before validation, while the
 * number was issued after validation (the engine's fallback counter) or inside
 * the driver's `create()` (a driver that owns its counter). So
 * `record.case_number + " - " + record.subject` stored `null`, and
 * `has(record.product_code) ? … : record.name` stored its fallback, until a
 * later update by id computed it again. Measured at the base on driver-memory
 * and on SQLite before the fix (#25073's probe): `display_title: null`,
 * `title: "Probe product"`.
 *
 * Now the insert computes those fields again right after it issues the
 * number, on the row it hands the driver, so the write is still ONE statement
 * carrying both. Two issuers, both pinned here over hand-rolled drivers:
 *
 *  - **engine** — a driver that leaves the number to the engine
 *    (`supports = {}`): `applyAutonumbers` issues, the readers are computed
 *    again, and the #6806 collision loop computes them again after each
 *    re-issue.
 *  - **driver** — a driver that owns its counter (`supports.autonumber`) and
 *    implements `IDataDriver.issueAutonumbers`: for an object a stored
 *    expression reads a number on, the engine asks the member for the number
 *    at the same point, and the collision loop re-issues through it. An
 *    object no stored expression reads a number on keeps the driver's own
 *    issue-at-write (`issueAutonumbers` is never called for it).
 *
 * The SQL drivers' real member is pinned in driver-sql's
 * `sql-driver-autonumber-issue-ahead.test.ts`, and the whole path over a real
 * SQLite database in runtime's `autonumber-stored-expression.integration.test.ts`.
 *
 * NOTE this file imports no driver package (hand-rolled drivers below), so it
 * adds no `driver-memory` consumer for `check:driver-memory-census`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectQL } from './engine.js';

type Row = Record<string, any>;

const CASE = {
  name: 'acase',
  fields: {
    subject: { type: 'text' },
    case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: true },
    display_title: { type: 'text', expression: { dialect: 'cel', source: 'record.case_number + " - " + record.subject' } },
    // Reads the number only through `display_title`.
    headline: { type: 'text', expression: { dialect: 'cel', source: 'record.display_title + "!"' } },
    // Control: reads no record number.
    plain_title: { type: 'text', expression: { dialect: 'cel', source: '"S:" + record.subject' } },
    must: { type: 'text', required: true },
  },
};

const PRODUCT = {
  name: 'aproduct',
  fields: {
    name: { type: 'text' },
    product_code: { type: 'autonumber', format: 'PRD-{0000}' },
    title: { type: 'text', expression: { dialect: 'cel', source: 'has(record.product_code) ? record.product_code + " " + record.name : record.name' } },
  },
};

/** Control object: an autonumber that no stored expression reads. */
const NOTE = {
  name: 'anote',
  fields: {
    name: { type: 'text' },
    code: { type: 'autonumber', format: 'N-{000}' },
    summary: { type: 'text', expression: { dialect: 'cel', source: '"N:" + record.name' } },
  },
};

/** `prefix`, zero-padded width — the formats above, as a driver that owns its counter renders them. */
const AUTONUMBERS: Record<string, Record<string, [string, number]>> = {
  acase: { case_number: ['CASE-', 5] },
  aproduct: { product_code: ['PRD-', 4] },
  anote: { code: ['N-', 3] },
};

function cond(value: unknown, c: unknown): boolean {
  if (c === null || typeof c !== 'object' || Array.isArray(c) || c instanceof Date) return value === c;
  return Object.entries(c as Record<string, unknown>).every(([op, t]) => {
    switch (op) {
      case '$eq': return value === t;
      case '$ne': return value !== t;
      case '$in': return Array.isArray(t) && t.includes(value);
      case '$startsWith': return typeof value === 'string' && value.startsWith(String(t));
      case '$gt': return value != null && String(value) > String(t);
      default: throw new Error(`fake driver: unsupported operator ${op}`);
    }
  });
}

function matches(row: Row, where: any): boolean {
  if (!where || typeof where !== 'object') return true;
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (k === '$and') return (v as any[]).every((w) => matches(row, w));
    if (k === '$or') return (v as any[]).some((w) => matches(row, w));
    if (k.startsWith('$')) throw new Error(`fake driver: unsupported logical operator ${k}`);
    return cond(row[k], v);
  });
}

/** Postgres names the conflicting column in DETAIL, which `uniqueViolationColumn` reads. */
const duplicate = (column: string, value: unknown) =>
  Object.assign(new Error(`duplicate key value violates unique constraint "${column}_key"`), {
    code: '23505',
    detail: `Key (${column})=(${String(value)}) already exists.`,
  });

type Issuer = 'engine' | 'driver';

interface DriverOpts {
  /** A driver that owns its counter but does not implement the member. */
  withoutMember?: boolean;
  /** Refuse every write of a number as a duplicate. */
  alwaysCollide?: boolean;
}

/**
 * A store with unique record numbers. As the `engine` issuer it leaves the
 * number to the engine; as the `driver` issuer it owns a counter per field
 * (seeded from the store on first use, re-seeded forward after a collision on
 * a number it issued) and fills an empty slot inside `create()` /
 * `bulkCreate()`, as driver-sql does.
 */
function makeDriver(issuer: Issuer, opts: DriverOpts = {}) {
  const stores = new Map<string, Row[]>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = []; stores.set(o, s); }
    return s;
  };
  const counters = new Map<string, number>();
  const issuedTo = new WeakMap<object, string[]>();
  const tail = (value: unknown, prefix: string) =>
    typeof value === 'string' && value.startsWith(prefix) ? Number(value.slice(prefix.length)) || 0 : 0;
  const storedMax = (object: string, field: string) =>
    Math.max(0, ...storeFor(object).map((r) => tail(r[field], AUTONUMBERS[object][field][0])));
  /** Fill the empty slots on `row` from the counters; the names filled. */
  const fill = (object: string, row: Row): string[] => {
    const filled: string[] = [];
    for (const [field, [prefix, width]] of Object.entries(AUTONUMBERS[object] ?? {})) {
      if (row[field] !== undefined && row[field] !== null && row[field] !== '') continue;
      const key = `${object}.${field}`;
      const next = (counters.get(key) ?? storedMax(object, field)) + 1;
      counters.set(key, next);
      row[field] = `${prefix}${String(next).padStart(width, '0')}`;
      filled.push(field);
    }
    return filled;
  };
  const refuseDuplicates = (object: string, rows: Row[]) => {
    const seen = new Map<string, Set<unknown>>();
    for (const row of rows) {
      for (const field of Object.keys(AUTONUMBERS[object] ?? {})) {
        const value = row[field];
        if (value == null) continue;
        const inBatch = seen.get(field) ?? new Set();
        seen.set(field, inBatch);
        if (opts.alwaysCollide || inBatch.has(value) || storeFor(object).some((r) => r[field] === value)) {
          throw duplicate(field, value);
        }
        inBatch.add(value);
      }
    }
  };
  let n = 0;
  const write = (object: string, data: Row) => {
    n += 1;
    const row = { ...data, id: data.id ?? `r_${n}` };
    storeFor(object).push(row);
    return { ...row };
  };
  const driver: any = {
    name: issuer === 'engine' ? 'fallback-fake' : 'counter-fake',
    version: '0.0.0',
    supports: issuer === 'engine' ? {} : { autonumber: true },
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      let rows = storeFor(object).filter((r) => matches(r, ast?.where));
      const orderBy = ast?.orderBy;
      if (Array.isArray(orderBy) && orderBy.length > 0) {
        const { field, order } = orderBy[0];
        rows = [...rows].sort((a, b) => {
          const av = String(a[field] ?? '');
          const bv = String(b[field] ?? '');
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return order === 'desc' ? -cmp : cmp;
        });
      }
      if (typeof ast?.limit === 'number') rows = rows.slice(0, ast.limit);
      return rows.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      const row = storeFor(object).find((r) => matches(r, ast?.where));
      return row ? { ...row } : null;
    },
    create: vi.fn(async (object: string, data: Row) => {
      const row = { ...data };
      if (issuer === 'driver') fill(object, row);
      refuseDuplicates(object, [row]);
      return write(object, row);
    }),
    bulkCreate: vi.fn(async (object: string, data: Row[]) => {
      const rows = data.map((d) => ({ ...d }));
      if (issuer === 'driver') rows.forEach((row) => fill(object, row));
      refuseDuplicates(object, rows);
      return rows.map((row) => write(object, row));
    }),
    async update(object: string, id: string, data: Row) {
      const s = storeFor(object);
      const i = s.findIndex((r) => r.id === id);
      s[i] = { ...s[i], ...data, id };
      return { ...s[i] };
    },
    async delete() { return true; },
    async count(object: string, ast: any) { return storeFor(object).filter((r) => matches(r, ast?.where)).length; },
  };
  if (issuer === 'driver' && !opts.withoutMember) {
    driver.issueAutonumbers = vi.fn(async (object: string, rows: Row[], options?: any, afterCollision?: unknown) => {
      if (afterCollision === undefined) {
        return rows.map((row) => {
          const filled = fill(object, row);
          issuedTo.set(row, [...(issuedTo.get(row) ?? []).filter((f) => !filled.includes(f)), ...filled]);
          return filled;
        });
      }
      if (options?.transaction !== undefined) return rows.map(() => []);
      // Stale = a number this member issued that the store already holds.
      const stale = new Set<string>();
      for (const row of rows) {
        for (const field of issuedTo.get(row) ?? []) {
          if (opts.alwaysCollide || storeFor(object).some((r) => r[field] === row[field])) stale.add(field);
        }
      }
      for (const field of stale) {
        const key = `${object}.${field}`;
        counters.set(key, Math.max(counters.get(key) ?? 0, storedMax(object, field)));
      }
      return rows.map((row) => {
        const emptied = (issuedTo.get(row) ?? []).filter((field) => stale.has(field));
        for (const field of emptied) delete row[field];
        issuedTo.set(row, (issuedTo.get(row) ?? []).filter((field) => !stale.has(field)));
        return emptied;
      });
    });
  }
  return { driver, storeFor };
}

const SYSTEM = { context: { isSystem: true } } as any;

async function boot(issuer: Issuer, opts: DriverOpts = {}) {
  const engine = new ObjectQL();
  const { driver, storeFor } = makeDriver(issuer, opts);
  engine.registerDriver(driver, true);
  await engine.init();
  for (const schema of [CASE, PRODUCT, NOTE]) engine.registry.registerObject(schema as any);
  return { engine, driver, storeFor };
}

const stored = (storeFor: (o: string) => Row[], object: string) => storeFor(object).map((r) => ({ ...r }));

describe.each<Issuer>(['engine', 'driver'])('a stored expression reading the record number (#25073), %s-issued', (issuer) => {
  let engine: ObjectQL;
  let driver: any;
  let storeFor: (o: string) => Row[];

  beforeEach(async () => {
    ({ engine, driver, storeFor } = await boot(issuer));
  });

  it('stores the value computed WITH the number on a single insert, and answers it', async () => {
    const one: any = await engine.insert('acase', { subject: 'one', must: 'x' }, SYSTEM);
    expect(one.case_number).toBe('CASE-00001');
    expect(one.display_title).toBe('CASE-00001 - one');
    // Through another stored field that reads it.
    expect(one.headline).toBe('CASE-00001 - one!');
    const [row] = stored(storeFor, 'acase');
    expect(row).toMatchObject({ case_number: 'CASE-00001', display_title: 'CASE-00001 - one', headline: 'CASE-00001 - one!' });
    // One write.
    expect(driver.create).toHaveBeenCalledTimes(1);
  });

  it('stores each row\'s own number in a batch, in one bulkCreate', async () => {
    await engine.insert('acase', [{ subject: 'b1', must: 'x' }, { subject: 'b2', must: 'x' }], SYSTEM);
    expect(stored(storeFor, 'acase').map((r) => r.display_title)).toEqual(['CASE-00001 - b1', 'CASE-00002 - b2']);
    expect(driver.bulkCreate).toHaveBeenCalledTimes(1);
  });

  it('numbers only the live rows in partial mode, and computes each from its own number', async () => {
    const outcomes: any[] = await engine.insertMany(
      'acase',
      [{ subject: 'p1', must: 'x' }, { subject: 'dead' }, { subject: 'p3', must: 'x' }],
      SYSTEM,
    );
    expect(outcomes.map((o) => o.ok)).toEqual([true, false, true]);
    expect(outcomes.filter((o) => o.ok).map((o) => o.record.display_title)).toEqual(['CASE-00001 - p1', 'CASE-00002 - p3']);
    expect(stored(storeFor, 'acase').map((r) => r.display_title)).toEqual(['CASE-00001 - p1', 'CASE-00002 - p3']);
  });

  it('takes the has() branch that sees the number', async () => {
    const product: any = await engine.insert('aproduct', { name: 'Widget' }, SYSTEM);
    expect(product.title).toBe('PRD-0001 Widget');
    expect(stored(storeFor, 'aproduct')[0].title).toBe('PRD-0001 Widget');
  });

  it('computes again from the re-issued number after a collision', async () => {
    await engine.insert('acase', { subject: 'seed', must: 'x' }, SYSTEM);
    // A writer this engine cannot observe takes the next number.
    storeFor('acase').push({ id: 'oob', subject: 'oob', must: 'x', case_number: 'CASE-00002' });
    const collided: any = await engine.insert('acase', { subject: 'collide', must: 'x' }, SYSTEM);
    expect(collided.case_number).toBe('CASE-00003');
    expect(collided.display_title).toBe('CASE-00003 - collide');
    expect(stored(storeFor, 'acase').find((r) => r.subject === 'collide')).toMatchObject({
      case_number: 'CASE-00003', display_title: 'CASE-00003 - collide', headline: 'CASE-00003 - collide!',
    });
  });

  it('tells a registered listener, per row, after each computation, on the row the driver is handed', async () => {
    const seen: Array<{ object: string; number: unknown; title: unknown; fields: string[] }> = [];
    engine.registerInsertRecomputeListener('probe', ({ object, row, fields }) => {
      seen.push({ object, number: row.case_number, title: row.display_title, fields });
      row.headline = `${String(row.display_title)} (listened)`;
    });
    await engine.insert('acase', { subject: 'seed', must: 'x' }, SYSTEM);
    storeFor('acase').push({ id: 'oob', subject: 'oob', must: 'x', case_number: 'CASE-00002' });
    await engine.insert('acase', { subject: 'collide', must: 'x' }, SYSTEM);
    await engine.insert('anote', { name: 'n' }, SYSTEM);

    expect(seen).toEqual([
      { object: 'acase', number: 'CASE-00001', title: 'CASE-00001 - seed', fields: ['display_title', 'headline'] },
      { object: 'acase', number: 'CASE-00002', title: 'CASE-00002 - collide', fields: ['display_title', 'headline'] },
      { object: 'acase', number: 'CASE-00003', title: 'CASE-00003 - collide', fields: ['display_title', 'headline'] },
    ]);
    // What it writes on the row is written.
    expect(stored(storeFor, 'acase').find((r) => r.subject === 'collide')?.headline).toBe('CASE-00003 - collide (listened)');
  });

  describe('controls', () => {
    it('an expression that reads no record number is computed as before', async () => {
      const one: any = await engine.insert('acase', { subject: 'one', must: 'x' }, SYSTEM);
      expect(one.plain_title).toBe('S:one');
      const note: any = await engine.insert('anote', { name: 'n' }, SYSTEM);
      expect(note).toMatchObject({ code: 'N-001', summary: 'N:n' });
    });

    it('an update by id computes the reader from the stored number', async () => {
      const one: any = await engine.insert('acase', { subject: 'one', must: 'x' }, SYSTEM);
      const updated: any = await engine.update('acase', { id: one.id, subject: 'renamed' }, SYSTEM);
      expect(updated.display_title).toBe('CASE-00001 - renamed');
      expect(stored(storeFor, 'acase')[0].display_title).toBe('CASE-00001 - renamed');
    });
  });
});

describe('a driver that owns the counter (#25073)', () => {
  it('is asked for the number only on an object a stored expression reads it on', async () => {
    const { engine, driver, storeFor } = await boot('driver');
    await engine.insert('anote', { name: 'n' }, SYSTEM);
    expect(driver.issueAutonumbers).not.toHaveBeenCalled();
    expect(stored(storeFor, 'anote')[0].code).toBe('N-001');

    await engine.insert('acase', { subject: 'one', must: 'x' }, SYSTEM);
    expect(driver.issueAutonumbers).toHaveBeenCalledTimes(1);
    expect(driver.issueAutonumbers.mock.calls[0][3]).toBeUndefined();
  });

  it('re-seeds through the member on a batch collision and does not re-issue the batch', async () => {
    const { engine, driver, storeFor } = await boot('driver');
    await engine.insert('acase', { subject: 'seed', must: 'x' }, SYSTEM);
    storeFor('acase').push({ id: 'oob', subject: 'oob', must: 'x', case_number: 'CASE-00003' });

    const error: any = await engine
      .insert('acase', [{ subject: 'b1', must: 'x' }, { subject: 'b2', must: 'x' }], SYSTEM)
      .then(() => null, (e) => e);
    expect(error?.code).toBe('DUPLICATE_RECORD');
    expect(driver.bulkCreate).toHaveBeenCalledTimes(1);
    const collisionCall = driver.issueAutonumbers.mock.calls.find((call: any[]) => call[3] !== undefined);
    expect(collisionCall?.[1]).toHaveLength(2);
    expect(stored(storeFor, 'acase').map((r) => r.case_number)).toEqual(['CASE-00001', 'CASE-00003']);

    // The counter the collision proved stale was re-seeded: the next number is past the store's.
    const next: any = await engine.insert('acase', { subject: 'next', must: 'x' }, SYSTEM);
    expect(next).toMatchObject({ case_number: 'CASE-00004', display_title: 'CASE-00004 - next' });
  });

  it('gives up with ERR_AUTONUMBER_COLLISION after the bounded attempts', async () => {
    const { engine, driver } = await boot('driver', { alwaysCollide: true });
    const error: any = await engine.insert('acase', { subject: 'x', must: 'x' }, SYSTEM).then(() => null, (e) => e);
    expect(error?.code).toBe('ERR_AUTONUMBER_COLLISION');
    expect(driver.create).toHaveBeenCalledTimes(3);
  });

  it('without the member, keeps the number inside create() and says so once per object', async () => {
    const { engine, storeFor } = await boot('driver', { withoutMember: true });
    const error = vi.spyOn((engine as any).logger, 'error');
    await engine.insert('acase', { subject: 'one', must: 'x' }, SYSTEM);
    await engine.insert('acase', { subject: 'two', must: 'x' }, SYSTEM);
    const said = error.mock.calls.filter((call) => String(call[0]).includes('read a record number'));
    expect(said).toHaveLength(1);
    expect(said[0][2]).toMatchObject({ object: 'acase', fields: ['display_title', 'headline'], driver: 'counter-fake' });
    // The documented degradation: the number lands, the reader is computed without it.
    expect(stored(storeFor, 'acase').map((r) => [r.case_number, r.display_title])).toEqual([
      ['CASE-00001', null],
      ['CASE-00002', null],
    ]);
  });
});
