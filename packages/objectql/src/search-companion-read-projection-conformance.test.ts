// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7642] The hidden `__search` companion column never leaves the engine
 * through the default projection — on ANY door.
 *
 * ## The defect
 *
 * `provisionSearchCompanion` declares the column `hidden` + `readonly` +
 * `system` + `searchable: false`, and every one of those flags does something
 * real: the column stays out of auto-views, out of the `$search` auto-default,
 * and a `$searchFields` override that names it is refused with a 400 ("is
 * hidden"). None of them is a PROJECTION rule. A query naming no `fields`
 * reaches the driver with `ast.fields` undefined, every driver answers that
 * with `SELECT *`, and so `__search` came back in every record body the QA run
 * looked at: list results, GET by id, `/search` hits and the 201 create body.
 *
 * ## Why this suite is a MATRIX and not a test per door
 *
 * There is one contract ("clients never see this column") and at least five
 * places that can honour or break it independently — `find`, `findOne`, the
 * nested records `expand` produces, the create response and the update
 * response. That is exactly the shape that rots one door at a time: the read
 * path gets fixed, the write path keeps echoing, and nothing fails. So every
 * door runs the SAME assertion from the same table below, and a door added
 * later is one row.
 *
 * `GET /api/v1/search` is not directly reachable from this package — it is
 * served by `MetadataProtocol.searchAll` (@objectstack/metadata-protocol),
 * which builds a `where`/`orderBy`/`limit` query with NO `fields` and returns
 * `engine.find`'s rows verbatim as `hit.record`. The `search-shaped read` row
 * below is that call, spelled the way `searchAll` spells it.
 *
 * ## The two provisioning states, both of which must strip
 *
 * The QA report's sharpest detail is that the symptom SURVIVED a restart with
 * `OS_SEARCH_PINYIN_ENABLED=false`. That is not a stale-process artifact: with
 * the switch off the registry stops DECLARING the field, but the physical
 * column and its stored values remain (ADR-0045 migrations are additive) and
 * `SELECT *` keeps returning them. A strip gated on `schema.fields.__search`
 * would therefore be silent in precisely the deployment that filed the bug —
 * so both states are pinned here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import type { EngineQueryOptions, ServiceObject } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { ObjectQL } from './engine.js';
import { SEARCH_COMPANION_FIELD, provisionSearchCompanion } from './search-companion.js';

// ---------------------------------------------------------------------------
// A driver that stores whole rows and honours an explicit projection, so a
// `fields`-less read really is `SELECT *` and the companion really does ride
// back — the condition the defect needs. Rows handed out are shallow copies
// (the `IDataDriver` contract; see `MemoryDriver.find`), so an engine-side
// in-place strip cannot corrupt the store — asserted at the bottom.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface DriverAst {
  where?: Record<string, unknown>;
  fields?: string[];
  limit?: number;
  offset?: number;
  orderBy?: Array<{ field: string; order?: string }>;
}

interface StoreDriver {
  rows: Map<string, Map<string, Row>>;
  /** Write a row straight into the backing table, bypassing the engine. */
  seed(object: string, row: Row): void;
  /** Read a row straight out of the backing table, bypassing the engine. */
  stored(object: string, id: string): Row | undefined;
}

