// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21571] A row leaves the engine's read verbs carrying only the object's
 * DECLARED fields plus the platform-provisioned columns — whatever the driver
 * returned, on every door.
 *
 * ## Why a matrix over driver BEHAVIOURS
 *
 * The default projection is decided once, in the engine (`declared-read-columns.ts`),
 * so no driver may diverge from it. The way a driver could reintroduce the
 * defect is by returning more than it was asked for, and three shapes of that
 * are real:
 *
 *  - `whole row`   — ignores the projection and always returns the stored row;
 *  - `projection`  — honours an explicit projection, and answers no projection
 *                    with the whole row (`SELECT *`), as driver-sql does;
 *  - `ladder`      — honours a projection unless it names a column the table
 *                    does not have, and then retries with the whole row
 *                    (driver-sql's unresolvable-column recovery ladder).
 *
 * Every door runs the same assertion against each shape, so a door added later
 * is one row and a driver shape added later is one entry.
 *
 * ## The table
 *
 * `rq_contact` was created by an older declaration: its stored rows carry
 * `mailing_street` / `mailing_city`, which the current declaration retired.
 * The stored row also carries the registry-injected system columns, a
 * `password` field (masked on read, ADR-0100), an `internal: true` field
 * (omitted on read) and the inputs of a `formula` field — the declared fields
 * whose treatment must not move.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SECRET_MASK } from '@objectstack/spec/data';

import { ObjectQL } from './engine.js';

type Row = Record<string, unknown>;
type Behaviour = 'whole row' | 'projection' | 'ladder';

interface DriverAst {
  where?: Record<string, unknown>;
  fields?: string[];
  limit?: number;
}

