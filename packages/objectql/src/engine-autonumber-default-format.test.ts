// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6555 (half 2/3, #7262) — a format-LESS autonumber field renders through the
 * contract default `{0000}`, not through the empty string.
 *
 * `applyAutonumbers` used to read the format by hand — `autonumberFormat ??
 * format`, then `typeof fmt === 'string' ? fmt : ''` — so a field declaring no
 * format handed `parseAutonumberFormat` the EMPTY string. An empty token list
 * renders through `renderAutonumber`'s no-slot branch as a bare counter: `1`,
 * `2`, …. `driver-sql` answered the same question with its own hardcoded
 * `|| '{0000}'` and issued `0001`, `0002`, …. One metadata document therefore
 * minted differently-shaped numbers depending on which driver served it, and a
 * suite asserting `'1'` against the memory driver did not hold in production on
 * SQL. The counter VALUE always agreed — #6468 pinned that — so the fork was
 * rendering width alone.
 *
 * The maintainer's route-3 ruling on #6555 (2026-08-08) moved the default into
 * the contract: `DEFAULT_AUTONUMBER_FORMAT` / `resolveAutonumberFormat` in
 * `@objectstack/spec/data` (#7265), read by `driver-sql` (#7263) and, here, by
 * the engine. This file is the engine-side pin for the two behaviour moves that
 * lands with.
 *
 * ## Why this file exists at all — a measured coverage gap
 *
 * The drivers seat measured, while landing #7263, that NOT ONE test on either
 * side declared an empty-string format: `git grep "format: ''\|autonumberFormat:
 * ''"` returned nothing across all 8 driver-sql autonumber suites and all 7
 * `engine-autonumber-*.test.ts` suites. `''` is precisely the input this half
 * moves (`??` respects an empty string, the resolver's truthiness rule does
 * not), so a green run of the pre-existing suites is not evidence about it in
 * EITHER direction. Every `''` case below was written for that gap.
 *
 * The counterpart pins live in
 * `packages/drivers/driver-sql/src/sql-driver-autonumber-suffix.test.ts` (the SQL
 * arm, `0011` since #7263) and
 * `packages/runtime/src/autonumber-seed-cross-side-parity.integration.test.ts`
 * (the two arms asserted against each other over one dataset).
 *
 * These tests drive a fake DRIVER (not a fake engine) whose `supports = {}`, so
 * the engine's own fallback owns the counter — the path the whole card is about.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from './engine';
import { SchemaRegistry } from './registry';
import type { IDataDriver } from '@objectstack/spec/contracts';

vi.mock('./registry', () => {
  const instance: any = {
    getObject: vi.fn(),
    resolveObject: vi.fn((n: string) => instance.getObject(n)),
    registerObject: vi.fn(),
    getObjectOwner: vi.fn(),
    registerNamespace: vi.fn(),
    registerKind: vi.fn(),
    registerItem: vi.fn(),
    registerApp: vi.fn(),
    installPackage: vi.fn(),
    reset: vi.fn(),
    metadata: { get: vi.fn(() => new Map()) },
  };
  function SchemaRegistry() {
    return instance;
  }
  Object.assign(SchemaRegistry, instance);
  return {
    SchemaRegistry,
    computeFQN: (_ns: string | undefined, name: string) => name,
    parseFQN: (fqn: string) => ({ namespace: undefined, shortName: fqn }),
    RESERVED_NAMESPACES: new Set(['base', 'system']),
  };
});

/** Date tokens render from the wall clock, so the clock is pinned. Only `Date`. */
const FIXED_NOW = new Date('2026-06-15T09:00:00Z');

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

function makeDriver(rows: Array<Record<string, unknown>>): IDataDriver {
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
    create: vi.fn(async (_obj: string, row: any) => ({ id: 'new1', ...row })),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  };
  return driver as IDataDriver;
}

const rowId = (n: number) => `r${String(n).padStart(6, '0')}`;

/**
 * A schema whose single autonumber field carries EXACTLY the given keys — the
 * point of most cases below is a key that is present and empty, which a
 * `format?: string` parameter cannot express.
 */
function schemaWith(declaration: Record<string, unknown>) {
  return {
    name: 'rec',
    fields: {
      title: { type: 'text' },
      rec_no: { type: 'autonumber', required: true, ...declaration },
    },
  };
}

/** Stored rows carrying pre-existing record numbers, in insertion order. */
const storedRows = (values: string[]) =>
  values.map((v, i) => ({ id: rowId(i + 1), rec_no: v }));

async function issueOne(schema: any, rows: Array<Record<string, unknown>> = []): Promise<string> {
  vi.mocked(SchemaRegistry.getObject).mockReturnValue(schema as any);
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(rows) as any, true);
  await engine.init();
  const result: any = await engine.insert('rec', { title: 'next' });
  return result.rec_no;
}

