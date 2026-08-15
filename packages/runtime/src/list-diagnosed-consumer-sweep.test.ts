// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6504 (consumer sweep) — `packages/runtime`'s two list-family consumers that
 * make a claim, pinned against a REAL loader outage.
 *
 * ---------------------------------------------------------------------------
 * Why these two, and not every `list()` caller in the package
 * ---------------------------------------------------------------------------
 * The card's discipline (PR #6051, followed by PR #7721) is that each consumer
 * of a possibly-short listing is qualified INDIVIDUALLY — gating, non-gating,
 * or mis-describing — and that a blanket switch would be worse than leaving
 * them alone. `packages/runtime` reads the metadata service's list family at
 * six places. Four publish no claim about the environment and are correct
 * unchanged; the two pinned here are the ones that state something a short read
 * makes false:
 *
 *  1. **the MCP `list_objects` bridge** (`domains/mcp.ts`) — its tool renders
 *     `{ objects, totalCount }`, and `totalCount` is a positive, numeric claim
 *     about what this environment declares. Mis-describing, and the same shape
 *     PR #7721 closed on the `objectstack://objects` RESOURCE — the identical
 *     question over the other transport.
 *  2. **the ADR-0015 §5.2 boot gate** (`external-validation-plugin.ts`) — it
 *     announces *all federated objects match their remote schema*, with a
 *     count, over whatever `validateAll()` could enumerate. Mis-describing AND
 *     gating: the objects held by an unreadable loader were never validated, so
 *     `onMismatch: 'fail'` could not have fired for them, and the boot is
 *     announced clean anyway.
 *
 * The rest of the package's inventory, with the reason each is left alone, is
 * in the PR body.
 *
 * ---------------------------------------------------------------------------
 * Why the failure is REAL and not stubbed
 * ---------------------------------------------------------------------------
 * `packages/runtime` depends on `@objectstack/metadata`, so — unlike the
 * `packages/mcp` and `packages/services/service-datasource` halves of this
 * sweep, which say so in their own headers — no double is needed anywhere in
 * this file. Every degraded case below is produced by a real `MetadataManager`
 * whose `DatabaseLoader` sits over a driver whose `find()` throws `ECONNRESET`,
 * exactly as PR #7721's producer pin does. The `catch` in `readListUncached()`
 * is therefore the thing under test and `degraded` is COMPUTED, not injected. A
 * test that handed the consumer a pre-made verdict would prove only that a
 * boolean can be passed along, which was never in doubt.
 *
 * ---------------------------------------------------------------------------
 * What is asserted, and why it is the COUNT
 * ---------------------------------------------------------------------------
 * Both directions, on the number itself. The load-bearing pair is *"the outage
 * and the small environment are the same listing"* (equal items AND equal
 * length through the undiagnosed read — the defect, deliberately still true,
 * because the plain read is unchanged) against *"the diagnosed read separates
 * them"*. A pin that only checked a `degraded` flag exists would pass on an
 * implementation that reports the flag against the wrong read; pinning the
 * equality is what gives the flag meaning, and pinning the healed count (1 vs
 * 3) is what shows the size of the lie a `totalCount` consumer told.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red, in two independent ablations — one per consumer, since a single
 * revert of both would not say which pin measures which decision.
 *
 *  (a) delete `listObjectsDiagnosed` from `buildMcpBridge` — predicted **4 red
 *      / 5 green** of the 9. The four MCP cases that read the bridge's
 *      diagnosed member go red (vitest transpiles rather than type-checks, so
 *      the missing member surfaces as a runtime `TypeError`); green are the one
 *      "the plain read is unchanged" invariant — which must stay green in both
 *      directions, since a regression there would be a different bug — plus all
 *      four boot-gate cases, which never touch this consumer.
 *  (b) restore `announceAllClear`'s body to the unconditional
 *      `logger.info('… all federated objects match …')` — predicted **2 red / 7
 *      green**. Red are exactly the two gate cases that discriminate on the
 *      withheld claim (the degraded one and the probe-throws one). The other
 *      two gate cases are green ON PURPOSE and are the reason the ablation is
 *      worth running: they assert that the claim is WITHHELD rather than
 *      removed, so a build that never learned to withhold it satisfies them
 *      too. The five MCP cases are untouched.
 *
 * Measured results are recorded in the PR body as they came out.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { MetadataManager, DatabaseLoader, MemoryLoader } from '@objectstack/metadata';
