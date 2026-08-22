// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10961] The BACKGROUND drift check does the work it was ARMED for.
 *
 * ## The defect this file measures
 *
 * `scheduleDriftChecks` arms one `setInterval` PER DATASOURCE — one timer for
 * each datasource declaring `external.validation.checkIntervalMs`. Each tick
 * called `svc.validateAll()` — every federated object on every federated
 * datasource, each validation driving a live remote-schema
 * `introspect(datasource)` — and then kept only the rows whose `datasource`
 * matched the one the timer was armed for. The emitted events were right; the
 * WORK was the whole farm.
 *
 * This is the periodic twin of the request-gate defect fixed for
 * `POST /datasources/:name/external/validate`, and worse for being UNATTENDED:
 * nobody is waiting on the answer, so the fan-out repeats on every interval of
 * every armed datasource forever, and N armed datasources sweep the farm N
 * times per cycle instead of dialling one remote each.
 *
 * ## Why every assertion here is about the CALL RECORD, not the events
 *
 * "the drift check ran" and "it emitted one event per drifted object" pass
 * identically before the fix, after it, and on a wrong fix — the output was
 * never the broken part. The load-bearing pins are therefore:
 *
 *  - which datasources a tick INTROSPECTED (`introspected`), asserted as an
 *    exact list over a fixture with {@link DATASOURCES}.length = 3 federated
 *    datasources, so "dialled one" and "dialled all" are different readings;
 *  - that `validateAll()` was not called at all (`vi.spyOn` on the real
 *    service instance);
 *  - that a dead SIBLING remote is never dialled by another datasource's tick.
 *
 * The events are pinned too — against the pre-fix composition computed live
 * from a second service instance (`sweepThenFilter`), so "same events, less
 * work" is one asserted claim rather than an assumption.
 *
 * ## The service under the plugin is the REAL one
 *
 * `ExternalDatasourceService` over a recording introspector — not a
 * hand-written stand-in whose `validateAll` fans out because this file wrote
 * it that way. The fan-out being measured is the production composition's.
 *
 * `@objectstack/service-datasource` is NOT aliased to source by this package's
 * `vitest.config.ts` (it is one of this package's registered entries in
 * `KNOWN_UNALIASED_TEST_IMPORTS`, `scripts/check-test-source-alias.mjs`), so
 * the service arrives from its `dist/` and that package must be built before
 * this file is a verdict about anything. The subject under test —
 * `external-validation-plugin.ts` — is this package's own source, imported
 * relatively, so no build mediates the thing being changed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExternalDatasourceService } from '@objectstack/service-datasource';
import type { IntrospectedSchema } from '@objectstack/spec/contracts';
import { ExternalValidationPlugin } from './external-validation-plugin';

/**
 * Three federated datasources — N > 1 is what makes every scoping assertion
 * falsifiable. Exactly ONE federated object each, so "datasources dialled" and
 * "introspect calls" are the same number and neither can hide the other.
 */
const DATASOURCES = ['wh_a', 'wh_b', 'wh_c'] as const;

/** The remote every fixture datasource exposes: one table, one column. */
const REMOTE: IntrospectedSchema = {
  dialect: 'postgres',
  introspectedAt: '2026-08-22T00:00:00.000Z',
  tables: {
    orders: {
      name: 'orders',
      indexes: [],
      columns: [{ name: 'order_id', type: 'text', nullable: false, primaryKey: true }],
    },
  },
};

/**
 * One federated object per datasource, each DRIFTED: it declares an `amount`
 * field the remote table does not carry, so `validateObject` returns a
 * `missing_column` error row. Every datasource drifting is what makes "the
 * events stayed the same" a real claim — a fixture where only the armed one
 * drifts would agree with a post-filter by accident.
 *
 * `local_thing` is not federated (no `external`, default datasource); the
 * sweep skips it, so the scoped path must skip it too.
 */
const OBJECTS = [
  ...DATASOURCES.map((ds) => ({
    name: `${ds}_orders`,
    datasource: ds,
    external: { remoteName: 'orders' },
    fields: { order_id: { type: 'text' }, amount: { type: 'number' } },
  })),
  { name: 'local_thing', datasource: 'default', fields: { id: { type: 'text' } } },
];

interface Fixture {
  /** Every datasource name `introspect` was called with, in call order. */
  introspected: string[];
  service: ExternalDatasourceService;
}

