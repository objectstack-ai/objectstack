// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PermissionSet, ObjectPermission, FieldPermissionParsed } from '@objectstack/spec/security';

/**
 * Operation type mapping to permission checks.
 *
 * `transfer` is pre-mapped to its RBAC bit (#1883) even though the dedicated
 * ObjectQL operation does not exist yet (roadmap M2): the moment it is
 * dispatched through the security middleware it is gated by `allowTransfer` —
 * deny unless a resolved permission set grants it. (`allowTransfer` is also
 * ENFORCED today through the ordinary insert/update `owner_id` door, #3004.)
 *
 * The former `restore`/`purge` rows RETIRED with their bits (#12497, ADR-0049
 * — maintainer ruling 2026-08-26 accepting #1883's recommendation B):
 * `allowRestore`/`allowPurge` are `retiredKey()` tombstones in the spec, so a
 * mapping onto them was a claim about a surface that rejects authoring. A
 * dispatched `restore`/`purge` is now denied unconditionally by the
 * DESTRUCTIVE_OPERATIONS backstop below — there is still no window where the
 * ops could ship ungated. The rows return with the M2 lifecycle initiative
 * (feature + RBAC in one batch), together with the bits they read.
 */
const OPERATION_TO_PERMISSION: Record<string, keyof ObjectPermission> = {
  find: 'allowRead',
  findOne: 'allowRead',
  count: 'allowRead',
  aggregate: 'allowRead',
  insert: 'allowCreate',
  update: 'allowEdit',
  delete: 'allowDelete',
  transfer: 'allowTransfer',
};

/**
 * Destructive operation class — operations that must FAIL CLOSED when they are
 * not mapped to a concrete permission key. See ADR-0049: an unrecognised
 * destructive operation must be DENIED rather than silently allowed by the
 * default-allow fallthrough. Since #12497 this set is the ACTIVE gate for
 * `restore`/`purge` (their mapping rows retired with their tombstoned bits —
 * denial is unconditional, not even `modifyAllRecords` reaches them until the
 * M2 ops ship with re-added rows) and the backstop for `transfer` (mapped
 * above; this keeps it fail-closed if the mapping is ever removed).
 * Non-destructive unknown operations retain default-allow so custom read-side
 * operations are not broken.
 */
const DESTRUCTIVE_OPERATIONS = new Set<string>(['transfer', 'restore', 'purge']);

/**
 * Permission keys covered by the `modifyAllRecords` super-user WRITE bypass:
 * edit/delete plus the MAPPED members of the destructive lifecycle class,
 * DERIVED from the two constants above so a future destructive op added to the
 * map+set is covered automatically (hand-listing it inline is how bypass gaps
 * happen — #1883). Unmapped destructive ops (`restore`/`purge` since #12497)
 * contribute nothing here — they are denied before the bypass is consulted.
 * NOTE this means "Modify All Data" grants (incl. the wildcard on
 * organization_admin / admin_full_access defaults) cover `transfer` (and will
 * cover restore/purge again when the M2 batch re-adds their rows — Salesforce
 * semantics, confirmed in the #1883 disposition; revisit per-op when M2 lands).
 */
const MODIFY_ALL_WRITE_KEYS = new Set<keyof ObjectPermission>([
  'allowEdit',
  'allowDelete',
  ...[...DESTRUCTIVE_OPERATIONS].flatMap((op) => {
    const key = OPERATION_TO_PERMISSION[op];
    return key ? [key] : [];
  }),
]);

/** CRUD operation class an object-level `requiredPermissions` map keys on. */
export type CrudBucket = 'read' | 'create' | 'update' | 'delete';

/**
 * [#4647] Which super-user ("View/Modify All Data") bit answers a bypass
 * question:
 *
 *  - `view`   → the READ bypass: `viewAllRecords` OR `modifyAllRecords`
 *               (Modify All Data implies View All Data).
 *  - `modify` → the WRITE bypass: `modifyAllRecords` ONLY. "View All Data" is
 *               a read power and must never widen a write — the whole point of
 *               shipping the two bits separately.
 */
export type SuperuserBypassBit = 'view' | 'modify';

/**
 * [#4647] The bypass bit that governs an ObjectQL operation, DERIVED from
 * {@link crudBucketForOperation} so a future operation added to the CRUD map is
 * classified automatically instead of being silently treated as a read.
 *
 * `export` is the one op with no CRUD bit of its own; it is a bulk READ
 * (`export ⊆ list`, #3544), so it asks for the view bit. Everything the CRUD
 * map does not classify as a read asks for the stronger `modify` bit — the
 * fail-closed direction for an unknown operation.
 */
