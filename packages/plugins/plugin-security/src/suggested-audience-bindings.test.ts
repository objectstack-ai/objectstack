// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// ADR-0090 D5/D9 — suggested audience bindings: the queryable install-time
// suggestion surface and the deployment-level accept/dismiss flow (#22801 → A).

import { describe, it, expect } from 'vitest';
import { bindSecurityCatalogReader, createSecurityCatalogReader } from '@objectstack/core';
import {
  syncAudienceBindingSuggestions,
  reconcileAudienceBindingSuggestions,
  readAcceptedEveryoneSets,
  listAudienceBindingSuggestions,
  confirmAudienceBindingSuggestion,
  dismissAudienceBindingSuggestion,
  SuggestionNotFoundError,
  SuggestionStateError,
  type SuggestionDeps,
} from './suggested-audience-bindings';
import { declareEveryoneBaseline } from './builtin-positions';

const SECURITY_PACKAGE = 'com.objectstack.plugin-security';
const BASELINE = ['member_default'];
const DEFAULT_ORG = 'org_default';

/** In-memory ObjectQL stub with an engine registry the security catalog reads.
 *  An enabled package's `manifest.permissions` objects are served as catalog
 *  items under its id (a registered package); the `everyone` anchor is
 *  declared with the baseline. A tenant-scoped find on the record sees that
 *  organization's rows and the organization-less ones (ADR-0120 D3), and an
 *  insert stamps the context's organization — as the real driver does. */
function makeQl(packages: any[] = [], declaredCapabilities: any[] = []) {
  const tables: Record<string, any[]> = {
    sys_organization: [{ id: DEFAULT_ORG, slug: 'default' }, { id: 'org_other', slug: 'other' }],
    sys_audience_binding_suggestion: [],
  };
  const positions = new Map<string, any>();
  const registry: any = {
    getAllPackages: () => packages,
    listItems: (type: string) => {
      if (type === 'capability') return declaredCapabilities;
      if (type === 'position') return [...positions.values()];
      if (type !== 'permission') return [];
      return registry.getAllPackages()
        .filter((pkg: any) => pkg?.enabled !== false && Array.isArray(pkg?.manifest?.permissions))
        .flatMap((pkg: any) => pkg.manifest.permissions
          .filter((ps: any) => ps && typeof ps === 'object' && ps.name)
          .map((ps: any) => (pkg.manifest.id ? { ...ps, _packageId: pkg.manifest.id } : { ...ps })));
    },
    getItem: (type: string, name: string) => registry.listItems(type).find((i: any) => i.name === name),
    isPackageDisabled: () => false,
    registerItem: (type: string, item: any, _key: string, packageId?: string) => {
      if (type === 'position') positions.set(item.name, { ...item, _packageId: packageId });
    },
  };
  const ql: any = {
    tables,
    registry,
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      const tenant = opts?.context?.tenantId;
      return (tables[object] ?? []).filter((r) =>
        (!tenant || object !== 'sys_audience_binding_suggestion' || r.organization_id === tenant || r.organization_id == null)
        && Object.entries(where).every(([k, v]) => (r as any)[k] === v),
      );
    },
    async insert(object: string, data: any, opts?: any) {
      const row = { ...data, organization_id: opts?.context?.tenantId ?? null };
      (tables[object] ??= []).push(row);
      return row;
    },
    async update(object: string, data: any) {
      const t = tables[object] ?? [];
      const i = t.findIndex((r) => r.id === data.id);
      if (i >= 0) t[i] = { ...t[i], ...data };
      return t[i];
    },
    async delete(object: string, opts: any) {
      const id = opts?.where?.id;
      const t = tables[object] ?? [];
      const i = t.findIndex((r) => r.id === id);
      if (i >= 0) t.splice(i, 1);
      return true;
    },
  };
  bindSecurityCatalogReader(ql, createSecurityCatalogReader({ registry, metadata: { get: () => undefined, list: () => [] } }));
  declareEveryoneBaseline(registry, SECURITY_PACKAGE, BASELINE);
  return ql;
}

/** What the `everyone` definition names now — the binding the resolver reads. */
function everyoneSets(ql: any): string[] {
  return ql.registry.getItem('position', 'everyone')?.permissionSets ?? [];
}

