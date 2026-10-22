// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25073 — the `__search` companion of a name field that reads the record
 * number carries the number.
 *
 * The companion is stamped in `beforeInsert` from the name field. A name field
 * whose stored `expression` reads an `autonumber` is computed there BEFORE the
 * number exists, and computed again once the engine issues it (after
 * validation). Measured on this branch before the listener below, over
 * SQLite (`SqlDriver`) and driver-memory alike, with `nameField` the stored
 * title: `"CASE-00001 - 张伟"` stored beside `__search: null`, so `$search`
 * found the record neither by pinyin nor by its number; the `has()` shape
 * stored `"PRD-0001 茶杯"` beside `"chabei cb"`.
 *
 * The plugin now also listens on the engine's insert recompute
 * (`registerInsertRecomputeListener`) and stamps the companion again from the
 * recomputed value, on the row the driver is handed — one write. This drives
 * the REAL engine over a hand-rolled driver (both record-number issuers), so
 * no driver package is imported.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { bindSearchCompanionHooks } from './companion-projection.js';

type Row = Record<string, any>;

const CASE = {
  name: 'scase',
  nameField: 'display_title',
  fields: {
    subject: { type: 'text' },
    case_number: { type: 'autonumber', format: 'CASE-{00000}' },
    display_title: { type: 'text', expression: { dialect: 'cel', source: 'record.case_number + " - " + record.subject' } },
  },
};

const PRODUCT = {
  name: 'sproduct',
  nameField: 'title',
  fields: {
    name: { type: 'text' },
    product_code: { type: 'autonumber', format: 'PRD-{0000}' },
    title: { type: 'text', expression: { dialect: 'cel', source: 'has(record.product_code) ? record.product_code + " " + record.name : record.name' } },
  },
};

/** Control: the name field is plain text, so the recomputed title is not a companion source. */
const TICKET = {
  name: 'sticket',
  nameField: 'subject',
  fields: {
    subject: { type: 'text' },
    ticket_number: { type: 'autonumber', format: 'T-{000}' },
    label: { type: 'text', expression: { dialect: 'cel', source: 'record.ticket_number + " " + record.subject' } },
  },
};

/** Control: no eligible name field, so no companion column is provisioned at all. */
const MEMO = {
  name: 'smemo',
  nameField: 'secret',
  fields: {
    secret: { type: 'text', hidden: true },
    memo_number: { type: 'autonumber', format: 'M-{000}' },
    label: { type: 'text', expression: { dialect: 'cel', source: 'record.memo_number + " " + record.secret' } },
  },
};

const AUTONUMBERS: Record<string, [field: string, prefix: string, width: number]> = {
  scase: ['case_number', 'CASE-', 5],
  sproduct: ['product_code', 'PRD-', 4],
  sticket: ['ticket_number', 'T-', 3],
  smemo: ['memo_number', 'M-', 3],
};

