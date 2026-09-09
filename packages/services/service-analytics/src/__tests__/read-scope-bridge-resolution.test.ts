// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The analytics → `security` ROW-SCOPE bridge, and the three resolutions it
 * must tell apart — the sibling of `admission-bridge-resolution.test.ts`, one
 * function up in the same file.
 *
 * The object-level bridge was made an explicit three-way (#16860); this one had
 * the identical shape and still collapsed it:
 *
 * ```ts
 * const trySecurity = () => {
 *   try {
 *     const svc = ctx.getService<SecurityReadFilter>('security');
 *     return svc && typeof svc.getReadFilter === 'function' ? svc : undefined;
 *   } catch { return undefined; }
 * };
 * getReadScope = (object, context) => trySecurity()?.getReadFilter(object, context);
 * ```
 *
 * A THROWING resolver and a METHOD-LESS service both produced `undefined` —
 * the same value an ABSENT security service produces, and the same value
 * `ISecurityService.getReadFilter` reserves for one meaning only: "this caller
 * has no row restriction on this object". So a deployment whose security
 * service was broken ran its analytics queries with NO row-level policy at
 * all, and the only difference from a correctly unrestricted caller was a state
 * nothing reported. After #16860 one door of `plugin.ts` failed closed on a
 * throwing resolver and its neighbour failed open — and the neighbour is the
 * one carrying row-level policy.
 *
 * The two broken corners now REFUSE the query: the bridge throws, and
 * `AnalyticsService.resolveReadScopes` — fail-closed since ADR-0021 D-C —
 * denies the whole query rather than emitting SQL with the object unscoped.
 * Refusing is the outcome the object-level bridge already produces, and it is
 * neutral between the two candidate tenant walls: it answers "should we serve
 * at all", never "what shape is the wall".
 *
 * ⛔ The ABSENT case is the negative control and must stay UNCHANGED. Refusing
 * when no security plugin is installed would break every single-tenant
 * deployment — that is a real configuration, reported loudly at init, and it is
 * the state in which `/data` has no row-level policy either.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsServicePlugin } from '../plugin.js';
import type { AnalyticsService } from '../analytics-service.js';

/** The probe: one object, one count measure, no dimensions. */
const probe = DatasetSchema.parse({
  name: 'probe_member',
  label: 'probe',
  object: 'employer_member',
  dimensions: [],
  measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
});

const CALLER = { userId: 'u_seeker', tenantId: 'org_a' } as ExecutionContext;

/** The SQL posture — the reported path, where nothing else stands in the way. */
const nativeSql = () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false });

/**
 * Engine double. Every read is recorded WITH the statement, so "refused" is
 * asserted as "the database was never reached" and "scoped" as "the predicate
 * was in the statement that ran" — a bridge that refuses after running the
 * query has refused nothing, and one that serves rows without the predicate is
 * the defect itself.
 */
function fakeEngine() {
  const reads: string[] = [];
  return {
    reads,
    engine: {
      execute: async (sql: unknown, options?: { object?: string }) => {
        reads.push(`execute:${options?.object ?? ''}:${String(sql)}`);
        return { rows: [{ cnt: 24 }] };
      },
      aggregate: async (object: string) => {
        reads.push(`aggregate:${object}`);
        return [{ cnt: 24 }];
      },
      getObject: (name: string) =>
        name === 'employer_member'
          ? { fields: { id: { type: 'text' }, organization_id: { type: 'text' } } }
          : undefined,
      resolveEffectiveDatasource: () => undefined,
    },
  };
}

/**
 * Minimal `PluginContext`. `security` is supplied as a THUNK so a fixture can
 * make the lookup itself throw — the corner that is otherwise unreachable from
 * a plain service map.
 */
function fakePluginContext(opts: { data: unknown; security?: () => unknown }) {
  const registered: Record<string, unknown> = {};
  const warn = vi.fn();
  const error = vi.fn();
  return {
    registered,
    warn,
    error,
    ctx: {
      getService: (name: string) => {
        if (name === 'security') return opts.security ? opts.security() : undefined;
        if (name === 'data') return opts.data;
        return registered[name];
      },
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      logger: { info() {}, warn, error, debug() {} },
    },
  };
}

/**
 * @param admitObjectRead supplied by SOME fixtures on purpose. The object-level
 *   bridge in the same file resolves the SAME service, so a throwing resolver
 *   is refused by that gate first and the row-scope bridge under test is never
 *   reached. Supplying the documented `admitObjectRead` option (a host that
 *   answers object-level admission itself) leaves the row-scope bridge as the
 *   only auto-bridge in play, which is what makes this a measurement OF IT.
 */
