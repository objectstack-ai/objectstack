// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8613 / ADR-0049] A deactivated permission set, at the security plugin's
 * own set resolution.
 *
 * The dominant enforcement point is `resolveUserAuthzGrants` in
 * `@objectstack/core`, which drops a deactivated set before
 * `context.permissions` is built. The plugin's resolution is the SECOND
 * reader, and it is not defence in depth that nothing reaches — the
 * reachability case below is the reason it exists:
 *
 *   `resolvePermissionSetsForContext` requests `context.positions` as
 *   permission-set NAMES too (a position name is commonly reused as a set
 *   name). So an ACTIVE position whose name matches a DEACTIVATED set arrives
 *   with that name still standing: core judged the position, not a set of
 *   the same name.
 *
 * [ADR-0131 D3, ADR-0126 §4] The switch is the activation ledger's
 * (`sys_metadata_activation`, type `permission`), read through core's own
 * `readDisabledCatalogNames` — the read the resolver takes — and the set's
 * body is the security catalog's definition. A `sys_permission_set` row is not
 * read at all, its `active` column included.
 */

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';
import type { ISecurityService } from '@objectstack/spec/contracts';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

/** The metadata-declared baseline every authenticated caller resolves additively. */
const MEMBER_DEFAULT: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { deal: { allowRead: true } },
  fields: {},
  systemPermissions: [],
} as any;

/** An environment-authored set, as the security catalog holds it. */
const SALES_MANAGER: PermissionSet = {
  name: 'sales_manager',
  label: 'Sales Manager',
  objects: { deal: { allowRead: true, allowEdit: true } },
  systemPermissions: ['setup.access'],
} as any;

interface Fixture {
  /** `sys_metadata_activation` rows. */
  ledger?: Array<Record<string, unknown>>;
  /** `sys_permission_set` rows — present to prove they are not read. */
  rows?: Array<Record<string, unknown>>;
}

/** Resolve the security service the way a cross-package consumer does, and count the ledger reads. */
async function locate(fixture: Fixture = {}): Promise<{ svc: Partial<ISecurityService>; ledgerReads: () => number }> {
  const schema: any = {
    name: 'deal',
    label: 'Deal',
    systemFields: false,
    fields: { id: { name: 'id' }, amount: { name: 'amount' } },
  };
  let ledgerReads = 0;
  const ql: any = {
    registerMiddleware: () => {},
    getSchema: (name: string) => (name === 'deal' ? schema : null),
    findOne: async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; },
    find: async (object: string, query: any) => {
      if (object === 'sys_permission_set') return fixture.rows ?? [];
      if (object !== 'sys_metadata_activation') return [];
      ledgerReads += 1;
      const types: string[] = query?.where?.metadata_type?.$in ?? [];
      const names: string[] = query?.where?.name?.$in ?? [];
      return (fixture.ledger ?? []).filter((r) => types.includes(String(r.metadata_type)) && names.includes(String(r.name)));
    },
    registry: {
      getItem: (type: string, name: string) => (type === 'permission' && name === SALES_MANAGER.name ? SALES_MANAGER : undefined),
      listItems: (type: string) => (type === 'permission' ? [SALES_MANAGER] : []),
      isPackageDisabled: () => false,
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
  ledgerReads = 0; // boot-time reads are not the resolution under test
  return {
    svc: ctx.registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1],
    ledgerReads: () => ledgerReads,
  };
}

const namesFor = async (fixture: Fixture, context: Record<string, unknown>): Promise<string[]> => {
  const { svc } = await locate(fixture);
  const sets = await svc.resolvePermissionSetsForContext?.({ userId: 'u1', ...context } as any);
  return (sets ?? []).map((s) => s.name);
};

const switchedOff = (active: unknown) => ({ metadata_type: 'permission', name: 'sales_manager', active });

describe('[#8613] a position name reaching a set the activation ledger switched off', () => {
  it('THE REACHABILITY CASE: the folded name resolves nothing; the baseline still applies', async () => {
    const names = await namesFor({ ledger: [switchedOff(false)] }, { positions: ['sales_manager'], permissions: [] });
    expect(names).not.toContain('sales_manager');
    expect(names).toContain('member_default');
  });

  it('…and the same request with no ledger row does resolve, whole — the case is real, not vacuous', async () => {
    const { svc } = await locate();
    const sets = await svc.resolvePermissionSetsForContext?.({ userId: 'u1', positions: ['sales_manager'], permissions: [] } as any);
    const found: any = (sets ?? []).find((s) => s.name === 'sales_manager');
    expect(found?.objects).toEqual({ deal: { allowRead: true, allowEdit: true } });
    expect(found?.systemPermissions).toEqual(['setup.access']);
  });

  it('the 0/1 storage shape of the ledger is judged too, not only a literal `false`', async () => {
    expect(await namesFor({ ledger: [switchedOff(0)] }, { positions: ['sales_manager'] })).not.toContain('sales_manager');
    expect(await namesFor({ ledger: [switchedOff(1)] }, { positions: ['sales_manager'] })).toContain('sales_manager');
  });

  it("a ledger row of ANOTHER type under the same name switches nothing off (a position's row is not the set's)", async () => {
    const names = await namesFor(
      { ledger: [{ metadata_type: 'position', name: 'sales_manager', active: false }] },
      { positions: ['sales_manager'] },
    );
    expect(names).toContain('sales_manager');
  });

  it("a catalog ROW's `active: false` is not read — only the ledger switches a set off", async () => {
    const names = await namesFor(
      { rows: [{ name: 'sales_manager', active: false }] },
      { positions: ['sales_manager'] },
    );
    expect(names).toContain('sales_manager');
  });
});

describe('[ADR-0049] names that arrive already judged are not judged again', () => {
  it('a set the resolver granted (`context.permissions`) issues no ledger read', async () => {
    const { svc, ledgerReads } = await locate({ ledger: [switchedOff(false)] });
    const sets = await svc.resolvePermissionSetsForContext?.({ userId: 'u1', permissions: ['sales_manager'] } as any);
    // The resolver dropped a switched-off set before building `permissions`;
    // a name it hands over is in effect, so no second read is spent on it.
    expect((sets ?? []).map((s) => s.name)).toContain('sales_manager');
    expect(ledgerReads()).toBe(0);
  });

  it('a request with no folded collision issues no ledger read', async () => {
    const { svc, ledgerReads } = await locate();
    await svc.resolvePermissionSetsForContext?.({ userId: 'u1', positions: ['everyone', 'org_member'], permissions: [] } as any);
    expect(ledgerReads()).toBe(0);
  });
});