describe('ObjectQL applyAutonumbers — the contract default for a format-less field (#6555)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ----------------------------------------- (1) the primary behaviour move --

  describe('an undeclared format renders `{0000}`, not the bare counter', () => {
    /** The bug report's own metadata: `{ rec_no: { type: 'autonumber' } }`. */
    it('issues `0001` on an empty store', async () => {
      expect(await issueOne(schemaWith({}))).toBe('0001');
    });

    it('issues `0011` after stored `1` / `2` / `10` — the bug report verbatim', async () => {
      // The reproduction from #6555. Two facts in one assertion: the counter
      // still reads the stored BARE values (seeding is untouched — `{0000}`
      // renders prefix '' and suffix '', so the unanchored legacy reading still
      // applies and `'10'` beats `'2'` numerically), and the number it issues is
      // now RENDERED padded. `driver-sql` answers `0011` over the same rows.
      expect(await issueOne(schemaWith({}), storedRows(['1', '2', '10']))).toBe('0011');
    });

    it('the counter continues across calls, each rendered padded', async () => {
      vi.mocked(SchemaRegistry.getObject).mockReturnValue(schemaWith({}) as any);
      const engine = new ObjectQL();
      engine.registerDriver(makeDriver([]) as any, true);
      await engine.init();

      const a: any = await engine.insert('rec', { title: 'a' });
      const b: any = await engine.insert('rec', { title: 'b' });

      expect([a.rec_no, b.rec_no]).toEqual(['0001', '0002']);
    });
  });

  // ------------------------------- (2) the second, smaller move: `''` inputs --

  /**
   * The gap the drivers seat measured (#7262, comment 5237739551): no suite on
   * either side declared an empty-string format, and `''` is the one input whose
   * behaviour this half moves. The engine read the key with `??`, which respects
   * an empty string; `resolveAutonumberFormat` counts anything that is not a
   * NON-EMPTY string as undeclared — driver-sql's long-standing truthiness rule,
   * adopted deliberately so the two sides agree.
   */
  describe('an EMPTY declared format is undeclared, and resolves to the default', () => {
    it("`autonumberFormat: ''` renders `0001`, not a bare `1`", async () => {
      expect(await issueOne(schemaWith({ autonumberFormat: '' }))).toBe('0001');
    });

    it("`format: '' ` renders `0001`, not a bare `1`", async () => {
      expect(await issueOne(schemaWith({ format: '' }))).toBe('0001');
    });

    it("an empty canonical key no longer MASKS a declared `format` shorthand", async () => {
      // The sharpest edge of `??` → truthiness, and the only case where the two
      // rules disagree on something other than the default: `'' ?? 'D-{0000}'`
      // is `''` (nullish coalescing does not fall through an empty string), so
      // the engine used to render bare and ignore the shorthand entirely. The
      // resolver falls through to it.
      expect(await issueOne(schemaWith({ autonumberFormat: '', format: 'D-{0000}' }))).toBe('D-0001');
    });

    it('a key holding a non-string is undeclared too', async () => {
      // Unreachable through a parsed `FieldSchema`, reachable through the
      // unvalidated field documents both generators actually hold. The old code
      // fell to `''` here (`typeof fmt === 'string' ? fmt : ''`) and rendered
      // bare; the resolver answers the declared default, same as driver-sql.
      expect(await issueOne(schemaWith({ autonumberFormat: 42 }))).toBe('0001');
      expect(await issueOne(schemaWith({ format: null }))).toBe('0001');
    });
  });

  // -------------------------------------------------- (3) controls — UNMOVED --

  /**
   * Drift guards for the surface this change must NOT touch. Stated plainly:
   * these cannot go red when the fix is reverted, so they are not evidence for
   * the moving leg above — they exist to catch a future edit that overreaches.
   */
  describe('a DECLARED format is honoured exactly as written', () => {
    it('`D-{0000}` is unchanged', async () => {
      expect(await issueOne(schemaWith({ format: 'D-{0000}' }), storedRows(['D-0001', 'D-0002']))).toBe('D-0003');
    });

    it('the spec-canonical key still wins over the shorthand (#1603)', async () => {
      expect(await issueOne(schemaWith({ autonumberFormat: 'A-{000}', format: 'B-{000}' }))).toBe('A-001');
    });

    it('a slot-less format still renders a BARE counter — the escape hatch', async () => {
      // The documented way to keep an unpadded number after this change: declare
      // a format with no `{0..0}` slot. `autonumberFormat: ''` is NOT that
      // spelling (see above), which is the whole reason the changeset spells
      // this out for anyone who was relying on the engine's bare rendering.
      expect(await issueOne(schemaWith({ format: 'PRE-' }))).toBe('PRE-1');
    });

    it('a driver that owns autonumber is untouched — the engine fills nothing', async () => {
      vi.mocked(SchemaRegistry.getObject).mockReturnValue(schemaWith({}) as any);
      const driver: any = makeDriver([]);
      driver.supports = { autonumber: true };
      const engine = new ObjectQL();
      engine.registerDriver(driver, true);
      await engine.init();

      await engine.insert('rec', { title: 'next' });

      // The driver's own sequence answers; the engine hands it an empty slot.
      expect(driver.create.mock.calls[0][1].rec_no).toBeUndefined();
    });
  });
});
