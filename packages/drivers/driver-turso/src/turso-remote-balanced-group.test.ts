// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [cloud#3485] `TursoDriver`'s REMOTE face compiles a large `$or` / `$and` to a
 * shallow expression tree, as the local face does since #29888.
 *
 * ## The defect
 *
 * The comment-thread gate (plugin-audit) and the attachment gate
 * (service-storage) AND into every caller's read one `ReadableIds` branch per
 * registered parent object, ORed together. #29888 regrouped that `$or` into
 * balanced halves in `SqlDriver`'s knex path, and every hosted environment
 * kept failing: a hosted environment reads through this driver's remote face,
 * whose compiler (`RemoteTransport`) writes SQL text itself and still joined a
 * group's members flat, `(b1) OR (b2) OR … OR (bN)`. SQLite parses that into a
 * tree N levels deep, and the hosted libSQL server refuses a tree deeper than
 * 100 ("Expression tree is too large (maximum depth 100)"): every comment and
 * attachment read of an environment with an app installed answered 500.
 *
 * ## The budget, and why it is measured the way it is
 *
 * The stub here is better-sqlite3, which allows 1000 levels and exposes no
 * `sqlite3_limit`. So the statement the remote face actually sent is
 * re-prepared with its top-level WHERE as the left operand of a chain of
 * {@link SPINE} `AND 1` terms: each adds one level above the WHERE, so the
 * statement fits under 1000 exactly when its WHERE alone fits under
 * 1000 - SPINE = {@link BUDGET}. The same instrument, run as a binary search
 * over the spine's length, reads a WHERE's depth exactly. The harness proves
 * both calibrations on raw SQL before measuring anything, and the gate-shaped
 * reads are also SERVED with the budget engaged on every SELECT the driver
 * sends, so the proof is the driver's own read path, not a re-prepare.
 *
 * Fixtures are synthetic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FLAT_GROUP_MAX_MEMBERS } from '@objectstack/driver-sql';
import { ReadableIds, lowerFilterCondition } from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

/** The depth a hosted libSQL server allows. */
const BUDGET = 100;
/** SQLite's default `SQLITE_MAX_EXPR_DEPTH`, the one the stub's build runs with. */
const NATIVE_LIMIT = 1000;
const SPINE = NATIVE_LIMIT - BUDGET;
const TOO_DEEP = /Expression tree is too large/;

/** The read-path shape a real read passes through before any driver sees it. */
const seamed = (where: unknown): any => lowerFilterCondition(where, { isDatetimeColumn: () => false });

// ---------------------------------------------------------------------------
// The SQL instrument: the top-level WHERE of one SELECT, padded.
// ---------------------------------------------------------------------------

/**
 * The span of a SELECT's top-level WHERE body. Parentheses and quoted text are
 * skipped, so a subquery's own clauses are never taken for the statement's.
 */
function topLevelWhere(sql: string): { start: number; end: number } | null {
  const marks: Array<{ at: number; word: string }> = [];
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') {
      const close = sql.indexOf(c, i + 1);
      if (close < 0) return null;
      i = close;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && /\s/.test(c)) {
      const word = /^\s(where|order by|group by|limit|offset|having)\s/i.exec(sql.slice(i))?.[1];
      if (word) marks.push({ at: i + 1, word: word.toLowerCase() });
    }
  }
  const where = marks.find((m) => m.word === 'where');
  if (!where) return null;
  const end = marks.find((m) => m.at > where.at && m.word !== 'where');
  return { start: where.at + 'where '.length, end: end ? end.at - 1 : sql.length };
}

/** `sql` with its top-level WHERE under `spine` levels of `AND 1`; unchanged when it has none. */
function padded(sql: string, spine: number): string {
  const span = topLevelWhere(sql);
  if (!span) return sql;
  return `${sql.slice(0, span.start)}(${sql.slice(span.start, span.end)})${' AND 1'.repeat(spine)}${sql.slice(span.end)}`;
}

