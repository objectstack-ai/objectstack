// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29538] A write answers the record the next read answers, on every driver:
 * a declared column the write never touched is `null` in the insert and
 * update answer, as it is on the following `findOne` (#29408) — and a column
 * field-level security refuses the writer stays ABSENT from both.
 *
 * Measured on `origin/main` before the fix, through the engine and the
 * protocol doors (insert, batch insert, `insertMany`, update by id,
 * `createData`, `updateData`, `createManyData`, `updateManyData`, and
 * `batchData` create / update / both upsert arms): driver-sql answered every
 * write exactly as its next `findOne`; driver-memory and driver-mongodb
 * answered each unwritten declared column as a MISSING key that the next read
 * answered `null`, and a formula over it as `null` (a fault) that the next
 * read answered with its value.
 *
 * Two drivers here. driver-sql (SQLite), where the write and the read were
 * already the same — the parity control. And a stub that stores and echoes
 * only the keys a write carried — the driver-mongodb / driver-memory shape
 * (driver-memory itself is not bound: a new test consumer of it is a
 * maintainer ruling, `check:driver-memory-census`; driver-mongodb is pinned
 * in its own package). On that stub the engine's fill is what puts `note` in
 * the answer, so it is where the field-level pin bites: the security plugin
 * is composed with a member who may not read `secret`, and the fill must run
 * inside the verb, before the security middleware's field mask deletes the
 * refused key — a refused column reappearing as `null` would tell the member
 * the field exists and is empty. A system write of the same shape is the
 * control: there `secret` is a readable unwritten column, answered `null`.
 *
 * Reads `@objectstack/objectql` from its built `dist/`, as every runtime suite
 * does: rebuild objectql before trusting a run of this file.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { installDefaultOrganization } from './default-organization.testkit.js';

type Row = Record<string, unknown>;

const LEDGER = 'nk_null_write_ledger';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };

const MEMBER_SET = PermissionSetSchema.parse({
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  fields: { [`${LEDGER}.secret`]: { readable: false, editable: false } },
});

const MEMBER_CTX = { userId: 'usr_member', positions: [] as string[], permissions: [MEMBER_SET.name], posture: 'MEMBER' as const };

const own = (row: unknown, key: string): boolean =>
  row != null && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, key);

/**
 * Stores only the keys a write carried and echoes the stored row — no key for
 * a column the write did not touch. Equality on plain keys only; any operator
 * is REFUSED, never read as a field name.
 */
function makeSparseDriver() {
  const tables = new Map<string, Map<string, Row>>();
  const tableFor = (o: string): Map<string, Row> => {
    let t = tables.get(o);
    if (!t) { t = new Map<string, Row>(); tables.set(o, t); }
    return t;
  };
  const matches = (row: Row, where: Row | undefined): boolean => {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) throw new Error(`sparse driver: filter operator ${k} is not implemented`);
      if (v !== null && typeof v === 'object') throw new Error(`sparse driver: operator on ${k} is not implemented`);
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const run = (object: string, ast: { where?: Row; fields?: string[]; limit?: number } | undefined): Row[] => {
    let out = Array.from(tableFor(object).values()).filter((r) => matches(r, ast?.where));
    if (typeof ast?.limit === 'number') out = out.slice(0, ast.limit);
    const fields = Array.isArray(ast?.fields) && ast.fields.length > 0 ? ast.fields : undefined;
    return out.map((r) => (fields
      ? Object.fromEntries(Object.entries(r).filter(([k]) => k === 'id' || fields.includes(k)))
      : { ...r }));
  };
  const stored = (data: Row): Row => Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  let seq = 0;
  return {
    name: 'memory', version: '0.0.0', supports: {},
    async connect(): Promise<void> {},
    async disconnect(): Promise<void> {},
    async checkHealth(): Promise<boolean> { return true; },
    async execute(): Promise<null> { return null; },
    async find(object: string, ast?: { where?: Row; fields?: string[]; limit?: number }): Promise<Row[]> { return run(object, ast); },
    async findOne(object: string, ast?: { where?: Row; fields?: string[]; limit?: number }): Promise<Row | null> { return run(object, ast)[0] ?? null; },
    async create(object: string, data: Row): Promise<Row> {
      seq += 1;
      const row: Row = { ...stored(data), id: (data.id as string | undefined) ?? `sp_${seq}` };
      tableFor(object).set(String(row.id), row);
      return { ...row };
    },
    async update(object: string, id: string, data: Row): Promise<Row | null> {
      const prior = tableFor(object).get(id);
      if (!prior) return null;
      const next: Row = { ...prior, ...stored(data), id };
      tableFor(object).set(id, next);
      return { ...next };
    },
    async delete(object: string, id: string): Promise<boolean> { return tableFor(object).delete(id); },
    async count(object: string, ast?: { where?: Row }): Promise<number> { return run(object, ast).length; },
    async syncSchema(): Promise<void> {},
  };
}

