// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PermissionSet, ObjectPermission, FieldPermission } from '@objectstack/spec/security';

/**
 * Operation type mapping to permission checks.
 *
 * `transfer`/`restore`/`purge` are pre-mapped to their RBAC bits (#1883) even
 * though the ObjectQL operations do not exist yet (roadmap M2): the moment such
 * an operation is dispatched through the security middleware it is gated by the
 * corresponding `allow*` bit — deny unless a resolved permission set grants it.
 * There is no window where the ops could ship ungated.
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
  restore: 'allowRestore',
  purge: 'allowPurge',
};

/**
 * Destructive operation class — operations that must FAIL CLOSED when they are
 * not mapped to a concrete permission key. See ADR-0049: an unrecognised
 * destructive operation must be DENIED rather than silently allowed by the
 * default-allow fallthrough. `transfer`/`restore`/`purge` are now mapped above
 * (#1883), so this set acts as a backstop: it keeps them (and any future
 * destructive op prefixed here before its mapping lands) fail-closed if the
 * mapping is ever removed. Non-destructive unknown operations retain
 * default-allow so custom read-side operations are not broken.
 */
const DESTRUCTIVE_OPERATIONS = new Set<string>(['transfer', 'restore', 'purge']);

/**
 * Permission keys covered by the `modifyAllRecords` super-user WRITE bypass:
 * edit/delete plus the destructive lifecycle class, DERIVED from the two
 * constants above so a future destructive op added to the map+set is covered
 * automatically (hand-listing it inline is how bypass gaps happen — #1883).
 * NOTE this means "Modify All Data" grants (incl. the wildcard on
 * organization_admin / admin_full_access defaults) will cover
 * transfer/restore/purge the moment the M2 ops ship — Salesforce semantics,
 * confirmed in the #1883 disposition; revisit per-op when M2 lands.
 */
const MODIFY_ALL_WRITE_KEYS = new Set<keyof ObjectPermission>([
  'allowEdit',
  'allowDelete',
  ...[...DESTRUCTIVE_OPERATIONS].map((op) => OPERATION_TO_PERMISSION[op]),
]);

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
    for (const ps of permissionSets) {
      const op = resolveObjectPermission(ps, objectName, opts.isPrivate ?? false);
      if (op && (op.viewAllRecords || op.modifyAllRecords)) return true;
    }
    return false;
  }

  /** [ADR-0066 D2 / ①] Super-user WRITE bypass (`modifyAllRecords`) for the object. */
  hasSuperuserWriteBypass(
    objectName: string,
    permissionSets: PermissionSet[],
    opts: { isPrivate?: boolean } = {},
  ): boolean {
    for (const ps of permissionSets) {
      const op = resolveObjectPermission(ps, objectName, opts.isPrivate ?? false);
      if (op && op.modifyAllRecords) return true;
    }
    return false;
  }

  /**
   * Get the merged field permissions for an object.
   * Returns a map of field names to their effective permissions.
   * Uses "most permissive" merging.
   */
  getFieldPermissions(
    objectName: string,
    permissionSets: PermissionSet[]
  ): Record<string, FieldPermission> {
    const result: Record<string, FieldPermission> = {};

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
   * either role names (when `sys_role.name` is reused as a permission set
   * name — common for default admin/member/viewer roles) or explicit
   * permission set names supplied through `ExecutionContext.permissions[]`
   * (resolved by `resolveExecutionContext` from `sys_user_permission_set`
   * and `sys_role_permission_set`).
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
     * sets persisted in `sys_permission_set`. Failures are swallowed.
     */
    dbLoader?: (unresolved: string[]) => Promise<PermissionSet[]>
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
    } catch {
      allPermSets = [];
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
        } catch {
          // Swallow — the request shouldn't fail just because the DB
          // lookup is unavailable.
        }
      }
    }

    return result;
  }
}