import { HttpDispatcher } from './http-dispatcher.js';
import { ExternalValidationPlugin } from './external-validation-plugin.js';

const connectionReset = (): Error =>
  Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

/** An `object` row as both the registry and the loader hand them back. */
interface NamedObject {
  name: string;
  datasource?: string;
}

const names = (items: unknown[]): string[] =>
  (items as NamedObject[]).map((i) => i.name).sort();

/**
 * A `sys_metadata` store that fails every read until `heal()`, then serves two
 * federated `object` rows.
 *
 * Two rows rather than one so the outage is a real subtraction from a countable
 * total: the healthy answer is 3, the degraded answer is 1, and the gap of 2 is
 * exactly what a `totalCount` consumer understated. Both stored rows carry
 * `datasource: 'warehouse'`, which is what makes them FEDERATED — the boot gate
 * below filters on precisely that field, so an outage removes objects the gate
 * was supposed to validate rather than objects it would have skipped anyway.
 */
function healableStore(): { driver: IDataDriver; heal: () => void } {
  let broken = true;
  const row = (name: string): Record<string, unknown> => ({
    id: name,
    name,
    type: 'object',
    metadata: JSON.stringify({ name, datasource: 'warehouse' }),
  });
  const find = vi.fn(async (): Promise<Record<string, unknown>[]> => {
    if (broken) throw connectionReset();
    return [row('wh_order'), row('wh_line')];
  });
  const driver = {
    name: 'mock',
    version: '1.0.0',
    supports: {},
    connect: async (): Promise<void> => {},
    disconnect: async (): Promise<void> => {},
    syncSchema: async (): Promise<void> => {},
    find,
  } as unknown as IDataDriver;

  return { driver, heal: (): void => { broken = false; } };
}

/** A real manager whose one `DatabaseLoader` is down, plus one registry object. */
function managerOverBrokenStore(): { manager: MetadataManager; heal: () => void } {
  const store = healableStore();
  const manager = new MetadataManager({ formats: ['json'], loaders: [] });
  // `cache: { enabled: false }` keeps the loader's OWN LRU out of the picture,
  // so the manager's list cache is the only memo in play.
  manager.registerLoader(new DatabaseLoader({ driver: store.driver, cache: { enabled: false } }));
  manager.registerInMemory('object', 'local_task', { name: 'local_task' });
  return { manager, heal: store.heal };
}

/**
 * A manager that is genuinely small: one declaration, every loader answering.
 * Its `listObjects()` is the answer the broken one above IMITATES.
 */
function managerOverHealthyStore(): MetadataManager {
  const manager = new MetadataManager({ formats: ['json'], loaders: [new MemoryLoader()] });
  manager.registerInMemory('object', 'local_task', { name: 'local_task' });
  return manager;
}

// ── The MCP bridge half ──────────────────────────────────────────────────────

/** Build the kernel the dispatcher reads, with a REAL metadata service in the slot. */
function makeKernel(metadata: unknown) {
  const mcpService: any = {
    lastOpts: undefined,
    handleHttpRequest: async (_req: Request, o: any) => {
      mcpService.lastOpts = o;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const services: Record<string, unknown> = { mcp: mcpService, metadata };
  return {
    getService: (n: string) => services[n],
    getServiceAsync: async (n: string) => services[n],
  } as any;
}

function makeContext() {
  return {
    request: new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: '{}',
    }),
    response: {},
    environmentId: undefined,
    executionContext: { userId: 'u1', isSystem: false, positions: [], permissions: [] },
  };
}

