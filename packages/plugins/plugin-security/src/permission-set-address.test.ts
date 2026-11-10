// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3, D4, D8] The authorization pipeline carries a permission set as
 * `(package, name)` from the grant to the per-request evaluation.
 *
 * Two packages in different namespaces each ship a set named `sales_rep`,
 * with different bodies. A grant names its holder (`permission_set_package`),
 * the resolver carries that holder on `ExecutionContext.permissionSetAddresses`,
 * and the evaluator reads the set at that holder — never the first set of the
 * name. The activation ledger switches a set off per holder (its `package_id`,
 * R4), and the explainer reports what the enforcement does.
 *
 * The registry here is a package-scoped stand-in: no install-time namesake
 * backstop runs, so the two holders coexist the way a pre-phase-1 clash
 * leaves them.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  bindAudienceAnchorSetScopes,
  bindSecurityCatalogReader,
  createSecurityCatalogReader,
  resolveUserAuthzGrants,
  securityCatalogReaderOf,
} from '@objectstack/core';
import { SecurityPlugin } from './security-plugin.js';
import { buildContextForUser } from './explain-engine.js';

const ORG = 'org_1';
const ALPHA = 'com.alpha.sales';
const BETA = 'org.beta.crm';
const GONE = 'com.gone.pkg';

type Item = Record<string, unknown>;
type Holders = Record<string, Array<{ packageId: string; item: Item }>>;

/** One package's `sales_rep`: it reads that package's own object, and nothing else. */
const salesRep = (packageId: string, object: string): Item => ({
  name: 'sales_rep',
  _packageId: packageId,
  objects: { [object]: { allowRead: true } },
});

const HOLDERS: Holders = {
  sales_rep: [
    { packageId: ALPHA, item: salesRep(ALPHA, 'alpha_deal') },
    { packageId: BETA, item: salesRep(BETA, 'beta_deal') },
  ],
  solo_rep: [{ packageId: ALPHA, item: { name: 'solo_rep', _packageId: ALPHA, objects: { solo_deal: { allowRead: true } } } }],
};

/** A package-scoped registry over {@link HOLDERS}; its by-name read is the first holder — the pick nothing may fall back to. */
function scopedRegistry(holders: Holders, positions: Item[] = []) {
  const all = () => Object.values(holders).flatMap((h) => h.map((x) => x.item));
  const position = (name: string) => positions.find((p) => p.name === name);
  return {
    getItem: (type: string, name: string) =>
      (type === 'permission' ? holders[name]?.[0]?.item : type === 'position' ? position(name) : undefined),
    listItems: (type: string) => (type === 'permission' ? all() : type === 'position' ? positions : []),
    isPackageDisabled: () => false,
    packageScopedHoldersOf: (type: string, name: string) => (type === 'permission' ? (holders[name] ?? []).map((h) => h.packageId) : []),
    getPackageScopedItem: (type: string, name: string, packageId: string) =>
      type === 'permission' ? holders[name]?.find((h) => h.packageId === packageId)?.item : undefined,
    getEnvironmentScopedItem: (type: string, name: string) => (type === 'position' ? position(name) : undefined),
    getArtifactItem: () => undefined,
    getPackage: (id: string) => ({ manifest: { id } }),
    getAllPackages: () => [],
  };
}

/** An engine double answering `find` from `tables` (equality and `$in`), with the registry above. */
function engine(tables: Record<string, Array<Record<string, unknown>>>, positions: Item[] = []) {
  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`engine double: unsupported operator ${k}`);
      if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      if (v === null) return (row[k] ?? null) === null;
      return row[k] === v;
    });
  return {
    registry: scopedRegistry(HOLDERS, positions),
    registerMiddleware: () => {},
    getSchema: () => null,
    findOne: async () => null,
    find: async (object: string, opts: any) => {
      const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
  };
}

