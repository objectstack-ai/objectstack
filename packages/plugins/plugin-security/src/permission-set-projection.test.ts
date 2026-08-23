// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0094 — sys_permission_set as a pure projection of the metadata layer.
 * Covers the env-door projector (create/update/reset/retire + evaluator
 * registry sync), the data-door write-through middleware, and the boot
 * reconciliation/backfill pass. The package door stays covered in
 * bootstrap-declared-permissions.test.ts.
 *
 * [#6858 / ADR-0094 D5-R] `makeProtocol` models ADR-0005's TIER GATE, which
 * this suite used to be blind to: `permission` is `allowOrgOverride: false`
 * since #6483 (PR #6608), so a metadata write whose (type, name) is backed by
 * a code ARTIFACT is refused 403 `NOT_OVERRIDABLE`, while an artifact-free
 * name rides `allowRuntimeCreate: true` and still lands. PR #6608 recorded the
 * blind spot in its own body — "its own suite stubs `saveMetaItem`, so this
 * file is where that behaviour is actually pinned against the real gate" —
 * which is exactly why four cases here kept asserting the RETIRED overlay
 * direction and stayed green: the stub could not refuse. They are triaged
 * below, each one individually.
 */

import { describe, it, expect } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import {
  permissionSetRowFields,
  permissionSetBodyFromRow,
  permissionSpecBodyKeys,
  pickRowStateColumns,
  mergeRowPatchIntoBody,
  recordDiffersFromBody,
  upsertEnvPermissionSet,
  projectPermissionMutation,
  registerPermissionSetProjection,
  createPermissionSetWriteThrough,
  reconcilePermissionSetProjection,
  type ProjectionLogger,
} from './permission-set-projection.js';

/**
 * In-memory ql over sys_permission_set + sys_metadata.
 *
 * [#11097] Supports the `$in` membership operator, because the real engine does
 * — `bootstrapDeclaredPermissions` has read `sys_permission_set` with
 * `{ name: { $in: names } }` since #10946, on this very table. A double that
 * refused it (or, worse, quietly matched nothing and returned `[]`) would pin
 * the double's limits rather than the projector's behaviour: `[]` is the answer
 * "none of these names exist", so a non-matching double would make the
 * reconciler re-create every overlay record on every boot while this suite
 * stayed green.
 *
 * `calls` counts every round trip — the defect #11096/#11097 fix is a COUNT.
 */
function makeQl() {
  const permRows: any[] = [];
  const metaRows: any[] = [];
  const tableFor = (object: string): any[] | null =>
    object === 'sys_permission_set' ? permRows : object === 'sys_metadata' ? metaRows : null;
  const matches = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const inList = (v as any).$in;
        if (Array.isArray(inList)) return inList.includes(r[k]);
        throw new Error(`fake driver: unsupported operator ${Object.keys(v).join(',')}`);
      }
      return v === null ? (r[k] ?? null) === null : r[k] === v;
    });
  return {
    permRows,
    metaRows,
    /** Round trips by table, since issue order matters to the count tests. */
    calls: { find: 0, insert: 0, update: 0 },
    resetCalls() { (this as any).calls = { find: 0, insert: 0, update: 0 }; },
    async find(object: string, q: any) {
      const rows = tableFor(object);
      if (object === 'sys_permission_set') (this as any).calls.find += 1;
      return rows ? rows.filter((r) => matches(r, q?.where)) : [];
    },
    async findOne(object: string, q: any) {
      const rows = tableFor(object);
      return rows?.find((r) => matches(r, q?.where)) ?? null;
    },
    async insert(object: string, data: any) {
      const rows = tableFor(object);
      if (!rows) return null;
      if (object === 'sys_permission_set') (this as any).calls.insert += 1;
      rows.push({ ...data });
      return { id: data.id };
    },
    async update(object: string, data: any) {
      const rows = tableFor(object);
      if (object === 'sys_permission_set') (this as any).calls.update += 1;
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
      // [#6858 / ADR-0094 D5-R] ADR-0005's tier gate, first — ahead of schema
      // validation, exactly as `protocol.ts` orders it. `declared` IS this
      // stub's artifact registry, so `declared[name] !== undefined` is the
      // `isArtifactBacked` fact the production gate reads (never the record's
      // `managed_by` column). The refusal is topology-independent: the
      // protocol gate fires when `environmentId` is set, and
      // `SysMetadataRepository.assertAllowed` refuses the `override-artifact`
      // intent on every other kernel — pinned in
      // metadata-protocol/src/protocol.adr0005-org-override-rollback.test.ts.
      //
      // `deleteMetaItem` below deliberately does NOT model a gate: its
      // artifact-backed refusal sits inside `environmentId !== undefined`
      // with no repository-level twin, so the answer is topology-dependent
      // and a single modelled verdict here would be a fabrication. It stays
      // pinned where the real gate can be reached (the protocol suite above,
      // and packages/qa/dogfood/test/two-doors-permission.dogfood.test.ts).
      if (declared[req.name] !== undefined) {
        const err: any = new Error(
          `[not_overridable] Metadata item 'permission/${req.name}' is provided by a code package `
          + 'and the type has not opted into per-org overlay writes (allowOrgOverride=false).',
        );
        err.code = 'NOT_OVERRIDABLE';
        err.status = 403;
        throw err;
      }
      // [#4669] The REAL `PermissionSetSchema`, exactly as `saveMetaItem` runs
      // it (metadata-protocol/src/protocol.ts → `resolveOverlaySchema`), same
      // `[invalid_metadata]` 422 envelope. Without this the mock accepts any
      // object and the suite stays green while every real backfill fails —
      // which is how a 100%-failing projection shipped.
      const parsed = PermissionSetSchema.safeParse(req.item);
      if (!parsed.success) {
        const summary = parsed.error.issues
          .map((i: any) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ');
        const err: any = new Error(`[invalid_metadata] permission/${req.name} failed spec validation: ${summary}`);
        err.code = 'INVALID_METADATA';
        err.status = 422;
        throw err;
      }
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
    // and projecting the rebuilt body changes nothing
    expect(recordDiffersFromBody(row, body)).toBe(false);
  });
});

// ── The definition ⊆ spec contract (#4669) ─────────────────────────────────
//
// `sys_permission_set` carries columns the DEFINITION does not (`active`, the
// timestamps, the provenance trio). Feeding them to `saveMetaItem` is what
// #4001's `.strict()` schema rejects, and what took the ADR-0094 D4 backfill
// to a 100% failure rate.