/** Drive the real HTTP entry point and hand back the bridge the runtime built. */
async function bridgeFor(metadata: unknown): Promise<any> {
  const kernel = makeKernel(metadata);
  const d = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
  const res = await d.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, makeContext() as any);
  expect(res.response?.status, 'precondition: the MCP route must have been served').toBe(200);
  return (kernel.getService('mcp') as any).lastOpts.bridge;
}

describe('#6504 — the MCP object bridge: an outage must not arrive as a small environment', () => {
  const prev = process.env.OS_MCP_SERVER_ENABLED;
  beforeEach(() => {
    process.env.OS_MCP_SERVER_ENABLED = 'true';
    // The manager's own outage line would otherwise print once per read. The
    // verdict under test is the RETURN VALUE, not the log, so this silences
    // noise without hiding anything the assertions depend on.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
    else process.env.OS_MCP_SERVER_ENABLED = prev;
    vi.restoreAllMocks();
  });

  it('the plain listObjects() cannot tell them apart — same objects, same COUNT', async () => {
    const { manager: broken } = managerOverBrokenStore();
    const outage = await (await bridgeFor(broken)).listObjects();
    const small = await (await bridgeFor(managerOverHealthyStore())).listObjects();

    // The defect stated as an assertion — and deliberately STILL TRUE after the
    // fix, because `listObjects` is unchanged in every direction. A case that
    // went red here would be reporting a regression, not this fix.
    expect(names(outage)).toEqual(names(small));
    expect(outage).toHaveLength(small.length);
    expect(names(outage)).toEqual(['local_task']);
  });

  it('listObjectsDiagnosed() separates them, and the COUNT is what the claim rests on', async () => {
    const { manager: broken } = managerOverBrokenStore();
    const outage = await (await bridgeFor(broken)).listObjectsDiagnosed();
    const small = await (await bridgeFor(managerOverHealthyStore())).listObjectsDiagnosed();

    expect(outage.degraded).toBe(true);
    expect(small.degraded).toBe(false);

    // Same objects, same length — the two reads are indistinguishable on the
    // data, which is exactly why the verdict has to travel beside it.
    expect(names(outage.objects)).toEqual(names(small.objects));
    expect(outage.objects).toHaveLength(1);
    expect(small.objects).toHaveLength(1);

    // The loader that was lost is named, so an operator can act on it.
    expect(outage.errors).toHaveLength(1);
    expect(outage.errors[0]).toMatch(/ECONNRESET/);
    expect(small.errors).toEqual([]);
  });

  it('the outage is a MEASURABLE subtraction: the true count is 3, the claim would have said 1', async () => {
    const { manager: broken } = managerOverBrokenStore();
    const { manager: working, heal } = managerOverBrokenStore();
    heal();

    const degraded = await (await bridgeFor(broken)).listObjectsDiagnosed();
    const complete = await (await bridgeFor(working)).listObjectsDiagnosed();

    expect(degraded.objects).toHaveLength(1);
    expect(complete.objects).toHaveLength(3);
    expect(complete.degraded).toBe(false);
    // The gap a `totalCount` consumer would have published as fact.
    expect(degraded.objects.length).toBeLessThan(complete.objects.length);
  });

  it('a metadata service PREDATING listDiagnosed reports nothing degraded — the member is optional', async () => {
    // Not a double of the verdict: a real object listing, from a service that
    // simply cannot express the distinction. Its behaviour must be exactly what
    // it was before #6504, which is what keeps the optional member optional.
    const legacy = {
      listObjects: async () => [{ name: 'local_task' }],
      getObject: async () => null,
      list: async () => [],
    };
    const read = await (await bridgeFor(legacy)).listObjectsDiagnosed();
    expect(read.degraded).toBe(false);
    expect(read.errors).toEqual([]);
    expect(names(read.objects)).toEqual(['local_task']);
  });

  it('a verdict probe that THROWS does not fail a read whose objects already succeeded', async () => {
    // Trading a working `list_objects` for observability would be a new failure
    // mode bought with a diagnosis fix. It must degrade to "nothing claimed".
    const flaky = {
      listObjects: async () => [{ name: 'local_task' }],
      getObject: async () => null,
      list: async () => [],
      listDiagnosed: async () => { throw new Error('probe exploded'); },
    };
    const read = await (await bridgeFor(flaky)).listObjectsDiagnosed();
    expect(names(read.objects)).toEqual(['local_task']);
    expect(read.degraded).toBe(false);
  });
});

