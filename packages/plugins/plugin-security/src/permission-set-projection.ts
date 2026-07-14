// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_permission_set` as a PURE PROJECTION of the metadata layer (ADR-0094;
 * framework#2875 — retires the two-store split-brain behind #2857/#2867).
 *
 * The metadata layer (packaged declarations + the `sys_metadata` overlay,
 * merged overlay-wins by the protocol's layered read) is the ONLY
 * authoritative store for a permission-set DEFINITION. The queryable
 * `sys_permission_set` record is a derived read-model:
 *
 *  - every non-system data-door write (the Setup UI's generic CRUD, bulk
 *    imports, any future API routed through ObjectQL) is REDIRECTED into a
 *    metadata write at the engine-middleware choke point
 *    ({@link createPermissionSetWriteThrough}) — the driver write never
 *    executes, so no data-plane path can produce a record the metadata
 *    doesn't back;
 *  - the record (and the metadata manager's in-memory `permission` entry,
 *    which the evaluator's registry-first `list('permission')` resolution
 *    reads) is written ONLY by the projector
 *    ({@link projectPermissionMutation}), which the protocol AWAITS on every
 *    save / publish / delete (`registerMutationProjector`) — no projection
 *    race;
 *  - boot reconciliation ({@link reconcilePermissionSetProjection}) heals
 *    drift left by historic writes and migrates legacy data-door-created
 *    records into the metadata store (one-time backfill).
 *
 * Package-owned records (`managed_by:'package'`) remain the package door's
 * territory (ADR-0086): their baseline is the shipped declaration, projected
 * by boot seeding / publish materialization; the env door refuses them.
 */

export const SYSTEM_CTX = { isSystem: true };

export function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

export async function tryFind(ql: any, object: string, where: any, limit = 100): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
export async function tryInsert(ql: any, object: string, data: any): Promise<any | null> {
  try { return await ql.insert(object, data, { context: SYSTEM_CTX }); } catch { return null; }
}
export async function tryUpdate(ql: any, object: string, data: any): Promise<boolean> {
  try { await ql.update(object, data, { context: SYSTEM_CTX }); return true; } catch { return false; }
}

export interface ProjectionLogger {
  info?: (m: string, meta?: Record<string, any>) => void;
  warn?: (m: string, meta?: Record<string, any>) => void;
}

/** Aggregated outcome of a projection pass (shared with the boot seeders). */
export interface PermissionSeedOutcome {
  seeded: number;
  updated: number;
  skippedEnvAuthored: number;
  skippedForeign: number;
  /** Records retired because their definition was deleted from metadata. */
  deleted?: number;
}

/**
 * Serialize a PermissionSet body into the `sys_permission_set` facet/identity
 * columns. THE one row shape both doors project through — package boot-seed /
 * publish materialization and the env projector — so the two can never
 * hydrate differently.
 */
export function permissionSetRowFields(ps: any): Record<string, any> {
  return {
    label: ps.label ?? ps.name,
    description: ps.description ?? null,
    object_permissions: JSON.stringify(ps.objects ?? {}),
    field_permissions: JSON.stringify(ps.fields ?? {}),
    system_permissions: JSON.stringify(ps.systemPermissions ?? []),
    row_level_security: JSON.stringify(ps.rowLevelSecurity ?? []),
    tab_permissions: JSON.stringify(ps.tabPermissions ?? {}),
    // [ADR-0090 D12] Delegated-admin scope travels with the set row so the
    // delegated-admin gate can resolve a DB-loaded delegate's authority.
    admin_scope: ps.adminScope ? JSON.stringify(ps.adminScope) : null,
  };
}

const parseMaybeJson = (v: any, fallback: any): any => {
  if (typeof v !== 'string') return v ?? fallback;
  try {
    const parsed = JSON.parse(v === '' ? 'null' : v);
    return parsed ?? fallback;
  } catch { return fallback; }
};

const asBool = (v: any): boolean => !(v === false || v === 0 || v === '0' || v === 'false');

/**
 * Inverse of {@link permissionSetRowFields}: rebuild a PermissionSet body from
 * a `sys_permission_set` row (snake_case JSON-string columns → camelCase
 * body). Used by the one-time boot backfill (a legacy data-door-created
 * record becomes a metadata item) and by the data-door update merge when a
 * name has no metadata presence yet.
 */
export function permissionSetBodyFromRow(row: any): any {
  const adminScope = row?.admin_scope ? parseMaybeJson(row.admin_scope, undefined) : undefined;
  return {
    name: row?.name,
    label: row?.label ?? row?.name,
    ...(row?.description != null ? { description: row.description } : {}),
    objects: parseMaybeJson(row?.object_permissions, {}),
    fields: parseMaybeJson(row?.field_permissions, {}),
    systemPermissions: parseMaybeJson(row?.system_permissions, []),
    rowLevelSecurity: parseMaybeJson(row?.row_level_security, []),
    tabPermissions: parseMaybeJson(row?.tab_permissions, {}),
    ...(adminScope ? { adminScope } : {}),
    ...(row?.active != null ? { active: asBool(row.active) } : {}),
  };
}

/**
 * Marker stamped on bodies this module writes into the metadata manager's
 * in-memory registry ({@link syncEvaluatorRegistry}). The manager's `get`/
 * `list` are registry-first, so without a marker our own synced copy would be
 * indistinguishable from a real packaged artifact — and after the overlay is
 * deleted, the layered read's `code` layer would keep echoing it, turning a
 * retire into a bogus "reset" (the definition would be undeletable).
 */
const ENV_PROJECTION_MARKER = '_envProjection';

/** Strip layered-read / registry decorations so a re-authored body is clean. */
function stripDecorations(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const { _packageId, _provenance, _diagnostics, _lock, _lockReason, _lockSource, [ENV_PROJECTION_MARKER]: _mark, ...clean } = body;
  return clean;
}

/** True when a layered-read layer is just our own registry echo, not a real artifact. */
const isProjectionEcho = (v: any): boolean =>
  !!(v && typeof v === 'object' && (v as any)[ENV_PROJECTION_MARKER]);

/**
 * Read the DECLARED (artifact) body for a permission set from the engine's
 * SchemaRegistry — the same source `bootstrapDeclaredPermissions` seeds from,
 * and the one store the env projection never writes, so it can't be poisoned
 * by our own registry sync. Used as the reset target when an env overlay is
 * deleted off a declared set.
 *
 * Items tagged `_packageId: 'sys_metadata'` are RUNTIME SHADOWS — hydrated
 * into the registry from overlay rows (loadMetaFromDb / getMetaItems), not
 * shipped artifacts — and are skipped: after a runtime-only definition is
 * deleted, its shadow may linger (`removeRuntimeShadow` only drops shadows
 * that cover a packaged artifact), and treating it as declared would make the
 * definition undeletable.
 */
function readDeclaredBody(ql: any, name: string): any {
  try {
    const items = ql?._registry?.listItems?.('permission') ?? [];
    for (const i of items) {
      const body = i?.content ?? i;
      // Skip projection echoes too: deleteMetaItem's registry heal
      // (restoreArtifactRegistryView) can re-register the metadata manager's
      // view — which may be OUR marked copy — into the engine registry as a
      // plain item; without this skip a deleted runtime-only definition
      // would zombie back as "declared" and become undeletable.
      if (body?.name === name && body?._packageId !== 'sys_metadata' && !isProjectionEcho(body)) {
        return body;
      }
    }
  } catch { /* fall through */ }
  return null;
}

/** Whether the engine exposes a SchemaRegistry we can read declared bodies from. */
function hasSchemaRegistry(ql: any): boolean {
  return typeof ql?._registry?.listItems === 'function';
}

/**
 * Project an ENVIRONMENT-authored PermissionSet body onto its
 * `sys_permission_set` row — the env-door counterpart of
 * `upsertPackagePermissionSet` (ADR-0086 two-doors).
 *
 * [ADR-0094] The record is a pure projection now, so a missing row is
 * CREATED (`managed_by:'user'`) — a Studio-authored set appears in Setup —
 * where the #2867 band-aid declined to create. Ownership is still decided by
 * the EXISTING RECORD's `managed_by`, never the body (the layered read stamps
 * `_packageId` provenance on env-authored sets too): a package-owned row is
 * refused — its baseline is the shipped declaration.
 */
export async function upsertEnvPermissionSet(
  ql: any,
  ps: any,
  logger?: ProjectionLogger,
): Promise<PermissionSeedOutcome> {
  const out: PermissionSeedOutcome = { seeded: 0, updated: 0, skippedEnvAuthored: 0, skippedForeign: 0 };
  if (!ql || typeof ql.find !== 'function' || !ps?.name) return out;

  const existing = (await tryFind(ql, 'sys_permission_set', { name: ps.name }, 1))[0];
  if (!existing?.id) {
    const created = await tryInsert(ql, 'sys_permission_set', {
      id: genId('ps'),
      name: ps.name,
      ...permissionSetRowFields(ps),
      active: ps.active != null ? asBool(ps.active) : true,
      managed_by: 'user',
    });
    if (created) out.seeded += 1;
    return out;
  }

  // A package-owned record is the package's declared baseline (re-seeded at
  // boot / on publish); an env override lives in the overlay/effective layer,
  // not this row. Refusing here keeps the two doors from fighting.
  if (existing.managed_by === 'package') {
    out.skippedForeign += 1;
    logger?.warn?.('[security] env permission save targets a package-owned set — record left at package baseline', { name: ps.name });
    return out;
  }

  const patch: Record<string, any> = { id: existing.id, ...permissionSetRowFields(ps) };
  if (ps.active != null) patch.active = asBool(ps.active);
  if (await tryUpdate(ql, 'sys_permission_set', patch)) {
    out.updated += 1;
  }
  return out;
}

/**
 * Sync the metadata manager's in-memory `permission` entry with the effective
 * body just projected. The evaluator's `resolvePermissionSets` resolves from
 * `metadata.list('permission')`, which is REGISTRY-FIRST — without this, an
 * env overlay of a declared set would display (layered read + record) while
 * the evaluator kept enforcing the stale declared body.
 *
 * Only runs while an OVERLAY actually exists (`overlayBacked`) — an
 * overlay-less name needs no shadow (the registry already holds the declared
 * body, or the DatabaseLoader serves the runtime row) and writing one would
 * clobber the pristine declared entry. The synced copy is stamped with
 * {@link ENV_PROJECTION_MARKER} so it can never masquerade as a packaged
 * artifact after the overlay is gone. When the overlay disappears, a stale
 * echo is healed back to `restoreTo` (the declared body) or dropped.
 *
 * Best-effort: when the facade lacks `registerInMemory`, overlay-only names
 * still resolve via the DatabaseLoader / record dbLoader.
 */
async function syncEvaluatorRegistry(
  metadata: any,
  name: string,
  body: any,
  overlayBacked: boolean,
): Promise<void> {
  try {
    if (!metadata || typeof metadata.registerInMemory !== 'function' || !name) return;
    if (overlayBacked && body?.name) {
      metadata.registerInMemory('permission', name, {
        ...stripDecorations(body),
        [ENV_PROJECTION_MARKER]: true,
      });
      return;
    }
    // Overlay gone: heal a stale echo of ours back to the real body, or drop it.
    const current = typeof metadata.get === 'function' ? await metadata.get('permission', name) : undefined;
    if (!isProjectionEcho(current)) return;
    if (body?.name) {
      metadata.registerInMemory('permission', name, stripDecorations(body));
    } else {
      dropEvaluatorRegistryEntry(metadata, name);
    }
  } catch { /* best-effort */ }
}

/** Drop the in-memory `permission` entry for a retired definition. */
function dropEvaluatorRegistryEntry(metadata: any, name: string): void {
  try {
    if (metadata && typeof metadata.unregister === 'function' && name) {
      // unregister() also asks writable DB loaders to delete — the overlay
      // row is already gone (deleteMetaItem ran first), so this is a no-op
      // there and an in-memory removal here.
      void metadata.unregister('permission', name);
    }
  } catch { /* best-effort */ }
}

/** Retire the record of a definition deleted from metadata (trash applies). */
async function retirePermissionSetRecord(
  ql: any,
  metadata: any,
  name: string,
  logger?: ProjectionLogger,
): Promise<PermissionSeedOutcome> {
  const out: PermissionSeedOutcome = { seeded: 0, updated: 0, skippedEnvAuthored: 0, skippedForeign: 0, deleted: 0 };
  const existing = (await tryFind(ql, 'sys_permission_set', { name }, 1))[0];
  if (!existing?.id) return out;
  if (existing.managed_by === 'package') {
    out.skippedForeign += 1;
    logger?.warn?.('[security] metadata delete targets a package-owned set record — left to the package door', { name });
    return out;
  }
  try {
    await ql.delete('sys_permission_set', { where: { id: existing.id }, context: SYSTEM_CTX });
    out.deleted = 1;
    dropEvaluatorRegistryEntry(metadata, name);
    // Drop any engine-registry ghost of the retired definition (a runtime
    // shadow, or a projection echo re-registered by the delete-time registry
    // heal) so metadata lists don't keep showing a deleted set.
    try { ql?._registry?.unregisterItem?.('permission', name); } catch { /* best-effort */ }
  } catch (e) {
    logger?.warn?.('[security] failed to retire sys_permission_set record after metadata delete', {
      name, error: (e as Error)?.message,
    });
  }
  return out;
}

export interface ProjectionDeps {
  ql: any;
  /** Metadata manager facade (`getService('metadata')`) for the evaluator-registry sync. */
  metadata?: any;
  logger?: ProjectionLogger;
}

/**
 * THE `permission` mutation projector (ADR-0094): re-read the FRESH effective
 * body via the protocol's layered read (overlay-wins; the boot-time registry
 * would hand back a stale declared body) and project it onto the record +
 * evaluator registry. A mutation whose layered read yields NO body (a
 * runtime-only definition was deleted) retires the record; a delete that
 * reveals the artifact baseline (overlay tombstone) re-projects the declared
 * body — the "reset" semantic.
 *
 * Returns the projection outcome, or `null` when the event is skipped
 * (draft, non-permission, or unnamed).
 */
export async function projectPermissionMutation(
  protocol: any,
  deps: ProjectionDeps,
  evt: { type?: string; name?: string; state?: string; organizationId?: string | null } | null | undefined,
): Promise<PermissionSeedOutcome | null> {
  if (evt?.type !== 'permission' || evt.state === 'draft' || !evt.name) return null;
  const { ql, metadata, logger } = deps;
  let body: any = null;
  let overlayBacked = false;
  if (protocol && typeof protocol.getMetaItemLayered === 'function') {
    const layered = await protocol.getMetaItemLayered({
      type: 'permission',
      name: evt.name,
      ...(evt.organizationId ? { organizationId: evt.organizationId } : {}),
    });
    // `getMetaItemLayered` may return a layered envelope (`{ effective | code }`)
    // OR the effective body directly (top-level `name`) — accept both. The
    // envelope carries `name` too, so detect it by its layer keys: an envelope
    // whose layers are all null means the definition is GONE (retire), and
    // must not be mistaken for a body. Layers that are just our own registry
    // echo ({@link ENV_PROJECTION_MARKER}) don't count as a definition either —
    // the declared (artifact) baseline is read from the engine SchemaRegistry,
    // which this module never writes.
    const isEnvelope = layered && typeof layered === 'object'
      && ('effective' in layered || 'overlay' in layered || 'code' in layered);
    if (isEnvelope) {
      const overlay = layered.overlay ?? null;
      overlayBacked = !!overlay;
      const declared = readDeclaredBody(ql, evt.name);
      // The envelope's `code`/`effective` layers are only a fallback for
      // kernels without a readable SchemaRegistry: they can echo a deleted
      // definition (tombstoned overlay row via the DatabaseLoader, a lingering
      // runtime shadow, or our own registry sync), so where the registry is
      // available, overlay ?? declared is the whole truth — an empty result
      // means the definition is GONE (retire).
      if (hasSchemaRegistry(ql)) {
        body = overlay ?? declared;
      } else {
        const code = isProjectionEcho(layered.code) ? null : (layered.code ?? null);
        const effective = isProjectionEcho(layered.effective) ? null : (layered.effective ?? null);
        body = overlay ?? code ?? effective;
      }
    } else {
      body = layered ?? null;
    }
  }
  if (!body?.name) {
    await syncEvaluatorRegistry(metadata, evt.name, null, false);
    return retirePermissionSetRecord(ql, metadata, evt.name, logger);
  }
  const out = await upsertEnvPermissionSet(ql, body, logger);
  if (out.seeded + out.updated > 0) {
    await syncEvaluatorRegistry(metadata, evt.name, body, overlayBacked);
  }
  return out;
}

/**
 * Register the permission projector on the protocol. Prefers the AWAITED
 * `registerMutationProjector` seam (ADR-0094 — no projection race); falls
 * back to the fire-and-forget `onMetadataMutation` subscription (#2867) for
 * protocol implementations that predate the projector. Returns `true` when
 * wired.
 */
export function registerPermissionSetProjection(
  protocol: any,
  deps: ProjectionDeps,
): boolean {
  if (!protocol) return false;
  const handler = (evt: any) => projectPermissionMutation(protocol, deps, evt);
  if (typeof protocol.registerMutationProjector === 'function') {
    protocol.registerMutationProjector('permission', async (evt: any) => { await handler(evt); });
    return true;
  }
  if (typeof protocol.onMetadataMutation === 'function') {
    protocol.onMetadataMutation((evt: any) => {
      void handler(evt).catch((err: any) => {
        deps.logger?.warn?.('[security] env permission projection after save failed', {
          name: evt?.name, error: err?.message,
        });
      });
    });
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data-door write-through (ADR-0094 D3)
// ─────────────────────────────────────────────────────────────────────────────

const scalarId = (v: unknown): v is string | number | bigint =>
  v !== null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint');

/** Resolve the rows a data-door update/delete targets (single-id or filtered). */
async function resolveTargetRows(ql: any, opCtx: any): Promise<any[]> {
  const data = opCtx?.data;
  if (data && typeof data === 'object' && !Array.isArray(data) && scalarId(data.id)) {
    return tryFind(ql, 'sys_permission_set', { id: data.id }, 1);
  }
  const where = opCtx?.options?.where;
  if (where && typeof where === 'object' && scalarId((where as any).id)) {
    return tryFind(ql, 'sys_permission_set', { id: (where as any).id }, 1);
  }
  if (where && typeof where === 'object') {
    try {
      const rows = await ql.find('sys_permission_set', { where, limit: 500 }, { context: SYSTEM_CTX });
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }
  }
  return [];
}

/** Column-patch → body-key merge for the data-door update redirect. */
export function mergeRowPatchIntoBody(base: any, patch: Record<string, any>): any {
  const body: any = { ...stripDecorations(base) };
  if ('label' in patch) body.label = patch.label;
  if ('description' in patch) {
    if (patch.description == null) delete body.description;
    else body.description = patch.description;
  }
  if ('active' in patch) body.active = asBool(patch.active);
  if ('object_permissions' in patch) body.objects = parseMaybeJson(patch.object_permissions, {});
  if ('field_permissions' in patch) body.fields = parseMaybeJson(patch.field_permissions, {});
  if ('system_permissions' in patch) body.systemPermissions = parseMaybeJson(patch.system_permissions, []);
  if ('row_level_security' in patch) body.rowLevelSecurity = parseMaybeJson(patch.row_level_security, []);
  if ('tab_permissions' in patch) body.tabPermissions = parseMaybeJson(patch.tab_permissions, {});
  if ('admin_scope' in patch) {
    const scope = patch.admin_scope == null ? undefined : parseMaybeJson(patch.admin_scope, undefined);
    if (scope === undefined) delete body.adminScope;
    else body.adminScope = scope;
  }
  if (!body.objects || typeof body.objects !== 'object') body.objects = {};
  return body;
}

/** Effective (layered, overlay-wins) body for a record's name, else the row itself. */
async function effectiveBodyForRow(protocol: any, ql: any, row: any): Promise<any> {
  try {
    const layered = await protocol.getMetaItemLayered({ type: 'permission', name: row.name });
    let body: any;
    if (hasSchemaRegistry(ql)) {
      body = layered?.overlay ?? readDeclaredBody(ql, row.name);
    } else {
      body = layered?.overlay
        ?? (isProjectionEcho(layered?.code) ? null : layered?.code)
        ?? (isProjectionEcho(layered?.effective) ? null : layered?.effective);
    }
    if (body?.name) return body;
  } catch { /* fall through */ }
  return permissionSetBodyFromRow(row);
}

export interface WriteThroughDeps extends ProjectionDeps {
  /** Lazy protocol handle — the protocol service may register after start(). */
  getProtocol: () => any;
}

/**
 * Engine middleware: redirect every non-system data-door write on
 * `sys_permission_set` into the metadata store (ADR-0094 D3). Registered
 * INSIDE the security middleware (later in the onion), so the two-doors gate,
 * the delegated-admin gate, and the ordinary CRUD/FLS checks have all passed
 * before a write is translated. The driver write never executes — `opCtx.result`
 * is the projected record — so no data-plane path can desync record from
 * metadata.
 *
 * System-context writes pass through untouched: they ARE the projector /
 * seeder channel. Kernels without a capable metadata protocol (minimal
 * embeddings, unit-test stubs) also pass through — a single store has no
 * split brain to prevent.
 */
export function createPermissionSetWriteThrough(
  deps: WriteThroughDeps,
): (opCtx: any, next: () => Promise<void>) => Promise<void> {
  const { ql, logger } = deps;

  const projectAndFetch = async (protocol: any, name: string): Promise<any> => {
    // The awaited projector inside saveMetaItem/deleteMetaItem normally did
    // this already — re-running is an idempotent upsert, and covers the
    // window where the projector isn't registered yet (pre-kernel:ready).
    await projectPermissionMutation(protocol, deps, { type: 'permission', name, state: 'active', organizationId: null });
    return (await tryFind(ql, 'sys_permission_set', { name }, 1))[0] ?? null;
  };

  return async (opCtx: any, next: () => Promise<void>): Promise<void> => {
    if (opCtx?.object !== 'sys_permission_set') return next();
    if (opCtx?.context?.isSystem) return next();
    const op = opCtx?.operation;
    if (!['insert', 'update', 'delete', 'restore'].includes(op)) return next();

    const protocol = deps.getProtocol?.();
    const capable = !!protocol
      && typeof protocol.saveMetaItem === 'function'
      && typeof protocol.deleteMetaItem === 'function'
      && typeof protocol.getMetaItemLayered === 'function';
    if (!capable) return next();

    const actor = opCtx?.context?.userId ? String(opCtx.context.userId) : undefined;
    const actorArg = actor ? { actor } : {};

    if (op === 'restore') {
      // Let the engine un-trash the record, then re-author its definition
      // into metadata (the delete removed it) so the stores converge live.
      await next();
      const restored = await resolveTargetRows(ql, opCtx);
      for (const row of restored) {
        if (!row?.name) continue;
        try {
          await protocol.saveMetaItem({ type: 'permission', name: row.name, item: permissionSetBodyFromRow(row), ...actorArg });
        } catch (e) {
          logger?.warn?.('[security] failed to re-author restored permission set into metadata', {
            name: row.name, error: (e as Error)?.message,
          });
        }
      }
      return;
    }

    if (op === 'insert') {
      const rows = Array.isArray(opCtx.data) ? opCtx.data : [opCtx.data];
      // A payload without a usable machine name gets the engine's own
      // required-field validation error — don't mask it.
      if (rows.some((r: any) => !r || typeof r !== 'object' || !r.name || typeof r.name !== 'string')) {
        return next();
      }
      const results: any[] = [];
      for (const row of rows) {
        const name = String(row.name);
        const dup = (await tryFind(ql, 'sys_permission_set', { name }, 1))[0];
        if (dup) {
          const err: any = new Error(`[Security] permission set '${name}' already exists`);
          err.status = 409;
          throw err;
        }
        // The metadata write is the authoritative one; spec validation
        // (PermissionSetSchema) runs inside saveMetaItem and rejects an
        // off-contract body with a structured 422.
        await protocol.saveMetaItem({ type: 'permission', name, item: permissionSetBodyFromRow(row), ...actorArg });
        results.push((await projectAndFetch(protocol, name)) ?? { name });
      }
      opCtx.result = Array.isArray(opCtx.data) ? results : results[0];
      return; // driver write intentionally skipped — the record is projector-owned
    }

    const targets = await resolveTargetRows(ql, opCtx);
    if (targets.length === 0 || targets.some((t: any) => !t?.name)) return next();

    if (op === 'update') {
      const patch = Array.isArray(opCtx.data) ? null : opCtx.data;
      if (!patch || typeof patch !== 'object') return next();
      if (typeof patch.name === 'string' && targets.some((t: any) => t.name !== patch.name)) {
        const err: any = new Error(
          `[Security] renaming a permission set through the data door is not supported — the name is its ` +
          `metadata identity (ADR-0094). Clone to a new name and delete the old set instead.`,
        );
        err.status = 400;
        throw err;
      }
      const results: any[] = [];
      for (const row of targets) {
        const base = await effectiveBodyForRow(protocol, ql, row);
        const body = mergeRowPatchIntoBody(base, patch);
        body.name = row.name;
        await protocol.saveMetaItem({ type: 'permission', name: row.name, item: body, ...actorArg });
        results.push((await projectAndFetch(protocol, row.name)) ?? { id: row.id, name: row.name });
      }
      opCtx.result = results.length === 1 ? results[0] : results;
      return;
    }

    // delete: remove the definition from the metadata store. Runtime-only
    // definitions hard-delete (the projector then retires the record, trash
    // semantics apply); artifact-backed definitions tombstone their overlay —
    // an ADR-0005 RESET — and the record re-projects to the declared body
    // instead of vanishing (a packaged definition cannot be deleted from the
    // environment).
    let lastOutcome: any = true;
    for (const row of targets) {
      await protocol.deleteMetaItem({ type: 'permission', name: row.name, ...actorArg });
      const res = await projectPermissionMutation(protocol, deps, {
        type: 'permission', name: row.name, state: 'deleted', organizationId: null,
      });
      if (res && (res.seeded + res.updated) > 0) {
        logger?.info?.('[security] permission set reset to its declared baseline (artifact-backed; ADR-0094)', { name: row.name });
      }
      lastOutcome = res?.deleted ? true : lastOutcome;
    }
    opCtx.result = lastOutcome;
    return;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot reconciliation + one-time backfill (ADR-0094 D4)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectionReconcileOutcome {
  /** Records created/updated from env-scope metadata overlays. */
  projectedFromMetadata: number;
  /** Legacy data-door-only records migrated into the metadata store. */
  backfilledIntoMetadata: number;
  /** Records re-projected because they drifted from the effective body. */
  driftHealed: number;
}

/** Compare a record's projected columns against a body — true when they differ. */
export function recordDiffersFromBody(row: any, body: any): boolean {
  const want = permissionSetRowFields(body);
  const norm = (v: any) => JSON.stringify(parseMaybeJson(v, null));
  for (const key of ['object_permissions', 'field_permissions', 'system_permissions', 'row_level_security', 'tab_permissions', 'admin_scope'] as const) {
    if (norm(row?.[key]) !== norm(want[key])) return true;
  }
  if ((row?.label ?? null) !== (want.label ?? null)) return true;
  if ((row?.description ?? null) !== (want.description ?? null)) return true;
  if (body?.active != null && asBool(row?.active) !== asBool(body.active)) return true;
  return false;
}

/**
 * Converge `sys_permission_set` with the metadata layer at boot (idempotent):
 *
 *  1. every ACTIVE env-scope `permission` overlay projects onto its record
 *     (creating missing ones) — metadata wins;
 *  2. an env-authored record whose name has NO metadata presence (no
 *     declaration, no overlay) is a legacy data-door creation — its body is
 *     backfilled into the metadata store ONCE (enforcement unchanged: the
 *     evaluator's db fallback already resolved exactly this body);
 *  3. an env-authored record that drifted from an EXISTING effective body is
 *     re-projected from metadata, loudly — for such names the evaluator
 *     already resolved the metadata body, so the record drift was
 *     display-only and never enforced (promoting it would silently change
 *     effective permissions at upgrade).
 */
export async function reconcilePermissionSetProjection(
  protocol: any,
  deps: ProjectionDeps,
): Promise<ProjectionReconcileOutcome> {
  const out: ProjectionReconcileOutcome = { projectedFromMetadata: 0, backfilledIntoMetadata: 0, driftHealed: 0 };
  const { ql, logger } = deps;
  if (!ql || typeof ql.find !== 'function' || !protocol || typeof protocol.getMetaItemLayered !== 'function') {
    return out;
  }

  // 1. env-scope overlays → records.
  const overlayNames = new Set<string>();
  for (const type of ['permission', 'permissions']) {
    const rows = await tryFind(ql, 'sys_metadata', { type, state: 'active' }, 1000);
    for (const r of rows) {
      if ((r?.organization_id ?? null) !== null || !r?.name) continue; // env-wide overlays only
      overlayNames.add(String(r.name));
    }
  }
  for (const name of overlayNames) {
    const res = await projectPermissionMutation(protocol, deps, {
      type: 'permission', name, state: 'active', organizationId: null,
    });
    out.projectedFromMetadata += (res?.seeded ?? 0) + (res?.updated ?? 0);
  }

  // 2 + 3. env-authored records: backfill or heal.
  const records = await tryFind(ql, 'sys_permission_set', {}, 1000);
  for (const row of records) {
    if (!row?.name || row.managed_by === 'package') continue;
    if (overlayNames.has(String(row.name))) continue; // governed + projected above
    let layered: any = null;
    try {
      layered = await protocol.getMetaItemLayered({ type: 'permission', name: row.name });
    } catch { layered = null; }
    // Same trust rule as the projector: with a readable SchemaRegistry the
    // declared body is the whole truth for overlay-less names — the layered
    // `code`/`effective` layers can echo tombstoned rows or runtime shadows
    // and would suppress a legitimate backfill.
    let effective: any = readDeclaredBody(ql, row.name);
    if (!effective?.name && !hasSchemaRegistry(ql)) {
      effective = (isProjectionEcho(layered?.effective) ? null : layered?.effective)
        ?? (isProjectionEcho(layered?.code) ? null : layered?.code)
        ?? null;
    }
    if (!effective?.name) {
      const canSave = typeof protocol.saveMetaItem === 'function';
      if (!canSave) continue;
      try {
        await protocol.saveMetaItem({
          type: 'permission', name: row.name, item: permissionSetBodyFromRow(row), actor: 'system',
        });
        out.backfilledIntoMetadata += 1;
      } catch (e) {
        logger?.warn?.('[security] permission-set backfill into metadata failed (ADR-0094 D4)', {
          name: row.name, error: (e as Error)?.message,
        });
      }
    } else if (recordDiffersFromBody(row, effective)) {
      // These names have NO env overlay (skipped above), so the effective
      // body IS the declared one — the registry already enforces it; only
      // the record needs healing. No registry sync (it would clobber the
      // pristine declared entry with a projection copy).
      logger?.warn?.(
        '[security] sys_permission_set record drifted from its metadata definition — re-projected (metadata wins; ADR-0094 D4)',
        { name: row.name },
      );
      const res = await upsertEnvPermissionSet(ql, stripDecorations(effective), logger);
      if (res.updated + res.seeded > 0) {
        out.driftHealed += 1;
      }
    }
  }

  logger?.info?.('[security] sys_permission_set projection reconciled (ADR-0094 D4)', { ...out });
  return out;
}
