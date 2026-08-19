// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9469] An UNSCOPED `GET /api/v1/search` over a registry that holds a
 * FEDERATED object, with pinyin recall on.
 *
 * ## The defect
 *
 * The `__search` companion is a real column the platform promises to build:
 * the SchemaRegistry declares it at object compile time and the driver's
 * `syncSchema` materializes it as an additive migration (ADR-0045). On a
 * federated object (ADR-0015) that promise cannot be kept — the remote
 * database owns the schema, DDL is forbidden, and the schema-sync seam skips
 * the object entirely. The declaration went on anyway, so the object carried a
 * field with no column, and `expandSearchToFilter` — which keys the companion
 * clause on the DECLARED field — ORed `{ __search: { $contains: term } }` into
 * every `$search` against it. The backend then refused a statement it could
 * not compile (`no such column: __search` ⇒ `INVALID_FILTER` / 400, #8790).
 *
 * Measured on the stock showcase (two federated objects; `zh-CN` in
 * `supportedLocales` turns recall on), the compiled statement was, verbatim
 * from the server log:
 *
 * ```
 * select * from `customers` where ((lower(`name`) GLOB lower('*acme*')) or …
 *   or (`__search` GLOB '*acme*')) limit 5 - no such column: __search
 * ```
 *
 * Every source-column clause was fine; only the companion named a column that
 * does not exist. The UNSCOPED call is the one that sweeps every registered
 * object, so it is the one a direct API consumer meets — the console always
 * scopes to objects that are not federated and never saw it.
 *
 * ## What is pinned, and why in this shape
 *
 * The claim is about a RELATION between two seams — what the registry declares
 * and what the backend can compile — so a driver that answers any column
 * proves nothing. The driver below therefore holds a fixed column set per
 * table and refuses an unresolvable WHERE column with the ADR-0112 pair
 * `driver-sql` answers with (`INVALID_FILTER` / 400). `REFUSAL IS REAL` pins
 * that behaviour directly: without it every "did not refuse" assertion here
 * could pass because nothing in the harness refuses anything.
 *
 * The recall-ON case is the pinned one. Recall-OFF is asserted too and is
 * stated plainly: with `OS_SEARCH_PINYIN_ENABLED` off no companion is declared
 * on ANY object, so the unscoped sweep never had this failure — which is
 * exactly the isolation the card used to find the defect, and the reason the
 * flag changes the outcome.
 *
 * Anti-vacuity: "no 400" is worthless if the query could not have returned
 * anything, so every non-refusal assertion below also names the rows the sweep
 * must come back with, federated object included.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import type { ServiceObject } from '@objectstack/spec/data';

import { ObjectQL } from './engine.js';
import { SEARCH_COMPANION_FIELD } from './search-companion.js';

type Row = Record<string, unknown>;

interface DriverAst {
  where?: Record<string, unknown>;
  fields?: string[];
  limit?: number;
  offset?: number;
  orderBy?: Array<{ field: string; order?: string }>;
}

/**
 * Every column name a WHERE tree names, `$and` / `$or` walked. This is the
 * question the backend answers when it compiles the statement, asked over the
 * AST instead of over SQL.
 */
function whereColumns(where: unknown, out: Set<string> = new Set()): Set<string> {
  if (!where || typeof where !== 'object') return out;
  for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
    if (k === '$and' || k === '$or') {
      for (const child of (v as unknown[]) ?? []) whereColumns(child, out);
      continue;
    }
    if (k.startsWith('$')) continue;
    out.add(k);
  }
  return out;
}

/**
 * The ADR-0112 envelope `driver-sql` raises for a WHERE it could not compile
 * (`unsupportedFilterError` + `unresolvableFilterColumnError`, #8790). Code and
 * status both, never a bare throw — the pair is what the REST layer maps and
 * what a caller branches on.
 */
function unresolvableColumn(object: string, column: string): Error {
  const err = new Error(
    `Filter on '${column}' names a column that object '${object}' has no column for, `
      + 'so the predicate never ran.',
  ) as Error & { code?: string; status?: number };
  err.code = 'INVALID_FILTER';
  err.status = 400;
  return err;
}

