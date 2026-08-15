// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7643] The ⌘K global-search palette and the `$search` executor have ONE
 * definition of recall.
 *
 * ## The defect
 *
 * `GET /api/v1/search` is served by `MetadataProtocol.searchAll`, which used to
 * resolve its own searchable set (text-typed fields carrying the field-level
 * `searchable: true` flag, falling back to the title field) and compile its own
 * AND-of-OR. `POST /api/v1/data/:object/query {search}` goes through the
 * engine's ADR-0061 expansion (`search-filter.ts` `expandSearchToFilter`).
 * Two producers, and the palette's was a STRICT SUBSET on two axes:
 *
 *  - it never ORed the hidden `__search` companion, so `hnkj` / `huaningkeji`
 *    returned 0 hits from the palette while the executor returned 华宁科技
 *    (the QA repro of #7629, verbatim); and
 *  - it read a flag `$search` has never read, instead of the object's
 *    `searchableFields` — whose own spec description already names global
 *    search as one of its three consumers.
 *
 * ## Why this suite lives in `objectql` and not next to `searchAll`
 *
 * The claim under test is a RELATION between two paths, so a double that
 * satisfies one of them proves nothing. `metadata-protocol` cannot import the
 * engine (`objectql` depends on IT — importing back would close a package
 * cycle), so the only place both real implementations meet is here. Everything
 * below runs a real `ObjectQL` over a real driver: the recall answers are
 * executed, not asserted about.
 *
 * ## What is pinned, and in which direction
 *
 * The load-bearing assertion is PARITY, not "the palette finds pinyin" — a
 * palette widened by narrowing the executor would satisfy the latter and is a
 * failure. So each probe compares the two paths' hit sets against each other AND
 * against an explicitly written expectation, and the per-object filter the two
 * paths hand the driver is compared tree-to-tree.
 *
 * The #7641 operator pin (`$icontains`, never the case-SENSITIVE `$contains`,
 * on source columns) MOVED here rather than disappearing: the palette no longer
 * compiles an operator of its own, so the pin now sits on the filter it causes
 * the engine to produce. `protocol.search-case-fold.test.ts` — which asserted
 * that operator on a `where` the palette built itself — is rewritten to pin the
 * delegation, and points here for the operator.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import type { ServiceObject } from '@objectstack/spec/data';

import { ObjectQL } from './engine.js';
import { SEARCH_COMPANION_FIELD, provisionSearchCompanion } from './search-companion.js';

// ---------------------------------------------------------------------------
// A driver that really filters, and records the AST it was handed.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface DriverAst {
  where?: Record<string, unknown>;
  fields?: string[];
  limit?: number;
  offset?: number;
  orderBy?: Array<{ field: string; order?: string }>;
}

interface Capture {
  object: string;
  where: Record<string, unknown> | undefined;
}

function makeStoreDriver(): {
  driver: unknown;
  seed(object: string, row: Row): void;
  stored(object: string, id: string): Row | undefined;
  captures: Capture[];
} {
  const rows = new Map<string, Map<string, Row>>();
  const captures: Capture[] = [];
  const tableFor = (o: string): Map<string, Row> => {
    let t = rows.get(o);
    if (!t) { t = new Map<string, Row>(); rows.set(o, t); }
    return t;
  };

  const matches = (row: Row, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      // `$and` / `$or` are CONJOINED with their siblings, never `return`ed —
      // a `return` would discard every sibling key the loop has not reached
      // (#7620 / #8494), which on this suite would silently widen recall.
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
        // The two operators are executed with DIFFERENT case rules on purpose.
        // `$contains` folding here would make the companion clause pass for a
        // reason it does not have in production, and would hide a regression
        // that swapped the source-column operator back to `$contains`
        // (#4706 Q2 = A: `$contains` is case-SENSITIVE).
        if ('$icontains' in cmp) {
          const needle = String(cmp.$icontains).toLowerCase();
          if (!String(row[k] ?? '').toLowerCase().includes(needle)) return false;
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
    captures.push({ object, where: ast?.where });
    let out = Array.from(tableFor(object).values()).filter((r) => matches(r, ast?.where));
    if (typeof ast?.offset === 'number' && ast.offset > 0) out = out.slice(ast.offset);
    if (typeof ast?.limit === 'number' && ast.limit >= 0) out = out.slice(0, ast.limit);
    return Array.isArray(ast?.fields) && ast.fields.length > 0
      ? out.map((r) => Object.fromEntries(ast.fields!.map((f) => [f, r[f]])))
      : out.map((r) => ({ ...r }));
  };

  let seq = 0;
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
    captures,
    seed: (object, row) => { tableFor(object).set(String(row.id), { ...row }); },
    stored: (object, id) => tableFor(object).get(id),
  };
}

