// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

/**
 * ADR-0033 package-subsystem consolidation — `protocol.installPackage` is the
 * single canonical write primitive. It must land a package in BOTH the
 * in-memory registry (what the dispatcher's `/api/v1/packages` and
 * `getMetaItems({type:'package'})` read → Studio's selector) AND the durable
 * `sys_packages` table via the optional `package` service.
 */
function makeProtocol(opts: { pkgSvc?: unknown } = {}) {
  const installed: Array<{ manifest: { id: string } }> = [];
  // Namespace owners, as `SchemaRegistry.registerNamespace` keeps them: the
  // real `installPackage` registers `manifest.namespace` → `manifest.id`.
  const namespaces = new Map<string, Set<string>>();
  const registry = {
    installPackage: vi.fn((manifest: { id: string; namespace?: string }) => {
      const pkg = { manifest, status: 'installed', enabled: true };
      installed.push(pkg);
      if (manifest.namespace) {
        const owners = namespaces.get(manifest.namespace) ?? new Set<string>();
        owners.add(manifest.id);
        namespaces.set(manifest.namespace, owners);
      }
      return pkg;
    }),
    getPackage: vi.fn((id: string) => installed.find((p) => p.manifest.id === id)),
    // [#21243] The verbs a failed persist's undo calls, with the real
    // `SchemaRegistry`'s behaviour (`packages/objectql/src/registry.ts`).
    unregisterItem: vi.fn((type: string, name: string) => {
      if (type !== 'package') return;
      const at = installed.findIndex((p) => p.manifest.id === name);
      if (at >= 0) installed.splice(at, 1);
    }),
    getNamespaceOwners: vi.fn((namespace: string) => [...(namespaces.get(namespace) ?? [])]),
    unregisterNamespace: vi.fn((namespace: string, packageId: string) => {
      const owners = namespaces.get(namespace);
      owners?.delete(packageId);
      if (owners?.size === 0) namespaces.delete(namespace);
    }),
  };
  const engine = { registry } as never;
  const services = new Map<string, unknown>();
  if (opts.pkgSvc) services.set('package', opts.pkgSvc);
  const protocol = new ObjectStackProtocolImplementation(engine, () => services);
  return { protocol, registry };
}

describe('protocol.installPackage (ADR-0033 consolidation)', () => {
  it('writes the in-memory registry AND persists via the package service', async () => {
    const publish = vi.fn(async () => ({ success: true }));
    const { protocol, registry } = makeProtocol({ pkgSvc: { publish } });
    const manifest = { id: 'app.demo', name: 'Demo', version: '1.0.0', type: 'application' };

    const res = (await protocol.installPackage({ manifest } as never)) as {
      package: { manifest: { id: string } };
      message: string;
    };

    // The registry + durable row receive the manifest with a namespace derived
    // from the id (`app.demo` → `demo`) since none was declared (see below).
    expect(registry.installPackage).toHaveBeenCalledWith(
      { ...manifest, namespace: 'demo' },
      undefined,
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect((publish.mock.calls[0] as unknown[])[0]).toMatchObject({
      manifest: { ...manifest, namespace: 'demo' },
    });
    expect(res.package.manifest.id).toBe('app.demo');
    expect(res.message).toContain('app.demo');
  });

  it('derives + persists a namespace from the id when the manifest declares none', async () => {
    const { protocol, registry } = makeProtocol();
    const manifest = { id: 'com.example.leave', name: 'Leave', version: '1.0.0', type: 'application' };
    await protocol.installPackage({ manifest } as never);
    // `com.example.leave` → namespace `leave` (last dot-segment).
    expect((registry.installPackage.mock.calls[0][0] as any).namespace).toBe('leave');
  });

  it('does NOT override an explicitly declared namespace', async () => {
    const { protocol, registry } = makeProtocol();
    // HotCRM ships namespace `crm`, which differs from the id last segment.
    const manifest = { id: 'app.objectstack.hotcrm', name: 'HotCRM', version: '1.0.0', type: 'application', namespace: 'crm' };
    await protocol.installPackage({ manifest } as never);
    expect((registry.installPackage.mock.calls[0][0] as any).namespace).toBe('crm');
  });

  it('forwards install-time settings to the registry', async () => {
    const { protocol, registry } = makeProtocol();
    const manifest = { id: 'app.s', name: 'S', version: '1.0.0', type: 'application' };
    await protocol.installPackage({ manifest, settings: { theme: 'dark' } } as never);
    expect(registry.installPackage).toHaveBeenCalledWith(manifest, { theme: 'dark' });
  });

  it('still registers in-memory when no package service is present (non-fatal)', async () => {
    const { protocol, registry } = makeProtocol();
    const manifest = { id: 'app.nopkg', name: 'NoPkg', version: '1.0.0', type: 'application' };

    const res = (await protocol.installPackage({ manifest } as never)) as {
      package: { manifest: { id: string } };
    };

    expect(registry.installPackage).toHaveBeenCalledOnce();
    expect(res.package.manifest.id).toBe('app.nopkg');
  });

  // [#21243] Inverted from "does not throw and keeps the registry write when
  // persistence rejects". That answer was success over a write that never
  // landed — on MySQL every install answered 201 and was gone after a restart.
  // Triage's ruling (both halves): the failure is ANSWERED, and the registry
  // write is UNDONE, so the process never holds a package the store does not.
  it('rejects with a 500 and undoes the registry write when persistence rejects', async () => {
    const dbDown = new Error('db down');
    const publish = vi.fn(async () => {
      throw dbDown;
    });
    const { protocol, registry } = makeProtocol({ pkgSvc: { publish } });
    const manifest = { id: 'app.err', name: 'Err', version: '1.0.0', type: 'application' };

    let thrown: unknown;
    try {
      await protocol.installPackage({ manifest } as never);
    } catch (e) {
      thrown = e;
    }

    // ① Answered: a 500 the door serves, with the store's own error kept on
    // `cause` for the operator and out of the caller's sentence.
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as { status?: unknown }).status).toBe(500);
    expect((thrown as { cause?: unknown }).cause).toBe(dbDown);
    expect((thrown as Error).message).not.toContain('db down');
    // ② Undone: the install DID write the registry, and that write is withdrawn
    // — row and derived namespace (`app.err` → `err`) both.
    expect(registry.installPackage).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    expect(registry.unregisterItem).toHaveBeenCalledWith('package', 'app.err');
    expect(registry.getPackage('app.err')).toBeUndefined();
    expect(registry.getNamespaceOwners('err')).toEqual([]);
  });

  it('persists a versionless manifest with a defaulted version (#2540: base packages must survive restart)', async () => {
    // Builder/Setup create base packages as bare { id, name } with no version.
    // Pre-#2540 these were skipped for persistence and vanished on restart (#2532).
    // Now installPackage defaults version to '0.1.0' so they key into sys_packages.
    const publish = vi.fn(async () => ({ success: true }));
    const { protocol, registry } = makeProtocol({ pkgSvc: { publish } });
    const manifest = { id: 'app.nov', name: 'NoVer', type: 'application' };

    await protocol.installPackage({ manifest } as never);

    expect(registry.installPackage).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledTimes(1);
    expect((publish.mock.calls[0] as unknown[])[0]).toMatchObject({
      manifest: { id: 'app.nov', version: '0.1.0' },
    });
  });
});
