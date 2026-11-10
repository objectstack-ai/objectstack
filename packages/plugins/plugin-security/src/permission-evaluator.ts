// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  PermissionSet,
  ObjectPermission,
  EffectiveObjectPermission,
  ObjectPermissionVerbTarget,
  FieldPermissionParsed,
} from '@objectstack/spec/security';
import { objectPermissionGrants } from '@objectstack/spec/security';
import { RECYCLE_BIN_GRANT_KEYS } from '@objectstack/spec/data';
import {
  fieldPermissionVote,
  holdsSuperuserBypass,
  superuserFieldVote,
  type FieldConditionVerdict,
} from '@objectstack/core';

/**
 * [#25866] How a caller judges a row-conditioned field permission entry's
 * `when` for the row it holds: `matched` (the entry votes as declared),
 * `unmatched` (the entry is absent) or `unjudged` (the entry is its lock).
 * The write gate supplies one over the incoming row of an insert or the stored
 * row of a by-id update; a reader that holds no row supplies none, and every
 * conditioned entry is then `unjudged`.
 */
export type FieldConditionJudge = (when: string) => FieldConditionVerdict;

/** [#25866] One row-conditioned entry, as a row-blind reader reports it. */
export interface ConditionedFieldEntry {
  /** The field name, without the object prefix. */
  field: string;
  /** The declaring permission set's name. */
  set: string;
  /** The entry's `when`, as authored. */
  when: string;
  /** The entry's edit vote on a matching row. */
  editable: boolean;
  /**
   * [#29610 / ruling of record 6573563853, letter A] The sets whose Modify All
   * vote supersedes the entry — empty when none does. Read from
   * `superuserFieldVote` (`@objectstack/core`), the vote
   * {@link PermissionEvaluator.getFieldPermissions} applies after the
   * per-entry votes under every `when` verdict: when it votes `editable`, every
   * field of the object is readable and editable on every row, so the entry's
   * lock binds on no row for this principal. A View All vote supersedes
   * nothing here: it votes only the read bit, which a conditioned entry already
   * casts (the spec refuses `readable: false` beside a `when`).
   */
  supersededBy: string[];
}

/**
 * Operation type mapping to permission checks.
 *
 * `transfer` is pre-mapped to its RBAC bit (#1883) even though the dedicated
 * ObjectQL operation does not exist yet (roadmap M2): the moment it is
 * dispatched through the security middleware it is gated by `allowTransfer` —
 * deny unless a resolved permission set grants it. (`allowTransfer` is also
 * ENFORCED today through the ordinary insert/update `owner_id` door, #3004.)
 *
 * [#30237, ADR-0148 D5] `restore` and `purge` are the recycle bin's verbs, and
 * they read the bin's two grants (`RECYCLE_BIN_GRANT_KEYS`), NEW spellings on
 * purpose: the retired `allowRestore` / `allowPurge` (#12497, ADR-0049) stay
 * tombstoned. `restore` reads `allowRestoreOwnDeleted`; `purge` (the
 * permanent delete, `purge(entryId)`, `empty(object)`, Q3 = A) reads
 * `manageRecycleBin`. The fold is the spec's `objectPermissionGrants` (ruling
 * Q5 = A: `allowRead` bounds both, `modifyAllRecords` implies both,
 * `manageRecycleBin` implies `allowRestoreOwnDeleted`, `allowDelete` implies
 * neither). The object gate is the verb's first half only: the engine's
 * restore then lets a caller that does not manage the bin restore just the
 * entries it deleted (`recycle-bin/restore.ts`, `@objectstack/objectql`).
 */
const OPERATION_TO_PERMISSION: Record<string, ObjectPermissionVerbTarget> = {
  find: 'allowRead',
  findOne: 'allowRead',
  count: 'allowRead',
  aggregate: 'allowRead',
  insert: 'allowCreate',
  update: 'allowEdit',
  delete: 'allowDelete',
  transfer: 'allowTransfer',
  restore: RECYCLE_BIN_GRANT_KEYS.restoreOwnDeleted,
  purge: RECYCLE_BIN_GRANT_KEYS.manage,
};

