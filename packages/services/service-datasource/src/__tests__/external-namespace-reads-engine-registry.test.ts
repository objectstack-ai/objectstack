// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21889] The federation service reads a datasource's ADR-0028 namespace from
 * the engine registry's package record, the store the publish gate reads.
 *
 * ## The defect this pins closed
 *
 * `getNamespace` took the datasource's stamped `_packageId` and then asked the
 * `'metadata'` service for a `package` item under that id. No composition
 * writes package records into the metadata service: they live in the engine's
 * registry (`installPackage`, reached through `registerApp`), which is where
 * the publish gate reads the namespace for the identical check
 * (`publishPackageDrafts`, `@objectstack/metadata-protocol`). So the lookup
 * missed on every composition measured, and the import door and the draft
 * door never applied the prefix. This file's earlier sibling seeded a
 * `package` map into its metadata fake, a store no real composition fills,
 * and stayed green through the defect.
 *
 * ## What each case pins
 *
 *  - the draft's name carries the namespace of the package the registry holds
 *    under the datasource's `_packageId`, and its source carries no
 *    `TODO(namespace)` note;
 *  - an import whose explicit name breaks that namespace is refused with
 *    ADR-0028's own message, before any save; a prefixed one is saved;
 *  - the engine is asked when it is used, so an `'objectql'` service registered
 *    after `init()` answers, and one registered before answers the same;
 *  - ⛔ one store, one id: a `package` item in the metadata service is never
 *    read, a datasource with no `_packageId` (or the `'sys_metadata'` sentinel)
 *    resolves nothing however many packages the registry holds, and a package
 *    that declares no namespace resolves nothing.
 *
 * The plugin is imported through a RELATIVE specifier, so these cases measure
 * `src/` and need no build. The booted-stack half (the showcase's code-defined
 * `showcase_external`) is the dogfood pin's.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import type { IntrospectedSchema, IExternalDatasourceService } from '@objectstack/spec/contracts';
import { validateObjectNamespacePrefix } from '@objectstack/spec/kernel';
import { ExternalDatasourceServicePlugin } from '../plugin.js';

const remoteSchema = (): IntrospectedSchema =>
  ({
    dialect: 'sqlite',
    tables: {
      customers: {
        name: 'customers',
        columns: [
          { name: 'id', type: 'text', nullable: false, primaryKey: true },
          { name: 'name', type: 'text', nullable: true, primaryKey: false },
        ],
      },
    },
  }) as unknown as IntrospectedSchema;

const PACKAGE_ID = 'com.acme.warehouse';

/** A datasource as `AppPlugin` registers a code-defined one: stamped with its package. */
const stamped = (extra: Record<string, unknown> = {}) => ({
  name: 'warehouse',
  schemaMode: 'external',
  origin: 'code',
  _packageId: PACKAGE_ID,
  _packageVersion: '1.0.0',
  _provenance: 'package',
  ...extra,
});

/**
 * A metadata service holding one datasource and, deliberately, a `package`
 * item under the same id with a DIFFERENT namespace — so a reader that still
 * asked it would answer `meta_customers` and be told apart.
 */
function metadataService(datasource: Record<string, unknown>) {
  const store = new Map<string, Map<string, unknown>>([
    ['datasource', new Map([['warehouse', datasource]])],
    ['package', new Map([[PACKAGE_ID, { manifest: { id: PACKAGE_ID, namespace: 'meta' } }]])],
  ]);
  return { get: async (type: string, name: string) => store.get(type)?.get(name) };
}

/** The engine on the `'objectql'` slot: its registry's package records, keyed as `installPackage` keys them. */
function engine(packages: Record<string, { manifest: Record<string, unknown> }>) {
  const getPackage = vi.fn((id: string) => packages[id]);
  return { service: { registry: { getPackage } }, getPackage };
}

const WAREHOUSE = { [PACKAGE_ID]: { manifest: { id: PACKAGE_ID, namespace: 'wh' } } };

function harness() {
  const services = new Map<string, unknown>();
  services.set('data', { introspectDatasource: vi.fn(async () => remoteSchema()) });
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
  return { ctx, services };
}

async function federation(h: ReturnType<typeof harness>): Promise<IExternalDatasourceService> {
  await new ExternalDatasourceServicePlugin().init(h.ctx);
  return h.services.get('external-datasource') as IExternalDatasourceService;
}

/** The `objectstack start` ordering: the plugin inits, then the services it reads arrive. */
async function startOrdering(opts: {
  datasource?: Record<string, unknown>;
  packages?: Record<string, { manifest: Record<string, unknown> }>;
} = {}) {
  const h = harness();
  const service = await federation(h);
  const ql = engine(opts.packages ?? WAREHOUSE);
  h.services.set('metadata', metadataService(opts.datasource ?? stamped()));
  h.services.set('objectql', ql.service);
  return { h, service, getPackage: ql.getPackage };
}

