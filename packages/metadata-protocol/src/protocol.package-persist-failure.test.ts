// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21243 — a package write the store refused is never answered as success.
 *
 * ## The defect
 *
 * `installPackage` and `updatePackage` write two stores: the in-memory
 * registry, then `sys_packages` through the `package` service. Both caught the
 * second write's failure — returned `{ success: false }` or thrown — logged it
 * with `console.warn`, and answered success over the registry row. On MySQL,
 * where `sys_packages` was never created, every `POST /api/v1/packages`
 * answered 201 and every `PATCH /api/v1/packages/:id` answered 200, and after
 * the next restart `GET /api/v1/packages/:id` answered 404.
 *
 * ## The contract pinned here (triage's ruling: both halves, not one)
 *
 *  1. The failure is ANSWERED — a thrown error with the status and code the
 *     dispatcher door reads (`resolveThrownHttpError`, the one rule every
 *     door applies), never a success body.
 *  2. The registry write is UNDONE — after the throw the process holds no
 *     package the store does not: a fresh install leaves nothing, a
 *     re-install leaves the prior row, an edit leaves the prior manifest.
 *
 * Both failure channels of `publish` are driven, because the service has two:
 * RETURNED `{ success: false, driverFault }` (an undeclared driver fault the
 * service swallowed) and THROWN (a failure that declared its own answer —
 * what a live SQL driver's refused raw statement is, `500 DATABASE_ERROR`).
 *
 * ## The registry double
 *
 * This package cannot depend on `@objectstack/objectql` (it is the other way
 * round), so the registry is a double. It mirrors the real `SchemaRegistry`
 * verbs BY NAME and by the behaviour this contract leans on
 * (`packages/objectql/src/registry.ts`): `installPackage` builds a NEW row
 * object, keeps an existing row's lifecycle fields and registers the
 * namespace; `updatePackageManifest` edits the row and its manifest IN PLACE;
 * `enablePackage` / `disablePackage` move the lifecycle fields;
 * `unregisterItem('package', id)` withdraws the row; the namespace verbs keep
 * a set of owners per namespace.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectStackProtocolImplementation } from './index.js';

interface Row {
  manifest: Record<string, unknown>;
  status: string;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
  settings?: unknown;
}

function makeRegistry() {
  const rows = new Map<string, Row>();
  const namespaces = new Map<string, Set<string>>();
  let tick = 0;
  const stamp = () => `2026-10-01T00:00:${String(tick++).padStart(2, '0')}.000Z`;
  return {
    rows,
    namespaces,
    installPackage(manifest: any, settings?: unknown): Row {
      const existing = rows.get(manifest.id);
      const row: Row = {
        manifest: { ...manifest },
        status: existing?.status ?? 'installed',
        enabled: existing?.enabled ?? true,
        installedAt: stamp(),
        updatedAt: stamp(),
        settings,
      };
      if (manifest.namespace) this.registerNamespace(manifest.namespace, manifest.id);
      rows.set(manifest.id, row);
      return row;
    },
    getPackage: (id: string) => rows.get(id),
    getAllPackages: () => [...rows.values()],
    updatePackageManifest(id: string, patch: Record<string, unknown>) {
      const row = rows.get(id);
      if (!row) return undefined;
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) row.manifest[k] = v;
      row.updatedAt = stamp();
      return row;
    },
    enablePackage(id: string) {
      const row = rows.get(id);
      if (row) Object.assign(row, { enabled: true, status: 'installed', updatedAt: stamp() });
      return row;
    },
    disablePackage(id: string) {
      const row = rows.get(id);
      if (row) Object.assign(row, { enabled: false, status: 'disabled', updatedAt: stamp() });
      return row;
    },
    unregisterItem(type: string, name: string) {
      if (type === 'package') rows.delete(name);
    },
    registerNamespace(ns: string, id: string) {
      const owners = namespaces.get(ns) ?? new Set<string>();
      owners.add(id);
      namespaces.set(ns, owners);
    },
    unregisterNamespace(ns: string, id: string) {
      const owners = namespaces.get(ns);
      owners?.delete(id);
      if (owners?.size === 0) namespaces.delete(ns);
    },
    getNamespaceOwners: (ns: string) => [...(namespaces.get(ns) ?? [])],
  };
}

function makeImpl(publish: (d: { manifest: any; metadata: unknown }) => Promise<unknown>) {
  const registry = makeRegistry();
  const publishSpy = vi.fn(publish);
  const services = new Map<string, unknown>([['package', { publish: publishSpy, delete: async () => ({ success: true }) }]]);
  const impl = new ObjectStackProtocolImplementation({ registry, find: async () => [] } as any, () => services as any);
  return { impl: impl as any, registry, publish: publishSpy };
}

/** The service's RETURNED channel: the INSERT broke, nothing declared (`PackagePublishResult`). */
const returnedDriverFault = async () => ({
  success: false,
  driverFault: { message: 'The package registry could not store this package.' },
});

/** The THROWN channel, shaped as a live SQL driver's refused raw statement (`rawStatementFaultError`). */
const DRIVER_LINE = "Table 'os.sys_packages' doesn't exist";
const thrownDatabaseError = async () => {
  throw Object.assign(new Error('The database refused to run a raw statement.'), {
    code: 'DATABASE_ERROR',
    status: 500,
    cause: new Error(DRIVER_LINE),
  });
};

/** What the dispatcher door answers for a thrown value (`errorFromThrown` → `resolveThrownHttpError`). */
const door = (e: unknown) => {
  const r = resolveThrownHttpError(e, 500);
  return { status: r.status, code: r.code, message: r.message };
};

