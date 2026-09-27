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
  canServeApiOperation,
  type EnableLike,
} from '@objectstack/spec/data';
import { objectPermissionGrants, type EffectiveObjectPermission } from '@objectstack/spec/security';

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
 * The super-user grant covers private/managed objects on the server, so the
 * read and write bypass reach every entry here.
 *
 * [#20134] This reads the MERGED wildcard, so it knows only the two bypass
 * bits, and only four entry bits. The per-set half,
 * {@link foldSuperUserWildcardGrants}, carries what that reading cannot: the
 * `transfer` the write bypass grants, and a super-user wildcard's own plain
 * bits (`'*': { viewAllRecords, allowEdit }` edits). Two cells here are known
 * to be BROADER than enforcement, and are left exactly as they are for the
 * over-grant card of this family (#20136):
 *  - the merged bypass is folded into an entry the super-user set itself names
 *    narrower — `resolveObjectPermission` answers that set with its explicit
 *    entry, so the walled `organization_admin` is granted edit on
 *    `sys_position` here and refused it by the server;
 *  - `allowCreate` is pulled on the write bypass, which the spec's
 *    `objectPermissionGrants` deliberately gives no create cell: a
 *    `'*': { modifyAllRecords: true }` without `allowCreate` is granted create
 *    here and refused it by the server.
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

/**
 * [#20134] The per-set half of the super-user fold: each set's SUPER-USER
 * `'*'` puts every bit it grants on each entry that set does not name, mutating
 * the map in place. Runs after the seed (so every registered object has an
 * entry) and BEFORE the managed-write clamp.
 *
 * Without it the map held only the four bits {@link foldWildcardSuperUser}
 * pulls, so `current_user.can(object, 'transfer')` answered `false` for
 * `admin_full_access` and the walled `organization_admin` on every object
 * where `PermissionEvaluator.checkObjectPermission('transfer', …)` answers
 * `true` through `modifyAllRecords`, and a super-read wildcard lost its own
 * plain bits (`'*': { viewAllRecords, allowEdit }` read only).
 *
 * The bits are DERIVED, not listed: for each grant bit, the spec's
 * `objectPermissionGrants` — the one fold `checkObjectPermission` itself asks
 * — is read on the set's wildcard. For a super-user wildcard its read cell is
 * always `true`, so its export cell is exactly the wildcard's own
 * `allowExport`, the grant half the evaluator's export conjunction reads.
 *
 * Exactly as broad as `resolveObjectPermission`, never broader:
 *  - a set that names the object contributes nothing here: for that set the
 *    explicit entry is the whole answer, and the merge already carries it;
 *  - a super-user wildcard covers a private object as much as a public one,
 *    so no posture is read;
 *  - only `true` bits are set — a bit the wildcard does not grant is left
 *    as the other passes left it.
 *
 * A plain wildcard is {@link materializePlainWildcardCoverage}'s, and a map
 * holding no super-user wildcard leaves this pass without a single write.
 */
function foldSuperUserWildcardGrants(
  objects: Record<string, any>,
  sets: ReadonlyArray<EffectiveObjectPermissionsInputSet | null | undefined>,
): void {
  const superWildcards: Array<{ named: Record<string, unknown>; bits: readonly GrantBit[] }> = [];
  for (const ps of sets) {
    const named = ps?.objects as Record<string, unknown> | null | undefined;
    const wild = named?.['*'] as Record<string, unknown> | null | undefined;
    if (!named || !wild || typeof wild !== 'object') continue;
    // The file's one reading of "is this a super-user wildcard?", asked of the set.
    if (!wildcardGrantsSuperRead(named)) continue;
    const bits = GRANT_BITS.filter((bit) => objectPermissionGrants(wild as EffectiveObjectPermission, bit));
    superWildcards.push({ named, bits });
  }
  if (superWildcards.length === 0) return;
  for (const [obj, acc] of Object.entries(objects) as Array<[string, any]>) {
    if (obj === '*' || !acc) continue;
    for (const { named, bits } of superWildcards) {
      // `resolveObjectPermission`'s own test: a set's explicit entry, when it
      // has one, is that set's whole answer for the object.
      if (named[obj]) continue;
      for (const bit of bits) {
        if (acc[bit] !== true) acc[bit] = true;
      }
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
 * The posture slice of a registered object schema: whether a plain `'*'` grant
 * covers it at all. `access.default === 'private'` keeps a wildcard carrying no
 * super-user bypass bit off the object — ADR-0066 D2, read exactly as
 * `PermissionEvaluator` reads it (`access?.default === 'private'`; anything else
 * is public).
 */
export interface ObjectAccessPostureLike {
  name?: string;
  /**
   * The registered schema's own `access` block, passed through as it is. Typed
   * `unknown` so that any schema a caller already hands over still type-checks;
   * the one read is `access.default === 'private'`.
   */
  access?: unknown;
}

/** `access.default === 'private'` off a registered schema — the evaluator's own test. */
function isPrivatePosture(schema: ObjectAccessPostureLike | null | undefined): boolean {
  const access = schema?.access;
  return typeof access === 'object' && access !== null && (access as { default?: unknown }).default === 'private';
}

/** The `allow*` bits {@link objectPermissionGrants} reads, i.e. every bit a `can()` verb resolves to. */
const GRANT_BITS = ['allowRead', 'allowCreate', 'allowEdit', 'allowDelete', 'allowTransfer', 'allowExport'] as const;
type GrantBit = (typeof GRANT_BITS)[number];
const GRANT_BIT_SET: ReadonlySet<string> = new Set(GRANT_BITS);

/** Does the entry grant any verb on its own? (`objectPermissionGrants` over every verb target.) */
function grantsAnyVerb(entry: Record<string, unknown>): boolean {
  return GRANT_BITS.some((bit) => objectPermissionGrants(entry as EffectiveObjectPermission, bit));
}

/**
 * [#20083] Materialise every PLAIN `'*'` grant — a wildcard carrying neither
 * super-user bypass bit — onto the registered objects it covers, mutating the
 * map in place. Runs after the merge and the super-user seed (an entry the
 * seed placed only gains grants here, and keeps its place), BEFORE the fold.
 *
 * The merge above folds each set's EXPLICIT entries and keeps `'*'` as a key of
 * its own, but the server does not stop there: `PermissionEvaluator`'s
 * `resolveObjectPermission` answers, PER SET, with that set's explicit entry
 * for the object when it has one, and otherwise with its `'*'` — for a public
 * object always, for a private one only when the wildcard is a super-user
 * grant. So a set whose plain wildcard covers an object contributes that
 * wildcard to the object, and `checkObjectPermission` allows as soon as ANY
 * set's contribution grants. Without this pass the map held no entry for an
 * object reached only that way, and `current_user.can()` — which reads an absent
 * entry as "no grant" — answered `false` for a wall-less org admin
 * (`organization_admin_no_bypass`) on every app object the server lets them
 * write; and it held a narrower entry wherever one set named the object and
 * another covered it by its wildcard.
 *
 * Exactly as broad as that resolution, never broader:
 *  - only REGISTERED objects are covered — the server refuses an object whose
 *    posture it cannot resolve, whatever the wildcard says;
 *  - a set that names the object explicitly contributes nothing here: for
 *    that set the explicit entry is the whole answer, and the merge already
 *    carries it;
 *  - a `private` object takes nothing from a plain wildcard;
 *  - only `true` bits are merged — the grants every `can()` verb reads. A
 *    wildcard's `false` or unset bit grants nothing, and depth keys
 *    (`readScope`/`writeScope`) are not grants;
 *  - an object the pass would ADD but whose entry grants no verb on its own is
 *    left out: an absent entry and an all-`false` one read the same.
 *
 * A super-user wildcard is NOT materialised here: {@link seedSuperUserRestrictedObjects}
 * and {@link foldWildcardSuperUser} carry it, and this pass leaves their answer
 * byte-for-byte as it was for every subject holding no plain wildcard.
 */
function materializePlainWildcardCoverage(
  objects: Record<string, any>,
  sets: ReadonlyArray<EffectiveObjectPermissionsInputSet | null | undefined>,
  allSchemas: readonly (ApiExposureSchemaLike & ObjectAccessPostureLike)[],
): void {
  const plainWildcards: Array<{ named: Record<string, unknown>; wild: Record<string, unknown> }> = [];
  for (const ps of sets) {
    const named = ps?.objects as Record<string, unknown> | null | undefined;
    const wild = named?.['*'] as Record<string, unknown> | null | undefined;
    if (!named || !wild || typeof wild !== 'object') continue;
    if (wild.viewAllRecords === true || wild.modifyAllRecords === true) continue;
    if (!GRANT_BITS.some((bit) => wild[bit] === true)) continue;
    plainWildcards.push({ named, wild });
  }
  if (plainWildcards.length === 0) return;
  for (const schema of allSchemas) {
    const name = schema?.name;
    if (!name || name === '*') continue;
    if (isPrivatePosture(schema)) continue;
    const had = Object.prototype.hasOwnProperty.call(objects, name);
    const acc: Record<string, unknown> = had ? objects[name] : {};
    let touched = false;
    for (const { named, wild } of plainWildcards) {
      // `resolveObjectPermission`'s own test: a set's explicit entry, when it
      // has one, is that set's whole answer for the object.
      if (named[name]) continue;
      // The wildcard's own key order, so an entry this pass adds reads like
      // every other entry the map carries.
      for (const [bit, value] of Object.entries(wild)) {
        if (value === true && GRANT_BIT_SET.has(bit) && acc[bit] !== true) {
          acc[bit] = true;
          touched = true;
        }
      }
    }
    if (!had && touched && grantsAnyVerb(acc)) objects[name] = acc;
  }
}

/**
 * [#3391] Seed false-initialized per-object entries for a wildcard SUPER-USER,
 * for every registered object the merged map does not already carry.
 *
 * A super-user's grant is usually the `'*'` wildcard, not explicit per-object
 * entries — so the objects it reaches never appear in the merged `objects` map.
 * Seeding a `{allow*: false}` entry lets {@link foldWildcardSuperUser} and
 * {@link foldSuperUserWildcardGrants} pull its grants true and lets
 * {@link annotateEffectiveApiOperations} attach the effective operation set
 * where the object narrows it. Runs BEFORE both folds.
 *
 * [#18990] Admitted by {@link wildcardGrantsSuperRead} — the READ bypass, so
 * BOTH super-user classes are seeded, and a plain wildcard grant carrying
 * neither bypass bit still is not — [#20083] its coverage is
 * {@link materializePlainWildcardCoverage}'s, which puts the wildcard's own
 * grants on the objects it covers. This pass used to be guarded to
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
 * [#18931] An unrestricted object whose `export` the export axis withholds is
 * seeded too: annotate iterates existing entries only, so without an entry
 * `/me/permissions` stayed silent for exactly the population #8681 created — a
 * wildcard-only admin holding no `allowExport` — the client's `apiOperations`
 * was `undefined`, its default-allow path rendered an Export button, and the
 * click was refused `403 EXPORT_NOT_PERMITTED`.
 *
 * [#20134] And so is EVERY other registered object absent from the map — the
 * name keeps its #3391 origin, the scope does not. The pass used to skip an
 * unrestricted object whose `export` stays allowed, the one object that needs
 * no `apiOperations` annotation. But the entry is not only the annotation's
 * carrier: `current_user.can()` reads the map entry by entry and an absent one
 * as "no grant", so a super-user wildcard that also carries `allowExport` left
 * every such object reading `false` for every verb the server lets that
 * principal perform. The entry is the truth the #18990 ruling asks for — every
 * object a principal can reach gets one — and annotate keeps its own skip:
 * an entry seeded for an unrestricted, export-allowed object carries no
 * `apiOperations`, so the client's default-allow path for the operation set is
 * exactly as it was.
 */
export function seedSuperUserRestrictedObjects(
  objects: Record<string, any>,
  allSchemas: readonly ApiExposureSchemaLike[],
): void {
  if (!wildcardGrantsSuperRead(objects)) return;
  // A super-user wildcard covers every registered object, private ones
  // included (`PermissionEvaluator`'s `resolveObjectPermission`), so every
  // registered object the merge left absent gets an entry.
  for (const schema of allSchemas) {
    const name = schema?.name;
    if (!name || name === '*' || objects[name]) continue;
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
 *
 * [#20135] The set is what the REST door SERVES this subject, read through the
 * door's own two questions rather than a second spelling of either:
 *
 *  - the OBJECT half is `canServeApiOperation` — the boolean face of the
 *    spec's `apiExposureDenialReason`, the one function
 *    `@objectstack/rest`'s `enforceApiAccess` turns into its 404 / 405. It
 *    judges `enable.apiEnabled === false` FIRST and for every operation, so an
 *    API-disabled object is annotated `[]`: the door answers
 *    `404 OBJECT_API_DISABLED` for every verb, whatever `apiMethods` says, and
 *    an entry left without an annotation would send the client down its
 *    default-allow path — every operation offered, every one refused. The
 *    entry itself stays: `apiEnabled` closes the API, not data access, and the
 *    map's CRUD bits are what `current_user.can()` reads on the server;
 *  - the USER half is the export door's own conjunction on this entry,
 *    `objectPermissionGrants(entry, 'allowExport')` — read ∧ an opt-in export
 *    grant. By the time this pass runs every set's `'*'` has been put on the
 *    entries it covers for THAT set and posture (plain coverage, then the
 *    per-set super-user fold), so the entry already is
 *    `PermissionEvaluator.checkObjectPermission('export', …, { isPrivate })`'s
 *    answer. It used to fall back to the MERGED `'*'` export bit, which covers
 *    what no single set covers: a private object reached only through a plain
 *    `'*': { allowExport: true }` (a plain wildcard never covers a private
 *    object), and an object the exporting set itself names without the grant.
 *    Both were annotated `export` and answered `403 EXPORT_NOT_PERMITTED`.
 *
 * Which entries carry the annotation is unchanged in rule: only an
 * unrestricted object that keeps its whole closure — every operation served,
 * `export` included — gets none.
 */
export function annotateEffectiveApiOperations(
  objects: Record<string, any>,
  schemaOf: (objectName: string) => ApiExposureSchemaLike | undefined,
): void {
  for (const [obj, acc] of Object.entries(objects) as Array<[string, any]>) {
    if (obj === '*' || !acc) continue;
    const schema = schemaOf(obj);
    if (!schema) continue; // schema missing → no annotation (client falls back)
    const enable = schema.enable ?? undefined;
    // [#3544] User-level export axis: `export` derives from `list ∧ this
    // grant`. OPT-IN — only an explicit `true` allows export; unset and
    // `false` both withhold it, and the super-user bits do NOT imply it.
    // [#20135] Read off THIS entry, as the export door reads it (see above).
    const userExportAllowed = objectPermissionGrants(acc as EffectiveObjectPermission, 'allowExport');
    const eff = resolveEffectiveApiMethods(enable, { userExportAllowed });
    const closure = effectiveOperationsArray(eff);
    // [#20135] Only what the door itself admits: `apiEnabled: false` empties
    // the set; any other `enable` leaves the closure as it is.
    const served = closure.filter((operation) => canServeApiOperation(enable, operation));
    // Annotate when the object tightens via `apiMethods`, when the export
    // axis removes `export` from an otherwise-open object (so the client
    // hides the Export button), OR when the door serves less than the closure
    // (an API-disabled object). An unrestricted object with every operation
    // still served needs no annotation — the client keeps its default-allow
    // path.
    if (eff.mode === 'unrestricted' && userExportAllowed && served.length === closure.length) continue;
    acc.apiOperations = served;
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
  /**
   * Every registered object schema — read by the plain-wildcard coverage
   * (`name` and `access.default`, [#20083]) and by the super-user seed (`name`
   * and `enable`). Hand over the registered schemas themselves: an entry whose
   * `access` is missing reads as public, exactly as it does to the server.
   */
  allSchemas?: () => readonly (ApiExposureSchemaLike & ObjectAccessPostureLike)[] | null | undefined;
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
 * In order:
 *
 *  1. the most-permissive merge of every set's explicit `objects` entries —
 *     same semantics as `PermissionEvaluator.getFieldPermissions`, for ALL
 *     objects in one pass (`'*'` is merged as an ordinary key);
 *  2. {@link seedSuperUserRestrictedObjects} — guarded: a failure is reported
 *     and the map is kept;
 *  3. {@link materializePlainWildcardCoverage} — [#20083] each set's plain
 *     `'*'` onto the registered objects it covers for that set, so the map is
 *     as broad as `checkObjectPermission` there; guarded like (2);
 *  4. {@link foldWildcardSuperUser}, then {@link foldSuperUserWildcardGrants} —
 *     [#20134] each set's super-user `'*'` onto the entries it covers for that
 *     set, every bit it grants;
 *  5. {@link clampManagedObjectWrites};
 *  6. {@link annotateEffectiveApiOperations} — guarded like (2).
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
  const allSchemas = (() => {
    try { return source.allSchemas?.() ?? []; } catch { return [] as ApiExposureSchemaLike[]; }
  })();
  // [#3391] For a wildcard super-user — [#18990] either bypass bit, not
  // modify-all alone — seed [#20134] every registered object absent from the
  // merged map, so the folds pull what they pull and annotate can attach the
  // effective apiOperations where the object narrows them. Guarded — a failure
  // here must never drop the whole map.
  try {
    seedSuperUserRestrictedObjects(objects, allSchemas);
  } catch (e: any) {
    source.logger?.warn?.('[effective-permissions] apiOperations seed failed', { err: e?.message });
  }
  // [#20083] A plain `'*'` covers every registered public object its set does
  // not name — per set, as the server resolves it. After the seed, so an entry
  // the seed already placed keeps its place in the map and only gains grants.
  // Guarded like the seed.
  try {
    materializePlainWildcardCoverage(objects, sets, allSchemas);
  } catch (e: any) {
    source.logger?.warn?.('[effective-permissions] plain-wildcard coverage failed', { err: e?.message });
  }
  // Make the per-object map reflect the server's ACTUAL effective enforcement
  // = permission-set grant ∩ identity write guard (ADR-0057 D10, cited as an
  // attribution, #9628): (1) fold the `'*'` super-user grant into every object
  // so an admin's wildcard is not shadowed by another set's explicit deny —
  // the merged bypass bits, then [#20134] every bit each set's super-user
  // wildcard grants, `transfer` and its own plain bits included;
  // (2) re-clamp guarded managed objects by their write affordance.
  foldWildcardSuperUser(objects);
  foldSuperUserWildcardGrants(objects, sets);
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