describe('row→body projection keeps ONLY spec-declared keys (#4669)', () => {
  const legacyRow = () => ({
    id: 'ps_1',
    name: 'organization_admin',
    ...permissionSetRowFields(envBody()),
    // every storage column a real row carries…
    active: true,
    managed_by: 'admin',
    package_id: null,
    customized: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-02T00:00:00Z',
    // …plus a column this code has never heard of
    some_future_column: 'whatever',
  });

  it('the whitelist is DERIVED from the spec schema, not transcribed', () => {
    const keys = permissionSpecBodyKeys();
    // identical to PermissionSetSchema's own shape — the single source
    expect([...keys].sort()).toEqual(Object.keys((PermissionSetSchema as any).shape).sort());
    expect(keys.has('objects')).toBe(true);
    expect(keys.has('systemPermissions')).toBe(true);
    expect(keys.has('adminScope')).toBe(true);
    // `active` is a TABLE column, never a spec key — that is the whole bug
    expect(keys.has('active')).toBe(false);
  });

  it('drops `active` and every other storage column from the projected body', () => {
    const body = permissionSetBodyFromRow(legacyRow());
    for (const col of ['active', 'managed_by', 'package_id', 'customized', 'created_at', 'updated_at', 'id', 'some_future_column']) {
      expect(body, `storage column '${col}' must not enter the metadata body`).not.toHaveProperty(col);
    }
    // the definition itself survives intact
    expect(body.objects).toEqual(envBody().objects);
    expect(body.systemPermissions).toEqual(envBody().systemPermissions);
  });

  it('every key the projection emits is one the spec ACCEPTS (parsed by the real schema)', () => {
    const parsed = PermissionSetSchema.safeParse(permissionSetBodyFromRow(legacyRow()));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    // …and the reverse guard: a spec RENAME must fail here rather than silently
    // dropping the value at runtime.
    const keys = permissionSpecBodyKeys();
    for (const key of Object.keys(permissionSetBodyFromRow(legacyRow()))) {
      expect(keys.has(key), `body key '${key}' is not declared by PermissionSetSchema`).toBe(true);
    }
  });

  it('filters a body STORED before #4001 (data at rest can still carry `active`)', () => {
    // a legacy sys_metadata overlay written while the schema still stripped it
    const legacyStored = { ...envBody(), active: false, _packageId: 'com.x' };
    const merged = mergeRowPatchIntoBody(legacyStored, { label: 'Renamed' });
    expect(merged).not.toHaveProperty('active');
    expect(merged).not.toHaveProperty('_packageId');
    expect(PermissionSetSchema.safeParse(merged).success).toBe(true);
  });

  it('pickRowStateColumns isolates the record-state columns (normalized)', () => {
    expect(pickRowStateColumns({ active: 'false', label: 'x' })).toEqual({ active: false });
    expect(pickRowStateColumns({ active: true })).toEqual({ active: true });
    expect(pickRowStateColumns({ label: 'x' })).toBeNull();
    expect(pickRowStateColumns(null)).toBeNull();
  });
});

