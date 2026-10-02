// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21322 — a permission set registered AFTER the boot is projected into
 * `sys_permission_set` when the kernel announces `metadata:reloaded`.
 *
 * ## The defect these pins are written against
 *
 * The declared-permission seeding (`bootstrapDeclaredPermissions`, ADR-0086
 * D5) ran once, inside the `kernel:ready` bootstrap, over whatever the engine
 * registry held at that moment. A package registered later — `os package
 * install` into a running runtime, whose install-local plugin registers the
 * package from an HTTP request — was never projected: the evaluator resolved
 * its set (`/meta/permission` listed it) while `sys_permission_set` had no
 * row, so no admin could grant it until a restart re-ran the boot pass.
 *
 * The fix re-runs the SAME seeding on `metadata:reloaded`, the post-boot
 * re-sync signal every runtime door announces. These pins drive the real
 * `SecurityPlugin` through its own hooks — the wiring is the fix — against an
 * engine double whose registry is mutable, so "registered after the boot" is
 * a real ordering and not a fixture flag. The CLI suite
 * `package-install-local-boot-steps.integration.test.ts` pins the same
 * outcome end to end through `os package install`.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { SecurityPlugin } from './security-plugin.js';

const PACKAGE_ID = 'com.example.tasksapp';
const PACKAGE_SET = {
  name: 'tasks_app_task_user',
  label: 'Tasks App Task User',
  objects: { tasks_app_task: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  // The registry's provenance stamp (ADR-0010) — what `registerApp` leaves on
  // every item a package contributes, and what the seeder reads as the owner.
  _packageId: PACKAGE_ID,
};

/**
 * `where` as the seeder spells it: field equality plus `{ name: { $in: [...] } }`.
 * Anything else is REFUSED rather than answered — a combinator read as a field
 * name matches no row and would report that as "no rows".
 */
function rowMatches(row: any, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) {
      throw new Error(`this double implements field predicates only; it cannot answer '${k}'`);
    }
    const actual = row?.[k] ?? null;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const ops = Object.keys(v as Record<string, unknown>);
      if (ops.length === 1 && ops[0] === '$in') {
        return ((v as any).$in as unknown[]).some((m) => (m ?? null) === actual);
      }
      throw new Error(`this double implements equality and $in only; it cannot answer ${JSON.stringify(ops)}`);
    }
    return actual === (v ?? null);
  });
}

/** Boot the real plugin over an in-memory engine whose `permission` registry the test grows. */
async function boot() {
  const tables: Record<string, any[]> = {};
  const declaredPermissions: any[] = [];
  const ql: any = {
    registerMiddleware: () => {},
    getSchema: () => undefined,
    registry: {
      listItems: (type: string) => (type === 'permission' ? [...declaredPermissions] : []),
    },
    find: async (object: string, opts?: any) => {
      const matched = (tables[object] ?? []).filter((r) => rowMatches(r, opts?.where ?? {}));
      // The caller's bound, applied BY PRESENCE and after the filter
      // (`check:objectql-double-limit`).
      return (typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched).map((r) => ({ ...r }));
    },
    findOne: async (object: string, query?: EngineFindOneQueryInput) => {
      // The producer's own predicate, never a hand-mirrored guard.
      assertEngineFindOnePredicate(object, query);
      return null;
    },
    count: async () => 0,
    insert: async (object: string, data: any) => {
      const row = { id: data?.id ?? `${object}_${(tables[object] ?? []).length + 1}`, ...data };
      (tables[object] ??= []).push(row);
      return { ...row };
    },
    update: async (object: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      const target = (tables[object] ?? []).find((r) => r.id === (data?.id ?? options?.where?.id));
      if (target) Object.assign(target, data);
      return target ? 1 : 0;
    },
  };
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => null, list: async () => [] },
  };
  const hook = vi.fn();
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
    hook,
  };
  const plugin = new SecurityPlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);
  const fire = async (event: string) => {
    for (const [, cb] of hook.mock.calls.filter((c: any[]) => c[0] === event)) await cb({ changed: [`app/${PACKAGE_ID}`] });
  };
  const packageRows = () => (tables.sys_permission_set ?? []).filter((r) => r.name === PACKAGE_SET.name);
  return { ctx, fire, packageRows, declaredPermissions };
}

describe('#21322: declared permission sets registered after the boot are projected on metadata:reloaded', () => {
  it('a set registered after kernel:ready gets its sys_permission_set row on the reload, with package provenance', async () => {
    const { ctx, fire, packageRows, declaredPermissions } = await boot();
    await fire('kernel:ready');
    // Positive control: the boot pass really completed — without it, every
    // assertion below would be satisfied by a boot that fell over early.
    expect(
      ctx.logger.info.mock.calls.filter((c: any[]) => String(c[0]).includes('platform bootstrap complete')),
    ).toHaveLength(1);
    expect(packageRows(), 'the package was not registered yet — the boot pass had nothing to project').toHaveLength(0);

    declaredPermissions.push(PACKAGE_SET); // the hot install registers the package
    await fire('metadata:reloaded');

    expect(packageRows()).toHaveLength(1);
    expect(packageRows()[0]).toMatchObject({ managed_by: 'package', package_id: PACKAGE_ID });
  });

  it('is idempotent: a second reload over the same declaration adds no row', async () => {
    const { fire, packageRows, declaredPermissions } = await boot();
    await fire('kernel:ready');
    declaredPermissions.push(PACKAGE_SET);
    await fire('metadata:reloaded');
    await fire('metadata:reloaded');
    expect(packageRows()).toHaveLength(1);
  });

  it('does nothing before the boot pass has run — the platform defaults are seeded first, in their own shape', async () => {
    const { fire, packageRows, declaredPermissions } = await boot();
    declaredPermissions.push(PACKAGE_SET);
    await fire('metadata:reloaded');
    expect(packageRows()).toHaveLength(0);
    // …and the boot pass that follows still projects it, as it always did.
    await fire('kernel:ready');
    expect(packageRows()).toHaveLength(1);
  });
});