/** Put `set` on the `everyone` definition beside the baseline (the app's own default). */
function declareInBaseline(ql: any, set: string) {
  declareEveryoneBaseline(ql.registry, SECURITY_PACKAGE, [...BASELINE, set]);
}

const CRM_PACKAGE = {
  enabled: true,
  manifest: {
    id: 'com.example.crm',
    permissions: [
      { name: 'crm_readonly', isDefault: true, objects: { crm_account: { allowRead: true } } },
      { name: 'crm_admin', objects: { crm_account: { allowRead: true, allowEdit: true, allowDelete: true } } },
    ],
  },
};

/** The security plugin's re-derivation, as it composes it: baseline + accepted. */
function makeDeps(ql: any, posture?: 'single' | 'group' | 'isolated'): SuggestionDeps {
  return {
    ql,
    posture: () => posture,
    rederiveEveryone: async () => {
      const { accepted } = await readAcceptedEveryoneSets(ql);
      declareEveryoneBaseline(ql.registry, SECURITY_PACKAGE, [...new Set([...BASELINE, ...accepted])]);
    },
  };
}

/** A `manage_metadata` holder (the platform administrator under `single`). */
const ADMIN_CTX = { userId: 'usr_admin', tenantId: DEFAULT_ORG, systemPermissions: ['manage_metadata'] };
/** A tenant administrator: full object grants, no `manage_metadata` (#22621 → A). */
const TENANT_ADMIN_CTX = { userId: 'usr_org_admin', tenantId: 'org_other', systemPermissions: ['manage_users'] };
/** The platform operator under a wall — the ADR-0095 rung, not a position name. */
const OPERATOR_CTX = { ...ADMIN_CTX, posture: 'PLATFORM_ADMIN' };

const rows = (ql: any) => ql.tables.sys_audience_binding_suggestion;

