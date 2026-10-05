// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21842] Federated validation reads its objects from the engine's object
 * registry, the one a runtime save writes through to.
 *
 * ## The defect this pins closed
 *
 * `ExternalDatasourceServicePlugin` wired the service's `listObjects` and
 * `getObject` to the `'metadata'` service. That service holds a copy of the
 * engine's object registry taken once at boot (`ObjectQLPlugin`'s startup
 * bridge). `PUT /api/v1/meta/object/:name`, and the external-table import that
 * saves through it, write `sys_metadata` and the engine registry, never that
 * copy. Measured on the showcase (`objectstack dev`): after a federated object
 * was saved at runtime on `showcase_external`, `POST …/external/validate`
 * still answered the two code-defined objects only, and listed the saved one
 * after a restart.
 *
 * ## What each case pins
 *
 *  - an object saved at runtime is listed AND judged on its live definition by
 *    the per-datasource validate and by the boot gate's sweep, with no restart;
 *    the code-defined object is still listed;
 *  - an object re-saved at runtime is judged on what was saved, not on the
 *    copy taken at boot;
 *  - the registry is asked for when validation runs, not at `init()`;
 *  - the metadata service's boot copy is never read for objects, so no second
 *    source can answer.
 *
 * The fakes model the measured mechanism: `metadata` holds the boot copy, the
 * `objectql` registry is live, and a "runtime save" writes only the registry.
 * The plugin is imported through a RELATIVE specifier, so these cases measure
 * `src/` and need no build. The booted-stack half is the dogfood pin's
 * (`packages/qa/dogfood/test/external-validate-sees-runtime-save.dogfood.test.ts`).
 */

import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import type { IntrospectedSchema } from '@objectstack/spec/contracts';
import { ExternalDatasourceServicePlugin } from '../plugin.js';
import type { ExternalDatasourceService, ObjectLike } from '../external-datasource-service.js';

const remoteSchema = (): IntrospectedSchema =>
  ({
    dialect: 'sqlite',
    tables: {
      customers: {
        name: 'customers',
        indexes: [],
        columns: [
          { name: 'id', type: 'text', nullable: false, primaryKey: true },
          { name: 'name', type: 'text', nullable: true, primaryKey: false },
          { name: 'email', type: 'text', nullable: true, primaryKey: false },
        ],
      },
    },
  }) as unknown as IntrospectedSchema;

const federated = (name: string, fields: string[]): ObjectLike => ({
  name,
  datasource: 'warehouse',
  external: { remoteName: 'customers' },
  fields: Object.fromEntries(fields.map((f) => [f, { type: 'text' }])),
});

/** Defined in code: in the registry and in the boot copy alike. */
const CODE = federated('code_cust', ['name', 'email']);
/** Saved at runtime: the remote has no `loyalty_tier`, so a real comparison reports it. */
const SAVED = federated('saved_cust', ['name', 'loyalty_tier']);
const LOYALTY_MISSING = { kind: 'missing_column', remoteName: 'customers', column: 'loyalty_tier', severity: 'error' };

interface Harness {
  ctx: PluginContext;
  services: Map<string, unknown>;
  /** The engine's object registry — what a runtime save writes through to. */
  live: Map<string, ObjectLike>;
  /** The metadata service's object reads, over the copy it took at boot. */
  bootCopyReads: { getObject: ReturnType<typeof vi.fn>; listObjects: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> };
}

/** A kernel context whose `getService` throws on an unregistered name, as the kernel's does. */
function harness(opts: { registry?: boolean } = {}): Harness {
  const services = new Map<string, unknown>();
  const live = new Map<string, ObjectLike>([[CODE.name, CODE]]);
  const bootCopy = [CODE];
  const bootCopyReads = {
    getObject: vi.fn(async (n: string) => bootCopy.find((o) => o.name === n)),
    listObjects: vi.fn(async () => bootCopy),
    list: vi.fn(async () => bootCopy),
  };
  services.set('data', { introspectDatasource: async () => remoteSchema() });
  services.set('metadata', {
    get: async (type: string, name: string) =>
      type === 'datasource' && name === 'warehouse' ? { name, schemaMode: 'external' } : undefined,
    ...bootCopyReads,
  });
  if (opts.registry !== false) services.set('objectql', engineOver(live));
  const ctx = {
    getService: (name: string) => {
      if (!services.has(name)) throw new Error(`Service '${name}' not found`);
      return services.get(name);
    },
    registerService: (name: string, service: unknown) => {
      services.set(name, service);
    },
    trigger: async () => undefined,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  } as unknown as PluginContext;
  return { ctx, services, live, bootCopyReads };
}

function engineOver(live: Map<string, ObjectLike>) {
  return {
    registry: {
      getObject: (n: string) => live.get(n),
      getAllObjects: () => [...live.values()],
    },
  };
}

async function federation(h: Harness): Promise<ExternalDatasourceService> {
  await new ExternalDatasourceServicePlugin().init(h.ctx);
  return h.services.get('external-datasource') as ExternalDatasourceService;
}

const byObject = (a: { object: string }, b: { object: string }) => a.object.localeCompare(b.object);

describe('federated validation reads the live object registry (#21842)', () => {
  it('an object saved at runtime is listed and judged on its definition, with no restart; the code-defined object is still listed', async () => {
    const h = harness();
    const svc = await federation(h);

    h.live.set(SAVED.name, SAVED); // the save's write-through; the boot copy is untouched

    const expected = [
      { ok: true, datasource: 'warehouse', object: 'code_cust', diffs: [] },
      { ok: false, datasource: 'warehouse', object: 'saved_cust', diffs: [LOYALTY_MISSING] },
    ];
    const scoped = await svc.validateDatasource('warehouse');
    expect(scoped.ok).toBe(false);
    expect([...scoped.results].sort(byObject)).toEqual(expected);
    // The boot gate's sweep reads the same population.
    const sweep = await svc.validateAll();
    expect([...sweep.results].sort(byObject)).toEqual(expected);
  });

  it('an object re-saved at runtime is judged on what was saved, not on the copy taken at boot', async () => {
    const h = harness();
    const svc = await federation(h);

    h.live.set(CODE.name, federated(CODE.name, ['name', 'email', 'loyalty_tier']));

    expect(await svc.validateObject(CODE.name)).toEqual({
      ok: false,
      datasource: 'warehouse',
      object: 'code_cust',
      diffs: [LOYALTY_MISSING],
    });
    expect((await svc.validateDatasource('warehouse')).results).toEqual([
      { ok: false, datasource: 'warehouse', object: 'code_cust', diffs: [LOYALTY_MISSING] },
    ]);
  });

  it('asks for the registry when validation runs, so an engine registered after init is read', async () => {
    const h = harness({ registry: false });
    const svc = await federation(h);
    h.live.set(SAVED.name, SAVED);
    h.services.set('objectql', engineOver(h.live));

    const report = await svc.validateDatasource('warehouse');

    expect(report.results.map((r) => r.object).sort()).toEqual(['code_cust', 'saved_cust']);
  });

  it('never reads objects from the metadata service\'s boot copy', async () => {
    const h = harness();
    const svc = await federation(h);
    h.live.set(SAVED.name, SAVED);

    await svc.validateAll();
    await svc.validateDatasource('warehouse');
    await svc.validateObject(SAVED.name);

    expect(h.bootCopyReads.listObjects).not.toHaveBeenCalled();
    expect(h.bootCopyReads.list).not.toHaveBeenCalled();
    expect(h.bootCopyReads.getObject).not.toHaveBeenCalled();
  });
});
