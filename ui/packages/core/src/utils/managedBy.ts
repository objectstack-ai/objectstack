/**
 * managedBy — the UI end of the platform's `managedBy` → CRUD affordance
 * contract (ADR-0103).
 *
 * ## What is spec-owned here, and what is not (objectstack#4115)
 *
 * The bucket logic is **the spec's**, and this module now says so in code
 * rather than in a comment. `CrudAffordances` / `RowCrudPredicates` are
 * re-exported from `@objectstack/spec/data`, and the bucket resolution itself
 * delegates to the spec's `resolveCrudAffordances()`.
 *
 * This module used to describe itself as a "UI-side mirror" of that function
 * and carry its own `DEFAULTS` table — a line-for-line copy of the spec's
 * `CRUD_AFFORDANCE_DEFAULTS`, plus a copy of its override parser. A faithful
 * copy passes every value comparison and every behavioural test, so nothing
 * would have caught the release in which the spec re-buckets an object class;
 * reference identity is the only check that distinguishes a re-export from a
 * fork (objectui#3003).
 *
 * What is genuinely objectui's and keeps a local name:
 * {@link resolveEffectiveCrudAffordances} — the spec's object-level matrix
 * INTERSECTED with the server-resolved effective API operation set (objectstack#3391), so
 * the UI never offers a button the server would 405. The spec's function has
 * no such notion; naming ours after it was the misdescription this burn-down
 * removes.
 *
 * Lives in `@object-ui/core` — React-free and reachable by every UI package
 * (app-shell, plugin-detail, plugin-form, plugin-grid) — so the intersection is
 * defined ONCE instead of hand-mirrored in each. The bucket UNION type lives in
 * `@object-ui/types` (`ManagedByBucket`) and is re-exported here for
 * convenience. All translated copy (badge variants, empty-state messages) stays
 * in `@object-ui/app-shell`.
 */

import {
  resolveCrudAffordances as resolveSpecCrudAffordances,
  type CrudAffordances,
  type RowCrudPredicates,
} from '@objectstack/spec/data';

export type { ManagedByBucket } from '@object-ui/types';

/**
 * The resolved CRUD affordance matrix and its per-record predicate envelope
 * are **spec-owned** (`@objectstack/spec/data`, ADR-0103) and re-exported here,
 * not re-declared.
 *
 * Note this also TIGHTENS the predicate types: the local copies typed
 * `visibleWhen` / `disabledWhen` as `unknown`, while the spec types them as
 * `Expression | ExpressionInput` — the authored CEL shorthand or its envelope.
 * The local `unknown` was imprecision, not a deliberate dialect.
 */
export type { CrudAffordances, RowCrudPredicates };

/** `edit`/`delete` accept a bare boolean or the #2614 object form. */
export type UserActionOverride =
  | boolean
  | {
      enabled?: boolean;
      visibleWhen?: RowCrudPredicates['visibleWhen'];
      disabledWhen?: RowCrudPredicates['disabledWhen'];
    };

export interface UserActionsOverride {
  /**
   * Bare boolean or the object form. Widened from `boolean` in objectui#4646:
   * `@objectstack/spec@17.0.0` types this key
   * `z.union([z.boolean(), RowCrudActionOverrideSchema])`, and the spec's
   * resolver emits the parsed predicates as `CrudAffordances.createPredicates`.
   * The local type said `boolean` — so an author writing the shape the spec
   * accepts, and that the related-list toolbar now honours
   * (`RelatedRecordActionsBridge`, objectui#4646), was rejected by objectui's
   * own type while the runtime handled it.
   */
  create?: UserActionOverride;
  /**
   * Bare boolean or the object form — the SAME union as `create` above, which
   * is how `@objectstack/spec@17.0.0` types the two toolbar keys
   * (`z.union([z.boolean(), RowCrudActionOverrideSchema])` for each), and its
   * resolver emits `CrudAffordances.importPredicates` beside
   * `createPredicates`.
   *
   * Widened in objectui#5142, deliberately IN THE SAME change that gave the
   * object-list toolbar's Import button a consumer for those predicates
   * (`ObjectView`). objectui#4646 left this key narrow on purpose and said why:
   * widening a type ahead of its consumer re-declares the inert-metadata defect
   * — objectui would have *claimed* to accept the object form while still
   * dropping the predicate. Type and consumer travel together, so the
   * declaration stays an honest statement of what this renderer honours.
   */
  import?: UserActionOverride;
  edit?: UserActionOverride;
  delete?: UserActionOverride;
  exportCsv?: boolean;
}