describe('syncAudienceBindingSuggestions (ADR-0090 D5/D9, deployment-level)', () => {
  it('creates ONE pending row, owned by the Default Organization, for a catalog-served isDefault set', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const out = await syncAudienceBindingSuggestions(ql);
    expect(out.created).toBe(1);
    expect(rows(ql)).toHaveLength(1);
    expect(rows(ql)[0]).toMatchObject({
      package_id: 'com.example.crm',
      permission_set_name: 'crm_readonly',
      anchor: 'everyone',
      status: 'pending',
      deployment_decision: false,
      organization_id: DEFAULT_ORG,
    });
  });

  it('is idempotent — a second sync creates nothing new', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    await syncAudienceBindingSuggestions(ql);
    const out2 = await syncAudienceBindingSuggestions(ql);
    expect(out2).toMatchObject({ created: 0, confirmedObserved: 0, pruned: 0, reopened: 0 });
    expect(rows(ql)).toHaveLength(1);
  });

  // [#7677] The served app's own `isDefault` set is on the `everyone`
  // definition from boot, so it is surfaced as confirmed (observed) — never
  // offered as a prompt. "Reconciliation reads the definition": no binding row.
  it('records a set the everyone DEFINITION already names as confirmed/observed', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    declareInBaseline(ql, 'crm_readonly');
    const out = await syncAudienceBindingSuggestions(ql);
    expect(out.created).toBe(1);
    expect(rows(ql)[0]).toMatchObject({ status: 'confirmed', deployment_decision: false });
    expect(rows(ql)[0].resolved_by).toBeUndefined();
    expect(rows(ql)[0].resolved_at).toBeTruthy();

    // …and a pending row turns observed once the definition names the set.
    const ql2 = makeQl([CRM_PACKAGE]);
    await syncAudienceBindingSuggestions(ql2);
    declareInBaseline(ql2, 'crm_readonly');
    expect((await syncAudienceBindingSuggestions(ql2)).confirmedObserved).toBe(1);
    expect(rows(ql2)[0].status).toBe('confirmed');
  });

  it('prunes a pending suggestion once its declaration is gone (uninstall)', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    await syncAudienceBindingSuggestions(ql);
    ql.registry.getAllPackages = () => [];
    const out = await syncAudienceBindingSuggestions(ql);
    expect(out.pruned).toBe(1);
    expect(rows(ql)).toHaveLength(0);
  });

  it('keeps a dismissed suggestion as history (never pruned, never re-created)', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    await syncAudienceBindingSuggestions(ql);
    await dismissAudienceBindingSuggestion(makeDeps(ql), ADMIN_CTX, rows(ql)[0].id);
    const out = await syncAudienceBindingSuggestions(ql);
    expect(out).toMatchObject({ created: 0, pruned: 0, reopened: 0 });
    expect(rows(ql)).toHaveLength(1);
    expect(rows(ql)[0].status).toBe('dismissed');
  });

  it('ignores non-isDefault sets and unowned declarations', async () => {
    const ql = makeQl([
      { enabled: true, manifest: { id: 'com.example.p1', permissions: [{ name: 'plain', objects: {} }] } },
      { enabled: true, manifest: { permissions: [{ name: 'orphan', isDefault: true, objects: {} }] } },
    ]);
    const out = await syncAudienceBindingSuggestions(ql);
    expect(out.created).toBe(0);
  });

  // ⛔ A tenant administrator's earlier per-organization confirm is never
  // promoted into a deployment-wide grant: it is re-opened for a
  // `manage_metadata` holder, and the derivation reads nothing from it.
  it('RE-OPENS a decision recorded before the acceptance was deployment-level — never promotes it', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    rows(ql).push({
      id: 'sug_legacy', package_id: 'com.example.crm', permission_set_name: 'crm_readonly',
      anchor: 'everyone', status: 'confirmed', resolved_by: 'usr_org_admin', organization_id: DEFAULT_ORG,
    });
    expect((await readAcceptedEveryoneSets(ql)).accepted).toEqual([]);

    const out = await syncAudienceBindingSuggestions(ql);

    expect(out.reopened).toBe(1);
    expect(rows(ql)[0]).toMatchObject({ status: 'pending', resolved_by: null, resolved_at: null });
    expect(everyoneSets(ql)).toEqual(BASELINE);
  });

  it('does not read a row another organization owns — it is reported, not deleted', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    rows(ql).push({
      id: 'sug_other', package_id: 'com.example.crm', permission_set_name: 'crm_readonly',
      anchor: 'everyone', status: 'confirmed', resolved_by: 'usr_org_admin', organization_id: 'org_other',
    });
    const warns: Array<{ msg: string; meta?: any }> = [];

    const out = await reconcileAudienceBindingSuggestions(ql, { warn: (msg: string, meta?: any) => { warns.push({ msg, meta }); } });

    expect(out).toMatchObject({ created: 1, unread: 1 });
    expect(rows(ql).find((r: any) => r.id === 'sug_other')).toMatchObject({ status: 'confirmed' });
    expect(rows(ql).find((r: any) => r.organization_id === DEFAULT_ORG)).toMatchObject({ status: 'pending' });
    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toContain('grant nothing now');
    expect(warns[0].meta).toMatchObject({ unread: 1, organizations: ['org_other'] });
  });

  it('refuses loudly when something is declared and no Default Organization can own the record', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    ql.tables.sys_organization = [{ id: 'org_a', slug: 'a' }, { id: 'org_b', slug: 'b' }];
    await expect(syncAudienceBindingSuggestions(ql)).rejects.toMatchObject({ code: 'SUGGESTION_STATE', statusCode: 409 });
    // Nothing declared ⇒ nothing to own: a clean zero.
    const empty = makeQl([]);
    empty.tables.sys_organization = [];
    await expect(syncAudienceBindingSuggestions(empty)).resolves.toMatchObject({ created: 0 });
  });
});

describe('the deployment authority (#22621 → A)', () => {
  it('refuses a tenant administrator, an unauthenticated caller, and a non-operator under a wall', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    await expect(listAudienceBindingSuggestions(makeDeps(ql), TENANT_ADMIN_CTX))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
    await expect(listAudienceBindingSuggestions(makeDeps(ql), {}))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
    await expect(listAudienceBindingSuggestions(makeDeps(ql, 'isolated'), ADMIN_CTX))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
    // Refused before anything is read or written.
    expect(rows(ql)).toHaveLength(0);
    // The controls: the holder under `single`, the operator under a wall.
    await expect(listAudienceBindingSuggestions(makeDeps(ql), ADMIN_CTX)).resolves.toBeTruthy();
    await expect(listAudienceBindingSuggestions(makeDeps(ql, 'isolated'), OPERATOR_CTX)).resolves.toBeTruthy();
  });

  it('refuses a tenant administrator\'s confirm and dismiss before touching anything', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    await syncAudienceBindingSuggestions(ql);
    const id = rows(ql)[0].id;
    await expect(confirmAudienceBindingSuggestion(makeDeps(ql), TENANT_ADMIN_CTX, id))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
    await expect(dismissAudienceBindingSuggestion(makeDeps(ql), TENANT_ADMIN_CTX, id))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
    expect(rows(ql)[0].status).toBe('pending');
    expect(everyoneSets(ql)).toEqual(BASELINE);
  });
});

