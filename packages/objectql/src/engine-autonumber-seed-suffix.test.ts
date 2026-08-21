// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6468 — `seedAutonumber` must locate the counter by the format's DECLARED
 * `suffix`, not by "the digits at the end of the string".
 *
 * `renderAutonumber` composes `prefix + zero-padded(seq) + suffix`, and `suffix`
 * is a declared return value (`packages/spec/src/data/autonumber-format.ts`):
 * every token after the `{0..0}` slot renders BEHIND the counter. So a perfectly
 * ordinary invoice shape — `{000}-{YYYY}` → `001-2026` — does not end in its
 * counter. The seeding read took the last digit run of the value regardless,
 * which is the YEAR: with three rows numbered 1..3 it seeded `2026`, and the
 * next issued number jumped to `2027-2026`. Every number in between is burned
 * and cannot be reclaimed after the fact.
 *
 * The SQL driver's `scanMaxNumericTail` read the same rows as `12026` (it
 * concatenated every digit of the tail), so the same metadata over the same rows
 * produced two DIFFERENT wrong answers depending on which driver ran. The
 * cross-side parity is pinned directly in
 * `packages/runtime/src/autonumber-seed-cross-side-parity.integration.test.ts`;
 * this file pins the engine half.
 *
 * ## What is deliberately NOT changed
 *
 * A format that declares neither prefix nor suffix leaves the slot unanchored,
 * and there the legacy reading (LAST digit run of the whole value) is kept —
 * a format with no `{0..0}` slot renders a bare trailing counter, and values
 * predating any format have no anchor to read from. Both control formats from
 * the issue body (`D-{0000}`, `{0000}`) were already correct on both sides and
 * are pinned here against drift.
 *
 * These tests drive a fake DRIVER (not a fake engine), so no engine write-verb
 * dispatch contract is involved.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

/**
 * The date tokens render from the wall clock, so the clock is pinned. Only
 * `Date` is faked — the seeding walk is ordinary async I/O and must keep running
 * on real timers.
 */
const FIXED_NOW = new Date('2026-06-15T09:00:00Z');

interface CapturedQuery {
  where?: any;
  orderBy?: any;
  limit?: number;
  fields?: string[];
}

/**
 * Evaluate the operators the seeding walk actually emits. Anything else throws
 * rather than being tolerated: silently ignoring an unknown operator would let a
 * bad query pass as a good one.
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

function makeDriver(rows: Array<Record<string, unknown>>): IDataDriver & {
  created: any[];
  queries: CapturedQuery[];
} {
  const created: any[] = [];
  const queries: CapturedQuery[] = [];
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    // No `autonumber` support — this is exactly the engine fallback path.
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    checkHealth: vi.fn().mockResolvedValue(true),
    execute: vi.fn(),
    find: vi.fn(async (_obj: string, ast: any) => {
      queries.push(JSON.parse(JSON.stringify({ where: ast?.where, orderBy: ast?.orderBy, limit: ast?.limit, fields: ast?.fields })));
      let out = rows.filter((r) => matches(r, ast?.where));
      const orderBy = ast?.orderBy;
      if (Array.isArray(orderBy) && orderBy.length > 0) {
        const { field, order } = orderBy[0];
        out = [...out].sort((a, b) => {
          const av = String(a[field] ?? '');
          const bv = String(b[field] ?? '');
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return order === 'desc' ? -cmp : cmp;
        });
      }
      if (typeof ast?.limit === 'number') out = out.slice(0, ast.limit);
      return out.map((r) => ({ ...r }));
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

const rowId = (n: number) => `r${String(n).padStart(6, '0')}`;

/** Build a schema whose single autonumber field carries `format`. */
function schemaWith(field: string, format?: string) {
  return {
    name: 'rec',
    fields: {
      title: { type: 'text' },
      ...(format === undefined
        ? { [field]: { type: 'autonumber', required: true } }
        : { [field]: { type: 'autonumber', required: true, format } }),
    },
  };
}

/** Seed rows carrying pre-existing record numbers, in insertion order. */
function storedRows(field: string, values: string[]) {
  return values.map((v, i) => ({ id: rowId(i + 1), [field]: v }));
}

async function insertOne(schema: any, rows: Array<Record<string, unknown>>) {
  vi.mocked(SchemaRegistry.getObject).mockReturnValue(schema as any);
  const driver = makeDriver(rows);
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  const result = await engine.insert('rec', { title: 'next' });
  return { result, driver };
}