describe('upsertEnvPermissionSet (ADR-0094 — record is a pure projection)', () => {
  it('CREATES a missing record (managed_by admin) — Studio-authored sets appear in Setup', async () => {
    const ql = makeQl();
    const r = await upsertEnvPermissionSet(ql, envBody());
    expect(r.seeded).toBe(1);
    const row = ql.permRows[0];
    expect(row.name).toBe('organization_admin');
    // [A4 #2920] env/Studio-authored sets are ADMIN-owned (formerly 'user').
    expect(row.managed_by).toBe('admin');
    expect(row.active).toBe(true);
    expect(JSON.parse(row.object_permissions)).toEqual(envBody().objects);
  });

  it('projects all facets onto an existing env-authored row', async () => {
    const ql = makeQl();
    ql.permRows.push({ id: 'ps_env', name: 'organization_admin', managed_by: 'user', system_permissions: '[]', active: true });
    const r = await upsertEnvPermissionSet(ql, envBody());
    expect(r.updated).toBe(1);
    const row = ql.permRows[0];
    expect(row.id).toBe('ps_env'); // id stable — junction FKs stay valid
    expect(JSON.parse(row.system_permissions)).toEqual(['setup.access', 'manage_org_users']);
    expect(JSON.parse(row.admin_scope).businessUnit).toBe('Sales');
  });

  it('[#4669] NEVER re-flips `active` from a body — it is row state, not definition', async () => {
    // A body carrying `active` can only be legacy data at rest (pre-#4001) or a
    // caller mistake. Projecting it would silently undo an admin's
    // deactivate — the record's switch is the record's own.
    const ql = makeQl();
    ql.permRows.push({ id: 'ps_env', name: 'organization_admin', managed_by: 'user', system_permissions: '[]', active: false });
    await upsertEnvPermissionSet(ql, { ...envBody(), active: true } as any);
    expect(ql.permRows[0].active, 'a stale body must not re-activate a deactivated set').toBe(false);
    // …and a record the projector CREATES starts active (column default).
    await upsertEnvPermissionSet(ql, envBody({ name: 'fresh_set' }));
    expect(ql.permRows.find((r: any) => r.name === 'fresh_set')?.active).toBe(true);
  });

  it('projects onto a legacy row with ABSENT provenance (platform default)', async () => {
    const ql = makeQl();
    ql.permRows.push({ id: 'ps_legacy', name: 'organization_admin', system_permissions: '[]' });
    const r = await upsertEnvPermissionSet(ql, envBody());
    expect(r.updated).toBe(1);
  });

  it('projects onto a PACKAGE-OWNED row (overlay customization) while preserving its provenance', async () => {
    // Unit-level shape, unchanged by ADR-0094 D5-R: handed a body for a
    // package-owned row, this function projects the facets and preserves the
    // provenance. What D5-R retired is the CLAIM about where that body comes
    // from — an env overlay of a packaged set is no longer a supported
    // customization channel (#6483 / PR #6608); see the D5-R lifecycle block
    // below for the refusal this projector now sits behind.
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
    expect(ql.permRows[0].managed_by).toBe('admin');
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
    (ql as any).registry = { listItems: (t: string) => (t === 'permission' ? [declaredBody] : []) };
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

// ── Package-set customization (ADR-0094 D5-R — the 2026-07-14 direction is
//    RETIRED; what survives is the `allowRuntimeCreate` tier) ───────────────

/** Seed an env-scope overlay row directly — a LEGACY overlay, authored before
 *  the #6483 rollback closed the write door. `saveMetaItem` can no longer mint
 *  one for an artifact-backed name, but `supportsOverlay: true` is unchanged,
 *  so rows that already exist still merge overlay-wins at read time. */
const seedLegacyOverlay = (ql: any, name: string, body: any) => {
  ql.metaRows.push({
    id: `meta_${name}`, type: 'permission', name, state: 'active',
    organization_id: null, metadata: JSON.stringify(body),
  });
};

describe('package-owned set customization lifecycle (ADR-0094 D5-R)', () => {
  it('an env-scope save on an ARTIFACT-BACKED package name is REFUSED (403 NOT_OVERRIDABLE) — no overlay, record untouched', async () => {
    // Was: "a Studio env-scope save on a PACKAGE name customizes the record
    // and keeps provenance" — the 2026-07-14 direction. #6483 rolled
    // `permission` back to `allowOrgOverride: false` and #6609 ruling A
    // accepted the tightening, so the write this case used to assert is the
    // write production now refuses. Rejection-class: the ENVELOPE is the
    // claim (`code` AND `status`), because a bare "it threw" would stay green
    // on a stub that threw for any other reason.
    const ql = makeQl();
    const declaredBody = envBody({ systemPermissions: ['pkg.baseline'] });
    (ql as any).registry = { listItems: (t: string) => (t === 'permission' ? [declaredBody] : []) };
    const protocol = makeProtocol(ql, { organization_admin: declaredBody });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push({ id: 'ps_pkg', name: 'organization_admin', managed_by: 'package', package_id: 'com.example.crm', system_permissions: '["pkg.baseline"]' });

    await expect(
      protocol.saveMetaItem({ type: 'permission', name: 'organization_admin', item: envBody({ systemPermissions: ['customized'] }) }),
    ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });

    expect(ql.metaRows.length, 'refused, not "refused after writing" — no phantom overlay row').toBe(0);
    const row = ql.permRows[0];
    expect(JSON.parse(row.system_permissions), 'the record still projects the shipped declaration').toEqual(['pkg.baseline']);
    expect(row.customized, 'nothing was customized').toBeFalsy();
  });

  it('a package row MATERIALIZED through the metadata door is still customizable — the surviving allowRuntimeCreate tier', async () => {
    // The boundary #6608 measured UNAFFECTED, and the reason D5-R names a
    // surviving NEIGHBOUR rather than a re-route: this row is
    // `managed_by:'package'` like the one above, but its DEFINITION lives in
    // `sys_metadata` (authored + published through the metadata door,
    // ADR-0070), so no artifact backs it and the write rides
    // `allowRuntimeCreate`. It is a direct edit of the one stored
    // definition — there is no code layer for it to be an overlay OF.
    const ql = makeQl();
    const protocol = makeProtocol(ql, {}); // no artifact registry entry
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push({ id: 'ps_mat', name: 'organization_admin', managed_by: 'package', package_id: 'com.example.crm', system_permissions: '["materialized.baseline"]' });

    await protocol.saveMetaItem({ type: 'permission', name: 'organization_admin', item: envBody({ systemPermissions: ['customized'] }) });

    const row = ql.permRows[0];
    expect(JSON.parse(row.system_permissions)).toEqual(['customized']);
    expect(row.managed_by, 'the package still owns the row').toBe('package');
    expect(row.package_id).toBe('com.example.crm');
  });

  it('a LEGACY overlay (authored before the rollback) still projects, and deleting it still RESETS to the declaration', async () => {
    // `supportsOverlay: true` was not touched by #6483 — only the WRITE flag
    // was. A row that already exists keeps merging overlay-wins, so the
    // reset invariant still has to hold for it. Seeded directly because the
    // write door that used to mint it is closed.
    const ql = makeQl();
    const declaredBody = envBody({ systemPermissions: ['pkg.baseline'] });
    (ql as any).registry = { listItems: (t: string) => (t === 'permission' ? [declaredBody] : []) };
    const protocol = makeProtocol(ql, { organization_admin: declaredBody });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push({ id: 'ps_pkg', name: 'organization_admin', managed_by: 'package', package_id: 'com.example.crm', system_permissions: '["pkg.baseline"]' });
    seedLegacyOverlay(ql, 'organization_admin', envBody({ systemPermissions: ['legacy.overlay'] }));

    await projectPermissionMutation(protocol, { ql }, { type: 'permission', name: 'organization_admin', state: 'active', organizationId: null });
    expect(JSON.parse(ql.permRows[0].system_permissions), 'the legacy overlay still wins at read time').toEqual(['legacy.overlay']);

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
    expect(ql.permRows[0].managed_by).toBe('admin');
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
    expect(overlay.objects).toEqual(envBody().objects); // unmentioned facets preserved
    // [#4669] …but `active` rode along as a COLUMN, never as a body key: the
    // definition stays spec-clean while the record's switch still flips.
    expect(overlay).not.toHaveProperty('active');
    // …and the record followed via projection
    expect(JSON.parse(ql.permRows[0].system_permissions)).toEqual(['setup.access']);
    expect(ql.permRows[0].active).toBe(false);
    expect(ql.permRows[0].id).toBe(rowId);
    expect(opCtx.result?.id).toBe(rowId);
  });

  it('[#4669] the activate/deactivate ACTIONS write the column and nothing else', async () => {
    // `sys-permission-set.object.ts` ships two `type:'api'` actions that PATCH
    // /data/sys_permission_set/{id} with `bodyExtra: { active: true|false }`.
    // A row-state-only patch is not a definition write: it passes through to
    // the driver, mints no overlay, and touches the metadata store not at all.
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    registerPermissionSetProjection(protocol, { ql });
    await protocol.saveMetaItem({ type: 'permission', name: 'organization_admin', item: envBody() });
    const rowId = ql.permRows[0].id;
    const savesBefore = protocol.saves.length;
    const metaRowsBefore = JSON.stringify(ql.metaRows);
    const mw = makeMiddleware(ql, protocol);

    for (const active of [false, true]) {
      const nextCalled = await run(mw, {
        object: 'sys_permission_set', operation: 'update', context: userCtx,
        data: { id: rowId, active },
      });
      expect(nextCalled, 'the driver performs the column write, with its ordinary semantics').toBe(true);
    }
    expect(protocol.saves.length, 'no metadata write for a pure row-state patch').toBe(savesBefore);
    expect(JSON.stringify(ql.metaRows)).toBe(metaRowsBefore);
  });

  it('[#4669] deactivating a PACKAGE-owned set mints no customization overlay', async () => {
    const ql = makeQl();
    const declaredBody = envBody({ name: 'crm_rep', systemPermissions: ['pkg.baseline'] });
    (ql as any).registry = { listItems: (t: string) => (t === 'permission' ? [declaredBody] : []) };
    const protocol = makeProtocol(ql, { crm_rep: declaredBody });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push({ id: 'ps_pkg', name: 'crm_rep', managed_by: 'package', package_id: 'com.example.crm', system_permissions: '["pkg.baseline"]', active: true });
    const mw = makeMiddleware(ql, protocol);
    const nextCalled = await run(mw, {
      object: 'sys_permission_set', operation: 'update', context: userCtx, data: { id: 'ps_pkg', active: false },
    });
    expect(nextCalled).toBe(true);
    expect(ql.metaRows.length, 'switching a packaged set off is not a customization of it').toBe(0);
    expect(ql.permRows[0].customized).toBeUndefined();
  });

  it('[#4669] INSERT honours an explicit `active` on the record (Clone action sends one)', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    registerPermissionSetProjection(protocol, { ql });
    const mw = makeMiddleware(ql, protocol);
    const opCtx: any = {
      object: 'sys_permission_set', operation: 'insert', context: userCtx,
      data: {
        name: 'support_agent', label: 'Support Agent', active: false,
        object_permissions: JSON.stringify({ ticket: { allowRead: true } }),
      },
    };
    await run(mw, opCtx);
    expect(protocol.saves[0].item, 'the definition never carries row state').not.toHaveProperty('active');
    expect(ql.permRows[0].active).toBe(false);
    expect(opCtx.result?.active).toBe(false);
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
    // [#6858] A LEGACY env overlay shadows the declaration — seeded directly
    // because `saveMetaItem` can no longer mint one for an artifact-backed
    // name (ADR-0094 D5-R). The invariant under test is unchanged: the record
    // is projected from the overlay, and the data-door delete resets it.
    seedLegacyOverlay(ql, 'organization_admin', envBody({ systemPermissions: ['overlaid'] }));
    await projectPermissionMutation(protocol, { ql }, { type: 'permission', name: 'organization_admin', state: 'active', organizationId: null });
    expect(JSON.parse(ql.permRows[0].system_permissions)).toEqual(['overlaid']);
    const mw = makeMiddleware(ql, protocol);
    const nextCalled = await run(mw, {
      object: 'sys_permission_set', operation: 'delete', options: { where: { id: ql.permRows[0].id } }, context: userCtx,
    });
    expect(nextCalled).toBe(false);
    expect(ql.permRows.length).toBe(1); // record survives…
    expect(JSON.parse(ql.permRows[0].system_permissions)).toEqual(['declared.only']); // …reset to the declaration
  });

  it('UPDATE of an ARTIFACT-BACKED set surfaces the producer\'s 403 to the caller (write point :794 — left to 403 loudly)', async () => {
    // Was: "UPDATE of a PACKAGE-OWNED set becomes an env overlay" — the
    // retired D5 direction. This is the ONE of the four production write
    // points that the #6483 rollback actually closes, and the card's design
    // question was what to do with it. Decision (ADR-0094 D5-R): leave it to
    // the producer. The middleware still TRANSLATES the write; the protocol's
    // ADR-0005 tier gate refuses it; the middleware neither pre-empts the
    // refusal (it would need a second copy of `isArtifactBacked` — Prime
    // Directive #8) nor swallows it. The caller hears the envelope.
    const ql = makeQl();
    const declaredBody = envBody({ name: 'crm_rep', systemPermissions: ['pkg.baseline'] });
    (ql as any).registry = { listItems: (t: string) => (t === 'permission' ? [declaredBody] : []) };
    const protocol = makeProtocol(ql, { crm_rep: declaredBody });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push({
      id: 'ps_pkg', name: 'crm_rep', managed_by: 'package', package_id: 'com.example.crm',
      system_permissions: '["pkg.baseline"]',
    });
    const mw = makeMiddleware(ql, protocol);
    await expect(
      run(mw, {
        object: 'sys_permission_set', operation: 'update', context: userCtx,
        data: { id: 'ps_pkg', system_permissions: '["customized"]' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });

    expect(ql.metaRows.length, 'no overlay was minted by the refused edit').toBe(0);
    const row = ql.permRows[0];
    expect(JSON.parse(row.system_permissions), 'the record still shows the shipped declaration').toEqual(['pkg.baseline']);
    expect(row.managed_by).toBe('package');
  });

  it('UPDATE of a package row MATERIALIZED through the metadata door still lands (the surviving tier)', async () => {
    // The other half of the boundary — same `managed_by:'package'` row shape,
    // no artifact behind the name, so the write rides `allowRuntimeCreate`
    // and the data door keeps working. Without this the case above would also
    // pass on a harness that could not write ANYTHING through the middleware.
    const ql = makeQl();
    const protocol = makeProtocol(ql, {}); // no artifact registry entry
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push({
      id: 'ps_mat', name: 'crm_rep', managed_by: 'package', package_id: 'com.example.crm',
      system_permissions: '["materialized.baseline"]',
    });
    const mw = makeMiddleware(ql, protocol);
    const opCtx: any = {
      object: 'sys_permission_set', operation: 'update', context: userCtx,
      data: { id: 'ps_mat', system_permissions: '["customized"]' },
    };
    const nextCalled = await run(mw, opCtx);
    expect(nextCalled, 'the driver write is still skipped — the record is projector-owned').toBe(false);
    expect(JSON.parse(ql.metaRows[0].metadata).systemPermissions).toEqual(['customized']);
    const row = ql.permRows[0];
    expect(JSON.parse(row.system_permissions)).toEqual(['customized']);
    expect(row.managed_by, 'the package still owns the row').toBe('package');
    expect(row.package_id).toBe('com.example.crm');
  });

  it('INSERT of a name that shadows a code-declared set surfaces the 403 too (write point :752)', async () => {
    // Reachable when a declaration ships but its record was never
    // materialized: the duplicate-name probe finds no row, so the insert
    // proceeds to `saveMetaItem` on an artifact-backed name. Fail-closed and
    // unswallowed, same disposition as the UPDATE above.
    const ql = makeQl();
    const declaredBody = envBody({ name: 'crm_rep' });
    const protocol = makeProtocol(ql, { crm_rep: declaredBody });
    registerPermissionSetProjection(protocol, { ql });
    const mw = makeMiddleware(ql, protocol);
    await expect(
      run(mw, {
        object: 'sys_permission_set', operation: 'insert', context: userCtx,
        data: { name: 'crm_rep', label: 'Shadow', object_permissions: JSON.stringify({ crm_lead: { allowRead: true } }) },
      }),
    ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(ql.permRows.length, 'no record was created by the refused insert').toBe(0);
    expect(ql.metaRows.length).toBe(0);
  });

  it('RESTORE reports a refused re-author on the durability channel instead of throwing (write point :713)', async () => {
    // The deliberate asymmetry. `restore` runs AFTER the engine has already
    // un-trashed the row, so throwing would leave the caller with a restored
    // record and a failed request; the write point catches and reports on the
    // durability channel (#4632) instead. Pinned with an artifact-backed name
    // so the refusal is the ADR-0005 one — the scenario is narrow (a packaged
    // definition cannot be trashed through the data door at all), which is
    // why the DISPOSITION, not the frequency, is what this case fixes.
    const ql = makeQl();
    const declaredBody = envBody({ name: 'crm_rep' });
    const protocol = makeProtocol(ql, { crm_rep: declaredBody });
    const errors: any[] = [];
    const mw = createPermissionSetWriteThrough({
      ql, getProtocol: () => protocol,
      logger: { error: (m: string, e?: Error) => errors.push({ m, e }), info: () => {}, warn: () => {} },
    });
    ql.permRows.push({ id: 'ps_r', name: 'crm_rep', managed_by: 'user' });
    const nextCalled = await run(mw, {
      object: 'sys_permission_set', operation: 'restore', options: { where: { id: 'ps_r' } }, context: userCtx,
    });
    expect(nextCalled, 'the engine un-trash still runs').toBe(true);
    expect(errors.length, 'the failure is reported, not swallowed').toBe(1);
    expect(errors[0].e).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(errors[0].m).toContain('NOT re-authored into metadata');
  });

  it('DELETE of a customized PACKAGE set removes the overlay and resets to the declared baseline', async () => {
    const ql = makeQl();
    const declaredBody = envBody({ name: 'crm_rep', systemPermissions: ['pkg.baseline'] });
    (ql as any).registry = { listItems: (t: string) => (t === 'permission' ? [declaredBody] : []) };
    const protocol = makeProtocol(ql, { crm_rep: declaredBody });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push({ id: 'ps_pkg', name: 'crm_rep', managed_by: 'package', package_id: 'com.example.crm', system_permissions: '["pkg.baseline"]' });
    const mw = makeMiddleware(ql, protocol);
    // [#6858] The overlay is LEGACY (pre-rollback) and seeded directly — the
    // data-door edit that used to mint it now answers 403 (ADR-0094 D5-R).
    // The invariant under test is untouched: "delete" lifts the overlay and
    // the record resets to the shipped declaration.
    seedLegacyOverlay(ql, 'crm_rep', envBody({ name: 'crm_rep', systemPermissions: ['customized'] }));
    await projectPermissionMutation(protocol, { ql }, { type: 'permission', name: 'crm_rep', state: 'active', organizationId: null });
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
    expect(ql.permRows[0]?.managed_by).toBe('admin');
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
    expect(out.backfillFailed).toBe(0);
    expect(ql.metaRows.length).toBe(1);
    const body = JSON.parse(ql.metaRows[0].metadata);
    expect(body.objects).toEqual({ ticket: { allowRead: true } });
    // second run: the overlay now exists — nothing to backfill again
    const out2 = await reconcilePermissionSetProjection(protocol, { ql });
    expect(out2.backfilledIntoMetadata).toBe(0);
  });

  it('[#6858] the backfill never targets an ARTIFACT-BACKED name — write point :928 cannot reach the tier gate', async () => {
    // The measured half of ADR-0094 D5-R's "3 of the 4 write points were
    // already on the surviving tier". The backfill runs only for records
    // whose name has NO metadata presence at all; a code-declared name has a
    // declared body, so the branch is not entered and no `saveMetaItem` is
    // issued. Asserted on the write LEDGER (`protocol.saves`) rather than on
    // the absence of a throw: "it did not fail" would also be true if the
    // gate had simply accepted the write.
    const ql = makeQl();
    const declaredBody = envBody({ name: 'crm_rep', systemPermissions: ['pkg.baseline'] });
    (ql as any).registry = { listItems: (t: string) => (t === 'permission' ? [declaredBody] : []) };
    const protocol = makeProtocol(ql, { crm_rep: declaredBody });
    ql.permRows.push({
      id: 'ps_pkg_env', name: 'crm_rep', managed_by: 'admin', active: true,
      label: 'CRM Rep', system_permissions: '["pkg.baseline"]',
    });

    const out = await reconcilePermissionSetProjection(protocol, { ql });

    expect(protocol.saves.length, 'no metadata write was attempted for a declared name').toBe(0);
    expect(out.backfilledIntoMetadata).toBe(0);
    expect(out.backfillFailed, 'and therefore nothing could be refused').toBe(0);
  });

  it('[#4669] a row carrying the `active` STORAGE COLUMN backfills instead of failing spec validation', async () => {
    // The reported symptom: every `sys_permission_set` row has an `active`
    // column, `permissionSetBodyFromRow` handed it to `saveMetaItem`, and
    // #4001's `.strict()` schema rejected all of them — a 100%-failing
    // backfill behind one `warn`, with `backfilledIntoMetadata` stuck at 0.
    const ql = makeQl();
    const protocol = makeProtocol(ql); // validates with the real PermissionSetSchema
    ql.permRows.push({
      id: 'ps_d8', name: 'd8_qc_user', managed_by: 'admin',
      active: true, customized: false, package_id: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
      label: 'D8 QC User', ...permissionSetRowFields(envBody({ name: 'd8_qc_user' })),
    });
    const logs: Array<{ level: string; msg: string }> = [];
    const logger = {
      info: (m: string) => logs.push({ level: 'info', msg: m }),
      warn: (m: string) => logs.push({ level: 'warn', msg: m }),
      error: (m: string) => logs.push({ level: 'error', msg: m }),
    };
    const out = await reconcilePermissionSetProjection(protocol, { ql, logger });
    expect(out.backfilledIntoMetadata).toBe(1);
    expect(out.backfillFailed).toBe(0);
    expect(logs.some((l) => /backfill into metadata failed|FAILED/i.test(l.msg))).toBe(false);
    const stored = JSON.parse(ql.metaRows[0].metadata);
    expect(stored).not.toHaveProperty('active');
    expect(stored.name).toBe('d8_qc_user');
  });

  it('[#4669/#4632] a REAL backfill failure is loud: error level, counted, consequence + fix', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    // Not a key problem — the stored facet JSON itself is off-contract, so no
    // amount of key-filtering saves it. This is the case that MUST shout.
    ql.permRows.push({
      id: 'ps_bad', name: 'broken_set', managed_by: 'admin', active: true,
      label: 'Broken Set', object_permissions: JSON.stringify({ ticket: { allowRead: 'yes-please' } }),
    });
    ql.permRows.push({
      id: 'ps_bad2', name: 'broken_set_2', managed_by: 'admin', active: true,
      label: 'Broken Set 2', object_permissions: JSON.stringify({ ticket: { nonsense: true } }),
    });
    // `error` follows the platform Logger contract: (message, error?, meta?).
    const logs: Array<{ level: string; msg: string; meta?: any; cause?: Error }> = [];
    const logger = {
      info: (m: string, meta?: any) => logs.push({ level: 'info', msg: m, meta }),
      warn: (m: string, meta?: any) => logs.push({ level: 'warn', msg: m, meta }),
      error: (m: string, cause?: Error, meta?: any) => logs.push({ level: 'error', msg: m, cause, meta }),
    };
    const out = await reconcilePermissionSetProjection(protocol, { ql, logger });

    // counted in the RESULT — not only in a log line nobody reads
    expect(out.backfillFailed).toBe(2);
    expect(out.backfilledIntoMetadata).toBe(0);
    expect(ql.metaRows.length).toBe(0);

    // level: error, never warn/info for a durability degradation
    const errors = logs.filter((l) => l.level === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.level === 'warn' && /backfill/i.test(l.msg))).toBe(false);
    // said ONCE, at the first failure — not once per failed write
    const firstFailure = errors[0]!;
    expect(errors.filter((l) => /backfill into metadata FAILED/.test(l.msg)).length).toBe(1);
    // the consequence…
    expect(firstFailure.msg).toMatch(/Nothing will look broken/);
    expect(firstFailure.msg).toMatch(/re-provision/);
    // …and the fix
    expect(firstFailure.msg).toMatch(/Fix:/);
    expect(firstFailure.meta?.name).toBe('broken_set');

    // the summary carries the failure too — an `info` "reconciled" line over a
    // failed backfill is the reassuring half-truth the rule exists to remove
    const summary = errors.at(-1)!;
    expect(summary.msg).toMatch(/2 FAILED backfill/);
    expect(summary.meta?.failedNames).toEqual(['broken_set', 'broken_set_2']);
    expect(logs.some((l) => l.level === 'info' && /reconciled/.test(l.msg))).toBe(false);
  });

  it('[#9657] a sink with NO `error` still hears the backfill failure — at warn, not in silence', async () => {
    // `ProjectionLogger.error` is declared OPTIONAL, and the report used to be
    // spelled `logger?.error?.(…)` — an optional call that emits NOTHING when
    // the method is absent. A host injecting `{ info, warn }` therefore lost
    // the whole durability report, on the one path that must never be quiet.
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.permRows.push({
      id: 'ps_bad', name: 'broken_set', managed_by: 'admin', active: true,
      label: 'Broken Set', object_permissions: JSON.stringify({ ticket: { allowRead: 'yes-please' } }),
    });
    const logs: Array<{ level: string; msg: string; meta?: any }> = [];
    const logger = {
      info: (m: string, meta?: any) => logs.push({ level: 'info', msg: m, meta }),
      warn: (m: string, meta?: any) => logs.push({ level: 'warn', msg: m, meta }),
    };

    const out = await reconcilePermissionSetProjection(protocol, { ql, logger });

    expect(out.backfillFailed).toBe(1);
    const firstFailure = logs.find((l) => /backfill into metadata FAILED/.test(l.msg));
    expect(firstFailure).toBeDefined();
    expect(firstFailure!.level).toBe('warn');
    // The consequence and the fix survive the fallback — a downgraded level is
    // a degradation of the CHANNEL, never of the message.
    expect(firstFailure!.msg).toMatch(/Nothing will look broken/);
    expect(firstFailure!.msg).toMatch(/Fix:/);
    expect(firstFailure!.meta?.name).toBe('broken_set');
  });

  it('[#9748] the reconcile SUMMARY also reaches a sink with NO `error` — at warn, not in silence', async () => {
    // #9657 repaired the FIRST-FAILURE line above; this summary sits outside
    // any `catch`, so the durability gate could not see it and it kept the
    // `logger?.error?.(…)` spelling. Against a `{ info, warn }` sink the repair
    // therefore made the split WORSE, not better: the first failure survived at
    // `warn` while the TOTAL — how many definitions will not survive a
    // re-provision — vanished, and the `info` "reconciled" line is skipped too,
    // so the sink heard neither. That silence is the reassuring half-truth this
    // rule exists to remove, arrived at from the other side.
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.permRows.push({
      id: 'ps_bad', name: 'broken_set', managed_by: 'admin', active: true,
      label: 'Broken Set', object_permissions: JSON.stringify({ ticket: { allowRead: 'yes-please' } }),
    });
    ql.permRows.push({
      id: 'ps_bad2', name: 'broken_set_2', managed_by: 'admin', active: true,
      label: 'Broken Set 2', object_permissions: JSON.stringify({ ticket: { nonsense: true } }),
    });
    const logs: Array<{ level: string; msg: string; meta?: any }> = [];
    const logger = {
      info: (m: string, meta?: any) => logs.push({ level: 'info', msg: m, meta }),
      warn: (m: string, meta?: any) => logs.push({ level: 'warn', msg: m, meta }),
    };

    const out = await reconcilePermissionSetProjection(protocol, { ql, logger });

    expect(out.backfillFailed).toBe(2);
    const summary = logs.filter((l) => /FAILED backfill/.test(l.msg));
    expect(summary).toHaveLength(1);
    expect(summary[0]!.level).toBe('warn');
    expect(summary[0]!.msg).toMatch(/2 FAILED backfill/);            // the COUNT is the whole point
    expect(summary[0]!.msg).toMatch(/will not survive a re-provision/);
    expect(summary[0]!.meta?.failedNames).toEqual(['broken_set', 'broken_set_2']);
    // and never the reassuring half-truth instead
    expect(logs.some((l) => /reconciled \(ADR-0094 D4\)/.test(l.msg))).toBe(false);
  });

  it('[#9748] a sink that HAS `error` still gets the summary at error, not downgraded', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.permRows.push({
      id: 'ps_bad', name: 'broken_set', managed_by: 'admin', active: true,
      label: 'Broken Set', object_permissions: JSON.stringify({ ticket: { allowRead: 'yes-please' } }),
    });
    const logs: Array<{ level: string; msg: string; meta?: any; cause?: Error }> = [];
    const logger = {
      info: (m: string, meta?: any) => logs.push({ level: 'info', msg: m, meta }),
      warn: (m: string, meta?: any) => logs.push({ level: 'warn', msg: m, meta }),
      error: (m: string, cause?: Error, meta?: any) => logs.push({ level: 'error', msg: m, cause, meta }),
    };

    await reconcilePermissionSetProjection(protocol, { ql, logger });

    const summary = logs.filter((l) => /FAILED backfill/.test(l.msg));
    expect(summary).toHaveLength(1);
    expect(summary[0]!.level).toBe('error');
    expect(summary[0]!.meta?.failedNames).toEqual(['broken_set']);
  });

  it('[#9754] a sink with NO `warn` cannot be spelled at all — the TYPE forbids the silence', async () => {
    // THE HARM, reproduced before the fix is believed. Until #9754 every member
    // of `ProjectionLogger` was optional, so `{ info }` was a legal sink — and
    // against it the reconcile pass reported NOTHING: the first-failure line
    // and the summary both reach for `error`, fall back to `warn`, and find
    // neither, while the `else` branch carrying the reassuring "reconciled"
    // line is skipped because the pass did fail. A permission set that will not
    // survive a re-provision, and a boot log that says nothing whatsoever.
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.permRows.push({
      id: 'ps_bad', name: 'broken_set', managed_by: 'admin', active: true,
      label: 'Broken Set', object_permissions: JSON.stringify({ ticket: { allowRead: 'yes-please' } }),
    });
    const heard: string[] = [];
    const silent = { info: (m: string) => heard.push(m) };

    const out = await reconcilePermissionSetProjection(protocol, {
      ql,
      logger: silent as unknown as ProjectionLogger,
    });

    expect(out.backfillFailed).toBe(1);
    expect(heard).toEqual([]);   // neither the failure, nor the count, nor the "reconciled" line

    // THE CONTRACT is what removes that cast's subject: `warn` is non-optional
    // on `ProjectionLogger` (#9754), so no TS caller can build the sink above
    // without saying `as unknown as` out loud.
    //
    // ⚠️ Deliberately NOT pinned here with `@ts-expect-error`. This package's
    // tsconfig excludes `**/*.test.ts` (it carries a TEST_DEBT ledger entry in
    // scripts/check-type-check-coverage.mjs), so no tsc program compiles this
    // file and the directive would evaluate NEVER — a phantom check that reads
    // like proof, which is the failure AGENTS.md → "Build & Test" names and
    // `pnpm check:type-check-coverage` refuses. The compile-time half of this
    // contract is pinned in plugin-email's `outbox-sweep.test.ts`, whose
    // package DOES compile its tests (observed: reverting `warn` there turns
    // that directive into `error TS2578: Unused '@ts-expect-error' directive`),
    // and the type half of BOTH sinks is held by
    // `pnpm check:optional-error-sink`.
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

// ── #11097 — boot reconciliation is O(1) round trips, and still reconciles ──

/**
 * [#11097] The env door's boot reconciler projected every env-scope `permission`
 * overlay in a per-name loop, and each iteration issued its OWN existence
 * `SELECT` inside `upsertEnvPermissionSet` plus an `UPDATE` that fired whether
 * or not the record already matched. Invisible on a local file database; one
 * sequential HTTP request per leg on the remote libsql/Turso database every
 * hosted environment runs.
 *
 * ## What is measured here, and what is NOT
 *
 * A COUNT — every `find`/`insert`/`update` the reconciler issues against
 * `sys_permission_set` is one round trip, counted by `makeQl().calls`. ⚠️ The
 * slope of THIS axis has never been measured: the hosted `bootstrap-curve.mjs`
 * rig lives in `objectstack-ai/cloud`, and its axes are permission sets /
 * positions / objects, not env overlays. What is established is that the code
 * shape is the one #10946 measured at 4.0000 round trips per item on the two
 * sibling loops. Nothing here measures wall time.
 *
 * ## Why every counting test below is paired with a reconciliation test
 *
 * ⚠️ LOAD-BEARING. A reconciler that simply stopped writing would produce a
 * perfect count while silently reconciling nothing — the loop keeping its shape
 * and losing its purpose. So each count is paired with a drift fixture over the
 * same data, and `customized` gets its own pair because it is written by this
 * projector and deliberately NOT compared by `recordDiffersFromBody`.
 */
describe('#11097 — env overlay reconciliation: round trips', () => {
  const overlay = (n: number) => `env_set_${n}`;

  /** Seed `n` env-authored overlays and settle them into records. */
  const seedOverlays = async (n: number) => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    for (let i = 0; i < n; i += 1) {
      ql.metaRows.push({
        id: `m${i}`, type: 'permission', name: overlay(i), state: 'active',
        organization_id: null, metadata: JSON.stringify(envBody({ name: overlay(i) })),
      });
    }
    await reconcilePermissionSetProjection(protocol, { ql });   // first boot: creates
    return { ql, protocol };
  };

  it('does not grow the steady-state round-trip count with the number of overlays', async () => {
    const measure = async (n: number) => {
      const { ql, protocol } = await seedOverlays(n);
      ql.resetCalls();
      const out = await reconcilePermissionSetProjection(protocol, { ql });   // REBUILD
      // Nothing changed, so nothing is written — and that is the whole point.
      expect(out.projectedFromMetadata).toBe(0);
      expect(ql.calls.update).toBe(0);
      expect(ql.calls.insert).toBe(0);
      return ql.calls.find;
    };

    const [n1, n5, n20, n40] = [await measure(1), await measure(5), await measure(20), await measure(40)];
    // ONE batched `$in` existence read + the pre-existing full-record page read.
    // The COUNT is asserted, never the wall time.
    expect([n1, n5, n20, n40]).toEqual([2, 2, 2, 2]);
  });

  it('issues ONE batched `$in` existence read for the whole overlay set', async () => {
    const { ql, protocol } = await seedOverlays(12);
    const seen: any[] = [];
    const origFind = ql.find.bind(ql);
    (ql as any).find = async (object: string, q: any) => {
      if (object === 'sys_permission_set') seen.push(q?.where);
      return origFind(object, q);
    };
    ql.resetCalls();
    await reconcilePermissionSetProjection(protocol, { ql });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ name: { $in: Array.from({ length: 12 }, (_, i) => overlay(i)) } });
  });

  it('first boot costs one batched read plus one INSERT per genuinely new overlay', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    for (let i = 0; i < 10; i += 1) {
      ql.metaRows.push({
        id: `m${i}`, type: 'permission', name: overlay(i), state: 'active',
        organization_id: null, metadata: JSON.stringify(envBody({ name: overlay(i) })),
      });
    }
    const out = await reconcilePermissionSetProjection(protocol, { ql });
    expect(out.projectedFromMetadata).toBe(10);
    expect(ql.calls.insert).toBe(10);
    expect(ql.calls.update).toBe(0);
    expect(ql.permRows).toHaveLength(10);
  });
});

/**
 * ⚠️ LOAD-BEARING. Without these, an implementation that skipped every write
 * would pass every count above while reconciling nothing at all.
 */
describe('#11097 — drift STILL reconciles', () => {
  it('an overlay whose stored facets differ still gets its UPDATE', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.metaRows.push({
      id: 'm1', type: 'permission', name: 'organization_admin', state: 'active',
      organization_id: null, metadata: JSON.stringify(envBody()),
    });
    await reconcilePermissionSetProjection(protocol, { ql });
    expect(ql.permRows).toHaveLength(1);

    // Someone wrote straight at the record.
    ql.permRows[0].object_permissions = JSON.stringify({ crm_lead: { allowDelete: true } });

    ql.resetCalls();
    const out = await reconcilePermissionSetProjection(protocol, { ql });
    expect(out.projectedFromMetadata).toBe(1);
    expect(ql.calls.update).toBe(1);
    expect(JSON.parse(ql.permRows[0].object_permissions)).toEqual({ crm_lead: { allowRead: true, allowEdit: true } });
  });

  it('an overlay whose label drifted still gets its UPDATE', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.metaRows.push({
      id: 'm1', type: 'permission', name: 'organization_admin', state: 'active',
      organization_id: null, metadata: JSON.stringify(envBody()),
    });
    await reconcilePermissionSetProjection(protocol, { ql });
    ql.permRows[0].label = 'Stale Label';

    ql.resetCalls();
    await reconcilePermissionSetProjection(protocol, { ql });
    expect(ql.calls.update).toBe(1);
    expect(ql.permRows[0].label).toBe('Organization Administrator');
  });

  it('only the DRIFTED overlay is written — the other 19 cost nothing', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    for (let i = 0; i < 20; i += 1) {
      ql.metaRows.push({
        id: `m${i}`, type: 'permission', name: `env_set_${i}`, state: 'active',
        organization_id: null, metadata: JSON.stringify(envBody({ name: `env_set_${i}` })),
      });
    }
    await reconcilePermissionSetProjection(protocol, { ql });
    const target = ql.permRows.find((r: any) => r.name === 'env_set_7');
    target.label = 'drifted';

    ql.resetCalls();
    const out = await reconcilePermissionSetProjection(protocol, { ql });
    expect(out.projectedFromMetadata).toBe(1);
    expect(ql.calls.update).toBe(1);
    expect(target.label).toBe('Organization Administrator');
  });
});

