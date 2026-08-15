// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6504 (consumer sweep) — `removeDatasource`'s bound-object guard is a COUNT
 * spent as a safety verdict, so an under-count opens it.
 *
 * ---------------------------------------------------------------------------
 * Why this consumer is the sharpest one in the sweep
 * ---------------------------------------------------------------------------
 * The card's thesis is that during a loader outage a plural read serves "fewer
 * items, with a count", and that machine consumers trust counts. Every other
 * consumer in this sweep publishes that count to a reader who may believe it.
 * This one SPENDS it, on the only guard standing in front of an irreversible
 * operation:
 *
 *     const bound = await countBoundObjects(name);   // ← from listObjects()
 *     if (bound > 0) throw …                          // ← the whole guard
 *     await deleteDatasourceRecord(name);             // ← irreversible
 *     await removeSecret(existing.external.credentialsRef);
 *
 * `countBoundObjects` derives its number from the metadata service's object
 * listing, which goes silently short while a loader is down (ADR-0110 D3). Its
 * worst value is the benign-looking one: `0` is indistinguishable from "nothing
 * is bound", so the guard does not merely mis-state — it OPENS, the datasource
 * is deleted, and its credential is unbound behind it, while the objects that
 * were still bound to it were simply unreadable at that moment.
 *
 * ---------------------------------------------------------------------------
 * DOUBLES HERE, and the split is deliberate — the real-loader pin is elsewhere
 * ---------------------------------------------------------------------------
 * `packages/services/service-datasource` does not depend on
 * `@objectstack/metadata`, and adding that dependency so a unit test could
 * construct a `MetadataManager` would be a far larger change than the fix. So
 * the verdict reaching `DatasourceAdminService` is injected here, exactly as
 * PR #7721 did for `packages/mcp` and for the same reason, and it is stated
 * plainly rather than papered over.
 *
 * What that leaves un-pinned in THIS file is only the production of the
 * verdict, and that is pinned twice elsewhere, against a real `DatabaseLoader`
 * over a driver throwing `ECONNRESET`:
 * `packages/metadata/src/metadata-manager-list-diagnosed.test.ts` (the
 * producer) and `packages/runtime/src/list-diagnosed-consumer-sweep.test.ts`
 * (this sweep's real-failure consumer pin). What IS pinned here is the decision
 * that only exists in this file: what a datasource removal does when the count
 * behind its guard cannot be trusted.
 *
 * The wiring that composes the two — `countBoundObjectsDiagnosed` in
 * `datasource-admin-plugin.ts`, which takes the items from `listObjects()` and
 * the verdict from `listDiagnosed('object')` — is exercised by its own case at
 * the bottom of this file, over a metadata-service double, so the composition
 * is not merely asserted in a comment.
 *
 * ---------------------------------------------------------------------------
 * Both directions, on the COUNT
 * ---------------------------------------------------------------------------
 * The load-bearing pair is `count: 0, degraded: true` (the outage that reads as
 * "nothing is bound") against `count: 0, degraded: false` (a datasource that
 * genuinely has nothing bound). The two are BYTE-EQUAL on the number, and the
 * removal must go opposite ways on them. A test that only asserted "a degraded
 * flag exists" would pass on a build that ignored it at the decision.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red. Reversion is defined as restoring
 * `const bound = await this.config.countBoundObjects(name)` and the plain
 * `bound > 0` guard — i.e. the pre-#6504 consumer, with
 * `countBoundObjectsDiagnosed` left declared but unread.
 *
 * Predicted, written down before running: **3 red / 5 green** of the 8. Red are
 * the three cases that assert the refusal — the throw, its
 * 503/`SERVICE_UNAVAILABLE` envelope, and the record + secret + pool surviving
 * it. Green are the three that assert UNCHANGED behaviour (the genuinely-empty
 * removal still succeeding, the original bound-objects refusal keeping its own
 * message, and a host without the diagnosed member behaving as before), plus
 * the two wiring cases in the second describe — the plugin still WIRES the
 * diagnosed member under this ablation, it is the service that stops reading
 * it, which is exactly the failure shape a "declared but unconsumed" surface
 * has. Measured result is recorded in the PR body as it came out.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type StoredDatasource,
} from '../datasource-admin-service.js';