describe('[cloud#3485] TursoDriver remote face — large $or / $and groups compile shallow', () => {
  let stub: LibsqlSqliteStub;
  let driver: TursoDriver;
  /** Every statement the remote face sent, as sent. */
  const sent: Array<{ sql: string; args: unknown[] }> = [];
  /** While on, every SELECT the remote face sends is executed under the budget. */
  const budget = { on: false, applied: 0 };

  const prepares = (sql: string): boolean => {
    try {
      stub.raw.prepare(sql);
      return true;
    } catch (err) {
      if (TOO_DEEP.test(String((err as Error)?.message))) return false;
      throw err;
    }
  };
  /** Does `sql`'s top-level WHERE fit the hosted budget? */
  const fitsBudget = (sql: string) => prepares(padded(sql, SPINE));
  /** The exact depth of `sql`'s top-level WHERE, as SQLite counts it. */
  const whereDepth = (sql: string): number => {
    let lo = 0;
    let hi = NATIVE_LIMIT;
    // The largest spine the statement still prepares under: depth = LIMIT - spine.
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (prepares(padded(sql, mid))) lo = mid;
      else hi = mid - 1;
    }
    return NATIVE_LIMIT - lo;
  };

  /** The SELECTs `run` made the remote face send for `table`. */
  const selectsOf = async (table: string, run: () => Promise<unknown>) => {
    sent.length = 0;
    await run();
    return sent.filter((q) => /^\s*select\b/i.test(q.sql) && q.sql.includes(`FROM "${table}"`));
  };

  beforeAll(async () => {
    stub = makeLibsqlSqliteStub();
    const through = (stmt: unknown) => {
      const sql = typeof stmt === 'string' ? stmt : (stmt as { sql: string }).sql;
      const args = typeof stmt === 'string' ? [] : ((stmt as { args?: unknown[] }).args ?? []);
      sent.push({ sql, args: [...args] });
      if (!budget.on || !/^\s*select\b/i.test(sql) || !topLevelWhere(sql)) return stmt;
      budget.applied++;
      return { sql: padded(sql, SPINE), args };
    };
    const client = {
      execute: (stmt: unknown) => stub.execute(through(stmt)),
      batch: (stmts: unknown[]) => stub.batch(stmts.map(through)),
      close: () => stub.close(),
    };
    driver = new TursoDriver({ url: 'libsql://cloud-3485.turso.io', client: client as never });
    await driver.connect();
    expect(driver.transportMode).toBe('remote');
  });

  afterAll(async () => {
    await driver?.disconnect();
  });

  // -------------------------------------------------------------------------
  // The instrument, calibrated on raw SQL.
  // -------------------------------------------------------------------------

  describe('the instrument', () => {
    beforeAll(() => {
      stub.raw.prepare('CREATE TABLE "calibration" ("id" TEXT PRIMARY KEY, "tag" TEXT)').run();
    });
    // `x = ?` is two levels and each OR above it one more, so k terms are k + 1 deep.
    const chain = (k: number) =>
      `SELECT "id" FROM "calibration" WHERE ${Array.from({ length: k }, () => '"tag" = ?').join(' OR ')}`;

    it('a flat OR chain fits the budget at BUDGET levels and is refused one level deeper', () => {
      expect(fitsBudget(chain(BUDGET - 1))).toBe(true);
      expect(fitsBudget(chain(BUDGET))).toBe(false);
    });

    it('the depth reading is exact on a flat chain', () => {
      for (const k of [1, 2, 9, 77, 300]) expect(whereDepth(chain(k)), `${k} terms`).toBe(k + 1);
    });
  });

  // -------------------------------------------------------------------------
  // The compiler: plain groups, every size class.
  // -------------------------------------------------------------------------

  describe('plain groups', () => {
    const TABLE = 'cloud3485_group';
    const ROWS = 200;
    const idOf = (i: number) => `r${String(i).padStart(3, '0')}`;
    const tagOf = (i: number) => `t${i}`;
    const find = async (where: Record<string, unknown>) =>
      ((await driver.find(TABLE, { where: seamed(where) })) as Array<{ id: string }>).map((r) => r.id).sort();
    const compiled = async (where: Record<string, unknown>) => {
      const selects = await selectsOf(TABLE, () => find(where));
      expect(selects.length, 'one SELECT of the fixture table').toBe(1);
      return selects[0];
    };

    beforeAll(async () => {
      await driver.syncSchema(TABLE, { name: TABLE, fields: { tag: { type: 'text' } } });
      for (let i = 0; i < ROWS; i++) await driver.create(TABLE, { id: idOf(i), tag: tagOf(i) }, { bypassTenantAudit: true });
    });

    it(`a group of at most ${FLAT_GROUP_MAX_MEMBERS} members compiles flat, byte-identical to what it always was`, async () => {
      const members = Array.from({ length: FLAT_GROUP_MAX_MEMBERS }, (_, i) => ({ tag: tagOf(i) }));
      const { sql } = await compiled({ $or: members });
      const span = topLevelWhere(sql)!;
      expect(sql.slice(span.start, span.end)).toBe(`(${members.map(() => '("tag" = ?)').join(' OR ')})`);
      // An `$and` member's own text, read off a one-member group `((member))`.
      const conjunct = { tag: { $ne: tagOf(0) } };
      const one = await compiled({ $and: [conjunct] });
      const oneSpan = topLevelWhere(one.sql)!;
      const member = one.sql.slice(oneSpan.start + 1, oneSpan.end - 1);
      const and = await compiled({ $and: Array(FLAT_GROUP_MAX_MEMBERS).fill(conjunct) });
      const andSpan = topLevelWhere(and.sql)!;
      expect(and.sql.slice(andSpan.start, andSpan.end)).toBe(`(${Array(FLAT_GROUP_MAX_MEMBERS).fill(member).join(' AND ')})`);
      expect(await find({ $or: members })).toEqual(members.map((_, i) => idOf(i)).sort());
    });

    it(`a group of ${FLAT_GROUP_MAX_MEMBERS + 1} members is two halves, members and bind values in order`, async () => {
      const members = Array.from({ length: FLAT_GROUP_MAX_MEMBERS + 1 }, (_, i) => ({ tag: tagOf(i) }));
      const { sql, args } = await compiled({ $or: members });
      const span = topLevelWhere(sql)!;
      const leaf = '("tag" = ?)';
      expect(sql.slice(span.start, span.end)).toBe(
        `((${Array(5).fill(leaf).join(' OR ')}) OR (${Array(4).fill(leaf).join(' OR ')}))`,
      );
      expect(args.slice(0, members.length)).toEqual(members.map((m) => m.tag));
    });

    for (const members of [FLAT_GROUP_MAX_MEMBERS + 1, 130, 1_200]) {
      it(`an $or of ${members} branches selects the same rows and fits the budget`, async () => {
        // Every third row, and a branch that matches nothing at the end.
        const picked = Array.from({ length: members - 1 }, (_, i) => (i * 3) % ROWS);
        const where = { $or: [...picked.map((i) => ({ tag: tagOf(i) })), { tag: 'no-such-tag' }] };
        expect(await find(where)).toEqual([...new Set(picked)].map(idOf).sort());
        const { sql } = await compiled(where);
        expect(fitsBudget(sql)).toBe(true);
      });
    }

    it('an $and of 130 members selects the same rows and fits the budget', async () => {
      // Each member excludes one row; the conjunction keeps the rest.
      const where = { $and: Array.from({ length: 130 }, (_, i) => ({ tag: { $ne: tagOf(i) } })) };
      expect(await find(where)).toEqual(
        Array.from({ length: ROWS - 130 }, (_, i) => idOf(130 + i)).sort(),
      );
      const { sql } = await compiled(where);
      expect(fitsBudget(sql)).toBe(true);
    });

    it('a large $or nested in $and and $not keeps its answer', async () => {
      const branches = Array.from({ length: 60 }, (_, i) => ({ tag: tagOf(i) }));
      // NOT (any of the first 60) AND (one of rows 50..69): rows 60..69.
      const where = {
        $and: [{ $not: { $or: branches } }, { $or: Array.from({ length: 20 }, (_, i) => ({ tag: tagOf(50 + i) })) }],
      };
      expect(await find(where)).toEqual(Array.from({ length: 10 }, (_, i) => idOf(60 + i)).sort());
    });

    it('the depth a group adds grows with log2 of its size, not with its size', async () => {
      const depthOf = async (n: number) => {
        const { sql } = await compiled({ $or: Array.from({ length: n }, (_, i) => ({ tag: tagOf(i % ROWS) })) });
        return whereDepth(sql);
      };
      const at8 = await depthOf(8);
      const at1200 = await depthOf(1_200);
      // 8 → 1,200 is 150× the members; balanced halves add ceil(log2(150)) = 8 levels.
      expect(at1200 - at8).toBeLessThanOrEqual(Math.ceil(Math.log2(1_200 / 8)));
      expect(at1200).toBeLessThan(BUDGET / 4);
    });
  });

  // -------------------------------------------------------------------------
  // The card: the parent-record gate's own shape, 130 parents, served.
  // -------------------------------------------------------------------------

  describe('the parent-record read gate shape, 130 parent objects, served under the budget', () => {
    const COMMENT = 'cloud3485_comment';
    const PARENTS = 130;
    const parentOf = (i: number) => `cloud3485_p${String(i).padStart(3, '0')}`;
    /** A three-level master chain beside them: line → quote → deal (controlled by parent). */
    const DEAL = 'cloud3485_deal';
    const QUOTE = 'cloud3485_quote';
    const LINE = 'cloud3485_line';
    /** The reader may not read this object at all: the engine answers its branch `$in: []`. */
    const VAULT = 'cloud3485_vault';
    const READER = 'reader';
    const TENANT = 'org_a';
    const opts = { tenantId: TENANT } as const;
    const raw = { bypassTenantAudit: true } as const;

    /** A sharing-shaped scope: the reader's own rows, or rows shared with the reader. */
    const ownScope = () => ({ $or: [{ owner: READER }, { shared_with: READER }] });
    const masterScope = (master: string, scope: Record<string, unknown>) => ({
      master_id: { $in: ReadableIds.compose(ReadableIds.of(master), scope) },
    });
    const scopes: Record<string, () => Record<string, unknown>> = {
      [DEAL]: ownScope,
      [QUOTE]: () => masterScope(DEAL, ownScope()),
      [LINE]: () => masterScope(QUOTE, masterScope(DEAL, ownScope())),
    };
    for (let i = 0; i < PARENTS; i++) scopes[parentOf(i)] = ownScope;
    const readable = Object.keys(scopes).sort();

    /** The gate's WHERE, as `computeParentRecordFilter` writes it and the engine composes it. */
    const gate = () => ({
      $or: [
        ...readable.map((p) => ({ object_name: p, record_id: { $in: ReadableIds.compose(ReadableIds.of(p), scopes[p]()) } })),
        { object_name: VAULT, record_id: { $in: [] } },
      ],
    });

    /** The comments the reader may see, derived from the fixture without the driver. */
    const expected: { all: string[]; byThread: Record<string, string[]> } = { all: [], byThread: {} };

    beforeAll(async () => {
      const parentFields = { owner: { type: 'text' }, shared_with: { type: 'text' }, organization_id: { type: 'text' } };
      const detailFields = { ...parentFields, master_id: { type: 'text' } };
      for (const p of [...Array.from({ length: PARENTS }, (_, i) => parentOf(i)), DEAL, VAULT]) {
        await driver.syncSchema(p, { name: p, fields: parentFields });
      }
      for (const p of [QUOTE, LINE]) await driver.syncSchema(p, { name: p, fields: detailFields });
      await driver.syncSchema(COMMENT, {
        name: COMMENT,
        fields: {
          object_name: { type: 'text' },
          record_id: { type: 'text' },
          thread_id: { type: 'text' },
          body: { type: 'text' },
          created_at: { type: 'datetime' },
          organization_id: { type: 'text' },
        },
      });

      /** Which records the reader can open — the oracle the gate must reproduce. */
      const canOpen = new Set<string>();
      const parentRow = async (object: string, id: string, row: Record<string, unknown>, open: boolean) => {
        await driver.create(object, { id, organization_id: TENANT, ...row }, raw);
        if (open) canOpen.add(`${object}:${id}`);
      };
      for (let i = 0; i < PARENTS; i++) {
        const p = parentOf(i);
        await parentRow(p, `${p}-own`, { owner: READER }, true);
        await parentRow(p, `${p}-shared`, { owner: 'someone', shared_with: READER }, true);
        await parentRow(p, `${p}-closed`, { owner: 'someone' }, false);
      }
      // The tenant wall still holds inside every subquery: the reader's own row in another organization.
      await driver.create(parentOf(7), { id: 'foreign-own', owner: READER, organization_id: 'org_b' }, raw);
      await parentRow(DEAL, 'deal-own', { owner: READER }, true);
      await parentRow(DEAL, 'deal-closed', { owner: 'someone' }, false);
      await parentRow(QUOTE, 'quote-open', { master_id: 'deal-own', owner: 'someone' }, true);
      await parentRow(QUOTE, 'quote-closed', { master_id: 'deal-closed', owner: READER }, false);
      await parentRow(LINE, 'line-open', { master_id: 'quote-open', owner: 'someone' }, true);
      await parentRow(LINE, 'line-closed', { master_id: 'quote-closed', owner: READER }, false);
      await parentRow(VAULT, 'vault-own', { owner: READER }, false);

      const targets: Array<[string | null, string | null]> = [];
      for (let i = 0; i < PARENTS; i++) {
        const p = parentOf(i);
        targets.push([p, `${p}-own`], [p, `${p}-shared`], [p, `${p}-closed`]);
      }
      targets.push(
        [parentOf(7), 'foreign-own'],
        [DEAL, 'deal-own'], [DEAL, 'deal-closed'],
        [QUOTE, 'quote-open'], [QUOTE, 'quote-closed'],
        [LINE, 'line-open'], [LINE, 'line-closed'],
        [VAULT, 'vault-own'],
        // A parent that no longer exists, an object the gate does not enumerate, and no parent at all.
        [parentOf(3), 'deleted-record'], ['cloud3485_unlisted', 'x'], [null, null],
      );
      let n = 0;
      for (const [object, record] of targets) {
        const id = `c${String(n).padStart(4, '0')}`;
        const thread = object && record ? `${object}:${record}` : 'no-thread';
        await driver.create(
          COMMENT,
          {
            id,
            object_name: object,
            record_id: record,
            thread_id: thread,
            body: 'x',
            created_at: new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString(),
            organization_id: TENANT,
          },
          raw,
        );
        n++;
        if (object && record && canOpen.has(`${object}:${record}`)) {
          expected.all.push(id);
          (expected.byThread[thread] ??= []).push(id);
        }
      }
      expect(expected.all.length).toBe(PARENTS * 2 + 3);
    }, 120_000);

    const ids = (rows: unknown[]) => (rows as Array<{ id: string }>).map((r) => r.id).sort();

    /** The card's reads, each with the gate ANDed in the way `andIntoWhere` does. */
    const reads: Array<{ name: string; where: () => Record<string, unknown>; orderBy?: any; expect: () => string[] }> = [
      { name: 'unfiltered (top=1 / top=5)', where: () => gate(), expect: () => expected.all },
      {
        name: 'sorted by created_at',
        where: () => gate(),
        orderBy: [{ field: 'created_at', order: 'asc' }],
        expect: () => expected.all,
      },
      {
        name: 'filtered by thread_id',
        where: () => ({ $and: [{ thread_id: `${LINE}:line-open` }, gate()] }),
        expect: () => expected.byThread[`${LINE}:line-open`],
      },
      {
        name: 'filtered by a thread the reader may not open',
        where: () => ({ $and: [{ thread_id: `${LINE}:line-closed` }, gate()] }),
        expect: () => [],
      },
      {
        name: 'filtered by the parent pair (the attachment read)',
        where: () => ({
          $and: [{ $and: [{ object_name: parentOf(42) }, { record_id: `${parentOf(42)}-shared` }] }, gate()],
        }),
        expect: () => expected.byThread[`${parentOf(42)}:${parentOf(42)}-shared`],
      },
      { name: 'filtered by body', where: () => ({ $and: [{ body: 'x' }, gate()] }), expect: () => expected.all },
    ];

    for (const read of reads) {
      it(`${read.name}: served under the budget, with exactly the readable rows`, async () => {
        const query = { where: seamed(read.where()), ...(read.orderBy ? { orderBy: read.orderBy } : {}) };
        const unbounded = ids(await driver.find(COMMENT, query, opts));
        budget.on = true;
        const before = budget.applied;
        try {
          const within = ids(await driver.find(COMMENT, query, opts));
          const counted = await driver.count(COMMENT, { where: query.where }, opts);
          expect(budget.applied - before, 'the budget engaged on the reads').toBeGreaterThanOrEqual(2);
          expect(within).toEqual(unbounded);
          expect(counted).toBe(within.length);
        } finally {
          budget.on = false;
        }
        expect(unbounded).toEqual([...read.expect()].sort());
      });
    }

    it('aggregate agrees with find under the budget', async () => {
      budget.on = true;
      try {
        const out = await driver.aggregate(
          COMMENT,
          { where: seamed(gate()), aggregations: [{ function: 'count', alias: 'n' }] },
          opts,
        );
        expect(Number((out[0] as any).n)).toBe(expected.all.length);
      } finally {
        budget.on = false;
      }
    });

    it('the gate WHERE is far inside the budget, and its depth is what one branch adds plus log2 of the branch count', async () => {
      const [select] = await selectsOf(COMMENT, () => driver.find(COMMENT, { where: seamed(gate()) }, opts));
      const depth = whereDepth(select.sql);
      // One branch alone: the deepest one, the three-level master chain.
      const [single] = await selectsOf(COMMENT, () =>
        driver.find(
          COMMENT,
          { where: seamed({ object_name: LINE, record_id: { $in: ReadableIds.compose(ReadableIds.of(LINE), scopes[LINE]()) } }) },
          opts,
        ),
      );
      const branch = whereDepth(single.sql);
      const branches = readable.length + 1;
      expect(depth).toBeLessThanOrEqual(branch + FLAT_GROUP_MAX_MEMBERS + Math.ceil(Math.log2(branches / FLAT_GROUP_MAX_MEMBERS)));
      expect(depth).toBeLessThan(BUDGET / 2);
    });
  });
});