/**
 * ⛔ [#11097] The `customized` stamp is written by this projector and is
 * deliberately NOT part of `recordDiffersFromBody` — it is provenance, not
 * definition, so no metadata body can declare it. That makes it the one column
 * a naive "skip when the body matches" would stop maintaining, while the Setup
 * list badges on it and the reset action reads it. These pin the flag's own
 * comparison term.
 */
describe('#11097 — the `customized` stamp is still maintained', () => {
  const pkgRow = (over: Record<string, any> = {}) => ({
    id: 'ps_pkg', name: 'organization_admin', managed_by: 'package',
    package_id: 'com.example.crm', active: true,
    ...permissionSetRowFields(envBody()),
    ...over,
  });

  it('an overlay appearing over a package row still STAMPS `customized` on a matching row', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    // The record's facets already equal the overlay body — only the flag differs.
    ql.permRows.push(pkgRow({ customized: false }));
    ql.metaRows.push({
      id: 'm1', type: 'permission', name: 'organization_admin', state: 'active',
      organization_id: null, metadata: JSON.stringify(envBody()),
    });

    ql.resetCalls();
    await reconcilePermissionSetProjection(protocol, { ql });
    expect(ql.permRows[0].customized).toBe(true);
    expect(ql.calls.update).toBe(1);
  });

  it('a row that predates the flag (NULL) is still stamped, not read as already-customized', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.permRows.push(pkgRow({ customized: null }));
    ql.metaRows.push({
      id: 'm1', type: 'permission', name: 'organization_admin', state: 'active',
      organization_id: null, metadata: JSON.stringify(envBody()),
    });

    await reconcilePermissionSetProjection(protocol, { ql });
    expect(ql.permRows[0].customized).toBe(true);
  });

  it('a package row whose flag is ALREADY true costs no write', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.permRows.push(pkgRow({ customized: true }));
    ql.metaRows.push({
      id: 'm1', type: 'permission', name: 'organization_admin', state: 'active',
      organization_id: null, metadata: JSON.stringify(envBody()),
    });

    ql.resetCalls();
    await reconcilePermissionSetProjection(protocol, { ql });
    expect(ql.permRows[0].customized).toBe(true);
    expect(ql.calls.update).toBe(0);
  });

  it('an env-authored row carrying a stale flag is still CLEARED', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    // `managed_by:'admin'` — the flag does not apply; a stale `true` must go.
    ql.permRows.push({
      id: 'ps_env', name: 'organization_admin', managed_by: 'admin', active: true,
      customized: true, ...permissionSetRowFields(envBody()),
    });
    ql.metaRows.push({
      id: 'm1', type: 'permission', name: 'organization_admin', state: 'active',
      organization_id: null, metadata: JSON.stringify(envBody()),
    });

    ql.resetCalls();
    await reconcilePermissionSetProjection(protocol, { ql });
    expect(ql.permRows[0].customized).toBe(false);
    expect(ql.calls.update).toBe(1);
  });
});