const grant = (permissionSet: string, permissionSetPackage?: string | null) => ({
  id: `g_${permissionSet}_${permissionSetPackage ?? 'none'}`,
  user_id: 'u1',
  organization_id: ORG,
  permission_set: permissionSet,
  ...(permissionSetPackage !== undefined ? { permission_set_package: permissionSetPackage } : {}),
});

const switchedOff = (packageId: string | null, name = 'sales_rep') => ({
  metadata_type: 'permission', package_id: packageId, name, active: false,
});

function tablesFor(grants: Array<Record<string, unknown>>, ledger: Array<Record<string, unknown>> = []) {
  return {
    sys_user: [{ id: 'u1', email: 'u1@example.com' }],
    sys_member: [{ user_id: 'u1', organization_id: ORG, role: 'member' }],
    sys_user_position: [],
    sys_user_permission_set: grants,
    sys_metadata_activation: ledger,
  };
}

/** A started security plugin over `ql`: its catalog is bound in `start()`, as on a booted stack. */
async function bootPlugin(ql: ReturnType<typeof engine>) {
  const warn = vi.fn();
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => null, list: async () => [] },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: null });
  await plugin.init(ctx);
  await plugin.start(ctx);
  return { plugin: plugin as any, warn };
}

/** The objects each resolved `sales_rep` / `solo_rep` body reads — which holder's set the request got. */
const readsOf = (sets: Array<Record<string, any>>, name = 'sales_rep'): string[] =>
  sets.filter((s) => s?.name === name).flatMap((s) => Object.keys(s.objects ?? {})).sort();

async function requestFor(grants: Array<Record<string, unknown>>, ledger: Array<Record<string, unknown>> = []) {
  const ql = engine(tablesFor(grants, ledger));
  const { plugin, warn } = await bootPlugin(ql);
  const authz = await resolveUserAuthzGrants(ql, 'u1', { tenantId: ORG });
  const context = {
    userId: 'u1',
    tenantId: ORG,
    positions: authz.positions,
    permissions: authz.permissions,
    permissionSetAddresses: authz.permissionSetAddresses,
  };
  const sets: Array<Record<string, any>> = await plugin.resolvePermissionSetsForContext(context);
  return { ql, plugin, warn, authz, context, sets };
}

describe('[ADR-0150 D3] two packages each ship `sales_rep`: a grant reaches only its own', () => {
  it('the composition binds the catalog, so the evaluator\'s by-name arm is never reached', async () => {
    const ql = engine(tablesFor([]));
    const { plugin } = await bootPlugin(ql);
    expect(securityCatalogReaderOf(ql)).toBeDefined();
    expect(typeof plugin.dbLoaderForContext({})).toBe('function');
  });

  for (const [holder, object] of [[ALPHA, 'alpha_deal'], [BETA, 'beta_deal']] as const) {
    it(`a grant of ${holder}'s set resolves that set, addressed, and reads ${object} only`, async () => {
      const { authz, sets } = await requestFor([grant('sales_rep', holder)]);
      expect(authz.permissions).toEqual(['sales_rep']);
      expect(authz.permissionSetAddresses).toEqual([{ packageId: holder, name: 'sales_rep' }]);
      expect(readsOf(sets)).toEqual([object]);
    });
  }

  it('grants of both holders confer both sets: one name, two addresses, neither displacing the other', async () => {
    const { authz, sets } = await requestFor([grant('sales_rep', ALPHA), grant('sales_rep', BETA)]);
    expect(authz.permissions).toEqual(['sales_rep']);
    expect(authz.permissionSetAddresses).toEqual([
      { packageId: ALPHA, name: 'sales_rep' },
      { packageId: BETA, name: 'sales_rep' },
    ]);
    expect(readsOf(sets)).toEqual(['alpha_deal', 'beta_deal']);
  });

  it('⛔ a name with no address resolves with no caller: two holders are refused, naming both, and nothing is picked', async () => {
    const ql = engine(tablesFor([]));
    const { plugin, warn } = await bootPlugin(ql);
    const context = { userId: 'u1', tenantId: ORG, positions: [], permissions: ['sales_rep'] };
    const sets = await plugin.resolvePermissionSetsForContext(context);
    expect(readsOf(sets)).toEqual([]);
    const said = warn.mock.calls.filter(([msg]) => String(msg).includes('permission set "sales_rep" grants nothing'));
    expect(said).toHaveLength(1);
    expect(said[0][1].candidates).toEqual([`package "${ALPHA}"`, `package "${BETA}"`]);
    // Said once per plugin, not once per request.
    await plugin.resolvePermissionSetsForContext({ ...context });
    expect(warn.mock.calls.filter(([msg]) => String(msg).includes('permission set "sales_rep" grants nothing'))).toHaveLength(1);
  });
});