export interface SchemaLike {
  managedBy?: string | null;
  userActions?: UserActionsOverride | null;
}

/**
 * Collapse an `edit`/`delete` override (boolean or #2614 object form) onto
 * the given bucket default, surfacing any per-record predicates alongside.
 *
 * THE single parser for the `userActions.{edit,delete}` override shape — every
 * UI package (grid row affordances, related-list row predicates) routes through
 * here instead of re-implementing the boolean/object-form parse locally. The
 * spec keeps its equivalent (`normalizeRowCrudOverride`) module-private, so
 * this stays a local declaration — under a name the spec does not own.
 *
 * `base` is the bucket default an omitted `enabled` falls back to (callers that
 * only gate on an explicit opt-out pass `true`; predicate extraction is
 * independent of `base`).
 */
export function normalizeUserAction(
  v: UserActionOverride | undefined | null,
  base: boolean,
): { enabled: boolean; predicates?: RowCrudPredicates } {
  if (v == null) return { enabled: base };
  if (typeof v === 'boolean') return { enabled: v };
  const enabled = v.enabled ?? base;
  if (v.visibleWhen == null && v.disabledWhen == null) return { enabled };
  const predicates: RowCrudPredicates = {};
  if (v.visibleWhen != null) predicates.visibleWhen = v.visibleWhen;
  if (v.disabledWhen != null) predicates.disabledWhen = v.disabledWhen;
  return { enabled, predicates };
}

/**
 * Extract the per-record CEL predicates (#2614 object form) from a
 * `userActions.edit` / `delete` flag, or `undefined` for a bare boolean /
 * predicate-less flag. Independent of the object-level enabled verdict — row
 * renderers use this to gate a built-in action per record. Thin wrapper over
 * {@link normalizeUserAction} so the parse lives in exactly one place.
 */
export function userActionPredicates(
  v: UserActionOverride | undefined | null,
): RowCrudPredicates | undefined {
  return normalizeUserAction(v, false).predicates;
}

/**
 * The affordance-bit → server API-operation mapping used to intersect the
 * UI-intent affordances with the server's effective API operation set (objectstack#3391).
 * This is the objectui end of the framework's `API_METHOD_DERIVATION` contract:
 * the button predicate is `affordance(op) ∧ effective.api(op)`.
 */
const AFFORDANCE_TO_API_OPERATION = {
  create: 'create',
  import: 'import',
  edit: 'update',
  delete: 'delete',
  exportCsv: 'export',
} as const;

/**
 * Resolve the CRUD affordances a UI surface should expose for an object —
 * the spec's object-level matrix, INTERSECTED with what the server will
 * actually accept.
 *
 * The bucket/`userActions` half is **not computed here**: it is delegated to
 * `resolveCrudAffordances()` from `@objectstack/spec/data` (ADR-0103), so the
 * bucket table has exactly one definition on the platform. Only the
 * intersection below is objectui's, which is why this function no longer
 * carries the spec's name (objectstack#4115).
 *
 * @param obj The object schema (managedBy bucket + userActions overrides).
 * @param effectiveApiOperations OPTIONAL server-resolved effective API operation
 *   set for this object (from `/me/permissions` `apiOperations`, objectstack#3391). When
 *   provided, each affordance bit is ANDed with the corresponding API operation
 *   (create/import→create/import, edit→update, delete→delete, exportCsv→export),
 *   so the UI never shows a button the server would 405. Passing `undefined`
 *   (old backend / no effective set) leaves the affordances untouched —
 *   backward-compatible. An empty array means "expose nothing" → all bits off.
 */
