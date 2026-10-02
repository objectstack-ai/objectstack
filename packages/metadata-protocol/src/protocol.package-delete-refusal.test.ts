// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21276 — an uninstall the store refused is never answered as success.
 *
 * ## The defect
 *
 * `deletePackage` deleted the package's `sys_metadata` rows (and tore down its
 * tables), then deleted its `sys_packages` row through the `package` service,
 * then withdrew it from the registry and ran the uninstall cleanups. The
 * `sys_packages` delete sat inside a `catch` that logged a thrown failure with
 * `console.warn`, and a RETURNED `{ success: false }` was never read at all.
 * So when the store refused that one delete, the uninstall answered success,
 * and `PackageServicePlugin.start()` hydrated the surviving row back into the
 * registry on the next boot. Measured at `DELETE /api/v1/packages/:id` on
 * SQLite with a trigger refusing the delete: 200, then 404 in the same
 * process, then 200 after a restart.
 *
 * ## The contract pinned here (triage's ruling: refuse before withdrawing)
 *
 *  1. The `sys_packages` delete is the FIRST durable step, and its refusal is
 *     the uninstall's refusal — a thrown error with the status and code the
 *     dispatcher door reads (`resolveThrownHttpError`, the one rule every
 *     door applies), never a success body.
 *  2. Nothing after it ran: the registry still holds the package, and its
 *     `sys_metadata` rows and the rows an uninstall cleanup owns are all
 *     still there. ⛔ No undo — there is nothing to undo.
 *  3. After a restart — a fresh process over the same store — the package is
 *     in the state the refusal reported: installed, with its metadata.
 *  4. CONTROL: an ordinary uninstall still removes everything, store row
 *     first, and a restart does not bring it back.
 *
 * Both failure channels of the service's `delete` are driven
 * (`PackageDeleteResult`, `packages/services/service-package/src/index.ts`):
 * RETURNED `{ success: false }` (an undeclared driver fault the service
 * swallowed) and THROWN (a failure that declared its own answer — what a live
 * SQL driver's refused raw statement is, `500 DATABASE_ERROR`).
 *
 * ## The doubles
 *
 * `World` is the database: `sysPackages` stands for `sys_packages`,
 * `sysMetadata` for the package's `sys_metadata` rows, and `grants` for the
 * data-plane rows an uninstall cleanup removes (plugin-security's package
 * permission sets). `boot(world)` is one process over it: the registry is
 * hydrated from `sysPackages` the way `PackageServicePlugin.start()` does it,
 * so a second `boot` over the same world IS a restart. The registry double
 * mirrors the real `SchemaRegistry` verbs by name (`installPackage`,
 * `getPackage`, `uninstallPackage`, `packages/objectql/src/registry.ts`), and
 * the per-item `deleteMetaItem` is replaced by a double that removes the row
 * from `sysMetadata` — the same seam `protocol-package-lifecycle.test.ts`
 * stubs, since the per-item teardown has its own pins.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectStackProtocolImplementation } from './index.js';

const PKG = 'com.example.leave';

interface MetadataRow {
  type: string;
  name: string;
  state: string;
  package_id: string;
  organization_id: string | null;
}

interface World {
  sysPackages: Map<string, Record<string, unknown>>;
  sysMetadata: MetadataRow[];
  grants: Set<string>;
  /** Every step that changes the world or the registry, in the order it ran. */
  steps: string[];
}

function makeWorld(): World {
  return {
    sysPackages: new Map([[PKG, { id: PKG, name: 'Leave', version: '1.0.0', namespace: 'leave' }]]),
    sysMetadata: [
      { type: 'object', name: 'leave_request', state: 'active', package_id: PKG, organization_id: null },
      { type: 'view', name: 'leave_request_list', state: 'draft', package_id: PKG, organization_id: null },
    ],
    grants: new Set([`${PKG}:leave_manager`]),
    steps: [],
  };
}

type StoreDelete = (world: World, id: string) => Promise<unknown>;

/** The delete lands: the row leaves `sys_packages`. */
const landed: StoreDelete = async (world, id) => {
  world.sysPackages.delete(id);
  return { success: true };
};

/** The RETURNED channel: the DELETE broke and declared nothing (`PackageDeleteResult`). */
const returnedRefusal: StoreDelete = async () => ({ success: false });