describe('[ADR-0150 D4, D8 R4] the activation ledger switches a set off per holder', () => {
  it('switching off ALPHA\'s sales_rep leaves BETA\'s granting — in the envelope and in the evaluation', async () => {
    const { authz, sets } = await requestFor([grant('sales_rep', ALPHA), grant('sales_rep', BETA)], [switchedOff(ALPHA)]);
    expect(authz.permissions).toEqual(['sales_rep']);
    expect(authz.permissionSetAddresses).toEqual([{ packageId: BETA, name: 'sales_rep' }]);
    expect(readsOf(sets)).toEqual(['beta_deal']);
  });

  it('switching off BETA\'s leaves ALPHA\'s', async () => {
    const { authz, sets } = await requestFor([grant('sales_rep', ALPHA), grant('sales_rep', BETA)], [switchedOff(BETA)]);
    expect(authz.permissionSetAddresses).toEqual([{ packageId: ALPHA, name: 'sales_rep' }]);
    expect(readsOf(sets)).toEqual(['alpha_deal']);
  });

  it('a holder of a grant the user does not hold switches nothing off for the one they do', async () => {
    const { authz, sets } = await requestFor([grant('sales_rep', BETA)], [switchedOff(ALPHA)]);
    expect(authz.permissionSetAddresses).toEqual([{ packageId: BETA, name: 'sales_rep' }]);
    expect(readsOf(sets)).toEqual(['beta_deal']);
  });

  it('a ledger row naming no package on a name two packages hold switches every holder off — never one at random', async () => {
    const { authz, sets } = await requestFor([grant('sales_rep', ALPHA), grant('sales_rep', BETA)], [switchedOff(null)]);
    expect(authz.permissions).toEqual([]);
    expect(readsOf(sets)).toEqual([]);
  });
});

describe('[ADR-0150 D3, D4] the explainer reads what enforcement reads', () => {
  it('the explained context carries the same addresses, and reports the one switched-off holder', async () => {
    const ql = engine(tablesFor([grant('sales_rep', ALPHA), grant('sales_rep', BETA)], [switchedOff(ALPHA)]));
    await bootPlugin(ql);
    const ctx = await buildContextForUser(ql, 'u1', Date.now(), ORG);
    expect(ctx.permissionSetAddresses).toEqual([{ packageId: BETA, name: 'sales_rep' }]);
    expect(ctx.droppedGrants).toEqual([{ kind: 'permission_set', name: 'sales_rep', state: 'deactivated' }]);
  });

  it('CONTROL: with no ledger row both holders are explained and nothing is dropped', async () => {
    const ql = engine(tablesFor([grant('sales_rep', ALPHA), grant('sales_rep', BETA)]));
    await bootPlugin(ql);
    const ctx = await buildContextForUser(ql, 'u1', Date.now(), ORG);
    expect(ctx.permissionSetAddresses).toEqual([
      { packageId: ALPHA, name: 'sales_rep' },
      { packageId: BETA, name: 'sales_rep' },
    ]);
    expect(ctx.droppedGrants).toEqual([]);
  });
});