export function resolveEffectiveCrudAffordances(
  obj: SchemaLike | null | undefined,
  effectiveApiOperations?: readonly string[] | null,
): CrudAffordances {
  // The spec's resolver is the single definition of the bucket defaults and the
  // `userActions` override parse (including the #2614 object form). Its input
  // type does not model the `null`s objectui's loosely-typed schemas carry, so
  // they are normalised away at this one seam rather than re-deriving anything.
  const out = resolveSpecCrudAffordances({
    managedBy: obj?.managedBy ?? undefined,
    userActions: (obj?.userActions ?? undefined) as Parameters<
      typeof resolveSpecCrudAffordances
    >[0]['userActions'],
  });
  // [objectstack#3391] Intersect with the server's effective API operations when present.
  // The frontend consumes the effective set the server hands down; it never
  // reads the raw `apiMethods` nor re-derives.
  if (Array.isArray(effectiveApiOperations)) {
    const eff = new Set(effectiveApiOperations);
    for (const [bit, op] of Object.entries(AFFORDANCE_TO_API_OPERATION) as Array<
      [keyof typeof AFFORDANCE_TO_API_OPERATION, string]
    >) {
      if (out[bit] && !eff.has(op)) out[bit] = false;
    }
  }
  return out;
}

/** True only when a `userActions` flag (bare boolean or #2614 object form) opts the write in. */
export function isWriteOptedIn(v: UserActionOverride | undefined | null): boolean {
  return v === true || (typeof v === 'object' && v !== null && v.enabled === true);
}

/**
 * True for a platform-defined schema whose DATA is admin/user-writable — the
 * `system-data` bucket. Used to pick the writable-system badge/empty-state copy
 * instead of the engine-owned "read-only monitoring surface" copy.
 *
 * **Simplified in protocol 17 (objectstack#3355).** Under ADR-0103's v16 split
 * this had to RECOVER the distinction from `userActions`: `system` doubled as
 * both the engine-owned default and the writable set, so "did it open any
 * write?" was the only way to tell a Notification Preferences grid from an
 * automation-run log. v17 retired that overload — the writable half is now the
 * `system-data` bucket (writable by DEFAULT) and the engine-owned half is
 * `engine-owned` — so the bucket answers the question directly and the
 * `userActions` probe would only re-derive what the value already states.
 *
 * The narrowing case is deliberately still `true`: a `system-data` grid that
 * narrows to edit-only is still platform-schema/user-data and should read as
 * such. The spec refuses `system-data` on an object that narrows away every
 * write, so there is no "writable bucket with no writes" shape to worry about.
 */
export function isSystemWritable(obj: SchemaLike | null | undefined): boolean {
  return obj?.managedBy === 'system-data';
}

/**
 * Whether an object's rows may be edited in place (detail inline-edit / form
 * fields) — the resolved `edit` affordance. Engine-owned `system` /
 * `append-only` / `better-auth` objects resolve to `false` unless they opened
 * `userActions.edit`. (Per-record predicates gate row action buttons, not
 * object-level editability, so only the resolved boolean matters here.)
 *
 * @param effectiveApiOperations OPTIONAL server-resolved effective API operation
 *   set for this object (`/me/permissions` `apiOperations`, objectstack#3391/objectstack#3546). When
 *   provided, inline-edit is additionally ANDed with the server allowing
 *   `update`, so a record page never offers double-click/pencil editing the
 *   server would 405. `undefined` (old backend / unrestricted) leaves the
 *   bucket affordance untouched.
 */
export function isObjectInlineEditable(
  obj: SchemaLike | null | undefined,
  effectiveApiOperations?: readonly string[] | null,
): boolean {
  return resolveEffectiveCrudAffordances(obj, effectiveApiOperations).edit;
}