/**
 * Destructive operation class — operations that must FAIL CLOSED when they are
 * not mapped to a concrete permission key. See ADR-0049: an unrecognised
 * destructive operation must be DENIED rather than silently allowed by the
 * default-allow fallthrough. Every member is mapped above today (`transfer`
 * since #1883, `restore` / `purge` since #30237), so the set is the BACKSTOP
 * that keeps each fail-closed if its mapping is ever removed, never the gate
 * that decides it. Non-destructive unknown operations retain default-allow so
 * custom read-side operations are not broken.
 */
const DESTRUCTIVE_OPERATIONS = new Set<string>(['transfer', 'restore', 'purge']);

/**
 * Permission keys covered by the `modifyAllRecords` super-user WRITE bypass:
 * edit/delete plus the MAPPED members of the destructive lifecycle class,
 * DERIVED from the two constants above so a future destructive op added to the
 * map+set is covered automatically (hand-listing it inline is how bypass gaps
 * happen — #1883). NOTE this means "Modify All Data" grants (incl. the
 * wildcard on organization_admin / admin_full_access defaults) cover
 * `transfer`, and since #30237 the recycle bin's `restore` / `purge`
 * (Salesforce semantics, confirmed in the #1883 disposition and ruled for the
 * bin as Q5 = A).
 *
 * [#18785] ⛔ This set no longer DECIDES anything — the bypass is folded by the
 * spec's `objectPermissionGrants`, the one definition of the rule. What it
 * still does is state, on this side and derived from this file's own operation
 * map, WHICH bits the class contains, so `permission-evaluator.test.ts` can
 * hold the spec's fold to it. Kept as an assertion rather than deleted for the
 * #1883 reason: the class is derived from the dispatch vocabulary, and a future
 * destructive op added to the map+set must make the spec go red rather than
 * silently lose its bypass.
 */
export const MODIFY_ALL_WRITE_KEYS = new Set<ObjectPermissionVerbTarget>([
  'allowEdit',
  'allowDelete',
  ...[...DESTRUCTIVE_OPERATIONS].flatMap((op) => {
    const key = OPERATION_TO_PERMISSION[op];
    return key ? [key] : [];
  }),
]);

/**
 * [ADR-0151 D3] The grant keys of the destructive class, derived from the same
 * two constants as {@link MODIFY_ALL_WRITE_KEYS}: `transfer`, `restore` and
 * `purge` read here as the bits that grant them. The agent ceiling clears
 * them on every set an agent principal holds (`agent-ceiling-clamp.ts`), so a
 * destructive operation added to the map and the set is clamped as well.
 */
export const DESTRUCTIVE_CLASS_KEYS: ReadonlySet<ObjectPermissionVerbTarget> = new Set<ObjectPermissionVerbTarget>(
  [...DESTRUCTIVE_OPERATIONS].flatMap((op) => {
    const key = OPERATION_TO_PERMISSION[op];
    return key ? [key] : [];
  }),
);

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
 * still gates it via its `all` bucket. The recycle bin's verbs fold as their
 * row-level security does (`lifecycle-verb-rls-operation.ts`): `restore`
 * rewrites a row back into existence, so `update`; `purge` destroys it, so
 * `delete`.
 */
