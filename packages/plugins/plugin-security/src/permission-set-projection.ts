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
 * Package-owned records (`managed_by:'package'`) keep their shipped
 * declaration as the BASELINE (boot seeding / publish materialization). The
 * 2026-07-14 direction confirmation that used to sit here — "the environment
 * customizes them through the platform's standard ADR-0005 metadata overlay"
 * — is **RETIRED** (ADR-0094 D5-R, 2026-08-09; #6609 ruling A executed by
 * #6858). #6483 rolled `permission` back to `allowOrgOverride: false`
 * (PR #6608), so ADR-0005's security row is enforced again: an overlay of the
 * authorization surface IS the "silent privilege drift" it excludes.
 *
 * What that means for THIS file, per write point:
 *
 *  - the middleware still TRANSLATES every data-door write into a metadata
 *    write — that half is unchanged. Whether the translated write is accepted
 *    is ADR-0005's tier gate, decided by the target's ARTIFACT provenance:
 *    a CODE-DECLARED set (`*.permission.ts`, a stack's `permissionSets`) is
 *    refused with 403 `NOT_OVERRIDABLE`; a set whose definition lives only in
 *    `sys_metadata` — created through the data door, or authored and
 *    published through the METADATA door (ADR-0070) — rides
 *    `allowRuntimeCreate`, still `true`, and keeps working;
 *  - that refusal is deliberately LEFT TO THE PRODUCER. This file does not
 *    pre-empt it by re-deriving artifact-backing: `isArtifactBacked` is the
 *    protocol's rule (it excludes the `'sys_metadata'` rehydration sentinel),
 *    and a second copy here would be the parallel-allowlist failure Prime
 *    Directive #8 exists to prevent. The `managed_by` column is measurably
 *    NOT that fact — `member_default`'s row is `managed_by:'admin'` and its
 *    edit is refused, `twodoors_pkgset`'s row is `managed_by:'package'` and
 *    its edit lands;
 *  - the two write points that CATCH a failed metadata write
 *    ({@link createPermissionSetWriteThrough}'s `restore` leg and
 *    {@link reconcilePermissionSetProjection}'s backfill) keep catching: both
 *    run after the record already exists, so a throw would strand the caller
 *    with a healthy-looking row and no way to hear about it. They log on the
 *    durability channel (#4632) and the backfill counts the failure — that is
 *    the degradation report, not a swallow. Neither targets an artifact-backed
 *    name in the first place (a packaged definition cannot be trashed, and the
 *    backfill only runs for names with NO metadata presence at all).
 *
 * Cross-package composition stays a POSITION concern (bind several packages'
 * sets to one position); package-first authoring (ADR-0070) gives
 * runtime-created sets a home package.
 */

import { PermissionSetSchema } from '@objectstack/spec/security';

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
  /**
   * Durability-degradation channel (AGENTS.md "Degradation log levels", #4632):
   * a metadata write that was supposed to land and did not is an `error`, not a
   * `warn` — nothing looks broken afterwards, which is exactly why the failure
   * has to be loud.
   *
   * Signature matches `Logger.error` in `@objectstack/spec/contracts`
   * (`message, error?, meta?` — the cause is its own argument), so the kernel
   * logger satisfies this interface as-is.
   */
  error?: (m: string, error?: Error, meta?: Record<string, any>) => void;
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
 * `sys_permission_set` columns that are ROW STATE, not part of the metadata
 * DEFINITION — the spec declares no such key, so they must never travel into a
 * metadata body (#4669). Each entry maps a column to the normalizer the record
 * expects, so the data door can write it straight onto the record.
 *
 * `active` is the on/off switch the Setup list views filter on and the two
 * lifecycle actions toggle (`bodyExtra: { active: true|false }` in
 * `objects/sys-permission-set.object.ts`). It is runtime state OF THE RECORD,
 * never a capability boundary its author declared — which is precisely why it
 * is not, and should not be, a key on `PermissionSetSchema`.
 */
const ROW_STATE_COLUMNS: Readonly<Record<string, (v: any) => any>> = {
  active: asBool,
};

/**
 * The body keys the permission SPEC declares, read from the Zod schema's own
 * shape — derived, never transcribed (#4669).
 *
 * `sys_permission_set` is a projection of a metadata definition, but the TABLE
 * carries columns the definition does not: {@link ROW_STATE_COLUMNS}, the
 * timestamps, and the `managed_by` / `package_id` / `customized` provenance.
 * Until #4001 a row-derived body that dragged those along still parsed —
 * `PermissionSetSchema` stripped the extras silently — so handing a whole row
 * to `saveMetaItem` appeared to work. #4001 sealed the schema `.strict()`, and
 * every such body began failing validation with `[invalid_metadata] …
 * Unrecognized key(s) on this permission set: 'active'`, which took the
 * ADR-0094 D4 boot backfill to a 100% failure rate.
 *
 * Derived from `.shape` rather than hand-listed because a literal list here
 * would go stale the moment the spec grows a key — silently dropping it from
 * every projected body, i.e. reproducing the very defect this fixes one layer
 * over. `permission-set-projection.test.ts` additionally pins that every key
 * the row→body seams can emit is one the spec declares, so a spec RENAME fails
 * a test instead of quietly losing the value at runtime.
 *
 * Resolved on first use, not at module load: `PermissionSetSchema` is a
 * {@link lazySchema} proxy and touching `.shape` at import time would
 * materialize it for every process that merely loads this module.
 */
let cachedSpecBodyKeys: ReadonlySet<string> | null = null;
export function permissionSpecBodyKeys(): ReadonlySet<string> {
  return (cachedSpecBodyKeys ??= new Set(
    Object.keys((PermissionSetSchema as unknown as { shape?: Record<string, unknown> }).shape ?? {}),
  ));
}

/**
 * Keep only what the permission spec declares. THE choke point every row→body
 * seam passes through, so no storage column can reach `saveMetaItem` — neither
 * from a live row nor from a body STORED before #4001 (data at rest written
 * while the schema still stripped the extras can still carry `active`).
 */
function pickSpecDeclaredKeys(candidate: Record<string, any>): Record<string, any> {
  const keys = permissionSpecBodyKeys();
  const body: Record<string, any> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (keys.has(key)) body[key] = value;
  }
  return body;
}

/**
 * Inverse of {@link permissionSetRowFields}: rebuild a PermissionSet body from
 * a `sys_permission_set` row (snake_case JSON-string columns → camelCase
 * body). Used by the one-time boot backfill (a legacy data-door-created
 * record becomes a metadata item) and by the data-door update merge when a
 * name has no metadata presence yet.
 *
 * The result is filtered through {@link pickSpecDeclaredKeys}: a DEFINITION is
 * what the spec declares, and nothing else off the row goes with it (#4669).
 */
export function permissionSetBodyFromRow(row: any): any {
  const adminScope = row?.admin_scope ? parseMaybeJson(row.admin_scope, undefined) : undefined;
  return pickSpecDeclaredKeys({
    name: row?.name,
    label: row?.label ?? row?.name,
    ...(row?.description != null ? { description: row.description } : {}),
    objects: parseMaybeJson(row?.object_permissions, {}),
    fields: parseMaybeJson(row?.field_permissions, {}),
    systemPermissions: parseMaybeJson(row?.system_permissions, []),
    rowLevelSecurity: parseMaybeJson(row?.row_level_security, []),
    tabPermissions: parseMaybeJson(row?.tab_permissions, {}),
    ...(adminScope ? { adminScope } : {}),
  });
}

/**
 * The row-state columns a data-door payload carries, normalized for the
 * record — `null` when it carries none. These bypass the metadata store
 * entirely: they are the record's own state (#4669).
 */
export function pickRowStateColumns(payload: any): Record<string, any> | null {
  if (!payload || typeof payload !== 'object') return null;
  const out: Record<string, any> = {};
  for (const [col, normalize] of Object.entries(ROW_STATE_COLUMNS)) {
    if (col in payload) out[col] = normalize(payload[col]);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Does this data-door payload touch the DEFINITION at all? Identity (`id` /
 * `name`) and {@link ROW_STATE_COLUMNS} do not; anything else is treated as a
 * definition edit and routes through the metadata store (an unrecognized
 * column therefore keeps the pre-#4669 behavior rather than silently skipping
 * the write-through).
 */
function touchesDefinition(payload: Record<string, any>): boolean {
  return Object.keys(payload).some(
    (k) => k !== 'id' && k !== 'name' && !(k in ROW_STATE_COLUMNS),
  );
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
 * by our own registry sync. It is the body for a declared set with no overlay
 * at all, and the reset target when an overlay IS lifted off one — which since
 * ADR-0094 D5-R means a LEGACY (pre-#6483) row removed through the operator
 * hatch, not a data-door delete: #6960 measures that delete refusing with 403
 * `NOT_OVERRIDABLE`.
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
    const items = ql?.registry?.listItems?.('permission') ?? [];
    for (const body of items) {
      // [#8378] The registered item IS the body — no `{ name, content }`
      // envelope to unwrap (`PermissionSetSchema` rejects `content` as an
      // unrecognized key, and nothing in the tree produces the envelope).
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
  return typeof ql?.registry?.listItems === 'function';
}

/**
 * Project a PermissionSet body onto its `sys_permission_set` row from the
 * ENVIRONMENT side.
 *
 * [ADR-0094] The record is a pure projection, so a missing row is CREATED
 * (`managed_by:'admin'` — A4 #2920 unified vocab, formerly 'user'; a
 * Studio-authored set appears in Setup, where the
 * #2867 band-aid declined to create). A PACKAGE-OWNED row is also projected —
 * its facets follow the body this pass is handed, while the
 * `managed_by:'package'` + `package_id` provenance is PRESERVED: the row
 * still belongs to the package.
 *
 * WHICH body that is, is the part this comment used to get wrong. The
 * 2026-07-14 direction confirmation that used to sit here — "an env-scope
 * overlay is the platform's standard ADR-0005 customization of a packaged
 * definition, and deleting the overlay resets the row to the shipped
 * declaration" — is **RETIRED**, in BOTH halves (ADR-0094 D5-R, 2026-08-09;
 * #6609 ruling A executed by #6858; the file header above records the same
 * retirement). Since #6483 / PR #6608 rolled `permission` back to
 * `allowOrgOverride: false`:
 *
 *  - **no new overlay of a packaged set can be minted.** A metadata write
 *    against a CODE-DECLARED (artifact-backed) set — `*.permission.ts`, a
 *    stack's `permissionSets` — is refused by the producer with 403
 *    `NOT_OVERRIDABLE`, so for those names the body reaching here is the
 *    DECLARED one and the projected facets ARE the shipped declaration. The
 *    supported way to change them is the one ADR-0086 always named: edit the
 *    package and re-publish. What survives is the neighbouring
 *    `allowRuntimeCreate` tier (still `true`) — a set whose definition lives
 *    only in `sys_metadata`, created through the data door or authored and
 *    published through the METADATA door (ADR-0070). That tier edits the
 *    single stored definition IN PLACE: no code-vs-overlay layering, and
 *    nothing to reset to (ADR-0094 D5-R calls it the surviving neighbour, not
 *    D5's successor);
 *  - **`customized` therefore badges LEGACY state, not a supported channel.**
 *    `supportsOverlay` is unchanged, so an overlay row authored BEFORE the
 *    rollback still merges overlay-wins at read time
 *    ({@link projectPermissionMutation} hands us `overlay ?? declared`) and
 *    this pass still stamps the flag for it. The in-repo corpus had zero such
 *    rows when PR #6608 measured it;
 *  - **"delete = reset" must NOT be read back into that.** #6960 measures the
 *    ordinary delete path refusing to lift exactly such a legacy overlay: on
 *    an environment-scoped kernel `deleteMetaItem` throws `NOT_OVERRIDABLE` /
 *    403 for an artifact-backed target of a non-overridable type BEFORE it
 *    probes for the row, and a kernel with no `environmentId` refuses the
 *    same write as `override-artifact` intent — leaving the operator hatch
 *    (`OS_METADATA_WRITABLE=permission`) as the only documented removal. With
 *    no overlay to lift — the normal case — the delete is a no-op success and
 *    the row keeps projecting the declaration. {@link readDeclaredBody} stays
 *    the correct reset target IF an overlay is ever lifted; it is no longer a
 *    path the data door can walk.
 */
export async function upsertEnvPermissionSet(
  ql: any,
  ps: any,
  _logger?: ProjectionLogger,
  opts?: { customized?: boolean },
): Promise<PermissionSeedOutcome> {
  const out: PermissionSeedOutcome = { seeded: 0, updated: 0, skippedEnvAuthored: 0, skippedForeign: 0 };
  if (!ql || typeof ql.find !== 'function' || !ps?.name) return out;

  // [ADR-0094] `customized` marks a PACKAGE-owned row that an env overlay is
  // currently shadowing, so the Setup list can badge it "customized" and the
  // reset action reads honestly. An env-authored row is not a customization of
  // anything (it IS the definition), so the flag only rides on package rows.
  const customized = opts?.customized;

  const existing = (await tryFind(ql, 'sys_permission_set', { name: ps.name }, 1))[0];
  if (!existing?.id) {
    const created = await tryInsert(ql, 'sys_permission_set', {
      id: genId('ps'),
      name: ps.name,
      ...permissionSetRowFields(ps),
      // [#4669] `active` is ROW STATE, never read from the definition body: a
      // new record starts active (same as the package seeder and the field's
      // own `defaultValue`), and the data door writes the column directly
      // afterwards. Taking it from the body would also let a body STORED
      // before #4001 — which may still carry a stale `active` — silently
      // re-flip a record an admin had just deactivated.
      active: true,
      // [A4 #2920] Unified provenance vocab: an env/Studio-authored set is
      // ADMIN-owned (formerly stamped 'user'). No runtime path branches on the
      // value except the 'package' guard, so this is a pure vocab rename.
      managed_by: 'admin',
      ...(customized !== undefined ? { customized: !!customized } : {}),
    });
    if (created) out.seeded += 1;
    return out;
  }

  // Facets follow the effective body; provenance columns are never touched
  // here — a package-owned row keeps its owner while carrying the overlay's
  // customization, and an env row keeps its user/platform/legacy provenance.
  // [#4669] Facets only — `active` is row state and is NOT projected from the
  // body (a projection pass must never re-flip a record's on/off switch).
  const patch: Record<string, any> = { id: existing.id, ...permissionSetRowFields(ps) };
  // Only stamp `customized` on package-owned rows (an overlay of a packaged
  // set). For env rows the concept doesn't apply — clear any stale flag.
  if (customized !== undefined) {
    patch.customized = existing.managed_by === 'package' ? !!customized : false;
  }
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
    try { ql?.registry?.unregisterItem?.('permission', name); } catch { /* best-effort */ }
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
  const out = await upsertEnvPermissionSet(ql, body, logger, { customized: overlayBacked });
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

/**
 * Column-patch → body-key merge for the data-door update redirect.
 *
 * Row-state columns ({@link ROW_STATE_COLUMNS}) are deliberately NOT merged —
 * they are the record's state, applied to the record itself by the
 * write-through (#4669). The merged result is filtered through
 * {@link pickSpecDeclaredKeys} because `base` may be a body STORED before
 * #4001 sealed the schema and can still carry a stripped-at-the-time `active`;
 * without the filter that legacy row would make every subsequent data-door
 * edit of the set fail spec validation.
 */
export function mergeRowPatchIntoBody(base: any, patch: Record<string, any>): any {
  const body: any = { ...stripDecorations(base) };
  if ('label' in patch) body.label = patch.label;
  if ('description' in patch) {
    if (patch.description == null) delete body.description;
    else body.description = patch.description;
  }
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
  return pickSpecDeclaredKeys(body);
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
 * INSIDE the security middleware (later in the onion), so the provenance-
 * forging gate, the delegated-admin gate, and the ordinary CRUD/FLS checks
 * have all passed before a write is translated. The driver write never
 * executes — `opCtx.result` is the projected record — so no data-plane path
 * can desync record from metadata.
 *
 * A PACKAGE-OWNED row is writable through here too: its update/delete
 * translate into env-scope overlay operations (customize / reset) — the
 * ADR-0005 layering carries the two doors now, instead of a flat refusal.
 * System-context writes pass through untouched: they ARE the projector /
 * seeder channel. Kernels without a capable metadata protocol (minimal
 * embeddings, unit-test stubs) pass through for env rows and keep the legacy
 * two-doors refusal for package rows — with no overlay layer there is
 * nothing to carry a customization.
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
    if (!capable) {
      // Single-store kernel: there is no overlay layer to translate a
      // package-set customization into, so the legacy ADR-0086 two-doors
      // protection applies HERE (the outer security gate delegates the
      // update/delete package-row check to this middleware): a
      // package-managed row stays read-only through the data door.
      //
      // [ADR-0094 D5-R] This is no longer the ONLY reason a packaged set is
      // read-only through the data door — since #6483 a CAPABLE kernel refuses
      // an artifact-backed set too, at the protocol's ADR-0005 tier gate. The
      // remedy this message names ("edit the package and re-publish") is
      // therefore right on every kernel; only the stated cause is specific to
      // this branch. The two conditions keep separate wordings deliberately
      // (#5240 — one condition, one wording): they are distinguishable and an
      // operator needs to know which one they hit. Note also that this branch
      // keys on `managed_by:'package'` — a record-provenance heuristic that is
      // the best this file can do with no protocol to ask, and measurably NOT
      // the artifact-provenance fact the capable path's gate reads.
      if (op === 'update' || op === 'delete') {
        const targets = await resolveTargetRows(ql, opCtx);
        const pkg = targets.find((t: any) => t?.managed_by === 'package');
        if (pkg) {
          const err: any = new Error(
            `[Security] Access denied: '${String(pkg.name ?? pkg.id)}' is a package-managed permission set ` +
              `(managed_by:'package') and this kernel has no metadata overlay layer to carry an environment ` +
              `customization — change it by editing its package and re-publishing (ADR-0086 two-doors).`,
          );
          err.name = 'PermissionDeniedError';
          err.status = 403;
          throw err;
        }
      }
      return next();
    }

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
          // [#4632 — AGENTS.md "Degradation log levels"] Durability, not
          // functionality: the record is back and lists normally, but its
          // definition never returned to the metadata store — the stores
          // disagree silently until someone notices the set behaves like a
          // legacy data-door row.
          logger?.error?.(
            '[security] restored permission set was NOT re-authored into metadata (ADR-0094 D3) — the record is ' +
            'back and looks healthy, but the metadata store has no definition for it, so a metadata-driven ' +
            're-provision will not recreate it. Fix: make the record body spec-valid (the error names the ' +
            'offending key) and re-save the set through Setup, or re-run boot reconciliation.',
            e as Error,
            { name: row.name },
          );
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
        const record: any = (await projectAndFetch(protocol, name)) ?? { name };
        // [#4669] Row state does not round-trip through metadata — the
        // projector created the record with the column default, so an explicit
        // `active` in the payload (the Clone action sends one) is applied here.
        const rowState = pickRowStateColumns(row);
        if (rowState && record.id && await tryUpdate(ql, 'sys_permission_set', { id: record.id, ...rowState })) {
          Object.assign(record, rowState);
        }
        results.push(record);
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
      // [#4669] A patch that touches ONLY row state (`active` — what the
      // activate/deactivate actions send as `bodyExtra`) is not a definition
      // write at all: it goes to the driver untouched, so the column write
      // keeps its ordinary engine semantics (history, updated_at, FLS) and no
      // spurious "customization" overlay is minted on a packaged set. Routing
      // it through the metadata store is what #4001's strict schema rejects.
      if (!touchesDefinition(patch)) return next();
      const rowState = pickRowStateColumns(patch);
      const results: any[] = [];
      for (const row of targets) {
        const base = await effectiveBodyForRow(protocol, ql, row);
        const body = mergeRowPatchIntoBody(base, patch);
        body.name = row.name;
        await protocol.saveMetaItem({ type: 'permission', name: row.name, item: body, ...actorArg });
        // Row state rides along on the same patch but lands on the record, not
        // in the definition (the projector above never touches these columns).
        if (rowState) await tryUpdate(ql, 'sys_permission_set', { id: row.id, ...rowState });
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
  /**
   * Records whose backfill FAILED — each one is a definition the metadata
   * store does not have and now never got. Counted (not just logged) so a
   * caller/test can see the degradation without grepping a log: #4669 stayed
   * invisible for a whole release precisely because the only signal was a
   * `warn` and the counters stayed at zero.
   */
  backfillFailed: number;
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
  // [#4669] `active` is row state, not a spec key — a definition body cannot
  // declare it, so a record is never "drifted" on account of it.
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
  const out: ProjectionReconcileOutcome = {
    projectedFromMetadata: 0, backfilledIntoMetadata: 0, driftHealed: 0, backfillFailed: 0,
  };
  const failedNames: string[] = [];
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
        out.backfillFailed += 1;
        failedNames.push(String(row.name));
        // [#4632 — AGENTS.md "Degradation log levels"] DURABILITY degradation:
        // the record keeps listing and keeps resolving, so nothing looks
        // broken — while the definition it is supposed to project stays absent
        // from the only authoritative store. Said ONCE, at the first failure,
        // with the consequence and the fix; the rest are counted and named in
        // the summary line below. #4669: this was a `warn` with no counter,
        // which is why a 100%-failing backfill sat green for a release.
        if (out.backfillFailed === 1) {
          logger?.error?.(
            '[security] permission-set backfill into metadata FAILED (ADR-0094 D4) — this environment has ' +
            '`sys_permission_set` records with NO metadata definition backing them, and the one-time backfill ' +
            'did not write one. Nothing will look broken: the records still list in Setup and the evaluator ' +
            'still resolves them from the table — but the definitions are absent from the metadata store, so a ' +
            'metadata-driven re-provision (fresh environment, package reinstall, `meta resync`) recreates none ' +
            'of them, and every boot retries and fails identically. Fix: make the record body spec-valid — the ' +
            'error below names the offending key; `permissionSetBodyFromRow()` already drops storage columns ' +
            '(`active`, timestamps, provenance), so a rejection here means the stored facet JSON itself is ' +
            'off-contract — then reboot to re-run reconciliation, or delete the orphan record.',
            e as Error,
            { name: row.name },
          );
        }
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

  if (out.backfillFailed > 0) {
    // The summary carries the same level as the degradation it summarizes —
    // an `info` "reconciled" line over a failed backfill is the reassuring
    // half-truth this rule exists to remove.
    logger?.error?.(
      `[security] sys_permission_set projection reconciled with ${out.backfillFailed} FAILED backfill(s) ` +
      '(ADR-0094 D4) — those records have no metadata definition and will not survive a re-provision. ' +
      'See the first-failure error above for the offending key and the fix.',
      undefined,
      { ...out, failedNames: failedNames.slice(0, 10) },
    );
  } else {
    logger?.info?.('[security] sys_permission_set projection reconciled (ADR-0094 D4)', { ...out });
  }
  return out;
}
