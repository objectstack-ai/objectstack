// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The analytics → `security` admission bridge, and the three resolutions it
 * must tell apart.
 *
 * The object-level gate at the analytics door is only as good as the answer the
 * bridge brings back, and the bridge has three outcomes that are easy to
 * collapse into one:
 *
 *   - the lookup answers NOTHING (ABSENT) — the context returns no service for
 *     `security`. Only a context that answers a miss with nothing reaches this
 *     branch: this file's double does, and no in-repo kernel does. The bridge
 *     ADMITS there and reports it once, by the first query that finds it
 *     (`admission-absence-report.test.ts` pins when, and at what level);
 *   - resolving the service THREW (UNUSABLE), whatever the cause: a security
 *     service that is wired and could not be reached, or — on the in-repo
 *     kernels, `ObjectKernel` and `LiteKernel` — a `security` service nothing
 *     ever registered, because their synchronous `getService` throws on a miss;
 *   - the service resolved but exposes NEITHER `canReadObject` NOR `explain`
 *     (UNUSABLE) — it exists and cannot answer.
 *
 * Both UNUSABLE corners DENY, fail-closed, before anything is read, and both say
 * why at `error`. For a wired-but-broken provider, `/data`'s middleware does not
 * fall open either, so admitting here would reopen exactly the divergence
 * between the two doors that this gate closes — and would do it silently.
 *
 * ## The declaration: no security service registered ⇒ analytics DENIES
 *
 * [#22235] A deployment that registers no security service gets its analytics
 * read queries REFUSED, fail-closed: the kernel's lookup throws, the bridge
 * takes UNUSABLE, the caller gets `PERMISSION_DENIED` / 403 naming the object,
 * and the operator gets an `error` line naming the object and the failed
 * lookup. That is the declared answer, not an accident of how the lookup fails,
 * and it holds even though `/data` carries no object-level gate on such a
 * deployment: a loud deny is preferred over a silent admit. A composition that
 * wants analytics to answer registers a security service, or its host supplies
 * its own `admitObjectRead`. The last block of this file pins it on both
 * in-repo kernels.
 *
 * ⛔ So the ABSENT case below is not a statement about deployments. It pins
 * what the bridge does for a context that answers a miss with nothing, and it
 * stays the negative control for the two UNUSABLE cases: same double, same
 * probe, only the lookup's answer differs, so a bridge that refused everything
 * could not pass this file.
 */

import { describe, it, expect, vi } from 'vitest';
import { LiteKernel, ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
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
      // [#21080] The engine this double models answers which objects carry a
      // middleware registered for them; none of this file's objects does.
      hasObjectMiddleware: () => false,
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
 * `getReadFilter` is a REQUIRED member of `ISecurityService`, and since commit 5d12b16e7
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

  // ── The negative control: a lookup that answers NOTHING is a different state ─

  it('ADMITS when the context answers the "security" lookup with nothing (ABSENT)', async () => {
    // The ABSENT branch: this double answers the lookup with nothing, which no
    // in-repo kernel does — they throw on a miss (the last block of this file).
    // Kept as the negative control for the two deny cases above; whether this
    // branch should deny too is a separate question, not settled here.
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

// ── The declaration, on the in-repo kernels: no security service ⇒ DENY ──────

/**
 * Boots a REAL kernel with a `data` provider and this plugin, and NO security
 * service, ever: nothing registers one at init or at start. The first plugin
 * taps the kernel's shared logger so the bridge's own lines are seen.
 */
async function bootKernelWithoutSecurity(kernel: ObjectKernel | LiteKernel) {
  const errors: string[] = [];
  const warns: string[] = [];
  const { engine, reads } = fakeEngine();
  const tap: Plugin = {
    name: 'test.log-tap',
    init: async (ctx: PluginContext) => {
      vi.spyOn(ctx.logger, 'error').mockImplementation((message: unknown) => { errors.push(String(message)); });
      vi.spyOn(ctx.logger, 'warn').mockImplementation((message: unknown) => { warns.push(String(message)); });
    },
  };
  const data: Plugin = {
    name: 'test.data',
    init: async (ctx: PluginContext) => { ctx.registerService('data', engine); },
  };
  await kernel.use(tap);
  await kernel.use(data);
  await kernel.use(new AnalyticsServicePlugin({ queryCapabilities: nativeSql }));
  await kernel.bootstrap();
  return { kernel, service: kernel.getService<AnalyticsService>('analytics'), reads, errors, warns };
}

describe.each([
  ['ObjectKernel', () => new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false })],
  ['LiteKernel', () => new LiteKernel({ logger: { level: 'silent' } })],
] as const)('analytics admission bridge — a real %s that never registers a "security" service', (_name, makeKernel) => {
  it('DENIES the dataset query fail-closed, before any read, with an error located on the object and the lookup', async () => {
    const { kernel, service, reads, errors, warns } = await bootKernelWithoutSecurity(makeKernel());

    // The mechanism the declaration rests on: this kernel answers a lookup for
    // a never-registered name by THROWING, never with nothing.
    expect(() => kernel.getService('security')).toThrow(/'security'/);

    // The caller's refusal: the declared envelope, naming the object.
    await expect(runProbe(service)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      object: 'employer_member',
    });
    // Refused BEFORE the statement ran.
    expect(reads).toEqual([]);
    // The operator's line: exactly one, from the object-level bridge, naming
    // the object and the failed `security` lookup as the cause.
    const bridgeErrors = errors.filter((l) => l.includes('object-level read admission'));
    expect(bridgeErrors).toHaveLength(1);
    expect(bridgeErrors[0]).toContain('"employer_member"');
    expect(bridgeErrors[0]).toContain('resolving the "security" service threw');
    // Not the ABSENT branch: that one admits, and WARNs instead.
    expect(warns.filter((l) => l.includes('no "security" service registered'))).toEqual([]);
  });
});