function makeStoreDriver(behaviour: Behaviour) {
  const tables = new Map<string, Map<string, Row>>();
  const tableFor = (o: string): Map<string, Row> => {
    let t = tables.get(o);
    if (!t) { t = new Map<string, Row>(); tables.set(o, t); }
    return t;
  };
  const matches = (row: Row, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      if (v !== null && typeof v === 'object' && '$in' in (v as Row)) {
        if (!((v as { $in: unknown[] }).$in).includes(row[k])) return false;
        continue;
      }
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const run = (object: string, ast: DriverAst | undefined): Row[] => {
    let out = Array.from(tableFor(object).values()).filter((r) => matches(r, ast?.where));
    if (typeof ast?.limit === 'number') out = out.slice(0, ast.limit);
    const fields = Array.isArray(ast?.fields) && ast.fields.length > 0 ? ast.fields : undefined;
    // Physical columns = the keys every stored row of the table carries.
    const columns = new Set(Array.from(tableFor(object).values()).flatMap((r) => Object.keys(r)));
    const project = fields !== undefined
      && behaviour !== 'whole row'
      && !(behaviour === 'ladder' && fields.some((f) => !columns.has(f)));
    // Shallow copies either way — the `IDataDriver` contract.
    return project
      ? out.map((r) => Object.fromEntries(fields!.map((f) => [f, r[f]])))
      : out.map((r) => ({ ...r }));
  };
  let seq = 0;
  const driver = {
    name: `store-${behaviour.replace(' ', '-')}`, version: '0.0.0', supports: {},
    async connect(): Promise<void> {},
    async disconnect(): Promise<void> {},
    async checkHealth(): Promise<boolean> { return true; },
    async execute(): Promise<null> { return null; },
    async find(object: string, ast?: DriverAst): Promise<Row[]> { return run(object, ast); },
    async findOne(object: string, ast?: DriverAst): Promise<Row | null> { return run(object, ast)[0] ?? null; },
    async create(object: string, data: Row): Promise<Row> {
      seq += 1;
      const row: Row = { ...data, id: (data.id as string | undefined) ?? `new_${seq}` };
      tableFor(object).set(String(row.id), row);
      return { ...row };
    },
    async update(object: string, id: string, data: Row): Promise<Row> {
      const next: Row = { ...tableFor(object).get(id), ...data, id };
      tableFor(object).set(id, next);
      return { ...next };
    },
    async delete(object: string, id: string): Promise<boolean> { return tableFor(object).delete(id); },
    async count(object: string, ast?: DriverAst): Promise<number> { return run(object, ast).length; },
  };
  return {
    driver,
    seed: (object: string, row: Row) => { tableFor(object).set(String(row.id), { ...row }); },
    stored: (object: string, id: string) => tableFor(object).get(id),
  };
}

const CONTACT = 'rq_contact';
const ACCOUNT = 'rq_account';
const RETIRED = ['mailing_street', 'mailing_city'];

const SYSTEM = {
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  created_by: 'usr_1',
  updated_by: 'usr_1',
  organization_id: 'org_1',
  owner_id: 'usr_1',
};

async function boot(behaviour: Behaviour) {
  const engine = new ObjectQL();
  const store = makeStoreDriver(behaviour);
  engine.registerDriver(store.driver as never, true);
  await engine.init();
  engine.registry.registerObject({
    name: ACCOUNT,
    label: 'Account',
    fields: { name: { type: 'text' } },
  } as never, 'test');
  engine.registry.registerObject({
    name: CONTACT,
    label: 'Contact',
    fields: {
      name: { type: 'text' },
      account: { type: 'lookup', reference: ACCOUNT },
      score: { type: 'number' },
      // Declared, no column: what an explicit projection names to reach the
      // `ladder` shape's whole-row retry.
      nickname: { type: 'text' },
      pin: { type: 'password' },
      token: { type: 'text', internal: true },
      double_score: { type: 'formula', expression: { dialect: 'cel', source: 'record.score * 2' } },
    },
  } as never, 'test');

  store.seed(ACCOUNT, { id: 'acc_1', name: 'Acme', ...SYSTEM, legacy_region: 'retired' });
  store.seed(CONTACT, {
    id: 'con_1', name: 'Ada', account: 'acc_1', score: 21, pin: 'plain', token: 'hash',
    ...SYSTEM,
    mailing_street: '1 Retired Way', mailing_city: 'Oldtown',
  });
  return { engine, store, protocol: new ObjectStackProtocolImplementation(engine as never) };
}

/** Every record body a door can hand back, flattened, nested `expand` included. */
function recordsOf(value: unknown): Row[] {
  if (value == null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((v) => recordsOf(v));
  const row = value as Row;
  return [row, ...Object.values(row).filter((v) => v !== null && typeof v === 'object').flatMap(recordsOf)];
}

function expectNoRetiredColumn(value: unknown): void {
  const rows = recordsOf(value);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    for (const retired of [...RETIRED, 'legacy_region']) expect(Object.keys(row)).not.toContain(retired);
  }
}

describe.each<Behaviour>(['whole row', 'projection', 'ladder'])(
  '[#21571] a read serves the declared fields only — driver shape: %s',
  (behaviour) => {
    let h: Awaited<ReturnType<typeof boot>>;
    beforeEach(async () => { h = await boot(behaviour); });

    it('the fixture is real: the stored row DOES carry the retired columns', () => {
      expect(h.store.stored(CONTACT, 'con_1')).toMatchObject({ mailing_street: '1 Retired Way', mailing_city: 'Oldtown' });
    });

    it('door: find with no projection', async () => {
      expectNoRetiredColumn(await h.engine.find(CONTACT, {}));
    });

    it('door: find with no query at all', async () => {
      expectNoRetiredColumn(await h.engine.find(CONTACT));
    });

    it('door: findOne', async () => {
      expectNoRetiredColumn(await h.engine.findOne(CONTACT, { where: { id: 'con_1' } }));
    });

    it('door: an explicit projection naming a declared field with no column (the ladder rung)', async () => {
      const rows = await h.engine.find(CONTACT, { fields: ['name', 'nickname'] });
      expect(rows[0]).toMatchObject({ name: 'Ada' });
      expectNoRetiredColumn(rows);
    });

    it('door: an explicit projection naming ONLY a retired column', async () => {
      // The engine's unknown-plain tolerance drops the name and reads the
      // default projection; it must not read every column.
      const rows = await h.engine.find(CONTACT, { fields: ['mailing_street'] });
      expect(rows[0]).toMatchObject({ id: 'con_1', name: 'Ada' });
      expectNoRetiredColumn(rows);
    });

    it('door: expand — the related record is the related object\'s declared fields', async () => {
      const rows = await h.engine.find(CONTACT, { expand: { account: { object: ACCOUNT } } } as never);
      expect((rows[0]?.account as Row | undefined)?.name).toBe('Acme');
      expectNoRetiredColumn(rows);
    });

    it('door: findData — POST /data/:object/query and the list route', async () => {
      const res: any = await h.protocol.findData({ object: CONTACT, query: {} });
      expectNoRetiredColumn(res.records);
    });

    it('door: getData — GET /data/:object/:id', async () => {
      const res: any = await h.protocol.getData({ object: CONTACT, id: 'con_1' });
      expectNoRetiredColumn(res.record);
    });

    it('door: cloneData — the copy is made from the declared record', async () => {
      // The clone copies every key of the source read into an insert, and
      // the insert refuses a key the object does not declare: a source read
      // carrying a retired column made every clone of such a record fail.
      const res: any = await h.protocol.cloneData({ object: CONTACT, id: 'con_1', overrides: { name: 'Ada 2' } });
      expect(res.record).toMatchObject({ name: 'Ada 2' });
      expectNoRetiredColumn(res.record);
    });

    it('declared fields and system columns keep their treatment', async () => {
      const row = (await h.engine.findOne(CONTACT, { where: { id: 'con_1' } }))!;
      expect(row).toMatchObject({
        id: 'con_1', name: 'Ada', account: 'acc_1', score: 21,
        double_score: 42, // formula: computed after the shaping, from declared inputs
        pin: SECRET_MASK, // `password` on a generic object: masked, not dropped
        ...SYSTEM, // the registry-injected system columns and the provisioned three
      });
      expect(row).not.toHaveProperty('token'); // `internal: true`: omitted, as before
    });

    it('the driver\'s stored row is never mutated by the read', async () => {
      await h.engine.find(CONTACT, {});
      await h.engine.findOne(CONTACT, { where: { id: 'con_1' } });
      expect(h.store.stored(CONTACT, 'con_1')).toMatchObject({ mailing_street: '1 Retired Way', pin: 'plain', token: 'hash' });
    });
  },
);
