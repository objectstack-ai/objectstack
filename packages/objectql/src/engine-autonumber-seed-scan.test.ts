// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6249 — `seedAutonumber` must read the max over EVERY row in the counter's
 * scope, not over an arbitrary 5000-row window.
 *
 * The engine's fallback autonumber path (drivers that do NOT declare
 * `supports.autonumber`) seeds its in-memory counter from `MAX(existing)`. That
 * seeding read used to be a single `find` with `limit: 5000`, **no `orderBy`
 * and no filter** — so it took whatever 5000 rows the driver happened to return
 * (on SQL, typically the oldest ones) and called the max of that window the max
 * of the table. Two ways that seeds BELOW the real MAX:
 *
 *   - the object simply holds more than 5000 rows, or
 *   - the counter's scope (a date / `{field}` group) has its rows sitting
 *     outside the window because OTHER scopes' rows filled it — the prefix was
 *     only ever applied JS-side, after the window had already been chosen.
 *
 * The counter then issues numbers from an already-taken band. On a `unique`
 * record-number field that is a duplicate business identifier — a value written
 * wrong, which no retry and no restart repairs (the same class of harm as the
 * read-outage half fixed in #5979 / #6114).
 *
 * ## What these tests pin
 *
 * The scan is complete: seek-paginated (`keysetWalk`, #4363 — an `offset` walk
 * cannot promise it visited every row) with the prefix pushed down as
 * `$startsWith`, and the numeric max computed HERE rather than delegated to an
 * `orderBy` or an aggregate `max`. That last point is load-bearing and has its
 * own case below: both of those rank the stored value as TEXT, and
 * lexicographic order equals numeric order only when every value in the scope is
 * zero-padded to one fixed width — which the format language does not guarantee
 * (a format with no `{0..0}` slot renders bare counters, where `'9' > '10'`).
 *
 * These tests drive a fake DRIVER (not a fake engine), so no engine write-verb
 * dispatch contract is involved.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQL } from './engine';
import { SchemaRegistry } from './registry';
import type { IDataDriver } from '@objectstack/spec/contracts';

vi.mock('./registry', async () => {
  // [#10551] The one shared factory — see `registry-module-mock.ts` for the
  // member set, the #9002 / #9154 lessons it carries, and why the async factory
  // form is what makes this import legal under `vi.mock` hoisting.
  const { createRegistryModuleMock } = await import('./registry-module-mock.js');
  return createRegistryModuleMock();
});

/** The page size the seeding walk uses — a PAGE, not a cap, since #6249. */
const PAGE_SIZE = 5000;

/** Fixed-prefix format: `prefix` renders to `'D-'`, scope is the single global one. */
const DOC_SCHEMA = {
  name: 'doc',
  fields: {
    title: { type: 'text' },
    doc_no: { type: 'autonumber', required: true, format: 'D-{0000}' },
  },
};

/** `{field}`-grouped format: each `region` gets its own counter and its own prefix. */
const TICKET_SCHEMA = {
  name: 'ticket',
  fields: {
    title: { type: 'text' },
    region: { type: 'text' },
    ticket_no: { type: 'autonumber', required: true, format: '{region}-{0000}' },
  },
};

/**
 * Legacy path: NO format at all, so the seed reads the LAST digit run of the
 * whole stored value. There is no lexicographic reading of these values that
 * equals the numeric one.
 *
 * The stored values below are bare (`'7'`, `'8'`, … `'10'`) — what a deployment
 * on this path had already issued. What the engine now ISSUES is rendered
 * through the contract default `{0000}` (#6555/#7262), so the next number is
 * `'0011'`, not `'11'`. The reading is unaffected: `{0000}` renders prefix `''`
 * and suffix `''`, which is the unanchored branch these rows have always taken.
 */
const LEGACY_SCHEMA = {
  name: 'legacy',
  fields: {
    title: { type: 'text' },
    ref_no: { type: 'autonumber', required: true },
  },
};

interface CapturedQuery {
  where?: any;
  orderBy?: any;
  limit?: number;
  fields?: string[];
}

/**
 * Evaluate the operators the seeding walk actually emits. Anything else throws
 * rather than being tolerated: this double exists to prove the engine sends a
 * query the driver contract can execute, and silently ignoring an unknown
 * operator would let a bad query pass as a good one.
 */
