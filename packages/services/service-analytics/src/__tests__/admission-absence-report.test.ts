// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * WHEN the analytics → `security` admission bridge reports that no security
 * service answers the object-level read grant, and at what level.
 *
 * The bridge resolves the `security` service PER QUERY, so plugin order is not
 * significant — and plugin-security registers that service in its `start()`,
 * after every plugin's `init()`. A WARN at init therefore asserted a verdict
 * the same boot contradicts (AGENTS.md "Startup registry reads — never record
 * a verdict the boot can still contradict"), on every default boot.
 *
 * So:
 *   - init reports the absence at `info`, as the read-scope sibling already
 *     does for the identical situation;
 *   - the WARN belongs to the first query that needs the gate and finds no
 *     service — once per bridge, not once per query;
 *   - what the bridge ENFORCES does not move. Each case below asserts the
 *     verdict next to the log line, so a change that quietened the log by
 *     changing the answer cannot pass.
 *
 * The three resolutions themselves (absent / threw / cannot answer) are
 * `admission-bridge-resolution.test.ts`'s subject; this file is about the
 * report, not the verdict.
 */

import { describe, it, expect, vi } from 'vitest';
import { LiteKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsServicePlugin } from '../plugin.js';
import type { AnalyticsService } from '../analytics-service.js';

const probe = DatasetSchema.parse({
  name: 'probe_member',
  label: 'probe',
  object: 'employer_member',
  dimensions: [],
  measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
});

const CALLER = { userId: 'u_seeker', tenantId: 'org_a' } as ExecutionContext;

/** The SQL posture — the path where nothing but this gate stands in the way. */
const nativeSql = () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false });

/** Engine double; every read it serves is recorded, so "denied" means "never read". */
function fakeEngine() {
  const reads: string[] = [];
  return {
    reads,
    engine: {
      execute: async (_sql: unknown, options?: { object?: string }) => {
        reads.push(`execute:${options?.object ?? '?'}`);
        return { rows: [{ cnt: 24 }] };
      },
      aggregate: async (object: string) => {
        reads.push(`aggregate:${object}`);
        return [{ cnt: 24 }];
      },
      hasObjectMiddleware: () => false,
      getObject: (name: string) =>
        name === 'employer_member' ? { fields: { id: { type: 'text' } } } : undefined,
      resolveEffectiveDatasource: () => undefined,
    },
  };
}

/** The lines this file is about: anything naming the object-level admission. */
const ADMISSION = /admitObjectRead|OBJECT-LEVEL|object-level read admission/;

type Lines = { info: string[]; warn: string[]; error: string[] };
const about = (lines: string[]) => lines.filter((l) => ADMISSION.test(l));

const runProbe = (service: AnalyticsService) =>
  service.queryDataset(probe as never, { measures: ['cnt'] } as never, CALLER);

// ── A REAL kernel: the default composition, in the default order ─────────────

/**
 * Boots a real `LiteKernel` with a `data` provider, this plugin, and — when
 * given — a security provider that registers AFTER this plugin's `init()`,
 * which is what every composition shipping plugin-security produces (it
 * registers `security` in its `start()`). The first plugin taps the kernel's
 * logger so every line the analytics plugin writes, at init and at query
 * time, is seen.
 */
async function bootKernel(security?: Record<string, unknown>) {
  const lines: Lines = { info: [], warn: [], error: [] };
  const { engine, reads } = fakeEngine();
  const tap: Plugin = {
    name: 'test.log-tap',
    init: async (ctx: PluginContext) => {
      for (const level of ['info', 'warn', 'error'] as const) {
        vi.spyOn(ctx.logger, level).mockImplementation((message: unknown) => {
          lines[level].push(String(message));
        });
      }
    },
  };
  const data: Plugin = {
    name: 'test.data',
    init: async (ctx: PluginContext) => { ctx.registerService('data', engine); },
  };
  const kernel = new LiteKernel({ logger: { level: 'silent' } });
  kernel.use(tap);
  kernel.use(data);
  kernel.use(new AnalyticsServicePlugin({ queryCapabilities: nativeSql }));
  if (security) {
    // Registered from start(), the phase plugin-security registers it in.
    kernel.use({
      name: 'test.security',
      init: async () => {},
      start: async (ctx: PluginContext) => { ctx.registerService('security', security); },
    } satisfies Plugin);
  }
  await kernel.bootstrap();
  return { service: kernel.getService<AnalyticsService>('analytics'), reads, lines };
}

/** A working security service's row-scope half; `undefined` = no row restriction. */
const rowScopeOpen = { getReadFilter: async () => undefined };