export function superuserBypassBitForOperation(operation: string): SuperuserBypassBit {
  if (operation === 'export') return 'view';
  return crudBucketForOperation(operation) === 'read' ? 'view' : 'modify';
}

/**
 * [ADR-0066 ⑤] Map a raw ObjectQL operation to the CRUD class a per-operation
 * `requiredPermissions` map is keyed on, DERIVED from `OPERATION_TO_PERMISSION`
 * so it stays in lockstep with the CRUD permission bits (and any future
 * destructive op added there). `transfer` folds into `update`. Returns `null`
 * for an operation with no CRUD mapping (e.g. a custom read-side op) — such an
 * op is never matched by a per-operation map, but the flat `string[]` form
 * still gates it via its `all` bucket. (`restore`/`purge` fell out of the map
 * with #12497 — they resolve `null` here, and their dispatch is denied at the
 * object gate before any per-operation map is consulted; the M2 batch re-adds
 * the rows, restore→update / purge→delete, with the bits.)
 */
export function crudBucketForOperation(operation: string): CrudBucket | null {
  switch (OPERATION_TO_PERMISSION[operation]) {
    case 'allowRead': return 'read';
    case 'allowCreate': return 'create';
    case 'allowEdit':
    case 'allowTransfer': return 'update';
    case 'allowDelete': return 'delete';
    default: return null;
  }
}

/**
 * [ADR-0066 D2] Resolve the object permission a permission set contributes for
 * `objectName`, honouring the secure-by-default posture:
 *
 *  - an EXPLICIT per-object grant (`ps.objects[objectName]`) always applies;
 *  - the `'*'` wildcard applies to a `public` object (today's allow-by-default);
 *  - for a `private` object the `'*'` wildcard applies ONLY when it carries the
 *    super-user bypass bits (`viewAllRecords`/`modifyAllRecords` — the Salesforce
 *    "View/Modify All Data" power). A plain `'*': {allowRead:true}` does NOT cover
 *    a private object; access then requires an explicit per-object grant.
 */
function resolveObjectPermission(
  ps: PermissionSet,
  objectName: string,
  isPrivate: boolean,
): ObjectPermission | undefined {
  const explicit = ps.objects?.[objectName];
  if (explicit) return explicit;
  const wild = ps.objects?.['*'];
  if (!wild) return undefined;
  if (!isPrivate) return wild;
  return wild.viewAllRecords || wild.modifyAllRecords ? wild : undefined;
}

/**
 * [#3544] Fold the user-level EXPORT axis across the resolved permission sets.
 *
 * `allowExport` is an OPT-IN grant: export is allowed only where a set says
 * `true`. Unset and `false` both mean "no grant" — permission sets are additive
 * capability containers (ADR-0090), so nothing in them is a deny, and `false`
 * is authoring intent rather than a veto another set must respect.
 *
 * The bit stays out of {@link OPERATION_TO_PERMISSION} even so, because export
 * is not a plain bit lookup: it is `read ∧ grant` (`export ⊆ list` in the
 * spec's `API_METHOD_DERIVATION`), and that conjunction lives in
 * {@link PermissionEvaluator.checkObjectPermission}'s `export` branch.
 *
 * This must stay identical to what the `/me/permissions` per-object merge
 * yields (`if (v === true) acc[k] = true; …`, read back as
 * `acc.allowExport === true`). That equality is load-bearing, not incidental:
 * the client hides its Export button on the merged map while this decides the
 * server's 403, and the two disagreeing is exactly the `declared ≠ enforced`
 * gap the axis exists to close.
 */
export function resolveUserExportAllowed(
  objectName: string,
  permissionSets: PermissionSet[],
  opts: { isPrivate?: boolean } = {},
): boolean {
  for (const ps of permissionSets) {
    const objPerm = resolveObjectPermission(ps, objectName, opts.isPrivate ?? false);
    if (objPerm?.allowExport === true) return true;
  }
  return false;
}

/**
 * PermissionEvaluator
 * 
 * Runtime evaluator for PermissionSet definitions.
 * Resolves aggregated permissions from roles to concrete allow/deny decisions.
 */
