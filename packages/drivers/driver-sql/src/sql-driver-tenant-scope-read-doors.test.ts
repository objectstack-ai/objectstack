// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every read door routes through the tenant chokepoint — objectstack#6792.
 *
 * # What was open
 *
 * `applyTenantScope()` says of itself that it is "the single chokepoint for
 * read-side tenant isolation in the SQL driver; every CRUD method routes
 * through it". THREE methods did not:
 *
 *   - `findWithWindowFunctions()` — the live window-function read door (#4286).
 *     It returns ROWS. With `options.tenantId` set on an object that has a
 *     tenant field, it returned rows belonging to EVERY tenant: cross-tenant
 *     read exposure at the driver layer, the #3724 class.
 *   - `analyzeQuery()` / `explain()` — returns a PLAN. Lower severity and a
 *     different defect: a plan is only worth reading if it explains the
 *     statement `find()` would actually run, and a statement missing the tenant
 *     predicate has different selectivity and picks different indexes. This is
 *     the same failure #6577 fixed on these two methods for `limit`, one
 *     builder line higher.
 *   - `distinct()` — returns one column's VALUES for every tenant. Named in no
 *     card; #6792 says the OPPOSITE, listing `distinct` among the 13 scoped
 *     sites (the 13th read site is `aggregate()`). Found by running the gate
 *     this change ships, which is the argument for having one.
 *
 * All three built through `this.getBuilder(object, options)` and none followed
 * it with `applyTenantScope`, which is what every other read site does.
 *
 * Measured on `main` at `6595262`, before any line was added, against the
 * fixture below (`org_a` owns a1/a2, `org_b` owns b1/b2, p1 is a NULL-org
 * platform row):
 *
 * ```
 * find     {} tenantId=org_a -> 3 rows  (a1, a2, p1)
 * window   {} tenantId=org_a -> 5 rows  (a1, a2, b1, b2, p1)  <- org_b's rows
 * distinct 'name' tenantId=org_a -> [A1, A2, B1, B2, P1]      <- org_b's values
 * analyze  {} tenantId=org_a -> select * from `os6792_account` <- no predicate
 * find     {} tenantId=org_a -> select * from `os6792_account`
 *                               where (`organization_id` = ? or `organization_id`
 *                               is null) order by `id` asc
 * ```
 *
 * # Why the plan half asserts against a captured statement
 *
 * It cannot assert rows. So it asserts the tenant predicate against the
 * statement a real `find()` **actually sent**, read off knex's `query` event,
 * rather than against a predicate this file spells out itself. A test that
 * rebuilds the expectation asserts only that knex works, and stays green on the
 * day the two doors diverge again — which is the day this file exists for.
 *
 * # The negative cases are the fix's real boundary
 *
 * `applyTenantScope` is a no-op in two situations that must stay no-ops: no
 * `tenantId` (the admin / seed / cross-org tooling path, kept working
 * deliberately) and an object with no tenant field. Adding a scope call to a
 * door is only correct if it inherits BOTH early-outs — a door that starts
 * answering `[]` to an unscoped admin read is a different defect, not a fix. So
 * each exposure case is stated beside the read it must not become.
 *
 * The NULL-org row is here for the same reason. `applyTenantScope` emits
 * `(field = ? OR field IS NULL)` on purpose (#2734: strict equality hid every
 * platform-seeded RBAC row from every tenant admin). A door "fixed" with a bare
 * equality would pass a naive cross-tenant assertion and silently lose p1, so
 * p1 is what distinguishes routing through the chokepoint from reimplementing
 * a worse copy of it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './index.js';

const TABLE = 'os6792_account';
const UNSCOPED_TABLE = 'os6792_ledger';

/** Records the SQL this driver really sent, so the plan door can be held to it. */
class InspectableSqlDriver extends SqlDriver {
  readonly statements: Array<{ sql: string; bindings: readonly unknown[] }> = [];

  captureStatements(): void {
    this.knex.on('query', (data: { sql?: string; bindings?: readonly unknown[] }) => {
      if (typeof data?.sql === 'string') {
        this.statements.push({ sql: data.sql, bindings: data.bindings ?? [] });
      }
    });
  }

  /** The one statement issued against `table` while `run` executed. */
  async statementFor(
    table: string,
    run: () => Promise<unknown>,
  ): Promise<{ sql: string; bindings: readonly unknown[] }> {
    const before = this.statements.length;
    await run();
    const issued = this.statements.slice(before).filter((s) => s.sql.includes(table));
    expect(issued).toHaveLength(1);
    return issued[0]!;
  }
}

/** The window spec this file reads with — argument-less by the #4286 contract. */
const WINDOW = {
  windowFunctions: [
    { function: 'ROW_NUMBER', alias: 'rn', orderBy: [{ field: 'balance', order: 'desc' }] },
  ],
} as const;

const ids = (rows: any[]): string[] => rows.map((r) => r.id).sort();

describe('driver-sql — every read door routes through applyTenantScope (#6792)', () => {
  let driver: InspectableSqlDriver;

  beforeAll(async () => {
    driver = new InspectableSqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    } as any);
    await driver.initObjects([
      {
        name: TABLE,
        fields: {
          organization_id: { type: 'string' },
          name: { type: 'string' },
          balance: { type: 'number' },
        },
      },
      // No `organization_id`: `resolveTenantField` returns null, so the
      // chokepoint is a no-op here by design.
      {
        name: UNSCOPED_TABLE,
        fields: { name: { type: 'string' }, balance: { type: 'number' } },
      },
    ] as any);

    await driver.create(TABLE, { id: 'a1', organization_id: 'org_a', name: 'A1', balance: 10 } as any);
    await driver.create(TABLE, { id: 'a2', organization_id: 'org_a', name: 'A2', balance: 20 } as any);
    await driver.create(TABLE, { id: 'b1', organization_id: 'org_b', name: 'B1', balance: 30 } as any);
    await driver.create(TABLE, { id: 'b2', organization_id: 'org_b', name: 'B2', balance: 40 } as any);
    // Platform row: belongs to no tenant, so it belongs to no OTHER tenant
    // either and must stay visible (#2734).
    await driver.create(TABLE, { id: 'p1', name: 'P1', balance: 50 } as any);

    await driver.create(UNSCOPED_TABLE, { id: 'l1', name: 'L1', balance: 1 } as any);
    await driver.create(UNSCOPED_TABLE, { id: 'l2', name: 'L2', balance: 2 } as any);

    driver.captureStatements();
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  describe('findWithWindowFunctions — the ROW-returning door', () => {
    it('does not return another tenant\'s rows', async () => {
      const rows = await driver.findWithWindowFunctions(TABLE, { ...WINDOW } as any, {
        tenantId: 'org_a',
      } as any);
      expect(ids(rows)).toEqual(['a1', 'a2', 'p1']);
      expect(ids(rows)).not.toContain('b1');
      expect(ids(rows)).not.toContain('b2');
    });

    it('gives each tenant its own rows, and only its own', async () => {
      const a = await driver.findWithWindowFunctions(TABLE, { ...WINDOW } as any, { tenantId: 'org_a' } as any);
      const b = await driver.findWithWindowFunctions(TABLE, { ...WINDOW } as any, { tenantId: 'org_b' } as any);
      expect(ids(a)).toEqual(['a1', 'a2', 'p1']);
      expect(ids(b)).toEqual(['b1', 'b2', 'p1']);
    });

    it('agrees with `find()` on the same read — one driver, one answer', async () => {
      const viaWindow = await driver.findWithWindowFunctions(TABLE, { ...WINDOW } as any, { tenantId: 'org_a' } as any);
      const viaFind = await driver.find(TABLE, {}, { tenantId: 'org_a' });
      expect(ids(viaWindow)).toEqual(ids(viaFind));
    });

    it('keeps the NULL-org platform row visible — the chokepoint, not a bare equality (#2734)', async () => {
      const rows = await driver.findWithWindowFunctions(TABLE, { ...WINDOW } as any, { tenantId: 'org_a' } as any);
      expect(ids(rows)).toContain('p1');
    });

    it('honours the ADR-0105 D2 union posture the same way the chokepoint does (#3623)', async () => {
      const rows = await driver.findWithWindowFunctions(TABLE, { ...WINDOW } as any, {
        tenantId: 'org_a',
        tenantIds: ['org_a', 'org_b'],
      } as any);
      expect(ids(rows)).toEqual(['a1', 'a2', 'b1', 'b2', 'p1']);

      const narrow = await driver.findWithWindowFunctions(TABLE, { ...WINDOW } as any, {
        tenantId: 'org_a',
        tenantIds: ['org_a'],
      } as any);
      expect(ids(narrow)).toEqual(['a1', 'a2', 'p1']);
    });

    it('still applies the caller\'s own `where` beside the tenant predicate', async () => {
      const rows = await driver.findWithWindowFunctions(
        TABLE,
        { ...WINDOW, where: { balance: { $gte: 20 } } } as any,
        { tenantId: 'org_a' } as any,
      );
      // `p1` (balance 50) is the NULL-org platform row and is legitimately
      // visible to org_a — it passes the filter AND the chokepoint. b1/b2
      // (30/40) pass the filter and must not survive the tenant predicate.
      expect(ids(rows)).toEqual(['a2', 'p1']);
    });

    it('still computes the window function itself', async () => {
      const rows = await driver.findWithWindowFunctions(TABLE, { ...WINDOW } as any, { tenantId: 'org_a' } as any);
      expect(rows.every((r) => r.rn !== undefined)).toBe(true);
    });

    // ── the two early-outs the fix must inherit, not override ────────────────

    it('is UNSCOPED with no tenantId — the admin / seed / cross-org path stays open', async () => {
      const rows = await driver.findWithWindowFunctions(TABLE, { ...WINDOW } as any);
      expect(ids(rows)).toEqual(['a1', 'a2', 'b1', 'b2', 'p1']);
    });

    it('is unaffected on an object with no tenant field, tenantId or not', async () => {
      const scoped = await driver.findWithWindowFunctions(UNSCOPED_TABLE, { ...WINDOW } as any, {
        tenantId: 'org_a',
      } as any);
      expect(ids(scoped)).toEqual(['l1', 'l2']);
    });
  });

  /**
   * NOT one of the two doors #6792 names. Found by the gate this card ships,
   * while checking what it would be red on — and the card's own enumeration
   * says the opposite ("It is called at 13 sites — `findRows` …, `count`,
   * `distinct`, the write paths"). `distinct` is not among them; the 13th read
   * site is `aggregate`. Triage repeated the count without re-deriving which
   * methods it covered, and both PM measurements inherited that.
   *
   * It returns column VALUES rather than whole rows, which lowers the volume
   * and not the class: one call hands back every OTHER tenant's values for the
   * named column. The door is documented with a runnable example
   * (`content/docs/protocol/objectql/query-syntax.mdx:819`,
   * `const industries = await driver.distinct('account', 'industry')`), so it
   * is exposed the same way `findWithWindowFunctions` is.
   *
   * (Unrelated to the v17 note that "`aggregate()` / `distinct()` leaked" —
   * that one is raw epoch storage reaching presentation, #3839/#3849.)
   */
  describe('distinct — the third read door, found by the gate rather than by the card', () => {
    it('does not return another tenant\'s values', async () => {
      const values = await driver.distinct(TABLE, 'name', undefined, { tenantId: 'org_a' } as any);
      expect(values.sort()).toEqual(['A1', 'A2', 'P1']);
      expect(values).not.toContain('B1');
      expect(values).not.toContain('B2');
    });

    it('agrees with `find()` about which rows it may see', async () => {
      const values = await driver.distinct(TABLE, 'name', undefined, { tenantId: 'org_b' } as any);
      const rows = await driver.find(TABLE, {}, { tenantId: 'org_b' });
      expect(values.sort()).toEqual(rows.map((r: any) => r.name).sort());
    });

    it('still narrows by the caller\'s own filter beside the tenant predicate', async () => {
      const values = await driver.distinct(TABLE, 'name', { balance: { $gte: 20 } } as any, {
        tenantId: 'org_a',
      } as any);
      // `P1` is the NULL-org platform row (balance 50) — see the window-door
      // case above. `B1`/`B2` also pass the filter and must not survive.
      expect(values.sort()).toEqual(['A2', 'P1']);
    });

    it('is UNSCOPED with no tenantId — the admin / seed path stays open', async () => {
      const values = await driver.distinct(TABLE, 'name');
      expect(values.sort()).toEqual(['A1', 'A2', 'B1', 'B2', 'P1']);
    });

    it('is unaffected on an object with no tenant field', async () => {
      const values = await driver.distinct(UNSCOPED_TABLE, 'name', undefined, {
        tenantId: 'org_a',
      } as any);
      expect(values.sort()).toEqual(['L1', 'L2']);
    });
  });

  describe('analyzeQuery / explain — the PLAN door', () => {
    it('carries the tenant predicate `find()` actually emitted', async () => {
      const emitted = await driver.statementFor(TABLE, () =>
        driver.find(TABLE, {}, { tenantId: 'org_a' }),
      );
      const analyzed = await driver.analyzeQuery(TABLE, {} as any, { tenantId: 'org_a' } as any);

      // Read the predicate off the statement `find()` really sent rather than
      // spelling it here, so a change to the chokepoint's SQL moves both sides.
      expect(emitted.sql).toContain('organization_id');
      expect(emitted.bindings).toContain('org_a');

      expect(analyzed.sql).toContain('organization_id');
      expect(analyzed.bindings).toContain('org_a');
    });

    it('emitted a statement with NO tenant predicate before this fix — the regression sentinel', async () => {
      const analyzed = await driver.analyzeQuery(TABLE, {} as any, { tenantId: 'org_a' } as any);
      expect(analyzed.sql.toLowerCase()).toContain('organization_id');
    });

    it('reaches the same statement through `explain()`, which forwards here', async () => {
      const explained = await driver.explain(TABLE, {} as any, { tenantId: 'org_a' } as any);
      expect(explained.sql).toContain('organization_id');
      expect(explained.bindings).toContain('org_a');
    });

    it('carries the union predicate under the group posture', async () => {
      const analyzed = await driver.analyzeQuery(TABLE, {} as any, {
        tenantId: 'org_a',
        tenantIds: ['org_a', 'org_b'],
      } as any);
      expect(analyzed.sql).toContain('organization_id');
      expect(analyzed.bindings).toContain('org_a');
      expect(analyzed.bindings).toContain('org_b');
    });

    it('still returns a plan alongside the statement, unchanged by any of this', async () => {
      const analyzed = await driver.analyzeQuery(TABLE, {} as any, { tenantId: 'org_a' } as any);
      expect(analyzed.plan).toBeDefined();
      expect(analyzed.error).toBeUndefined();
    });

    it('emits no tenant predicate when the caller gave no tenantId', async () => {
      const analyzed = await driver.analyzeQuery(TABLE, {} as any);
      expect(analyzed.sql).not.toContain('organization_id');
    });

    it('emits no tenant predicate for an object with no tenant field', async () => {
      const analyzed = await driver.analyzeQuery(UNSCOPED_TABLE, {} as any, { tenantId: 'org_a' } as any);
      expect(analyzed.sql).not.toContain('organization_id');
    });
  });
});
