// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The analytics → `security` admission bridge, and the three resolutions it
 * must tell apart.
 *
 * The object-level gate at the analytics door is only as good as the answer the
 * bridge brings back, and the bridge has three outcomes that are easy to
 * collapse into one:
 *
 *   - the `security` service is ABSENT — this deployment has no object-level
 *     gate anywhere, `GET /data/<object>` included, because that gate IS the
 *     absent middleware. The two doors agree, which is the equivalence property
 *     the card asks for, so the query is ADMITTED and the state is reported at
 *     init;
 *   - resolving the service THREW — a security service exists on this
 *     deployment and could not be reached;
 *   - the service resolved but exposes NEITHER `canReadObject` NOR `explain` —
 *     it exists and cannot answer.
 *
 * The last two are wired-but-broken providers. `/data`'s middleware does not
 * fall open in either state, so admitting here would reopen exactly the
 * divergence between the two doors that this gate closes — and would do it
 * silently, which is worse than the original defect: the original at least had
 * a shape a reader could find in the code. Both DENY, and both say why at
 * `error`.
 *
 * ⛔ The absent case is not a bug to be tightened away. It is the negative
 * control that keeps the two deny cases honest: a bridge that denied on absence
 * too would refuse every analytics query on every deployment that ships no
 * `plugin-security`, which is a strictly different (and wrong) answer from the
 * one `/data` gives on that same deployment.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsServicePlugin } from '../plugin.js';
import type { AnalyticsService } from '../analytics-service.js';

/** The reported probe's shape: one object, one count measure, no dimensions. */
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
 * Engine double. Every read it serves is recorded, so a denial can be asserted
 * as "the database was never reached" rather than only as a thrown envelope —
 * a gate that refuses AFTER running the statement has not refused anything.
 */
function fakeEngine() {
  const reads: string[] = [];
  return {
    reads,
    engine: {
      execute: async (sql: unknown, options?: { object?: string }) => {
        reads.push(`execute:${options?.object ?? String(sql)}`);
        return { rows: [{ cnt: 24 }] };
      },
      aggregate: async (object: string) => {
        reads.push(`aggregate:${object}`);
        return [{ cnt: 24 }];
      },
      getObject: (name: string) =>
        name === 'employer_member' ? { fields: { id: { type: 'text' } } } : undefined,
      resolveEffectiveDatasource: () => undefined,
    },
  };
}

/**
 * Minimal `PluginContext`. `security` is supplied as a THUNK so a fixture can
 * make the lookup itself throw — the corner that is otherwise unreachable from
 * a plain service map.
 */
function fakePluginContext(opts: {
  data: unknown;
  security?: () => unknown;
}) {
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

async function bootAnalytics(security?: () => unknown) {
  const { engine, reads } = fakeEngine();
  const { ctx, registered, error } = fakePluginContext({ data: engine, security });
  await new AnalyticsServicePlugin({ queryCapabilities: nativeSql }).init(ctx as never);
  return { service: registered.analytics as AnalyticsService, reads, error };
}

/**
 * A working security service's ROW-SCOPE half, carried by every double below
 * that is meant to represent one.
 *
 * `getReadFilter` is a REQUIRED member of `ISecurityService`, and since #16918
 * the ROW-SCOPE bridge in the same `plugin.ts` refuses the query when the
 * registered service does not expose it — the sibling three-way of the one
 * this file measures. `undefined` is that method's documented answer for "no
 * row restriction on this object", so a double carrying it stays minimal AND
 * conforming, and every object-level verdict asserted below is reached exactly
 * as it was before. The deny-path doubles need none: the object-level gate runs
 * first and refuses before the row half is ever asked.
 */
const rowScopeOpen = { getReadFilter: async () => undefined };

const runProbe = (service: AnalyticsService) =>
  service.queryDataset(probe as never, { measures: ['cnt'] } as never, CALLER);

describe('analytics admission bridge — resolving the "security" service', () => {
  // ── The two corners that used to admit silently ────────────────────────────

  it('DENIES when resolving the "security" service THROWS', async () => {
    const boom = () => { throw new Error('security service is initialising'); };
    const { service, reads, error } = await bootAnalytics(boom);

    await expect(runProbe(service)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    });
    // The refusal has to happen BEFORE the statement runs, or it is not a gate.
    expect(reads).toEqual([]);
    // And it has to be findable. A security refusal nobody can see is
    // indistinguishable from a gate that never ran.
    expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
      /read admission could not be resolved .* denying the query \(fail-closed\).*threw/s,
    );
  });

  it('DENIES when the "security" service exposes neither canReadObject nor explain', async () => {
    // A registered object that is not the contract it claims to be —
    // `explain` is NON-optional on `ISecurityService`, so a conforming
    // provider never lands here.
    const { service, reads, error } = await bootAnalytics(() => ({ getReadFilter: () => undefined }));

    await expect(runProbe(service)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    });
    expect(reads).toEqual([]);
    expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
      /read admission could not be resolved .* neither canReadObject\(\) nor explain\(\)/s,
    );
  });

  // ── The negative control: absence is a different state and still ADMITS ────

  it('ADMITS when NO "security" service is registered at all', async () => {
    // ⛔ Not a corner to tighten. On this deployment `/data` has no
    // object-level gate either, so the two doors still agree — which is the
    // property being defended. Tightening this to a denial would refuse every
    // analytics query on every deployment shipping no `plugin-security`.
    const { service, reads } = await bootAnalytics(undefined);

    const result = await runProbe(service);
    expect(result.rows).toEqual([{ cnt: 24 }]);
    expect(reads).toHaveLength(1);
  });

  // ── The two working spellings, so the deny cases cannot pass by refusing all ─

  it('asks canReadObject when the service has it, and serves an ADMITTED caller', async () => {
    const canReadObject = vi.fn(() => true);
    const { service, reads } = await bootAnalytics(() => ({ ...rowScopeOpen, canReadObject }));

    const result = await runProbe(service);
    expect(result.rows).toEqual([{ cnt: 24 }]);
    expect(canReadObject).toHaveBeenCalledWith('employer_member', CALLER);
    expect(reads).toHaveLength(1);
  });

  it('refuses through canReadObject when that service answers false', async () => {
    const { service, reads } = await bootAnalytics(() => ({ canReadObject: () => false }));

    await expect(runProbe(service)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    });
    expect(reads).toEqual([]);
  });

  it('falls back to explain for a service that predates canReadObject — both verdicts', async () => {
    const admitted = await bootAnalytics(() => ({
      ...rowScopeOpen,
      explain: async () => ({ allowed: true }),
    }));
    expect((await runProbe(admitted.service)).rows).toEqual([{ cnt: 24 }]);

    const refused = await bootAnalytics(() => ({
      explain: async () => ({ allowed: false }),
    }));
    await expect(runProbe(refused.service)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    });
    expect(refused.reads).toEqual([]);
  });
});
