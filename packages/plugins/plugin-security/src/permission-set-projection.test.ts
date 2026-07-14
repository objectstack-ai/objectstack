// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0094 — sys_permission_set as a pure projection of the metadata layer.
 * Covers the env-door projector (create/update/reset/retire + evaluator
 * registry sync), the data-door write-through middleware, and the boot
 * reconciliation/backfill pass. The package door stays covered in
 * bootstrap-declared-permissions.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  permissionSetRowFields,
  permissionSetBodyFromRow,
  mergeRowPatchIntoBody,
  recordDiffersFromBody,
  upsertEnvPermissionSet,
  projectPermissionMutation,
  registerPermissionSetProjection,
  createPermissionSetWriteThrough,
  reconcilePermissionSetProjection,
} from './permission-set-projection.js';

/** In-memory ql over sys_permission_set + sys_metadata. */
function makeQl() {
  const permRows: any[] = [];
  const metaRows: any[] = [];
  const tableFor = (object: string): any[] | null =>
    object === 'sys_permission_set' ? permRows : object === 'sys_metadata' ? metaRows : null;
  const matches = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => (v === null ? (r[k] ?? null) === null : r[k] === v));
  return {
    permRows,
    metaRows,
    async find(object: string, q: any) {
      const rows = tableFor(object);
      return rows ? rows.filter((r) => matches(r, q?.where)) : [];
    },
    async findOne(object: string, q: any) {
      const rows = tableFor(object);
      return rows?.find((r) => matches(r, q?.where)) ?? null;
    },
    async insert(object: string, data: any) {
      const rows = tableFor(object);
      if (!rows) return null;
      rows.push({ ...data });
      return { id: data.id };
    },
    async update(object: string, data: any) {
      const rows = tableFor(object);
      const r = rows?.find((x) => x.id === data.id);
      if (r) Object.assign(r, data);
    },
    async delete(object: string, opts: any) {
      const rows = tableFor(object);
      if (!rows) return false;
      const id = opts?.where?.id;
      const i = rows.findIndex((x) => x.id === id);
      if (i >= 0) rows.splice(i, 1);
      return i >= 0;
    },
  };
}

/**
 * Mock metadata protocol over the ql's sys_metadata table: env-scope active
 * overlays, layered read (overlay-wins over `declared`), and the ADR-0094
 * awaited mutation-projector seam.
 */
function makeProtocol(ql: any, declared: Record<string, any> = {}) {
  let projector: ((evt: any) => Promise<void>) | null = null;
  const overlayFor = (name: string) =>
    ql.metaRows.find(
      (r: any) =>
        r.type === 'permission' && r.name === name && r.state === 'active' && (r.organization_id ?? null) === null,
    );
  const protocol = {
    saves: [] as any[],
    deletes: [] as any[],
    registerMutationProjector(_type: string, fn: (evt: any) => Promise<void>) {
      projector = fn;
    },
    async saveMetaItem(req: { type: string; name: string; item: any; actor?: string }) {
      const existing = overlayFor(req.name);
      if (existing) existing.metadata = JSON.stringify(req.item);
      else {
        ql.metaRows.push({
          id: `meta_${req.name}`, type: 'permission', name: req.name, state: 'active',
          organization_id: null, metadata: JSON.stringify(req.item),
        });
      }
      protocol.saves.push({ ...req });
      if (projector) await projector({ type: 'permission', name: req.name, state: 'active', organizationId: null, body: req.item });
      return { success: true };
    },
    async deleteMetaItem(req: { type: string; name: string; actor?: string }) {
      const i = ql.metaRows.findIndex(
        (r: any) => r.type === 'permission' && r.name === req.name && (r.organization_id ?? null) === null,
      );
      if (i >= 0) ql.metaRows.splice(i, 1);
      protocol.deletes.push({ ...req });
      if (projector) await projector({ type: 'permission', name: req.name, state: 'deleted', organizationId: null });
      return { success: true, reset: true };
    },
    async getMetaItemLayered(req: { type: string; name: string }) {
      const code = declared[req.name] ?? null;
      const o = overlayFor(req.name);
      const overlay = o ? JSON.parse(o.metadata) : null;
      return {
        type: 'permission', name: req.name, code, overlay,
        overlayScope: overlay ? 'env' : null, effective: overlay ?? code,
      };
    },
  };
  return protocol;
}