/**
 * A store driver whose tables have a FIXED column set, like a real database.
 * A WHERE naming anything outside it is refused rather than silently ignored —
 * the behaviour that turns a declared-but-unbuilt column into a 400.
 */
function makeStrictDriver(name: string, columns: Record<string, readonly string[]>): {
  driver: unknown;
  seed(object: string, row: Row): void;
} {
  const rows = new Map<string, Map<string, Row>>();
  const tableFor = (o: string): Map<string, Row> => {
    let t = rows.get(o);
    if (!t) { t = new Map<string, Row>(); rows.set(o, t); }
    return t;
  };

  const matches = (row: Row, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and') {
        if (!(v as Array<Record<string, unknown>>).every((w) => matches(row, w))) return false;
        continue;
      }
      if (k === '$or') {
        if (!(v as Array<Record<string, unknown>>).some((w) => matches(row, w))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      if (v !== null && typeof v === 'object') {
        const cmp = v as Record<string, unknown>;
        // `$icontains` folds, `$contains` does not (#4706 Q2 = A). Executed
        // with different case rules on purpose: aligning them would let a
        // companion clause pass for a reason it does not have in production.
        if ('$icontains' in cmp) {
          if (!String(row[k] ?? '').toLowerCase().includes(String(cmp.$icontains).toLowerCase())) return false;
          continue;
        }
        if ('$contains' in cmp) {
          if (!String(row[k] ?? '').includes(String(cmp.$contains))) return false;
          continue;
        }
        if ('$in' in cmp) {
          if (!(cmp.$in as unknown[]).some((x) => x === row[k])) return false;
          continue;
        }
        if ('$eq' in cmp) {
          if (row[k] !== cmp.$eq) return false;
          continue;
        }
        continue;
      }
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };

  const run = (object: string, ast: DriverAst | undefined): Row[] => {
    const known = columns[object];
    if (known) {
      for (const col of whereColumns(ast?.where)) {
        if (!known.includes(col)) throw unresolvableColumn(object, col);
      }
    }
    let out = Array.from(tableFor(object).values()).filter((r) => matches(r, ast?.where));
    if (typeof ast?.offset === 'number' && ast.offset > 0) out = out.slice(ast.offset);
    if (typeof ast?.limit === 'number' && ast.limit >= 0) out = out.slice(0, ast.limit);
    return out.map((r) => ({ ...r }));
  };

  let seq = 0;
  const driver = {
    name, version: '0.0.0', supports: {},
    async connect(): Promise<void> {},
    async disconnect(): Promise<void> {},
    async checkHealth(): Promise<boolean> { return true; },
    async execute(): Promise<null> { return null; },
    async find(object: string, ast?: DriverAst): Promise<Row[]> { return run(object, ast); },
    async findOne(object: string, ast?: DriverAst): Promise<Row | null> { return run(object, ast)[0] ?? null; },
    async create(object: string, data: Row): Promise<Row> {
      seq += 1;
      const id = (data.id as string | undefined) ?? `r_${seq}`;
      tableFor(object).set(id, { ...data, id });
      return { ...data, id };
    },
    async update(object: string, id: string, data: Row): Promise<Row> {
      const table = tableFor(object);
      const next: Row = { ...(table.get(id) ?? {}), ...data, id };
      table.set(id, next);
      return { ...next };
    },
    async delete(object: string, id: string): Promise<boolean> { return tableFor(object).delete(id); },
    async count(object: string, ast?: DriverAst): Promise<number> { return run(object, ast).length; },
    async bulkCreate(object: string, batch: Row[]): Promise<Row[]> {
      const out: Row[] = [];
      for (const r of batch) out.push(await driver.create(object, r));
      return out;
    },
    async beginTransaction(): Promise<{ commit: () => Promise<void>; rollback: () => Promise<void> }> {
      return { commit: async () => {}, rollback: async () => {} };
    },
    async commit(): Promise<void> {},
    async rollback(): Promise<void> {},
  };

  return { driver, seed: (object, row) => { tableFor(object).set(String(row.id), { ...row }); } };
}

// ---------------------------------------------------------------------------
// The stock-showcase shapes: one managed object, one federated one.
// ---------------------------------------------------------------------------

const ACCOUNT = 'showcase_account';
const EXT_CUSTOMER = 'showcase_ext_customer';
const EXT_DATASOURCE = 'showcase_external';

const accountBase: ServiceObject = {
  name: ACCOUNT,
  label: 'Account',
  fields: {
    id: { type: 'text' },
    name: { type: 'text' },
    billing_email: { type: 'email' },
  },
};

/**
 * The showcase's federated customer, in the shape that matters here: an
 * `external` binding (ADR-0015 — the remote database owns the schema) and a
 * perfectly ordinary, perfectly eligible `name` field. The eligible name is
 * the point: this object is not skipped for want of a companion SOURCE, it is
 * skipped because the column could never be built.
 */
const extCustomerBase: ServiceObject = {
  name: EXT_CUSTOMER,
  label: 'External Customer',
  datasource: EXT_DATASOURCE,
  external: { remoteName: 'customers' },
  fields: {
    id: { type: 'text' },
    name: { type: 'text' },
    email: { type: 'email' },
    region: { type: 'text' },
  },
} as ServiceObject;

const CJK_NAME = '华宁科技';
const CJK_BLOB = 'huaningkeji hnkj';

/**
 * The remote table has no `__search` column and never can — that is the whole
 * federated case. The managed table does, because `syncSchema` built it.
 */
const COLUMNS: Record<string, readonly string[]> = {
  [ACCOUNT]: ['id', 'name', 'billing_email', 'updated_at', SEARCH_COMPANION_FIELD],
  [EXT_CUSTOMER]: ['id', 'name', 'email', 'region', 'updated_at'],
};

interface Harness {
  engine: ObjectQL;
  protocol: ObjectStackProtocolImplementation;
}

/**
 * Boots through the REAL registry seam with the REAL env var, rather than
 * hand-stamping the companion: the defect lives in what the registry decides
 * to declare, so a fixture that pre-decided it would pin nothing.
 */
async function makeHarness(recall: boolean): Promise<Harness> {
  process.env.OS_SEARCH_PINYIN_ENABLED = recall ? 'true' : 'false';

  const engine = new ObjectQL();
  // TWO datasources, as the real federated topology has: the managed default,
  // and the remote one the federated object is bound to. Drivers are keyed by
  // `driver.name`, so the second one's name IS the datasource name.
  const managedStore = makeStrictDriver('default', COLUMNS);
  const remoteStore = makeStrictDriver(EXT_DATASOURCE, COLUMNS);
  engine.registerDriver(managedStore.driver as never, true);
  engine.registerDriver(remoteStore.driver as never);
  await engine.init();
  engine.registry.registerObject(accountBase, 'test');
  engine.registry.registerObject(extCustomerBase, 'test');

  managedStore.seed(ACCOUNT, {
    id: 'acc_aurora', name: 'Aurora Holdings', billing_email: 'ap@aurora-holdings.example',
    updated_at: '2026-03-01T00:00:00.000Z',
  });
  managedStore.seed(ACCOUNT, {
    id: 'acc_cjk', name: CJK_NAME, billing_email: 'billing@huaning.example',
    updated_at: '2026-02-01T00:00:00.000Z',
    ...(recall ? { [SEARCH_COMPANION_FIELD]: CJK_BLOB } : {}),
  });
  remoteStore.seed(EXT_CUSTOMER, {
    id: 'c1', name: 'Aurora Labs', email: 'ap@aurora.example', region: 'NA',
    updated_at: '2026-01-01T00:00:00.000Z',
  });

  return { engine, protocol: new ObjectStackProtocolImplementation(engine as never) };
}

/** `GET /api/v1/search` with NO `objects=` — the failing configuration. */
async function unscoped(h: Harness, q: string): Promise<string[]> {
  const res = await h.protocol.searchAll({ q, perObject: 25, limit: 25 });
  return res.hits.map((hit) => `${hit.object}:${hit.id}`).sort();
}

const ENV = process.env.OS_SEARCH_PINYIN_ENABLED;
afterEach(() => {
  if (ENV === undefined) delete process.env.OS_SEARCH_PINYIN_ENABLED;
  else process.env.OS_SEARCH_PINYIN_ENABLED = ENV;
});

describe('[#9469] unscoped global search over a federated object, recall ON', () => {
  let h: Harness;
  beforeEach(async () => { h = await makeHarness(true); });

  it('REFUSAL IS REAL: the harness backend does refuse an unresolvable WHERE column', async () => {
    // Guards every "did not refuse" assertion in this file. Without it they
    // would all pass against a driver that quietly answers any column, and the
    // suite would be green on a tree where the defect is fully present.
    await expect(
      h.engine.find(EXT_CUSTOMER, { filter: { nosuchcol: { $eq: 'x' } } } as never),
    ).rejects.toMatchObject({ code: 'INVALID_FILTER', status: 400 });
  });

  it('the federated object carries NO companion column; the managed one does', async () => {
    // The mechanism, read at the seam that decides it. Both halves matter: the
    // capability must stay ON for objects the platform actually builds columns
    // for — a fix that withheld the companion everywhere would also make the
    // unscoped call stop refusing, and would be a silent capability retirement.
    const ext = h.engine.registry.getObject(EXT_CUSTOMER) as { fields: Record<string, unknown> };
    const managed = h.engine.registry.getObject(ACCOUNT) as { fields: Record<string, unknown> };
    expect(ext.fields[SEARCH_COMPANION_FIELD]).toBeUndefined();
    expect(managed.fields[SEARCH_COMPANION_FIELD]).toBeDefined();
  });

  it('answers the unscoped query with the rows it should, federated object included', async () => {
    // The card's own bar, measured rather than asserted as "not a 400": the
    // sweep returns the managed hit AND the federated hit for one term.
    await expect(unscoped(h, 'aurora')).resolves.toEqual([
      `${ACCOUNT}:acc_aurora`,
      `${EXT_CUSTOMER}:c1`,
    ]);
  });

  it('CONTROL: the scoped query the console issues is unaffected', async () => {
    // Passed before the fix and passes after — which is what makes the pin
    // above evidence about the UNSCOPED path specifically.
    const res = await h.protocol.searchAll({ q: 'aurora', objects: [ACCOUNT], perObject: 25, limit: 25 });
    expect(res.hits.map((hit) => `${hit.object}:${hit.id}`)).toEqual([`${ACCOUNT}:acc_aurora`]);
  });

  it('a `$search` on the federated object itself is served by its source columns', async () => {
    // The second face of the same defect: the ordinary list endpoint's
    // `?search=` refused too, on a call that never involved global search.
    const rows = await h.engine.find(EXT_CUSTOMER, { search: 'aurora', limit: 25 });
    expect(rows.map((r: Row) => r.id)).toEqual(['c1']);
  });

  it('pinyin recall still works where the column exists', async () => {
    // The capability is BOUNDED by this fix, not disabled: initials still
    // recall the CJK row on the managed object, through the unscoped sweep.
    await expect(unscoped(h, 'hnkj')).resolves.toEqual([`${ACCOUNT}:acc_cjk`]);
  });
});

describe('[#9469] recall OFF — the flag the card flipped to isolate the defect', () => {
  let h: Harness;
  beforeEach(async () => { h = await makeHarness(false); });

  it('declares no companion anywhere, so the unscoped sweep never had this failure', async () => {
    const managed = h.engine.registry.getObject(ACCOUNT) as { fields: Record<string, unknown> };
    expect(managed.fields[SEARCH_COMPANION_FIELD]).toBeUndefined();
    await expect(unscoped(h, 'aurora')).resolves.toEqual([
      `${ACCOUNT}:acc_aurora`,
      `${EXT_CUSTOMER}:c1`,
    ]);
  });

  it('and pinyin initials recall nothing, which is why the flag changed the outcome', async () => {
    await expect(unscoped(h, 'hnkj')).resolves.toEqual([]);
  });
});