/** The THROWN channel, shaped as a live SQL driver's refused raw statement (`rawStatementFaultError`). */
const DRIVER_LINE = "DELETE FROM sys_packages WHERE id = 'com.example.leave' - refused by trigger";
const thrownDatabaseError: StoreDelete = async () => {
  throw Object.assign(new Error('The database refused to run a raw statement.'), {
    code: 'DATABASE_ERROR',
    status: 500,
    cause: new Error(DRIVER_LINE),
  });
};

/** One process over `world`. A second call over the same world is a restart. */
function boot(world: World, storeDelete: StoreDelete = landed, opts: { uninstallRefusal?: Error } = {}) {
  const rows = new Map<string, { manifest: Record<string, unknown>; status: string; enabled: boolean }>();
  const registry = {
    installPackage(manifest: Record<string, unknown>) {
      const row = { manifest: { ...manifest }, status: 'installed', enabled: true };
      rows.set(String(manifest.id), row);
      return row;
    },
    getPackage: (id: string) => rows.get(id),
    getAllPackages: () => [...rows.values()],
    // The real `SchemaRegistry` verb: asks the uninstall's ADR-0029 refusal and
    // mutates nothing. It refuses only when the case says another package
    // extends an object this one owns.
    assertPackageUninstallable(_id: string) {
      if (opts.uninstallRefusal) throw opts.uninstallRefusal;
    },
    uninstallPackage(id: string) {
      world.steps.push('registry.uninstallPackage');
      return rows.delete(id);
    },
  };
  // The boot hydration: every stored row is registered.
  for (const manifest of world.sysPackages.values()) registry.installPackage(manifest);

  const engine = {
    registry,
    // Scalar equality on every `where` key, and the caller's `limit` by
    // presence after the filter. A combinator (`$or`, the org-scoped
    // uninstall's) is not implemented here, so it is refused, never answered
    // as "no rows" — these pins uninstall with `allTenants: true`.
    find: async (object: string, query?: { where?: Record<string, unknown>; limit?: number }) => {
      if (object !== 'sys_metadata') return [];
      const where = query?.where ?? {};
      for (const key of Object.keys(where)) {
        if (key.startsWith('$')) throw new Error(`find double: '${key}' is not implemented`);
      }
      const matched = world.sysMetadata.filter((row) =>
        Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value));
      const page = typeof query?.limit === 'number' ? matched.slice(0, query.limit) : matched;
      return page.map((row) => ({ ...row }));
    },
  };
  const services = new Map<string, unknown>([
    ['package', {
      publish: async () => ({ success: true }),
      delete: async (id: string) => {
        world.steps.push('sys_packages.delete');
        return storeDelete(world, id);
      },
    }],
  ]);
  const impl = new ObjectStackProtocolImplementation(engine as never, () => services as never) as any;
  vi.spyOn(impl, 'deleteMetaItem').mockImplementation(async (req: any) => {
    world.steps.push(`sys_metadata.delete ${req.type}/${req.name}/${req.state}`);
    world.sysMetadata = world.sysMetadata.filter(
      (r) => !(r.type === req.type && r.name === req.name && r.state === req.state),
    );
    return { success: true };
  });
  impl.registerUninstallCleanup('security.package-permissions', async ({ packageId }: { packageId: string }) => {
    world.steps.push('cleanup security.package-permissions');
    let removed = 0;
    for (const grant of [...world.grants]) {
      if (grant.startsWith(`${packageId}:`)) {
        world.grants.delete(grant);
        removed++;
      }
    }
    return { success: true, removed };
  });
  return { impl, registry };
}

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

const snapshot = (world: World) => ({
  sysPackages: [...world.sysPackages.keys()],
  sysMetadata: world.sysMetadata.map((r) => `${r.type}/${r.name}/${r.state}`),
  grants: [...world.grants],
});

const REFUSALS = [
  ['returned { success: false }', 'INTERNAL_ERROR', returnedRefusal],
  ['thrown DATABASE_ERROR', 'DATABASE_ERROR', thrownDatabaseError],
] as const;

