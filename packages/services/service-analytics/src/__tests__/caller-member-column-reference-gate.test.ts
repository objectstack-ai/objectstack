// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21156] The member-SHAPE gate at the analytics door.
 *
 * A member the CALLER names — in `dimensions`, `timeDimensions`, a `where`
 * leaf, or an `order` key — must be a column reference (a field, a relationship
 * path, or `'*'`) or a member the cube's author declared. A member that is
 * neither names nothing any field gate can judge, so it is refused
 * `PERMISSION_DENIED` / 403 at the door, before a strategy compiles it.
 *
 * This is the TIER-INDEPENDENT complement of the field-level read gate
 * (`field-read-admission-gate.test.ts`, #20917/#20965): that gate judges
 * readability and is a no-op in the two tiers below — a deployment with no
 * security service, and an object the reader answers `undefined` for. The
 * refusal is the SAME one the read gate reaches where it judges the object
 * (the control here), so the caller sees one answer in every tier.
 *
 * The cube author's OWN declared members are not judged by this gate: a
 * declared expression member is the author's cube `sql` and keeps the read
 * gate's verdict where it judges (#20965), and the parse's otherwise (#20943).
 */

import { describe, it, expect } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService, type AnalyticsServiceConfig } from '../analytics-service.js';

const OBJ = 'cm_ledger';

/** The object's declared fields — the data engine's answer, present on a stock boot. */
const FIELDS: readonly string[] = ['status', 'amount'];

const CALLER = { userId: 'u_member', tenantId: 'org_a' } as ExecutionContext;

/**
 * A registered cube with a real column dimension AND an author-declared
 * expression dimension. The expression member is written around the parse (the
 * registry never parses), exactly as the #20965 fixture is.
 */
const REGISTERED: Cube = {
  name: 'cm_cube',
  title: 'Ledger',
  sql: OBJ,
  public: true,
  measures: {
    count: { type: 'count', sql: '*', label: 'Count' },
    author_expr_measure: { type: 'sum', sql: 'amount + 1', label: 'Author expression measure' },
  },
  dimensions: {
    status: { type: 'string', sql: 'status', label: 'Status' },
    author_expr: { type: 'number', sql: 'amount + 1', label: 'Author expression' },
  },
} as Cube;

/**
 * A measure the CALLER names itself whose inferred source is not a column
 * reference: the suffixed form (`inferMeasure` strips `_sum` → `amount + 1`)
 * and the no-suffix default (the whole key → `amount + 1`). Both reach the
 * aggregate position verbatim before this gate.
 */
const CALLER_MEASURE_SUFFIXED = 'amount + 1_sum';
const CALLER_MEASURE_NOSUFFIX = 'amount + 1';

/** A member the CALLER names itself, spelled as no column is. Neutral, not a payload. */
const CALLER_EXPR = 'amount + 1';

const nativeSqlOnly = () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false });
const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });

const STRATEGY_PATHS = [
  { label: 'NativeSQLStrategy', capabilities: nativeSqlOnly },
  { label: 'ObjectQLStrategy', capabilities: objectqlOnly },
] as const;

type FieldReader = (object: string, context?: ExecutionContext) =>
  readonly string[] | undefined | Promise<readonly string[] | undefined>;

function makeService(opts: {
  capabilities: () => { nativeSql: boolean; objectqlAggregate: boolean; inMemory: boolean };
  getReadableFields?: FieldReader;
  getQueryableFields?: FieldReader;
}) {
  const executed: string[] = [];
  const service = new AnalyticsService({
    cubes: [REGISTERED],
    logger: { info() {}, debug() {}, warn() {}, error() {}, child() { return this; } } as never,
    queryCapabilities: opts.capabilities,
    // The stock boot always has these two (bridged to the data engine), so both
    // tiers below keep them — only the security-backed field readers vary.
    isRegisteredObject: () => true,
    getObjectFieldNames: (object: string) => (object === OBJ ? FIELDS : undefined),
    getReadableFields: opts.getReadableFields,
    getQueryableFields: opts.getQueryableFields,
    executeRawSql: async (object: string, sql: string) => {
      executed.push(`sql:${object}:${sql}`);
      return [];
    },
    executeAggregate: async (object: string) => {
      executed.push(`aggregate:${object}`);
      return [];
    },
  } as AnalyticsServiceConfig);
  return { service, executed };
}