export function crudBucketForOperation(operation: string): CrudBucket | null {
  switch (OPERATION_TO_PERMISSION[operation]) {
    case 'allowRead': return 'read';
    case 'allowCreate': return 'create';
    case 'allowEdit':
    case 'allowTransfer':
    case 'allowRestoreOwnDeleted': return 'update';
    case 'allowDelete':
    case 'manageRecycleBin': return 'delete';
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
 * The most-permissive merge of the object permission each set contributes for
 * `objectName` ({@link resolveObjectPermission}, so the ADR-0066 D2 wildcard
 * posture is honoured per set): a bit is `true` when ANY set's entry says
 * `true`, the shape the `/me/permissions` per-object merge hands the client
 * (`if (v === true) acc[k] = true`). `undefined` when no set contributes an
 * entry at all.
 *
 * Only the boolean grant bits are merged; the depth keys are not, because
 * {@link PermissionEvaluator.getEffectiveScope} folds those itself.
 */
function mergeResolvedObjectPermissions(
  objectName: string,
  permissionSets: PermissionSet[],
  isPrivate: boolean,
): EffectiveObjectPermission | undefined {
  let merged: Record<string, boolean> | undefined;
  for (const ps of permissionSets) {
    // [ADR-0066 D2] Honour the `'*'` wildcard sentinel — admin permission
    // sets grant blanket access via a single `objects: { '*': … }` entry —
    // but a `private` object is excluded from a non-super-user wildcard.
    const objPerm = resolveObjectPermission(ps, objectName, isPrivate);
    if (!objPerm) continue;
    merged ??= {};
    for (const [key, value] of Object.entries(objPerm)) {
      if (value === true) merged[key] = true;
    }
  }
  return merged as EffectiveObjectPermission | undefined;
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
    //
    // [#18785] The read half is the spec fold, reached through the recursive
    // `find` call below. The CONJUNCTION deliberately stays here rather than
    // collapsing into `objectPermissionGrants(entry, 'allowExport')` per set:
    // this door asks it across the whole resolved set list — `(∃ set granting
    // export) ∧ (∃ set granting read)` — which is what the `/me/permissions`
    // most-permissive per-object merge hands the client, and what the spec cell
    // answers once that merge has happened. Folding it per set instead would
    // NARROW the door to `∃ set (export ∧ read)`, denying a caller whose read
    // and export grants arrive from two different sets.
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

    // [#18785] ONE fold, asked — the spec's `objectPermissionGrants` is the
    // single definition of "does this effective object permission grant this
    // verb?", and it carries every cell this branch used to restate: the read
    // bypass on `viewAllRecords || modifyAllRecords`, the write bypass on
    // `modifyAllRecords` alone (edit/delete/transfer — the
    // MODIFY_ALL_WRITE_KEYS class), `allowCreate` deliberately WITHOUT a
    // bypass, and edit and delete as `read ∧ grant`. Restating it here is how
    // the enforcement door and every predicate that advertises the door's
    // answer drift apart: they would still compile, still pass their own pins,
    // and disagree only for the one administrator who holds the super-user bit.
    //
    // It is asked of the caller's MERGED entry, not set by set — the
    // most-permissive per-object merge the `/me/permissions` map is, so the
    // door and the map the client gates on give one answer. For every cell
    // that is a plain disjunction of bits the two readings agree; for edit and
    // delete it is what lets the read half come from a different set than the
    // grant, as export's does above. An object permission that edits or
    // deletes a record also reads it: no set list grants either verb to a
    // caller it does not let read.
    const merged = mergeResolvedObjectPermissions(objectName, permissionSets, opts.isPrivate ?? false);
    return merged !== undefined && objectPermissionGrants(merged, permKey);
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
   * [ADR-0090 D10 — ruling 2026-09-08] The access DEPTH these sets actually
   * **declare** for an operation class, or `undefined` when they declare none.
   *
   * The same walk as {@link getEffectiveScope}, minus its two DEFAULTS. Those
   * defaults are right for a principal standing on its own — a granting set
   * silent about depth is owner-only, and an object no set mentions is denied
   * separately — but they are *manufactured* opinions, and the ADR-0090 D10
   * intersection must not subtract with one. `undefined` = "no opinion": every
   * set that grants the op is silent on depth (no `readScope` / `writeScope`,
   * no `viewAllRecords` / `modifyAllRecords`), or no set mentions the object at
   * all. A set that DOES declare a depth answers here exactly as
   * `getEffectiveScope` would — widest wins — so a declared ceiling keeps its
   * full subtractive force.
   *
   * ⛔ Not a replacement for `getEffectiveScope`: the non-delegated path still
   * needs the owner-only default. This is the DELEGATED path's input, folded by
   * `intersectDelegatedScope` (explain-engine.ts).
   */
  getDeclaredScope(
    opClass: 'read' | 'write',
    objectName: string,
    permissionSets: PermissionSet[],
    opts: { isPrivate?: boolean } = {},
  ): 'own' | 'own_and_reports' | 'unit' | 'unit_and_below' | 'org' | undefined {
    const RANK = { own: 0, own_and_reports: 1, unit: 2, unit_and_below: 3, org: 4 } as const;
    const ORDER = ['own', 'own_and_reports', 'unit', 'unit_and_below', 'org'] as const;
    let widest = -1;
    for (const ps of permissionSets) {
      const op: any = resolveObjectPermission(ps, objectName, opts.isPrivate ?? false);
      if (!op) continue;
      if (opClass === 'read' && (op.viewAllRecords || op.modifyAllRecords)) return 'org';
      if (opClass === 'write' && op.modifyAllRecords) return 'org';
      const s = opClass === 'read' ? op.readScope : op.writeScope;
      if (!s) continue;
      const rank = RANK[s as keyof typeof RANK];
      if (rank != null && rank > widest) widest = rank;
    }
    return widest < 0 ? undefined : ORDER[widest];
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
   *
   * [ADR-0066 ⑧, ruling of record 6573563853] Each set is read by
   * `holdsSuperuserBypass` (`@objectstack/core`), the same function the field
   * merge's super-user vote reads ({@link getFieldPermissions}, and the
   * row-blind `/auth/me/permissions` merge), so the row bypass and the field
   * vote name the same sets. `opts.isPrivate` is accepted and never changes
   * the answer: the private posture withholds only a `'*'` wildcard that
   * carries neither bit (see {@link resolveObjectPermission}).
   */
  superuserBypassSets(
    objectName: string,
    permissionSets: PermissionSet[],
    opts: { isPrivate?: boolean; bit: SuperuserBypassBit },
  ): string[] {
    const out: string[] = [];
    for (const ps of permissionSets) {
      if (holdsSuperuserBypass(ps, objectName, opts.bit)) out.push(String((ps as { name?: unknown }).name ?? '?'));
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
   *
   * [#25866 / ruling of record 6408558941] An entry that carries a `when`
   * (`FieldPermissionSchema.when`, a row condition in RLS `using`'s CEL)
   * votes only on the rows the condition names. `judge` is the caller's
   * reading of that condition for the row it holds (`FieldConditionJudge`);
   * the vote each verdict yields is `fieldPermissionVote` (`@objectstack/core`),
   * shared with the row-blind `/auth/me/permissions` merge. Without a `judge`
   * — every reader that holds no row — a conditioned entry is `unjudged`:
   * its read bit as declared, NO edit grant, so a row-blind reading is never
   * wider than the write gate's. An `unmatched` entry is ABSENT, as if the
   * set had not declared the field: the merge below is unchanged for every
   * entry without a `when`, and only DECLARING entries vote, as before.
   *
   * [ADR-0066 D2 ⑧ as amended — ruling of record 6573563853, letter A] A set
   * that holds the super-user bypass on the object (the sets
   * {@link superuserBypassSets} names) then votes on EVERY field of it:
   * `viewAllRecords` votes `readable: true`, `modifyAllRecords` votes
   * `readable: true` and `editable: true` (`superuserFieldVote`,
   * `@objectstack/core`). Before, a set that granted the object through its
   * super-user bits but named no field cast no vote, so an app set's
   * `readable: false` hid the field from a platform admin who also held it.
   * Union without deny is otherwise unchanged.
   */
  getFieldPermissions(
    objectName: string,
    permissionSets: PermissionSet[],
    judge?: FieldConditionJudge,
  ): Record<string, FieldPermissionParsed> {
    const result: Record<string, FieldPermissionParsed> = {};

    for (const ps of permissionSets) {
      if (!ps.fields) continue;

      for (const [key, perm] of Object.entries(ps.fields)) {
        // Field keys are in format: "object_name.field_name"
        if (!key.startsWith(`${objectName}.`)) continue;
        const fieldName = key.substring(objectName.length + 1);

        const when = (perm as { when?: string }).when;
        const vote = fieldPermissionVote(perm, when === undefined ? 'matched' : judge ? judge(when) : 'unjudged');
        if (!vote) continue;

        if (!result[fieldName]) {
          result[fieldName] = { readable: false, editable: false };
        }

        // Most permissive merge
        if (vote.readable) result[fieldName].readable = true;
        if (vote.editable) result[fieldName].editable = true;
      }
    }

    // [Ruling of record 6573563853] The super-user vote — the same function the
    // row-blind `/auth/me/permissions` merge applies.
    const superVote = superuserFieldVote(permissionSets, objectName);
    if (superVote) {
      for (const perm of Object.values(result)) {
        perm.readable = true;
        if (superVote.editable) perm.editable = true;
      }
    }

    return result;
  }

  /**
   * [#25866] The row-conditioned entries the sets declare on `objectName`,
   * for a reader that holds no row (`os explain`): each is reported AS a
   * row-conditioned lock — judged per row by the write gate, applied as its
   * lock everywhere else — rather than folded silently into the mask. Each
   * entry names the sets whose Modify All vote supersedes it (`supersededBy`,
   * #29610), so the report never calls a lock binding that the merge overrides.
   */
  conditionedFieldEntries(
    objectName: string,
    permissionSets: PermissionSet[],
  ): ConditionedFieldEntry[] {
    const out: ConditionedFieldEntry[] = [];
    // [#29610] The same super-user vote `getFieldPermissions` applies — never a
    // second reading of the bits. An `editable` vote overrides every entry.
    const supersededBy = superuserFieldVote(permissionSets, objectName)?.editable
      ? this.superuserBypassSets(objectName, permissionSets, { bit: 'modify' })
      : [];
    for (const ps of permissionSets) {
      if (!ps.fields) continue;
      for (const [key, perm] of Object.entries(ps.fields)) {
        if (!key.startsWith(`${objectName}.`)) continue;
        const when = (perm as { when?: string }).when;
        if (when === undefined) continue;
        out.push({
          field: key.substring(objectName.length + 1),
          set: ps.name,
          when,
          editable: perm.editable === true,
          supersededBy: [...supersededBy],
        });
      }
    }
    return out;
  }

  /**
   * Resolve the permission sets a list of names requests.
   *
   * [ADR-0150 D3, ADR-0131 D3/D4] With a catalog loader — the security
   * plugin's, which every composition with an engine carries — that loader is
   * the ONE source: each name is resolved through the security catalog's
   * package-scoped rule (`resolvePermissionScoped`, `@objectstack/core`). A
   * name `options.addresses` carries an address for is resolved at that
   * holder exactly (the catalog's stored-column arm: a holder that no longer
   * serves the name is read by D3 and said once); every other name — a
   * caller's seed, an agent's scope ceiling, the baseline — by D3 with no
   * caller: one holder answers, two or more are refused naming every
   * candidate, and nothing is picked. ⛔ There is no by-name pick from the
   * metadata service's list: with two holders of a name it would take
   * whichever came first.
   *
   * Without a loader no catalog is bound — an engine-less stand-in, or an
   * engine with no registry, which the plugin's `start()` already warns about
   * (every position-bound set then resolves to nothing). Only there do the
   * metadata service's list and the plugin's own `bootstrapPermissionSets`
   * answer by name, as they did before ADR-0150; there is no package to tell
   * two holders apart by. A booted composition always binds the catalog, so
   * it never reaches this arm.
   *
   * A loader that throws is swallowed (fail closed: the requested sets grant
   * nothing) but SURFACED via `options.logger` — see #2565: without the warn,
   * a transient read error makes sets silently vanish and the resulting 403s
   * are undiagnosable.
   *
   */
  async resolvePermissionSets(
    identifiers: string[],
    metadataService: any,
    bootstrapPermissionSets: PermissionSet[] = [],
    /**
     * The security plugin's catalog loader: the catalog's definition of each
     * request, resolved by ADR-0150 D3. `undefined` only where no catalog
     * exists.
     */
    catalogLoader?: CatalogSetLoader,
    options: {
      /** Optional logger; only `warn` is used. */
      logger?: { warn?: (msg: string, meta?: Record<string, any>) => void };
      /**
       * [ADR-0150 D3] The `(packageId, name)` each granted set was resolved
       * to (`ExecutionContext.permissionSetAddresses`). A name with an
       * address of a package is requested at that holder.
       */
      addresses?: readonly PermissionSetAddressLike[];
    } = {},
  ): Promise<PermissionSet[]> {
    if (identifiers.length === 0) return [];
    const names = [...new Set(identifiers.filter((n): n is string => typeof n === 'string' && n !== ''))];

    if (!catalogLoader) return resolveWithoutCatalog(names, metadataService, bootstrapPermissionSets, options.logger);

    const requests = permissionSetRequestsFor(names, options.addresses);
    try {
      return (await catalogLoader(requests)) ?? [];
    } catch (e) {
      options.logger?.warn?.(
        '[security] permission-set catalog lookup failed — unresolved sets grant nothing this request',
        { unresolved: names, error: (e as Error)?.message },
      );
      return [];
    }
  }
}

/**
 * The by-name arm of {@link PermissionEvaluator.resolvePermissionSets}, for a
 * composition with no catalog bound: the metadata service's list (async or a
 * synchronous stand-in), then the bootstrap sets, one set per name.
 */
async function resolveWithoutCatalog(
  names: readonly string[],
  metadataService: any,
  bootstrapPermissionSets: readonly PermissionSet[],
  logger: { warn?: (msg: string, meta?: Record<string, any>) => void } | undefined,
): Promise<PermissionSet[]> {
  let listed: unknown = [];
  try {
    const answer = metadataService?.list?.('permission') ?? metadataService?.list?.('permissions') ?? [];
    listed = typeof (answer as any)?.then === 'function' ? await answer : answer;
  } catch (e) {
    logger?.warn?.(
      '[security] permission-set metadata list() failed — falling back to the bootstrap sets',
      { requested: [...names], error: (e as Error)?.message },
    );
  }
  const wanted = new Set(names);
  const result: PermissionSet[] = [];
  const seen = new Set<string>();
  for (const ps of [...(Array.isArray(listed) ? listed : []), ...bootstrapPermissionSets]) {
    if (ps && wanted.has(ps.name) && !seen.has(ps.name)) {
      seen.add(ps.name);
      result.push(ps);
    }
  }
  return result;
}

/** [ADR-0150 D3] The address a context carries for one granted set — `ExecutionContext.permissionSetAddresses`' entry. */
export interface PermissionSetAddressLike {
  readonly packageId: string | null;
  readonly name: string;
}

/**
 * [ADR-0150 D3] One permission set the evaluator asks the catalog for: a name,
 * and — when the context carried an address of a package for it — that holder.
 * No `packageId`: resolved by D3 with no caller.
 */
export interface PermissionSetRequest {
  readonly name: string;
  readonly packageId?: string;
}

/** The catalog loader {@link PermissionEvaluator.resolvePermissionSets} asks: one definition per holder resolved. */
export type CatalogSetLoader = (requests: readonly PermissionSetRequest[]) => Promise<PermissionSet[]>;

/**
 * [ADR-0150 D3] The requests for `names`: one per address of a package the
 * context carries for a name (two packages' sets of one name are two
 * requests), else one with no holder. An address with a `null` package names
 * a set no package holds — the environment's own — which D3 with no caller
 * answers first, so it is requested with no holder too.
 */
export function permissionSetRequestsFor(
  names: readonly string[],
  addresses: readonly PermissionSetAddressLike[] | undefined,
): PermissionSetRequest[] {
  const requests: PermissionSetRequest[] = [];
  for (const name of names) {
    const holders = [...new Set(
      (addresses ?? [])
        .filter((a) => a?.name === name && typeof a.packageId === 'string' && a.packageId !== '')
        .map((a) => a.packageId as string),
    )];
    const environmentToo = (addresses ?? []).some((a) => a?.name === name && a.packageId === null);
    if (holders.length === 0) {
      requests.push({ name });
      continue;
    }
    for (const packageId of holders) requests.push({ name, packageId });
    if (environmentToo) requests.push({ name });
  }
  return requests;
}