export class PermissionEvaluator {
  /**
   * Check if an operation is allowed on an object for the given permission sets.
   * Uses "most permissive" merging: if ANY permission set allows, it's allowed.
   */
  checkObjectPermission(
    operation: string,
    objectName: string,
    permissionSets: PermissionSet[],
    /** [ADR-0066 D2] When the object is `private`, the `'*'` wildcard only covers it if it is a super-user grant. */
    opts: { isPrivate?: boolean } = {},
  ): boolean {
    // [#3544] User-level export axis — `read ∧ grant`, not a bit lookup. Per
    // the spec's derivation table (`API_METHOD_DERIVATION`) export is
    // `list ∧ userExportAllowed`, so BOTH halves must hold: the caller must be
    // able to read the object at all, and some set must opt them into bulk
    // egress. Kept out of OPERATION_TO_PERMISSION because that map checks one
    // bit and would miss the read half — granting export to a caller who cannot
    // even list the object.
    if (operation === 'export') {
      if (!resolveUserExportAllowed(objectName, permissionSets, opts)) return false;
      return this.checkObjectPermission('find', objectName, permissionSets, opts);
    }

    const permKey = OPERATION_TO_PERMISSION[operation];
    if (!permKey) {
      // Fail CLOSED for the destructive operation class (ADR-0049): an
      // unrecognised destructive op must be denied, never silently allowed.
      // Other unknown operations are allowed by default.
      return !DESTRUCTIVE_OPERATIONS.has(operation);
    }

    for (const ps of permissionSets) {
      // [ADR-0066 D2] Honour the `'*'` wildcard sentinel — admin permission
      // sets grant blanket access via a single `objects: { '*': … }` entry —
      // but a `private` object is excluded from a non-super-user wildcard.
      const objPerm = resolveObjectPermission(ps, objectName, opts.isPrivate ?? false);
      if (objPerm) {
        // Super-user WRITE bypass ("Modify All Data") — covers edit/delete and
        // the destructive lifecycle class (see MODIFY_ALL_WRITE_KEYS).
        if (MODIFY_ALL_WRITE_KEYS.has(permKey) && objPerm.modifyAllRecords) {
          return true;
        }
        // Check if viewAllRecords is set (super-user bypass for read ops)
        if (permKey === 'allowRead' && (objPerm.viewAllRecords || objPerm.modifyAllRecords)) {
          return true;
        }
        // Check the specific permission
        if (objPerm[permKey]) {
          return true;
        }
      }
    }

    return false;
  }


  /**
   * [ADR-0057 D1] Effective access DEPTH for an operation class on an object,
   * merged most-permissively across the permission sets. `view/modifyAll`
   * shortcut to 'org'. A granting set with no scope defaults to 'own' (the
   * owner-only baseline owner-scoped objects already enforce); the WIDEST wins.
   * Returns 'org' when no set grants the op (the caller denies separately, so
   * the value is unused).
   */
  getEffectiveScope(
    opClass: 'read' | 'write',
    objectName: string,
    permissionSets: PermissionSet[],
    opts: { isPrivate?: boolean } = {},
  ): 'own' | 'own_and_reports' | 'unit' | 'unit_and_below' | 'org' {
    const RANK = { own: 0, own_and_reports: 1, unit: 2, unit_and_below: 3, org: 4 } as const;
    const ORDER = ['own', 'own_and_reports', 'unit', 'unit_and_below', 'org'] as const;
    let widest = -1;
    let matched = false;
    for (const ps of permissionSets) {
      const op: any = resolveObjectPermission(ps, objectName, opts.isPrivate ?? false);
      if (!op) continue;
      matched = true;
      if (opClass === 'read' && (op.viewAllRecords || op.modifyAllRecords)) return 'org';
      if (opClass === 'write' && op.modifyAllRecords) return 'org';
      const s = opClass === 'read' ? op.readScope : op.writeScope;
      const rank = s ? RANK[s as keyof typeof RANK] : RANK.own;
      if (rank > widest) widest = rank;
    }
    if (!matched) return 'org';
    return ORDER[widest < 0 ? 0 : widest];
  }

  /**
   * [ADR-0066 D3] Union of `systemPermissions` (capabilities) the caller holds
   * across the resolved permission sets — used to enforce a resource's
   * `requiredPermissions` AND-gate.
   */
  getSystemPermissions(permissionSets: PermissionSet[]): Set<string> {
    const out = new Set<string>();
    for (const ps of permissionSets) {
      for (const cap of ps.systemPermissions ?? []) out.add(cap);
    }
    return out;
  }

