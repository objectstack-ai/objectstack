// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// ADR-0090 D5/D9 — suggested audience bindings: the queryable install-time
// suggestion surface and the tenant-admin confirm/dismiss flow.

import { describe, it, expect } from 'vitest';
import {
  syncAudienceBindingSuggestions,
  listAudienceBindingSuggestions,
  confirmAudienceBindingSuggestion,
  dismissAudienceBindingSuggestion,
  SuggestionNotFoundError,
  SuggestionStateError,
  type SuggestionDeps,
} from './suggested-audience-bindings';

/** In-memory ObjectQL stub (same shape as audience-anchors.test.ts) with an
 *  installed-package registry and insert-call recording so tests can assert
 *  WHICH context a write carried. */
function makeQl(packages: any[] = []) {
  const tables: Record<string, any[]> = {
    sys_position: [{ id: 'pos_everyone', name: 'everyone' }, { id: 'pos_guest', name: 'guest' }],
    sys_permission_set: [],
    sys_position_permission_set: [],
    sys_audience_binding_suggestion: [],
  };
  const insertCalls: Array<{ object: string; data: any; opts: any }> = [];
  return {
    tables,
    insertCalls,
    registry: {
      getAllPackages: () => packages,
      listItems: (_type: string) => [],
    },
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      return (tables[object] ?? []).filter((r) =>
        Object.entries(where).every(([k, v]) => (r as any)[k] === v),
      );
    },
    async insert(object: string, data: any, opts?: any) {
      insertCalls.push({ object, data, opts });
      (tables[object] ??= []).push(data);
      return data;
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
  } as any;
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

const ADMIN_SET = { name: 'admin_full', objects: { '*': { modifyAllRecords: true } } } as any;
const MEMBER_SET = { name: 'member', objects: { crm_account: { allowRead: true } } } as any;

function makeDeps(ql: any, resolvedSets: any[] = [ADMIN_SET]): SuggestionDeps {
  return { ql, resolveSets: async () => resolvedSets };
}

const ADMIN_CTX = { userId: 'usr_admin' };

describe('syncAudienceBindingSuggestions (ADR-0090 D5/D9)', () => {
  it('creates a pending suggestion for an installed package isDefault set', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const out = await syncAudienceBindingSuggestions(ql);
    expect(out.created).toBe(1);
    const rows = ql.tables.sys_audience_binding_suggestion;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      package_id: 'com.example.crm',
      permission_set_name: 'crm_readonly',
      anchor: 'everyone',
      status: 'pending',
    });
  });

  it('is idempotent — a second sync creates nothing new', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    await syncAudienceBindingSuggestions(ql);
    const out2 = await syncAudienceBindingSuggestions(ql);
    expect(out2.created).toBe(0);
    expect(ql.tables.sys_audience_binding_suggestion).toHaveLength(1);
  });

  // [#7677] The boot baseline auto-bind (security-plugin) runs BEFORE the first
  // sync, so on stock every app-declared `isDefault` set is already bound by the
  // time this reconciler first sees it. Skipping those left the whole surface
  // empty on stock — the declaration was only ever surfaced after an admin
  // deleted the binding by hand. It is now recorded in the state it is actually
  // in: confirmed (observed), never pending — a bound declaration is not
  // awaiting a decision.
  it('records an already-bound set as confirmed/observed (the boot baseline) rather than skipping it', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    ql.tables.sys_permission_set.push({ id: 'ps_1', name: 'crm_readonly', package_id: 'com.example.crm' });
    ql.tables.sys_position_permission_set.push({ id: 'pps_1', position_id: 'pos_everyone', permission_set_id: 'ps_1' });

    const out = await syncAudienceBindingSuggestions(ql);

    expect(out.created).toBe(1);
    const rows = ql.tables.sys_audience_binding_suggestion;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      package_id: 'com.example.crm',
      permission_set_name: 'crm_readonly',
      anchor: 'everyone',
      status: 'confirmed',
    });
    // Observed, NOT resolved through the prompt — the object schema defines an
    // empty `resolved_by` on a confirmed row as exactly that.
    expect(rows[0].resolved_by).toBeUndefined();
    expect(rows[0].resolved_at).toBeTruthy();
  });

  it('is idempotent for an already-bound set — a second sync creates nothing and does not duplicate', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    ql.tables.sys_permission_set.push({ id: 'ps_1', name: 'crm_readonly', package_id: 'com.example.crm' });
    ql.tables.sys_position_permission_set.push({ id: 'pps_1', position_id: 'pos_everyone', permission_set_id: 'ps_1' });
    await syncAudienceBindingSuggestions(ql);

    const out2 = await syncAudienceBindingSuggestions(ql);

    expect(out2.created).toBe(0);
    expect(out2.confirmedObserved).toBe(0);
    expect(out2.pruned).toBe(0);
    expect(ql.tables.sys_audience_binding_suggestion).toHaveLength(1);
    expect(ql.tables.sys_audience_binding_suggestion[0].status).toBe('confirmed');
  });

  it('surfaces the stock isDefault declaration through the list endpoint (#7677)', async () => {
    // Stock: the app's isDefault set exists AND the boot auto-bind already
    // bound it to `everyone`. The list must not be empty.
    const ql = makeQl([CRM_PACKAGE]);
    ql.tables.sys_permission_set.push({ id: 'ps_1', name: 'crm_readonly', package_id: 'com.example.crm' });
    ql.tables.sys_position_permission_set.push({ id: 'pps_1', position_id: 'pos_everyone', permission_set_id: 'ps_1' });
    const deps = makeDeps(ql);

    const { suggestions, synced } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});

    expect(synced.created).toBe(1);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      permission_set_name: 'crm_readonly',
      anchor: 'everyone',
      status: 'confirmed',
    });

    // Second call: nothing created, no duplicate row.
    const again = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    expect(again.synced.created).toBe(0);
    expect(again.suggestions).toHaveLength(1);

    // The console panel lists `status=pending` as the actionable prompt set —
    // a satisfied declaration must not appear there (never nag).
    const prompts = await listAudienceBindingSuggestions(deps, ADMIN_CTX, { status: 'pending' });
    expect(prompts.suggestions).toHaveLength(0);
  });

  it('still creates a PENDING row when the declaration is unbound (the discriminating step)', async () => {
    // The card's discriminator: with no binding row, the declaration surfaces
    // as an actionable PENDING suggestion, and it is confirmable end to end.
    const ql = makeQl([CRM_PACKAGE]);
    ql.tables.sys_permission_set.push({ id: 'ps_1', name: 'crm_readonly', package_id: 'com.example.crm' });
    const deps = makeDeps(ql);

    const { suggestions, synced } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    expect(synced.created).toBe(1);
    expect(suggestions[0].status).toBe('pending');

    // …and the pending→confirmed (observed) transition still fires when the
    // binding is observed again.
    ql.tables.sys_position_permission_set.push({ id: 'pps_1', position_id: 'pos_everyone', permission_set_id: 'ps_1' });
    const out = await syncAudienceBindingSuggestions(ql);
    expect(out.confirmedObserved).toBe(1);
    expect(out.created).toBe(0);
    expect(ql.tables.sys_audience_binding_suggestion).toHaveLength(1);
    expect(ql.tables.sys_audience_binding_suggestion[0].status).toBe('confirmed');
  });

  it('marks a pending suggestion confirmed when the binding appears out-of-band', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    await syncAudienceBindingSuggestions(ql);
    ql.tables.sys_permission_set.push({ id: 'ps_1', name: 'crm_readonly', package_id: 'com.example.crm' });
    ql.tables.sys_position_permission_set.push({ id: 'pps_1', position_id: 'pos_everyone', permission_set_id: 'ps_1' });
    const out = await syncAudienceBindingSuggestions(ql);
    expect(out.confirmedObserved).toBe(1);
    expect(ql.tables.sys_audience_binding_suggestion[0].status).toBe('confirmed');
    expect(ql.tables.sys_audience_binding_suggestion[0].resolved_by).toBeUndefined();
  });

  it('prunes a pending suggestion once its declaration is gone (uninstall)', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    await syncAudienceBindingSuggestions(ql);
    ql.registry.getAllPackages = () => [];
    const out = await syncAudienceBindingSuggestions(ql);
    expect(out.pruned).toBe(1);
    expect(ql.tables.sys_audience_binding_suggestion).toHaveLength(0);
  });

  it('keeps a dismissed suggestion as history (never pruned, never re-created)', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    await syncAudienceBindingSuggestions(ql);
    const deps = makeDeps(ql);
    const row = ql.tables.sys_audience_binding_suggestion[0];
    await dismissAudienceBindingSuggestion(deps, ADMIN_CTX, row.id);
    const out = await syncAudienceBindingSuggestions(ql);
    expect(out.created).toBe(0);
    expect(out.pruned).toBe(0);
    expect(ql.tables.sys_audience_binding_suggestion).toHaveLength(1);
    expect(ql.tables.sys_audience_binding_suggestion[0].status).toBe('dismissed');
  });

  it('ignores non-isDefault sets and unowned declarations', async () => {
    const ql = makeQl([
      { enabled: true, manifest: { id: 'p1', permissions: [{ name: 'plain', objects: {} }] } },
      { enabled: true, manifest: { permissions: [{ name: 'orphan', isDefault: true, objects: {} }] } },
    ]);
    const out = await syncAudienceBindingSuggestions(ql);
    expect(out.created).toBe(0);
  });
});