/** The two tiers where the field-level read gate does not judge the object. */
const UNJUDGED_TIERS = [
  { label: 'no security service (no field reader wired)', readers: {} },
  {
    label: 'an object the reader answers undefined for',
    readers: { getReadableFields: () => undefined, getQueryableFields: () => undefined } as const,
  },
] as const;

/** The control: the reader answers the object's real fields, so the gate judges it. */
const JUDGED = { getReadableFields: () => FIELDS, getQueryableFields: () => FIELDS } as const;

interface MemberCase {
  label: string;
  /** Built against a cube name — the ad-hoc (inferred) name, or the registered cube. */
  query: (cube: string) => Record<string, unknown>;
}

/** Each query position the caller can carry a non-column member in. */
const CALLER_POSITIONS: readonly MemberCase[] = [
  { label: 'a grouped dimension', query: (cube) => ({ cube, measures: ['count'], dimensions: [CALLER_EXPR] }) },
  { label: 'a time dimension', query: (cube) => ({ cube, measures: ['count'], timeDimensions: [{ dimension: CALLER_EXPR, granularity: 'month' }] }) },
  { label: 'a where leaf', query: (cube) => ({ cube, measures: ['count'], where: { [CALLER_EXPR]: 'x' } }) },
  { label: 'an order key', query: (cube) => ({ cube, measures: ['count'], dimensions: ['status'], order: { [CALLER_EXPR]: 'asc' } }) },
];

const CUBES = [
  { label: 'an ad-hoc (inferred) cube', cube: 'cm_adhoc' },
  { label: 'a registered cube', cube: 'cm_cube' },
] as const;