describe('listAudienceBindingSuggestions', () => {
  it('reconciles then returns rows, filterable by status/packageId', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    const { suggestions, synced } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, { status: 'pending' });
    expect(synced.created).toBe(1);
    expect(suggestions).toHaveLength(1);
    const none = await listAudienceBindingSuggestions(deps, ADMIN_CTX, { packageId: 'com.other' });
    expect(none.suggestions).toHaveLength(0);
  });
});

describe('confirmAudienceBindingSuggestion — the acceptance takes effect', () => {
  it('records the decision and re-derives everyone with the set (anti-vacuity: it was absent before)', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    expect(everyoneSets(ql)).not.toContain('crm_readonly');

    const { suggestion, bindingCreated } = await confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id);

    expect(bindingCreated).toBe(true);
    expect(suggestion).toMatchObject({ status: 'confirmed', deployment_decision: true, resolved_by: 'usr_admin' });
    expect(everyoneSets(ql)).toEqual([...BASELINE, 'crm_readonly']);
    // The definition is still the security plugin's own declaration.
    expect(ql.registry.getItem('position', 'everyone')._packageId).toBe(SECURITY_PACKAGE);
  });

  it('answers bindingCreated: false when the baseline already names the set', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    await syncAudienceBindingSuggestions(ql);
    declareEveryoneBaseline(ql.registry, SECURITY_PACKAGE, [...BASELINE, 'crm_readonly']);
    deps.rederiveEveryone = async () => declareInBaseline(ql, 'crm_readonly');
    const { bindingCreated } = await confirmAudienceBindingSuggestion(deps, ADMIN_CTX, rows(ql)[0].id);
    expect(bindingCreated).toBe(false);
  });

  it('refuses a set carrying anchor-forbidden bits — 403, nothing recorded (ADR-0090 D7)', async () => {
    const pkg = {
      enabled: true,
      manifest: {
        id: 'com.example.evil',
        permissions: [{ name: 'evil_default', isDefault: true, objects: { '*': { viewAllRecords: true } } }],
      },
    };
    const ql = makeQl([pkg]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    const refusal = confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id);
    await expect(refusal).rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
    await expect(refusal).rejects.toThrow(/cannot be given to the 'everyone' audience anchor/);
    expect(rows(ql)[0]).toMatchObject({ status: 'pending', deployment_decision: false });
    expect(everyoneSets(ql)).toEqual(BASELINE);
  });

  // ── [#18535] ADR-0090 D5: 「平台系统权限;带 package provenance 的应用声明
  // capability 令牌不计」 — the definition-side gate passes the stack's
  // declared capabilities, as the derivation does. Three cases, because "the
  // declared token is accepted" alone is equally satisfied by a gate that
  // stopped judging `systemPermissions` at all.
  const tokenPackage = (token: string) => ({
    enabled: true,
    manifest: {
      id: 'com.example.crm',
      permissions: [
        {
          name: 'crm_member_default',
          isDefault: true,
          systemPermissions: [token],
          objects: { crm_account: { allowRead: true } },
        },
      ],
    },
  });

  it('accepts an isDefault set whose systemPermissions token THIS stack declares', async () => {
    const ql = makeQl([tokenPackage('crm.export_pipeline')], [{ name: 'crm.export_pipeline', label: 'Export Pipeline' }]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    const { bindingCreated } = await confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id);
    expect(bindingCreated).toBe(true);
    expect(everyoneSets(ql)).toContain('crm_member_default');
  });

  it('still refuses an UNDECLARED systemPermissions token — the control for the case above', async () => {
    const ql = makeQl([tokenPackage('crm.settle_ledger')], [{ name: 'crm.export_pipeline', label: 'Export Pipeline' }]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    await expect(confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id))
      .rejects.toThrow(/cannot be given to the 'everyone' audience anchor/);
    expect(everyoneSets(ql)).toEqual(BASELINE);
  });

  it('still refuses a PLATFORM capability even when the stack declares a capability of that name', async () => {
    const ql = makeQl([tokenPackage('manage_users')], [{ name: 'manage_users', label: 'Not Yours' }]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    await expect(confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id))
      .rejects.toThrow(/cannot be given to the 'everyone' audience anchor/);
    expect(everyoneSets(ql)).toEqual(BASELINE);
  });

  it('refuses when the catalog serves the set under a different package (ADR-0086 D4)', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    ql.registry.getAllPackages = () => [{ ...CRM_PACKAGE, manifest: { ...CRM_PACKAGE.manifest, id: 'com.other' } }];
    await expect(confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id))
      .rejects.toBeInstanceOf(SuggestionStateError);
  });

  // A `guest` row would record a grant that never takes effect: the guest
  // anchor's sets are not derived from acceptances (声明即强制).
  it('refuses a guest-anchor row loudly rather than record a grant it does not deliver', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    rows(ql).push({
      id: 'sug_guest', package_id: 'com.example.crm', permission_set_name: 'crm_readonly',
      anchor: 'guest', status: 'pending', organization_id: DEFAULT_ORG,
    });
    await expect(confirmAudienceBindingSuggestion(makeDeps(ql), ADMIN_CTX, 'sug_guest'))
      .rejects.toMatchObject({ code: 'SUGGESTION_STATE', statusCode: 409 });
    expect(rows(ql)[0].status).toBe('pending');
  });

  it('404s on an unknown id or another organization\'s row, and 409s on a non-pending row', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    await expect(confirmAudienceBindingSuggestion(deps, ADMIN_CTX, 'nope')).rejects.toBeInstanceOf(SuggestionNotFoundError);
    rows(ql).push({ id: 'sug_other', package_id: 'com.example.crm', permission_set_name: 'crm_readonly', anchor: 'everyone', status: 'pending', organization_id: 'org_other' });
    await expect(confirmAudienceBindingSuggestion(deps, ADMIN_CTX, 'sug_other')).rejects.toBeInstanceOf(SuggestionNotFoundError);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    await confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id);
    await expect(confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id)).rejects.toBeInstanceOf(SuggestionStateError);
  });
});