// ---------------------------------------------------------------------------
// Objects — the showcase shapes the QA run measured.
// ---------------------------------------------------------------------------

const ACCOUNT = 'showcase_account';
/** An object with nothing scannable: neither path may answer from it. */
const LEDGER = 'showcase_ledger_entry';

/**
 * NOTE the absent field-level `searchable: true`. That flag is what the old
 * `searchAll` keyed on, and `$search` has never read it — an object shaped like
 * this is the ordinary case, not a contrived one (the showcase objects do not
 * set it either). Under the old palette rule this object fell back to scanning
 * the title field alone.
 */
const accountBase: ServiceObject = {
  name: ACCOUNT,
  label: 'Account',
  fields: {
    id: { type: 'text' },
    name: { type: 'text' },
    billing_email: { type: 'email' },
    annual_revenue: { type: 'number' },
  },
};

const ledgerBase: ServiceObject = {
  name: LEDGER,
  label: 'Ledger Entry',
  fields: {
    id: { type: 'text' },
    amount: { type: 'number' },
    posted: { type: 'boolean' },
  },
};

/** `OS_SEARCH_PINYIN_ENABLED=true` — the registry declares `__search`. */
const accountProvisioned = provisionSearchCompanion(accountBase);

/**
 * The seeded CJK account, byte-for-byte the fixture the showcase seeds and the
 * companion projection suite reuses: 华宁科技 = U+534E U+5B81 U+79D1 U+6280,
 * with the normalizer's output for it.
 */
const CJK_NAME = '华宁科技';
const CJK_BLOB = 'huaningkeji hnkj';

interface Harness {
  engine: ObjectQL;
  protocol: ObjectStackProtocolImplementation;
  store: ReturnType<typeof makeStoreDriver>;
}

async function makeHarness(opts?: { companion?: boolean }): Promise<Harness> {
  const engine = new ObjectQL();
  const store = makeStoreDriver();
  engine.registerDriver(store.driver as never, true);
  await engine.init();
  engine.registry.registerObject(
    opts?.companion === false ? accountBase : accountProvisioned, 'test');
  engine.registry.registerObject(ledgerBase, 'test');

  const protocol = new ObjectStackProtocolImplementation(engine as never);

  store.seed(ACCOUNT, {
    id: 'acc_cjk', name: CJK_NAME, billing_email: 'billing@huaning.example',
    annual_revenue: 36_000_000, updated_at: '2024-03-01T00:00:00.000Z',
    ...(opts?.companion === false ? {} : { [SEARCH_COMPANION_FIELD]: CJK_BLOB }),
  });
  store.seed(ACCOUNT, {
    id: 'acc_nw', name: 'Northwind', billing_email: 'ap@northwind.example',
    annual_revenue: 5_400_000, updated_at: '2024-02-01T00:00:00.000Z',
  });
  store.seed(LEDGER, { id: 'led_1', amount: 42, posted: true, updated_at: '2024-01-01T00:00:00.000Z' });

  return { engine, protocol, store };
}

/** Ids the `$search` EXECUTOR recalls — `POST /data/:object/query {search}`. */
async function executorIds(h: Harness, q: string): Promise<string[]> {
  const rows = await h.engine.find(ACCOUNT, { search: q, limit: 25 });
  return rows.map((r: Row) => String(r.id)).sort();
}