/** Metadata-manager facade stub for the evaluator-registry sync. */
function makeMetadataFacade() {
  const registry = new Map<string, any>();
  return {
    registry,
    registerInMemory(type: string, name: string, body: any) {
      registry.set(`${type}/${name}`, body);
    },
    async get(type: string, name: string) {
      return registry.get(`${type}/${name}`);
    },
    unregister(type: string, name: string) {
      registry.delete(`${type}/${name}`);
    },
  };
}

const envBody = (over: Record<string, any> = {}) => ({
  name: 'organization_admin',
  label: 'Organization Administrator',
  objects: { crm_lead: { allowRead: true, allowEdit: true } },
  fields: { 'crm_lead.amount': { readable: true, editable: false } },
  systemPermissions: ['setup.access', 'manage_org_users'],
  rowLevelSecurity: [{ name: 'tenant', object: '*', operation: 'all', using: 'org == current_user.org', enabled: true }],
  tabPermissions: { crm_leads: 'visible' },
  adminScope: { businessUnit: 'Sales', includeSubtree: true, assignablePermissionSets: ['member_default'] },
  ...over,
});

describe('permissionSetBodyFromRow / permissionSetRowFields (round-trip)', () => {
  it('rebuilds the body a row was projected from', () => {
    const fields = permissionSetRowFields(envBody());
    const row = { id: 'ps_1', name: 'organization_admin', active: true, ...fields };
    const body = permissionSetBodyFromRow(row);
    expect(body.name).toBe('organization_admin');
    expect(body.label).toBe('Organization Administrator');
    expect(body.objects).toEqual(envBody().objects);
    expect(body.fields).toEqual(envBody().fields);
    expect(body.systemPermissions).toEqual(envBody().systemPermissions);
    expect(body.rowLevelSecurity[0].using).toBe('org == current_user.org');
    expect(body.tabPermissions).toEqual({ crm_leads: 'visible' });
    expect(body.adminScope.businessUnit).toBe('Sales');
    expect(body.active).toBe(true);
    // and projecting the rebuilt body changes nothing
    expect(recordDiffersFromBody(row, body)).toBe(false);
  });
});

describe('upsertEnvPermissionSet (ADR-0094 — record is a pure projection)', () => {
  it('CREATES a missing record (managed_by user) — Studio-authored sets appear in Setup', async () => {
    const ql = makeQl();
    const r = await upsertEnvPermissionSet(ql, envBody());
    expect(r.seeded).toBe(1);
    const row = ql.permRows[0];
    expect(row.name).toBe('organization_admin');
    expect(row.managed_by).toBe('user');
    expect(row.active).toBe(true);
    expect(JSON.parse(row.object_permissions)).toEqual(envBody().objects);
  });

  it('projects all facets (and active) onto an existing env-authored row', async () => {
    const ql = makeQl();
    ql.permRows.push({ id: 'ps_env', name: 'organization_admin', managed_by: 'user', system_permissions: '[]', active: true });
    const r = await upsertEnvPermissionSet(ql, envBody({ active: false }));
    expect(r.updated).toBe(1);
    const row = ql.permRows[0];
    expect(row.id).toBe('ps_env'); // id stable — junction FKs stay valid
    expect(JSON.parse(row.system_permissions)).toEqual(['setup.access', 'manage_org_users']);
    expect(JSON.parse(row.admin_scope).businessUnit).toBe('Sales');
    expect(row.active).toBe(false);
  });

  it('projects onto a legacy row with ABSENT provenance (platform default)', async () => {
    const ql = makeQl();
    ql.permRows.push({ id: 'ps_legacy', name: 'organization_admin', system_permissions: '[]' });
    const r = await upsertEnvPermissionSet(ql, envBody());
    expect(r.updated).toBe(1);
  });

  it('projects onto a PACKAGE-OWNED row (overlay customization) while preserving its provenance', async () => {
    // Direction confirmed 2026-07-14: an env overlay of a packaged set is the
    // platform's standard ADR-0005 customization — the record follows the
    // effective body; the package still owns the row.
    const ql = makeQl();
    ql.permRows.push({ id: 'ps_pkg', name: 'organization_admin', managed_by: 'package', package_id: 'com.example.crm', system_permissions: '["pkg"]' });
    const r = await upsertEnvPermissionSet(ql, envBody());
    expect(r.updated).toBe(1);
    const row = ql.permRows[0];
    expect(JSON.parse(row.system_permissions)).toEqual(['setup.access', 'manage_org_users']);
    expect(row.managed_by).toBe('package'); // provenance preserved
    expect(row.package_id).toBe('com.example.crm');
    expect(row.id).toBe('ps_pkg'); // id stable
  });
});