async function bootAnalytics(
  security?: () => unknown,
  admitObjectRead?: () => boolean,
) {
  const { engine, reads } = fakeEngine();
  const { ctx, registered, error } = fakePluginContext({ data: engine, security });
  await new AnalyticsServicePlugin({
    queryCapabilities: nativeSql,
    ...(admitObjectRead ? { admitObjectRead } : {}),
  }).init(ctx as never);
  return { service: registered.analytics as AnalyticsService, reads, error };
}

const runProbe = (service: AnalyticsService) =>
  service.queryDataset(probe as never, { measures: ['cnt'] } as never, CALLER);

const errorText = (error: { mock: { calls: unknown[][] } }) =>
  error.mock.calls.map((c) => String(c[0])).join('\n');

describe('analytics row-scope bridge — resolving the "security" service', () => {
  // ── The two corners that used to run the query with no row policy ──────────

  it('REFUSES when resolving the "security" service THROWS', async () => {
    const boom = () => { throw new Error('security service is initialising'); };
    const { service, reads, error } = await bootAnalytics(boom, () => true);

    await expect(runProbe(service)).rejects.toThrow(/read-scope resolution failed/i);
    // The refusal has to happen BEFORE the statement runs, or it is not a
    // refusal — this is the assertion that fails on `origin/main`, where the
    // same fixture serves `{cnt: 24}` off an unscoped statement.
    expect(reads).toEqual([]);
    // And it has to name why, at error level. A gate that refuses invisibly is
    // indistinguishable from one that never ran.
    expect(errorText(error)).toMatch(
      /row-level read scope could not be resolved .* refusing the query \(fail-closed\).*threw/s,
    );
  });

  it('REFUSES when the registered "security" service exposes no getReadFilter', async () => {
    // ⚠️ No `admitObjectRead` override here, and none is needed: this service
    // answers the OBJECT-level question (`canReadObject`) and is admitted by
    // that bridge, so the row-scope bridge is the only one that can refuse.
    // Both auto-bridges are live — this is the shape reachable end-to-end.
    const { service, reads, error } = await bootAnalytics(() => ({
      canReadObject: () => true,
    }));

    await expect(runProbe(service)).rejects.toThrow(/read-scope resolution failed/i);
    expect(reads).toEqual([]);
    expect(errorText(error)).toMatch(
      /row-level read scope could not be resolved .* exposes no getReadFilter\(\)/s,
    );
  });

  // ── The negative control: absence is a different state and is UNCHANGED ────

  it('ADMITS, unscoped, when NO "security" service is registered at all', async () => {
    // ⛔ Not a corner to tighten. This is a single-tenant deployment that ships
    // no `plugin-security`: there is no row-level policy anywhere on it,
    // `/data` included, and the init log says so. Refusing here would break
    // every such deployment — which is why this arm is what makes the two
    // above a measurement rather than an over-fix.
    const { service, reads, error } = await bootAnalytics(undefined);

    const result = await runProbe(service);
    expect(result.rows).toEqual([{ cnt: 24 }]);
    expect(reads).toHaveLength(1);
    expect(errorText(error)).not.toMatch(/row-level read scope/);
  });

  // ── The working spelling, so the refusals cannot pass by refusing all ──────

  it('asks getReadFilter when the service has it, and SCOPES the statement', async () => {
    const getReadFilter = vi.fn(async () => ({ organization_id: 'org_a' }));
    const { service, reads } = await bootAnalytics(() => ({
      canReadObject: () => true,
      getReadFilter,
    }));

    const result = await runProbe(service);
    expect(result.rows).toEqual([{ cnt: 24 }]);
    expect(getReadFilter).toHaveBeenCalledWith('employer_member', CALLER);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatch(/organization_id/);
  });

  // ── The two doors of this file now agree on a broken provider ──────────────

  it('refuses a throwing resolver with BOTH auto-bridges live (no door falls open)', async () => {
    // With no `admitObjectRead` override the object-level bridge (#16860)
    // answers first, with `PERMISSION_DENIED`. Pinned so the file-level
    // property — a broken security service serves no analytics rows through
    // EITHER door — cannot regress from the other side.
    const boom = () => { throw new Error('security service is initialising'); };
    const { service, reads } = await bootAnalytics(boom);

    await expect(runProbe(service)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    });
    expect(reads).toEqual([]);
  });
});