describe('[#21156] analytics — a caller-named non-column member is refused at the door, in every tier', () => {
  describe.each(UNJUDGED_TIERS)('tier: $label', ({ readers }) => {
    describe.each(STRATEGY_PATHS)('$label', ({ capabilities }) => {
      describe.each(CUBES)('on $label', ({ cube }) => {
        it.each(CALLER_POSITIONS)(
          '$label: refused PERMISSION_DENIED / 403 on both doors, before any strategy ran',
          async ({ query }) => {
            const { service, executed } = makeService({ capabilities, ...(readers as object) });
            const q = query(cube);
            for (const run of [
              () => service.query(q as never, CALLER),
              () => service.generateSql(q as never, CALLER),
            ]) {
              const refusal = await run().then(() => null, (e: unknown) => e as Record<string, unknown>);
              expect(refusal).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, member: CALLER_EXPR });
            }
            expect(executed).toEqual([]);
          },
        );
      });
    });
  });

  // The control: where the reader DOES judge the object, the same class gets the
  // same refusal — the one judge, reached one door earlier.
  describe.each(STRATEGY_PATHS)('control (judged object) — $label', ({ capabilities }) => {
    it.each(CUBES)('on $label: the same PERMISSION_DENIED / 403, nothing executed', async ({ cube }) => {
      const { service, executed } = makeService({ capabilities, ...JUDGED });
      await expect(
        service.query({ cube, measures: ['count'], dimensions: [CALLER_EXPR] } as never, CALLER),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, member: CALLER_EXPR });
      expect(executed).toEqual([]);
    });
  });

  // No false positives: a real column member, and '*', are served in every tier.
  describe.each([...UNJUDGED_TIERS, { label: 'judged object', readers: JUDGED }])(
    'the positive control in tier: $label',
    ({ readers }) => {
      it.each(STRATEGY_PATHS)('$label: a real column member and a bare count are served', async ({ capabilities }) => {
        for (const cube of ['cm_adhoc', 'cm_cube']) {
          const { service, executed } = makeService({ capabilities, ...(readers as object) });
          await service.query({ cube, measures: ['count'], dimensions: ['status'] } as never, CALLER);
          expect(executed.length).toBeGreaterThan(0);
        }
      });
    },
  );

  // Non-regression: the cube author's OWN declared expression member is NOT
  // refused by this gate — in the no-security tier it reaches the strategy as it
  // did before, because it is author text, not caller text.
  describe.each(STRATEGY_PATHS)('declared-cube paths do not regress — $label', ({ capabilities }) => {
    it('an author-declared expression dimension still reaches the strategy with no security service', async () => {
      const { service, executed } = makeService({ capabilities });
      await service.query({ cube: 'cm_cube', measures: ['count'], dimensions: ['author_expr'] } as never, CALLER);
      expect(executed.length).toBeGreaterThan(0);
    });
  });

  // An author-declared expression MEASURE — an aggregate over an expression
  // `sql`, written around the parse like the dimension above (the custom-SQL
  // metric types it used to be typed as were retired from the spec, #21000,
  // and both strategies refuse them by type, not this gate). The
  // non-regression claim is that THIS gate does not refuse it: on NativeSQL it
  // still reaches the strategy with no security service.
  it('an author-declared expression measure is not refused by this gate (served on NativeSQL, no security service)', async () => {
    const { service, executed } = makeService({ capabilities: nativeSqlOnly });
    await service.query({ cube: 'cm_cube', measures: ['author_expr_measure'] } as never, CALLER);
    expect(executed.length).toBeGreaterThan(0);
  });

  // ── The MEASURE position (#21156 rework) ──────────────────────────────────
  //
  // A caller-named measure whose inferred source (after inferMeasure's suffix
  // strip, the no-suffix default included) is not a column reference reached
  // the aggregate position of the statement verbatim in the ungated tiers. It
  // is refused here, in every tier, before a strategy compiles it.
  describe('a caller-named measure that reduces to a non-column source is refused', () => {
    const MEASURES = [
      { label: 'a suffixed inferred measure', measure: CALLER_MEASURE_SUFFIXED },
      { label: 'the no-suffix default', measure: CALLER_MEASURE_NOSUFFIX },
    ];
    describe.each([...UNJUDGED_TIERS, { label: 'judged object', readers: JUDGED }])(
      'tier: $label',
      ({ readers }) => {
        describe.each(STRATEGY_PATHS)('$label', ({ capabilities }) => {
          describe.each(CUBES)('on $label', ({ cube }) => {
            it.each(MEASURES)('$label: refused PERMISSION_DENIED / 403 on both doors, nothing executed', async ({ measure }) => {
              const { service, executed } = makeService({ capabilities, ...(readers as object) });
              const q = { cube, measures: [measure] };
              for (const run of [
                () => service.query(q as never, CALLER),
                () => service.generateSql(q as never, CALLER),
              ]) {
                const refusal = await run().then(() => null, (e: unknown) => e as Record<string, unknown>);
                expect(refusal).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, member: measure });
              }
              expect(executed).toEqual([]);
            });
          });
        });
      },
    );

    // No false positives: a valid inferred measure over a real column, and a
    // bare count, are served in every tier.
    describe.each([...UNJUDGED_TIERS, { label: 'judged object', readers: JUDGED }])(
      'the positive control in tier: $label',
      ({ readers }) => {
        it.each(STRATEGY_PATHS)('$label: a valid _sum measure and a bare count are served', async ({ capabilities }) => {
          for (const cube of ['cm_adhoc', 'cm_cube']) {
            const { service, executed } = makeService({ capabilities, ...(readers as object) });
            await service.query({ cube, measures: ['amount_sum', 'count'] } as never, CALLER);
            expect(executed.length).toBeGreaterThan(0);
          }
        });
      },
    );
  });
});
