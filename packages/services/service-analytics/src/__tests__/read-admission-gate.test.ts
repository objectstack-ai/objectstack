// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The OBJECT-LEVEL read gate at the analytics door — the layer the raw-SQL path
 * had no way to inherit.
 *
 * `POST /analytics/dataset/query` accepts an INLINE dataset from any
 * authenticated caller. On a SQL driver `NativeSQLStrategy` compiled it and ran
 * it through the driver's raw `execute()`, which no middleware sits in front
 * of, so the request reached the database having passed exactly ONE of the
 * three read layers — the row scope. A caller with NO grant of any kind on an
 * object was answered `200 {"rows":[{"cnt":24}]}` where `GET /data/<object>`
 * answered `403 PERMISSION_DENIED` for the same principal on the same
 * deployment. The memory driver refused the identical request, because there
 * the query falls through to the ObjectQL engine and the engine applies all
 * three layers in one place.
 *
 * ## What these cases are shaped to catch
 *
 * The gate is asked ONCE at the door, ahead of strategy selection, so the two
 * strategies give the SAME verdict by construction rather than by each carrying
 * its own copy of the check — two copies being the arrangement that produced
 * the divergence. Every refusal case below is therefore run through BOTH
 * strategy paths from one table: a fix that only taught `NativeSQLStrategy` to
 * refuse would pass half of them, and a gate that sat inside either strategy
 * would fail the other half.
 *
 * The `admitted` cases are the negative controls, and they are the ones a lazy
 * fix loses: an implementation where the native strategy simply refuses turns
 * every refusal case green while deleting the SQL analytics path.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { compileDataset } from '../dataset-compiler.js';

/**
 * The smallest dataset query there is — the exact shape the reported probe
 * posted into `body.dataset`: one object, one count measure, no dimensions.
 */
const memberCount = DatasetSchema.parse({
  name: 'probe_member',
  label: 'probe',
  object: 'employer_member',
  dimensions: [],
  measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
});

/** A dataset that JOINS — the caller may read the base object and not the join. */
const memberWithEmployer = DatasetSchema.parse({
  name: 'probe_join',
  label: 'probe join',
  object: 'employer_member',
  include: ['employer'],
  dimensions: [{ name: 'industry', field: 'employer.industry', type: 'string' }],
  measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
});

const CALLER = { userId: 'u_seeker', tenantId: 'org_a' } as ExecutionContext;

/** The two capability postures that select the two strategies. */
const nativeSqlOnly = () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false });
const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });

const STRATEGY_PATHS = [
  { label: 'NativeSQLStrategy (SQL driver — the reported path)', capabilities: nativeSqlOnly },
  { label: 'ObjectQLStrategy (memory driver — the engine path)', capabilities: objectqlOnly },
] as const;

interface Executions {
  sql: Array<{ sql: string; params: unknown[] }>;
  aggregate: Array<{ object: string }>;
}

function makeService(
  opts: {
    capabilities: () => { nativeSql: boolean; objectqlAggregate: boolean; inMemory: boolean };
    admitObjectRead?: (object: string, context?: ExecutionContext) => boolean | Promise<boolean>;
    getReadScope?: (object: string, context?: ExecutionContext) => Record<string, unknown> | undefined;
    relationshipResolver?: (base: string, rel: string) => string | undefined;
  },
  seen: Executions,
) {
  const compiled = compileDataset(memberCount);
  const compiledJoin = compileDataset(
    memberWithEmployer,
    opts.relationshipResolver ?? (() => 'employer'),
  );
  return new AnalyticsService({
    cubes: [compiled.cube, compiledJoin.cube],
    queryCapabilities: opts.capabilities,
    admitObjectRead: opts.admitObjectRead,
    getReadScope: opts.getReadScope as never,
    executeRawSql: async (_object, sql, params) => {
      seen.sql.push({ sql, params });
      return [{ cnt: 24 }];
    },
    executeAggregate: async (object) => {
      seen.aggregate.push({ object });
      return [{ cnt: 24 }];
    },
  });
}

const emptySeen = (): Executions => ({ sql: [], aggregate: [] });