/** Ids the ⌘K PALETTE recalls — `GET /api/v1/search`. */
async function paletteIds(h: Harness, q: string): Promise<string[]> {
  const res = await h.protocol.searchAll({ q, objects: [ACCOUNT], perObject: 25, limit: 25 });
  return res.hits.map((hit) => String(hit.id)).sort();
}

describe('[#7643] palette recall === executor recall', () => {
  let h: Harness;
  beforeEach(async () => { h = await makeHarness(); });

  it('the fixture is real: the stored CJK row carries the companion blob', () => {
    // Guards every pinyin assertion below from passing vacuously — they are all
    // "the companion was consulted", which is worthless if it holds no value.
    expect(h.store.stored(ACCOUNT, 'acc_cjk')).toHaveProperty(SEARCH_COMPANION_FIELD, CJK_BLOB);
    expect(h.store.stored(ACCOUNT, 'acc_cjk')).toHaveProperty('name', CJK_NAME);
  });

  // Each row: [probe, the ids BOTH paths must return]. The expectation is
  // written out rather than derived from either path, so a change that breaks
  // both paths identically still fails.
  const PROBES: Array<[label: string, q: string, expected: string[]]> = [
    ['initials via the companion — the QA repro', 'hnkj', ['acc_cjk']],
    ['full pinyin via the companion', 'huaningkeji', ['acc_cjk']],
    ['a latin substring of a source column', 'northwind', ['acc_nw']],
    ['the same term in the other casing (folding is the operator\'s job)', 'NORTHWIND', ['acc_nw']],
    ['a non-title source column (email)', 'huaning.example', ['acc_cjk']],
    ['the CJK original, typed directly', CJK_NAME, ['acc_cjk']],
    ['a term nothing carries', 'zzzznope', []],
  ];

  it.each(PROBES)('%s', async (_label, q, expected) => {
    const [palette, executor] = [await paletteIds(h, q), await executorIds(h, q)];
    // The relation first — this is the card's actual claim.
    expect(palette).toEqual(executor);
    // …then the absolute answer, so "both broke together" cannot pass.
    expect(palette).toEqual(expected);
  });

  it('the two paths hand the driver the SAME filter tree, not merely the same rows', async () => {
    // Row-level parity can be reached by two different filters that happen to
    // agree on this fixture. Tree equality is the statement that there is one
    // definition of recall, which is what the card asked for.
    h.store.captures.length = 0;
    await h.engine.find(ACCOUNT, { search: 'hnkj', limit: 25 });
    // Index arithmetic, not `.at(-1)`: this package's tsc program targets a
    // `lib` without `Array.prototype.at`, and the TEST_DEBT ratchet re-measures
    // that program — so `.at()` here is a +1 on a shrink-only ledger.
    const executorWhere = h.store.captures[h.store.captures.length - 1]?.where;

    h.store.captures.length = 0;
    await h.protocol.searchAll({ q: 'hnkj', objects: [ACCOUNT], perObject: 25, limit: 25 });
    const paletteWhere = h.store.captures.find((c) => c.object === ACCOUNT)?.where;

    expect(paletteWhere).toEqual(executorWhere);
    expect(paletteWhere).toBeDefined();
  });
});