describe('ObjectQL seedAutonumber — the counter is located by the declared suffix (#6468)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ------------------------------------- (1) suffix, no prefix — the defect --

  describe('`{000}-{YYYY}` — the counter leads, the year trails', () => {
    const SCHEMA = schemaWith('case_no', '{000}-{YYYY}');

    it('seeds from the counter (3), not from the year (2026)', async () => {
      const { result } = await insertOne(SCHEMA, storedRows('case_no', ['001-2026', '002-2026', '003-2026']));

      expect(result.case_no).toBe('004-2026');
      // The precise regression: the last digit run of `003-2026` is the YEAR, so
      // the counter seeded 2026 and the next number jumped a full band.
      expect(result.case_no).not.toBe('2027-2026');
    });

    it('counts rows whose suffix rendered differently — one counter spans the years', async () => {
      // The counter scope is the rendered PREFIX, which is '' here: `{000}-{YYYY}`
      // keeps ONE global counter and only the displayed year moves. Last year's
      // `007-2025` therefore holds counter 7 and must be counted, even though it
      // does not carry the suffix this row renders (`-2026`). Requiring the
      // suffix to match would seed 3 and re-issue 004..007.
      const { result } = await insertOne(
        SCHEMA,
        storedRows('case_no', ['005-2025', '006-2025', '007-2025', '003-2026']),
      );

      expect(result.case_no).toBe('008-2026');
    });

    it('does not push a prefix down when the format declares none', async () => {
      // #6467's scan shape is untouched by this fix: an empty prefix means no
      // `$startsWith` filter, so every row of the object is visited.
      const { driver } = await insertOne(SCHEMA, storedRows('case_no', ['001-2026']));

      const seeds = driver.queries.filter((q) => Array.isArray(q.fields) && q.fields.includes('case_no'));
      expect(seeds.length).toBeGreaterThan(0);
      expect(seeds[0].where).toBeUndefined();
      expect(seeds[0].fields).toEqual(['id', 'case_no']);
    });
  });

  // --------------------------------------- (2) suffix AND prefix — same rule --

  describe('`CASE-{000}-{YYYY}` — text on both sides of the slot', () => {
    const SCHEMA = schemaWith('case_no', 'CASE-{000}-{YYYY}');

    it('reads the counter between the prefix and the suffix', async () => {
      const { result } = await insertOne(
        SCHEMA,
        storedRows('case_no', ['CASE-001-2026', 'CASE-002-2026', 'CASE-003-2026']),
      );

      expect(result.case_no).toBe('CASE-004-2026');
    });

    it('still pushes the prefix down and still ignores foreign scopes', async () => {
      const { result, driver } = await insertOne(SCHEMA, [
        ...storedRows('case_no', ['CASE-001-2026', 'CASE-002-2026']),
        { id: rowId(50), case_no: 'OTHER-900-2026' },
      ]);

      expect(result.case_no).toBe('CASE-003-2026');
      const seeds = driver.queries.filter((q) => Array.isArray(q.fields) && q.fields.includes('case_no'));
      expect(seeds[0].where).toEqual({ case_no: { $startsWith: 'CASE-' } });
    });
  });

  // ------------------------------------------------ (3) controls — unchanged --

  describe('formats with no suffix keep their existing behaviour', () => {
    it('`D-{0000}` seeds from the digit run after the prefix', async () => {
      const { result } = await insertOne(
        schemaWith('doc_no', 'D-{0000}'),
        storedRows('doc_no', ['D-0001', 'D-0002', 'D-0003']),
      );

      expect(result.doc_no).toBe('D-0004');
    });

    it('`{0000}` seeds from the bare padded counter', async () => {
      const { result } = await insertOne(
        schemaWith('doc_no', '{0000}'),
        storedRows('doc_no', ['0001', '0002', '0003']),
      );

      expect(result.doc_no).toBe('0004');
    });
  });

  // ------------------------------------------- (4) legacy unanchored reading --

  describe('a format declaring neither prefix nor suffix keeps the legacy reading', () => {
    it('reads the LAST digit run of the whole value', async () => {
      // No format at all, so the stored values have no anchor: `'10'` must win
      // over `'2'` — this is a numeric max, never a lexicographic one. That
      // READING is what #6468 is about here and it is unchanged.
      //
      // ⚠️ The `0011` is the RENDERING, and it is deliberate — do not "fix" it
      // back to a bare `'11'`. A format-less field resolves to the contract
      // default `{0000}` since #6555/#7262 (`resolveAutonumberFormat`), which is
      // what makes the engine and `driver-sql` mint the same shape over this
      // exact dataset; the SQL arm pins `0011` too, in
      // `sql-driver-autonumber-suffix.test.ts`. `{0000}` renders prefix '' and
      // suffix '', so the unanchored reading below is untouched by it.
      const { result } = await insertOne(schemaWith('ref_no'), storedRows('ref_no', ['1', '2', '10']));

      expect(result.ref_no).toBe('0011');
    });

    it('reads past leading text that no format describes', async () => {
      // Values written before any format existed: the unanchored reading takes
      // the trailing run, which is what it has always done. Rendered through the
      // `{0000}` default (#6555/#7262) — see the note above before re-pinning
      // this to a bare `'8'`.
      const { result } = await insertOne(schemaWith('ref_no'), storedRows('ref_no', ['SO-2024-0007']));

      expect(result.ref_no).toBe('0008');
    });
  });
});