describe('#21276 deletePackage — a refused sys_packages delete fails the uninstall and removes nothing', () => {
  it.each(REFUSALS)('%s → 500 %s; the registry, the metadata rows and the grants are untouched', async (_label, code, refusal) => {
    const world = makeWorld();
    const before = snapshot(world);
    const { impl, registry } = boot(world, refusal);

    const err = await rejectionOf(impl.deletePackage({ packageId: PKG, allTenants: true }));

    expect(door(err)).toMatchObject({ status: 500, code });
    // The driver's words stay on `cause` for the operator, never in the caller's sentence.
    expect(door(err).message).not.toContain(DRIVER_LINE);
    expect((err as { cause?: unknown }).cause).toBeDefined();
    // The store delete was the first and only step: nothing after it ran.
    expect(world.steps).toEqual(['sys_packages.delete']);
    expect(snapshot(world)).toEqual(before);
    expect(registry.getPackage(PKG)).toBeDefined();
  });

  it('a declared 4xx refusal from the store leaves as the producer answered it, and nothing is removed', async () => {
    const refusal = Object.assign(new Error('Refused by the platform.'), { code: 'DESTRUCTIVE_CHANGE', status: 409 });
    const world = makeWorld();
    const before = snapshot(world);
    const { impl, registry } = boot(world, async () => {
      throw refusal;
    });

    const err = await rejectionOf(impl.deletePackage({ packageId: PKG, allTenants: true }));

    expect(err).toBe(refusal);
    expect(door(err)).toMatchObject({ status: 409, code: 'DESTRUCTIVE_CHANGE' });
    expect(world.steps).toEqual(['sys_packages.delete']);
    expect(snapshot(world)).toEqual(before);
    expect(registry.getPackage(PKG)).toBeDefined();
  });
});

describe('#21276 deletePackage — the registry\'s uninstall refusal is asked BEFORE the store delete', () => {
  it('another package extends an object this one owns: the refusal is thrown as is, and the sys_packages row survives', async () => {
    const extender = new Error(
      'Cannot uninstall package "com.example.leave": object "leave_request" is extended by com.example.addon. Uninstall extenders first.',
    );
    const world = makeWorld();
    const before = snapshot(world);
    const { impl, registry } = boot(world, landed, { uninstallRefusal: extender });

    const err = await rejectionOf(impl.deletePackage({ packageId: PKG, allTenants: true }));

    // The registry's own error, unwrapped: the door answers it as it always did.
    expect(err).toBe(extender);
    // Asked before the first durable step: not even the store delete ran.
    expect(world.steps).toEqual([]);
    expect(snapshot(world)).toEqual(before);
    expect(registry.getPackage(PKG)).toBeDefined();
    // …and a restart therefore still has the package, whole.
    expect(boot(world).registry.getPackage(PKG)).toBeDefined();
  });
});

describe('#21276 the restart — a fresh process over the same store holds the package as the uninstall reported it', () => {
  it.each(REFUSALS)('after a %s refusal, the package comes back WITH its metadata and grants', async (_label, _code, refusal) => {
    const world = makeWorld();
    await rejectionOf(boot(world, refusal).impl.deletePackage({ packageId: PKG, allTenants: true }));

    const restarted = boot(world);

    // Reported: not uninstalled. So, after a restart: installed, and whole.
    expect(restarted.registry.getPackage(PKG)).toBeDefined();
    expect(snapshot(world)).toEqual({
      sysPackages: [PKG],
      sysMetadata: ['object/leave_request/active', 'view/leave_request_list/draft'],
      grants: [`${PKG}:leave_manager`],
    });
  });

  it('CONTROL — an ordinary uninstall removes the store row first, then the rest, and a restart does not bring it back', async () => {
    const world = makeWorld();
    const first = boot(world);

    const res = await first.impl.deletePackage({ packageId: PKG, allTenants: true });

    expect(res).toMatchObject({ success: true, deletedCount: 2, failedCount: 0 });
    expect(res.cleanups).toEqual([{ name: 'security.package-permissions', success: true, removed: 1 }]);
    expect(world.steps).toEqual([
      'sys_packages.delete',
      'sys_metadata.delete view/leave_request_list/draft',
      'sys_metadata.delete object/leave_request/active',
      'registry.uninstallPackage',
      'cleanup security.package-permissions',
    ]);
    expect(first.registry.getPackage(PKG)).toBeUndefined();

    const restarted = boot(world);

    expect(restarted.registry.getPackage(PKG)).toBeUndefined();
    expect(snapshot(world)).toEqual({ sysPackages: [], sysMetadata: [], grants: [] });
  });
});