  /**
   * [ADR-0066 D2 / ① — #4647] **THE** "View/Modify All Data bypass held?"
   * predicate. Returns the NAMES of the resolved sets that carry the requested
   * bit for `objectName` (empty array = not held), honouring the private
   * posture (see {@link resolveObjectPermission}).
   *
   * This is deliberately the ONE function every consumer folds through, because
   * the bypass used to be decided in two places that disagreed (#4647): the
   * explain engine's `vama_bypass` layer answered "bypass held — ownership and
   * sharing are skipped" from its own inline read of `objects[name] ?? ['*']`,
   * while the write path never consulted the bypass at all — so a Modify All
   * Data holder was told `allowed: true` by `security/explain` and handed a 403
   * by `PATCH /data/…` for the same (principal, record, operation) triple.
   * Both sides now resolve the bypass HERE:
   *
   *   - explain → `explain-engine.ts` §8 `vama_bypass`
   *   - writes  → {@link hasSuperuserWriteBypass} → `ISecurityService.hasWriteBypass`
   *               → plugin-sharing `SharingService.canEdit` / `canDelete`
   *               (and through `canEdit`, the `sys_attachment` parent gate)
   *
   * Returning the set names rather than a boolean is what keeps the two halves
   * honest: the layer's `contributors` attribution and the enforcement decision
   * are the same list, so a report that names a granting set cannot coexist
   * with a gate that found none.
   */
  superuserBypassSets(
    objectName: string,
    permissionSets: PermissionSet[],
    opts: { isPrivate?: boolean; bit: SuperuserBypassBit },
  ): string[] {
    const out: string[] = [];
    for (const ps of permissionSets) {
      const op = resolveObjectPermission(ps, objectName, opts.isPrivate ?? false);
      if (!op) continue;
      const held = opts.bit === 'modify'
        ? Boolean(op.modifyAllRecords)
        : Boolean(op.viewAllRecords || op.modifyAllRecords);
      if (held) out.push(String((ps as { name?: unknown }).name ?? '?'));
    }
    return out;
  }

  /**
   * [ADR-0066 D2 / ①] Does any resolved set grant the super-user READ bypass
   * (`viewAllRecords`/`modifyAllRecords`, the "View All Data" power) for the
   * object? Honours the private posture (see {@link resolveObjectPermission}).
   * The security plugin uses this to skip wildcard RLS on private/platform-global
   * objects so a platform admin sees all rows.
   */
  hasSuperuserReadBypass(
    objectName: string,
    permissionSets: PermissionSet[],
    opts: { isPrivate?: boolean } = {},
  ): boolean {
    return this.superuserBypassSets(objectName, permissionSets, { ...opts, bit: 'view' }).length > 0;
  }

  /**
   * [ADR-0066 D2 / ①] Super-user WRITE bypass (`modifyAllRecords`) for the
   * object — "Modify All Data": an admin may edit any record regardless of
   * ownership (#1883's Salesforce reference frame, re-affirmed for the write
   * path in #4647). Same predicate the explain engine reports, so the two can
   * never answer differently.
   */
  hasSuperuserWriteBypass(
    objectName: string,
    permissionSets: PermissionSet[],
    opts: { isPrivate?: boolean } = {},
  ): boolean {
    return this.superuserBypassSets(objectName, permissionSets, { ...opts, bit: 'modify' }).length > 0;
  }

  /**
   * Get the merged field permissions for an object.
   * Returns a map of field names to their effective permissions.
   * Uses "most permissive" merging.
   */
  getFieldPermissions(
    objectName: string,
    permissionSets: PermissionSet[]
  ): Record<string, FieldPermissionParsed> {
    const result: Record<string, FieldPermissionParsed> = {};

    for (const ps of permissionSets) {
      if (!ps.fields) continue;

      for (const [key, perm] of Object.entries(ps.fields)) {
        // Field keys are in format: "object_name.field_name"
        if (!key.startsWith(`${objectName}.`)) continue;
        const fieldName = key.substring(objectName.length + 1);

        if (!result[fieldName]) {
          result[fieldName] = { readable: false, editable: false };
        }

        // Most permissive merge
        if (perm.readable) result[fieldName].readable = true;
        if (perm.editable) result[fieldName].editable = true;
      }
    }

    return result;
  }

