// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The EFFECTIVE object-permission map — object name -> `EffectiveObjectPermission`
 * — computed from a subject's resolved permission sets. ONE function, two
 * consumers:
 *
 *  - `/auth/me/permissions` (`@objectstack/plugin-hono-server`) serves it as the
 *    `objects` slot of its response;
 *  - `ISecurityService.getEffectiveObjectPermissions` (`@objectstack/plugin-security`)
 *    returns it, and the engine hands it to `current_user.can(object, verb)` as
 *    `EvalContext.permissions` (#18783).
 *
 * ## Why here, and why ONE function
 *
 * The contract member's docblock requires the two to be byte-for-byte the same
 * answer, "computed once rather than twice": the second consumer (`can()`)
 * cannot tell a wrong map from a right one — an entry the map omits reads as
 * "no grant", indistinguishable from a measured denial. A second copy of this
 * merge would be exactly the hand-built map `@objectstack/formula`'s
 * `toEvalPermissions` names as a confident silent denial waiting to happen.
 *
 * It lives in `@objectstack/core` because both consumers already depend on this
 * package and on nothing else they share: `plugin-hono-server` must never take a
 * runtime dependency on `plugin-security` (it is optional in the stacks those
 * endpoints serve), and `plugin-security` has no business importing a transport.
 * The folds below used to live in `plugin-hono-server`'s
 * `current-user-endpoints.ts`, which still re-exports them under the same names.
 *
 * Every function here is PURE over its inputs (the map is mutated in place and
 * returned; nothing else is read or written) — the set RESOLUTION is the
 * caller's, from the one resolver `ISecurityService.resolvePermissionSetsForContext`.
 */

import {
  resolveEffectiveApiMethods,
  effectiveOperationsArray,
  type EnableLike,
} from '@objectstack/spec/data';
import type { EffectiveObjectPermission } from '@objectstack/spec/security';

/**
 * Does the `'*'` entry carry the super-user READ bypass?
 *
 * ONE reading of that question for this whole file — {@link foldWildcardSuperUser}
 * asks it to decide whose `allowRead` it pulls true, and
 * {@link seedSuperUserRestrictedObjects} asks it to decide whom it seeds for, so
 * the seed can never materialise an entry for a principal the fold leaves false.
 * It is the same bypass the server itself applies: `PermissionEvaluator`'s
 * `wildcardSuperUser()` treats `viewAllRecords` and `modifyAllRecords` alike for
 * read (`allowRead` short-circuits on either), and only the modify bit reaches
 * the write axis.
 */
function wildcardGrantsSuperRead(objects: Record<string, any>): boolean {
  const wild = objects?.['*'];
  return wild?.viewAllRecords === true || wild?.modifyAllRecords === true;
}

/**
 * Fold the `'*'` wildcard super-user grant into every per-object entry of a
 * `/me/permissions` `objects` map, mutating it in place.
 *
 * The endpoint merges each resolved permission set's explicit `objects` entries
 * most-permissively per key, but treats `'*'` and named objects as independent
 * keys — so a wildcard "Modify/View All Data" grant is never propagated into a
 * per-object entry another set explicitly denied. That makes the client's
 * per-object FLS STRICTER than the server's actual enforcement
 * (`PermissionEvaluator.checkObjectPermission`, which returns allow as soon as
 * ANY set grants — including via the `'*'` modifyAll/viewAll super-user bypass,
 * with no deny-wins). The mismatch surfaces for a platform admin
 * (`admin_full_access` `'*': {modifyAllRecords}`) who ALSO holds
 * `organization_admin` (which denies writes on identity tables): the client
 * would see `sys_user.allowEdit:false` and disable a form the server accepts
 * (verified: `PATCH /data/sys_user {name}` → 200). ADR-0124 D1 makes the
 * server the authoritative gate, and D4 makes this direction explicit: what
 * the client is told must be derived from the server's actual effective
 * enforcement, never from an independent reading of the declarations.
 *
 * The super-user grant covers private/managed objects on the server, so folding
 * it here is exactly as broad as real enforcement — never broader.
 */
export function foldWildcardSuperUser(objects: Record<string, any>): void {
  const wild = objects?.['*'];
  if (!wild) return;
  const superRead = wildcardGrantsSuperRead(objects);
  const superWrite = wild.modifyAllRecords === true;
  if (!superRead && !superWrite) return;
  for (const [obj, acc] of Object.entries(objects) as Array<[string, any]>) {
    if (obj === '*' || !acc) continue;
    if (superRead) acc.allowRead = true;
    if (superWrite) {
      acc.allowEdit = true;
      acc.allowCreate = true;
      acc.allowDelete = true;
    }
  }
}

/** Minimal schema shape the managed-write clamp needs. */
export interface ManagedSchemaLike {
  managedBy?: string;
  userActions?: {
    // create/edit/delete all accept the object form
    // ({ enabled, visibleWhen, disabledWhen }) — #2614 gave it to the row
    // pair, #7692 to `create`. Only the object-level `enabled` matters
    // here: the predicates are UI gating, not a permission grant.
    create?: boolean | { enabled?: boolean };
    edit?: boolean | { enabled?: boolean };
    delete?: boolean | { enabled?: boolean };
  } | null;
}

/** True only when a userActions flag (bare boolean or object form) explicitly opts the write in. */
function isWriteOptedIn(v: boolean | { enabled?: boolean } | undefined | null): boolean {
  return v === true || (typeof v === 'object' && v !== null && v.enabled === true);
}

/**
 * Buckets whose user-context generic writes are guarded fail-closed at the
 * engine: `better-auth` by plugin-auth's identity write guard (ADR-0092 D2),
 * `engine-owned` / `append-only` by plugin-security's engine-owned write guard
 * (ADR-0103). `config` / `platform` / `system-data` have no such guard — their
 * permission-set result stands.
 *
 * `system` was listed here until #3355 renamed it to the writable-default
 * `system-data`, which joins `config` / `platform` on the unclamped side. That
 * matters more here than it looks: this clamp reads `userActions` DIRECTLY rather
 * than the resolved affordances, so clamping a bucket whose members legitimately
 * dropped their now-redundant `userActions` block would report `allowEdit: false`
 * for tables the engine happily writes — the exact false-NEGATIVE this function
 * exists to avoid, merely inverted.
 */
const GUARDED_WRITE_BUCKETS: ReadonlySet<string> = new Set(['better-auth', 'engine-owned', 'append-only']);

/**
 * Re-clamp a `/me/permissions` `objects` map by the SECOND server-side
 * enforcement layer that permission sets don't model: the engine write guards.
 * They fail-closed reject USER-CONTEXT insert/update/delete on every managed
 * object whose resolved affordances forbid the verb — `better-auth`
 * (ADR-0092 D2) and `engine-owned`/`append-only` (ADR-0103) — except where the
 * object opted the write affordance in via `userActions.{create,edit,delete}`
 * (e.g. sys_user opens `edit` for its profile fields).
 *
 * Without this clamp, {@link foldWildcardSuperUser} would report `allowEdit:true`
 * for a platform admin on tables the guard actually blocks (sys_member,
 * sys_automation_run, …) — a false-POSITIVE that mirrors, inverted, the
 * false-negative the fold fixes. The real effective answer for a user-context
 * caller is `permission-set grant ∩ guard policy`, and the guard policy for a
 * guarded object is exactly its resolved CRUD affordance. `config`/`platform`/`system-data`
 * objects are NOT clamped — no guard covers them, so their permission-set result
 * stands (an admin CAN write them via the data API, and the hint must not
 * under-report that).
 */
export function clampManagedObjectWrites(
  objects: Record<string, any>,
  schemaOf: (objectName: string) => ManagedSchemaLike | undefined,
): void {
  for (const [obj, acc] of Object.entries(objects) as Array<[string, any]>) {
    if (obj === '*' || !acc) continue;
    const schema = schemaOf(obj);
    if (!schema?.managedBy || !GUARDED_WRITE_BUCKETS.has(schema.managedBy)) continue;
    const ua = schema.userActions ?? {};
    if (!isWriteOptedIn(ua.edit)) acc.allowEdit = false;
    // `create` reads through the same opt-in helper as edit/delete since
    // #7692 widened it to the object form — a bare `ua.create !== true`
    // would clamp away a legitimate `{ enabled: true, visibleWhen: … }`.
    if (!isWriteOptedIn(ua.create)) acc.allowCreate = false;
    if (!isWriteOptedIn(ua.delete)) acc.allowDelete = false;
  }
}

/** The API-exposure-relevant slice of a registered object schema. */
export interface ApiExposureSchemaLike {
  name?: string;
  enable?: EnableLike | null;
}

/**
 * [#3391] Seed false-initialized per-object entries for a wildcard SUPER-USER,
 * for every registered object whose `apiMethods` whitelist tightens exposure.
 *
 * A super-user's grant is usually the `'*'` wildcard, not explicit per-object
 * entries — so restricting objects never appear in the merged `objects` map and
 * would miss their `apiOperations` annotation. Seeding a `{allow*: false}` entry
 * lets {@link foldWildcardSuperUser} pull it true (super-user reads/writes
 * everything) and lets {@link annotateEffectiveApiOperations} attach the effective
 * set. Runs BEFORE fold.
 *
 * [#18990] Admitted by {@link wildcardGrantsSuperRead} — the READ bypass, so
 * BOTH super-user classes are seeded, and a plain wildcard grant carrying
 * neither bypass bit still is not. This pass used to be guarded to
 * `modifyAllRecords` alone, on the reading that materializing a `false` entry
 * for a viewAll-only caller would flip the client's `check('edit')` from
 * "undefined → default-allow" to "explicit false → deny". It does flip it, and
 * that flip is the POINT: the seed only ever touches objects with no explicit
 * entry (`objects[name]` below), and on those a viewAll-only principal really
 * can only read — so "explicit false" for edit is what is TRUE about it, while
 * the silence it replaces left the client rendering write and Export
 * affordances the server answers `403`. `allowRead` is pulled true by the same
 * fold for the same reason: `viewAllRecords` is a read bypass server-side too
 * (`PermissionEvaluator.checkObjectPermission`), so the entry is exactly as
 * broad as real enforcement, never broader.
 *
 * [#18931] A schema is skipped only when it needs NO annotation, which is the
 * predicate {@link annotateEffectiveApiOperations} itself applies: unrestricted
 * AND the export axis leaves `export` in place. Resolving WITHOUT the export
 * slot made this pass disagree with annotate's — an unrestricted object whose
 * `export` the axis withholds got no entry, annotate (which iterates existing
 * entries only) never saw it, and `/me/permissions` stayed silent for exactly
 * the population #8681 created: a wildcard-only admin holding no `allowExport`.
 * The client's `apiOperations` is then `undefined`, its default-allow path
 * renders an Export button, and the click is refused `403 EXPORT_NOT_PERMITTED`.
 */
export function seedSuperUserRestrictedObjects(
  objects: Record<string, any>,
  allSchemas: readonly ApiExposureSchemaLike[],
): void {
  if (!wildcardGrantsSuperRead(objects)) return;
  // [#18931] The export slot annotate will read for an entry seeded here. A
  // seeded entry carries no `allowExport` of its own and `foldWildcardSuperUser`
  // does not add one, so annotate's `acc.allowExport ?? wildExport` resolves to
  // exactly this wildcard bit — the two passes cannot diverge again.
  const userExportAllowed = objects['*']?.allowExport === true;
  for (const schema of allSchemas) {
    const name = schema?.name;
    if (!name || name === '*' || objects[name]) continue;
    const eff = resolveEffectiveApiMethods(schema.enable ?? undefined, { userExportAllowed });
    // Same skip predicate as annotate: there is nothing to say about an
    // unrestricted object that keeps its full operation closure.
    if (eff.mode === 'unrestricted' && userExportAllowed) continue;
    objects[name] = { allowCreate: false, allowRead: false, allowEdit: false, allowDelete: false };
  }
}

/**
 * [#3391] Annotate each per-object `/me/permissions` entry with the SERVER's
 * effective API operation set (`apiOperations`), mutating the map in place.
 *
 * This is the single "effective" channel the frontend consumes — it renders the
 * operations the server hands down here, never the raw `apiMethods` whitelist.
 * An object is annotated whenever its effective set is narrower than the
 * client's default-allow assumption (a `deny-all` object gets an empty array;
 * [#3544] an unrestricted object gets one too whenever the export axis withholds
 * `export`). Only an unrestricted object that keeps its full closure gets
 * nothing, because for it default-allow is already the right answer. Runs AFTER
 * fold + clamp so the annotation sits alongside the final CRUD affordances, and
 * {@link seedSuperUserRestrictedObjects} applies the same predicate so a
 * wildcard-only principal has an entry here to annotate ([#18931]).
 */
export function annotateEffectiveApiOperations(
  objects: Record<string, any>,
  schemaOf: (objectName: string) => ApiExposureSchemaLike | undefined,
): void {
  // [#3544] The `'*'` entry's export grant is the FALLBACK for objects that do
  // not carry one of their own. The merge keeps `'*'` and named objects as
  // independent keys, but the server evaluator does not: its
  // `resolveObjectPermission` falls back to the wildcard whenever a set has no
  // explicit entry for the object, so an admin set granting export wholesale
  // via `'*': { allowExport: true }` really does grant it per-object. Reading
  // the wildcard here keeps the button the client shows and the request the
  // server accepts in agreement — the same class of client/server divergence
  // `foldWildcardSuperUser` exists to close, on the export axis.
  const wildExport = objects?.['*']?.allowExport;
  for (const [obj, acc] of Object.entries(objects) as Array<[string, any]>) {
    if (obj === '*' || !acc) continue;
    const schema = schemaOf(obj);
    if (!schema) continue; // schema missing → no annotation (client falls back)
    // [#3544] User-level export axis: `export` derives from `list ∧ this
    // grant`. OPT-IN — only an explicit `true` (on the object entry, else
    // inherited from `'*'`) allows export; unset and `false` both withhold
    // it, and the super-user bits do NOT imply it.
    const exportBit = acc.allowExport ?? wildExport;
    const userExportAllowed = exportBit === true;
    const eff = resolveEffectiveApiMethods(schema.enable ?? undefined, { userExportAllowed });
    // Annotate when the object tightens via `apiMethods`, OR when the export
    // axis removes `export` from an otherwise-open object (so the client
    // hides the Export button). An unrestricted object with export still
    // allowed needs no annotation — the client keeps its default-allow path.
    if (eff.mode === 'unrestricted' && userExportAllowed) continue;
    acc.apiOperations = effectiveOperationsArray(eff);
  }
}

/**
 * The schema reads {@link buildEffectiveObjectPermissions} needs, as accessors
 * over whatever engine the caller holds. Every accessor is optional and every
 * read is GUARDED: a registry that throws, or an engine that is not wired at
 * all, degrades the annotations exactly as `/auth/me/permissions` always has
 * (no seed, no clamp, no `apiOperations`) — it never drops the map.
 */
export interface EffectiveObjectPermissionsSchemaSource {
  /** Every registered object schema — read by the super-user seed. */
  allSchemas?: () => readonly ApiExposureSchemaLike[] | null | undefined;
  /** One object's schema — read by the managed-write clamp and the `apiOperations` annotation. */
  schemaOf?: (objectName: string) => (ManagedSchemaLike & ApiExposureSchemaLike) | null | undefined;
  /** Where a failed seed / annotation pass is reported. */
  logger?: { warn?: (message: string, meta?: Record<string, unknown>) => void };
}

/** One resolved permission set, as far as this merge reads it. */
export interface EffectiveObjectPermissionsInputSet {
  objects?: Record<string, unknown> | null;
}

/**
 * [#18783] The effective object-permission map for a subject whose permission
 * sets are `sets` — the `objects` slot of `/auth/me/permissions` and the answer
 * of `ISecurityService.getEffectiveObjectPermissions`, from this ONE function.
 *
 * In order, exactly as the endpoint has always composed it:
 *
 *  1. the most-permissive merge of every set's explicit `objects` entries —
 *     same semantics as `PermissionEvaluator.getFieldPermissions`, for ALL
 *     objects in one pass (`'*'` is merged as an ordinary key);
 *  2. {@link seedSuperUserRestrictedObjects} — guarded: a failure is reported
 *     and the map is kept;
 *  3. {@link foldWildcardSuperUser};
 *  4. {@link clampManagedObjectWrites};
 *  5. {@link annotateEffectiveApiOperations} — guarded like (2).
 *
 * Every entry is a FRESH object: nothing in the returned map aliases a
 * permission set, so a caller may freeze or serialise it freely.
 *
 * It throws only where the merge itself cannot read a set (an `objects` value
 * that is not an object) — the set RESOLUTION, and its failure stance, stay
 * with the caller.
 */
export function buildEffectiveObjectPermissions(
  sets: ReadonlyArray<EffectiveObjectPermissionsInputSet | null | undefined>,
  source: EffectiveObjectPermissionsSchemaSource = {},
): Record<string, EffectiveObjectPermission> {
  const objects: Record<string, any> = {};
  for (const ps of sets) {
    if (!ps?.objects) continue;
    for (const [obj, perm] of Object.entries(ps.objects)) {
      const acc = objects[obj] ?? {};
      for (const [k, v] of Object.entries(perm as any)) {
        if (v === true) acc[k] = true;
        else if (acc[k] === undefined) acc[k] = v;
      }
      objects[obj] = acc;
    }
  }
  const schemaOf = (name: string): (ManagedSchemaLike & ApiExposureSchemaLike) | undefined => {
    try { return source.schemaOf?.(name) ?? undefined; } catch { return undefined; }
  };
  // [#3391] For a wildcard super-user — [#18990] either bypass bit, not
  // modify-all alone — seed restricting objects absent from the merged map so
  // fold pulls what it pulls and annotate can attach their effective
  // apiOperations. Guarded — a failure here must never drop the whole map.
  try {
    const allSchemas = (() => {
      try { return source.allSchemas?.() ?? []; } catch { return [] as ApiExposureSchemaLike[]; }
    })();
    seedSuperUserRestrictedObjects(objects, allSchemas);
  } catch (e: any) {
    source.logger?.warn?.('[effective-permissions] apiOperations seed failed', { err: e?.message });
  }
  // Make the per-object map reflect the server's ACTUAL effective enforcement
  // = permission-set grant ∩ identity write guard (ADR-0057 D10, cited as an
  // attribution, #9628): (1) fold the `'*'` super-user grant into every object
  // so an admin's wildcard is not shadowed by another set's explicit deny;
  // (2) re-clamp guarded managed objects by their write affordance.
  foldWildcardSuperUser(objects);
  clampManagedObjectWrites(objects, schemaOf);
  // [#3391] Annotate the per-object effective API operation set. Guarded: on
  // failure `apiOperations` is simply omitted and a client falls back to its
  // default-allow behaviour.
  try {
    annotateEffectiveApiOperations(objects, schemaOf);
  } catch (e: any) {
    source.logger?.warn?.('[effective-permissions] apiOperations annotate failed', { err: e?.message });
  }
  return objects as Record<string, EffectiveObjectPermission>;
}