describe('projectPermissionMutation (the awaited projector)', () => {
  it('re-reads the fresh layered body and projects it (record + evaluator registry)', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.metaRows.push({ id: 'm1', type: 'permission', name: 'organization_admin', state: 'active', organization_id: null, metadata: JSON.stringify(envBody()) });
    const metadata = makeMetadataFacade();
    const r = await projectPermissionMutation(protocol, { ql, metadata }, { type: 'permission', name: 'organization_admin', state: 'active' });
    expect(r?.seeded).toBe(1);
    expect(ql.permRows[0].managed_by).toBe('user');
    // evaluator's registry-first list('permission') now resolves the same body,
    // marked as a projection echo so it can never masquerade as an artifact
    const entry = metadata.registry.get('permission/organization_admin');
    expect(entry?.systemPermissions).toEqual(['setup.access', 'manage_org_users']);
    expect(entry?._envProjection).toBe(true);
  });

  it('overlay delete on a DECLARED set heals the registry echo back to the declared body', async () => {
    const ql = makeQl();
    const declaredBody = envBody({ systemPermissions: ['declared.only'] });
    const declared = { organization_admin: declaredBody };
    // engine SchemaRegistry — the artifact source the projection never writes
    (ql as any)._registry = { listItems: (t: string) => (t === 'permission' ? [declaredBody] : []) };
    const protocol = makeProtocol(ql, declared);
    const metadata = makeMetadataFacade();
    const deps = { ql, metadata };
    // env overlay shadows the declaration → registry synced with marked overlay body
    ql.metaRows.push({ id: 'm1', type: 'permission', name: 'organization_admin', state: 'active', organization_id: null, metadata: JSON.stringify(envBody({ systemPermissions: ['overlaid'] })) });
    await projectPermissionMutation(protocol, deps, { type: 'permission', name: 'organization_admin', state: 'active' });
    expect(metadata.registry.get('permission/organization_admin')?.systemPermissions).toEqual(['overlaid']);
    // overlay deleted → record resets to declared AND the echo heals to declared
    ql.metaRows.length = 0;
    await projectPermissionMutation(protocol, deps, { type: 'permission', name: 'organization_admin', state: 'deleted' });
    expect(JSON.parse(ql.permRows[0].system_permissions)).toEqual(['declared.only']);
    const healed = metadata.registry.get('permission/organization_admin');
    expect(healed?.systemPermissions).toEqual(['declared.only']);
    expect(healed?._envProjection).toBeUndefined();
  });

  it('skips draft saves and non-permission events', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    expect(await projectPermissionMutation(protocol, { ql }, { type: 'permission', name: 'x', state: 'draft' })).toBeNull();
    expect(await projectPermissionMutation(protocol, { ql }, { type: 'object', name: 'x', state: 'active' })).toBeNull();
  });

  it('a delete that leaves NO body retires the record and drops the registry entry', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql); // no declared artifact, no overlay
    const metadata = makeMetadataFacade();
    metadata.registry.set('permission/organization_admin', envBody());
    ql.permRows.push({ id: 'ps_env', name: 'organization_admin', managed_by: 'user' });
    const r = await projectPermissionMutation(protocol, { ql, metadata }, { type: 'permission', name: 'organization_admin', state: 'deleted' });
    expect(r?.deleted).toBe(1);
    expect(ql.permRows.length).toBe(0);
    expect(metadata.registry.has('permission/organization_admin')).toBe(false);
  });

  it('a delete that reveals the artifact baseline RESETS the record instead (ADR-0005 reset)', async () => {
    const ql = makeQl();
    const declared = { organization_admin: envBody({ systemPermissions: ['declared.only'] }) };
    const protocol = makeProtocol(ql, declared);
    ql.permRows.push({ id: 'ps_env', name: 'organization_admin', managed_by: 'user', system_permissions: '["overlaid"]' });
    const r = await projectPermissionMutation(protocol, { ql }, { type: 'permission', name: 'organization_admin', state: 'deleted' });
    expect(r?.updated).toBe(1);
    expect(ql.permRows.length).toBe(1);
    expect(JSON.parse(ql.permRows[0].system_permissions)).toEqual(['declared.only']);
  });
});

