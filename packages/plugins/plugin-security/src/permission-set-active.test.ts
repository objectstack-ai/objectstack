// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8613 / ADR-0049] `sys_permission_set.active`, at the DB loader.
 *
 * The dominant enforcement point for this flag is `resolveAuthzContext` in
 * `@objectstack/core`, which drops a deactivated set before `context.permissions`
 * is built. This loader is the SECOND reader, and it is not defence in depth
 * that nothing reaches — the reachability case below is the reason it exists:
 *
 *   `resolvePermissionSetsForContext` requests `context.positions` as
 *   permission-set NAMES too (a position name is commonly reused as a set name,
 *   which the evaluator's own doc comment calls out). So an ACTIVE position
 *   whose name matches a DEACTIVATED `sys_permission_set` row arrives here with
 *   that name still standing — core filtered the position catalogue and the
 *   sets reached by id, and neither of those judged THIS row.
 *
 * The filter runs in memory over rows the loader already fetched rather than as
 * an `active: true` `where` predicate: `true` would also drop rows whose column
 * is NULL (rows predating the field — a silent mass revocation on deployed
 * data), and boolean `where` coercion differs per driver. `isRowActive` is the
 * same predicate core and the break-glass guard use.
 */

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';
import type { ISecurityService } from '@objectstack/spec/contracts';

/** The metadata-declared baseline every authenticated caller resolves additively. */
const MEMBER_DEFAULT: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { deal: { allowRead: true } },
  fields: {},
  systemPermissions: [],
} as any;

/** A DB-authored set, as it sits in `sys_permission_set`. `active` varies per case. */
const salesManagerRow = (active: unknown) => ({
  name: 'sales_manager',
  label: 'Sales Manager',
  object_permissions: JSON.stringify({ deal: { allowRead: true, allowEdit: true } }),
  system_permissions: JSON.stringify(['setup.access']),
  ...(active === undefined ? {} : { active }),
});

/**
 * Resolve the security service the way a cross-package consumer does. The fake
 * engine matches on `where.name.$in` ONLY — deliberately, because that is the
 * predicate the loader has always sent. A filter expressed as an extra `where`
 * key would be invisible to this fixture (and to any driver that ignores an
 * unknown column), so the assertion below measures the product's own judgment.
 */
async function locateSecurityService(
  dbRows: Array<Record<string, unknown>>,
): Promise<Partial<ISecurityService>> {
  const schema: any = {
    name: 'deal',
    label: 'Deal',
    systemFields: false,
    fields: { id: { name: 'id' }, amount: { name: 'amount' } },
  };
  const ql: any = {
    registerMiddleware: () => {},
    getSchema: (name: string) => (name === 'deal' ? schema : null),
    findOne: async () => null,
    find: async (object: string, query: any) => {
      if (object !== 'sys_permission_set') return [];
      const wanted: string[] = query?.where?.name?.$in ?? [];
      return dbRows.filter((r) => wanted.includes(String(r.name)));
    },
  };
  const metadata: any = {
    get: async (_type: string, name: string) => (name === 'deal' ? schema : null),
    list: async () => [MEMBER_DEFAULT],
  };
  const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' } as any);
  await plugin.init(ctx);
  await plugin.start(ctx);
  return ctx.registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1];
}

const namesFor = async (
  rows: Array<Record<string, unknown>>,
  context: Record<string, unknown>,
): Promise<string[]> => {
  const svc = await locateSecurityService(rows);
  const sets = await svc.resolvePermissionSetsForContext?.({ userId: 'u1', ...context } as any);
  return (sets ?? []).map((s) => s.name);
};

describe('[#8613] the DB loader drops DEACTIVATED permission sets', () => {
  it('a deactivated set requested by name resolves to nothing', async () => {
    const names = await namesFor([salesManagerRow(false)], { permissions: ['sales_manager'] });
    expect(names).not.toContain('sales_manager');
    // The baseline still applies — deactivating one set is not a blanket denial.
    expect(names).toContain('member_default');
  });

  it('an ACTIVE set still resolves, whole', async () => {
    const svc = await locateSecurityService([salesManagerRow(true)]);
    const sets = await svc.resolvePermissionSetsForContext?.({
      userId: 'u1',
      permissions: ['sales_manager'],
    } as any);
    const found: any = (sets ?? []).find((s) => s.name === 'sales_manager');
    expect(found).toBeDefined();
    expect(found.objects).toEqual({ deal: { allowRead: true, allowEdit: true } });
    expect(found.systemPermissions).toEqual(['setup.access']);
  });

  it('a row with NO `active` column still resolves — deployed rows are not mass-revoked', async () => {
    const names = await namesFor([salesManagerRow(undefined)], { permissions: ['sales_manager'] });
    expect(names).toContain('sales_manager');
  });

  it('the 0/1 storage shape is judged too, not only a literal `false`', async () => {
    expect(await namesFor([salesManagerRow(0)], { permissions: ['sales_manager'] })).not.toContain(
      'sales_manager',
    );
    expect(await namesFor([salesManagerRow(1)], { permissions: ['sales_manager'] })).toContain(
      'sales_manager',
    );
  });

  it('THE REACHABILITY CASE: a POSITION name reaching a deactivated set of the same name', async () => {
    // Core cannot judge this row: it filtered the `sys_position` catalogue and
    // the sets it reached by id, and this name arrives as a POSITION the caller
    // legitimately holds. Without this loader's filter the deactivated set
    // would grant `deal` edit rights through the name-reuse path — the wall
    // that looks enforced and is not.
    const names = await namesFor([salesManagerRow(false)], { positions: ['sales_manager'] });
    expect(names).not.toContain('sales_manager');
  });

  it('…and the same request with the set ACTIVE does resolve — the case is real, not vacuous', async () => {
    const names = await namesFor([salesManagerRow(true)], { positions: ['sales_manager'] });
    expect(names).toContain('sales_manager');
  });
});