const DRIVERS: Array<[string, () => unknown]> = [
  ['driver-sql (SQLite)', () => new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never)],
  ['a driver that echoes only written keys (driver-mongodb / driver-memory shape)', makeSparseDriver],
];

describe.each(DRIVERS)('[#29538] the write answer is the next read — %s', (_label, makeDriver) => {
  let engine: ObjectQL;
  let seq = 0;
  const nextId = () => `nkw_${++seq}`;

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeDriver() as never, true);
    await engine.init();
    engine.registerApp({
      id: 'com.objectstack.qa.declared-column-null-on-write',
      name: 'Declared column null on write',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [
        {
          name: LEDGER,
          label: 'Ledger',
          sharingModel: 'public_read_write',
          fields: {
            title: { name: 'title', type: 'text' },
            note: { name: 'note', type: 'text' },
            secret: { name: 'secret', type: 'text' },
            qty: { name: 'qty', type: 'number' },
            doubled: { name: 'doubled', type: 'formula', expression: { dialect: 'cel', source: 'record.qty != null ? record.qty * 2 : -1' } },
          },
        },
      ],
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    const services: Record<string, unknown> = {
      manifest: { register: vi.fn() },
      objectql: engine,
      metadata: {
        get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
        list: async () => [MEMBER_SET],
      },
    };
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: vi.fn(),
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
    vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
  }, 60_000);

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const readBack = (id: unknown, context: unknown) =>
    engine.findOne(LEDGER, { where: { id }, context } as never);

  it('member insert: the answer deep-equals the next findOne, the unwritten column null', async () => {
    const answer = await engine.insert(LEDGER, { id: nextId(), title: 'written' }, { context: MEMBER_CTX } as never) as Row;
    expect(answer).toStrictEqual(await readBack(answer.id, MEMBER_CTX));
    expect(own(answer, 'note')).toBe(true);
    expect(answer.note).toBeNull();
    expect(answer.doubled).toBe(-1);
  });

  it('member update by id: the answer deep-equals the next findOne, the unwritten column null', async () => {
    const id = nextId();
    await engine.insert(LEDGER, { id, title: 'written' }, { context: SYS_CTX } as never);
    const answer = await engine.update(LEDGER, { id, title: 'edited' }, { context: MEMBER_CTX } as never) as Row;
    expect(answer).toStrictEqual(await readBack(id, MEMBER_CTX));
    expect(own(answer, 'note')).toBe(true);
    expect(answer.note).toBeNull();
    expect(answer.doubled).toBe(-1);
  });

  it('FLS-REFUSED stays absent: a column the member may not read never appears in the member\'s write answer', async () => {
    const created = await engine.insert(LEDGER, { id: nextId(), title: 'written' }, { context: MEMBER_CTX } as never) as Row;
    expect(own(created, 'secret')).toBe(false);
    const batch = await engine.insert(LEDGER, [{ id: nextId(), title: 'b' }], { context: MEMBER_CTX } as never) as Row[];
    expect(own(batch[0], 'secret')).toBe(false);
    const updated = await engine.update(LEDGER, { id: created.id, title: 'edited' }, { context: MEMBER_CTX } as never) as Row;
    expect(own(updated, 'secret')).toBe(false);
    // …while the readable unwritten column beside it is answered.
    expect(own(updated, 'note')).toBe(true);
  });

  it('control: the same column, written and answered to the system, is a readable unwritten column and answers null', async () => {
    const created = await engine.insert(LEDGER, { id: nextId(), title: 'written' }, { context: SYS_CTX } as never) as Row;
    expect(own(created, 'secret')).toBe(true);
    expect(created.secret).toBeNull();
    expect(created).toStrictEqual(await readBack(created.id, SYS_CTX));
  });
});