/**
 * A real service over a recording introspector.
 *
 * `unreachable` makes one datasource's remote refuse the connection, the way a
 * dead sibling remote behaves in production. `listObjectsThrows` fails the
 * service call itself — the shape a background checker has to survive without
 * throwing.
 */
function makeService(
  opts: { unreachable?: readonly string[]; listObjectsThrows?: string } = {},
): Fixture {
  const introspected: string[] = [];
  const unreachable = new Set(opts.unreachable ?? []);
  const service = new ExternalDatasourceService({
    introspect: async (datasource: string) => {
      introspected.push(datasource);
      if (unreachable.has(datasource)) throw new Error(`connect ECONNREFUSED (${datasource})`);
      return REMOTE;
    },
    getDatasource: async (name: string) =>
      (DATASOURCES as readonly string[]).includes(name)
        ? { name, schemaMode: 'external' as const }
        : undefined,
    getObject: async (name: string) => OBJECTS.find((o) => o.name === name),
    listObjects: async () => {
      if (opts.listObjectsThrows) throw new Error(opts.listObjectsThrows);
      return OBJECTS;
    },
    // The sweep's per-object catch logs; keep the run quiet.
    logger: { warn: () => {} },
  });
  return { introspected, service };
}

/** A plugin context over one service, recording what it logged and triggered. */
function makeCtx(service: unknown) {
  const warnings: unknown[][] = [];
  const triggered: Array<[string, unknown]> = [];
  const ctx = {
    getService: (name: string) => {
      if (name === 'external-datasource') return service;
      throw new Error(`no service: ${name}`);
    },
    registerService: vi.fn(),
    hook: vi.fn(),
    trigger: vi.fn(async (event: string, payload: unknown) => {
      triggered.push([event, payload]);
    }),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: (...a: unknown[]) => warnings.push(a),
    },
  } as any;
  return { ctx, warnings, triggered };
}

/**
 * The PRE-FIX answer, computed live rather than remembered: the whole-farm
 * sweep, post-filtered to one datasource. Every equivalence assertion below
 * compares against this, and against the sweep's own introspection count — so
 * an equivalence line can never be vacuous.
 */
async function sweepThenFilter(datasource: string) {
  const { introspected, service } = makeService();
  const report = await service.validateAll();
  return {
    sweepIntrospected: introspected,
    rows: report.results.filter((r) => !r.ok && r.datasource === datasource),
  };
}

describe('[#10961] runDriftCheck introspects the datasource it was armed for — and no other', () => {
  it('a tick for wh_a dials wh_a only, and never asks for the whole-farm sweep', async () => {
    const { introspected, service } = makeService();
    const validateAllSpy = vi.spyOn(service, 'validateAll');
    const { ctx, triggered } = makeCtx(service);

    const emitted = await new ExternalValidationPlugin().runDriftCheck(ctx, 'wh_a');

    // THE pin: the work, not the output.
    expect(introspected).toEqual(['wh_a']);
    expect(validateAllSpy).not.toHaveBeenCalled();

    // The output is unchanged — same events the post-filter produced.
    const reference = await sweepThenFilter('wh_a');
    // Guard against a vacuous equivalence: the sweep really does dial the farm.
    expect(reference.sweepIntrospected).toEqual([...DATASOURCES]);
    expect(emitted).toBe(reference.rows.length);
    expect(triggered).toEqual(
      reference.rows.map((r) => [
        'external.schema.drift',
        { datasource: r.datasource, object: r.object, diffs: r.diffs },
      ]),
    );
  });

  it('a dead SIBLING remote is never dialled by the wh_a tick', async () => {
    const { introspected, service } = makeService({ unreachable: ['wh_b'] });
    const { ctx, triggered } = makeCtx(service);

    const emitted = await new ExternalValidationPlugin().runDriftCheck(ctx, 'wh_a');

    expect(introspected).toEqual(['wh_a']);
    expect(introspected).not.toContain('wh_b');
    expect(emitted).toBe(1);
    expect(triggered).toHaveLength(1);
  });

  it('a name nothing is bound to dials nothing at all', async () => {
    const { introspected, service } = makeService();
    const { ctx, triggered } = makeCtx(service);

    const emitted = await new ExternalValidationPlugin().runDriftCheck(ctx, 'no_such_ds');

    expect(introspected).toEqual([]);
    expect(emitted).toBe(0);
    expect(triggered).toEqual([]);
  });
});