describe('[ADR-0150 D8] a stale address — its package no longer serves the set', () => {
  it('one holder of the name: the evaluator falls back to it (D3) and says the stale address once', async () => {
    const ql = engine(tablesFor([]));
    const { plugin, warn } = await bootPlugin(ql);
    const sets = await plugin.resolvePermissionSetsForContext({
      userId: 'u1', tenantId: ORG, positions: [], permissions: ['solo_rep'],
      permissionSetAddresses: [{ packageId: GONE, name: 'solo_rep' }],
    });
    expect(readsOf(sets, 'solo_rep')).toEqual(['solo_deal']);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes(GONE) && String(msg).includes('solo_rep'))).toBe(true);
  });

  it('⛔ two holders of the name: the stale address is refused, and nothing is picked', async () => {
    const ql = engine(tablesFor([]));
    const { plugin } = await bootPlugin(ql);
    const sets = await plugin.resolvePermissionSetsForContext({
      userId: 'u1', tenantId: ORG, positions: [], permissions: ['sales_rep'],
      permissionSetAddresses: [{ packageId: GONE, name: 'sales_rep' }],
    });
    expect(readsOf(sets)).toEqual([]);
  });
});

describe('[ADR-0150 D3] the resolver alone, over a bound catalog', () => {
  it('a grant row with no package on a name two packages hold confers nothing, and carries no address', async () => {
    const ql = engine(tablesFor([grant('sales_rep', null)]));
    bindSecurityCatalogReader(ql, createSecurityCatalogReader({ registry: ql.registry as any, metadata: { get: () => undefined, list: () => [] } }));
    const authz = await resolveUserAuthzGrants(ql, 'u1', { tenantId: ORG });
    expect(authz.permissions).toEqual([]);
    expect(authz.permissionSetAddresses ?? []).toEqual([]);
  });
});

describe('[ADR-0150 D8 R3] an accepted everyone set resolves at the package its suggestion row names', () => {
  /** The anchor names the accepted set by name, as its definition always has. */
  const EVERYONE = { name: 'everyone', permissionSets: ['sales_rep'] };

  async function memberOfEveryone(scopes?: ReadonlyMap<string, ReadonlyArray<{ packageId?: string; callerPackageId?: string | null }>>) {
    const ql = engine(tablesFor([]), [EVERYONE]);
    bindSecurityCatalogReader(ql, createSecurityCatalogReader({ registry: ql.registry as any, metadata: { get: () => undefined, list: () => [] } }));
    if (scopes) bindAudienceAnchorSetScopes(ql, 'everyone', scopes);
    return resolveUserAuthzGrants(ql, 'u1', { tenantId: ORG });
  }

  for (const holder of [ALPHA, BETA]) {
    it(`a row accepting ${holder}'s set grants that holder's set through the anchor, addressed`, async () => {
      const authz = await memberOfEveryone(new Map([['sales_rep', [{ packageId: holder }]]]));
      expect(authz.positions).toContain('everyone');
      expect(authz.permissions).toEqual(['sales_rep']);
      expect(authz.permissionSetAddresses).toEqual([{ packageId: holder, name: 'sales_rep' }]);
    });
  }

  it('⛔ with no scope bound the anchor\'s name resolves with no caller: two holders are refused and nothing is granted', async () => {
    const authz = await memberOfEveryone();
    expect(authz.permissions).toEqual([]);
  });

  it('the scopes are a cache rebuilt whole: binding again replaces the anchor\'s map', async () => {
    const ql = engine(tablesFor([]), [EVERYONE]);
    bindSecurityCatalogReader(ql, createSecurityCatalogReader({ registry: ql.registry as any, metadata: { get: () => undefined, list: () => [] } }));
    bindAudienceAnchorSetScopes(ql, 'everyone', new Map([['sales_rep', [{ packageId: ALPHA }]]]));
    bindAudienceAnchorSetScopes(ql, 'everyone', new Map());
    expect((await resolveUserAuthzGrants(ql, 'u1', { tenantId: ORG })).permissions).toEqual([]);
  });
});
