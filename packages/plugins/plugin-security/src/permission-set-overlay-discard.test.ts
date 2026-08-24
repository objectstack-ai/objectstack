// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The sanctioned, audited discard action (field report ask #2 — the field
 * remediation had to delete a `sys_metadata` row by raw SQL; this is that
 * same operation as a supported code path). Pins:
 *
 *  4. the discard action actually restores sync — the healed GRANT SET is
 *     asserted, not just "the action returned ok";
 *  5. ⭐ the discard action refuses what it must — it targets package-
 *     declared sets only, so a genuinely environment-authored set (no
 *     current package declaration under that name) is refused, with no
 *     mutation.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import {
  discardPermissionSetOverlay,
  PermissionSetNotFoundError,
  PermissionSetOverlayStateError,
  type PermissionSetOverlayDiscardDeps,
} from './permission-set-overlay-discard.js';
import { PermissionDeniedError } from './errors.js';
import { permissionSetRowFields } from './permission-set-projection.js';

/** Minimal in-memory ql: sys_permission_set + sys_metadata + delete support. */
function makeQl(declared: any[] = []) {
  const permRows: any[] = [];
  const metaRows: any[] = [];
  const tableFor = (object: string) =>
    object === 'sys_permission_set' ? permRows : object === 'sys_metadata' ? metaRows : null;
  const matches = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      // REFUSE the combinators this double does not implement rather than
      // reading `$and`/`$or` as a column name (check:where-matcher /
      // #8494) -- discardPermissionSetOverlay's ql.find/update/delete calls
      // (by id, or by type+name+state) never issue one; a matcher that
      // silently treated a combinator as a field name would let a future
      // combinator query pass this suite while answering the wrong rows.
      if (k.startsWith('$')) {
        throw new Error(`fake driver: unsupported combinator ${k}`);
      }
      return r[k] === v;
    });
  return {
    permRows,
    metaRows,
    registry: { listItems: (type: string) => (type === 'permission' ? declared : []) },
    async find(object: string, q: any) {
      const rows = tableFor(object);
      return rows ? rows.filter((r) => matches(r, q?.where)) : [];
    },
    // Routed through the real dispatch predicate (#4434 / check:engine-double-contract):
    // a fake looser than ObjectQL.update would let discardPermissionSetOverlay's
    // fallback (degraded-kernel) path drift to a call shape the real engine refuses.
    async update(object: string, data: any, options?: any) {
      const rows = tableFor(object);
      const dispatch = assertEngineUpdateDispatch(data, options);
      const targets = dispatch.kind === 'by-id'
        ? (rows ?? []).filter((r: any) => r.id === dispatch.id)
        : (rows ?? []).filter((r: any) => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    // Same reason, delete half: this is the exact mouth `discardPermissionSetOverlay`
    // uses to remove the stale `sys_metadata` overlay row.
    async delete(object: string, opts: any) {
      const rows = tableFor(object);
      const dispatch = assertEngineDeleteDispatch(opts);
      if (!rows) return dispatch.kind === 'by-id' ? false : 0;
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r: any) => r.id === dispatch.id)
        : rows.filter((r: any) => matches(r, opts?.where));
      const remaining = rows.filter((r: any) => !targets.includes(r));
      rows.length = 0;
      rows.push(...remaining);
      return dispatch.kind === 'by-id' ? targets.length > 0 : targets.length;
    },
  };
}

/** Fake metadata protocol: `getMetaItemLayered` reads the overlay straight off `ql.metaRows`. */
function makeProtocol(ql: ReturnType<typeof makeQl>) {
  return {
    async getMetaItemLayered({ name }: { type: string; name: string }) {
      const overlayRow = ql.metaRows.find(
        (r: any) => r.type === 'permission' && r.name === name && r.state === 'active' && (r.organization_id ?? null) === null,
      );
      const overlay = overlayRow ? JSON.parse(overlayRow.metadata) : null;
      return { type: 'permission', name, code: null, overlay, effective: overlay };
    },
  };
}

const declaredSet = (over: Record<string, any> = {}) => ({
  name: 'ehr_quality_inspector',
  label: 'Quality Inspector',
  objects: { obj_a: { allowRead: true }, obj_b: { allowRead: true }, obj_c: { allowRead: true } }, // 3-object artifact
  _packageId: 'com.example.ehr',
  ...over,
});

const overlayRow = (staleObjects: Record<string, any>) => ({
  id: 'meta_1', type: 'permission', name: 'ehr_quality_inspector', state: 'active', organization_id: null,
  metadata: JSON.stringify({ name: 'ehr_quality_inspector', objects: staleObjects }),
});

const tenantAdminCtx = { userId: 'u_admin', isSystem: false };