describe('registerPermissionSetProjection', () => {
  it('prefers the awaited registerMutationProjector seam — a save projects before it returns', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    expect(registerPermissionSetProjection(protocol, { ql })).toBe(true);
    await protocol.saveMetaItem({ type: 'permission', name: 'organization_admin', item: envBody() });
    // no timers, no event loop yield — the record is already there
    expect(ql.permRows.length).toBe(1);
    expect(ql.permRows[0].name).toBe('organization_admin');
  });

  it('falls back to onMetadataMutation on older protocols, and returns false with neither', async () => {
    const ql = makeQl();
    let listener: any = null;
    const older = {
      onMetadataMutation: (fn: any) => { listener = fn; return () => {}; },
      getMetaItemLayered: async () => ({ effective: envBody(), code: null }),
    };
    expect(registerPermissionSetProjection(older, { ql })).toBe(true);
    listener({ type: 'permission', name: 'organization_admin', state: 'active' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ql.permRows.length).toBe(1);
    expect(registerPermissionSetProjection({}, { ql })).toBe(false);
    expect(registerPermissionSetProjection(null, { ql })).toBe(false);
  });
});

// ── Package-set customization via overlay (ADR-0094, direction 2026-07-14) ──

describe('package-owned set customization lifecycle (env overlay)', () => {
  it('a Studio env-scope save on a PACKAGE name customizes the record and keeps provenance', async () => {
    const ql = makeQl();
    const declaredBody = envBody({ systemPermissions: ['pkg.baseline'] });
    (ql as any)._registry = { listItems: (t: string) => (t === 'permission' ? [declaredBody] : []) };
    const protocol = makeProtocol(ql, { organization_admin: declaredBody });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push({ id: 'ps_pkg', name: 'organization_admin', managed_by: 'package', package_id: 'com.example.crm', system_permissions: '["pkg.baseline"]' });

    await protocol.saveMetaItem({ type: 'permission', name: 'organization_admin', item: envBody({ systemPermissions: ['customized'] }) });

    const row = ql.permRows[0];
    expect(JSON.parse(row.system_permissions)).toEqual(['customized']);
    expect(row.managed_by).toBe('package');
    expect(row.package_id).toBe('com.example.crm');
    expect(row.customized, 'package row now carries an overlay → flagged customized').toBe(true);
  });

  it('deleting the overlay RESETS the package record to its declared baseline', async () => {
    const ql = makeQl();
    const declaredBody = envBody({ systemPermissions: ['pkg.baseline'] });
    (ql as any)._registry = { listItems: (t: string) => (t === 'permission' ? [declaredBody] : []) };
    const protocol = makeProtocol(ql, { organization_admin: declaredBody });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push({ id: 'ps_pkg', name: 'organization_admin', managed_by: 'package', package_id: 'com.example.crm', system_permissions: '["pkg.baseline"]' });

    await protocol.saveMetaItem({ type: 'permission', name: 'organization_admin', item: envBody({ systemPermissions: ['customized'] }) });
    expect(JSON.parse(ql.permRows[0].system_permissions)).toEqual(['customized']);

    await protocol.deleteMetaItem({ type: 'permission', name: 'organization_admin' });
    const row = ql.permRows[0];
    expect(row, 'a packaged definition is never removed by an overlay reset').toBeTruthy();
    expect(JSON.parse(row.system_permissions)).toEqual(['pkg.baseline']);
    expect(row.managed_by).toBe('package');
    expect(row.customized, 'reset clears the customized flag').toBe(false);
  });
});