const RUNTIME_ROW: StoredDatasource = {
  name: 'warehouse',
  driver: 'postgres',
  origin: 'runtime',
  external: { credentialsRef: 'sys_secret://datasource/warehouse#1' },
} as StoredDatasource;

interface HarnessOpts {
  /** The diagnosed count the host reports. Omit to model a host predating it. */
  diagnosed?: { count: number; degraded: boolean; errors: string[] };
  /** The plain count, always wired — it is the pre-#6504 path. */
  plainCount?: number;
}

function harness(opts: HarnessOpts = {}) {
  const records: StoredDatasource[] = [{ ...RUNTIME_ROW }];
  const removedSecrets: string[] = [];
  const unregistered: string[] = [];

  const config: DatasourceAdminServiceConfig = {
    probe: async () => ({ ok: true }),
    listDatasourceRecords: async () => records,
    getDatasourceRecord: async (n) => records.find((r) => r.name === n),
    putDatasourceRecord: async () => {},
    deleteDatasourceRecord: async (n) => {
      const i = records.findIndex((r) => r.name === n);
      if (i >= 0) records.splice(i, 1);
    },
    writeSecret: async () => 'sys_secret://unused',
    removeSecret: async (ref) => { removedSecrets.push(ref); },
    countBoundObjects: async () => opts.plainCount ?? 0,
    ...(opts.diagnosed ? { countBoundObjectsDiagnosed: async () => opts.diagnosed! } : {}),
    unregisterPool: (n) => { unregistered.push(n); },
  } as DatasourceAdminServiceConfig;

  return {
    service: new DatasourceAdminService(config),
    exists: () => records.some((r) => r.name === 'warehouse'),
    removedSecrets,
    unregistered,
  };
}

const LOADER_FAILURE = 'database: read ECONNRESET';

describe('#6504 — a datasource removal refuses when the bound-object count is known-partial', () => {
  it('REFUSES on a degraded read whose count is 0 — the value that reads as "nothing is bound"', async () => {
    const h = harness({ diagnosed: { count: 0, degraded: true, errors: [LOADER_FAILURE] } });

    await expect(h.service.removeDatasource('warehouse')).rejects.toThrow(
      /could not be fully read/,
    );
  });

  it('carries the ADR-0112 envelope: SERVICE_UNAVAILABLE / 503, not a 400-class refusal', async () => {
    // The distinction is the whole point of the envelope: nothing about the
    // REQUEST is wrong, the condition is a dependency outage that may clear, and
    // the caller SHOULD retry. A bare Error would land as this service's generic
    // 400 `DATASOURCE_ADMIN_ERROR` and tell the operator the opposite.
    const h = harness({ diagnosed: { count: 0, degraded: true, errors: [LOADER_FAILURE] } });

    const err = await h.service.removeDatasource('warehouse').catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBe('SERVICE_UNAVAILABLE');
    expect((err as { status?: number }).status).toBe(503);
    // The first sentence is contract here — it is what the operator reads on the
    // API response — so it is asserted on top of the code/status, not instead.
    expect((err as Error).message).toMatch(/Cannot remove datasource 'warehouse'/);
    expect((err as Error).message).toMatch(/the true number can only be higher/);
    // The loader detail rides on `cause`, never in the served message: it names
    // internal datasources and tables.
    expect(String((err as { cause?: unknown }).cause)).toContain('ECONNRESET');
    expect((err as Error).message).not.toContain('ECONNRESET');
  });

  it('leaves the record AND its secret intact — the refusal is the whole point', async () => {
    const h = harness({ diagnosed: { count: 0, degraded: true, errors: [LOADER_FAILURE] } });

    await h.service.removeDatasource('warehouse').catch(() => undefined);

    expect(h.exists(), 'the datasource must survive a refusal').toBe(true);
    expect(h.removedSecrets, 'its credential must not be unbound').toEqual([]);
    expect(h.unregistered, 'its pool must not be torn down').toEqual([]);
  });

  it('a COMPLETE read of the same count 0 removes it — byte-equal number, opposite outcome', async () => {
    // The pair that gives the verdict meaning. `count: 0` in both cases; only
    // `degraded` differs, and it must be what decides.
    const h = harness({ diagnosed: { count: 0, degraded: false, errors: [] } });

    await expect(h.service.removeDatasource('warehouse')).resolves.toBeUndefined();

    expect(h.exists()).toBe(false);
    expect(h.removedSecrets).toEqual(['sys_secret://datasource/warehouse#1']);
  });

  it('a complete read that finds bindings still refuses with the ORIGINAL message', async () => {
    // The pre-existing guard is untouched: this change adds a second reason to
    // refuse, it does not re-word or weaken the first.
    const h = harness({ diagnosed: { count: 2, degraded: false, errors: [] } });

    await expect(h.service.removeDatasource('warehouse')).rejects.toThrow(
      /2 object\(s\) are still bound to it/,
    );
    expect(h.exists()).toBe(true);
  });

  it('a host predating `countBoundObjectsDiagnosed` behaves exactly as before', async () => {
    // The optionality `IMetadataService.listDiagnosed` itself carries, one layer
    // out: a host that cannot report the distinction reports nothing degraded,
    // and its removals are unchanged in both directions.
    const empty = harness({ plainCount: 0 });
    await expect(empty.service.removeDatasource('warehouse')).resolves.toBeUndefined();
    expect(empty.exists()).toBe(false);

    const bound = harness({ plainCount: 3 });
    await expect(bound.service.removeDatasource('warehouse')).rejects.toThrow(
      /3 object\(s\) are still bound to it/,
    );
    expect(bound.exists()).toBe(true);
  });
});