function matches(row: Record<string, unknown>, where: any): boolean {
  if (where == null) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === '$and') {
      if (!(cond as any[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (key.startsWith('$')) throw new Error(`fake driver: unsupported logical operator ${key}`);
    const v = row[key];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      for (const [op, operand] of Object.entries(cond as Record<string, unknown>)) {
        if (op === '$startsWith') {
          if (typeof v !== 'string' || !v.startsWith(String(operand))) return false;
        } else if (op === '$gt') {
          if (!(String(v) > String(operand))) return false;
        } else if (op === '$eq') {
          if (v !== operand) return false;
        } else {
          throw new Error(`fake driver: unsupported operator ${op}`);
        }
      }
    } else if (v !== cond) {
      return false;
    }
  }
  return true;
}

interface FakeDriverOptions {
  /** Rows the store already holds, in the order the driver naturally returns them. */
  rows?: Array<Record<string, unknown>>;
  /** Declare native autonumber support — the engine must then defer entirely. */
  nativeAutonumber?: boolean;
  /** Throw this on every read instead of answering. */
  readError?: () => unknown;
  /**
   * Answer every page with the SAME full page, ignoring the seek predicate —
   * a driver that cannot page. The walk must detect it rather than spin, and
   * the seed must refuse rather than answer with a partial max.
   */
  ignoreSeek?: boolean;
}

function makeDriver(options: FakeDriverOptions = {}): IDataDriver & {
  created: any[];
  queries: CapturedQuery[];
} {
  const store = options.rows ?? [];
  const created: any[] = [];
  const queries: CapturedQuery[] = [];
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: options.nativeAutonumber ? { autonumber: true } : {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    checkHealth: vi.fn().mockResolvedValue(true),
    execute: vi.fn(),
    find: vi.fn(async (_obj: string, ast: any) => {
      queries.push(
        JSON.parse(
          JSON.stringify({
            where: ast?.where,
            orderBy: ast?.orderBy,
            limit: ast?.limit,
            fields: ast?.fields,
          }),
        ),
      );
      if (options.readError) throw options.readError();
      if (options.ignoreSeek) return store.slice(0, ast?.limit ?? store.length).map((r) => ({ ...r }));
      let rows = store.filter((r) => matches(r, ast?.where));
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
    }),
    findOne: vi.fn(),
    create: vi.fn(async (_obj: string, row: any) => {
      created.push(row);
      return { id: `new${created.length}`, ...row };
    }),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  };
  driver.created = created;
  driver.queries = queries;
  return driver as any;
}

/** Ids that sort lexicographically in insertion order — the seek key. */
const rowId = (n: number) => `r${String(n).padStart(6, '0')}`;

/** The reads that ARE the seeding scan: the ones projecting `id` + the number field. */
const seedQueries = (driver: { queries: CapturedQuery[] }, field: string) =>
  driver.queries.filter((q) => Array.isArray(q.fields) && q.fields.includes(field));

describe('ObjectQL seedAutonumber — the scan must cover every row in scope (#6249)', () => {
  let engine: ObjectQL;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ObjectQL();
  });

  // ------------------------------------------------- (1) past one page size --

  describe('an object larger than one page seeds from the REAL max', () => {
    /**
     * 6000 rows, `D-0001` … `D-6000`, in insertion order. The old single-shot
     * `limit: 5000` window saw `D-0001`…`D-5000` and seeded 5000, handing out
     * `D-5001` — a number the store already holds.
     */
    const rows = Array.from({ length: 6000 }, (_, i) => ({
      id: rowId(i + 1),
      doc_no: `D-${String(i + 1).padStart(4, '0')}`,
    }));

    beforeEach(() => {
      vi.mocked(SchemaRegistry.getObject).mockReturnValue(DOC_SCHEMA as any);
    });

    it('issues the number after the true max, not after the window max', async () => {
      const driver = makeDriver({ rows });
      engine.registerDriver(driver, true);
      await engine.init();

      const result = await engine.insert('doc', { title: 'Next' });

      expect(result.doc_no).toBe('D-6001');
      // The precise regression: `D-5001` is what the 5000-row window produced,
      // and it is already taken.
      expect(result.doc_no).not.toBe('D-5001');
      expect(driver.created[0].doc_no).toBe('D-6001');
    });

    it('pages with a seek cursor rather than stopping at the first page', async () => {
      const driver = makeDriver({ rows });
      engine.registerDriver(driver, true);
      await engine.init();

      await engine.insert('doc', { title: 'Next' });

      const seeds = seedQueries(driver, 'doc_no');
      expect(seeds.length).toBeGreaterThan(1);

      // Page 1: ordered by the seek key, one page wide, prefix pushed down.
      expect(seeds[0].orderBy).toEqual([{ field: 'id', order: 'asc' }]);
      expect(seeds[0].limit).toBe(PAGE_SIZE);
      expect(seeds[0].fields).toEqual(['id', 'doc_no']);
      expect(seeds[0].where).toEqual({ doc_no: { $startsWith: 'D-' } });

      // Page 2 carries the cursor, AND-ed onto the caller's own filter so the
      // prefix is not dropped when the seek is added.
      expect(seeds[1].where).toEqual({
        $and: [{ doc_no: { $startsWith: 'D-' } }, { id: { $gt: rowId(PAGE_SIZE) } }],
      });
    });

    it('seeds once and then counts in memory (the walk is not re-run per insert)', async () => {
      const driver = makeDriver({ rows });
      engine.registerDriver(driver, true);
      await engine.init();

      const a = await engine.insert('doc', { title: 'One' });
      const pagesAfterFirst = seedQueries(driver, 'doc_no').length;
      const b = await engine.insert('doc', { title: 'Two' });

      expect(a.doc_no).toBe('D-6001');
      expect(b.doc_no).toBe('D-6002');
      expect(seedQueries(driver, 'doc_no')).toHaveLength(pagesAfterFirst);
    });
  });

  // ------------------------------------------- (2) a scope crowded out of it --

  describe('a scope whose rows sit outside the window still seeds from its own max', () => {
    /**
     * 5200 `EMEA-*` rows inserted first, then three `APAC-*` rows. The old
     * window held nothing but EMEA rows, so the JS-side prefix filter matched
     * NOTHING and the APAC counter seeded from 0 — re-issuing `APAC-0001`,
     * which the store already holds.
     */
    const rows = [
      ...Array.from({ length: 5200 }, (_, i) => ({
        id: rowId(i + 1),
        region: 'EMEA',
        ticket_no: `EMEA-${String(i + 1).padStart(4, '0')}`,
      })),
      { id: rowId(5201), region: 'APAC', ticket_no: 'APAC-0001' },
      { id: rowId(5202), region: 'APAC', ticket_no: 'APAC-0002' },
      { id: rowId(5203), region: 'APAC', ticket_no: 'APAC-0003' },
    ];

    beforeEach(() => {
      vi.mocked(SchemaRegistry.getObject).mockReturnValue(TICKET_SCHEMA as any);
    });

    it('continues the crowded-out scope instead of restarting it at 1', async () => {
      const driver = makeDriver({ rows });
      engine.registerDriver(driver, true);
      await engine.init();

      const result = await engine.insert('ticket', { title: 'New APAC', region: 'APAC' });

      expect(result.ticket_no).toBe('APAC-0004');
      // The defect's signature: a straight duplicate of a stored value.
      expect(result.ticket_no).not.toBe('APAC-0001');
    });

    it('pushes the scope prefix down so the scan is not paging other scopes', async () => {
      const driver = makeDriver({ rows });
      engine.registerDriver(driver, true);
      await engine.init();

      await engine.insert('ticket', { title: 'New APAC', region: 'APAC' });

      const seeds = seedQueries(driver, 'ticket_no');
      expect(seeds[0].where).toEqual({ ticket_no: { $startsWith: 'APAC-' } });
      // Pushed down, so the three matching rows are one short page — the 5200
      // EMEA rows are never transferred.
      expect(seeds).toHaveLength(1);
    });

    it('keeps the scopes independent (EMEA continues from its own max)', async () => {
      const driver = makeDriver({ rows });
      engine.registerDriver(driver, true);
      await engine.init();

      const apac = await engine.insert('ticket', { title: 'A', region: 'APAC' });
      const emea = await engine.insert('ticket', { title: 'E', region: 'EMEA' });

      expect(apac.ticket_no).toBe('APAC-0004');
      expect(emea.ticket_no).toBe('EMEA-5201');
    });
  });

  // ------------------------------------------------ (3) legacy empty prefix --

  describe('legacy empty-prefix path (bare counters, no `{0..0}` slot)', () => {
    beforeEach(() => {
      vi.mocked(SchemaRegistry.getObject).mockReturnValue(LEGACY_SCHEMA as any);
    });

    /**
     * The case that rules out ever swapping this scan for `orderBy desc +
     * limit 1` or an aggregate `max`: both rank TEXT, and the lexicographic
     * maximum of these values is `'9'`, which would seed 9 and re-issue the
     * `'10'` the store already holds. The numeric max is 10.
     */
    it('takes the NUMERIC max, not the lexicographic one', async () => {
      const rows = [
        { id: rowId(1), ref_no: '7' },
        { id: rowId(2), ref_no: '8' },
        { id: rowId(3), ref_no: '9' },
        { id: rowId(4), ref_no: '10' },
      ];
      const driver = makeDriver({ rows });
      engine.registerDriver(driver, true);
      await engine.init();

      const result = await engine.insert('legacy', { title: 'Next' });

      // ⚠️ `0011`, not a bare `11`, since #6555/#7262 — a format-less field
      // renders through the declared default `{0000}`. Do not "fix" this back:
      // the padding is what makes this engine path and `driver-sql` mint the
      // same shape. The counter (11) is what this case is really about.
      expect(result.ref_no).toBe('0011');
      // `'9'` is the lexicographic max; seeding from it re-issues counter 10.
      expect(result.ref_no).not.toBe('0010');
    });

    it('scans past one page with no prefix to push down', async () => {
      const rows = Array.from({ length: 6000 }, (_, i) => ({
        id: rowId(i + 1),
        ref_no: String(i + 1),
      }));
      const driver = makeDriver({ rows });
      engine.registerDriver(driver, true);
      await engine.init();

      const result = await engine.insert('legacy', { title: 'Next' });

      expect(result.ref_no).toBe('6001');
      const seeds = seedQueries(driver, 'ref_no');
      // No prefix ⇒ no pushdown on the first page; the cursor still carries the
      // walk to the end.
      expect(seeds[0].where).toBeUndefined();
      expect(seeds[1].where).toEqual({ id: { $gt: rowId(PAGE_SIZE) } });
      expect(result.ref_no).not.toBe('5001');
    });
  });

  // ------------------------------------------------------------ (4) control --

  describe('control — a driver declaring `supports.autonumber` is untouched', () => {
    beforeEach(() => {
      vi.mocked(SchemaRegistry.getObject).mockReturnValue(DOC_SCHEMA as any);
    });

    /**
     * The blast radius stated in #6249: `driver-sql` / `driver-turso` /
     * `driver-sqlite-wasm` seed through their own `_objectstack_sequences` via
     * `scanMaxNumericTail` (which already pushes `like 'prefix%'` down with no
     * limit). The engine must not emit a seeding scan for them at all — before
     * this change or after it.
     */
    it('emits no seeding scan and pre-fills nothing', async () => {
      const rows = Array.from({ length: 6000 }, (_, i) => ({
        id: rowId(i + 1),
        doc_no: `D-${String(i + 1).padStart(4, '0')}`,
      }));
      const driver = makeDriver({ rows, nativeAutonumber: true });
      engine.registerDriver(driver, true);
      await engine.init();

      await engine.insert('doc', { title: 'Next' });

      expect(seedQueries(driver, 'doc_no')).toHaveLength(0);
      // The driver owns the value: the engine hands it a row with the slot empty.
      expect(driver.created).toHaveLength(1);
      expect(driver.created[0].doc_no).toBeUndefined();
    });
  });

  // --------------------------------------------------------- (5) loud fail --

  describe('loud failure is preserved (#6114 / #5979) and extended to a partial scan', () => {
    beforeEach(() => {
      vi.mocked(SchemaRegistry.getObject).mockReturnValue(DOC_SCHEMA as any);
    });

    it('a read outage still propagates and writes nothing', async () => {
      const driver = makeDriver({
        readError: () =>
          Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }),
      });
      engine.registerDriver(driver, true);
      await engine.init();

      await expect(engine.insert('doc', { title: 'First' })).rejects.toThrow(/ECONNREFUSED/);
      expect(driver.create).not.toHaveBeenCalled();
    });

    it('an unprovisioned table still seeds from 0 (the one benign reason)', async () => {
      const driver = makeDriver({ readError: () => new Error('no such table: doc') });
      engine.registerDriver(driver, true);
      await engine.init();

      const result = await engine.insert('doc', { title: 'First' });

      expect(result.doc_no).toBe('D-0001');
    });

    /**
     * A scan that could not reach the end must NOT answer with the max of what
     * it did read — that floor is exactly the "seed below the real MAX" defect.
     * Same disposition the read outage gets: allocate nothing, write nothing.
     */
    it('refuses to seed from a scan that could not complete', async () => {
      const rows = Array.from({ length: PAGE_SIZE }, (_, i) => ({
        id: rowId(i + 1),
        doc_no: `D-${String(i + 1).padStart(4, '0')}`,
      }));
      const driver = makeDriver({ rows, ignoreSeek: true });
      engine.registerDriver(driver, true);
      await engine.init();

      await expect(engine.insert('doc', { title: 'First' })).rejects.toThrow(
        /could not visit every stored row/,
      );
      expect(driver.create).not.toHaveBeenCalled();
    });

    /**
     * The refusal must not be mistaken for "the table is missing", which is the
     * one error class the catch answers with 0 — that would turn a partial scan
     * straight back into `D-0001` against a populated table.
     */
    it('the refusal is not swallowed as a missing table', async () => {
      const rows = Array.from({ length: PAGE_SIZE }, (_, i) => ({
        id: rowId(i + 1),
        doc_no: `D-${String(i + 1).padStart(4, '0')}`,
      }));
      const driver = makeDriver({ rows, ignoreSeek: true });
      engine.registerDriver(driver, true);
      await engine.init();

      await expect(engine.insert('doc', { title: 'First' })).rejects.not.toThrow(/no such table/);
      expect(driver.created).toHaveLength(0);
    });
  });
});
