// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `installPackage` stores a RECORD, never the caller's live object.
 *
 * ## What was wrong
 *
 * `installPackage(manifest)` kept the argument verbatim as `pkg.manifest`. For a
 * code-defined stack that argument is the live `defineStack()` object, and its
 * `plugins: [new ConnectorRestPlugin(), …]` entries hold the engine once they
 * initialise. Since the engine grew `actionActivation -> store -> engine` that
 * reference closes a CYCLE, so `JSON.stringify` of the registry item threw and
 * every read door that serialises a package answered `500 INTERNAL_ERROR` on a
 * stock showcase boot — `GET /packages`, `GET /packages/:id`,
 * `GET /meta/package/:id`, while `GET /meta/package/<a plugin-less package>`
 * stayed 200.
 *
 * ## Why the assertions are shaped this way
 *
 * ⚠️ "the manifest still round-trips" passes on the old code for every package
 * that has no plugins, which is 25 of the 26 a showcase boot installs. So the
 * cases below pin the MECHANISM: a live instance reaching the record, a plain
 * reference cycle, and a member that is not data at all — each asserted on
 * `JSON.stringify(registry.getPackage(id))`, the exact expression the doors run.
 *
 * ⚠️ Timing is part of the defect and is pinned too. Measured on the failing
 * boot: the same showcase manifest serialised CLEANLY during boot and only
 * became cyclic after plugin init, so a check that ran at install time would
 * have called the record healthy. The `becomes cyclic only after init` case
 * below reproduces that ordering — the projection must not depend on when it is
 * asked.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from './registry';

/**
 * A plugin instance in the shape that broke: a class instance the host
 * constructs in `objectstack.config.ts` and hands to `defineStack({ plugins })`,
 * which takes the engine when it initialises.
 */
class FakeConnectorPlugin {
  name = 'connector-rest';
  engine: unknown;
  init(engine: unknown) {
    this.engine = engine;
  }
}

/** The engine's own `actionActivation -> store -> engine` cycle, reproduced. */
function makeCyclicEngine(): Record<string, unknown> {
  const engine: Record<string, unknown> = { name: '_ObjectQL' };
  const store: Record<string, unknown> = { name: 'ObjectStoreActionActivationStore', engine };
  engine.actionActivation = { name: 'ActionActivationProjection', store };
  return engine;
}

function baseManifest(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'com.example.showcase',
    name: 'Showcase',
    namespace: 'showcase',
    version: '1.2.3',
    type: 'app',
    scope: 'user',
    description: 'Kitchen-sink example',
    dependencies: ['com.objectstack.plugin-auth'],
    objects: [{ name: 'invoice', fields: { total: { type: 'currency' } } }],
    apps: [{ name: 'showcase', label: 'Showcase' }],
    ...overrides,
  };
}