// ── Data-door write-through (ADR-0094 D3) ───────────────────────────────────

function makeMiddleware(ql: any, protocol: any, metadata?: any) {
  return createPermissionSetWriteThrough({ ql, metadata, getProtocol: () => protocol });
}

async function run(mw: any, opCtx: any): Promise<boolean> {
  let nextCalled = false;
  await mw(opCtx, async () => { nextCalled = true; });
  return nextCalled;
}

describe('createPermissionSetWriteThrough (data door → metadata store)', () => {
  const userCtx = { userId: 'usr_admin' };

  it('passes system-context writes through (the projector/seeder channel)', async () => {
    const ql = makeQl();
    const mw = makeMiddleware(ql, makeProtocol(ql));
    const nextCalled = await run(mw, { object: 'sys_permission_set', operation: 'insert', data: { name: 'x' }, context: { isSystem: true } });
    expect(nextCalled).toBe(true);
  });

  it('passes through when the protocol is missing/incapable (single store — no split brain)', async () => {
    const ql = makeQl();
    const mw = createPermissionSetWriteThrough({ ql, getProtocol: () => null });
    const nextCalled = await run(mw, { object: 'sys_permission_set', operation: 'insert', data: { name: 'x' }, context: userCtx });
    expect(nextCalled).toBe(true);
  });

  it('INSERT authors the definition into metadata; the record is projector-created (no driver write)', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    registerPermissionSetProjection(protocol, { ql });
    const mw = makeMiddleware(ql, protocol);
    const opCtx: any = {
      object: 'sys_permission_set', operation: 'insert', context: userCtx,
      data: {
        name: 'support_agent', label: 'Support Agent',
        object_permissions: JSON.stringify({ ticket: { allowRead: true } }),
        system_permissions: '["support.use"]',
      },
    };
    const nextCalled = await run(mw, opCtx);
    expect(nextCalled).toBe(false); // driver write skipped
    expect(protocol.saves.length).toBe(1);
    expect(protocol.saves[0].actor).toBe('usr_admin');
    expect(protocol.saves[0].item.objects).toEqual({ ticket: { allowRead: true } });
    expect(ql.permRows.length).toBe(1);
    expect(ql.permRows[0].managed_by).toBe('user');
    expect(opCtx.result?.name).toBe('support_agent');
  });

  it('INSERT of a duplicate name is rejected with 409', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.permRows.push({ id: 'ps_1', name: 'support_agent', managed_by: 'user' });
    const mw = makeMiddleware(ql, protocol);
    await expect(
      run(mw, { object: 'sys_permission_set', operation: 'insert', data: { name: 'support_agent' }, context: userCtx }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('UPDATE merges the column patch into the layered effective body and saves metadata', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    registerPermissionSetProjection(protocol, { ql });
    // existing env set: record + overlay
    await protocol.saveMetaItem({ type: 'permission', name: 'organization_admin', item: envBody() });
    const rowId = ql.permRows[0].id;
    const mw = makeMiddleware(ql, protocol);
    const opCtx: any = {
      object: 'sys_permission_set', operation: 'update', context: userCtx,
      data: { id: rowId, system_permissions: '["setup.access"]', active: false },
    };
    const nextCalled = await run(mw, opCtx);
    expect(nextCalled).toBe(false);
    // metadata is the store that changed…
    const overlay = JSON.parse(ql.metaRows[0].metadata);
    expect(overlay.systemPermissions).toEqual(['setup.access']);
    expect(overlay.active).toBe(false);
    expect(overlay.objects).toEqual(envBody().objects); // unmentioned facets preserved
    // …and the record followed via projection
    expect(JSON.parse(ql.permRows[0].system_permissions)).toEqual(['setup.access']);
    expect(ql.permRows[0].active).toBe(false);
    expect(ql.permRows[0].id).toBe(rowId);
    expect(opCtx.result?.id).toBe(rowId);
  });

  it('UPDATE that renames is rejected (the name is the metadata identity)', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.permRows.push({ id: 'ps_1', name: 'organization_admin', managed_by: 'user' });
    const mw = makeMiddleware(ql, protocol);
    await expect(
      run(mw, { object: 'sys_permission_set', operation: 'update', data: { id: 'ps_1', name: 'renamed' }, context: userCtx }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('DELETE of a runtime-only set hard-deletes the definition and retires the record', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    registerPermissionSetProjection(protocol, { ql });
    await protocol.saveMetaItem({ type: 'permission', name: 'organization_admin', item: envBody() });
    const rowId = ql.permRows[0].id;
    const mw = makeMiddleware(ql, protocol);
    const nextCalled = await run(mw, {
      object: 'sys_permission_set', operation: 'delete', options: { where: { id: rowId } }, context: userCtx,
    });
    expect(nextCalled).toBe(false);
    expect(protocol.deletes.length).toBe(1);
    expect(ql.metaRows.length).toBe(0);
    expect(ql.permRows.length).toBe(0);
  });

  it('DELETE of an artifact-backed set resets the record to the declared body instead of removing it', async () => {
    const ql = makeQl();
    const declared = { organization_admin: envBody({ systemPermissions: ['declared.only'] }) };
    const protocol = makeProtocol(ql, declared);
    registerPermissionSetProjection(protocol, { ql });
    // env overlay shadows the declaration; record projected from the overlay
    await protocol.saveMetaItem({ type: 'permission', name: 'organization_admin', item: envBody({ systemPermissions: ['overlaid'] }) });
    expect(JSON.parse(ql.permRows[0].system_permissions)).toEqual(['overlaid']);
    const mw = makeMiddleware(ql, protocol);
    const nextCalled = await run(mw, {
      object: 'sys_permission_set', operation: 'delete', options: { where: { id: ql.permRows[0].id } }, context: userCtx,
    });
    expect(nextCalled).toBe(false);
    expect(ql.permRows.length).toBe(1); // record survives…
    expect(JSON.parse(ql.permRows[0].system_permissions)).toEqual(['declared.only']); // …reset to the declaration
  });

  it('UPDATE of a PACKAGE-OWNED set becomes an env overlay; the record keeps its provenance', async () => {
    const ql = makeQl();
    const declaredBody = envBody({ name: 'crm_rep', systemPermissions: ['pkg.baseline'] });
    (ql as any)._registry = { listItems: (t: string) => (t === 'permission' ? [declaredBody] : []) };
    const protocol = makeProtocol(ql, { crm_rep: declaredBody });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push({
      id: 'ps_pkg', name: 'crm_rep', managed_by: 'package', package_id: 'com.example.crm',
      system_permissions: '["pkg.baseline"]',
    });
    const mw = makeMiddleware(ql, protocol);
    const opCtx: any = {
      object: 'sys_permission_set', operation: 'update', context: userCtx,
      data: { id: 'ps_pkg', system_permissions: '["customized"]' },
    };
    const nextCalled = await run(mw, opCtx);
    expect(nextCalled).toBe(false);
    // The customization lives in the metadata overlay…
    expect(JSON.parse(ql.metaRows[0].metadata).systemPermissions).toEqual(['customized']);
    // …the record projects it, and the package still owns the row.
    const row = ql.permRows[0];
    expect(JSON.parse(row.system_permissions)).toEqual(['customized']);
    expect(row.managed_by).toBe('package');
    expect(row.package_id).toBe('com.example.crm');
  });

  it('DELETE of a customized PACKAGE set removes the overlay and resets to the declared baseline', async () => {
    const ql = makeQl();
    const declaredBody = envBody({ name: 'crm_rep', systemPermissions: ['pkg.baseline'] });
    (ql as any)._registry = { listItems: (t: string) => (t === 'permission' ? [declaredBody] : []) };
    const protocol = makeProtocol(ql, { crm_rep: declaredBody });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push({ id: 'ps_pkg', name: 'crm_rep', managed_by: 'package', package_id: 'com.example.crm', system_permissions: '["pkg.baseline"]' });
    const mw = makeMiddleware(ql, protocol);
    // customize first
    await run(mw, { object: 'sys_permission_set', operation: 'update', context: userCtx, data: { id: 'ps_pkg', system_permissions: '["customized"]' } });
    expect(JSON.parse(ql.permRows[0].system_permissions)).toEqual(['customized']);
    // "delete" = reset
    const nextCalled = await run(mw, { object: 'sys_permission_set', operation: 'delete', options: { where: { id: 'ps_pkg' } }, context: userCtx });
    expect(nextCalled).toBe(false);
    expect(ql.metaRows.length).toBe(0); // overlay gone
    expect(ql.permRows.length).toBe(1); // record survives
    expect(JSON.parse(ql.permRows[0].system_permissions)).toEqual(['pkg.baseline']);
    expect(ql.permRows[0].managed_by).toBe('package');
  });

  it('SINGLE-STORE kernel (no protocol): package rows keep the legacy two-doors refusal', async () => {
    const ql = makeQl();
    ql.permRows.push({ id: 'ps_pkg', name: 'crm_rep', managed_by: 'package', package_id: 'com.example.crm' });
    const mw = createPermissionSetWriteThrough({ ql, getProtocol: () => null });
    await expect(
      run(mw, { object: 'sys_permission_set', operation: 'update', data: { id: 'ps_pkg', label: 'hijack' }, context: userCtx }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      run(mw, { object: 'sys_permission_set', operation: 'delete', options: { where: { id: 'ps_pkg' } }, context: userCtx }),
    ).rejects.toMatchObject({ status: 403 });
    // env rows still pass through to the driver in single-store kernels
    ql.permRows.push({ id: 'ps_env', name: 'my_custom', managed_by: 'user' });
    expect(await run(mw, { object: 'sys_permission_set', operation: 'update', data: { id: 'ps_env', label: 'ok' }, context: userCtx })).toBe(true);
  });

  it('leaves non-sys_permission_set objects and unrelated operations alone', async () => {
    const ql = makeQl();
    const mw = makeMiddleware(ql, makeProtocol(ql));
    expect(await run(mw, { object: 'sys_user', operation: 'insert', data: {}, context: { userId: 'u' } })).toBe(true);
    expect(await run(mw, { object: 'sys_permission_set', operation: 'find', context: { userId: 'u' } })).toBe(true);
  });
});

// ── Boot reconciliation + one-time backfill (ADR-0094 D4) ───────────────────

describe('reconcilePermissionSetProjection', () => {
  it('projects env overlays onto records, creating missing ones', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.metaRows.push({ id: 'm1', type: 'permission', name: 'organization_admin', state: 'active', organization_id: null, metadata: JSON.stringify(envBody()) });
    const out = await reconcilePermissionSetProjection(protocol, { ql });
    expect(out.projectedFromMetadata).toBe(1);
    expect(ql.permRows[0]?.name).toBe('organization_admin');
    expect(ql.permRows[0]?.managed_by).toBe('user');
  });

  it('backfills a legacy data-door-only record into the metadata store ONCE', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.permRows.push({
      id: 'ps_legacy', name: 'support_agent', managed_by: 'user', active: true,
      label: 'Support Agent', object_permissions: JSON.stringify({ ticket: { allowRead: true } }),
      system_permissions: '["support.use"]',
    });
    const out = await reconcilePermissionSetProjection(protocol, { ql });
    expect(out.backfilledIntoMetadata).toBe(1);
    expect(ql.metaRows.length).toBe(1);
    const body = JSON.parse(ql.metaRows[0].metadata);
    expect(body.objects).toEqual({ ticket: { allowRead: true } });
    // second run: the overlay now exists — nothing to backfill again
    const out2 = await reconcilePermissionSetProjection(protocol, { ql });
    expect(out2.backfilledIntoMetadata).toBe(0);
  });

  it('heals a record that drifted from an EXISTING metadata definition (metadata wins)', async () => {
    const ql = makeQl();
    const declared = { member_default: envBody({ name: 'member_default', systemPermissions: ['declared.baseline'] }) };
    const protocol = makeProtocol(ql, declared);
    // record drifted via a historic data-door edit that was never enforced
    ql.permRows.push({
      id: 'ps_md', name: 'member_default', label: 'Organization Administrator',
      object_permissions: JSON.stringify(envBody().objects),
      field_permissions: JSON.stringify(envBody().fields),
      system_permissions: '["drifted.edit"]',
      row_level_security: JSON.stringify(envBody().rowLevelSecurity),
      tab_permissions: JSON.stringify(envBody().tabPermissions),
      admin_scope: JSON.stringify(envBody().adminScope),
      active: true,
    });
    const warns: string[] = [];
    const out = await reconcilePermissionSetProjection(protocol, { ql, logger: { warn: (m) => warns.push(m), info: () => {} } });
    expect(out.driftHealed).toBe(1);
    expect(JSON.parse(ql.permRows[0].system_permissions)).toEqual(['declared.baseline']);
    expect(warns.some((w) => w.includes('drifted'))).toBe(true);
    expect(out.backfilledIntoMetadata).toBe(0); // drift is never promoted into metadata
  });

  it('never touches package-owned records', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.permRows.push({ id: 'ps_pkg', name: 'crm_rep', managed_by: 'package', package_id: 'com.example.crm', system_permissions: '["pkg"]' });
    const out = await reconcilePermissionSetProjection(protocol, { ql });
    expect(out.backfilledIntoMetadata).toBe(0);
    expect(out.driftHealed).toBe(0);
    expect(ql.metaRows.length).toBe(0);
    expect(ql.permRows[0].system_permissions).toBe('["pkg"]');
  });
});

describe('mergeRowPatchIntoBody', () => {
  it('maps snake_case column patches onto body keys, preserving unmentioned facets', () => {
    const merged = mergeRowPatchIntoBody(envBody(), { label: 'Renamed Label', tab_permissions: '{"crm_leads":"hidden"}' });
    expect(merged.label).toBe('Renamed Label');
    expect(merged.tabPermissions).toEqual({ crm_leads: 'hidden' });
    expect(merged.objects).toEqual(envBody().objects);
    expect(merged.adminScope).toEqual(envBody().adminScope);
  });

  it('accepts object-typed facet values and clears adminScope on null', () => {
    const merged = mergeRowPatchIntoBody(envBody(), { object_permissions: { ticket: { allowRead: true } }, admin_scope: null });
    expect(merged.objects).toEqual({ ticket: { allowRead: true } });
    expect('adminScope' in merged).toBe(false);
  });

  it('strips layered-read decorations from the base body', () => {
    const merged = mergeRowPatchIntoBody({ ...envBody(), _packageId: 'com.x', _provenance: { a: 1 } }, {});
    expect('_packageId' in merged).toBe(false);
    expect('_provenance' in merged).toBe(false);
  });
});