describe('admission absence report — a default composition (security registered after analytics init)', () => {
  it('boots with no admitObjectRead WARN: the init-time absence is an info line', async () => {
    const canReadObject = vi.fn(() => true);
    const { lines } = await bootKernel({ ...rowScopeOpen, canReadObject });

    expect(about(lines.warn)).toEqual([]);
    expect(about(lines.error)).toEqual([]);
    expect(about(lines.info).join('\n')).toMatch(
      /admitObjectRead bridged to the "security" service; that service is not registered yet at init/,
    );
  });

  it('its first query asks the security service that registered later — both verdicts, as before', async () => {
    const canReadObject = vi.fn(() => true);
    const admitted = await bootKernel({ ...rowScopeOpen, canReadObject });

    expect((await runProbe(admitted.service)).rows).toEqual([{ cnt: 24 }]);
    expect(canReadObject).toHaveBeenCalledWith('employer_member', CALLER);
    expect(admitted.reads).toHaveLength(1);
    // Asking the service that is there is not an absence: nothing to report.
    expect(about(admitted.lines.warn)).toEqual([]);

    const refused = await bootKernel({ ...rowScopeOpen, canReadObject: () => false });
    await expect(runProbe(refused.service)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    });
    expect(refused.reads).toEqual([]);
    expect(about(refused.lines.warn).join('\n')).not.toMatch(/No admitObjectRead configured/);
  });
});

describe('admission absence report — a real kernel that never registers a security service', () => {
  it('logs no init-time WARN, and absence stays loud at query time with the outcome unchanged', async () => {
    // The in-repo kernels answer a missing service by THROWING
    // ("[Kernel] Service 'security' not found"), which this bridge classifies
    // as a resolution that threw: it denies, fail-closed, and says so at
    // `error` on every query. That outcome is what this boot produced before
    // the init-time WARN moved, and it is not this file's to change; what is
    // pinned is that dropping the init-time WARN left this case loud.
    const { service, reads, lines } = await bootKernel(undefined);

    expect(about(lines.warn)).toEqual([]);

    await expect(runProbe(service)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    });
    expect(reads).toEqual([]);
    expect(about(lines.error).join('\n')).toMatch(
      /object-level read admission could not be resolved for "employer_member" .* denying the query \(fail-closed\)/s,
    );
  });
});

// ── The ABSENT resolution: a context that answers a missing service with nothing ─

function fakePluginContext() {
  const { engine, reads } = fakeEngine();
  const registered: Record<string, unknown> = {};
  const lines: Lines = { info: [], warn: [], error: [] };
  const record = (level: keyof Lines) => (message: unknown) => { lines[level].push(String(message)); };
  return {
    reads,
    lines,
    registered,
    ctx: {
      getService: (name: string) => (name === 'data' ? engine : registered[name]),
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      logger: { info: record('info'), warn: record('warn'), error: record('error'), debug() {} },
    },
  };
}

describe('admission absence report — no security service ever registered (the ABSENT resolution)', () => {
  it('WARNs at the first query, once: a second query does not repeat it, and both are admitted as before', async () => {
    const { ctx, registered, reads, lines } = fakePluginContext();
    await new AnalyticsServicePlugin({ queryCapabilities: nativeSql }).init(ctx as never);
    const service = registered.analytics as AnalyticsService;

    // Nothing at init beyond the heads-up: the verdict is the first query's.
    expect(about(lines.warn)).toEqual([]);

    expect((await runProbe(service)).rows).toEqual([{ cnt: 24 }]);
    expect(reads).toHaveLength(1);
    const first = about(lines.warn);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatch(
      /No admitObjectRead configured and no "security" service registered when an analytics query needed one \(first: "employer_member"\)/,
    );
    expect(first[0]).toMatch(/do NOT enforce the OBJECT-LEVEL read grant/);

    expect((await runProbe(service)).rows).toEqual([{ cnt: 24 }]);
    expect(reads).toHaveLength(2);
    expect(about(lines.warn)).toEqual(first);
    expect(about(lines.error)).toEqual([]);
  });

  it('reports per plugin instance, not per process: a second plugin init gets its own report', async () => {
    for (let i = 0; i < 2; i++) {
      const { ctx, registered, lines } = fakePluginContext();
      await new AnalyticsServicePlugin({ queryCapabilities: nativeSql }).init(ctx as never);
      await runProbe(registered.analytics as AnalyticsService);
      expect(about(lines.warn)).toHaveLength(1);
    }
  });
});