describe('SchemaRegistry.installPackage — the record is serializable', () => {
  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    registry.logLevel = 'silent';
  });

  it('survives a plugin instance that closes a cycle through the engine', () => {
    const plugin = new FakeConnectorPlugin();
    plugin.init(makeCyclicEngine());
    registry.installPackage(baseManifest({ plugins: [plugin] }));

    // The expression every read door runs.
    expect(() => JSON.stringify(registry.getPackage('com.example.showcase'))).not.toThrow();
    // The instance itself is gone from the record — this is a projection, not a
    // replacement value that still points at the engine.
    expect(JSON.stringify(registry.getPackage('com.example.showcase'))).not.toContain('_ObjectQL');
  });

  it('survives a manifest that becomes cyclic only AFTER install', () => {
    // The measured ordering: at install the plugin holds no engine and the
    // manifest serialises fine; the cycle appears when the plugin initialises.
    // A projection taken at install must still hold, because it copied out of
    // the live object rather than aliasing it.
    const plugin = new FakeConnectorPlugin();
    const manifest = baseManifest({ plugins: [plugin] });
    expect(() => JSON.stringify(manifest)).not.toThrow();

    registry.installPackage(manifest);
    plugin.init(makeCyclicEngine());

    expect(() => JSON.stringify(registry.getPackage('com.example.showcase'))).not.toThrow();
  });

  it('survives a reference cycle among PLAIN data in the manifest', () => {
    const cyclic: Record<string, unknown> = { name: 'self' };
    cyclic.self = cyclic;
    registry.installPackage(baseManifest({ data: { node: cyclic } }));

    const record = registry.getPackage('com.example.showcase')!;
    expect(() => JSON.stringify(record)).not.toThrow();
    // The back-edge is dropped; everything ahead of it survives.
    expect((record.manifest as any).data.node.name).toBe('self');
    expect((record.manifest as any).data.node.self).toBeUndefined();
  });

  it('keeps the declarative half of the manifest byte-for-byte', () => {
    const manifest = baseManifest({ plugins: [new FakeConnectorPlugin()] });
    registry.installPackage(manifest);
    const stored = registry.getPackage('com.example.showcase')!.manifest as any;

    for (const key of [
      'id', 'name', 'namespace', 'version', 'type', 'scope', 'description',
      'dependencies', 'objects', 'apps',
    ]) {
      expect(stored[key]).toEqual((manifest as any)[key]);
    }
  });

  it('drops members that are not data, and keeps a Date as data', () => {
    const publishedAt = new Date('2026-09-02T00:00:00.000Z');
    registry.installPackage(baseManifest({
      onEnable: () => undefined,
      registryHandle: new Map([['a', 1]]),
      publishedAt,
    }));
    const stored = registry.getPackage('com.example.showcase')!.manifest as any;

    expect(stored.onEnable).toBeUndefined();
    expect(stored.registryHandle).toBeUndefined();
    expect(new Date(stored.publishedAt).toISOString()).toBe(publishedAt.toISOString());
  });

  it('does not mutate the caller’s manifest — the kernel keeps the live object', () => {
    // `ObjectQL.registerApp` reads `manifest.plugins[]` from ITS OWN parameter
    // to register nested plugins, and hands the same object to `installPackage`.
    // Projecting must therefore copy, never strip in place.
    const plugin = new FakeConnectorPlugin();
    const manifest = baseManifest({ plugins: [plugin] });
    registry.installPackage(manifest);

    expect(manifest.plugins).toHaveLength(1);
    expect(manifest.plugins[0]).toBe(plugin);
    expect(registry.getPackage('com.example.showcase')!.manifest).not.toBe(manifest);
  });

  it('projects on REINSTALL too (rebuild / HMR overwrite)', () => {
    registry.installPackage(baseManifest());
    const plugin = new FakeConnectorPlugin();
    plugin.init(makeCyclicEngine());
    registry.installPackage(baseManifest({ plugins: [plugin] }));

    expect(() => JSON.stringify(registry.getPackage('com.example.showcase'))).not.toThrow();
  });

  it('keeps the whole LIST serializable when one package carries the cycle', () => {
    // The list door's failure mode: one unserializable item took out every
    // caller's whole listing, not just the offending package.
    const plugin = new FakeConnectorPlugin();
    plugin.init(makeCyclicEngine());
    registry.installPackage(baseManifest({ plugins: [plugin] }));
    registry.installPackage({
      id: 'com.objectstack.setup', name: 'Setup', namespace: 'setup', version: '9.3.0',
    } as any);

    expect(() => JSON.stringify(registry.getAllPackages())).not.toThrow();
    expect(registry.getAllPackages()).toHaveLength(2);
  });

  it('still records the namespace and the lifecycle state it always did', () => {
    // The projection must not cost the record its non-manifest half.
    registry.installPackage(baseManifest({ plugins: [new FakeConnectorPlugin()] }));
    const record = registry.getPackage('com.example.showcase')!;

    expect(record.status).toBe('installed');
    expect(record.enabled).toBe(true);
    expect(typeof record.installedAt).toBe('string');
    expect(registry.getNamespaceOwners('showcase')).toEqual(['com.example.showcase']);
  });
});