async function rejectionOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected the call to reject, and it resolved');
}

describe('#21243 installPackage — a refused sys_packages write fails the install and registers nothing', () => {
  it.each([
    ['returned driverFault', 'INTERNAL_ERROR', returnedDriverFault],
    ['thrown DATABASE_ERROR', 'DATABASE_ERROR', thrownDatabaseError],
  ] as const)('fresh id, %s → 500 %s, no row, no namespace', async (_label, code, publish) => {
    const { impl, registry } = makeImpl(publish);

    const err = await rejectionOf(impl.installPackage({ manifest: { id: 'com.example.leave', name: 'Leave' } }));

    expect(door(err)).toMatchObject({ status: 500, code });
    // The driver's words stay on `cause` for the operator, never in the caller's sentence.
    expect(door(err).message).not.toContain(DRIVER_LINE);
    expect((err as { cause?: unknown }).cause).toBeDefined();
    // The undo half: nothing in this process claims the package.
    expect(registry.getPackage('com.example.leave')).toBeUndefined();
    // The namespace this install derived (`leave`) is released with it.
    expect(registry.getNamespaceOwners('leave')).toEqual([]);
  });

  it('a re-install over an existing row puts the PRIOR row back, lifecycle included', async () => {
    const { impl, registry } = makeImpl(returnedDriverFault);
    const prior = registry.installPackage({ id: 'com.example.leave', name: 'Leave v1', version: '1.0.0', namespace: 'leave' });
    registry.disablePackage('com.example.leave');
    const priorContent = JSON.parse(JSON.stringify(registry.getPackage('com.example.leave')));

    const err = await rejectionOf(impl.installPackage({
      manifest: { id: 'com.example.leave', name: 'Leave v2', version: '2.0.0', namespace: 'leave' },
      enableOnInstall: true,
    }));

    expect(door(err)).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    // Content, not identity: the registry keeps the row object it now holds.
    expect(JSON.parse(JSON.stringify(registry.getPackage('com.example.leave')))).toEqual(priorContent);
    expect(registry.getPackage('com.example.leave')?.manifest.name).toBe('Leave v1');
    expect(registry.getPackage('com.example.leave')?.enabled).toBe(false);
    // The namespace the id already owned stays owned.
    expect(registry.getNamespaceOwners('leave')).toEqual(['com.example.leave']);
    expect(prior.manifest.name).toBe('Leave v1');
  });

  it('a declared 4xx refusal from the store leaves as the producer answered it, and is still undone', async () => {
    const refusal = Object.assign(new Error('Refused by the platform.'), { code: 'DESTRUCTIVE_CHANGE', status: 409 });
    const { impl, registry } = makeImpl(async () => {
      throw refusal;
    });

    const err = await rejectionOf(impl.installPackage({ manifest: { id: 'com.example.leave' } }));

    expect(err).toBe(refusal);
    expect(door(err)).toMatchObject({ status: 409, code: 'DESTRUCTIVE_CHANGE' });
    expect(registry.getPackage('com.example.leave')).toBeUndefined();
  });

  it('CONTROL — a landed write answers the installed row, exactly as before', async () => {
    const { impl, registry, publish } = makeImpl(async () => ({ success: true }));

    const res = await impl.installPackage({ manifest: { id: 'com.example.leave', name: 'Leave' } });

    expect(res.package.manifest.id).toBe('com.example.leave');
    expect(registry.getPackage('com.example.leave')).toBe(res.package);
    expect(registry.getNamespaceOwners('leave')).toEqual(['com.example.leave']);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe('#21243 updatePackage — a refused sys_packages write fails the edit and restores the manifest', () => {
  it.each([
    ['returned driverFault', 'INTERNAL_ERROR', returnedDriverFault],
    ['thrown DATABASE_ERROR', 'DATABASE_ERROR', thrownDatabaseError],
  ] as const)('%s → 500 %s, the prior manifest back in place', async (_label, code, publish) => {
    const { impl, registry } = makeImpl(publish);
    const row = registry.installPackage({ id: 'com.example.leave', name: 'Leave', version: '1.0.0' });
    const manifestObject = row.manifest;
    const priorContent = JSON.parse(JSON.stringify(row));

    const err = await rejectionOf(impl.updatePackage({
      packageId: 'com.example.leave',
      patch: { name: 'Leave (renamed)', description: 'patched' },
    }));

    expect(door(err)).toMatchObject({ status: 500, code });
    expect(door(err).message).not.toContain(DRIVER_LINE);
    const now = registry.getPackage('com.example.leave')!;
    expect(JSON.parse(JSON.stringify(now))).toEqual(priorContent);
    // `description` was ABSENT before the edit and is absent again — not `undefined`, absent.
    expect('description' in now.manifest).toBe(false);
    // Restored in place: the row and its manifest are the objects the registry already held.
    expect(now).toBe(row);
    expect(now.manifest).toBe(manifestObject);
  });

  it('CONTROL — a landed write answers the edited row', async () => {
    const { impl, registry } = makeImpl(async () => ({ success: true }));
    registry.installPackage({ id: 'com.example.leave', name: 'Leave', version: '1.0.0' });

    const res = await impl.updatePackage({ packageId: 'com.example.leave', patch: { description: 'patched' } });

    expect(res.package.manifest.description).toBe('patched');
    expect(registry.getPackage('com.example.leave')?.manifest.description).toBe('patched');
  });
});
