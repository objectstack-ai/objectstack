// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10537] `POST /datasources/:name/external/validate` does URL-SCOPED WORK.
 *
 * ## The defect this file measures
 *
 * The route used to call `validateAll()` — every federated object on every
 * federated datasource, each validation driving a LIVE remote-schema
 * `introspect(datasource)` — and then keep only the rows whose `datasource`
 * matched `:name`. The answer was correct; the WORK was not scoped. One
 * datasource's health check paid for N datasources' remote round-trips, and an
 * unreachable *unrelated* remote slowed (and added rows to) a request that was
 * about to discard them.
 *
 * ## Why every assertion here is about the CALL RECORD, not the body
 *
 * The output was already right, so a test that only compared response bodies
 * would have passed just as well BEFORE the fix — a vacuous pin on a
 * cost/shape defect. The load-bearing assertions are therefore:
 *
 *  - which datasources were INTROSPECTED (`introspected`), and
 *  - that `validateAll()` was not called at all (`validateAllSpy`).
 *
 * The fixture carries {@link DATASOURCES}.length = 3 federated datasources on
 * purpose: with one, "introspected 1" and "introspected all" are the same
 * reading and nothing here could fail. The body IS pinned too — against the
 * pre-fix composition computed live from a second service instance
 * (`referenceAnswer`), so "same answer, less work" is asserted as one claim
 * rather than assumed.
 *
 * ## The service under the route is the REAL one
 *
 * `ExternalDatasourceService` over a fake introspector, not a hand-written
 * stand-in whose `validateAll` fans out because this file wrote it that way —
 * the fan-out being measured is the production composition's. The specifier is
 * aliased to that package's `src/` by this package's `vitest.config.ts` (the
 * alias predates this file; see its comment), so the reading is a function of
 * the checkout rather than of `dist/` build state.
 *
 * Driven through the real `HonoHttpServer` — the adapter `os serve` mounts — so
 * `:name` is parsed from the URL by the code that parses it in production.
 */

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { ExternalDatasourceService } from '@objectstack/service-datasource';
import type { IntrospectedSchema, SchemaValidationReport } from '@objectstack/spec/contracts';
import { registerExternalDatasourceRoutes } from './external-datasource-routes.js';

/**
 * Three federated datasources — N > 1 is what makes the scoping assertion
 * falsifiable. Each carries exactly one federated object, so "one datasource
 * introspected" and "one introspection" are the same count and neither hides
 * the other.
 */
const DATASOURCES = ['wh_a', 'wh_b', 'wh_c'] as const;

/** The remote every fixture datasource exposes: one table, one column. */
const REMOTE: IntrospectedSchema = {
  dialect: 'postgres',
  introspectedAt: '2026-08-21T00:00:00.000Z',
  tables: {
    orders: {
      name: 'orders',
      indexes: [],
      columns: [{ name: 'order_id', type: 'text', nullable: false, primaryKey: true }],
    },
  },
};

/** One federated object per datasource, plus a local one the sweep must skip. */
const OBJECTS = [
  ...DATASOURCES.map((ds) => ({
    name: `${ds}_orders`,
    datasource: ds,
    external: { remoteName: 'orders' },
    fields: { order_id: { type: 'text' } },
  })),
  // Not federated: no `external`, and the default datasource. `validateAll`
  // skips it, so the scoped path must skip it too.
  { name: 'local_thing', datasource: 'default', fields: { id: { type: 'text' } } },
];

/** An entitled caller — the capability gate (#9901/#10255) is not this file's subject. */
const CREDENTIALED = async () => ({
  userId: 'u_validate_scope',
  systemPermissions: ['manage_platform_settings'],
});

interface Fixture {
  /** Every datasource name `introspect` was called with, in call order. */
  introspected: string[];
  service: ExternalDatasourceService;
}

/**
 * A real service over a recording introspector.
 *
 * `unreachable` makes a datasource's remote refuse the connection, the way a
 * dead sibling remote behaves in production.
 */