describe('the derivation reads the definition as it stands', () => {
  it('withholds an accepted set whose published body now carries a forbidden bit — with its reason', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    await confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id);
    CRM_PACKAGE.manifest.permissions[0].objects = { crm_account: { allowRead: true, viewAllRecords: true } } as any;
    try {
      const derived = await readAcceptedEveryoneSets(ql);
      expect(derived.accepted).toEqual([]);
      expect(derived.withheld).toEqual([expect.objectContaining({ set: 'crm_readonly', forbidden: true })]);
    } finally {
      CRM_PACKAGE.manifest.permissions[0].objects = { crm_account: { allowRead: true } };
    }
  });

  it('withholds an accepted set the catalog no longer serves (uninstalled package)', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    await confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id);
    ql.registry.getAllPackages = () => [];
    const derived = await readAcceptedEveryoneSets(ql);
    expect(derived.accepted).toEqual([]);
    expect(derived.withheld).toEqual([expect.objectContaining({ set: 'crm_readonly', forbidden: false })]);
  });
});

describe('dismissAudienceBindingSuggestion', () => {
  it('marks a pending suggestion dismissed with the resolver identity', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    const { suggestion } = await dismissAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id);
    expect(suggestion).toMatchObject({ status: 'dismissed', deployment_decision: true, resolved_by: 'usr_admin' });
    expect(everyoneSets(ql)).toEqual(BASELINE);
  });

  it('REVOKES an accepted suggestion — everyone is re-derived without the set', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    await confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id);
    expect(everyoneSets(ql)).toContain('crm_readonly');

    const { suggestion } = await dismissAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id);

    expect(suggestion.status).toBe('dismissed');
    expect(everyoneSets(ql)).toEqual(BASELINE);
  });

  it('409s on an observed row (the baseline is not this surface\'s) and on a dismissed one', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    declareInBaseline(ql, 'crm_readonly');
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    await expect(dismissAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id)).rejects.toBeInstanceOf(SuggestionStateError);

    const ql2 = makeQl([CRM_PACKAGE]);
    const deps2 = makeDeps(ql2);
    const listed = await listAudienceBindingSuggestions(deps2, ADMIN_CTX, {});
    await dismissAudienceBindingSuggestion(deps2, ADMIN_CTX, listed.suggestions[0].id);
    await expect(dismissAudienceBindingSuggestion(deps2, ADMIN_CTX, listed.suggestions[0].id)).rejects.toBeInstanceOf(SuggestionStateError);
  });
});