describe('[#7643] the companion OR is what the palette gained', () => {
  it('the palette filter really contains the companion clause', async () => {
    // Positive assertion of the FIX, so the parity suite above cannot be
    // satisfied by both paths losing companion recall together.
    const h = await makeHarness();
    h.store.captures.length = 0;
    await h.protocol.searchAll({ q: 'hnkj', objects: [ACCOUNT], perObject: 25, limit: 25 });
    const where = h.store.captures.find((c) => c.object === ACCOUNT)?.where;

    expect(JSON.stringify(where)).toContain(SEARCH_COMPANION_FIELD);
    // The companion clause stays `$contains` DELIBERATELY: the column is a
    // normalized blob, lowercase on both sides by construction, so a
    // case-sensitive operator over two folded values is exact rather than a
    // case bug (`search-filter.ts` spells this out). Pinned so an "align the
    // operators" sweep has to read that reasoning first.
    expect(where).toMatchObject({ $or: expect.arrayContaining([
      { [SEARCH_COMPANION_FIELD]: { $contains: 'hnkj' } },
    ]) });
  });

  it('[#7641] source columns still compile to $icontains, never the case-SENSITIVE $contains', async () => {
    // The operator pin, MOVED from `protocol.search-case-fold.test.ts`: the
    // palette no longer compiles an operator itself, so the claim is now about
    // the filter it causes the engine to produce. Asserted on a latin term so
    // the companion clause (legitimately `$contains`) is not in the tree.
    const h = await makeHarness();
    h.store.captures.length = 0;
    await h.protocol.searchAll({ q: CJK_NAME, objects: [ACCOUNT], perObject: 25, limit: 25 });
    const where = h.store.captures.find((c) => c.object === ACCOUNT)?.where;

    expect(JSON.stringify(where)).toContain('$icontains');
    expect(JSON.stringify(where)).not.toContain('$contains"');
    expect(where).toMatchObject({ $or: expect.arrayContaining([
      { name: { $icontains: CJK_NAME } },
    ]) });
  });

  it('with the companion NOT provisioned, both paths lose pinyin recall together', async () => {
    // The capability is deployment-gated (`OS_SEARCH_PINYIN_ENABLED`). The
    // contract is parity, not "pinyin always works" — so the flag-off state is
    // pinned as parity too, and this is what stops the fix from being read as
    // "the palette must special-case pinyin".
    const h = await makeHarness({ companion: false });
    expect(await paletteIds(h, 'hnkj')).toEqual([]);
    expect(await executorIds(h, 'hnkj')).toEqual([]);
    // …while ordinary recall is untouched by the flag, on both paths.
    expect(await paletteIds(h, 'northwind')).toEqual(['acc_nw']);
    expect(await executorIds(h, 'northwind')).toEqual(['acc_nw']);
  });
});

describe('[#7643] an object with nothing scannable is SKIPPED, never dumped', () => {
  it('contributes no hits, and is never queried at all', async () => {
    // TWO different facts, and the second was measured rather than assumed —
    // an ablation run predicted this test would stay green against the old
    // code and it went RED, which is how the third divergence axis was found.
    //
    // 1. The cliff: `expandSearchToFilter` answers an empty field set with
    //    `null`, the engine then leaves `where` unset, and an unfiltered `find`
    //    returns the object's first rows — a palette answering every query with
    //    unrelated records. Hence the skip before the query is built.
    //
    // 2. `showcase_ledger_entry` HAS no scannable column — its only text-typed
    //    field is `id` — and the old palette queried it anyway. Its fallback
    //    chain ended in "the first text-typed field", which on such an object
    //    selects the PRIMARY KEY, so every keystroke ran
    //    `{id: {$icontains: term}}` against every system/junction/log table.
    //    That is #4483's defect exactly (`SEARCH_AUTO_EXCLUDED_FIELDS` names
    //    `id` for precisely this reason), which the executor had fixed and this
    //    path had not. Sharing the resolution retires it here too — so the
    //    `captures` assertion below is the pin on a behaviour that CHANGED, not
    //    on one that was preserved.
    const h = await makeHarness();
    const res = await h.protocol.searchAll({ q: 'zzzznope', perObject: 25, limit: 25 });

    expect(res.hits.map((hit) => hit.object)).not.toContain(LEDGER);
    expect(res.totalHits).toBe(0);
    // The ledger row exists and would have come back had the object been swept
    // with no filter — the assertion above is not vacuous.
    expect(h.store.stored(LEDGER, 'led_1')).toBeDefined();
    // And no query was ever issued against it.
    expect(h.store.captures.some((c) => c.object === LEDGER)).toBe(false);
  });
});