// ── The ADR-0015 boot-gate half ──────────────────────────────────────────────

/**
 * The gate's context, with a REAL metadata service in the `metadata` slot and a
 * federation service that validates cleanly. The validation result is fixed at
 * "everything I was given matches" on purpose: the question under test is not
 * whether the gate detects drift, it is whether the gate is entitled to call
 * that result an ALL-CLEAR for the environment.
 */
function gateCtx(metadata: unknown, validated: string[]) {
  const infos: any[] = [];
  const warnings: any[] = [];
  const services: Record<string, unknown> = {
    'external-datasource': {
      validateAll: async () => ({
        ok: true,
        results: validated.map((object) => ({ ok: true, datasource: 'warehouse', object, diffs: [] })),
      }),
    },
    metadata,
  };
  const ctx = {
    getService: <T>(name: string): T => {
      if (name in services) return services[name] as T;
      throw new Error(`service '${name}' not registered`);
    },
    registerService: vi.fn(),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: {
      debug: vi.fn(),
      info: (...a: any[]) => infos.push(a),
      warn: (...a: any[]) => warnings.push(a),
    },
  } as any;
  return { ctx, infos, warnings };
}

const said = (lines: any[], fragment: string): boolean =>
  lines.some((l) => String(l[0]).includes(fragment));

describe('#6504 — the ADR-0015 boot gate must not announce an all-clear over an incomplete sweep', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('withholds the "all federated objects match" claim while a loader is down', async () => {
    const { manager } = managerOverBrokenStore();
    // The sweep saw only the one object the registry holds; `wh_order` and
    // `wh_line` — both federated — were never validated because they were never
    // listed. The gate must not speak for them.
    const { ctx, infos, warnings } = gateCtx(manager, ['local_task']);

    await new ExternalValidationPlugin().runValidation(ctx);

    expect(said(infos, 'all federated objects match'), 'the all-clear must NOT be claimed').toBe(false);
    expect(said(warnings, 'INCOMPLETE object set')).toBe(true);
    // The number it does state is named as what was VALIDATED, never as a total.
    expect(said(warnings, '1 validated')).toBe(true);
  });

  it('makes the claim normally once every loader answers — this is a claim WITHHELD, not removed', async () => {
    const { manager, heal } = managerOverBrokenStore();
    heal();
    const { ctx, infos, warnings } = gateCtx(manager, ['local_task', 'wh_order', 'wh_line']);

    await new ExternalValidationPlugin().runValidation(ctx);

    expect(said(infos, 'all federated objects match')).toBe(true);
    expect(warnings, 'a complete sweep warns about nothing').toEqual([]);
  });

  it('still claims the all-clear on a service predating listDiagnosed — unchanged behaviour', async () => {
    const legacy = { get: async () => undefined, list: async () => [] };
    const { ctx, infos } = gateCtx(legacy, ['wh_order']);

    await new ExternalValidationPlugin().runValidation(ctx);

    expect(said(infos, 'all federated objects match')).toBe(true);
  });

  it('says the completeness could not be DETERMINED when the probe itself throws', async () => {
    // Neither an all-clear nor a degradation report: the honest third answer.
    const flaky = {
      get: async () => undefined,
      list: async () => [],
      listDiagnosed: async () => { throw new Error('probe exploded'); },
    };
    const { ctx, infos, warnings } = gateCtx(flaky, ['wh_order']);

    await new ExternalValidationPlugin().runValidation(ctx);

    expect(said(infos, 'all federated objects match')).toBe(false);
    expect(said(warnings, 'could not be determined')).toBe(true);
  });
});