describe('[#10961] each armed timer pays for its own datasource only', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('two armed datasources, one interval: two remotes dialled, not six', async () => {
    const { introspected, service } = makeService();
    const validateAllSpy = vi.spyOn(service, 'validateAll');
    const { ctx } = makeCtx(service);
    (ctx as any).getService = (name: string) => {
      if (name === 'external-datasource') return service;
      if (name === 'metadata') {
        return {
          list: async () => [
            { name: 'wh_a', external: { validation: { checkIntervalMs: 1000 } } },
            { name: 'wh_b', external: { validation: { checkIntervalMs: 1000 } } },
            // Armed for nothing: no interval declared.
            { name: 'wh_c', external: { validation: {} } },
          ],
        };
      }
      throw new Error(`no service: ${name}`);
    };

    const plugin = new ExternalValidationPlugin();
    await plugin.scheduleDriftChecks(ctx);
    expect(introspected).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);

    // Two timers, one tick each: exactly the two remotes they were armed for.
    // Pre-fix this read ['wh_a','wh_b','wh_c','wh_a','wh_b','wh_c'] — the farm,
    // once per armed timer, per tick, forever.
    expect([...introspected].sort()).toEqual(['wh_a', 'wh_b']);
    expect(introspected).toHaveLength(2);
    expect(validateAllSpy).not.toHaveBeenCalled();

    plugin.destroy();
  });

  it('the cost does not grow with the number of ticks-per-farm: 3 ticks of wh_a dial wh_a 3 times', async () => {
    const { introspected, service } = makeService();
    const { ctx } = makeCtx(service);
    (ctx as any).getService = (name: string) => {
      if (name === 'external-datasource') return service;
      if (name === 'metadata') {
        return { list: async () => [{ name: 'wh_a', external: { validation: { checkIntervalMs: 1000 } } }] };
      }
      throw new Error(`no service: ${name}`);
    };

    const plugin = new ExternalValidationPlugin();
    await plugin.scheduleDriftChecks(ctx);
    await vi.advanceTimersByTimeAsync(3000);

    expect(introspected).toEqual(['wh_a', 'wh_a', 'wh_a']);
    plugin.destroy();
  });
});

describe('[#10961] a BACKGROUND checker degrades by staying silent and saying why', () => {
  it('a wired service with no scoped spelling is DECLINED — not served by the fan-out', async () => {
    // The shape the probe exists for: a service that can only sweep. Falling
    // back to it would leave the fan-out reachable on a path no test drives,
    // unattended, forever — the exact defect this card removes.
    const validateAll = vi.fn(async () => ({ ok: true, results: [] }));
    const { ctx, warnings, triggered } = makeCtx({ validateAll });

    const emitted = await new ExternalValidationPlugin().runDriftCheck(ctx, 'wh_a');

    expect(emitted).toBe(0);
    expect(validateAll).not.toHaveBeenCalled();
    expect(triggered).toEqual([]);
    // Silence-plus-log: no throw, no events, and the reason recorded once per
    // declined tick — a background checker has no caller to refuse.
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain('validateDatasource');
    expect(warnings[0]?.[1]).toMatchObject({ datasource: 'wh_a' });
  });

  it('an armed datasource whose check cannot be performed stays silent and logs — never throws', async () => {
    const { service } = makeService({ listObjectsThrows: 'metadata store unreachable' });
    const { ctx, warnings, triggered } = makeCtx(service);

    // Resolves — the timer callback is fire-and-forget, so a rejection here
    // would be an unhandled rejection in an unattended process.
    await expect(new ExternalValidationPlugin().runDriftCheck(ctx, 'wh_a')).resolves.toBe(0);
    expect(triggered).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.[1]).toMatchObject({ datasource: 'wh_a' });
  });

  it('no external-datasource service at all is a QUIET no-op — federation simply is not wired', async () => {
    const warnings: unknown[][] = [];
    const ctx = {
      getService: () => {
        throw new Error('service not registered');
      },
      trigger: vi.fn(),
      logger: { debug: vi.fn(), info: vi.fn(), warn: (...a: unknown[]) => warnings.push(a) },
    } as any;

    await expect(new ExternalValidationPlugin().runDriftCheck(ctx, 'wh_a')).resolves.toBe(0);
    expect(ctx.trigger).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });
});