function cond(value: unknown, c: unknown): boolean {
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return value === c;
  return Object.entries(c as Record<string, unknown>).every(([op, t]) => {
    switch (op) {
      case '$eq': return value === t;
      case '$startsWith': return typeof value === 'string' && value.startsWith(String(t));
      case '$gt': return value != null && String(value) > String(t);
      case '$contains': return typeof value === 'string' && value.includes(String(t));
      case '$icontains': return typeof value === 'string' && value.toLowerCase().includes(String(t).toLowerCase());
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

/** `engine`: leaves the number to the engine. `driver`: owns a counter and issues it through the member. */
function makeDriver(issuer: 'engine' | 'driver') {
  const stores = new Map<string, Row[]>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = []; stores.set(o, s); }
    return s;
  };
  const counters = new Map<string, number>();
  const fill = (object: string, row: Row): string[] => {
    const [field, prefix, width] = AUTONUMBERS[object];
    if (row[field] != null && row[field] !== '') return [];
    const next = (counters.get(object) ?? 0) + 1;
    counters.set(object, next);
    row[field] = `${prefix}${String(next).padStart(width, '0')}`;
    return [field];
  };
  let n = 0;
  const write = (object: string, data: Row) => {
    const row = { ...data, id: data.id ?? `r_${++n}` };
    if (issuer === 'driver') fill(object, row);
    storeFor(object).push(row);
    return { ...row };
  };
  const driver: any = {
    name: `${issuer}-fake`,
    version: '0.0.0',
    supports: issuer === 'engine' ? {} : { autonumber: true },
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      let rows = storeFor(object).filter((r) => matches(r, ast?.where));
      if (typeof ast?.limit === 'number') rows = rows.slice(0, ast.limit);
      return rows.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      const row = storeFor(object).find((r) => matches(r, ast?.where));
      return row ? { ...row } : null;
    },
    async create(object: string, data: Row) { return write(object, data); },
    async bulkCreate(object: string, rows: Row[]) { return rows.map((r) => write(object, r)); },
    async update(object: string, id: string, data: Row) {
      const s = storeFor(object);
      const i = s.findIndex((r) => r.id === id);
      s[i] = { ...s[i], ...data, id };
      return { ...s[i] };
    },
    async delete() { return true; },
    async count(object: string, ast: any) { return storeFor(object).filter((r) => matches(r, ast?.where)).length; },
  };
  if (issuer === 'driver') {
    driver.issueAutonumbers = async (object: string, rows: Row[], _options?: unknown, afterCollision?: unknown) =>
      afterCollision === undefined ? rows.map((row) => fill(object, row)) : rows.map(() => []);
  }
  return { driver, storeFor };
}

const SYSTEM = { context: { isSystem: true } } as any;
const quiet = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let pinyinSwitch: string | undefined;
beforeAll(() => {
  pinyinSwitch = process.env.OS_SEARCH_PINYIN_ENABLED;
  process.env.OS_SEARCH_PINYIN_ENABLED = 'true';
});
afterAll(() => {
  if (pinyinSwitch === undefined) delete process.env.OS_SEARCH_PINYIN_ENABLED;
  else process.env.OS_SEARCH_PINYIN_ENABLED = pinyinSwitch;
});

async function boot(issuer: 'engine' | 'driver') {
  const engine = new ObjectQL();
  const { driver, storeFor } = makeDriver(issuer);
  engine.registerDriver(driver, true);
  await engine.init();
  for (const schema of [CASE, PRODUCT, TICKET, MEMO]) engine.registry.registerObject(schema as any);
  bindSearchCompanionHooks(engine as any, quiet);
  return { engine, storeFor };
}

const searchCount = async (engine: ObjectQL, object: string, term: string) =>
  ((await engine.find(object, { search: term }, SYSTEM)) as unknown[]).length;

describe.each(['engine', 'driver'] as const)('the __search companion of a name field reading the record number (#25073), %s-issued', (issuer) => {
  it('carries the number on the concatenation shape, and $search finds the record by pinyin and by number', async () => {
    const { engine, storeFor } = await boot(issuer);
    await engine.insert('scase', { subject: '张伟' }, SYSTEM);
    expect(storeFor('scase')[0]).toMatchObject({
      display_title: 'CASE-00001 - 张伟',
      __search: 'case00001zhangwei case00001zw',
    });
    expect(await searchCount(engine, 'scase', 'zhangwei')).toBe(1);
    expect(await searchCount(engine, 'scase', 'case00001')).toBe(1);
  });

  it('carries the number on the has() shape', async () => {
    const { engine, storeFor } = await boot(issuer);
    await engine.insert('sproduct', { name: '茶杯' }, SYSTEM);
    expect(storeFor('sproduct')[0]).toMatchObject({ title: 'PRD-0001 茶杯', __search: 'prd0001chabei prd0001cb' });
    expect(await searchCount(engine, 'sproduct', 'prd0001')).toBe(1);
  });

  it('carries each row\'s own number in a batch', async () => {
    const { engine, storeFor } = await boot(issuer);
    await engine.insert('scase', [{ subject: '张伟' }, { subject: '李娜' }], SYSTEM);
    expect(storeFor('scase').map((r) => r.__search)).toEqual(['case00001zhangwei case00001zw', 'case00002lina case00002ln']);
  });

  describe('controls', () => {
    it('leaves a companion whose source the recompute did not touch as beforeInsert stamped it', async () => {
      const { engine, storeFor } = await boot(issuer);
      await engine.insert('sticket', { subject: '张伟' }, SYSTEM);
      expect(storeFor('sticket')[0]).toMatchObject({ label: 'T-001 张伟', __search: 'zhangwei zw' });
    });

    it('writes no companion on an object that has no companion column', async () => {
      const { engine, storeFor } = await boot(issuer);
      expect(engine.registry.getObject('smemo')?.fields).not.toHaveProperty('__search');
      await engine.insert('smemo', { secret: '张伟' }, SYSTEM);
      expect(storeFor('smemo')[0]).toMatchObject({ label: 'M-001 张伟' });
      expect(storeFor('smemo')[0]).not.toHaveProperty('__search');
    });
  });
});