/**
 * ⛔ [#11097] The in-memory evaluator registry sync is NOT a database round trip,
 * and gating it on "a write happened" is what compare-before-write would
 * otherwise have done to it. The evaluator resolves permission sets
 * registry-first, so a steady-state boot that skipped the sync would leave it
 * enforcing the stale DECLARED body while the record and Setup showed the
 * overlay.
 */
describe('#11097 — the evaluator registry is synced even when nothing was written', () => {
  it('an overlay whose record already matches STILL syncs the evaluator registry', async () => {
    const ql = makeQl();
    const declared = { organization_admin: envBody({ label: 'Shipped Baseline' }) };
    const protocol = makeProtocol(ql, declared);
    const registered: any[] = [];
    const metadata = {
      registerInMemory: (type: string, name: string, body: any) => { registered.push({ type, name, body }); },
    };
    ql.metaRows.push({
      id: 'm1', type: 'permission', name: 'organization_admin', state: 'active',
      organization_id: null, metadata: JSON.stringify(envBody({ label: 'Overlay Wins' })),
    });

    // First boot creates the record AND syncs.
    await reconcilePermissionSetProjection(protocol, { ql, metadata });
    expect(registered).toHaveLength(1);

    // Steady state: the record already matches, so NO update is issued — the
    // sync must happen anyway.
    registered.length = 0;
    ql.resetCalls();
    await reconcilePermissionSetProjection(protocol, { ql, metadata });
    expect(ql.calls.update).toBe(0);
    expect(registered).toHaveLength(1);
    expect(registered[0].body.label).toBe('Overlay Wins');
  });
});