describe('the namespace comes from the engine registry\'s package record', () => {
  it('the draft\'s name carries it, and the draft carries no TODO(namespace) note', async () => {
    const { service, getPackage } = await startOrdering();

    const draft = await service.generateObjectDraft('warehouse', 'customers');

    expect(draft.name).toBe('wh_customers');
    expect(draft.source).not.toContain('TODO(namespace)');
    expect(getPackage).toHaveBeenCalledWith(PACKAGE_ID);
  });

  it('an explicit import name without the prefix is refused with ADR-0028\'s message, and nothing is saved', async () => {
    const { h, service } = await startOrdering();
    const saveMetaItem = vi.fn(async () => ({ success: true }));
    h.services.set('protocol', { saveMetaItem });

    const outcome = await service
      .importObject('warehouse', 'customers', { name: 'ext_customers' })
      .catch((e: unknown) => e);

    expect(outcome).toMatchObject({ code: 'EXTERNAL_IMPORT_ERROR', status: 400 });
    // ADR-0028's message is the shared validator's own (the one `defineStack()`
    // and the publish gate raise), and it names the prefixed name to use.
    expect((outcome as Error).message).toBe(validateObjectNamespacePrefix('ext_customers', 'wh'));
    expect((outcome as Error).message).toContain("'wh_ext_customers'");
    expect(saveMetaItem).not.toHaveBeenCalled();
  });

  it('control: a prefixed import name is saved under that name', async () => {
    const { h, service } = await startOrdering();
    const saveMetaItem = vi.fn(async () => ({ success: true }));
    h.services.set('protocol', { saveMetaItem });

    const result = await service.importObject('warehouse', 'customers', { name: 'wh_ext_customers' });

    expect(result.name).toBe('wh_ext_customers');
    expect(saveMetaItem).toHaveBeenCalledWith(expect.objectContaining({ type: 'object', name: 'wh_ext_customers' }));
  });

  it('control: an import with no name override saves the prefixed name the draft derives', async () => {
    const { h, service } = await startOrdering();
    const saveMetaItem = vi.fn(async () => ({ success: true }));
    h.services.set('protocol', { saveMetaItem });

    const result = await service.importObject('warehouse', 'customers');

    expect(result.name).toBe('wh_customers');
    expect(saveMetaItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'wh_customers' }));
  });

  it('an engine registered before init (the dev ordering) gives the same answer', async () => {
    const h = harness();
    h.services.set('metadata', metadataService(stamped()));
    h.services.set('objectql', engine(WAREHOUSE).service);
    const service = await federation(h);

    expect((await service.generateObjectDraft('warehouse', 'customers')).name).toBe('wh_customers');
  });

  it('the engine is asked at each use: one registered after the first draft is the one read', async () => {
    const { h, service } = await startOrdering();
    expect((await service.generateObjectDraft('warehouse', 'customers')).name).toBe('wh_customers');

    h.services.set('objectql', engine({ [PACKAGE_ID]: { manifest: { id: PACKAGE_ID, namespace: 'whx' } } }).service);

    expect((await service.generateObjectDraft('warehouse', 'customers')).name).toBe('whx_customers');
  });
});

describe('⛔ one store, one id: nothing else resolves a namespace', () => {
  it('a `package` item in the metadata service is never read: with no registry record the name is bare', async () => {
    const { service } = await startOrdering({ packages: {} });

    const draft = await service.generateObjectDraft('warehouse', 'customers');

    // The metadata fake holds `namespace: 'meta'` under the same id.
    expect(draft.name).toBe('customers');
    expect(draft.source).toContain('TODO(namespace)');
  });

  it('a datasource with no `_packageId` resolves nothing, however many packages the registry holds', async () => {
    const { service, getPackage } = await startOrdering({
      datasource: { name: 'warehouse', schemaMode: 'external', origin: 'runtime' },
    });

    expect((await service.generateObjectDraft('warehouse', 'customers')).name).toBe('customers');
    expect(getPackage).not.toHaveBeenCalled();
  });

  it('the `sys_metadata` rehydration sentinel is not a package', async () => {
    const { service, getPackage } = await startOrdering({
      datasource: stamped({ _packageId: 'sys_metadata' }),
      packages: { sys_metadata: { manifest: { id: 'sys_metadata', namespace: 'sys' } } },
    });

    expect((await service.generateObjectDraft('warehouse', 'customers')).name).toBe('customers');
    expect(getPackage).not.toHaveBeenCalled();
  });

  it('a package that declares no namespace resolves nothing, and an unprefixed import name is accepted', async () => {
    const { h, service } = await startOrdering({ packages: { [PACKAGE_ID]: { manifest: { id: PACKAGE_ID } } } });
    const saveMetaItem = vi.fn(async () => ({ success: true }));
    h.services.set('protocol', { saveMetaItem });

    expect((await service.generateObjectDraft('warehouse', 'customers')).name).toBe('customers');
    expect((await service.importObject('warehouse', 'customers', { name: 'ext_customers' })).name).toBe('ext_customers');
  });

  it('with no `objectql` service at all, the draft keeps its documented fallback: a bare name and the TODO', async () => {
    const h = harness();
    const service = await federation(h);
    h.services.set('metadata', metadataService(stamped()));

    const draft = await service.generateObjectDraft('warehouse', 'customers');

    expect(draft.name).toBe('customers');
    expect(draft.source).toContain('TODO(namespace)');
  });
});