function deps(ql: ReturnType<typeof makeQl>, protocol: any = makeProtocol(ql)): PermissionSetOverlayDiscardDeps {
  return {
    ql,
    metadata: { registerInMemory() {}, get: async () => undefined, unregister() {} },
    // `isTenantAdmin` (delegated-admin-gate.ts) keys on a resolved set's `'*'`
    // wildcard `modifyAllRecords: true` — NOT `systemPermissions` — so the
    // fixture representing "caller is a tenant admin" has to carry that.
    resolveSets: async () => [{ name: 'platform_admin', objects: { '*': { modifyAllRecords: true } }, fields: {}, systemPermissions: [] } as any],
    getProtocol: () => protocol,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

describe('discardPermissionSetOverlay — pin 4: actually restores sync', () => {
  it('discards the stale overlay and heals the row to the CURRENT declared artifact (asserts the healed grant set)', async () => {
    const artifact = declaredSet(); // ships 3 objects
    const ql = makeQl([artifact]);
    ql.permRows.push({
      id: 'ps_1', name: 'ehr_quality_inspector', managed_by: 'package', package_id: 'com.example.ehr',
      ...permissionSetRowFields(artifact),
      // enforced content overridden below to the STALE overlay's 2-object shape
      object_permissions: JSON.stringify({ obj_a: { allowRead: true }, obj_b: { allowRead: true } }),
    });
    ql.metaRows.push(overlayRow({ obj_a: {}, obj_b: {} })); // the stale overlay (2 objects, missing obj_c)

    const result = await discardPermissionSetOverlay(deps(ql), tenantAdminCtx, 'ps_1');

    expect(result.overlaysDiscarded).toBe(1);
    expect(ql.metaRows).toHaveLength(0); // the overlay row is gone
    // The healed row now enforces the ARTIFACT's full 3-object grant set —
    // not merely "an update happened".
    expect(result.healedObjectGrantCount).toBe(3);
    const healedObjects = JSON.parse(result.permissionSet.object_permissions);
    expect(Object.keys(healedObjects).sort()).toEqual(['obj_a', 'obj_b', 'obj_c']);
    expect(result.permissionSet.customized).toBe(false); // no overlay left to badge
  });

  it('the CONFOUNDED field-reported shape (managed_by wrong AND overlay present) still discards and heals — eligibility is NOT gated on managed_by', async () => {
    const artifact = declaredSet();
    const ql = makeQl([artifact]);
    ql.permRows.push({
      id: 'ps_1', name: 'ehr_quality_inspector', managed_by: 'admin', // wrong provenance — the confound
      ...permissionSetRowFields(artifact),
      object_permissions: JSON.stringify({ obj_a: { allowRead: true } }),
    });
    ql.metaRows.push(overlayRow({ obj_a: {} }));

    const result = await discardPermissionSetOverlay(deps(ql), tenantAdminCtx, 'ps_1');
    expect(result.healedObjectGrantCount).toBe(3);
    expect(ql.metaRows).toHaveLength(0);
  });
});

describe('discardPermissionSetOverlay — pin 5: refuses what it must', () => {
  it('refuses a set with NO current package declaration (genuinely environment-authored) — no mutation', async () => {
    const ql = makeQl([]); // nothing declared by any package
    ql.permRows.push({
      id: 'ps_env', name: 'sales_readonly', managed_by: 'admin',
      object_permissions: JSON.stringify({ crm_lead: { allowRead: true } }),
    });
    ql.metaRows.push({
      id: 'meta_env', type: 'permission', name: 'sales_readonly', state: 'active', organization_id: null,
      metadata: JSON.stringify({ name: 'sales_readonly', objects: { crm_lead: { allowRead: true } } }),
    });

    await expect(discardPermissionSetOverlay(deps(ql), tenantAdminCtx, 'ps_env'))
      .rejects.toBeInstanceOf(PermissionDeniedError);

    // No mutation: the overlay is still there, the row is untouched.
    expect(ql.metaRows).toHaveLength(1);
    expect(JSON.parse(ql.permRows[0].object_permissions)).toEqual({ crm_lead: { allowRead: true } });
  });

  it('a NAME COLLISION with a genuinely env-authored set is refused even though a DIFFERENT package declares an unrelated set (name match against the declared registry only)', async () => {
    // `readDeclared` returns items for OTHER names too — eligibility must
    // match on the TARGET row's own name, not "some package declares
    // something".
    const ql = makeQl([declaredSet({ name: 'crm_admin' })]);
    ql.permRows.push({ id: 'ps_env', name: 'sales_readonly', managed_by: 'admin', object_permissions: '{}' });
    ql.metaRows.push({
      id: 'meta_env', type: 'permission', name: 'sales_readonly', state: 'active', organization_id: null,
      metadata: JSON.stringify({ name: 'sales_readonly', objects: {} }),
    });
    await expect(discardPermissionSetOverlay(deps(ql), tenantAdminCtx, 'ps_env'))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('404s on an unknown id', async () => {
    const ql = makeQl([declaredSet()]);
    await expect(discardPermissionSetOverlay(deps(ql), tenantAdminCtx, 'nope'))
      .rejects.toBeInstanceOf(PermissionSetNotFoundError);
  });

  it('409s when the package-declared set has no active overlay to discard', async () => {
    const artifact = declaredSet();
    const ql = makeQl([artifact]);
    ql.permRows.push({
      id: 'ps_1', name: 'ehr_quality_inspector', managed_by: 'package', package_id: 'com.example.ehr',
      ...permissionSetRowFields(artifact),
    });
    // no overlay row
    await expect(discardPermissionSetOverlay(deps(ql), tenantAdminCtx, 'ps_1'))
      .rejects.toBeInstanceOf(PermissionSetOverlayStateError);
  });

  it('refuses an unauthenticated / non-admin caller before touching anything', async () => {
    const artifact = declaredSet();
    const ql = makeQl([artifact]);
    ql.permRows.push({
      id: 'ps_1', name: 'ehr_quality_inspector', managed_by: 'package', package_id: 'com.example.ehr',
      ...permissionSetRowFields(artifact),
    });
    ql.metaRows.push(overlayRow({ obj_a: {} }));
    const nonAdminDeps: PermissionSetOverlayDiscardDeps = {
      ...deps(ql),
      resolveSets: async () => [], // not a tenant admin
    };
    await expect(discardPermissionSetOverlay(nonAdminDeps, tenantAdminCtx, 'ps_1'))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    expect(ql.metaRows).toHaveLength(1); // untouched
  });
});