  /**
   * Resolve permission sets for a list of identifier names from metadata.
   *
   * Identifiers are matched to `PermissionSet.name`. The names may be
   * either role names (when `sys_position.name` is reused as a permission set
   * name — common for default admin/member/viewer roles) or explicit
   * permission set names supplied through `ExecutionContext.permissions[]`
   * (resolved by `resolveExecutionContext` from `sys_user_permission_set`
   * and `sys_position_permission_set`).
   *
   * Async because the underlying metadata service exposes `list()` as a
   * Promise — synchronous iteration would silently yield zero results
   * (the historical SecurityPlugin behaviour, masking all enforcement).
   *
   * `bootstrapPermissionSets` is a fallback list of plugin-owned permission
   * sets (typically the platform defaults: admin_full_access /
   * member_default / viewer_readonly) that are registered via
   * `manifest.register({ permissions })` but do not currently propagate
   * into the metadata service's `list()` index. Without this fallback,
   * SecurityPlugin would never resolve the defaults and all enforcement
   * would be silently disabled for authenticated requests.
   */
  async resolvePermissionSets(
    identifiers: string[],
    metadataService: any,
    bootstrapPermissionSets: PermissionSet[] = [],
    /**
     * Optional async loader for permission set names that aren't found in
     * metadata or bootstrap. Lets callers query user-defined permission
     * sets persisted in `sys_permission_set`. Failures are swallowed
     * (fail-closed: unresolvable sets grant nothing) but SURFACED via
     * `options.logger` — see #2565: without the warn, a transient DB error
     * makes custom permission sets silently vanish and the resulting 403s
     * are undiagnosable.
     */
    dbLoader?: (unresolved: string[]) => Promise<PermissionSet[]>,
    /** Optional logger; only `warn` is used. Resolution behavior is unchanged. */
    options: { logger?: { warn?: (msg: string, meta?: Record<string, any>) => void } } = {},
  ): Promise<PermissionSet[]> {
    if (identifiers.length === 0) return [];

    const result: PermissionSet[] = [];
    const seen = new Set<string>();

    // Get all permission sets from metadata. Support both async (Manager) and
    // sync (test stub) implementations of `list`.
    let allPermSets: any = [];
    try {
      const listed = metadataService?.list?.('permission')
        ?? metadataService?.list?.('permissions')
        ?? [];
      allPermSets = typeof (listed as any)?.then === 'function' ? await listed : listed;
    } catch (e) {
      allPermSets = [];
      options.logger?.warn?.(
        '[security] permission-set metadata list() failed — falling back to bootstrap/db sources (#2565)',
        { requested: identifiers, error: (e as Error)?.message },
      );
    }
    if (!Array.isArray(allPermSets)) allPermSets = [];

    const wanted = new Set(identifiers);
    for (const ps of allPermSets) {
      if (wanted.has(ps.name) && !seen.has(ps.name)) {
        seen.add(ps.name);
        result.push(ps);
      }
    }

    // Fallback: any wanted name not yet matched is sourced from the
    // bootstrap list (plugin-owned defaults). Avoids silent failure when
    // permission sets are registered via `manifest.register` but the
    // metadata service hasn't indexed them.
    for (const ps of bootstrapPermissionSets) {
      if (wanted.has(ps.name) && !seen.has(ps.name)) {
        seen.add(ps.name);
        result.push(ps);
      }
    }

    // Last-resort: query user-defined permission sets from the database.
    // Without this, custom permission sets (created via the admin UI as
    // `sys_permission_set` rows) would be silently ignored both for CRUD
    // enforcement and for field-level masking.
    if (dbLoader) {
      const unresolved = identifiers.filter((n) => !seen.has(n));
      if (unresolved.length > 0) {
        try {
          const dbRows = await dbLoader(unresolved);
          for (const ps of dbRows ?? []) {
            if (ps?.name && !seen.has(ps.name)) {
              seen.add(ps.name);
              result.push(ps);
            }
          }
        } catch (e) {
          // Swallow — the request shouldn't fail just because the DB
          // lookup is unavailable (fail-closed: the unresolved sets simply
          // grant nothing). But surface it: without this warn a transient
          // DB error silently drops custom permission sets and the
          // resulting 403s point nowhere near the cause (#2565).
          options.logger?.warn?.(
            '[security] sys_permission_set db lookup failed — unresolved sets grant nothing this request (#2565)',
            { unresolved, error: (e as Error)?.message },
          );
        }
      }
    }

    return result;
  }
}