/**
 * [#12981] The write sites in `syncAudienceBindingSuggestions` — the
 * observed/re-open UPDATE, the create INSERT and the prune DELETE.
 *
 * The pass is CONVERGENT, so its all-zero outcome is the normal steady-state
 * boot. That is exactly what made a wholly refused pass invisible: it returned
 * the same zeros, and the summary line is suppressed on those zeros.
 */
describe('[#12981] a refused suggestion write is distinguishable from a settled pass', () => {
  /** A refusal a real driver signals for a genuine failure. */
  const outage = () => new Error('store is refusing writes');
  /** The one refusal this module has always documented as benign. */
  const race = () => Object.assign(new Error('duplicate key value'), { code: '23505' });

  it('counts a refused CREATE and lifts the suppressed summary line', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    ql.insert = async () => { throw outage(); };
    const infos: Array<{ msg: string; meta?: any }> = [];
    const warns: Array<{ msg: string; meta?: any }> = [];

    const out = await syncAudienceBindingSuggestions(ql, {
      info: (msg: string, meta?: any) => { infos.push({ msg, meta }); },
      warn: (msg: string, meta?: any) => { warns.push({ msg, meta }); },
    });

    expect(out.created).toBe(0);
    expect(out.refused).toBe(1);
    // ⛔ Before the repair the summary was gated on `created + confirmed +
    // pruned > 0`, so this pass printed NOTHING. The widened gate is the pin.
    expect(infos).toHaveLength(1);
    expect(infos[0].meta).toMatchObject({ refused: 1 });
    // ...and the refusal is reported in its own right, with the consequence.
    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toContain('REFUSED');
    expect(warns[0].msg).toContain('no admin is ever prompted');
  });

  it('⭐ EXCLUDES the documented unique-index race — it is not a degradation', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    ql.insert = async () => { throw race(); };
    const warns: string[] = [];

    const out = await syncAudienceBindingSuggestions(ql, {
      warn: (m: string) => { warns.push(m); },
    });

    // A concurrent sync created the row this pass wanted; the end state is
    // correct, so this must NOT be reported as a lost write. Reporting it
    // would fire on healthy deployments that reconcile from two entry points.
    expect(out.created).toBe(0);
    expect(out.refused).toBe(0);
    expect(warns).toEqual([]);
  });

  it('counts a refused OBSERVATION of a set the everyone definition already names', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    // A pending row whose set the definition names ⇒ the confirm-observed UPDATE.
    declareInBaseline(ql, 'crm_readonly');
    ql.tables.sys_audience_binding_suggestion.push({
      id: 'sug_1', package_id: 'com.example.crm', permission_set_name: 'crm_readonly',
      anchor: 'everyone', status: 'pending', organization_id: DEFAULT_ORG,
    });
    ql.update = async () => { throw outage(); };

    const out = await syncAudienceBindingSuggestions(ql, { warn: () => {} });
    expect(out.confirmedObserved).toBe(0);
    expect(out.refused).toBe(1);
    // The row is still pending — the console goes on nagging for a decision
    // already made, which is what the count now makes legible.
    expect(ql.tables.sys_audience_binding_suggestion[0].status).toBe('pending');
  });

  it('counts a refused PRUNE of an undeclared suggestion', async () => {
    const ql = makeQl([]); // nothing declared ⇒ the pending row below is pruned
    ql.tables.sys_audience_binding_suggestion.push({
      id: 'sug_gone', package_id: 'com.gone.pkg', permission_set_name: 'gone',
      anchor: 'everyone', status: 'pending', organization_id: DEFAULT_ORG,
    });
    ql.delete = async () => { throw outage(); };

    const out = await syncAudienceBindingSuggestions(ql, { warn: () => {} });
    expect(out.pruned).toBe(0);
    expect(out.refused).toBe(1);
    expect(ql.tables.sys_audience_binding_suggestion).toHaveLength(1);
  });

  it('adds no steady-state noise — a settled pass reports no refusal', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    await syncAudienceBindingSuggestions(ql);
    const warns: string[] = [];
    const out = await syncAudienceBindingSuggestions(ql, {
      warn: (m: string) => { warns.push(m); },
    });
    expect(out.refused).toBe(0);
    expect(warns).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// #18031 — `permissions` carries two incompatible readings in ONE registry
// slot: the ADR-0025 §3.2 capability GRANT at the authoring stage, and the
// ADR-0090 permission-SET collection at the assembled stage. The catalog
// serves the assembled one. A package record carrying the authoring one used
// to produce nothing and say nothing.
// AGENTS.md "Route & surface ownership" §3: absence must be loud.
// ────────────────────────────────────────────────────────────────────────
describe('manifest `permissions` in the ADR-0025 reading is reported, never dropped silently (#18031)', () => {
  const STRUCTURED_PACKAGE = {
    enabled: true,
    manifest: {
      id: 'com.example.plugin',
      // ADR-0025 §3.2 — an OBJECT, so `Array.isArray` is false.
      permissions: { services: ['object', 'http'], hooks: ['record.beforeInsert'], network: [], fs: [] },
    },
  };
  const LEGACY_PACKAGE = {
    enabled: true,
    manifest: {
      id: 'com.example.legacy',
      // The legacy flat arm — bare strings, none of which has a `name`.
      permissions: ['system.user.read', 'system.data.write'],
    },
  };

  function capture() {
    const warns: Array<{ msg: string; meta?: any }> = [];
    return { warns, logger: { warn: (msg: string, meta?: any) => { warns.push({ msg, meta }); } } };
  }

  it('names the STRUCTURED arm, what it means, what is lost and where the sets belong', async () => {
    const ql = makeQl([STRUCTURED_PACKAGE]);
    const { warns, logger } = capture();

    const out = await syncAudienceBindingSuggestions(ql, logger);

    // The declaration really did produce nothing — the silence, not the
    // outcome, is what this card repairs.
    expect(out.created).toBe(0);
    expect(ql.tables.sys_audience_binding_suggestion).toHaveLength(0);

    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toContain('ADR-0025');
    expect(warns[0].msg).toContain('CONSEQUENCE');
    expect(warns[0].msg).toContain('REMEDY');
    expect(warns[0].msg).toContain('defineStack({ permissions: [ … ] })');
    expect(warns[0].meta).toMatchObject({
      packages: [{ packageId: 'com.example.plugin', arm: 'adr-0025-structured', entries: 0 }],
    });
  });

  it('names the LEGACY string arm and counts the members it dropped', async () => {
    const ql = makeQl([LEGACY_PACKAGE]);
    const { warns, logger } = capture();

    const out = await syncAudienceBindingSuggestions(ql, logger);

    expect(out.created).toBe(0);
    expect(warns).toHaveLength(1);
    expect(warns[0].meta).toMatchObject({
      packages: [{ packageId: 'com.example.legacy', arm: 'adr-0025-legacy-strings', entries: 2 }],
    });
  });

  it('reports a PARTIALLY readable array — the readable set still lands, the dropped strings are still named', async () => {
    const ql = makeQl([{
      enabled: true,
      manifest: {
        id: 'com.example.mixed',
        permissions: [
          'system.user.read',
          { name: 'mixed_readonly', isDefault: true, objects: { crm_account: { allowRead: true } } },
        ],
      },
    }]);
    const { warns, logger } = capture();

    const out = await syncAudienceBindingSuggestions(ql, logger);

    expect(out.created).toBe(1);
    expect(warns).toHaveLength(1);
    expect(warns[0].meta).toMatchObject({
      packages: [{ packageId: 'com.example.mixed', arm: 'adr-0025-legacy-strings', entries: 1 }],
    });
  });

  it('says it ONCE per engine per package — a shape that cannot change does not repeat on every list call', async () => {
    const ql = makeQl([STRUCTURED_PACKAGE]);
    const { warns, logger } = capture();

    await syncAudienceBindingSuggestions(ql, logger);
    await syncAudienceBindingSuggestions(ql, logger);
    await syncAudienceBindingSuggestions(ql, logger);

    expect(warns).toHaveLength(1);

    // A DIFFERENT engine is a different ledger — the dedupe is per kernel, not
    // per process, so a second tenant kernel is still told.
    const other = makeQl([STRUCTURED_PACKAGE]);
    await syncAudienceBindingSuggestions(other, logger);
    expect(warns).toHaveLength(2);
  });

  it('adds no noise on the readable shape — a package declaring permission SETS is never reported', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const { warns, logger } = capture();

    const out = await syncAudienceBindingSuggestions(ql, logger);

    expect(out.created).toBe(1);
    expect(warns).toEqual([]);
  });

  it('is silent with no logger — passing none is the caller’s choice, not a second channel', async () => {
    const ql = makeQl([STRUCTURED_PACKAGE]);
    await expect(syncAudienceBindingSuggestions(ql)).resolves.toMatchObject({ created: 0 });
  });
});