/**
 * ⛔ #3807's conflation class at the seam the batched read newly exposes: a read
 * that CANNOT ANSWER is not the answer "no such record". The per-item shape was
 * accidentally immune (a failed read fell through to an insert that failed too,
 * for that ONE name); a batched read speaks for the whole set at once.
 */
describe('#11097 — a read that CANNOT ANSWER is not the answer "none exist"', () => {
  it('a throwing existence read does NOT re-create records that are already projected', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    for (let i = 0; i < 4; i += 1) {
      ql.metaRows.push({
        id: `m${i}`, type: 'permission', name: `env_set_${i}`, state: 'active',
        organization_id: null, metadata: JSON.stringify(envBody({ name: `env_set_${i}` })),
      });
    }
    await reconcilePermissionSetProjection(protocol, { ql });
    expect(ql.permRows).toHaveLength(4);

    // Every sys_permission_set read now fails — batched and per-item alike.
    const origFind = ql.find.bind(ql);
    (ql as any).find = async (object: string, q: any) => {
      if (object === 'sys_permission_set') throw new Error('fake driver: read unavailable');
      return origFind(object, q);
    };
    const warns: string[] = [];
    ql.resetCalls();
    await reconcilePermissionSetProjection(protocol, { ql, logger: { warn: (m: string) => warns.push(m) } });

    expect(ql.calls.insert).toBe(0);          // ⛔ no blind insert
    expect(ql.permRows).toHaveLength(4);      // ⛔ nothing re-created
    expect(warns.some((w) => w.includes('batched seed existence read failed'))).toBe(true);
  });

  it('an EMPTY result set is still trusted as "none exist" — the first boot depends on it', async () => {
    const ql = makeQl();
    const protocol = makeProtocol(ql);
    ql.metaRows.push({
      id: 'm1', type: 'permission', name: 'organization_admin', state: 'active',
      organization_id: null, metadata: JSON.stringify(envBody()),
    });
    const out = await reconcilePermissionSetProjection(protocol, { ql });
    expect(out.projectedFromMetadata).toBe(1);
    expect(ql.permRows).toHaveLength(1);
  });
});