function makeStoreDriver(): { driver: unknown } & StoreDriver {
  const rows = new Map<string, Map<string, Row>>();
  const tableFor = (o: string): Map<string, Row> => {
    let t = rows.get(o);
    if (!t) { t = new Map<string, Row>(); rows.set(o, t); }
    return t;
  };
  let seq = 0;

  const matches = (row: Row, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      // `$and` / `$or` are CONJOINED with their sibling keys, the way a real
      // driver reads them — never `return`ed, which would discard every
      // sibling the loop has not reached yet (#7620 / #8494).
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
        if ('$contains' in cmp) {
          const needle = String(cmp.$contains).toLowerCase();
          if (!String(row[k] ?? '').toLowerCase().includes(needle)) return false;
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
    let out = Array.from(tableFor(object).values()).filter((r) => matches(r, ast?.where));
    if (typeof ast?.offset === 'number' && ast.offset > 0) out = out.slice(ast.offset);
    if (typeof ast?.limit === 'number' && ast.limit >= 0) out = out.slice(0, ast.limit);
    // Projection honoured exactly (SqlDriver semantics); absent ⇒ SELECT *,
    // which is the whole point of this suite. Shallow copies either way.
    return Array.isArray(ast?.fields) && ast.fields.length > 0
      ? out.map((r) => Object.fromEntries(ast.fields!.map((f) => [f, r[f]])))
      : out.map((r) => ({ ...r }));
  };

  const driver = {
    name: 'store', version: '0.0.0', supports: {},
    async connect(): Promise<void> {},
    async disconnect(): Promise<void> {},
    async checkHealth(): Promise<boolean> { return true; },
    async execute(): Promise<null> { return null; },
    async find(object: string, ast?: DriverAst): Promise<Row[]> { return run(object, ast); },
    async findOne(object: string, ast?: DriverAst): Promise<Row | null> { return run(object, ast)[0] ?? null; },
    async create(object: string, data: Row): Promise<Row> {
      seq += 1;
      const id = (data.id as string | undefined) ?? `r_${seq}`;
      const row: Row = { ...data, id };
      tableFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Row): Promise<Row> {
      const table = tableFor(object);
      const current = table.get(id);
      if (!current) throw new Error(`not found: ${object}/${id}`);
      const next: Row = { ...current, ...data, id };
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

  return {
    driver,
    rows,
    seed: (object, row) => { tableFor(object).set(String(row.id), { ...row }); },
    stored: (object, id) => tableFor(object).get(id),
  };
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

const CONTACT = 'showcase_contact';
const ACCOUNT = 'showcase_account';

/** The QA repro's own value: full pinyin + initials for 张伟. */
const BLOB = 'zhangwei zw';

const contactBase: ServiceObject = {
  name: CONTACT,
  label: 'Contact',
  fields: {
    id: { type: 'text' },
    name: { type: 'text' },
    account: { type: 'lookup', reference: ACCOUNT },
    // A formula field is present ON PURPOSE: `planFormulaProjection` widens an
    // explicit projection to every stored column — companion included — so a
    // strip that read the POST-planning `ast.fields` would conclude the caller
    // had asked for `__search` and hand it back. Pinned below.
    shout: { type: 'formula', expression: { dialect: 'cel', source: 'record.name' } },
  },
};

const accountBase: ServiceObject = {
  name: ACCOUNT,
  label: 'Account',
  fields: {
    id: { type: 'text' },
    name: { type: 'text' },
  },
};

/** `OS_SEARCH_PINYIN_ENABLED=true`: the registry declares the column. */
const contactProvisioned = provisionSearchCompanion(contactBase);
const accountProvisioned = provisionSearchCompanion(accountBase);

const SYSTEM_CTX: ExecutionContext = { isSystem: true, positions: [], permissions: [] } as ExecutionContext;

interface Harness {
  engine: ObjectQL;
  store: StoreDriver;
}

/**
 * @param declared  whether the registry declares `__search` on the object —
 *                  i.e. whether `OS_SEARCH_PINYIN_ENABLED` was on at boot.
 */
async function makeEngine(declared: boolean): Promise<Harness> {
  const engine = new ObjectQL();
  const store = makeStoreDriver();
  engine.registerDriver(store.driver as never, true);
  await engine.init();
  engine.registry.registerObject(declared ? contactProvisioned : contactBase, 'test');
  engine.registry.registerObject(declared ? accountProvisioned : accountBase, 'test');
  return { engine, store };
}

/** The `plugin-pinyin-search` write hook, in miniature. */
function bindCompanionStamp(engine: ObjectQL): void {
  const stamp = (ctx: { input?: { data?: unknown } }): void => {
    const data = ctx?.input?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const row = data as Row;
    if (!('name' in row)) return;
    row[SEARCH_COMPANION_FIELD] = BLOB;
  };
  engine.registerHook('beforeInsert', stamp, { packageId: 'test:companion' });
  engine.registerHook('beforeUpdate', stamp, { packageId: 'test:companion' });
}

/** Every record body a door can hand back, flattened for one assertion. */
function recordsOf(value: unknown): Row[] {
  if (value == null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((v) => recordsOf(v));
  return [value as Row];
}

function expectNoCompanion(value: unknown): void {
  for (const row of recordsOf(value)) {
    expect(Object.keys(row)).not.toContain(SEARCH_COMPANION_FIELD);
  }
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe.each([
  ['column declared by the registry (OS_SEARCH_PINYIN_ENABLED=true)', true],
  ['column NOT declared — stored rows still carry it (restart with OS_SEARCH_PINYIN_ENABLED=false)', false],
])('[#7642] `__search` never reaches a caller — %s', (_label, declared) => {
  let engine: ObjectQL;
  let store: StoreDriver;
  let contactId: string;

  beforeEach(async () => {
    const harness = await makeEngine(declared);
    engine = harness.engine;
    store = harness.store;

    // The row is SEEDED through the driver in both states: with the column
    // undeclared the engine would refuse (or strip) an unknown key on insert,
    // and "the column exists in the table but not in the metadata" is exactly
    // the state the flag-off restart leaves behind. The create-body door
    // below writes through the engine instead, where the stamp applies.
    store.seed(ACCOUNT, { id: 'acc_1', name: '华宁科技', [SEARCH_COMPANION_FIELD]: 'huaningkeji hnkj' });
    contactId = 'con_1';
    store.seed(CONTACT, { id: contactId, name: '张伟', account: 'acc_1', [SEARCH_COMPANION_FIELD]: BLOB });
  });

  it('the fixture is real: the stored row DOES carry the column', () => {
    // Guards the suite against passing vacuously — every assertion below is
    // "the engine removed it", which is worthless if it was never there.
    expect(store.stored(CONTACT, contactId)).toHaveProperty(SEARCH_COMPANION_FIELD, BLOB);
  });

  it('door: find — POST /data/:object/query', async () => {
    const rows = await engine.find(CONTACT, { where: { id: contactId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('张伟');
    expectNoCompanion(rows);
  });

  it('door: find with no query at all — the bare list read', async () => {
    expectNoCompanion(await engine.find(CONTACT));
  });

  it('door: findOne — GET /data/:object/:id', async () => {
    const row = await engine.findOne(CONTACT, { where: { id: contactId } });
    expect(row?.name).toBe('张伟');
    expectNoCompanion(row);
  });

  it('door: the search-shaped read — GET /api/v1/search hits', async () => {
    // `MetadataProtocol.searchAll`'s query, verbatim in shape: a `$contains`
    // predicate, a limit, an `updated_at` sort — and no `fields`. Its rows
    // become `hit.record` untouched.
    const query: EngineQueryOptions = {
      where: { name: { $contains: '张' } },
      limit: 5,
      orderBy: [{ field: 'name', order: 'desc' }],
    };
    const hits = await engine.find(CONTACT, query);
    expect(hits).toHaveLength(1);
    expectNoCompanion(hits);
  });

  it('door: the 201 create body', async () => {
    bindCompanionStamp(engine);
    const created = await engine.insert(CONTACT, { name: '李娜' });
    expect(created?.id).toBeTruthy();
    expectNoCompanion(created);
  });

  it('door: the update response body', async () => {
    bindCompanionStamp(engine);
    const updated = await engine.update(CONTACT, { id: contactId, name: '张伟明' });
    expect(updated?.name).toBe('张伟明');
    expectNoCompanion(updated);
  });

  it('door: records nested by expand', async () => {
    const rows = await engine.find(CONTACT, {
      where: { id: contactId },
      expand: { account: { object: ACCOUNT } },
    });
    // The expansion is what is under test — if it did not happen there is no
    // nested body to have stripped, and the assertion would pass vacuously.
    expect(rows[0]?.account).toBeTypeOf('object');
    expectNoCompanion(rows[0]?.account);
  });

  it('an explicit projection that widens through a formula still strips it', async () => {
    // `shout` is a formula, so `planFormulaProjection` rewrites `ast.fields`
    // to every stored column — `__search` among them. The strip must read the
    // CALLER's projection, not the planned one.
    const rows = await engine.find(CONTACT, { where: { id: contactId }, fields: ['id', 'shout'] });
    expect(rows[0]?.shout).toBe('张伟');
    expectNoCompanion(rows);
  });

  it('a non-system caller cannot opt back in by naming the column', async () => {
    // `select` only gates on whether a field is KNOWN, so once the column is
    // provisioned `?select=__search` sails through `assertProjectionFieldsExist`.
    // If that spelling still returned the value, the strip would be advisory.
    const rows = await engine.find(CONTACT, {
      where: { id: contactId },
      fields: ['id', SEARCH_COMPANION_FIELD],
    });
    expect(rows).toHaveLength(1);
    expectNoCompanion(rows);
  });

  it('the strip does not write through to the stored row', async () => {
    await engine.find(CONTACT, { where: { id: contactId } });
    await engine.findOne(CONTACT, { where: { id: contactId } });
    // The engine strips in place (as secret-masking does) and relies on the
    // driver contract that read rows are copies. A driver-side regression here
    // would silently destroy the index instead of hiding it.
    expect(store.stored(CONTACT, contactId)).toHaveProperty(SEARCH_COMPANION_FIELD, BLOB);
  });
});

// ---------------------------------------------------------------------------
// The one caller that MUST keep reading the column.
// ---------------------------------------------------------------------------

describe('[#7642] the system backfill keeps its read of `__search`', () => {
  it('a system caller that names the column in `fields` still gets it', async () => {
    // `plugin-pinyin-search`'s backfill/reconcile walk projects
    // `['id', ...sources, '__search']` under `{ isSystem: true }` and compares
    // the stored blob against a freshly computed one. Strip that and the
    // comparison reads `undefined` every pass, so the walk rewrites every row
    // of every object on every run — write amplification traded for a
    // disclosure fix, on a column whose disclosure risk the issue rates low.
    const { engine, store } = await makeEngine(true);
    store.seed(CONTACT, { id: 'con_1', name: '张伟', [SEARCH_COMPANION_FIELD]: BLOB });

    const query: EngineQueryOptions = {
      fields: ['id', 'name', SEARCH_COMPANION_FIELD],
      context: SYSTEM_CTX,
    };
    const rows = await engine.find(CONTACT, query);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.[SEARCH_COMPANION_FIELD]).toBe(BLOB);
  });

  it('…but a system caller that did NOT name it does not get it either', async () => {
    // The exemption is "asked for it", not "is privileged" — a system-context
    // read with a default projection is still a default projection.
    const { engine, store } = await makeEngine(true);
    store.seed(CONTACT, { id: 'con_1', name: '张伟', [SEARCH_COMPANION_FIELD]: BLOB });

    const query: EngineQueryOptions = { context: SYSTEM_CTX };
    expectNoCompanion(await engine.find(CONTACT, query));
  });
});

// ---------------------------------------------------------------------------
// The OTHER door on the same column — the one this suite's docblock cites but
// never exercised.
// ---------------------------------------------------------------------------

/**
 * [#8080] `$searchFields=__search` is a 400, and it is asserted HERE.
 *
 * ## Why this pin exists
 *
 * Four docblocks in this tree state that a `$searchFields` override naming the
 * companion "is refused with a 400 (\"is hidden\")" — this suite's own header,
 * {@link stripSearchCompanion}'s, and `stripSearchCompanionFromRead`'s twice
 * (the pre-existing sentence and the #7876 ruling block). Until now no test
 * named this column and that refusal in the same assertion. The behaviour was
 * only ever reachable by COMPOSING two separately-pinned facts —
 * `resolveSearchFields` excludes hidden fields (`search-companion.test.ts`),
 * and the ingress gate refuses a known-but-unsearchable name with
 * `400 INVALID_FIELD` (`query-expression-conformance.test.ts`, on `estimate`).
 * A composition is not a pin: a change that let hidden columns clear the
 * searchability gate would leave all four docblocks false with every suite
 * green.
 *
 * That matters more since #7876 (ruled 2026-08-12, direction C) made this 400
 * load-bearing AS A CONTRAST: the projection door's silence — the whole
 * subject of the matrix above — is documented as correct *precisely because*
 * the authoring door refuses. The contrast's other half now fails loudly if it
 * stops being true.
 *
 * ## Why it is a sibling block and not a row in the matrix
 *
 * The matrix runs the engine directly and runs BOTH provisioning states. This
 * refusal is neither shaped for it:
 *
 *  - It is not an engine call. The gate lives at the REST ingress
 *    (`assertSearchFieldsAreSearchable`, `@objectstack/metadata-protocol`), so
 *    it needs a protocol in front of the engine — `engine.find` never sees it.
 *    Adding one to the matrix's `beforeEach` would rebuild every door row's
 *    harness for one case that shares none of their assertions.
 *  - The two provisioning states do not give the same answer, and only one of
 *    them is the documented one. With the column undeclared
 *    (`OS_SEARCH_PINYIN_ENABLED=false`) it is not in the registry's field map
 *    at all, so the gate refuses it as UNKNOWN — still a 400, but on the typo
 *    tier, not the "is hidden" reason the four docblocks quote. Pinning the
 *    cited prose means pinning the declared state.
 */
describe('[#8080] the `$searchFields` door refuses the column the read doors drop silently', () => {
  it('names the companion and gets the ADR-0112 envelope: 400 INVALID_FIELD, "is hidden"', async () => {
    const { engine, store } = await makeEngine(true);
    store.seed(CONTACT, { id: 'con_1', name: '张伟', [SEARCH_COMPANION_FIELD]: BLOB });
    const protocol = new ObjectStackProtocolImplementation(engine);

    // CONTROL, and it is the load-bearing half of this test. A green rejection
    // below proves nothing on its own — a call that never reached the gate
    // (wrong door, wrong parameter spelling, a throw from somewhere earlier)
    // rejects just as happily, which is this card's own failure mode one level
    // up. So: the SAME door, the SAME parameter, a legitimate name — it must
    // pass through the gate and answer.
    await expect(protocol.findData({
      object: CONTACT, query: { search: 'zhangwei', $searchFields: 'name' },
    })).resolves.toBeDefined();

    // The refusal. `code` AND `status` (ADR-0112), plus the parameter the
    // caller wrote — the gate quotes the wire spelling back, so asserting it
    // is what distinguishes "the searchFields gate ran" from "something else
    // said 400".
    await expect(protocol.findData({
      object: CONTACT, query: { search: 'zhangwei', $searchFields: SEARCH_COMPANION_FIELD },
    })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_FIELD',
      field: SEARCH_COMPANION_FIELD,
      object: CONTACT,
      param: '$searchFields',
    });

    // …and the REASON, because the reason is what the four docblocks quote.
    // `__search` is deliberately NOT in `SEARCH_AUTO_EXCLUDED_FIELDS` (that
    // set names `id`, `owner_id`, the audit columns), so the auto-default
    // branch reaches the `hidden` arm rather than the system/audit one. The
    // word is the contract here: it is the flag — `hidden: true` on the
    // provisioned column — that this door is enforcing, and a refusal that
    // started arriving for a different reason would mean the composition the
    // docblocks describe had come apart while staying green on code+status.
    await expect(protocol.findData({
      object: CONTACT, query: { search: 'zhangwei', $searchFields: SEARCH_COMPANION_FIELD },
    })).rejects.toThrow(/'__search' is hidden/);
  });
});