/** Every way the reported request can arrive at this service. */
const DOORS = [
  {
    label: 'queryDataset (the inline body.dataset slot)',
    run: (svc: AnalyticsService) => svc.queryDataset(memberCount, { measures: ['cnt'] }, CALLER),
  },
  {
    label: 'query (the direct /analytics/query door)',
    run: (svc: AnalyticsService) => svc.query({ cube: 'probe_member', measures: ['cnt'] }, CALLER),
  },
  {
    label: 'generateSql (the /analytics/sql echo door)',
    run: (svc: AnalyticsService) => svc.generateSql({ cube: 'probe_member', measures: ['cnt'] }, CALLER),
  },
] as const;

describe('analytics — object-level read admission at the door', () => {
  describe.each(STRATEGY_PATHS)('$label', ({ capabilities }) => {
    it.each(DOORS)(
      'refuses PERMISSION_DENIED / 403 when the caller holds no read grant — $label',
      async ({ run }) => {
        const seen = emptySeen();
        const svc = makeService({ capabilities, admitObjectRead: () => false }, seen);

        await expect(run(svc)).rejects.toMatchObject({
          code: 'PERMISSION_DENIED',
          status: 403,
        });

        // The refusal is an ADMISSION verdict: nothing was compiled, nothing
        // ran. A gate that refused only after executing would still have
        // disclosed the number through timing and through the driver's logs.
        expect(seen.sql).toEqual([]);
        expect(seen.aggregate).toEqual([]);
      },
    );

    it('names the object it refused, and nothing else about the caller\'s grants', async () => {
      const svc = makeService({ capabilities, admitObjectRead: () => false }, emptySeen());
      await expect(
        svc.queryDataset(memberCount, { measures: ['cnt'] }, CALLER),
      ).rejects.toThrow(/employer_member/);
    });

    it('fails CLOSED when the admission provider throws', async () => {
      const seen = emptySeen();
      const svc = makeService(
        {
          capabilities,
          admitObjectRead: () => {
            throw new Error('permission-set resolution exploded');
          },
        },
        seen,
      );

      await expect(
        svc.queryDataset(memberCount, { measures: ['cnt'] }, CALLER),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      expect(seen.sql).toEqual([]);
      expect(seen.aggregate).toEqual([]);
    });

    it('refuses when the caller may read the BASE object but not a JOINED one', async () => {
      const seen = emptySeen();
      const svc = makeService(
        {
          capabilities,
          admitObjectRead: (object) => object === 'employer_member',
        },
        seen,
      );

      await expect(
        svc.queryDataset(memberWithEmployer, { dimensions: ['industry'], measures: ['cnt'] }, CALLER),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      expect(seen.sql).toEqual([]);
      expect(seen.aggregate).toEqual([]);
    });

    // ── The negative controls ────────────────────────────────────────────────
    // An implementation where the native strategy simply refuses makes every
    // case above green while deleting the SQL analytics path. These are what
    // separate a fix from that.
    it('ADMITS a granted caller and serves the number unchanged', async () => {
      const seen = emptySeen();
      const svc = makeService({ capabilities, admitObjectRead: () => true }, seen);

      const result = await svc.queryDataset(memberCount, { measures: ['cnt'] }, CALLER);
      expect(result.rows).toEqual([{ cnt: 24 }]);
      expect(seen.sql.length + seen.aggregate.length).toBe(1);
    });

    it('leaves behaviour unchanged when NO admission provider is wired', async () => {
      const seen = emptySeen();
      const svc = makeService({ capabilities }, seen);

      const result = await svc.queryDataset(memberCount, { measures: ['cnt'] }, CALLER);
      expect(result.rows).toEqual([{ cnt: 24 }]);
      expect(seen.sql.length + seen.aggregate.length).toBe(1);
    });
  });

  it('the two strategies reach the SAME verdict for the same caller and object', async () => {
    // The acceptance condition, asserted as an EQUIVALENCE rather than as two
    // independent per-strategy expectations: whatever one path answers, the
    // other must answer too. Written this way so a future divergence fails here
    // even if someone updates one of the per-path cases above.
    const verdicts = await Promise.all(
      STRATEGY_PATHS.map(async ({ capabilities }) => {
        const svc = makeService({ capabilities, admitObjectRead: () => false }, emptySeen());
        try {
          await svc.queryDataset(memberCount, { measures: ['cnt'] }, CALLER);
          return 'admitted';
        } catch (e) {
          const err = e as { code?: string; status?: number };
          return `${err.status}:${err.code}`;
        }
      }),
    );
    expect(verdicts[0]).toBe('403:PERMISSION_DENIED');
    expect(new Set(verdicts).size).toBe(1);
  });

  it('the admitted path stays identical across both strategies (the number does not move)', async () => {
    const results = await Promise.all(
      STRATEGY_PATHS.map(async ({ capabilities }) => {
        const svc = makeService({ capabilities, admitObjectRead: () => true }, emptySeen());
        const r = await svc.queryDataset(memberCount, { measures: ['cnt'] }, CALLER);
        return r.rows;
      }),
    );
    expect(results[0]).toEqual([{ cnt: 24 }]);
    expect(results[1]).toEqual(results[0]);
  });
});

describe('analytics — the tenant wall reaches the inline dataset on the raw-SQL path', () => {
  /**
   * The WALLED-posture leg, measured rather than inferred.
   *
   * `{ organization_id: 'org_a' }` is not a predicate invented here: it is
   * exactly what `tenantLayer0FilterOf` projects for the `isolated` wall's
   * `{ kind: 'organization' }` verdict, and exactly what plugin-security's own
   * `getReadFilter` returns for a member under a walled posture (pinned there
   * by `tenant-layer0-verdict-on-operation.test.ts`:
   * `getReadFilter('crm_task', MEMBER_CTX)` → `{ organization_id: 'org-1' }`).
   * This is the CONSUMER half of that chain: the wall's own predicate has to
   * survive into the statement the raw-SQL path compiles, or a cross-
   * organization inline dataset counts another tenant's rows.
   */
  const walledScope = (_object: string, context?: ExecutionContext) =>
    context?.tenantId ? { organization_id: context.tenantId } : undefined;

  it('compiles the wall predicate into the statement, bound to the caller organization', async () => {
    const seen = emptySeen();
    const svc = makeService(
      { capabilities: nativeSqlOnly, admitObjectRead: () => true, getReadScope: walledScope },
      seen,
    );

    await svc.queryDataset(memberCount, { measures: ['cnt'] }, CALLER);

    expect(seen.sql).toHaveLength(1);
    expect(seen.sql[0].sql).toMatch(/organization_id/);
    expect(seen.sql[0].params).toContain('org_a');
  });

  it('walls EVERY object the statement reads, joined ones included', async () => {
    const seen = emptySeen();
    const svc = makeService(
      { capabilities: nativeSqlOnly, admitObjectRead: () => true, getReadScope: walledScope },
      seen,
    );

    await svc.queryDataset(
      memberWithEmployer,
      { dimensions: ['industry'], measures: ['cnt'] },
      CALLER,
    );

    expect(seen.sql).toHaveLength(1);
    // Two objects are read (base + join), so the wall appears twice — a single
    // occurrence would mean the joined table is unwalled and a cross-org row
    // can reach the GROUP BY through it.
    const occurrences = seen.sql[0].sql.match(/organization_id/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    expect(seen.sql[0].params.filter((p) => p === 'org_a').length).toBeGreaterThanOrEqual(2);
  });

  it('the admission gate and the wall are INDEPENDENT — an admitted caller is still walled', async () => {
    // The two layers must not collapse into one another: `admitObjectRead`
    // answering `true` says the caller may read the OBJECT, never that they may
    // read every organization's rows.
    const seen = emptySeen();
    const svc = makeService(
      { capabilities: nativeSqlOnly, admitObjectRead: () => true, getReadScope: walledScope },
      seen,
    );
    await svc.queryDataset(memberCount, { measures: ['cnt'] }, CALLER);
    expect(seen.sql[0].params).toContain('org_a');
  });
});