function makeService(opts: { unreachable?: readonly string[]; listObjectsThrows?: string } = {}): Fixture {
  const introspected: string[] = [];
  const unreachable = new Set(opts.unreachable ?? []);
  const service = new ExternalDatasourceService({
    introspect: async (datasource: string) => {
      introspected.push(datasource);
      if (unreachable.has(datasource)) {
        throw new Error(`connect ECONNREFUSED (${datasource})`);
      }
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
    // The per-object catch inside the sweep logs; keep the run quiet.
    logger: { warn: () => {} },
  });
  return { introspected, service };
}

/** Mount the federation family over one service, on the real adapter. */
function mount(opts: Parameters<typeof makeService>[0] = {}) {
  const { introspected, service } = makeService(opts);
  const validateAllSpy = vi.spyOn(service, 'validateAll');
  const server = new HonoHttpServer(0);
  const ctx = {
    getService: (name: string) => {
      if (name === 'external-datasource') return service;
      throw new Error(`no service: ${name}`);
    },
  } as any;
  registerExternalDatasourceRoutes(server, ctx, '/api/v1', {
    resolveExecutionContext: CREDENTIALED,
  });
  return { app: server.getRawApp(), introspected, validateAllSpy, service };
}

/** POST the scoped validate route for one datasource name. */
async function validate(app: any, name: string) {
  const res = await app.fetch(
    new Request(`http://local/api/v1/datasources/${name}/external/validate`, { method: 'POST' }),
  );
  return { status: res.status, body: (await res.json()) as any };
}

/**
 * What the PRE-FIX composition answered: the whole-farm sweep, post-filtered to
 * one datasource. Computed from a SEPARATE service instance so it neither
 * pollutes the fixture's call record nor trips the `validateAll` spy — this is
 * the behaviour-unchanged half of the card, and it must be measured, not
 * remembered.
 */
async function referenceAnswer(
  name: string,
  opts: Parameters<typeof makeService>[0] = {},
): Promise<{ ok: boolean; results: SchemaValidationReport['results'] }> {
  const { service } = makeService(opts);
  const report = await service.validateAll();
  const results = (report.results ?? []).filter((r) => r.datasource === name);
  return { ok: results.every((r) => r.ok), results };
}

describe('[#10537] POST /external/validate scopes its WORK to :name', () => {
  it('introspects only the URL datasource — one remote, not three', async () => {
    // The fixture must be able to tell the two behaviours apart at all.
    expect(DATASOURCES.length).toBeGreaterThan(1);

    const { app, introspected, validateAllSpy } = mount();
    const { status } = await validate(app, 'wh_a');

    expect(status).toBe(200);
    // The whole card, in one line: the sweep read three remotes and kept one.
    expect(introspected).toEqual(['wh_a']);
    // …and the fan-out entry point is not on the scoped path at all.
    expect(validateAllSpy).not.toHaveBeenCalled();
  });

  it('answers exactly what the post-filtered sweep answered', async () => {
    const { app } = mount();
    const { status, body } = await validate(app, 'wh_a');
    const reference = await referenceAnswer('wh_a');

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // `ok` is the domain verdict this route has always carried inside `data`.
    expect(body.data.ok).toBe(reference.ok);
    expect(body.data.results).toEqual(reference.results);
    // Named explicitly so a future refactor that widened the set would fail
    // here rather than in a deep-equal diff nobody reads.
    expect(body.data.results.map((r: { object: string }) => r.object)).toEqual(['wh_a_orders']);
  });

  it('never dials an unrelated unreachable remote', async () => {
    const opts = { unreachable: ['wh_b'] } as const;
    const { app, introspected } = mount(opts);
    const { status, body } = await validate(app, 'wh_a');
    const reference = await referenceAnswer('wh_a', opts);

    expect(status).toBe(200);
    expect(introspected).toEqual(['wh_a']);
    expect(introspected).not.toContain('wh_b');
    // The dead sibling changed neither the verdict nor the rows — it only ever
    // cost time and produced rows that were filtered away.
    expect(body.data.ok).toBe(true);
    expect(body.data).toEqual(reference);
  });

  it('an unknown :name answers the same empty report as before — and dials nothing', async () => {
    const { app, introspected, validateAllSpy } = mount();
    const { status, body } = await validate(app, 'no_such_ds');

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // Unchanged: an unknown name is not a 404 on this route, it is an empty
    // report with a vacuously true verdict.
    expect(body.data).toEqual(await referenceAnswer('no_such_ds'));
    expect(body.data).toEqual({ ok: true, results: [] });
    expect(introspected).toEqual([]);
    expect(validateAllSpy).not.toHaveBeenCalled();
  });

  it('a refusal from the service is still 400 EXTERNAL_DATASOURCE_ERROR', async () => {
    const { app } = mount({ listObjectsThrows: 'metadata store offline' });
    const { status, body } = await validate(app, 'wh_a');

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('EXTERNAL_DATASOURCE_ERROR');
    expect(body.error.message).toBe('metadata store offline');
  });

  it('still degrades to 503 when federation is not wired into the host', async () => {
    const server = new HonoHttpServer(0);
    const ctx = {
      getService: (name: string) => {
        throw new Error(`no service: ${name}`);
      },
    } as any;
    registerExternalDatasourceRoutes(server, ctx, '/api/v1', {
      resolveExecutionContext: CREDENTIALED,
    });
    const { status, body } = await validate(server.getRawApp(), 'wh_a');

    expect(status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
