// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6806 — the engine's fallback autonumber counter must RESYNC, from both ends.
 *
 * `applyAutonumbers` seeds `object.field.<scope>` from the store once and then
 * increments purely in memory. That is only the truth while the engine is the
 * sole writer of the field, and it never is:
 *
 *  1. **Exempt writers go through this very method.** `isSystem` seed replay, a
 *     `preserveAudit` historical import and a `beforeInsert` hook stamp all
 *     reach the "respect an explicit value" branch (#5503's strip exempts
 *     exactly those three), so each persists a record number the counter never
 *     saw. The counter then keeps issuing from the one-time seed — BELOW the
 *     store's real max — and every number up to that max is a duplicate
 *     business identifier. This is the warm-DB shape #5495's PROBE1 measured.
 *  2. **Writers outside this process cannot be observed at all.** Another
 *     instance, a direct driver write, a restore. Those surface only as a
 *     unique-constraint failure on the create — and there was no collision
 *     handling on this path, so the driver's raw error reached the caller while
 *     the in-memory counter had already advanced. Each failed create burned a
 *     number and the NEXT insert collided too, one number at a time, until the
 *     counter walked past the real max (#5495's PROBE3).
 *
 * The fix answers each from the end that can see it:
 *
 *  - **Adopt** (`adoptExplicitAutonumber`): lift the counter from the value an
 *    exempt writer supplied, read by #6468's anchoring rules — the SAME reading
 *    the seeding scan performs, shared as `readStoredAutonumberCounter` (whose
 *    anchored half is spec's `readAutonumberCounter`, #6560). Costs one
 *    string parse and NO query, and makes the warm counter converge on what a
 *    cold re-seed of the same store would answer.
 *  - **Re-seed on collision** (`createWithAutonumberResync`): drop the stale
 *    counter, re-seed from the store, re-issue — bounded. Costs nothing until a
 *    collision actually happens.
 *
 * Neither subsumes the other, which is why both are here: adoption covers drift
 * the engine can observe but the store cannot report; collision-resync covers
 * drift the store reports but the engine could not observe.
 *
 * ## The collision half is STORAGE-DEPENDENT, and says so — by driver name
 *
 * It is triggered by the store REJECTING the duplicate, so it reaches only
 * drivers that take this fallback path AND enforce uniqueness. Measured across
 * all five in-repo drivers (`supports.autonumber` read from each):
 * driver-memory (`supports = {}`) and driver-mongodb (absent) take this path;
 * driver-sql declares `autonumber: true`, and driver-sqlite-wasm and
 * driver-turso inherit it (`extends SqlDriver`; Turso spreads
 * `...super.supports`), so none of the three ever reaches here. Of the two that
 * do, only driver-mongodb can raise anything — a single-field unique index,
 * when the field declares `unique`. **driver-memory never can**: `create` is a
 * `table.push()` storing no constraints at all (#4065), so a duplicate lands
 * SILENTLY and this branch is unreachable.
 *
 * That is the repo's EXISTING ruled reading, not a fresh claim by this file:
 * `scripts/driver-memory-census.ledger.json` records it for
 * `packages/runtime/src/autonumber-seed-cross-side-parity.integration.test.ts`
 * as `ruled-permanent` («#6664 A, maintainer 2026-08-08 — inherits #5704
 * Q2 = B») — "InMemoryDriver declares `supports = {}`, so the ENGINE's
 * autonumber seeding owns the counter. No SQL backend can stand in". Section
 * (3b) pins the consequence rather than authoring a second answer to the same
 * question (#6832's one-contract-two-numbers shape). What covers driver-memory
 * is adoption, which waits for no rejection.
 *
 * NOTE this file imports no driver package — the rig below is a hand-rolled
 * fake driver — so it adds no `driver-memory` consumer and
 * `check:driver-memory-census` sees no unledgered arrival.
 *
 * ## What is deliberately NOT changed
 *
 *  - **#6114 / #5979 read-failure discrimination.** A missing table still seeds
 *    from 0; every other read failure still propagates and writes NOTHING —
 *    including on a RE-seed, which is the new call site. Pinned below.
 *  - **A conflict on some OTHER unique field** is rethrown untouched (#5495's
 *    disposition: «非本字段的冲突原样上抛»).
 *  - **The batch path is re-seeded but never re-issued.** `bulkCreate` may be
 *    partially applied, so re-writing a batch could duplicate the rows that did
 *    land. The stale counter is dropped and the driver's error is rethrown as
 *    before.
 *
 * The unique-violation questions are asked of `@objectstack/types`'
 * `isUniqueViolationError` / `uniqueViolationColumn` (#6250 / #6544) — never a
 * word-list of the engine's own (PD #12, precedent #5841).
 *
 * These tests drive a fake DRIVER (not a fake engine), so no engine write-verb
 * dispatch contract is involved.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from './engine';
import { SchemaRegistry } from './registry';
import type { IDataDriver } from '@objectstack/spec/contracts';

vi.mock('./registry', () => {
  const instance: any = {
    getObject: vi.fn(),
    resolveObject: vi.fn((n: string) => instance.getObject(n)),
    // [#9154] This double used to OMIT `getAllObjects`, and every test here
    // passed anyway: the engine's roll-up summary index read it as
    // `getAllObjects?.() ?? []`, so a double that does not model the method
    // was indistinguishable from a registry with nothing in it — the write
    // path silently skipped the insert-time roll-up seed (#5749) and the
    // post-write recompute. With the optional call gone the omission is a
    // hard `TypeError`, which is the point: the double now has to model the
    // method the engine actually calls. Empty is the truthful body for THIS
    // suite — it declares no `summary` field, so the roll-up index over it is
    // empty either way, and now it says so instead of the engine inventing it.
    getAllObjects: vi.fn(() => []),
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

/** Date tokens render from the wall clock, so the clock is pinned. */
const FIXED_NOW = new Date('2026-06-15T09:00:00Z');

type Row = Record<string, unknown>;

/**
 * Evaluate only the operators the seeding walk actually emits. Anything else
 * throws rather than being tolerated — silently ignoring an unknown operator
 * would let a bad query pass as a good one. (Same rig as the #6468 suffix
 * tests, which is the point: these two files must agree about what the scan
 * is allowed to send.)
 */
function matches(row: Row, where: any): boolean {
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

/* --------------------------------------------------------------------------
 * Collision fixtures — the shapes the two fallback drivers actually raise,
 * plus the SQL shapes a third-party fallback driver would.
 * ----------------------------------------------------------------------- */

/**
 * driver-mongodb's duplicate-key error. `code` is 11000 (matched by no
 * signature limb) and the message names the INDEX, never the column — so
 * `isUniqueViolationError` says yes on the `duplicate key` limb while
 * `uniqueViolationColumn` answers `undefined`. That combination is exactly why
 * the resync treats an unnamed column as attributable: MongoDB is the ONE
 * in-repo fallback driver that can raise a collision at all (driver-memory has
 * no uniqueness constraints), and demanding a named column would make the
 * resync unreachable on it.
 */
const mongoDuplicate = (field: string, value: string) =>
  Object.assign(
    new Error(
      `E11000 duplicate key error collection: app.doc index: ${field}_1 dup key: { ${field}: "${value}" }`,
    ),
    { code: 11000 },
  );

/** Postgres names the conflicting COLUMN in its DETAIL line — `uniqueViolationColumn` reads it. */
const postgresDuplicate = (column: string, value: string) =>
  Object.assign(new Error(`duplicate key value violates unique constraint "doc_${column}_key"`), {
    code: '23505',
    detail: `Key (${column})=(${value}) already exists.`,
  });

interface DriverOpts {
  /** Reject a create whose autonumber value is already stored. */
  uniqueOn?: string;
  /** Build the rejection. Defaults to the MongoDB shape. */
  duplicateError?: (field: string, value: string) => unknown;
  /** Reject EVERY create as a duplicate, regardless of the store. */
  alwaysDuplicate?: boolean;
}

/**
 * A driver over a LIVE store: `create` appends, so a later seeding scan sees
 * what earlier inserts wrote — and a test can push rows in directly to play the
 * writer this engine cannot observe.
 */
function makeDriver(rows: Row[], opts: DriverOpts = {}) {
  const created: Row[] = [];
  const queries: any[] = [];
  let findFails: (() => unknown) | null = null;
  const dup = opts.duplicateError ?? mongoDuplicate;
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
      if (findFails) throw findFails();
      queries.push(JSON.parse(JSON.stringify({ where: ast?.where, orderBy: ast?.orderBy, fields: ast?.fields })));
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
    create: vi.fn(async (_obj: string, row: Row) => {
      const field = opts.uniqueOn;
      if (field) {
        const value = String(row[field] ?? '');
        if (opts.alwaysDuplicate || rows.some((r) => r[field] === row[field])) {
          created.push({ ...row, __rejected: true });
          throw dup(field, value);
        }
      }
      created.push({ ...row });
      const stored = { id: `new${created.length}`, ...row };
      rows.push(stored);
      return stored;
    }),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  };
  driver.created = created;
  driver.queries = queries;
  /** Make every subsequent seeding read fail with `make()`; `null` restores it. */
  driver.breakReads = (make: (() => unknown) | null) => {
    findFails = make;
  };
  return driver as IDataDriver & {
    created: Row[];
    queries: any[];
    breakReads: (make: (() => unknown) | null) => void;
  };
}

function schemaWith(field: string, format?: string, extra?: Record<string, unknown>) {
  return {
    name: 'doc',
    fields: {
      title: { type: 'text' },
      ...(extra ?? {}),
      ...(format === undefined
        ? { [field]: { type: 'autonumber', required: true } }
        : { [field]: { type: 'autonumber', required: true, format } }),
    },
  };
}

const rowId = (n: number) => `r${String(n).padStart(6, '0')}`;

/** Stored rows carrying pre-existing record numbers, in insertion order. */
function storedRows(field: string, values: string[]): Row[] {
  return values.map((v, i) => ({ id: rowId(i + 1), [field]: v }));
}

function makeRig(schema: any, rows: Row[], opts: DriverOpts = {}) {
  vi.mocked(SchemaRegistry.getObject).mockReturnValue(schema as any);
  const driver = makeDriver(rows, opts);
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  return { engine, driver, rows };
}

/** Seeding reads carry the projection `['id', <field>]` — that is how they are told apart. */
const seedReads = (driver: { queries: any[] }, field: string) =>
  driver.queries.filter((q) => Array.isArray(q.fields) && q.fields.includes(field));

describe('ObjectQL autonumber resync (#6806)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /* ====================================================================== *
   * (1) Adoption — an exempt writer's number lifts the counter (PROBE1)
   * ==================================================================== */

  describe('an exempt writer\'s record number lifts the seeded counter', () => {
    const SCHEMA = schemaWith('doc_no', 'D-{0000}');

    it('isSystem seed replay — the counter follows the replayed number', async () => {
      const { engine, driver } = makeRig(SCHEMA, storedRows('doc_no', ['D-0003']));
      await engine.init();

      // Seeds from the store (max 3) and issues 4. The counter is now warm.
      expect((await engine.insert('doc', { title: 'first' })).doc_no).toBe('D-0004');

      // A seed replay writes D-0009 straight through: `isSystem` skips #5503's
      // strip entirely, so the value reaches `applyAutonumbers` intact.
      const replayed = await engine.insert(
        'doc',
        { title: 'replayed', doc_no: 'D-0009' },
        { context: { isSystem: true } } as any,
      );
      expect(replayed.doc_no).toBe('D-0009');

      // The defect: the counter stayed at 4 and re-issued D-0005..D-0009,
      // duplicating a business identifier five times over.
      expect((await engine.insert('doc', { title: 'after' })).doc_no).toBe('D-0010');

      // ...and it did it by ADOPTING, not by re-reading: one seeding scan for
      // the whole sequence. The cost of this resync is a string parse.
      expect(seedReads(driver, 'doc_no')).toHaveLength(1);
    });

    it('preserveAudit historical import — same lift, same free cost', async () => {
      const { engine, driver } = makeRig(SCHEMA, storedRows('doc_no', ['D-0003']));
      await engine.init();

      expect((await engine.insert('doc', { title: 'first' })).doc_no).toBe('D-0004');

      const imported = await engine.insert(
        'doc',
        { title: 'legacy', doc_no: 'D-0021' },
        { context: { preserveAudit: true } } as any,
      );
      expect(imported.doc_no).toBe('D-0021');

      expect((await engine.insert('doc', { title: 'after' })).doc_no).toBe('D-0022');
      expect(seedReads(driver, 'doc_no')).toHaveLength(1);
    });

    it('a beforeInsert hook stamp — the third exempt writer (#6339)', async () => {
      const { engine } = makeRig(SCHEMA, storedRows('doc_no', ['D-0003']));
      await engine.init();

      expect((await engine.insert('doc', { title: 'first' })).doc_no).toBe('D-0004');

      // A hook-written key is not caller-supplied, so the strip keeps it.
      engine.registerHook(
        'beforeInsert',
        async (ctx: any) => {
          if (ctx.input.data.title === 'stamped') ctx.input.data.doc_no = 'D-0030';
        },
        { object: 'doc' },
      );
      expect((await engine.insert('doc', { title: 'stamped' })).doc_no).toBe('D-0030');

      expect((await engine.insert('doc', { title: 'after' })).doc_no).toBe('D-0031');
    });

    it('adopts across a batch of exempt rows', async () => {
      const { engine } = makeRig(SCHEMA, storedRows('doc_no', ['D-0003']));
      await engine.init();

      expect((await engine.insert('doc', { title: 'first' })).doc_no).toBe('D-0004');

      await engine.insert(
        'doc',
        [
          { title: 'a', doc_no: 'D-0011' },
          { title: 'b', doc_no: 'D-0014' },
          { title: 'c', doc_no: 'D-0012' },
        ],
        { context: { isSystem: true } } as any,
      );

      // The MAX of the batch wins, not the last row seen.
      expect((await engine.insert('doc', { title: 'after' })).doc_no).toBe('D-0015');
    });
  });

  /* ====================================================================== *
   * (2) Adoption's four refusals — the ways it could do harm instead
   * ==================================================================== */

  describe('adoption never harms', () => {
    const SCHEMA = schemaWith('doc_no', 'D-{0000}');

    it('never LOWERS a counter that has already issued numbers', async () => {
      const { engine } = makeRig(SCHEMA, storedRows('doc_no', ['D-0003']));
      await engine.init();

      expect((await engine.insert('doc', { title: 'first' })).doc_no).toBe('D-0004');

      // A legacy import reinstating an OLD number must not rewind the counter
      // onto numbers it has already issued.
      await engine.insert('doc', { title: 'old', doc_no: 'D-0001' }, { context: { preserveAudit: true } } as any);

      expect((await engine.insert('doc', { title: 'after' })).doc_no).toBe('D-0005');
    });

    it('does not adopt into an UNSEEDED counter — the seeding scan still runs', async () => {
      // The store already holds D-0050. If the exempt value were written in as
      // the seed, the scan would be skipped and the next number (D-0010) would
      // duplicate an existing row — the very defect, arrived at from the fix.
      const { engine, driver } = makeRig(SCHEMA, storedRows('doc_no', ['D-0050']));
      await engine.init();

      await engine.insert('doc', { title: 'replay', doc_no: 'D-0009' }, { context: { isSystem: true } } as any);

      expect((await engine.insert('doc', { title: 'first' })).doc_no).toBe('D-0051');
      expect(seedReads(driver, 'doc_no')).toHaveLength(1);
    });

    it('does not let another SCOPE\'s value lift this scope\'s counter', async () => {
      const DATED = schemaWith('doc_no', 'AD{YYYYMMDD}-{0000}');
      const { engine } = makeRig(DATED, storedRows('doc_no', ['AD20260615-0003']));
      await engine.init();

      expect((await engine.insert('doc', { title: 'first' })).doc_no).toBe('AD20260615-0004');

      // A historical import into a PAST day. Its counter is a different key;
      // reading 900 into today's would burn most of today's band.
      await engine.insert(
        'doc',
        { title: 'legacy', doc_no: 'AD20240101-0900' },
        { context: { preserveAudit: true } } as any,
      );

      expect((await engine.insert('doc', { title: 'after' })).doc_no).toBe('AD20260615-0005');
    });

    it('never throws on a value it cannot parse or place', async () => {
      const SCOPED = schemaWith('doc_no', '{island_zone}-{000}', { island_zone: { type: 'text' } });
      const { engine } = makeRig(SCOPED, storedRows('doc_no', ['A-003']));
      await engine.init();

      expect((await engine.insert('doc', { title: 'first', island_zone: 'A' })).doc_no).toBe('A-004');

      // The interpolated field is empty, so no scope can be rendered. Learning
      // nothing is the answer; rejecting an exempt writer's row is not — it was
      // accepted before this resync existed.
      const odd = await engine.insert(
        'doc',
        { title: 'odd', doc_no: 'not-a-number' },
        { context: { isSystem: true } } as any,
      );
      expect(odd.doc_no).toBe('not-a-number');

      expect((await engine.insert('doc', { title: 'after', island_zone: 'A' })).doc_no).toBe('A-005');
    });

    it('still REFUSES to generate when an interpolated field is empty (control)', async () => {
      const SCOPED = schemaWith('doc_no', '{island_zone}-{000}', { island_zone: { type: 'text' } });
      const { engine } = makeRig(SCOPED, []);
      await engine.init();

      // The generating branch is untouched: only the adopt branch went quiet.
      await expect(engine.insert('doc', { title: 'no zone' })).rejects.toThrow(/island_zone/);
    });
  });

  /* ====================================================================== *
   * (3) Collision — re-seed and re-issue instead of burning numbers (PROBE3)
   * ==================================================================== */

  describe('a collision re-seeds and re-issues rather than burning numbers', () => {
    const SCHEMA = schemaWith('doc_no', 'D-{0000}');

    it('MongoDB E11000: the write SUCCEEDS on the number the re-seed found', async () => {
      const { engine, driver, rows } = makeRig(SCHEMA, storedRows('doc_no', ['D-0003']), {
        uniqueOn: 'doc_no',
      });
      await engine.init();

      expect((await engine.insert('doc', { title: 'first' })).doc_no).toBe('D-0004');

      // A writer this engine cannot observe takes 0005..0007.
      rows.push(...storedRows('doc_no', ['D-0005', 'D-0006', 'D-0007']).map((r, i) => ({ ...r, id: `x${i}` })));

      const recovered = await engine.insert('doc', { title: 'second' });

      // Attempt 1 collided on D-0005; the re-seed read the real max (7) back.
      expect(recovered.doc_no).toBe('D-0008');
      expect(driver.create).toHaveBeenCalledTimes(3); // 1 (first insert) + 2 (collide, re-issue)
      expect(seedReads(driver, 'doc_no')).toHaveLength(2);
    });

    it('converges — the NEXT insert continues from the re-seeded counter', async () => {
      const { engine, driver, rows } = makeRig(SCHEMA, storedRows('doc_no', ['D-0003']), {
        uniqueOn: 'doc_no',
      });
      await engine.init();
      await engine.insert('doc', { title: 'first' });
      rows.push(...storedRows('doc_no', ['D-0005', 'D-0006', 'D-0007']).map((r, i) => ({ ...r, id: `x${i}` })));
      await engine.insert('doc', { title: 'second' });

      // The defect's real cost was that it never converged: the stale counter
      // survived the failure, so 0006 and 0007 collided in turn — one burned
      // number and one raw driver error per insert until it walked past the max.
      expect((await engine.insert('doc', { title: 'third' })).doc_no).toBe('D-0009');
      expect(seedReads(driver, 'doc_no')).toHaveLength(2);
    });

    it('Postgres naming the autonumber COLUMN is attributed the same way', async () => {
      const { engine, rows } = makeRig(SCHEMA, storedRows('doc_no', ['D-0003']), {
        uniqueOn: 'doc_no',
        duplicateError: postgresDuplicate,
      });
      await engine.init();
      await engine.insert('doc', { title: 'first' });
      rows.push({ id: 'x1', doc_no: 'D-0005' });

      expect((await engine.insert('doc', { title: 'second' })).doc_no).toBe('D-0006');
    });

    it('a conflict on a DIFFERENT column is rethrown untouched, with no re-issue', async () => {
      // «非本字段的冲突原样上抛» — #5495's disposition. A duplicate email is the
      // caller's business error; re-issuing a record number cannot fix it, and
      // swallowing it into an engine error would hide what actually failed.
      const { engine, driver } = makeRig(SCHEMA, storedRows('doc_no', ['D-0003']), {
        uniqueOn: 'doc_no',
        alwaysDuplicate: true,
        duplicateError: () => postgresDuplicate('email', 'a@b.example'),
      });
      await engine.init();

      await expect(engine.insert('doc', { title: 'first' })).rejects.toMatchObject({
        code: '23505',
        detail: 'Key (email)=(a@b.example) already exists.',
      });
      expect(driver.create).toHaveBeenCalledTimes(1);
    });

    it('a non-unique driver failure is rethrown untouched, with no re-issue', async () => {
      const { engine, driver } = makeRig(SCHEMA, storedRows('doc_no', ['D-0003']), {
        uniqueOn: 'doc_no',
        alwaysDuplicate: true,
        duplicateError: () => Object.assign(new Error('deadlock detected'), { code: '40P01' }),
      });
      await engine.init();

      await expect(engine.insert('doc', { title: 'first' })).rejects.toThrow(/deadlock detected/);
      expect(driver.create).toHaveBeenCalledTimes(1);
    });

    it('refuses with a NAMED error after the bounded attempts, keeping the driver error as cause', async () => {
      const { engine, driver } = makeRig(SCHEMA, storedRows('doc_no', ['D-0003']), {
        uniqueOn: 'doc_no',
        alwaysDuplicate: true,
      });
      await engine.init();

      const failure = await engine.insert('doc', { title: 'first' }).then(
        () => { throw new Error('expected the insert to be refused'); },
        (e) => e as any,
      );

      // An identity a caller can branch on — not the driver's raw error, and
      // not a bare throw.
      expect(failure.code).toBe('ERR_AUTONUMBER_COLLISION');
      expect(failure.message).toMatch(/doc_no/);
      expect(failure.message).toMatch(/No record was written/);
      // The driver's own diagnosis is preserved rather than replaced.
      expect(String((failure.cause as Error)?.message)).toMatch(/E11000/);
      // Bounded: three attempts, not a spin against a live competitor.
      expect(driver.create).toHaveBeenCalledTimes(3);
    });

    it('burns no numbers when it refuses — the next insert starts from the store', async () => {
      const rows = storedRows('doc_no', ['D-0003']);
      let rejecting = true;
      const { engine } = makeRig(SCHEMA, rows, {
        uniqueOn: 'doc_no',
        get alwaysDuplicate() { return rejecting; },
      } as DriverOpts);
      await engine.init();

      await expect(engine.insert('doc', { title: 'doomed' })).rejects.toMatchObject({
        code: 'ERR_AUTONUMBER_COLLISION',
      });

      // Three failed creates advanced the in-memory counter three times before
      // this fix. The refusal drops the counter instead, so the store — still
      // holding only D-0003 — decides the next number.
      rejecting = false;
      expect((await engine.insert('doc', { title: 'after' })).doc_no).toBe('D-0004');
    });

    it('does not re-issue for a value the ENGINE did not issue', async () => {
      const { engine, driver } = makeRig(SCHEMA, storedRows('doc_no', ['D-0003']), {
        uniqueOn: 'doc_no',
      });
      await engine.init();

      // An exempt writer replaying a number that is already taken. The engine
      // issued nothing on this row, so there is nothing of its own to re-issue
      // and the collision is the writer's to see.
      await expect(
        engine.insert('doc', { title: 'replay', doc_no: 'D-0003' }, { context: { isSystem: true } } as any),
      ).rejects.toThrow(/E11000/);
      expect(driver.create).toHaveBeenCalledTimes(1);
    });

    it('a batch collision drops the counter but does NOT re-issue the batch', async () => {
      // `bulkCreate` may be partially applied, so re-writing is worse than the
      // collision. What must not survive is the stale counter.
      const rows = storedRows('doc_no', ['D-0003']);
      const { engine, driver } = makeRig(SCHEMA, rows, { uniqueOn: 'doc_no' });
      await engine.init();
      await engine.insert('doc', { title: 'first' }); // D-0004, counter warm at 4
      // The unobservable writer takes a whole BAND, not one number: dropping the
      // counter and merely advancing it past the collision are otherwise
      // indistinguishable here, and only the drop reaches the real max.
      rows.push(...storedRows('doc_no', ['D-0005', 'D-0006', 'D-0007', 'D-0008', 'D-0009']).map((r, i) => ({ ...r, id: `x${i}` })));

      // What an author actually gets on a batch: the DRIVER's own error, not
      // the single-row path's `ERR_AUTONUMBER_COLLISION` — because nothing was
      // re-issued, so "re-issued and still refused" would be a false statement.
      const failure = await engine.insert('doc', [{ title: 'a' }]).then(
        () => { throw new Error('expected the batch to be refused'); },
        (e) => e as any,
      );
      expect(failure.message).toMatch(/E11000/);
      expect(failure.code).toBe(11000);
      expect(failure.code).not.toBe('ERR_AUTONUMBER_COLLISION');
      const createsAfterBatch = (driver.create as any).mock.calls.length;

      // The counter was dropped, so the next single insert RE-SEEDS and lands
      // above the whole band (max 9). Merely advancing the stale counter would
      // hand back D-0006 — a number the unobservable writer already took. That
      // is the guarantee a batch DOES get: the caller's retry converges.
      expect((await engine.insert('doc', { title: 'after' })).doc_no).toBe('D-0010');
      expect((driver.create as any).mock.calls.length).toBe(createsAfterBatch + 1);
    });

    it('insertMany reports the same way — driver error, counter dropped', async () => {
      const rows = storedRows('doc_no', ['D-0003']);
      const { engine } = makeRig(SCHEMA, rows, { uniqueOn: 'doc_no' });
      await engine.init();
      await engine.insert('doc', { title: 'first' });
      rows.push(...storedRows('doc_no', ['D-0005', 'D-0006', 'D-0007', 'D-0008', 'D-0009']).map((r, i) => ({ ...r, id: `x${i}` })));

      // Partial-row mode culls rows that fail PREPARATION; a driver write that
      // fails is still a whole-call rejection, so this is the same contract.
      await expect(engine.insertMany('doc', [{ title: 'a' }])).rejects.toMatchObject({ code: 11000 });

      expect((await engine.insert('doc', { title: 'after' })).doc_no).toBe('D-0010');
    });
  });

  /* ====================================================================== *
   * (3b) The collision half is STORAGE-DEPENDENT — name which driver gives
   *      which guarantee, rather than implying one that is not delivered
   * ==================================================================== */

  describe('what a driver with no uniqueness constraint gets (driver-memory)', () => {
    const SCHEMA = schemaWith('doc_no', 'D-{0000}');

    it('a duplicate lands SILENTLY — the collision branch cannot be reached', async () => {
      // `InMemoryDriver.create` is a `table.push()` storing no constraints of
      // any kind (its own docstring since #4065 — it calls itself a WEAK
      // oracle). So a duplicate raises nothing, there is no error to catch, and
      // the re-issue this file pins elsewhere never runs. Recorded rather than
      // papered over (PD #10): "collisions are handled" would be FALSE on one
      // of the two drivers this fallback path serves — and the fallback path is
      // only those two of five, the other three inheriting SqlDriver's
      // `autonumber: true`. So the retry protects ONE backend, and this is the
      // other one.
      //
      // No `uniqueOn` — this rig is the memory driver's shape exactly.
      const rows = storedRows('doc_no', ['D-0003']);
      const { engine, driver } = makeRig(SCHEMA, rows);
      await engine.init();
      await engine.insert('doc', { title: 'first' }); // D-0004

      // The writer this engine cannot observe takes D-0005.
      rows.push({ id: 'x1', doc_no: 'D-0005' });

      const written = await engine.insert('doc', { title: 'second' });

      // The honest outcome: the number is issued a second time, the write
      // SUCCEEDS, and nothing anywhere says so. Fixing this needs uniqueness in
      // the driver — `packages/drivers/**` is under the #5499 freeze, and a
      // pre-issue existence probe in the engine would cost a query per insert
      // and still be racy. Reported as a follow-up, not implemented here.
      expect(written.doc_no).toBe('D-0005');
      expect(rows.filter((r) => r.doc_no === 'D-0005')).toHaveLength(2);
      // One create attempt: with no rejection there is nothing to retry.
      expect(driver.create).toHaveBeenCalledTimes(2); // 'first' + 'second'
    });

    it('...but ADOPTION still holds there — it needs no constraint at all', async () => {
      // The half that does cover driver-memory: drift the engine can observe
      // is fixed without waiting for anyone to reject anything.
      const { engine } = makeRig(SCHEMA, storedRows('doc_no', ['D-0003']));
      await engine.init();

      expect((await engine.insert('doc', { title: 'first' })).doc_no).toBe('D-0004');
      await engine.insert('doc', { title: 'replay', doc_no: 'D-0009' }, { context: { isSystem: true } } as any);

      expect((await engine.insert('doc', { title: 'after' })).doc_no).toBe('D-0010');
    });
  });

  /* ====================================================================== *
   * (4) #6114 / #5979 — read-failure discrimination survives the new call site
   * ==================================================================== */

  describe('read-failure discrimination survives (#6114 / #5979)', () => {
    const SCHEMA = schemaWith('doc_no', 'D-{0000}');

    it('a missing table still seeds from 0 (benign, unchanged)', async () => {
      const { engine, driver } = makeRig(SCHEMA, []);
      driver.breakReads(() => Object.assign(new Error('relation "doc" does not exist'), { code: '42P01' }));
      await engine.init();

      expect((await engine.insert('doc', { title: 'first' })).doc_no).toBe('D-0001');
    });

    it('an outage during the FIRST seed propagates and writes nothing (unchanged)', async () => {
      const { engine, driver } = makeRig(SCHEMA, storedRows('doc_no', ['D-0007']));
      driver.breakReads(() => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }));
      await engine.init();

      await expect(engine.insert('doc', { title: 'first' })).rejects.toThrow(/ECONNREFUSED/);
      expect(driver.create).not.toHaveBeenCalled();
    });

    it('an outage during the RE-seed propagates — never swallowed into 0 or a stale value', async () => {
      // The new call site. If the re-seed answered 0 the way the pre-#5979
      // bare catch did, this insert would come back D-0001 against a store
      // holding D-0007 — the #5979 regression line, arrived at through #6806.
      const rows = storedRows('doc_no', ['D-0003']);
      const { engine, driver } = makeRig(SCHEMA, rows, { uniqueOn: 'doc_no' });
      await engine.init();
      await engine.insert('doc', { title: 'first' }); // D-0004
      rows.push(...storedRows('doc_no', ['D-0005', 'D-0006', 'D-0007']).map((r, i) => ({ ...r, id: `x${i}` })));

      driver.breakReads(() => Object.assign(new Error('Connection terminated unexpectedly'), { code: '08006' }));
      const createsBefore = (driver.create as any).mock.calls.length;

      await expect(engine.insert('doc', { title: 'second' })).rejects.toThrow(/Connection terminated/);
      // Exactly ONE create was attempted after the outage began: the collision,
      // whose re-seed then failed. No number was forged from data never read.
      expect((driver.create as any).mock.calls.length).toBe(createsBefore + 1);

      // And the failed re-seed poisoned nothing: once the store is readable the
      // counter comes back from the real max, not from 0 and not from the
      // burned in-memory value.
      driver.breakReads(null);
      expect((await engine.insert('doc', { title: 'third' })).doc_no).toBe('D-0008');
    });
  });
});