// [ADR-0086 D3] The owner a suggestion is offered, accepted and derived under
// is the set's binding, read from the catalog entry and nothing else. A package
// with no manifest id is served by `makeQl` WITHOUT `_packageId` — the shape
// the catalog serves for a set bound to no package (a stored set saved into
// none, ADR-0086 D3 "absent ⇒ env-authored"). Its body names a package; before
// this change all three readers took that as the owner when the binding was
// absent. The metadata save and publish doors now refuse such a body, so the
// readers read the binding only.
describe('[ADR-0086 D3] a set\'s owner is its binding — a body `packageId` on an unbound set names no owner', () => {
  const CLAIMED = 'com.example.claimed';
  const unboundClaiming = () => ({
    enabled: true,
    manifest: {
      permissions: [
        { name: 'claimed_default', isDefault: true, packageId: CLAIMED, objects: { crm_account: { allowRead: true } } },
      ],
    },
  });
  const claimedRow = (status: 'pending' | 'confirmed') => ({
    id: `sug_claimed_${status}`, package_id: CLAIMED, permission_set_name: 'claimed_default', anchor: 'everyone',
    status, organization_id: DEFAULT_ORG, ...(status === 'confirmed' ? { deployment_decision: true } : {}),
  });

  it('collect + sync: no suggestion is offered under the package the body names', async () => {
    const ql = makeQl([unboundClaiming()]);
    const out = await syncAudienceBindingSuggestions(ql);
    expect(out.created).toBe(0);
    expect(rows(ql)).toEqual([]);
  });

  it('the derivation withholds an acceptance recorded under that package, saying the set is declared by no package', async () => {
    const ql = makeQl([unboundClaiming()]);
    rows(ql).push(claimedRow('confirmed'));
    const derived = await readAcceptedEveryoneSets(ql);
    expect(derived.accepted).toEqual([]);
    expect(derived.withheld).toEqual([
      expect.objectContaining({ set: 'claimed_default', packageId: CLAIMED, forbidden: false }),
    ]);
    expect(derived.withheld[0].reason).toContain("declared by 'no package'");
  });

  it('the accept refuses a pending suggestion under that package; the row stays pending', async () => {
    const ql = makeQl([unboundClaiming()]);
    rows(ql).push(claimedRow('pending'));
    await expect(confirmAudienceBindingSuggestion(makeDeps(ql), ADMIN_CTX, 'sug_claimed_pending'))
      .rejects.toBeInstanceOf(SuggestionStateError);
    expect(rows(ql)[0].status).toBe('pending');
    expect(everyoneSets(ql)).toEqual(BASELINE);
  });

  it('CONTROL: a bound set is offered under its binding whether its body agrees or (a stored row) disagrees', async () => {
    const agreeing = { enabled: true, manifest: { id: 'com.example.agree', permissions: [
      { name: 'agree_default', isDefault: true, packageId: 'com.example.agree', objects: { crm_account: { allowRead: true } } },
    ] } };
    const disagreeing = { enabled: true, manifest: { id: 'com.example.bound', permissions: [
      { name: 'stray_default', isDefault: true, packageId: CLAIMED, objects: { crm_account: { allowRead: true } } },
    ] } };
    const ql = makeQl([agreeing, disagreeing]);
    const out = await syncAudienceBindingSuggestions(ql);
    expect(out.created).toBe(2);
    expect(rows(ql).map((r: any) => [r.permission_set_name, r.package_id]).sort()).toEqual([
      ['agree_default', 'com.example.agree'],
      ['stray_default', 'com.example.bound'],
    ]);
  });
});