describe('#6504 — the plugin wiring composes the count and the verdict correctly', () => {
  /**
   * The composition PR #7721 established: the ITEMS come from the resolver the
   * call site already used (`listObjects()`), and only the VERDICT is asked of
   * `listDiagnosed('object')`. Re-resolving the objects through the diagnosed
   * read would presume `listObjects()` and `list('object')` are the same read —
   * an equivalence `IMetadataService` does not declare.
   *
   * Built by calling the plugin's own `init` and reading the config it wired, so
   * this pins the shipped wiring rather than a restatement of it.
   */
  async function wiredConfig(metadata: unknown): Promise<DatasourceAdminServiceConfig> {
    const { DatasourceAdminServicePlugin } = await import('../datasource-admin-plugin.js');
    const plugin = new DatasourceAdminServicePlugin();
    const services: Record<string, unknown> = { metadata };
    const ctx = {
      getService: (n: string) => {
        if (n in services) return services[n];
        throw new Error(`service '${n}' not registered`);
      },
      registerService: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as any;
    await plugin.init(ctx);
    return (plugin as unknown as { config: DatasourceAdminServiceConfig }).config;
  }

  it('counts from `listObjects()` and takes the verdict from `listDiagnosed("object")`', async () => {
    const diagnosedCalls: string[] = [];
    const metadata = {
      get: async () => undefined,
      list: async () => [],
      register: async () => {},
      unregister: async () => {},
      // Two bound objects are readable; a third is behind the dead loader.
      listObjects: async () => [
        { name: 'wh_order', datasource: 'warehouse' },
        { name: 'wh_line', datasource: 'warehouse' },
        { name: 'local_task' },
      ],
      listDiagnosed: async (type: string) => {
        diagnosedCalls.push(type);
        return { items: [], degraded: true, errors: [LOADER_FAILURE] };
      },
    };

    const config = await wiredConfig(metadata);
    const read = await config.countBoundObjectsDiagnosed!('warehouse');

    expect(read.count, 'the count comes from listObjects(), filtered by datasource').toBe(2);
    expect(read.degraded).toBe(true);
    expect(read.errors).toEqual([LOADER_FAILURE]);
    expect(diagnosedCalls, 'the verdict is asked for `object`, the type being counted').toEqual([
      'object',
    ]);
  });

  it('reports nothing degraded against a metadata service predating `listDiagnosed`', async () => {
    const config = await wiredConfig({
      get: async () => undefined,
      list: async () => [],
      register: async () => {},
      unregister: async () => {},
      listObjects: async () => [{ name: 'wh_order', datasource: 'warehouse' }],
    });

    const read = await config.countBoundObjectsDiagnosed!('warehouse');

    expect(read).toEqual({ count: 1, degraded: false, errors: [] });
  });
});
