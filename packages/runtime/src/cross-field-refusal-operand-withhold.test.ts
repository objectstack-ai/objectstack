// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7929 / #7988, maintainer ruling 2026-08-12 — option B] A cross-field
 * `{ $field }` refusal from `driver-sql` is still a refusal, and no longer
 * discloses the predicate — on BOTH merge boundaries, and for the author too.
 *
 * ## What was measured, and why it needed a ruling
 *
 * An administrator's CEL sharing/permission rule compiles to `{ $field: path }`
 * (`compileCelToFilter`) and is ANDed into the caller's query by whichever
 * boundary is in play. When the reference fails one of the four #5222 rulings,
 * `driver-sql` refused with `INVALID_FILTER` / 400 and the message named the
 * policy — the referenced column, the target column, and, on the tenant arm,
 * WHICH column is the tenant-isolation column of the object. The caller wrote
 * none of it. Four captured response bodies are on #7929; the sharpest returned
 * `sharing_rule.manager_budget`, pure sharing-rule content, inside
 * `error.message`.
 *
 * ⛔ The obvious repair was ruled out before this file existed: widening
 * `errorResponseBase`'s withhold to 4xx would delete #5367's deliberate
 * 5xx-only tiering AND #5667's legible-undeclared-5xx decision. The 400 here is
 * a DECLARED 4xx and passes that boundary intact — by design, and pinned in
 * `analytics-query-read-scope-withhold.test.ts` as "a DECLARED 4xx is
 * untouched". So the withhold lands at the driver, and this file is where that
 * choice is checked end-to-end rather than at the unit that implements it.
 *
 * ## Why BOTH paths, in one file
 *
 * "The merge boundary" is two boundaries in two packages (#7988):
 *
 * | path | who merges the admin's filter | package |
 * |---|---|---|
 * | `POST /analytics/query` | `ObjectQLStrategy.withReadScope` | `service-analytics` |
 * | ordinary CRUD read | security middleware → `opCtx.ast.where` | `plugin-security` |
 *
 * Both hand `driver-sql` an unmarked `FilterCondition`, and the CRUD one
 * PREDATES the routing that made the analytics one reachable (#5222, not
 * #7598). A fix pinned only on the analytics face would leave the larger face
 * open with every gate green, which is exactly the failure #7988 was filed to
 * prevent. The withhold is one seam in the driver, so one seam is what both
 * arms below exercise — through the real REST route for the analytics face, and
 * through a real `ObjectQL` engine with a security-middleware-shaped injection
 * for the CRUD face.
 *
 * ## [#8220] The byte-equality pin was REWRITTEN here, deliberately
 *
 * Until A landed, section (c) pinned a byte-EQUALITY: an author-written
 * `$field` filter and a policy-injected one had to produce IDENTICAL messages,
 * because the driver genuinely could not tell them apart — `DriverQuery`
 * carried no provenance, and pinning the equality was the strongest available
 * statement of that fact. A (#8220, the sanctioned follow-up of the same
 * ruling) is precisely the change that makes them distinguishable: the two
 * merge boundaries stamp the spec-declared filter-subtree provenance mark
 * (`markFilterSubtreeProvenance`, `@objectstack/spec/data`) on each arm of
 * their merge, and the driver restores the full author-facing diagnostic for
 * a subtree POSITIVELY marked `'author'`.
 *
 * So the old equality is not a failing test to re-green — it is SUPERSEDED,
 * and section (c) now pins its successor, the three-way split "Done means" on
 * #8220 names:
 *
 *  1. a policy-injected predicate still withholds (unchanged from B);
 *  2. an author's own filter, vouched at a real merge boundary, names its
 *     columns again — the messages now DIFFER, by design;
 *  3. an UNMARKED predicate — one no boundary ever vouched — still withholds,
 *     byte-identical to the policy case. This is B's surviving half, and the
 *     fail-closed invariant: the mark is permission to reveal, so "mark
 *     missing" must never land on the disclosing branch. ⛔ Do not "restore
 *     the author's columns" for this case; that reopens the disclosure on
 *     every unmarked policy predicate.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { CROSS_FIELD_OBJECT_FIELDS, CROSS_FIELD_ROWS } from '@objectstack/driver-sql';
import { AnalyticsService } from '@objectstack/service-analytics';
import type { AnalyticsQuery, DriverQuery } from '@objectstack/spec/contracts';
import type { AggregationNode, Cube, FilterCondition } from '@objectstack/spec/data';
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

const OBJECT = 'cross_field_deal';

/**
 * The names a refusal must not put in front of a caller: the two operands of
 * every scope below, the object, and the columns the corpus declares.
 *
 * `sharing_rule.manager_budget` is listed by both spellings — the dotted path
 * and its head — because a message that printed only the head would still be
 * naming an administrator's sharing rule.
 */
const POLICY_NAMES = [
  'organization_id',
  'secret_policy_column',
  'sharing_rule.manager_budget',
  'sharing_rule',
  'manager_budget',
  'amount',
  'stage',
  'budget',
];

/**
 * The four read scopes captured on #7929, verbatim, plus the composed case.
 *
 * Each one is what `compileCelToFilter` emits for a field-to-field comparison
 * in an admin-authored rule, and each fails a different one of the four #5222
 * rulings — so the arm below is not four spellings of one code path.
 */
const CAPTURED_SCOPES: Array<[string, FilterCondition]> = [
  ['the tenant-isolation column as referent', { stage: { $eq: { $field: 'organization_id' } } } as FilterCondition],
  ['an undeclared policy column', { amount: { $gt: { $field: 'secret_policy_column' } } } as FilterCondition],
  ['a dotted sharing-rule path', { amount: { $gt: { $field: 'sharing_rule.manager_budget' } } } as FilterCondition],
  ['a cross-class comparison', { stage: { $gt: { $field: 'amount' } } } as FilterCondition],
];

/** Every column of the corpus fixture, as a plain cube dimension. */
const CUBE: Cube = {
  name: 'deals',
  sql: OBJECT,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: Object.fromEntries(
    ['id', 'amount', 'budget', 'stage', 'owner', 'starts_on', 'ends_on', 'organization_id'].map(
      (n) => [n, { name: n, label: n, type: 'string', sql: n }],
    ),
  ),
  public: false,
} as unknown as Cube;

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

// ── the REST harness (the shape `dispatcher-plugin.error-envelope.test.ts` uses) ──

function makeFakeServer() {
  const handlers: Record<string, (req: any, res: any) => any> = {};
  const rec = (verb: string) => (path: string, handler: any) => {
    handlers[`${verb} ${path}`] = handler;
  };
  return {
    handlers,
    server: { get: rec('GET'), post: rec('POST'), put: rec('PUT'), delete: rec('DELETE'), patch: rec('PATCH') },
  };
}

function makeCtx(fakeServer: any, analytics: unknown) {
  const kernel = {
    getService: (name: string) => (name === 'analytics' ? analytics : undefined),
    getServiceAsync: async (name: string) => (name === 'analytics' ? analytics : undefined),
  };
  return {
    getKernel: () => kernel,
    getService: (name: string) => (name === 'http.server' ? fakeServer : undefined),
    environmentId: undefined,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    hook: () => {},
    on: () => {},
  } as any;
}

function makeRes() {
  const res: any = {
    statusCode: undefined as number | undefined,
    body: undefined as any,
    status(c: number) { res.statusCode = c; return res; },
    header() { return res; },
    json(b: any) { res.body = b; return res; },
  };
  return res;
}

/** Drive the REAL `POST /api/v1/analytics/query` route against `analytics`. */
async function postAnalyticsQuery(analytics: unknown, body: unknown) {
  const { server, handlers } = makeFakeServer();
  const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
  await plugin.start?.(makeCtx(server, analytics));

  const handler = handlers['POST /api/v1/analytics/query'];
  expect(handler, 'POST /api/v1/analytics/query must be mounted').toBeTypeOf('function');

  const res = makeRes();
  await handler({ body, query: {} }, res);
  return res;
}

describe('[#7929] a cross-field refusal keeps its envelope and stops disclosing the predicate', () => {
  let driver: SqliteWasmDriver;
  /** Everything the driver wrote to its log during one run. */
  let logged: string[];
  /** Every `executeRawSql` the analytics arm made — the decline's control. */
  let rawSqlCalls: string[];
  /** The scope `getReadScope` answers with, swapped per case. */
  let readScope: FilterCondition | null;
  let analytics: AnalyticsService;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([{ name: OBJECT, fields: CROSS_FIELD_OBJECT_FIELDS } as any]);
    for (const row of CROSS_FIELD_ROWS) await driver.create(OBJECT, { ...row });

    logged = [];
    rawSqlCalls = [];
    readScope = null;
    // The server-side half has to land SOMEWHERE for the withhold to be a
    // relocation rather than a deletion. `logger` is the sink `SqlDriver`
    // already owns and a host already injects; spying on it is what a host
    // wiring a real logger would see.
    (driver as unknown as { logger: unknown }).logger = {
      warn: (m: string) => { logged.push(String(m)); },
      error: () => {},
      info: () => {},
    };

    analytics = new AnalyticsService({
      cubes: [CUBE],
      // BOTH paths advertised, so `NativeSQLStrategy` (priority 10) wins every
      // query unless it DECLINES. `rawSqlCalls` staying empty is therefore a
      // measurement of the #7598 Q1=B decline, not of a missing capability.
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      executeRawSql: async (_object: string, sql: string) => { rawSqlCalls.push(sql); return []; },
      executeAggregate: async (objectName: string, options: any) => {
        const query: DriverQuery = {
          where: options.filter as FilterCondition,
          groupBy: options.groupBy,
          aggregations: options.aggregations?.map(({ field, method, alias }: any) => ({
            field,
            function: method as AggregationNode['function'],
            alias,
          })),
        };
        return (await driver.aggregate(objectName, query)) as Record<string, unknown>[];
      },
      getReadScope: () => (readScope ?? undefined) as never,
    } as never);
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  // ── (a) the analytics face — the four captured bodies ────────────────────

  describe('the analytics route (`POST /analytics/query`, read scope merged by service-analytics)', () => {
    for (const [name, scope] of CAPTURED_SCOPES) {
      it(`${name} → 400 INVALID_FILTER, and the response names no part of the policy`, async () => {
        logged = [];
        rawSqlCalls = [];
        readScope = scope;
        const res = await postAnalyticsQuery(analytics, {
          cube: 'deals',
          dimensions: ['id'],
          measures: ['n'],
        } as AnalyticsQuery);
        readScope = null;

        // Still refused, and refused the same way: this is the half a
        // disclosure fix is most likely to break, so it is asserted first.
        expect(res.body?.success).toBe(false);
        expect(res.body?.error?.code).toBe('INVALID_FILTER');
        expect(res.body?.error?.httpStatus ?? res.statusCode).toBe(400);
        // The native emitter never saw the query — the decline put it on the
        // engine path, which is the only road that reaches the driver's gate.
        expect(rawSqlCalls, 'NativeSQLStrategy did not decline').toEqual([]);

        const message = String(res.body?.error?.message ?? '');
        for (const policyName of POLICY_NAMES) {
          expect(message, `the response names "${policyName}"`).not.toContain(policyName);
        }
        // …and the operator's copy is intact, so this is a relocation.
        expect(logged.join('\n'), 'the server log lost the diagnostic').toContain('$field');
      });
    }

    it('a caller `where` composed with a refused scope discloses nothing either', async () => {
      // The composed case from the #7929 capture: the caller wrote
      // `stage = 'won'`, the administrator wrote the reference, and the driver
      // receives `{ $and: [ … ] }` with nothing saying which arm is whose.
      // That indistinguishability is the whole reason B withholds for everyone.
      logged = [];
      rawSqlCalls = [];
      readScope = { amount: { $gt: { $field: 'secret_policy_column' } } } as FilterCondition;
      const res = await postAnalyticsQuery(analytics, {
        cube: 'deals',
        dimensions: ['id'],
        measures: ['n'],
        where: { stage: 'won' },
      } as unknown as AnalyticsQuery);
      readScope = null;

      expect(res.body?.error?.code).toBe('INVALID_FILTER');
      expect(String(res.body?.error?.message)).not.toContain('secret_policy_column');
      expect(rawSqlCalls).toEqual([]);
    });

    it("[#8220] an AUTHOR-written `where` on this face names its columns again", async () => {
      // No read scope in play: the strategy-built filter is the caller's own
      // text, `withReadScope` marks it 'author', and the driver restores the
      // full diagnostic through the same real route the withhold cases use.
      logged = [];
      rawSqlCalls = [];
      readScope = null;
      const res = await postAnalyticsQuery(analytics, {
        cube: 'deals',
        dimensions: ['id'],
        measures: ['n'],
        where: { amount: { $gt: { $field: 'secret_policy_column' } } },
      } as unknown as AnalyticsQuery);

      expect(res.body?.success).toBe(false);
      expect(res.body?.error?.code).toBe('INVALID_FILTER');
      expect(res.body?.error?.httpStatus ?? res.statusCode).toBe(400);
      expect(rawSqlCalls, 'NativeSQLStrategy did not decline').toEqual([]);
      const message = String(res.body?.error?.message ?? '');
      expect(message).toContain('amount');
      expect(message).toContain('secret_policy_column');
    });
  });

  // ── (b) the CRUD face — #7988's measurement ──────────────────────────────

  describe('the ordinary CRUD read (read filter merged by the security middleware)', () => {
    let ql: ObjectQL;
    /**
     * The admin-authored predicate the middleware ANDs in, swapped per case.
     *
     * Carried in a closure rather than passed through `find`'s options
     * deliberately: the engine REFUSES an undeclared option
     * (`rejectUnknownEngineOptions`), and more to the point a real read scope
     * never arrives as a caller argument — it is injected by middleware the
     * caller cannot see, which is the entire premise of this card.
     */
    let crudScope: FilterCondition | null = null;

    beforeAll(async () => {
      ql = new ObjectQL();
      ql.registerDriver(driver as never, true);
      await ql.init();
      ql.registerObject({
        name: OBJECT,
        label: 'Cross field deal',
        fields: CROSS_FIELD_OBJECT_FIELDS,
      } as never);
      // Shaped exactly like `plugin-security`'s injection
      // (`security-plugin.ts`: `ast.where = ast.where ? { $and: [ast.where,
      // …extra] } : extra[0]`), because the claim under test is about what
      // THAT produces — an admin predicate the caller never wrote, in the same
      // `where` as the caller's own. [#8220] Including its marking half: the
      // scope is stamped 'policy', and the caller's where is stamped 'author'
      // under the same identity vouch the real boundary applies
      // (`ast.where === options.where` — the caller's verbatim predicate).
      ql.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
        if (['find', 'findOne', 'count', 'aggregate'].includes(ctx.operation)) {
          const ast: any = ctx.ast ?? { object: ctx.object };
          if (ast.where && ast.where === ctx.options?.where) {
            markFilterSubtreeProvenance(ast.where, 'author');
          }
          if (crudScope) {
            markFilterSubtreeProvenance(crudScope, 'policy');
            ast.where = ast.where ? { $and: [ast.where, crudScope] } : crudScope;
            ctx.ast = ast;
          }
        }
        await next();
      });
    });

    const readWithScope = async (
      scope: FilterCondition | null,
      where?: FilterCondition,
    ): Promise<{ err: WireBearingError; logged: string }> => {
      logged = [];
      crudScope = scope;
      let err: WireBearingError | null = null;
      try {
        await ql.find(OBJECT, (where ? { where } : {}) as never);
      } catch (e) {
        err = e as WireBearingError;
      } finally {
        crudScope = null;
      }
      if (!err) throw new Error('expected the read to be refused, but it returned rows');
      return { err, logged: logged.join('\n') };
    };

    it('an injected read filter with a refused reference → 400 INVALID_FILTER, policy withheld', async () => {
      // #7988's measurement, re-run against the fix. This path has gone
      // straight to `driver-sql` since #5222 — it never needed #7598's routing
      // — so a fix scoped to the analytics face would have left it wide open.
      const { err, logged: log } = await readWithScope(
        { amount: { $gt: { $field: 'secret_policy_column' } } } as FilterCondition,
        { stage: 'won' } as FilterCondition,
      );
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      for (const policyName of ['secret_policy_column', 'amount', 'stage']) {
        expect(err.message, `the refusal names "${policyName}"`).not.toContain(policyName);
      }
      expect(log).toContain('secret_policy_column');
    });

    it('the tenant-isolation column stays unnamed on this face too', async () => {
      // The one fact the platform otherwise keeps entirely to itself: the old
      // message stated WHICH column is the tenant-isolation column of the
      // object, to a caller who asked about neither.
      const { err, logged: log } = await readWithScope(
        { stage: { $eq: { $field: 'organization_id' } } } as FilterCondition,
      );
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).not.toContain('organization_id');
      expect(log).toContain('organization_id');
    });

    // ── (c) [#8220] the successor of B's byte-equality pin ─────────────────
    //
    // The old pin here asserted author-written === policy-injected, byte for
    // byte, as the strongest statement of "the driver cannot tell them apart".
    // A is the card that made them distinguishable — behind the spec-declared
    // provenance mark, set by the boundary above — so the pin is REWRITTEN
    // (not deleted, not weakened) into the three-way split #8220's "Done
    // means" names. See the file header for the full account.

    it("an AUTHOR-written `$field` filter — vouched by the boundary — names its columns again", async () => {
      // Same predicate as the policy case below, authored by the caller: the
      // middleware marks it 'author' under the identity vouch, and the driver
      // restores the full diagnostic — both columns, the operator, the
      // boundary reason.
      const authorWritten = await readWithScope(
        null,
        { amount: { $gt: { $field: 'secret_policy_column' } } } as FilterCondition,
      );
      expect(authorWritten.err.code).toBe('INVALID_FILTER');
      expect(authorWritten.err.status).toBe(400);
      expect(authorWritten.err.message).toContain('amount');
      expect(authorWritten.err.message).toContain('secret_policy_column');
      expect(authorWritten.err.message).toContain('not a declared field');
      // Disclosed on the wire ⇒ nothing left to relocate to the server log.
      expect(authorWritten.logged).not.toContain('secret_policy_column');
    });

    it('…and the messages now DIFFER from the policy-injected case, by design', async () => {
      const policyAuthored = await readWithScope(
        { amount: { $gt: { $field: 'secret_policy_column' } } } as FilterCondition,
      );
      const authorWritten = await readWithScope(
        null,
        { amount: { $gt: { $field: 'secret_policy_column' } } } as FilterCondition,
      );
      expect(authorWritten.err.message).not.toBe(policyAuthored.err.message);
      // The policy case is still B's: redacted on the wire, full text in the log.
      expect(policyAuthored.err.message).not.toContain('secret_policy_column');
      expect(policyAuthored.logged).toContain('secret_policy_column');
    });

    it('⚠️ an UNMARKED predicate still withholds, byte-identical to the policy case', async () => {
      // The fail-closed invariant, pinned as an equality exactly the way B's
      // pin was: a predicate NO boundary vouched — here, one handed straight
      // to the driver, the shape every other entry into the driver has — gets
      // the same redacted message as an admin's read scope. The mark is
      // permission to reveal; its absence must never disclose.
      const policyAuthored = await readWithScope(
        { amount: { $gt: { $field: 'secret_policy_column' } } } as FilterCondition,
      );
      let unmarkedErr: WireBearingError | null = null;
      try {
        await driver.find(OBJECT, {
          where: { amount: { $gt: { $field: 'secret_policy_column' } } } as FilterCondition,
        } as DriverQuery as never);
      } catch (e) {
        unmarkedErr = e as WireBearingError;
      }
      if (!unmarkedErr) throw new Error('expected the unmarked read to be refused');
      expect(unmarkedErr.code).toBe('INVALID_FILTER');
      expect(unmarkedErr.message).toBe(policyAuthored.err.message);
      for (const policyName of ['secret_policy_column', 'amount']) {
        expect(unmarkedErr.message, `the refusal names \"${policyName}\"`).not.toContain(policyName);
      }
    });
  });
});