describe('listAudienceBindingSuggestions', () => {
  it('reconciles then returns rows, filterable by status/packageId', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    const { suggestions, synced } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, { status: 'pending' });
    expect(synced.created).toBe(1);
    expect(suggestions).toHaveLength(1);
    const none = await listAudienceBindingSuggestions(deps, ADMIN_CTX, { packageId: 'other.pkg' });
    expect(none.suggestions).toHaveLength(0);
  });

  it('denies a non-tenant-admin caller', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql, [MEMBER_SET]);
    await expect(listAudienceBindingSuggestions(deps, { userId: 'usr_member' })).rejects.toThrow(/tenant-level administrator/);
  });

  it('denies an unauthenticated caller', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    await expect(listAudienceBindingSuggestions(deps, {})).rejects.toThrow(/authenticated/);
  });
});

describe('confirmAudienceBindingSuggestion', () => {
  it('materializes the set if needed and creates the binding WITH the caller context', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, { status: 'pending' });
    const { suggestion, bindingCreated } = await confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id);

    expect(bindingCreated).toBe(true);
    expect(suggestion.status).toBe('confirmed');
    expect(suggestion.resolved_by).toBe('usr_admin');
    expect(suggestion.resolved_at).toBeTruthy();

    // set was materialized through the provenance-checked upsert
    const setRow = ql.tables.sys_permission_set.find((r: any) => r.name === 'crm_readonly');
    expect(setRow).toMatchObject({ package_id: 'com.example.crm', managed_by: 'package' });

    // the binding row exists and the insert carried the CALLER context — the
    // "admin confirms" write must run under the anchor + delegated-admin
    // gates, never isSystem
    const bindingInsert = ql.insertCalls.find((c: any) => c.object === 'sys_position_permission_set');
    expect(bindingInsert.data.position_id).toBe('pos_everyone');
    expect(bindingInsert.opts?.context).toBe(ADMIN_CTX);
    expect(bindingInsert.opts?.context?.isSystem).toBeUndefined();
  });

  it('is a recorded no-op when the binding already exists', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    ql.tables.sys_permission_set.push({ id: 'ps_1', name: 'crm_readonly', package_id: 'com.example.crm' });
    ql.tables.sys_position_permission_set.push({ id: 'pps_1', position_id: 'pos_everyone', permission_set_id: 'ps_1' });
    const { bindingCreated, suggestion } = await confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id);
    expect(bindingCreated).toBe(false);
    expect(suggestion.status).toBe('confirmed');
  });

  it('refuses a suggested set carrying anchor-forbidden bits (early gate)', async () => {
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
    await expect(confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id))
      .rejects.toThrow(/cannot be bound to the 'everyone' audience anchor/);
    expect(ql.tables.sys_position_permission_set).toHaveLength(0);
    // still pending — the admin can retry after the package fixes the set
    expect(ql.tables.sys_audience_binding_suggestion[0].status).toBe('pending');
  });

  it('refuses when the set name is owned by a different package (ADR-0086 D4)', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    ql.tables.sys_permission_set.push({ id: 'ps_x', name: 'crm_readonly', package_id: 'com.other' });
    await expect(confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id))
      .rejects.toThrow(SuggestionStateError);
  });

  it('404s on an unknown id and 409s on a non-pending row', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    await expect(confirmAudienceBindingSuggestion(deps, ADMIN_CTX, 'nope')).rejects.toThrow(SuggestionNotFoundError);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    await dismissAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id);
    await expect(confirmAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id))
      .rejects.toThrow(/already dismissed/);
  });

  it('denies a non-tenant-admin caller before touching anything', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    await listAudienceBindingSuggestions(makeDeps(ql), ADMIN_CTX, {});
    const memberDeps = makeDeps(ql, [MEMBER_SET]);
    const row = ql.tables.sys_audience_binding_suggestion[0];
    await expect(confirmAudienceBindingSuggestion(memberDeps, { userId: 'usr_member' }, row.id))
      .rejects.toThrow(/tenant-level administrator/);
    expect(ql.tables.sys_position_permission_set).toHaveLength(0);
    expect(row.status).toBe('pending');
  });
});

describe('dismissAudienceBindingSuggestion', () => {
  it('marks a pending suggestion dismissed with the resolver identity', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    const { suggestion } = await dismissAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id);
    expect(suggestion.status).toBe('dismissed');
    expect(suggestion.resolved_by).toBe('usr_admin');
    // no binding was ever written
    expect(ql.tables.sys_position_permission_set).toHaveLength(0);
  });

  it('409s on an already-resolved row', async () => {
    const ql = makeQl([CRM_PACKAGE]);
    const deps = makeDeps(ql);
    const { suggestions } = await listAudienceBindingSuggestions(deps, ADMIN_CTX, {});
    await dismissAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id);
    await expect(dismissAudienceBindingSuggestion(deps, ADMIN_CTX, suggestions[0].id))
      .rejects.toThrow(SuggestionStateError);
  });
});
