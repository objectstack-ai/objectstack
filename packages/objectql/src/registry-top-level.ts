// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#33949 codemod] The top-level declarations ahead of `SchemaRegistry` in
// `registry.ts` that moved out whole by
// the #33949 split codemod (PR #34285, kept in its branch history, not committed)
// (lever (b) of ruling 6591753301).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF:
// it imports neither `registry.ts` nor any `registry-*` module, so it is
// evaluated before the class and forms no cycle with it. `registry.ts`
// re-exports, by name, every declaration here it exported before, so every
// importer of `./registry.js` reads what it read.

import { BASE_FIELD_DISPLAY_WHITELIST, LEGACY_API_METHODS, MANAGED_BY_WRITE_LOCKED_BUCKETS, checkManagedApiMethodAffordances, isTenancyDisabled, resolveInjectedSystemColumns } from '@objectstack/spec/data';
import type { ObjectExtensionParsed, ObjectOwnership, ServiceObject } from '@objectstack/spec/data';
import { readDiscriminatorValue as discriminatorValue, isCodeArtifactBody, isTenantAuthored } from '@objectstack/metadata-core';
import type { FieldPatchTargetMiss } from '@objectstack/metadata-core';
import { scalarOverridesPackagedBase } from '@objectstack/spec/system';
import type { SystemFieldName } from '@objectstack/spec/system';
import { checkFieldCompleteness } from '@objectstack/spec/kernel';
import type { ObjectStackManifest } from '@objectstack/spec/kernel';
import { DEFAULT_FLOW_FUNCTION_EFFECT } from '@objectstack/spec/automation';
import { ActionSchema } from '@objectstack/spec/ui';
import type { SecurityCatalogType } from '@objectstack/core';
import { describeSecurityCatalogHolder, securityCatalogTypeLabel } from './security-catalog-namespace.js';
import type { SecurityCatalogHolder } from './security-catalog-namespace.js';
import { bareNameReason, bareNameTypeLabel, describeBareNameHolder } from './bare-name-one-holder.js';
import type { BareNameHolder, BareNameOneHolderType } from './bare-name-one-holder.js';
import type { DefaultRecordPageHolder } from './default-record-page.js';
import type { PicklistOptionLike } from './picklist-resolution.js';
import type { PackageScopedHolder } from './package-scoped-resolver.js';
import { GLOBAL_ACTION_OBJECT_KEY, isObjectLessActionKey, standaloneActionOwnerKey } from './action-governance.js';

/**
 * [#24400] A bound top-level action whose target object no package has
 * registered — see {@link SchemaRegistry.findUnboundActionTargets}.
 */
export interface UnboundActionTarget {
  /** The action's `name`. */
  action: string;
  /** The object its `objectName` names. */
  objectName: string;
  /** The package that ships the action. */
  packageId: string | undefined;
}

/** The boot refusal's error: the `INVALID_METADATA` envelope (ADR-0112) the picklist refusal also answers. */
export interface UnboundActionTargetError extends Error {
  code: 'INVALID_METADATA';
  status: 422;
  httpStatus: 422;
}

/**
 * [#24400] The refusal for bound top-level actions whose target object no
 * loaded package registers — every one of them, so an author fixes the set in
 * one pass. `undefined` when there are none.
 *
 * Refused rather than dropped: such an action registers, is listed on no
 * object, and no client renders it — the silent drop the extension guidance
 * would otherwise lead an author into.
 */
export function describeUnboundActionTargets(
  unbound: readonly UnboundActionTarget[],
): UnboundActionTargetError | undefined {
  if (unbound.length === 0) return undefined;
  const lines = unbound.map(
    (u) => `action '${u.action}' (${u.packageId ? `package '${u.packageId}'` : 'a registration with no package'}) `
      + `is bound to object '${u.objectName}'`,
  );
  const err = new Error(
    `${lines.length === 1 ? 'A top-level action is' : `${lines.length} top-level actions are`} bound by `
    + `\`objectName\` to an object that no loaded package registers: ${lines.join('; ')}. A bound action `
    + 'is attached to its object when the object is served, so with no such object it would be listed '
    + 'nowhere. Register the object (in the package or in one it depends on), or correct the '
    + '`objectName`.',
  ) as UnboundActionTargetError;
  err.code = 'INVALID_METADATA';
  err.status = 422;
  err.httpStatus = 422;
  return err;
}

/**
 * [#25649] The refusal of a code package's `action` that does not satisfy
 * `ActionSchema` — the `INVALID_METADATA` envelope (ADR-0112) the unbound-target
 * refusal above answers, with `issues[]` locating each failure.
 */
interface PackageActionSchemaError extends Error {
  code: 'INVALID_METADATA';
  status: 422;
  httpStatus: 422;
  issues: Array<{ path: string; message: string; code: string }>;
}

/**
 * [#25649] A code package's `action` item, as its `ActionSchema` parse — the
 * body {@link SchemaRegistry.registerItem} stores — or the loud refusal of one
 * that does not parse.
 *
 * Why the stored item has to BE the parse: `ActionSchema` is not only a judge,
 * it is a producer. Its transform lowers `requiresMembershipReach` and
 * `requiresFeature` into the CEL `visible` predicate and deletes the two keys,
 * and nothing downstream reads either key raw — so an action stored as authored
 * carries both gates declared and inert. A platform object's actions are parsed
 * where they are authored (`ObjectSchema.create`), and a strict `defineStack`
 * parses a stack's actions; a programmatic `registerApp`, a nested plugin's
 * manifest, a `strict: false` stack or a raw plugin manifest reached this store
 * with no parse at all, and {@link SchemaRegistry.attachBoundActions} served
 * what it found. Parsing at this seam, once, means every reader — the bound
 * attachment, the router's rung 2, `GET /meta/action` — holds the one parsed
 * body, by reference.
 *
 * The parse is idempotent over its own output (a lowered action carries no
 * `requiresFeature` left to lower), so an action a strict `defineStack` already
 * parsed is stored deep-equal to what it arrived as. Besides the lowering, the
 * parse fills the schema's defaults (`type`, `refreshAfter`, …), turns a
 * CEL-string shorthand into its `{ dialect, source }` envelope, and refuses an
 * undeclared key; the ADR-0010 envelope (`_packageId`, `_packageVersion`,
 * `_provenance`, `_lock`) is declared on the schema and passes through.
 *
 * Refused rather than stored unparsed: an action that fails the parse would be
 * served with whatever gates it declares never taking effect, and `defineStack`
 * and `os validate` refuse the same declaration at authoring time.
 *
 * [#25744] The one parse for both places a code package declares an action:
 * a standalone `action` item ({@link SchemaRegistry.registerItem}) and an
 * object's own `actions` ({@link parsePackageObjectActions}, called by
 * {@link SchemaRegistry.registerObject}). `owner` names the object an own
 * action is declared on, so the refusal says which object and `issues[]`
 * locates each failure inside its body.
 */
function parsePackageAction(
  item: unknown,
  name: string,
  packageId: string,
  owner?: { object: string; index: number },
): unknown {
  const parsed = ActionSchema.safeParse(item);
  if (parsed.success) return parsed.data;
  // [#25744] An object's own action is located inside the object body it was
  // declared in (`actions.<index>.<key>`), the path `ObjectSchema` reports.
  const prefix = owner ? ['actions', String(owner.index)] : [];
  const issues = parsed.error.issues.map((issue) => ({
    path: [...prefix, ...issue.path.map(String)].join('.'),
    message: issue.message,
    code: issue.code,
  }));
  const subject = owner
    ? `Action '${name}' of object '${owner.object}' in package '${packageId}'`
    : `Action '${name}' of package '${packageId}'`;
  const err = new Error(
    `${subject} does not satisfy the action contract (ActionSchema): `
    + issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join('; ')
    + '. Every action a package ships is stored as its schema parse — the parse that lowers '
    + '`requiresFeature` and `requiresMembershipReach` into `visible` — so an action that does not parse '
    + 'is refused rather than served with its declared gates inert. Correct the declaration; `defineStack` '
    + 'and `os validate` report the same issues.',
  ) as PackageActionSchemaError;
  err.code = 'INVALID_METADATA';
  err.status = 422;
  err.httpStatus = 422;
  err.issues = issues;
  throw err;
}

/**
 * [#25744] A code package's object, its own `actions` stored as their
 * `ActionSchema` parse ({@link parsePackageAction}) — or the loud refusal of
 * the first one that does not parse.
 *
 * The object-path twin of {@link SchemaRegistry.registerItem}'s action parse.
 * `ObjectSchema`'s `actions` is `ActionSchema[]`, so a platform object
 * (`ObjectSchema.create`) and a strict `defineStack` already hand this method
 * parsed actions, and the parse being idempotent over its own output stores
 * them deep-equal to what arrived. A raw manifest, a `strict: false` stack or a
 * programmatic `registerApp` reached the store with its objects' actions as
 * written, so a declared `requiresFeature` / `requiresMembershipReach` was
 * served raw, never lowered into `visible`.
 *
 * Returns `schema` by reference when it declares no `actions` array, and a
 * shallow copy carrying the parsed array otherwise: the caller's body is
 * never mutated.
 */
function parsePackageObjectActions(schema: ServiceObject, packageId: string): ServiceObject {
  const actions = (schema as { actions?: unknown }).actions;
  if (!Array.isArray(actions) || actions.length === 0) return schema;
  const parsed = actions.map((action, index) => {
    const declared = (action as { name?: unknown } | null | undefined)?.name;
    const name = typeof declared === 'string' && declared !== '' ? declared : `#${index}`;
    return parsePackageAction(action, name, packageId, { object: schema.name, index });
  });
  return { ...schema, actions: parsed } as ServiceObject;
}

/**
 * [#24472] The key {@link SchemaRegistry}'s bound-action collision audit is
 * carried under. A symbol, and ⛔ deliberately NOT re-exported from the package
 * entry (`index.ts`, `core.ts`), so the audit is no NAMEABLE member of the
 * registry's published face: only the ObjectQL plugin's boot and late-artifact
 * reports reach it, importing the key from this module.
 */
export const FIND_BOUND_ACTION_COLLISIONS: unique symbol = Symbol('objectstack.objectql.findBoundActionCollisions');

/**
 * [#24472] A bound top-level action that its target object does NOT list,
 * because the object already lists a DIFFERENT declaration under the same
 * name — see {@link FIND_BOUND_ACTION_COLLISIONS}.
 */
export interface BoundActionCollision {
  /** The object both declarations are for. */
  objectName: string;
  /** The action name they share. */
  action: string;
  /** The package whose declaration the object serves — its owner, for the object's own action. */
  servedPackageId: string | undefined;
  /** The package whose bound declaration the object does not list. */
  shadowedPackageId: string | undefined;
}

const describePackage = (packageId: string | undefined): string =>
  packageId ? `package '${packageId}'` : 'a registration with no package';

/**
 * [#24472] The author-visible warning for one {@link BoundActionCollision}.
 * Reported, never refused: a refusal would be a narrowing, and the decision
 * for this collision is to report it first.
 */
export function describeBoundActionCollision(collision: BoundActionCollision): string {
  const { objectName, action, servedPackageId, shadowedPackageId } = collision;
  return `Action '${action}' on object '${objectName}' is declared twice, and the two declarations differ: `
    + `${describePackage(servedPackageId)} declares the one the object serves, and `
    + `${describePackage(shadowedPackageId)} binds another by \`objectName\`, which the object does not list. `
    + `Both register their handler under the one key '${objectName}:${action}', so when both carry one, the `
    + 'handler that runs is whichever package registered last — not necessarily the declaration the object '
    + 'lists. Rename one of the two actions, or drop the duplicate declaration.';
}

/**
 * Keys that say where an action declaration came from or where it sits, not
 * what it declares: the registry's stamps (`_packageId`, `_provenance`, the
 * `_lock` envelope…), the `protection` block those stamps translate, and
 * `objectName`, which an object's own action leaves to its position.
 */
const isActionProvenanceKey = (key: string): boolean =>
  key.startsWith('_') || key === 'protection' || key === 'objectName';

/**
 * [#24472] Are two action declarations the SAME declaration — one carried
 * twice (a same-stack merge's copy beside the top-level item, one declaration
 * shipped by two packages, a copy re-bridged under another package's stamp)?
 * Structural equality minus {@link isActionProvenanceKey} keys at the top
 * level; a key set to `undefined` reads as absent, callables compare by
 * reference, and past depth 32 the answer is "different" — the reported side.
 */
function sameActionDeclaration(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (depth >= 32 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((item, i) => sameActionDeclaration(item, other[i], depth + 1));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keysOf = (o: Record<string, unknown>) =>
    Object.keys(o).filter((k) => o[k] !== undefined && (depth > 0 || !isActionProvenanceKey(k)));
  const leftKeys = keysOf(left);
  return leftKeys.length === keysOf(right).length
    && leftKeys.every((k) => right[k] !== undefined && sameActionDeclaration(left[k], right[k], depth + 1));
}

/** A manifest and its nested `plugins[]`, which register under its package (`registerPlugin`). */
function manifestAndNestedPlugins(manifest: any): any[] {
  const plugins = Array.isArray(manifest?.plugins)
    ? manifest.plugins.filter((p: unknown) => p !== null && typeof p === 'object')
    : [];
  return [manifest, ...plugins];
}

/**
 * [#24400] The bound top-level actions one manifest brings — its own
 * `actions` and its nested plugins', each with the object it is bound to —
 * read BEFORE the manifest registers, by the post-boot install door.
 */
export function collectManifestBoundActions(manifest: any, packageId: string | undefined): UnboundActionTarget[] {
  const out: UnboundActionTarget[] = [];
  for (const source of manifestAndNestedPlugins(manifest)) {
    for (const action of Array.isArray(source?.actions) ? source.actions : []) {
      if (!action || typeof action !== 'object' || typeof action.name !== 'string') continue;
      const objectName = standaloneActionOwnerKey(action);
      if (isObjectLessActionKey(objectName)) continue;
      out.push({ action: action.name, objectName, packageId });
    }
  }
  return out;
}

/** [#24400] The object names one manifest declares, nested plugins included, in either authored spelling. */
export function collectManifestObjectNames(manifest: any): string[] {
  const names: string[] = [];
  for (const source of manifestAndNestedPlugins(manifest)) {
    const objects = source?.objects;
    if (Array.isArray(objects)) {
      for (const o of objects) if (typeof o?.name === 'string') names.push(o.name);
    } else if (objects && typeof objects === 'object') {
      names.push(...Object.keys(objects));
    }
  }
  return names;
}

/**
 * Stable sort by `order` (unset reads as `0`), by reference when no action
 * sets one — the rule `defineStack()` applies to each object's merged actions
 * (`sortActionsByOrder` in `@objectstack/spec`'s stack builder, which is
 * internal there), applied here to the attached actions among themselves.
 */
function sortActionsByOrder<T extends { order?: number }>(actions: T[]): T[] {
  if (!actions.some((a) => a?.order !== undefined)) return actions;
  return actions.slice().sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
}

/**
 * Reserved namespaces that do not get FQN prefix applied.
 * Objects in these namespaces keep their short names (e.g., "user" — short name IS the canonical key).
 */
export const RESERVED_NAMESPACES = new Set(['base', 'system']);

/**
 * Default priorities for the three contributor kinds.
 *
 * [ADR-0029 D9.3] `DEFAULT_OVERLAY_PRIORITY` sits BETWEEN the owner and the
 * extenders so a `getObjectContributors()` read lists the stack in layer
 * order. It is ORDERING ONLY: {@link SchemaRegistry.resolveObject} selects its
 * base layer by KIND, never by "highest priority wins" — extender priority is
 * author-declared (`ext.priority ?? 200` in the `objectExtensions` loop), so a
 * package could otherwise re-rank a tenant's overlay out of the base slot by
 * declaring `priority: 140`. Declared numbers order PEERS; they must not be
 * able to change WHICH LAYER IS THE BASE.
 */
export const DEFAULT_OWNER_PRIORITY = 100;
export const DEFAULT_OVERLAY_PRIORITY = 150;
export const DEFAULT_EXTENDER_PRIORITY = 200;

/**
 * Contributor Record
 * Tracks how a package contributes to an object.
 *
 * Three kinds (ADR-0029 D9):
 *
 * - `own` — the single owning package. Defines the base schema, the table and
 *   the namespace claim. Exactly one per object name, unconditionally
 *   ({@link SchemaRegistry.assertSingleOwnerPerObject}).
 * - `overlay` — [D9.1] a TENANT customization layer over the owner's
 *   definition, hydrated from a `sys_metadata` row. It REPLACES the base layer
 *   at resolution time (D9.2) and owns nothing: it claims no namespace,
 *   decides no package membership, holds no table. That is why the
 *   single-owner assertion needs no "unless it is an overlay" clause — which
 *   matters beyond tidiness, since ADR-0028 D5/D6 rest on that sentence being
 *   unconditional. `ownership: 'overlay'` is LOADER-SET at the hydration seams
 *   and reachable from no authoring surface.
 * - `extend` — additive contributions from other packages, folded on top of
 *   whichever layer is the base.
 */
export interface ObjectContributor {
  // Optional (#12623): `registerObject`'s own `packageId` parameter is now
  // optional, and this is the exact value it was called with — a bare
  // `registerObject(schema)` call stores `undefined` here, matching the
  // runtime behavior every call site without a tsc test-layer gate already
  // exercised (JS does not enforce TS arity).
  packageId: string | undefined;
  namespace: string;
  ownership: ObjectOwnership;
  priority: number;
  definition: ServiceObject;
}

/**
 * Compute canonical registry key for an object.
 *
 * Under the current naming convention, object names are canonical identifiers
 * and are used as-is (no namespace__ prefix). The namespace parameter is
 * retained for backward compatibility but no longer affects the returned key.
 *
 * @param namespace - The package namespace (unused, kept for API compatibility)
 * @param shortName - The object's name (already the canonical identifier)
 * @returns The object name unchanged
 *
 * @example
 * computeFQN('crm', 'account')  // => 'account'
 * computeFQN(undefined, 'task') // => 'task'
 */
export function computeFQN(_namespace: string | undefined, shortName: string): string {
  return shortName;
}

/**
 * Parse FQN back to namespace and short name.
 * 
 * @param fqn - Object name (e.g., "account" or legacy "crm__account" for backward compat)
 * @returns { namespace, shortName } - namespace is undefined for unprefixed names
 */
export function parseFQN(fqn: string): { namespace: string | undefined; shortName: string } {
  const idx = fqn.indexOf('__');
  if (idx === -1) {
    return { namespace: undefined, shortName: fqn };
  }
  return {
    namespace: fqn.slice(0, idx),
    shortName: fqn.slice(idx + 2),
  };
}

/**
 * The SCALAR props {@link mergeObjectDefinitions} resolves last-writer-wins
 * — the three string scalars the #8284 ruling and ADR-0029 D9.2a both cover,
 * which {@link scalarOverridesPackagedBase} answers for, and [#36366]
 * `pinnedActions`, the object's header buttons per page type, which
 * {@link foldScalarOverridesPackagedBase} answers for by its structure.
 */
const OBJECT_FOLD_SCALAR_KEYS = ['label', 'pluralLabel', 'description', 'pinnedActions'] as const;

type ObjectFoldScalarKey = (typeof OBJECT_FOLD_SCALAR_KEYS)[number];

/** [#36366] A `pinnedActions` value as one comparable string (its two arms, in order), or `null` when it pins nothing. */
function pinnedActionsKey(value: unknown): string | null {
  if (!isPlainRecord(value)) return null;
  const list = Array.isArray(value.list) ? value.list : null;
  const record = Array.isArray(value.record) ? value.record : null;
  return list === null && record === null ? null : JSON.stringify([list, record]);
}

/**
 * [ADR-0029 D9.2a] Whether the fold's base carries `value` for the scalar
 * `key` authored away from the packaged owner's. The string scalars ask
 * {@link scalarOverridesPackagedBase}, the one comparison both layers share.
 * [#36366] `pinnedActions` is not a string, so that predicate answers `false`
 * for it whatever the base holds; it asks the same question by structure,
 * with the predicate's three conservative edges: no owner document → `false`,
 * a value that pins nothing → `false`, and equality is exact (both arms, in
 * order).
 */
function foldScalarOverridesPackagedBase(owner: unknown, key: ObjectFoldScalarKey, value: unknown): boolean {
  if (key !== 'pinnedActions') return scalarOverridesPackagedBase(owner, key, value);
  if (!isPlainRecord(owner)) return false;
  const authored = pinnedActionsKey(value);
  return authored !== null && authored !== pinnedActionsKey(owner.pinnedActions);
}

/**
 * [ADR-0146 D10, second rule] An object extension's per-field display patches:
 * the slot `ObjectExtensionSchema.fieldPatches` declares, carried onto the
 * extension def by the manifest loop (`engine.ts`) and applied by
 * {@link mergeObjectDefinitions}. ⛔ No second shape: the type IS the spec's,
 * and the keys applied are read from `BASE_FIELD_DISPLAY_WHITELIST`, so a
 * widened whitelist widens what the merge applies too.
 */
type ObjectFieldPatches = NonNullable<ObjectExtensionParsed['fieldPatches']>;

/** An `extend` contributor's body: a partial object that may carry {@link ObjectFieldPatches}. */
type ObjectExtensionBody = Partial<ServiceObject> & { fieldPatches?: ObjectFieldPatches };

/** [#28835] One extension's `fields` as the fold merged them, with the package that declared them. */
type FoldedExtensionFields = { packageId: string | undefined; fields: unknown };

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The address of one patched display key in a fold's D9.2a yield set
 * ({@link SchemaRegistry.tenantPatchedDisplayKeys}): a field key, or one key of
 * the option addressed by its stored value.
 */
function fieldPatchYieldKey(field: string, key: string, option?: string): string {
  return option === undefined ? `${field}\u0000${key}` : `${field}\u0000options\u0000${option}\u0000${key}`;
}

/** A picklist item as the registry stores it: the two keys the merge reads. */
type PicklistItemLike = { options?: PicklistOptionLike[]; _packageId?: string };

/**
 * [ADR-0150 D3, child E6] Who wrote one field's picklist reference: every
 * package whose own layer declares it, in fold order, or `[null]` — one caller
 * with no package — when no packaged layer does.
 */
type PicklistReferrer = (field: string | undefined, picklist: string) => readonly (string | null)[];

/** Every reference is the environment's: a body no packaged layer declares. */
const NO_PACKAGE_REFERRER: PicklistReferrer = () => [null];

/** Are two package-scoped holders the same one? */
function sameHolder(a: PackageScopedHolder, b: PackageScopedHolder): boolean {
  if (a.kind === 'package') return b.kind === 'package' && a.packageId === b.packageId;
  return a.kind === b.kind;
}

/** The `picklist` a body's field declares (name-keyed or array-spelled), when it declares one. */
function declaredPicklistOf(body: unknown, field: string): string | undefined {
  const fields = isPlainRecord(body) ? body.fields : undefined;
  let declared: unknown;
  if (Array.isArray(fields)) {
    declared = fields.find((f) => isPlainRecord(f) && f.name === field);
  } else if (isPlainRecord(fields) && Object.prototype.hasOwnProperty.call(fields, field)) {
    declared = fields[field];
  }
  const picklist = isPlainRecord(declared) ? declared.picklist : undefined;
  return typeof picklist === 'string' && picklist !== '' ? picklist : undefined;
}

/**
 * [ADR-0150 D3, child E6] The referrers of each picklist reference a served
 * body carries, read from the contributors that fold into it: EVERY packaged
 * layer (the owner, then each extension) whose own declaration names that same
 * list on that field, each package once. Several layers can write one
 * reference; none of them is picked over the others (epic seat review on
 * #31731): the field is served a list only when every one of them reaches the
 * same holder ({@link SchemaRegistry.resolvePicklistFields}). A reference no
 * packaged layer writes came from an environment-authored body — a tenant
 * overlay, a stored row, an object created in this environment — and resolves
 * as the environment's (`null`), never from the package that body customizes
 * (D3).
 */
function picklistReferrerOf(contributors: readonly ObjectContributor[] | undefined): PicklistReferrer {
  if (!contributors || contributors.length === 0) return NO_PACKAGE_REFERRER;
  const packaged = [
    ...contributors.filter((c) => c.ownership === 'own'),
    ...contributors.filter((c) => c.ownership === 'extend'),
  ].filter((c) => !isTenantAuthored(c.definition));
  return (field, picklist) => {
    if (field === undefined) return [null];
    const referrers = new Set<string | null>();
    for (const c of packaged) {
      if (declaredPicklistOf(c.definition, field) === picklist) referrers.add(c.packageId ?? null);
    }
    return referrers.size > 0 ? [...referrers] : [null];
  };
}

/** A field of an object body's name-keyed `fields`, when it is a record. */
function recordFieldOf(body: unknown, name: string): Record<string, unknown> | undefined {
  const fields = isPlainRecord(body) ? body.fields : undefined;
  if (!isPlainRecord(fields) || !Object.prototype.hasOwnProperty.call(fields, name)) return undefined;
  const field = fields[name];
  return isPlainRecord(field) ? field : undefined;
}

/**
 * [ADR-0146 D10, second rule] The fields a field patch reaches: the names the
 * `own` contributor's declaration carries in the name-keyed `fields` the merge
 * reads — "the target object's own fields", as `ObjectExtensionSchema.fieldPatches`
 * publishes it. A field an extension adds is never one of them, whatever the
 * priorities, and neither is an array-spelled entry: the merge, the patch and
 * the miss report all read the record spelling, so they cannot disagree.
 * The declaration is the one the registry stores, so the platform columns
 * {@link applySystemFields} injects at registration (`created_at` and the
 * rest) are among these names: the fold and the install door
 * (`getObjectOwner`) admit a patch of one, while `os validate`, which judges
 * the authored declaration, refuses it.
 * `undefined` when no owner is registered — no opinion, as
 * {@link SchemaRegistry.tenantPatchedDisplayKeys} has none there either.
 */
function ownFieldNamesOf(owner: unknown): ReadonlySet<string> | undefined {
  if (owner === undefined) return undefined;
  const fields = isPlainRecord(owner) ? owner.fields : undefined;
  return new Set(isPlainRecord(fields) ? Object.keys(fields).filter((name) => isPlainRecord(fields[name])) : []);
}

/**
 * [ADR-0146 D10, second rule; #28809] What a field patch is judged against in
 * the fold: the owner's declaration (`owner`) with only the fields of
 * `ownFields` the fold carries at that point in the record spelling
 * (`carried`) — which fields a patch reaches is the owner's own, unchanged —
 * each field AS THE OWNER DECLARES IT, never as an extension's `fields`
 * redeclared it. The install door (`getObjectOwner(name).definition`) and
 * `os validate` (the declared object) cannot see another package's extension,
 * so the owner's own field and options are the one answer all three readers
 * share: an option an extension adds by taking the field over through `fields`
 * is not one a patch can name.
 */
function ownFieldsTarget(
  owner: unknown,
  ownFields: ReadonlySet<string>,
  carried: (name: string) => boolean,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const name of ownFields) {
    const field = recordFieldOf(owner, name);
    if (field && carried(name)) fields[name] = field;
  }
  return { ...(isPlainRecord(owner) ? owner : {}), fields };
}

/** The option of a field's own `options` whose stored `value` is `value`. */
function optionByValue(field: Record<string, unknown>, value: string): Record<string, unknown> | undefined {
  const options = field.options;
  if (!Array.isArray(options)) return undefined;
  const found = options.find((o) => isPlainRecord(o) && o.value === value);
  return isPlainRecord(found) ? found : undefined;
}

/**
 * [ADR-0029 D9.2a] The scalar yield's comparison, asked of one display key of a
 * field or of one of its options. It IS {@link scalarOverridesPackagedBase} —
 * the one comparison behind every D9.2a yield, keyed by any attribute (its own
 * docblock: the exported key union names the keys its callers ask about, and
 * the implementation underneath reads any) — ⛔ never a second copy of it.
 */
function displayKeyOverridesPackagedBase(packaged: unknown, key: string, value: unknown): boolean {
  return scalarOverridesPackagedBase(packaged, key as Parameters<typeof scalarOverridesPackagedBase>[1], value);
}

/**
 * [ADR-0146 D10, second rule] One base field with an extension's patch applied:
 * the whitelisted field keys, then each option the patch addresses by its
 * stored `value`. A key the tenant authored on the fold's base yields
 * (`tenantPatched`, ADR-0029 D9.2a). Returns `field` BY REFERENCE when nothing
 * applies.
 *
 * A field bound to a picklist is left alone under `options`: the served options
 * are the picklist's, written over the field after the fold
 * ({@link SchemaRegistry.finishServedObject}), so an option label written here
 * would never be served. The target check names that patch instead.
 */
function patchedField(
  name: string,
  field: Record<string, unknown>,
  patch: ObjectFieldPatches[string],
  tenantPatched: ReadonlySet<string> | undefined,
): Record<string, unknown> {
  let next: Record<string, unknown> | undefined;
  const patchKeys = patch as Record<string, unknown>;
  for (const key of BASE_FIELD_DISPLAY_WHITELIST.field) {
    const value = patchKeys[key];
    if (value === undefined || tenantPatched?.has(fieldPatchYieldKey(name, key))) continue;
    (next ??= { ...field })[key] = value;
  }
  const optionPatches = patch.options;
  const options = field.options;
  const picklistBound = typeof field.picklist === 'string' && field.picklist !== '';
  if (optionPatches && Array.isArray(options) && !picklistBound) {
    let patchedOptions: unknown[] | undefined;
    options.forEach((option, index) => {
      if (!isPlainRecord(option) || typeof option.value !== 'string') return;
      if (!Object.prototype.hasOwnProperty.call(optionPatches, option.value)) return;
      const optionPatch = optionPatches[option.value] as Record<string, unknown> | undefined;
      if (!optionPatch) return;
      let patchedOption: Record<string, unknown> | undefined;
      for (const key of BASE_FIELD_DISPLAY_WHITELIST.option) {
        const value = optionPatch[key];
        if (value === undefined || tenantPatched?.has(fieldPatchYieldKey(name, key, option.value))) continue;
        (patchedOption ??= { ...option })[key] = value;
      }
      if (patchedOption) (patchedOptions ??= [...options])[index] = patchedOption;
    });
    if (patchedOptions) (next ??= { ...field }).options = patchedOptions;
  }
  return next ?? field;
}

/**
 * [ADR-0146 D10, second rule] `fields` with every patch of `patches` applied
 * that names one of the owner's own fields (`ownFields`, {@link ownFieldNamesOf})
 * present in `fields`. A patch naming any other field — one the object lacks,
 * or one only an extension adds — is skipped here, and named by the fold
 * ({@link SchemaRegistry.reportFieldPatchMisses}). Nothing applies when no
 * owner is registered. Returns `fields` BY REFERENCE when nothing applies.
 *
 * [#28809] The fold hands this only the patches the judge admitted against the
 * owner's declaration ({@link admittedFieldPatches}). An admitted option patch
 * whose option an earlier layer left out (an extension's `fields`
 * redeclaration, a tenant overlay base) finds no option here, so nothing of it
 * applies; the fold names it after the merge, by the same judge asked of the
 * merged fields.
 */
function applyFieldPatches(
  fields: ServiceObject['fields'],
  patches: ObjectFieldPatches,
  tenantPatched: ReadonlySet<string> | undefined,
  ownFields: ReadonlySet<string> | undefined,
): ServiceObject['fields'] {
  if (!isPlainRecord(fields) || !ownFields) return fields;
  let out: Record<string, unknown> | undefined;
  for (const [name, patch] of Object.entries(patches)) {
    if (!patch || !ownFields.has(name)) continue;
    const field = recordFieldOf({ fields: out ?? fields }, name);
    if (!field) continue;
    const next = patchedField(name, field, patch, tenantPatched);
    if (next !== field) (out ??= { ...fields })[name] = next;
  }
  return (out ?? fields) as ServiceObject['fields'];
}

/**
 * [ADR-0146 D10, second rule; #28809] `patches` without what the judge missed
 * against the owner's declaration: a missed field's whole patch, a missed
 * option's entry under `options`. The fold applies exactly what the install
 * door and `os validate` admit, and names exactly what they refuse. Returns
 * `patches` BY REFERENCE when nothing was missed.
 */
function admittedFieldPatches(
  patches: ObjectFieldPatches,
  misses: readonly FieldPatchTargetMiss[],
): ObjectFieldPatches {
  if (misses.length === 0) return patches;
  const out: Record<string, ObjectFieldPatches[string]> = { ...patches };
  for (const miss of misses) {
    const patch = out[miss.field];
    if (!patch) continue;
    if (miss.option === undefined) {
      delete out[miss.field];
      continue;
    }
    if (!patch.options) continue;
    const { [miss.option]: _missed, ...options } = patch.options;
    out[miss.field] = { ...patch, options };
  }
  return out as ObjectFieldPatches;
}

/**
 * [#28356] Which layer an object fold serves: `'served'`, what every read
 * answers (the bound actions the registry serves, runtime-authored included),
 * or `'code'`, the code-layer resolution {@link SchemaRegistry.getArtifactItem}
 * answers (the code packages' bound actions alone).
 */
type ServedObjectLayer = 'served' | 'code';

/**
 * [#29903, #29872] The options that leave `extend` contributions out of an
 * object fold ({@link SchemaRegistry.getAllObjects}, `listItems`,
 * `foldObjectExtendersOnto`):
 *
 *  - `withoutExtensionsOf` — that package's contributions are left out;
 *  - `onlyExtensionsOf` — every OTHER package's contributions are left out,
 *    so only that package's own extensions fold. The protocol's per-package
 *    layer passes it, naming the listed package.
 *
 * Both may be given; a contribution either one leaves out is left out. The
 * base layer (`own` / `overlay`) is never left out.
 *
 * [#30756] `asEnabled` asks the opposite question of a DISABLED package: the
 * fold as it will serve once that package is enabled, its `extend`
 * contributions folded in instead of withheld ({@link SchemaRegistry.withholdDisabledExtensions}).
 * Every other disabled package's stay withheld. The enable door's pre-check
 * reads it, as the disable door's reads `withoutExtensionsOf`; for a package
 * that is not disabled it changes nothing.
 *
 * [#34901] `includeDisabledExtensions` is `asEnabled` for EVERY disabled
 * package at once: no `extend` contribution is withheld, so the fold is the
 * one the storage layer keeps ({@link SchemaRegistry.getStorageObject}). The
 * runtime authoring gate reads it on a `view` write ONLY (and a served view's
 * lint reads the same fold), so a field a disabled package adds is judged a
 * real, stored field rather than an unknown one wherever the view names it (a
 * column, a sort, a filter, a grouping level, a searchable field or a form
 * section): the view the owner ships keeps naming it, and re-enabling the
 * package serves it again with no write. A name no contributor declares is
 * unknown either way.
 */
export interface ObjectExtensionFoldOptions {
  withoutExtensionsOf?: string;
  onlyExtensionsOf?: string;
  asEnabled?: string;
  includeDisabledExtensions?: true;
}

/** Whether `options` leaves any contribution out (otherwise the fold is the ordinary one). */
function leavesExtensionsOut(options: ObjectExtensionFoldOptions | undefined): options is ObjectExtensionFoldOptions {
  return options?.withoutExtensionsOf !== undefined || options?.onlyExtensionsOf !== undefined;
}

/** [#29903, #29872] Whether `options` leaves `contributor` out of the fold. */
function isLeftOutExtension(contributor: ObjectContributor, options: ObjectExtensionFoldOptions): boolean {
  if (contributor.ownership !== 'extend') return false;
  if (options.withoutExtensionsOf !== undefined && contributor.packageId === options.withoutExtensionsOf) return true;
  return options.onlyExtensionsOf !== undefined && contributor.packageId !== options.onlyExtensionsOf;
}

/**
 * The `extend` contributions a disable withholds from a served fold, and the
 * member names only they add ({@link SchemaRegistry.withholdDisabledExtensions}).
 */
interface WithheldExtensions {
  kept: ObjectContributor[];
  withheldFields: ReadonlySet<string>;
  withheldRules: ReadonlySet<string>;
  /** Each withheld index by its structural key ({@link indexKeysOf}). */
  withheldIndexes: ReadonlySet<string>;
}

/** The field names a body declares in the record spelling the merge reads. */
function fieldNamesOf(body: unknown): string[] {
  const fields = isPlainRecord(body) ? body.fields : undefined;
  return isPlainRecord(fields) ? Object.keys(fields) : [];
}

/** The validation rule names a body declares. */
function ruleNamesOf(body: unknown): string[] {
  const rules = isPlainRecord(body) ? body.validations : undefined;
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule) => (isPlainRecord(rule) ? rule.name : undefined))
    .filter((name): name is string => typeof name === 'string' && name !== '');
}

/** The indexes a body declares, each by its structural key (the key the fold's index subtraction compares by). */
function indexKeysOf(body: unknown): string[] {
  const indexes = isPlainRecord(body) ? body.indexes : undefined;
  return Array.isArray(indexes) ? indexes.map((index) => stableStringify(index)) : [];
}

/**
 * `base` without the fields, rules and indexes a withheld extension alone adds. By
 * reference when it carries none of them, which is the ordinary case (a base
 * that was never folded).
 */
function withoutWithheldMembers(base: ServiceObject, withheld: WithheldExtensions): ServiceObject {
  const fields = isPlainRecord((base as { fields?: unknown }).fields) ? (base as { fields: Record<string, unknown> }).fields : undefined;
  const rules = (base as { validations?: unknown }).validations;
  const dropFields = fields !== undefined && Object.keys(fields).some((name) => withheld.withheldFields.has(name));
  const dropRules = Array.isArray(rules)
    && rules.some((rule) => isPlainRecord(rule) && typeof rule.name === 'string' && withheld.withheldRules.has(rule.name));
  const indexes = (base as { indexes?: unknown }).indexes;
  const dropIndexes = Array.isArray(indexes) && indexes.some((index) => withheld.withheldIndexes.has(stableStringify(index)));
  if (!dropFields && !dropRules && !dropIndexes) return base;
  const out = { ...base } as ServiceObject & Record<string, unknown>;
  if (dropFields) {
    out.fields = Object.fromEntries(Object.entries(fields!).filter(([name]) => !withheld.withheldFields.has(name))) as ServiceObject['fields'];
  }
  if (dropRules) {
    out.validations = (rules as unknown[]).filter(
      (rule) => !(isPlainRecord(rule) && typeof rule.name === 'string' && withheld.withheldRules.has(rule.name)),
    ) as ServiceObject['validations'];
  }
  if (dropIndexes) {
    out.indexes = (indexes as unknown[]).filter((index) => !withheld.withheldIndexes.has(stableStringify(index))) as ServiceObject['indexes'];
  }
  return out;
}

/**
 * [ADR-0029 D9.2a, #27559's rule-name principle carried to field names] The
 * fields the CODE `extend` contributors of an object add — every field name
 * the owner does not declare — in fold order, so a later extender's
 * declaration of one name replaces an earlier one's, as
 * {@link mergeObjectDefinitions} does. The same filter as
 * `SchemaRegistry.packagedRules` (`ownership === 'extend'` and a code artifact
 * body), so a tenant overlay and any extension of tenant provenance
 * (`_provenance: 'org'`) contribute nothing, while a stored extension row
 * of package provenance is a code layer and does. `contributors` is the
 * caller's: {@link SchemaRegistry.getPackagedObjectBase} hands in the list
 * without a disabled package's extensions, as the served fold withholds them
 * ({@link SchemaRegistry.withholdDisabledExtensions}), so the base and the
 * served field are the same extender's. `fieldPatches` are not read.
 * `undefined` when no code extender adds a field, or the owner's `fields` is
 * not the canonical record.
 */
function packagedAddedFields(
  owner: ServiceObject,
  contributors: readonly ObjectContributor[],
): Record<string, unknown> | undefined {
  const ownFields = owner.fields as unknown;
  if (ownFields !== undefined && (ownFields === null || typeof ownFields !== 'object' || Array.isArray(ownFields))) {
    return undefined;
  }
  const declared = (ownFields ?? {}) as Record<string, unknown>;
  let added: Record<string, unknown> | undefined;
  for (const contrib of contributors) {
    if (contrib.ownership !== 'extend' || !isCodeArtifactBody(contrib.definition)) continue;
    const fields = contrib.definition.fields as unknown;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
    for (const [name, def] of Object.entries(fields as Record<string, unknown>)) {
      if (Object.prototype.hasOwnProperty.call(declared, name)) continue;
      (added ??= {})[name] = def;
    }
  }
  return added;
}

/**
 * [#8027] Key-order-insensitive JSON, for comparing two `indexes` entries, or
 * two validation rules' keys, BY VALUE — see
 * {@link SchemaRegistry.subtractExtenderContributions} and
 * {@link changedPackagedRuleKeys}.
 *
 * Plain `JSON.stringify` would report the same rule as two different rules
 * whenever the two copies were built by different code paths (a stored overlay
 * row that went through `JSON.parse` vs the contributor's in-memory literal),
 * which is exactly the pair being compared, so key order cannot be assumed.
 * Arrays keep their order — an index's `fields` list is ordered and two
 * spellings of it are genuinely two different indexes.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * [ADR-0029 D9.2a, 2026-10-30 note] What a tenant's same-named copy of a
 * packaged validation rule may set: its sentence and its switch. Every other key
 * a rule carries — `type`, `condition` and each variant's own predicate keys,
 * `events`, `severity`, `priority`, and the editor keys — is the package's.
 */
type TenantRuleSettings = { message?: string; active?: boolean };

/** A rule's `name` when it has one; a rule without a string name has no identity to merge by and is always additive. */
function validationRuleName(rule: unknown): string | undefined {
  const name = (rule as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/**
 * The tenant settings a base layer's rules carry, keyed by rule name — the
 * first copy of a name wins, so a stored row that predates the by-name fold
 * (the tenant's reworded copy, then the extension's original appended after
 * it) still answers with the tenant's sentence.
 */
function tenantRuleSettingsOf(rules: unknown): Map<string, TenantRuleSettings> {
  const out = new Map<string, TenantRuleSettings>();
  if (!Array.isArray(rules)) return out;
  for (const rule of rules) {
    const name = validationRuleName(rule);
    if (name === undefined || out.has(name)) continue;
    const { message, active } = rule as { message?: unknown; active?: unknown };
    out.set(name, {
      ...(typeof message === 'string' ? { message } : {}),
      ...(typeof active === 'boolean' ? { active } : {}),
    });
  }
  return out;
}

/** The packaged rule, carrying the tenant's sentence and switch where the tenant's copy sets them. */
function withTenantRuleSettings<R>(packaged: R, settings: TenantRuleSettings | undefined): R {
  if (!settings || (settings.message === undefined && settings.active === undefined)) return packaged;
  return { ...packaged, ...settings };
}

/**
 * [ADR-0029 D9.2a, 2026-10-30 note] Merge `validations` BY NAME, the way
 * `fields` merge by key: a later layer's rule replaces every earlier rule of its
 * name and is appended in fold order, and a rule of a new name is added. With
 * `tenantRules` (the fold's base is a tenant overlay), the rule carries the
 * tenant's `message` and `active` for its name; its condition stays the
 * later layer's.
 */
function mergeValidationsByName(
  base: readonly unknown[] | undefined,
  extension: readonly unknown[],
  tenantRules: ReadonlyMap<string, TenantRuleSettings> | undefined,
): unknown[] {
  const names = new Set<string>();
  for (const rule of extension) {
    const name = validationRuleName(rule);
    if (name !== undefined) names.add(name);
  }
  const kept = (base ?? []).filter((rule) => {
    const name = validationRuleName(rule);
    return name === undefined || !names.has(name);
  });
  const added = extension.map((rule) => {
    const name = validationRuleName(rule);
    return name === undefined ? rule : withTenantRuleSettings(rule, tenantRules?.get(name));
  });
  return [...kept, ...added];
}

/** The value a rule's key has when the rule leaves it out — `BASE_VALIDATION_SHAPE`'s defaults. */
const VALIDATION_RULE_DEFAULTS: Readonly<Record<string, unknown>> = {
  events: ['insert', 'update'],
  priority: 100,
  severity: 'error',
};

/**
 * The keys on which a tenant's copy of a packaged rule differs from the
 * package's, beyond the two it may set (`message`, `active`) and the loader's
 * `_`-prefixed stamps. A key a rule leaves out is read at its schema default,
 * so a stored copy whose parse stamped the defaults is not a change. Empty when
 * the copy changes nothing but its sentence and its switch.
 */
function changedPackagedRuleKeys(copy: unknown, packaged: unknown): string[] {
  const enforced = (rule: unknown): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...VALIDATION_RULE_DEFAULTS };
    for (const [key, value] of Object.entries((rule ?? {}) as Record<string, unknown>)) {
      if (key === 'message' || key === 'active' || key.startsWith('_') || value === undefined) continue;
      out[key] = value;
    }
    return out;
  };
  const a = enforced(copy);
  const b = enforced(packaged);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => stableStringify(a[key]) !== stableStringify(b[key]))
    .sort((x, y) => (x === 'type' ? -1 : y === 'type' ? 1 : x < y ? -1 : x > y ? 1 : 0));
}

/**
 * Global Schema Registry
 * Unified storage for all metadata types (Objects, Apps, Flows, Layouts, etc.)
 * 
 * ## Namespace & Ownership Model
 * 
 * Objects use a namespace-based FQN system:
 * - `namespace`: Short identifier from package manifest (e.g., "crm", "todo")
 * - `name`: canonical object name (e.g., "account", "sys_user")
 * - Reserved namespaces (`base`, `system`) don't get prefixed
 * 
 * Ownership modes:
 * - `own`: One package owns the object (creates the table, defines base schema)
 * - `extend`: Multiple packages can extend an object (add fields, merge by priority)
 * 
 * ## Package vs App Distinction
 * - **Package**: The unit of installation, stored under type 'package'.
 *   Each InstalledPackage wraps a ManifestSchema with lifecycle state.
 * - **App**: A UI navigation shell (AppSchema), registered under type 'apps'.
 *   Apps are extracted from packages during registration.
 * - A package may contain 0, 1, or many apps.
 */
export type RegistryLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Construction options for {@link SchemaRegistry}.
 */
export interface SchemaRegistryOptions {
  /**
   * Whether the host kernel runs in multi-tenant mode. The `organization_id`
   * column itself is auto-injected regardless of this flag (lookup →
   * sys_organization, on every registered object that doesn't already declare
   * it, isn't `managedBy` an external subsystem, and hasn't opted out via
   * `systemFields`/`tenancy.enabled:false`). When `true` the injected column
   * is additionally INDEXED — single-tenant stacks skip the index since
   * nothing ever filters by organization.
   *
   * Sourced from the `OS_MULTI_ORG_ENABLED` env var when not explicitly set —
   * matches how the SecurityPlugin and CLI startup banner pick the mode.
   * Default is `false` (single-tenant) so local `dev`/`start` runs seed
   * demo data inline at boot; set `OS_MULTI_ORG_ENABLED=true` for cloud /
   * production multi-org deployments. Pass an explicit boolean to override
   * (useful in tests).
   */
  multiTenant?: boolean;

  /**
   * Whether to provision the hidden `__search` search-normalization companion
   * column on registered objects that have an eligible display/name field
   * (#2486 — pinyin search recall). Sourced from `OS_SEARCH_PINYIN_ENABLED`
   * via `resolveSearchPinyinEnabled()` when not explicitly set (the CLI boot
   * path stamps the locale-derived decision into that env var before the
   * kernel constructs engines). Default off — non-Chinese deployments carry
   * no extra column. Pass an explicit boolean to override (useful in tests).
   */
  searchCompanion?: boolean;

  /**
   * Policy for the install-time namespace gate (ADR-0048 Phase 1) — installing
   * a package whose `manifest.namespace` is already owned by a *different*
   * installed package.
   *
   * - `'error'` (default): throw {@link NamespaceConflictError} at install time,
   *   naming both packages. Makes the namespace land-grab a loud, early failure
   *   instead of a mid-install `CREATE TABLE` blow-up.
   * - `'warn'`: log a warning and let the install proceed. For deliberate
   *   migrations where the conflict is temporarily expected.
   *
   * Sourced from `OS_METADATA_COLLISION` (`warn` to downgrade) when not set
   * explicitly. Same-package reinstall and shareable platform namespaces
   * (`base`/`system`/`sys`) are never treated as conflicts. (The per-item
   * cross-package collision throw was retired in ADR-0048 §3.4 — distinct
   * package ids are always disambiguable by package-scoped resolution — except
   * for positions, permission sets and capabilities, whose second-holder
   * refusal ({@link SecurityCatalogNameConflictError}) this policy does NOT
   * downgrade: no ruling extends `warn` to it.)
   */
  collisionPolicy?: 'error' | 'warn';

  /**
   * Verbosity of the registry's own `[Registry] …` log lines. Sourced from the
   * `OS_REGISTRY_LOG` env var when not set explicitly (default `'info'`).
   *
   * The point of the env seam is discoverability (#3420): expected-but-noisy
   * housekeeping — re-registering an owned object / overwriting a package
   * manifest on a rebuild/HMR/seed-replay — is emitted at `'debug'`, so it stays
   * out of a stock `info` boot log but a developer chasing a registration issue
   * can surface it with `OS_REGISTRY_LOG=debug`. An unrecognized value falls
   * back to `'info'`.
   */
  logLevel?: RegistryLogLevel;
}

/**
 * [ADR-0117 D1] The injected BU-ownership column name, spelled out so it greps
 * from this file, and annotated with the spec's registered protocol name so the
 * two cannot drift: a rename in `SystemFieldName.OWNING_BUSINESS_UNIT_ID` makes
 * this line a compile error rather than a silently orphaned injection.
 */
const OWNING_BUSINESS_UNIT_FIELD: typeof SystemFieldName.OWNING_BUSINESS_UNIT_ID =
  'owning_business_unit_id';

/** [ADR-0142 D3] The injected ownership-queue column, annotated the same way. */
const QUEUE_FIELD: typeof SystemFieldName.QUEUE = 'queue';

/**
 * [#8375, widened by #8459, rebound to the wall by #8608] Is this object
 * tenant-scoped — i.e. does the WALL filter it by `organization_id`?
 *
 * ## One question, one authority
 *
 * This read `resolveInjectedSystemColumns(schema).tenant` — the spec's
 * INJECTION plan — on the reasoning that an object withholding the COLUMN has
 * nothing for an index to serve. That reasoning holds for three of the plan's
 * opt-out rows and fails on the fourth. `systemFields: false` is the hard
 * object-level opt-out, so the plan answers "inject nothing"; plugin-security
 * derives `tenancyDisabled` from exactly two clauses —
 *
 *     tenancy.enabled === false || systemFields.tenant === false
 *
 * — and `systemFields: false` is in neither. An object using the hard opt-out
 * while declaring its OWN `organization_id` therefore had the wall predicate
 * AND-composed onto essentially every read with no index behind it: the same
 * "hottest predicate unindexed" shape #6810 and #8459 exist to prevent, reached
 * by a third route. Measured end to end on #8608 rather than inferred — for one
 * such object the registry answered `indexes: null` while plugin-security's
 * `getReadFilter` answered `{ organization_id: <org> }`.
 *
 * Triage ruling, 2026-08-14 (option A), applying the standing meta-rule that
 * when one question has two disagreeing implementations the GOVERNED side wins
 * by default and the ungoverned side rebinds to it: **the wall's derivation is
 * authoritative and the index follows it.** ⛔ Option B — teaching
 * plugin-security to read `systemFields: false` as tenancy-disabled — was
 * REJECTED, because it narrows a wall and only an explicit product ruling can
 * do that. So this predicate is now the wall's, in the wall's own terms:
 *
 *  1. the wall's two clauses, and nothing else, decide "is tenancy off here";
 *  2. the object carries `organization_id` — either the platform provisions it
 *     (the injection plan) or the author declared it.
 *
 * `managedBy: 'better-auth'` is deliberately NOT a third clause: the wall does
 * not read it either, so a better-auth table that DECLARES `organization_id`
 * (`sys_member`) is walled on that column and is now indexed on it. Re-adding
 * an exclusion the wall does not have is precisely the drift this rebinding
 * closes — and `declaresTenantIndex` already covers the tables that declare
 * their own tenant index (`sys_invitation`, `sys_team`).
 *
 * ⚠️ The clause-1 rows are NOT a leftover of the condition #8459 lifted: an
 * object that declares itself non-tenant-scoped is one the wall composes NO
 * predicate on (`computeTenantLayer0Filter` returns `null` when
 * `tenancyDisabled`), so an index there would serve nothing — the same
 * reasoning as `multiTenant: false`, one scope down. What #8459 removed is a
 * different condition: that the `organization_id` present be the platform's own
 * definition byte-for-byte (`isInjectedColumnDefinition`). Where the column
 * comes from is no longer part of the question; whether the object is WALLED
 * still is.
 *
 * ⛔ Do NOT reduce clause 2 to its field-map half alone
 * (`fields.organization_id !== undefined`), however closely that reads to the
 * ruling's sentence. Measured: it breaks the WRITE path for ordinary
 * platform-provisioned objects. The save path strips the injected COLUMNS
 * before it strips the materialized stamps
 * (`stripMaterializedFromRegistry(type, stripServedSystemColumns(type, item))`,
 * `@objectstack/metadata-protocol`), so by the time
 * {@link SchemaRegistry.stripProvisionedTenantIndexFrom} re-stamps the
 * remainder through this function, the body no longer HAS an
 * `organization_id` — a field-map-only predicate answers "not tenant-scoped",
 * the re-stamp adds nothing, the lists differ, the strip refuses, and the
 * platform's own index entry is baked into `sys_metadata.metadata`, its
 * checksum and every history diff (the #4326 regression). The injection-plan
 * branch is what answers on a stripped body; the field-map branch only ever
 * ADDS objects whose column that plan cannot see. And the addition is safe on
 * the write path for the mirrored reason: on exactly those rows the plan also
 * strips nothing (`plan.names` is `{ id }`), so the author's declared column is
 * still present when the re-stamp asks.
 *
 * [#15225 → #15813] Briefly exported at module level for the engine's
 * bulk-event producer, which answered "is this object walled?" from it — a
 * binding of TWO of the wall's three object clauses, structurally blind to
 * the deployment's #12699 carve-out (the #15706 finding). That producer now
 * reads the Layer 0 verdict plugin-security RECORDS on the operation
 * (`OperationContext.tenantLayer0Verdict`) and consults no schema predicate at
 * all, so this is private again: the registry's own reading, for the two
 * sites above, and ⛔ not a contract for any other package to answer the
 * wall from — the wall answers for itself (ADR-0131 D8).
 */
function carriesTenantScopeColumn(
  schema: ServiceObject,
  platformGlobalObjects?: ReadonlySet<string>,
): boolean {
  // Clause 1 — the wall's own two clauses, spelled here because
  // plugin-security spells them there (option C, the single exported
  // predicate, is bounded to no new `@objectstack/spec` export and no
  // plugin-security behaviour change, so the convergence itself is a
  // follow-up; `isTenancyDisabled` is already the shared reading of the first).
  if (isTenancyDisabled(schema)) return false;
  if ((schema as { systemFields?: { tenant?: boolean } }).systemFields?.tenant === false) {
    return false;
  }
  // Clause 2 — there is a column for the wall's predicate to filter on.
  // [ADR-0131 D7] The injection plan is asked with the deployment's
  // platform-global declaration, the same input `applySystemFields` planned the
  // column from: a declared object carries no injected tenant column, so there
  // is nothing for an index to serve.
  const plan =
    platformGlobalObjects && platformGlobalObjects.size > 0
      ? resolveInjectedSystemColumns(schema, { platformGlobalObjects })
      : resolveInjectedSystemColumns(schema);
  return (
    plan.tenant ||
    (schema as { fields?: Record<string, unknown> }).fields?.organization_id != null
  );
}

/**
 * [#6810] Is the tenant index already declared on this object?
 *
 * The append is the one part of this injection that is not naturally
 * idempotent — the field injection re-runs harmlessly because
 * `!schema.fields?.organization_id` stops it, an array push does not — so an
 * author who hand-wrote `indexes: [{ fields: ['organization_id'] }]` must not
 * end up with the platform's duplicate beside it.
 *
 * Matched on the single-column shape this function emits, deliberately: an
 * author's composite (`['organization_id', 'code']`) is a leading-column match
 * on some dialects and not on others, so it is not treated as a substitute.
 */
function declaresTenantIndex(schema: ServiceObject): boolean {
  const declared = (schema as any).indexes;
  if (!Array.isArray(declared)) return false;
  return declared.some(
    (idx: any) =>
      Array.isArray(idx?.fields) &&
      idx.fields.length === 1 &&
      idx.fields[0] === 'organization_id',
  );
}

/**
 * Reconcile a managed object's `enable.apiMethods` against the generic-write
 * affordances it actually grants (ADR-0092 / ADR-0103).
 *
 * A `managedBy` object whose resolved affordances forbid a write verb, yet
 * which *also* advertises that verb in `enable.apiMethods`, is internally
 * contradictory: the HTTP exposure gate (ADR-0049) would admit the request and
 * let it 403 at the engine instead of answering a clean 405, and the metadata
 * misrepresents what the API offers.
 *
 * This is the registration-time backstop that makes the contradiction
 * impossible to *ship*: any write verb whose CRUD affordance the object does
 * not grant — via the `managedBy` bucket default plus `userActions` overrides,
 * exactly as `resolveCrudAffordances` computes for the UI — is stripped,
 * with a warning. Reads are never touched.
 *
 * The judgement itself is NOT here. `checkManagedApiMethodAffordances`
 * (`@objectstack/spec/data`) owns the verb → affordance table, and
 * `@objectstack/lint`'s `validateManagedApiMethods` — the authoring-time gate
 * that reports the same contradiction where the AUTHOR is, rather than in a
 * boot log nobody reads (#7521) — reads that same predicate. This function is
 * only the registration-time REACTION to it: strip and warn. If a verdict seems
 * wrong, fix the predicate, never this reaction — a second table here is the
 * declared≠enforced drift the predicate exists to detect.
 *
 * WARN and strip, never throw — deliberately (the #7521 ruling, 2026-08-11):
 * failing registration closed would let one metadata typo kill a control-plane
 * boot, which is too harsh for ops. The author-time gate is where this blocks.
 *
 * Runs for every managed bucket (ADR-0103). Objects that legitimately take
 * user-context writes declare `userActions` opening those verbs, so their
 * apiMethods are kept: `sys_user` keeps `update` (`userActions.edit: true`; its
 * writes are field-whitelist-clamped by the identity guard), and the `system`
 * writable set (RBAC link tables, prefs, messaging config) keeps its CRUD
 * verbs. Engine-owned `system` / `append-only` objects and the other identity
 * tables — which grant no write affordance — derive down to reads only. Any
 * future managed object that advertises a write verb it does not permit is the
 * drift this backstop catches.
 *
 * Returns the input unchanged when nothing is stripped; otherwise a new schema
 * with a rewritten `enable.apiMethods` (immutable, like {@link applySystemFields}).
 */
export function reconcileManagedApiMethods(
  schema: ServiceObject,
  opts?: { warn?: (msg: string) => void },
): ServiceObject {
  const conflicts = checkManagedApiMethodAffordances(schema);
  if (conflicts.length === 0) return schema;

  const methods = (schema as any).enable.apiMethods as unknown[];
  const strippedIndexes = new Set(conflicts.map((c) => c.index));
  const kept = methods.filter((_m, i) => !strippedIndexes.has(i));
  const stripped = conflicts.map((c) => c.verb);

  const managedBy = (schema as any).managedBy;
  // [ADR-0153 D4] On a write-locked bucket (`synced`) `userActions` cannot open
  // a write — the parse refuses it — so the remedy is to drop the verbs and
  // write through a declared action (D5). Every other bucket keeps its sentence.
  const remedy = MANAGED_BY_WRITE_LOCKED_BUCKETS.has(managedBy)
    ? `userActions cannot open a write on this bucket (ADR-0153 D4): remove [${stripped.join(', ')}] ` +
      `from enable.apiMethods and send writes through a declared action (ADR-0153 D5).`
    : `Declare userActions to open a verb the object legitimately takes from a user context.`;
  const warn = opts?.warn ?? ((msg: string) => console.warn(msg));
  warn(
    `[Registry] Object "${schema.name}" is managedBy:'${managedBy}' but advertised ` +
      `generic write verb(s) [${stripped.join(', ')}] in enable.apiMethods its resolved affordances ` +
      `do not permit — stripping them (ADR-0092/ADR-0103). ${remedy} Kept: [${kept.join(', ')}]. ` +
      `\`os lint\` reports the same contradiction as \`object/managed-api-method-unaffordable\` ` +
      `with full authoring context.`,
  );

  return {
    ...schema,
    enable: { ...(schema as any).enable, apiMethods: kept },
  };
}

/** Objects already warned about stripped legacy `apiMethods` (once per object). */
const warnedLegacyApiMethods = new Set<string>();

/**
 * Registration-time diagnostic for retired LEGACY `apiMethods` values (#3543,
 * P2 of #3391). Since the enum shrink, the 8 legacy verbs (`upsert`/
 * `aggregate`/`history`/`search`/`restore`/`purge`/`import`/`export`) are no
 * longer authorable: a declared legacy value is IGNORED — the effective API
 * surface derives from the six primitives alone. The Zod parse path already
 * strips-and-warns (`stripLegacyApiMethods` in `@objectstack/spec/data`), but
 * carries no object name; this registration-time diagnostic adds the per-object
 * view for schemas that reach the registry without passing through Zod (raw
 * `ServiceObject` literals, out-of-band metadata). Real metadata does not
 * upgrade in lockstep with the spec, so this is a PERMANENT compatibility
 * diagnostic, not a transition.
 *
 * Emitted once per object (not per request — the hot path stays free). Pure
 * observation: it never mutates the schema (the derivation resolver ignores
 * legacy values on its own).
 */
export function warnStrippedLegacyApiMethods(
  schema: ServiceObject,
  opts?: { warn?: (msg: string) => void },
): void {
  const methods = (schema as any).enable?.apiMethods;
  if (!Array.isArray(methods) || methods.length === 0) return;
  const legacy = methods.filter((m: string) => (LEGACY_API_METHODS as readonly string[]).includes(m));
  if (legacy.length === 0) return;
  const name = String((schema as any).name ?? '');
  if (warnedLegacyApiMethods.has(name)) return;
  warnedLegacyApiMethods.add(name);
  const remaining = methods.filter((m: string) => !(LEGACY_API_METHODS as readonly string[]).includes(m));
  const warn = opts?.warn ?? ((msg: string) => console.warn(msg));
  warn(
    `[Registry] Object "${name}" declares retired legacy apiMethods value(s) ` +
      `[${legacy.join(', ')}] in enable.apiMethods — the authorable values are now the six ` +
      `primitives only, because every other operation is derived from them or retired, so these ` +
      `are IGNORED: the effective API surface derives from the ` +
      `six primitives (get/list/create/update/delete/bulk) alone ` +
      `(['create','update'] ⇒ upsert/import; ['list'] ⇒ aggregate/search/export; ` +
      `['get'] + trackHistory ⇒ history).` +
      (remaining.length === 0
        ? ` ⚠ Ignoring them leaves NO primitives — this object's API resolves ` +
          `to deny-all (fully closed).`
        : '') +
      ` Remove the value(s); codemod: node scripts/codemod/apimethods-legacy-to-primitives.mjs.`,
  );
}

/** Objects already diagnosed for functional completeness (once per object). */
const warnedFunctionalCompleteness = new Set<string>();

/**
 * [ADR-0078 Phase 4] Registration-time functional-completeness diagnostic.
 *
 * The author-time gate (`@objectstack/lint`'s `validate-functional-completeness`)
 * only protects metadata that passes through `os build` / `validate` / `lint`.
 * The registry is the one choke point EVERY door goes through — declared
 * stacks, plugin-provided objects, `extend` contributions, `saveMetaItem`, raw
 * `registerObject` calls — including the doors that skip Zod and lint entirely.
 * Two shipped instances prove those doors are real, not hypothetical: #3896
 * (Setup authoring inserted `sys_sharing_rule` rows directly, bypassing the
 * schema that "required" `criteria`) and cloud's `rowColor.mapping` (an
 * `as never` cast bypassed tsc, then the strip-era parse dropped the key).
 *
 * Same shared predicate as the author-time gate (`checkFieldCompleteness` in
 * `@objectstack/spec/kernel`), so the rule ids in this warning are the SAME ids
 * the lint reports — an operator or an AI reading the boot log can grep the id
 * straight into the docs and the suppression story. Judgement lives only in the
 * predicate; if a rule seems wrong, fix it there, never here.
 *
 * WARN, never throw — deliberately, and not as a soft default: an inert field
 * must not kill a boot that thousands of healthy objects share (ADR-0078 §1
 * maps error-severity to "the INSTANCE is dead", not "the system is dead").
 * The author-time gate is where errors block; the registry's job is to make
 * sure the silence never survives to runtime unobserved.
 *
 * Emitted once per object name with every finding aggregated into that one
 * line (not per request, not per finding — the hot path stays free and a
 * 3-dead-field object is one greppable line, not three).
 */
export function warnFunctionalCompleteness(
  schema: ServiceObject,
  opts?: { warn?: (msg: string) => void },
): void {
  const fields = (schema as { fields?: Record<string, unknown> }).fields;
  if (!fields || typeof fields !== 'object') return;
  const name = String((schema as { name?: unknown }).name ?? '');
  if (warnedFunctionalCompleteness.has(name)) return;

  const findings: string[] = [];
  for (const [fieldName, def] of Object.entries(fields)) {
    for (const f of checkFieldCompleteness(def)) {
      findings.push(`${fieldName}: [${f.severity}] ${f.rule} — add \`${f.fix}\``);
    }
  }
  if (findings.length === 0) return;
  warnedFunctionalCompleteness.add(name);

  const warn = opts?.warn ?? ((msg: string) => console.warn(msg));
  warn(
    `[Registry] Object "${name}" registered with ${findings.length} functionally-incomplete ` +
      `field(s) — Zod-valid but runtime-DEAD: the consumer silently skips each one, so it reads ` +
      `0/null/never-resolves while every authoring surface reports success (ADR-0078). ` +
      findings.join(' · ') +
      ` — \`os lint\` reports the same rule ids with full context.`,
  );
}

/**
 * [#16319] The `error.code` the field-`type` refusal below carries.
 *
 * `INVALID_METADATA` — already registered under `@objectstack/objectql` in
 * `ERROR_CODE_LEDGER`, and already this package's spelling for "a stored or
 * programmatically-supplied metadata body does not satisfy the spec schema"
 * (`engine.ts`'s two plugin-view expansion refusals answer with it). ⛔ Not a
 * new code: minting one widens the published error-code face, which is a
 * Clause-② contract change and not this repair's to take. The CONDITION is
 * named by {@link OBJECT_FIELD_TYPE_REFUSED_ERROR_NAME}, which is what a
 * consumer discriminates on beyond the code — `INVALID_METADATA` is shared with
 * several unrelated refusals in this package.
 */
export const OBJECT_FIELD_TYPE_REFUSED_CODE = 'INVALID_METADATA' as const;

/**
 * {@link ExtensionDefaultRowScopeRefusedError}'s code — `INVALID_METADATA`,
 * this package's spelling for "a programmatically supplied metadata body does
 * not satisfy the spec schema" (see {@link OBJECT_FIELD_TYPE_REFUSED_CODE}):
 * `ObjectExtensionSchema` is strict and declares no `defaultRowScope`, so the
 * parse refuses the same body at authoring. ⛔ Not a new code. The condition is
 * named by the error's `name`.
 */
export const EXTENSION_DEFAULT_ROW_SCOPE_REFUSED_CODE = 'INVALID_METADATA' as const;

/**
 * {@link ExtensionMembershipKeysRefusedError}'s code — `INVALID_METADATA`, for
 * the reason {@link EXTENSION_DEFAULT_ROW_SCOPE_REFUSED_CODE} gives:
 * `ObjectExtensionSchema` is strict and declares no `membershipKeys`, so the
 * parse refuses the same body at authoring. ⛔ Not a new code. The condition is
 * named by the error's `name`.
 */
export const EXTENSION_MEMBERSHIP_KEYS_REFUSED_CODE = 'INVALID_METADATA' as const;

/**
 * {@link ValidationRuleCopyRefusedError}'s code — `INVALID_METADATA`, for the
 * reason {@link EXTENSION_DEFAULT_ROW_SCOPE_REFUSED_CODE} gives: a body this
 * registry will not take as written. ⛔ Not a new code. The condition is named
 * by the error's `name`.
 */
export const VALIDATION_RULE_COPY_REFUSED_CODE = 'INVALID_METADATA' as const;

/**
 * {@link ObjectQueueColumnRefusedError}'s code — `INVALID_METADATA`, as
 * {@link ObjectFieldTypeRefusedError}'s is: a body this registry cannot
 * register as written. ⛔ Not a new code; the condition is named by the
 * error's `name`.
 */
export const OBJECT_QUEUE_COLUMN_REFUSED_CODE = 'INVALID_METADATA' as const;

/**
 * Sentinel for "this value is not data and does not belong in the record".
 * A distinct symbol rather than `undefined`, so a manifest that genuinely
 * carries `undefined` is not confused with a value that was dropped.
 */
const NOT_RECORD_DATA = Symbol('objectstack.registry.notRecordData');

/** Whether `value` is a bare `{}`-shaped object (or a null-prototype bag). */
function isPlainDataObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * One step of {@link toRecordManifest} — project a value, or report that it is
 * not data. `seen` carries the ancestors of the current value, so a CYCLE is
 * detected at the second visit and the back-reference is dropped rather than
 * followed. Siblings are re-projected independently (the ancestor is deleted on
 * the way out), so a manifest that legitimately mentions the same sub-object
 * twice keeps both copies.
 */
function projectRecordValue(value: unknown, seen: Set<object>): unknown {
  if (value === null) return null;
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean') return value;
  // `undefined`, `function`, `symbol`, `bigint` — none of which survive
  // `JSON.stringify` as themselves (`bigint` is the one that THROWS).
  if (kind !== 'object') return NOT_RECORD_DATA;

  const obj = value as object;
  // A `Date` is exotic but has a declared JSON form, so it is data. Copied
  // rather than shared: the record must not alias a mutable runtime value.
  if (obj instanceof Date) return new Date(obj.getTime());
  if (seen.has(obj)) return NOT_RECORD_DATA;

  if (Array.isArray(obj)) {
    seen.add(obj);
    const out: unknown[] = [];
    for (const entry of obj) {
      const projected = projectRecordValue(entry, seen);
      // Non-data entries are OMITTED, not held as `null` holes: nothing reads a
      // manifest collection by index (every one of them is name-keyed), and a
      // `plugins: [null, null, …]` on the wire says less than `plugins: []`.
      if (projected !== NOT_RECORD_DATA) out.push(projected);
    }
    seen.delete(obj);
    return out;
  }

  if (!isPlainDataObject(obj)) return NOT_RECORD_DATA;

  seen.add(obj);
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(obj)) {
    const projected = projectRecordValue(entry, seen);
    if (projected !== NOT_RECORD_DATA) out[key] = projected;
  }
  seen.delete(obj);
  return out;
}

/**
 * Project an authored manifest into the SERIALIZABLE RECORD the registry keeps.
 *
 * {@link SchemaRegistry.installPackage} used to store the caller's object
 * verbatim. For a code-defined stack (`objectstack.config.ts`) that object is
 * the LIVE runtime one — `plugins: [new ConnectorRestPlugin(), …]` — and a
 * plugin instance holds the engine once it initialises. Since the engine grew
 * `actionActivation -> store -> engine` that reference closes a CYCLE, so
 * `JSON.stringify` of the registry item THREW and every read door that
 * serialises a package answered `500 INTERNAL_ERROR` on a stock showcase boot:
 * `GET /packages`, `GET /packages/:id`, `GET /meta/package/:id`. Before that
 * cycle existed the same doors serialised the whole engine graph into the
 * payload instead, which is the same defect with a quieter symptom.
 *
 * Measured on that boot: of the 26 installed packages exactly ONE manifest key
 * was unserializable — `plugins`, on `com.example.showcase` — and only AFTER
 * plugin init; the same manifest serialised cleanly during boot. So an
 * install-time `JSON.stringify` probe would have called the record healthy. The
 * projection therefore drops by SHAPE, at install, and never depends on when it
 * is asked.
 *
 * The registry item is a RECORD, not the runtime. The kernel keeps the live
 * object (`ObjectQL.manifests`), and the one reader of `manifest.plugins[]` —
 * `ObjectQL.registerApp`'s nested-plugin seam — reads its OWN parameter, never
 * the record, so nothing downstream loses a member it was using.
 *
 * The rule is STRUCTURAL rather than a key denylist, because the fault is not
 * "the key is called `plugins`" — it is "a live object reached the record".
 * JSON data survives; everything else is dropped:
 *
 *   - primitives, plain objects, arrays and `Date` are data;
 *   - functions / symbols / bigints are dropped (a function was already
 *     invisible to `JSON.stringify`; dropping it only makes the record honest,
 *     and a bigint would have thrown);
 *   - class instances, `Map`, `Set` and every other exotic object are dropped —
 *     a declarative manifest has none, and a code-defined stack's are host
 *     wiring;
 *   - a reference cycle among plain data is dropped at the back-edge, so a
 *     self-referencing manifest degrades to a missing field instead of throwing.
 *
 * ⛔ This is the PRODUCER's repair, not a consumer-side tolerance: no reader is
 * taught to survive an unserializable record, because the record is never
 * unserializable to begin with (AGENTS.md Prime Directive #12).
 */
function toRecordManifest(manifest: ObjectStackManifest): ObjectStackManifest {
  // The ROOT is projected key-by-key unconditionally: a host whose
  // `defineStack()` returns a class instance must still yield a record, and
  // `projectRecordValue` would drop the whole thing.
  if (manifest === null || typeof manifest !== 'object') return manifest;
  const seen = new Set<object>([manifest as object]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest as Record<string, unknown>)) {
    const projected = projectRecordValue(value, seen);
    if (projected !== NOT_RECORD_DATA) out[key] = projected;
  }
  return out as ObjectStackManifest;
}

/**
 * Rewrite a BARE callable `functions` map entry into the declared form
 * (`{ handler, effect }`) before {@link toRecordManifest} projects the body.
 *
 * ## The under-report this closes
 *
 * `functions` accepts two authored spellings, and the projection treats them
 * unequally through no fault of its own:
 *
 * - `{ sweepProjectHealth: { handler: fn, effect: 'writes' } }` — the value is
 *   a plain object, so it survives with its callable dropped: `{ effect:
 *   'writes' }`. The function is still REPORTED, minus what cannot serialise.
 * - `{ summarizeCompletedTask: fn }` — the value IS the callable, so the whole
 *   ENTRY is dropped, key and all. The function vanishes from the record.
 *
 * `examples/app-showcase` ships one of each, so `GET /packages` reported ONE
 * function for a package declaring TWO. A machine-readable read door that
 * under-reports is a defect independent of how its rows are declared.
 *
 * ## Why it is fixed HERE and not in the projection
 *
 * {@link toRecordManifest}'s rule is STRUCTURAL — 「a live object reached the
 * record」, ⛔ never a key denylist — and teaching it that a function found
 * under `functions.<name>` means something other than a function found
 * anywhere else would overturn exactly that. So the repair is at the assembly
 * boundary instead: the two spellings are made structurally EQUAL before the
 * projection runs, and the projection then leaves `{ effect }` for both.
 *
 * ⛔ No ref is minted. `packages/cli`'s `lowerCallables` mints refs with
 * `uniqueName(base, taken)` and dedupes by function IDENTITY, so a ref minted
 * here would not be guaranteed equal to the one `objectstack build` mints — a
 * record could then assert a handler that resolves in no sibling module. An
 * ABSENT `handler` on a record is the honest statement 「declared here, not
 * serialisable」, and `RecordStagePackageBodySchema` in `@objectstack/spec`
 * declares exactly that.
 *
 * `effect` is the declaration schema's OWN default
 * ({@link DEFAULT_FLOW_FUNCTION_EFFECT}, `'pure'`, which
 * `FlowFunctionDeclarationSchema.effect` carries as `.default(…)`), ⛔ not a
 * value invented here: the bare spelling IS that declaration written the short
 * way, and `normalizeFlowFunctionEntry` already reads it the same way at boot.
 * The ARRAY form needs nothing — its entries are objects that carry their own
 * `name`, so the projection keeps them — and its `effect` is `.optional()` with
 * no default, so nothing is written where the schema declares nothing.
 *
 * ⛔ The caller's manifest is never mutated: the live object is what every
 * other read in `installPackage` uses, and a copy is returned only when an
 * entry really needed rewriting.
 */
function withDeclaredFunctionEntries(manifest: ObjectStackManifest): ObjectStackManifest {
  if (manifest === null || typeof manifest !== 'object') return manifest;
  const functions = (manifest as { functions?: unknown }).functions;
  if (!functions || typeof functions !== 'object' || Array.isArray(functions)) return manifest;

  let rewrote = false;
  const declared: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(functions as Record<string, unknown>)) {
    if (typeof entry === 'function') {
      declared[name] = { handler: entry, effect: DEFAULT_FLOW_FUNCTION_EFFECT };
      rewrote = true;
    } else {
      declared[name] = entry;
    }
  }
  if (!rewrote) return manifest;
  return { ...manifest, functions: declared } as ObjectStackManifest;
}

/**
 * [#16159] The ADR-0112 `code` strings this file's three install-time and
 * registration refusals carry, as constants a consumer can import.
 *
 * Every one of the three classes below already tells the reader, in its own
 * docblock, that it "carries the ADR-0112 envelope (`code` + `status`)". That
 * convention is sound and `instanceof` is not: `@objectstack/objectql`
 * declares BOTH realms in its own `exports` (`import` reaches
 * `dist/index.mjs`, `require` reaches `dist/index.js`), so a consumer holding
 * the other realm's copy of a class gets `instanceof` === false — measured,
 * and silent (#14936). A `code` compare is the check that survives crossing
 * that boundary. Until now a consumer following the convention had to
 * RE-SPELL the string itself, which acquires a `check:error-code-provenance`
 * stamp site in the consumer's own package and can then drift from what this
 * engine throws with no compile error to say so.
 *
 * ⛔ The strings are byte-identical to the literals they replace. This moves
 * where a spelling lives, never what it says; renaming any of these codes is
 * a separate breaking decision and never a rider on this conversion.
 *
 * The `*_CODE` NAME is load-bearing rather than cosmetic, in two gates at
 * once: it is the shape `check:error-code-provenance`'s `constdef` pattern
 * can see, and `readonly code = X_CODE;` is the shape
 * `check:dispatcher-error-vocabulary` classifies as `classconst` (the three
 * rows in `packages/runtime/src/dispatcher-error-vocabulary.ts` move from
 * `classfield` to `classconst` with this change, and the scanner resolves the
 * constant back to the same value). ⛔ Never rename out of that shape to
 * quiet a gate: a spelling a gate cannot see is the failure mode the gate
 * exists to catch, not a clean result.
 *
 * Shape and placement follow the six `*_CODE` constants already in this
 * package (`DUPLICATE_RECORD_CODE`, `HOOK_TARGET_REBIND_ERROR_CODE`,
 * `HOOK_UNSCOPED_DATA_ACCESS_CODE`,
 * `MULTI_UPDATE_HOOK_KEY_DIVERGENCE_CODE`, `EMPTY_CREDENTIAL_REFUSAL_CODE`,
 * `SYSTEM_WRITE_ORGANIZATION_REQUIRED_CODE`) — re-exported from the
 * `index.ts` barrel and, like all six, deliberately NOT from the lean
 * `core.ts` entry, which carries none of them.
 *
 * ⛔ Deliberately NOT a recognizer factory: #16156 measured that a
 * `makeRecognizer(code)` signature still requires every call site to supply
 * the code, which RELOCATES the literal rather than removing it.
 */
export const NAMESPACE_CONFLICT_CODE = 'NAMESPACE_CONFLICT' as const;

/** {@link ArtifactObjectNameConflictError}'s code — ADR-0130 D3, one artifact. */
export const DUPLICATE_ARTIFACT_OBJECT_NAME_CODE = 'DUPLICATE_ARTIFACT_OBJECT_NAME' as const;

/** {@link ObjectOwnershipConflictError}'s code — ADR-0029 D3, single owner per name. */
export const OBJECT_OWNERSHIP_CONFLICT_CODE = 'OBJECT_OWNERSHIP_CONFLICT' as const;

/**
 * {@link DefaultRecordPageConflictError}'s code — one default record page per
 * object per deployment (maintainer ruling A on objectstack#23015). The save
 * door in `@objectstack/metadata-protocol` stamps the same string for the same
 * condition; that package cannot import this one, so it spells it once and the
 * ledger lists it under both.
 */
export const DEFAULT_RECORD_PAGE_CONFLICT_CODE = 'DEFAULT_RECORD_PAGE_CONFLICT' as const;

/** One second holder {@link SecurityCatalogNameConflictError} refused. */
export interface SecurityCatalogNameConflict {
  /** The catalog type, as the registry keys it. */
  readonly catalogType: SecurityCatalogType;
  /** The name both holders claim. */
  readonly name: string;
  /** The package whose registration this refusal stopped. */
  readonly incomingPackageId: string;
  /** Who already holds the name. */
  readonly existingHolder: SecurityCatalogHolder;
}

/**
 * The rule both wordings of {@link SecurityCatalogNameConflictError} state, in
 * the words the permission set `name` describe (`@objectstack/spec`) and the
 * permission sets guide use. [ADR-0150 D2/D9] A permission set is identified
 * by its package and name, so its name has one holder per namespace, judged by
 * `permissionSetHoldersMeet` (`@objectstack/core`); positions and capabilities
 * keep one name per deployment. Text only: which holders are refused is decided
 * by the doors, never by this sentence.
 */
const SECURITY_CATALOG_NAME_RULE =
  'Positions and capabilities each hold one name per deployment. A permission set holds one name per ' +
  'namespace: packages of two namespaces may each hold a set of one name, while two packages of one ' +
  'namespace, a package with no namespace, a platform package (`base`, `system`, `sys`), the environment ' +
  'and the platform-requested `guest_portal` share one set of it.';

/**
 * The cold-boot wording of {@link SecurityCatalogNameConflictError}: every
 * package registered before the environment catalog hydrated, so each line
 * names the package that declares the name and the holder it meets, and the
 * remedy is stated for an operator restarting a deployment, not for an install.
 */
function coldBootConflictMessage(conflicts: readonly SecurityCatalogNameConflict[]): string {
  const lines = conflicts.map(
    (c) =>
      `package "${c.incomingPackageId}" declares the ${securityCatalogTypeLabel(c.catalogType)} "${c.name}", ` +
      `already held by ${describeSecurityCatalogHolder(c.existingHolder)}`,
  );
  return (
    `Security catalog name conflict at boot: ${conflicts.length === 1 ? 'a name' : `${conflicts.length} names`} ` +
    `a configured package declares ${conflicts.length === 1 ? 'is' : 'are'} already held by another holder — ` +
    `${lines.join('; ')}. ${SECURITY_CATALOG_NAME_RULE} Under that rule the environment's item and the ` +
    `package's share one definition of the name, so with two holders the environment's stored item would be ` +
    `served in place of the package's definition. The environment catalog loads from ` +
    `sys_metadata before this check, so the boot is refused. Rename the item in the package, or rename or ` +
    `delete the environment's item (its environment-wide sys_metadata row: \`os migrate security-catalog-overlays\` ` +
    `lists every such row with no server running, and with --apply deletes them), then restart. ` +
    `See ADR-0048.`
  );
}

/** One second holder {@link BareNameConflictError} refused (or a cold boot reported). */
export interface BareNameConflict {
  /** The covered type, as the registry keys it. */
  readonly type: BareNameOneHolderType;
  /** The name both holders claim. */
  readonly name: string;
  /** The package whose registration this refusal stopped (at a cold boot: a later-registered holder). */
  readonly incomingPackageId: string;
  /** Who already holds the name. */
  readonly existingHolder: BareNameHolder;
  /** The rename that clears it — the incoming package's namespace prefixed — when it has one. */
  readonly rename?: string;
  /** [#31697] For an action bound to an object under a built-in key ({@link BUILT_IN_BOUND_ACTION_KEYS}): that object. */
  readonly objectName?: string;
}

/** One conflict's line, the same at every door. */
function bareNameConflictLine(c: BareNameConflict): string {
  const what = c.objectName !== undefined
    ? `action "${c.name}" bound to "${c.objectName}"`
    : `${bareNameTypeLabel(c.type)} "${c.name}"`;
  return (
    `package "${c.incomingPackageId}" declares the ${what}, ` +
    `already held by ${describeBareNameHolder(c.existingHolder)}` +
    (c.rename ? ` — rename it to "${c.rename}" in "${c.incomingPackageId}"` : '')
  );
}

/** Why a second holder is refused, for the types `conflicts` carry (`bareNameReason`). */
const bareNameReasonFor = (conflicts: readonly BareNameConflict[]): string =>
  bareNameReason(conflicts.map((c) => c.type));

/** The cold-boot warning for the names two installed packages already hold (`bare-name-one-holder.ts`). */
export function bareNameColdBootWarning(conflicts: readonly BareNameConflict[]): string {
  return (
    `Bare-name conflict at boot: ${conflicts.length === 1 ? 'a second holder' : `${conflicts.length} second holders`} ` +
    `among the installed packages — ${conflicts.map(bareNameConflictLine).join('; ')}. ${bareNameReasonFor(conflicts)} ` +
    `The boot continues and changes nothing about which holder each caller is served; a further package ` +
    `declaring the name is refused at install. Rename the item in one package (its namespace prefixed, as ` +
    `above), or uninstall one of the two packages. See ADR-0048.`
  );
}

/** One second default record page {@link DefaultRecordPageConflictError} refused. */
export interface DefaultRecordPageConflict {
  /** The object both pages are the default record page of. */
  readonly object: string;
  /**
   * The app both pages are the record page of `object` inside (`PageSchema.apps`,
   * ruling A on objectstack#28979); absent for the deployment's default.
   */
  readonly app?: string;
  /** The page whose registration this refusal stopped. */
  readonly incoming: DefaultRecordPageHolder;
  /** The page that already holds the object's default record page. */
  readonly existing: DefaultRecordPageHolder;
}

/**
 * {@link MisplacedDefaultPageError}'s code — `INVALID_METADATA`, already this
 * package's spelling for "a programmatically supplied metadata body does not
 * satisfy the spec schema" (see {@link OBJECT_FIELD_TYPE_REFUSED_CODE}): the
 * page parse refuses the same body at `os validate` and at save. ⛔ Not a new
 * code. The condition is named by the error's `name`.
 */
export const MISPLACED_DEFAULT_PAGE_CODE = 'INVALID_METADATA' as const;

/**
 * [ADR-0130 D1] What the install gate is told about the artifact now installing.
 *
 * `installPackage` has no notion of which release artifact a manifest arrived
 * in, and ADR-0130 D8 deliberately adds **no** owner/publisher field to the
 * manifest to give it one. So the knowledge is threaded as an install-time
 * SCOPE: the load path that reads an artifact (`manifest.register()` →
 * `resolveArtifactPackageOrder` → `registerApp`) already holds the artifact's
 * package list, and passes it down.
 *
 * Two consequences worth stating, because both are load-bearing:
 *
 *  - **It is per-install, not stored.** Nothing persists a co-ownership claim,
 *    so nothing can drift from the artifact that is the claim (D8's objection to
 *    a manifest field, applied to the runtime).
 *  - **Absent scope means today's behaviour, structurally.** Every caller that
 *    installs ONE package — `protocol.installPackage`, `POST /packages`, a bare
 *    `registerApp` — passes no scope, so the co-owner set is empty and both
 *    halves of the ADR-0130 D1/D3 pair are no-ops. A single-`manifest` artifact
 *    passes a one-element scope, whose only member is the package itself, which
 *    the gate excludes anyway (D7).
 */
export interface ArtifactInstallScope {
  /**
   * The ids of every package delivered by the artifact currently installing —
   * read through {@link artifactPackageId}, so they are the same strings the
   * registry keys installed packages by.
   */
  readonly packageIds: readonly string[];
}

/**
 * Why two packages co-own one namespace at the install gate:
 *
 * - `artifact` — the same release artifact delivers both (ADR-0130 D1);
 * - `dependency` — one declares the other in `manifest.dependencies` (ADR-0141 D5);
 * - `sibling` — both declare one installed package that holds the namespace (ADR-0141 D5).
 */
export type CoOwnershipSource = 'artifact' | 'dependency' | 'sibling';

/**
 * The object names one manifest CLAIMS OWNERSHIP of at install time — the names
 * `registerApp` is about to hand `registerObject` with `ownership: 'own'`.
 *
 * Both authored shapes are read, because `registerApp` reads both: an array of
 * object definitions, or a name-keyed map (whose KEY is the name — `registerApp`
 * overwrites `objDef.name` with it).
 *
 * ⛔ Glob strings are skipped, not treated as names. `ManifestSchema.objects` is
 * `z.array(z.string())` — file patterns — and an unassembled manifest that still
 * carries them registers no object here; a pattern is not an object name, and
 * refusing on one would refuse a package that claims nothing.
 *
 * ⛔ `objectExtensions` are not read: an extension contributes fields to an
 * object it does not own (`ownership: 'extend'`), which is the co-ownership
 * ADR-0130 exists to permit, not the collision it refuses.
 */
function declaredOwnedObjectNames(manifest: ObjectStackManifest): string[] {
  const objects = (manifest as { objects?: unknown }).objects;
  if (!objects || typeof objects !== 'object') return [];
  if (Array.isArray(objects)) {
    return objects
      .map((o) => (o && typeof o === 'object' ? (o as { name?: unknown }).name : undefined))
      .filter((n): n is string => typeof n === 'string' && n !== '');
  }
  return Object.keys(objects as Record<string, unknown>).filter((n) => n !== '');
}

/**
 * [ADR-0130 D3] Raised when two packages delivered by ONE release artifact both
 * claim the same object name.
 *
 * This refusal is the other half of the D1 gate relaxation, and D3 specifies the
 * pair as a machine constraint rather than an instruction because this is the
 * only part of ADR-0130 that can reach customer data. Today's namespace
 * exclusivity is silently carrying a second guarantee: ADR-0048 §3.2 grounds the
 * namespace gate on "two packages with namespace `crm` both try to create
 * `crm_account` and the second fails at the DB", so "no two packages share a
 * namespace" has been proxying for **"no two packages define the same object
 * name."** Relax the first without adding the second and two co-owning packages
 * defining `crm_account` produce either a duplicate `CREATE TABLE` or —
 * driver-dependent — one package silently overwriting the other's table
 * definition.
 *
 * So the check is install-time and ahead of every mutation `installPackage`
 * makes, which puts it ahead of all DDL: the refusal lands before the second
 * package is recorded at all, rather than half-applying an install and blowing
 * up at table creation.
 *
 * Carries the ADR-0112 envelope (`code` + `status`) — the shape this
 * repository's rejection tests assert against, never a bare throw.
 */
/**
 * The words {@link ArtifactObjectNameConflictError} uses per co-ownership
 * source, so a refusal between packages of different artifacts never claims
 * they arrived in one (ADR-0141 D5).
 */
const CO_OWNERSHIP_WORDING: Record<CoOwnershipSource, { conflict: string; relation: string; allowed: string }> = {
  artifact: {
    conflict: 'inside one release artifact',
    relation: 'delivered by the same artifact',
    allowed: 'Sharing a namespace across packages in one artifact is allowed (ADR-0130 D1)',
  },
  dependency: {
    conflict: 'between packages that share a namespace through a declared dependency',
    relation: 'which shares the namespace because one of the two declares the other in `manifest.dependencies`',
    allowed: 'Sharing a namespace through a declared dependency is allowed (ADR-0141 D5)',
  },
  sibling: {
    conflict: 'between sibling packages that share a namespace under one declared parent',
    relation: 'which shares the namespace because both declare the same installed package in `manifest.dependencies`',
    allowed: 'Sharing a namespace between modules of one declared parent is allowed (ADR-0141 D5)',
  },
};

/** One object {@link PackageUninstallExtendedError} names, with the packages extending it. */
interface ExtendedObjectOfUninstall {
  /** The object's fully-qualified name, as the registry keys it. */
  readonly objectName: string;
  /** Every OTHER package contributing an `extend` to it, in registration order. */
  readonly extenders: readonly string[];
}

/** How many extended objects the refusal spells out before it counts the rest. */
const EXTENDED_OBJECTS_LISTED = 5;

/**
 * Separator between an item's name and its bundle discriminator inside a
 * storage key: `pkg:auth.welcome@zh-CN`.
 *
 * `@` is unambiguous here in both directions. A discriminated type's `name` can
 * never contain it (`EmailTemplateDefinitionSchema` pins dotted snake_case),
 * and a scoped package id that does (`@acme/crm:auth.welcome@zh-CN`) is still
 * parsed correctly because {@link bundleBaseKey} only looks for the separator
 * AFTER the last `:`.
 */
const BUNDLE_KEY_SEPARATOR = '@';

/** `pkg:auth.welcome` + `zh-CN` → `pkg:auth.welcome@zh-CN`. */
function withDiscriminator(baseKey: string, value: string): string {
  return `${baseKey}${BUNDLE_KEY_SEPARATOR}${value}`;
}

/**
 * Strip a storage key's bundle suffix: `pkg:auth.welcome@zh-CN` →
 * `pkg:auth.welcome`. Keys of undiscriminated types come back unchanged, and so
 * does a scoped package id's own `@` (the search starts after the last `:`).
 */
function bundleBaseKey(key: string): string {
  const at = key.indexOf(BUNDLE_KEY_SEPARATOR, key.lastIndexOf(':') + 1);
  return at === -1 ? key : key.slice(0, at);
}

/** One member of an i18n bundle, as stored. */
type BundleEntry = { key: string; item: any };

/**
 * [#33127, ADR-0150 D4 "registry overlay slot (ADR-0005)"] The mark that opens
 * and separates a package overlay slot's storage key: the slot of the stored
 * row of `(type, name[, member])` bound to one package, beside the bare slot
 * (a package-less row) and the composite slots (code artifacts). A NUL never
 * occurs in a package id or a name, so no reader of the other two key forms
 * mistakes this one for its own: it is never a bare key (`name`, `name@member`)
 * and never ends `:name` ({@link bundleBaseKey}, {@link collectBundle}, the
 * composite scans), so it adds no holder and is no artifact.
 */
const OVERLAY_SLOT_MARK = '\u0000';

/** `com.acme.alpha` + `auth.welcome@zh-CN` → the package overlay slot key of that member. */
function overlaySlotKey(packageId: string, bareKey: string): string {
  return `${OVERLAY_SLOT_MARK}${packageId}${OVERLAY_SLOT_MARK}${bareKey}`;
}

/** The package and the bare key of a package overlay slot key, or `undefined` for any other key. */
function parseOverlaySlotKey(key: string): { packageId: string; bareKey: string } | undefined {
  if (!key.startsWith(OVERLAY_SLOT_MARK)) return undefined;
  const sep = key.indexOf(OVERLAY_SLOT_MARK, 1);
  return sep < 0 ? undefined : { packageId: key.slice(1, sep), bareKey: key.slice(sep + 1) };
}

/**
 * [#33127] The package overlay slots of `(name)` in `collection`, every member
 * of a bundled type (`disc`), in the store's order: the stored rows bound to a
 * package, one slot per row package.
 */
function overlaySlotEntriesOf(collection: Map<string, any>, name: string, disc?: { field: string; canonical: string }): BundleEntry[] {
  const out: BundleEntry[] = [];
  for (const [key, item] of collection) {
    const slot = parseOverlaySlotKey(key);
    if (slot === undefined) continue;
    if ((disc ? bundleBaseKey(slot.bareKey) : slot.bareKey) === name) out.push({ key, item });
  }
  return out;
}

/** The package a bare-slot or package overlay slot entry's stored row is bound to: the slot's package, else the entry's stamp. */
function storedRowPackageOf(entry: BundleEntry): string | undefined {
  const slot = parseOverlaySlotKey(entry.key);
  if (slot !== undefined) return slot.packageId;
  const stamped = (entry.item as { _packageId?: unknown } | null | undefined)?._packageId;
  return typeof stamped === 'string' && stamped !== '' && stamped !== 'sys_metadata' ? stamped : undefined;
}

/**
 * [ADR-0150 D4] The mark that opens and separates a package-less action's
 * owner-key slot. An action is identified by `(owner, owning object, name)`,
 * so the platform's action bound to `lead` and the environment's object-less
 * action of the same name are two items under two keys, never one contested
 * name. The bare slot `name` holds the package-less action registered last;
 * each package-less action of another owner key it displaced keeps its own
 * slot under this mark, one per owner key. Like {@link OVERLAY_SLOT_MARK}, a
 * control character never occurs in an object or action name, so no reader of
 * the other key forms mistakes this one for its own: it is never a bare key
 * and never ends `:name`, so it adds no package holder and is no artifact.
 */
const PACKAGELESS_ACTION_SLOT_MARK = '\u0001';

/** [ADR-0150 D4] A package-less action's owner key: its object, or `global` for every object-less spelling. */
function packagelessActionOwnerKey(action: unknown): string {
  const owner = standaloneActionOwnerKey(action);
  return isObjectLessActionKey(owner) ? GLOBAL_ACTION_OBJECT_KEY : owner;
}

/** `lead` + `approve` → the owner-key slot of the package-less `approve` bound to `lead`. */
function packagelessActionSlotKey(ownerKey: string, name: string): string {
  return `${PACKAGELESS_ACTION_SLOT_MARK}${ownerKey}${PACKAGELESS_ACTION_SLOT_MARK}${name}`;
}

/**
 * [ADR-0150 D4] The owner-key slots of the package-less action `name`
 * ({@link packagelessActionSlotKey}), in the store's order: the package-less
 * actions of the name beside the one in the bare slot, one per owner key.
 */
function packagelessActionSlotEntriesOf(collection: Map<string, any>, name: string): BundleEntry[] {
  const out: BundleEntry[] = [];
  for (const [key, item] of collection) {
    if (!isPackagelessActionSlotKey(key)) continue;
    const sep = key.indexOf(PACKAGELESS_ACTION_SLOT_MARK, 1);
    if (sep > 0 && key.slice(sep + 1) === name) out.push({ key, item });
  }
  return out;
}

/** Is `key` a package-less action's owner-key slot ({@link packagelessActionSlotKey})? */
function isPackagelessActionSlotKey(key: string): boolean {
  return key.startsWith(PACKAGELESS_ACTION_SLOT_MARK);
}

/**
 * [ADR-0150 D4] Is a package-less action registration a stored row — the
 * environment's `sys_metadata` hydration or write-through — rather than code
 * the host or a plugin registered with no package? A stored row is
 * tenant-authored (ADR-0010 `_provenance: 'org'`), or wears the envelope of
 * the package whose action it customizes (`_packageId`, which code registering
 * with no package never carries).
 */
function isStoredActionRow(item: unknown): boolean {
  if (isTenantAuthored(item)) return true;
  const stamped = (item as { _packageId?: unknown } | null | undefined)?._packageId;
  return typeof stamped === 'string' && stamped !== '';
}

/**
 * [#32408, contract review F2, delta review N1] What a door's registration
 * brings to a bundled name: the package and the members it adds to its
 * composite slot.
 */
interface BundleArrival {
  readonly packageId: string;
  readonly members: ReadonlySet<string>;
}

/**
 * `collection` with `arrival`'s members in its composite slot of `name`, as a
 * copy (the registry's own map is never touched): a member already stored is
 * kept as stored, a new one is a stub carrying its discriminator, which is
 * all a holder's member read takes from it.
 */
function withArrivingMembers(
  collection: Map<string, any>,
  name: string,
  disc: { field: string; canonical: string },
  arrival: BundleArrival,
): Map<string, any> {
  const copy = new Map(collection);
  for (const member of arrival.members) {
    const key = withDiscriminator(`${arrival.packageId}:${name}`, member);
    if (!copy.has(key)) copy.set(key, { name, [disc.field]: member });
  }
  return copy;
}

/**
 * The members of `(type, name)`'s bundle, grouped by the SAME precedence tiers
 * {@link SchemaRegistry.getItem} applies to an undiscriminated type — so
 * bundling changes WHICH ROWS EXIST, never which layer wins:
 *
 *   - `bare`  — bare-key group (`name@<loc>`): the ADR-0005 runtime/DB overlay
 *   - `local` — the `currentPackageId` composite group (ADR-0048 prefer-local)
 *   - `other` — every other composite group, in Map insertion order
 *
 * Within a tier the `canonical` member is first, then insertion order — so a
 * bare-name read of a bundle is decided by the spec's declared fallback locale
 * rather than by which locale the author happened to declare first.
 */
function collectBundle(
  collection: Map<string, any>,
  name: string,
  disc: { field: string; canonical: string },
  currentPackageId?: string,
): { bare: BundleEntry[]; local: BundleEntry[]; other: BundleEntry[] } {
  const bare: BundleEntry[] = [];
  const local: BundleEntry[] = [];
  const other: BundleEntry[] = [];
  const localBase = currentPackageId ? `${currentPackageId}:${name}` : undefined;
  for (const [key, item] of collection) {
    const base = bundleBaseKey(key);
    if (base === name) bare.push({ key, item });
    else if (base.endsWith(`:${name}`)) (localBase && base === localBase ? local : other).push({ key, item });
  }
  const canonicalFirst = (entries: BundleEntry[]) => {
    const idx = entries.findIndex((e) => discriminatorValue(e.item, disc.field) === disc.canonical);
    return idx <= 0 ? entries : [entries[idx], ...entries.filter((_, i) => i !== idx)];
  };
  return { bare: canonicalFirst(bare), local: canonicalFirst(local), other: canonicalFirst(other) };
}

/**
 * [#22877] `entries` narrowed to ONE member of their bundle, order kept. An
 * entry's member is its discriminator value, or the canonical member for an
 * item that declares none — the value {@link SchemaRegistry.registerItem} keys
 * it by. `member` is a discriminator value as a caller names it (`'zh-CN'`); a
 * blank one names the canonical member, as `itemDiscriminator` reads a body.
 */
function entriesOfMember(
  entries: readonly BundleEntry[],
  disc: { field: string; canonical: string },
  member: string,
): BundleEntry[] {
  const wanted = member.trim() || disc.canonical;
  return entries.filter((e) => (discriminatorValue(e.item, disc.field) || disc.canonical) === wanted);
}

/**
 * [#31575] One answer out of bundle `entries` already in tier order, as
 * {@link SchemaRegistry.getItem} picks it: the named `member`, else the
 * canonical member, else the first entry.
 */
function pickBundleMember<T>(
  entries: readonly BundleEntry[],
  disc: { field: string; canonical: string },
  member: string | undefined,
): T | undefined {
  if (member !== undefined) return entriesOfMember(entries, disc, member)[0]?.item as T | undefined;
  return (entriesOfMember(entries, disc, disc.canonical)[0] ?? entries[0])?.item as T | undefined;
}

/**
 * `schema` without the field `name` — `schema` itself, by reference, when it
 * does not carry one. Never mutates its input.
 */
function withoutField(schema: ServiceObject, name: string): ServiceObject {
  const fields = schema.fields as Record<string, unknown> | undefined;
  if (!fields || fields[name] === undefined) return schema;
  const { [name]: _dropped, ...rest } = fields;
  return { ...schema, fields: rest } as ServiceObject;
}

/**
 * [#33050] One item slot (or one claimed name) of a package body, as
 * {@link SchemaRegistry.replacingPackageBody} records it: the type and the key,
 * joined by a character no type name carries.
 */
function packageBodySlot(type: string, key: string): string {
  return `${type}\u0000${key}`;
}

/**
 * [#33593] How the follow door is asked of one layer
 * ({@link SchemaRegistry.recordCurrencyFollowRefusalOf}): its slot's package,
 * the priority it sorts at (the slot's, when omitted), and `before` — what the
 * slot held before the change being judged, `null` for an empty slot.
 */
interface FollowDoorLayer {
  readonly packageId: string | undefined;
  readonly priority?: number;
  readonly before: ObjectContributor | null;
}

/**
 * One object layer a registration run registered: the body its registration's
 * doors judged, and the contributor it became — the registry's own entry, so
 * the run's end can tell a layer a later write of the run took out again, and
 * reads the kind the layer holds by then.
 */
interface RunRegisteredObject {
  readonly fqn: string;
  readonly schema: ServiceObject;
  readonly contributor: ObjectContributor;
  /**
   * What the layer's slot held before the run's first write to it, or `null`
   * when it was empty: the run's end judges the layer against the object as
   * it was served with this in its place, so a pair the run leaves as it
   * found it is not the run's to answer for (#33593 ruling R7).
   */
  readonly replaced: ObjectContributor | null;
}

/**
 * [#31697] Does one of an action's stored environment rows (the protocol's
 * by-name row read: active, the environment's own) belong to no package and
 * bind no object — the row the environment's own object-less item comes
 * from? Its `package_id` column decides the binding; its body's owner key
 * ({@link standaloneActionOwnerKey}) the object. A body that does not parse
 * is no such row.
 */
function storesObjectLessPackagelessRow(rows: readonly { package_id?: string | null; metadata?: unknown }[]): boolean {
  return rows.some((row) => {
    if (row?.package_id !== null && row?.package_id !== undefined && row?.package_id !== '') return false;
    let body: unknown;
    try {
      body = typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : row?.metadata;
    } catch {
      return false;
    }
    return body !== null && typeof body === 'object' && isObjectLessActionKey(standaloneActionOwnerKey(body));
  });
}

// [#33949 codemod] Declared above without `export`, and read by `registry.ts` or a section module.
export {
  BundleArrival, BundleEntry, CO_OWNERSHIP_WORDING, EXTENDED_OBJECTS_LISTED, ExtendedObjectOfUninstall,
  FoldedExtensionFields, FollowDoorLayer, NO_PACKAGE_REFERRER, OBJECT_FOLD_SCALAR_KEYS, OVERLAY_SLOT_MARK,
  OWNING_BUSINESS_UNIT_FIELD, ObjectExtensionBody, ObjectFoldScalarKey, PicklistItemLike, PicklistReferrer,
  QUEUE_FIELD, RunRegisteredObject, SECURITY_CATALOG_NAME_RULE, ServedObjectLayer, TenantRuleSettings,
  WithheldExtensions, admittedFieldPatches, applyFieldPatches, bareNameConflictLine, bareNameReasonFor, bundleBaseKey,
  carriesTenantScopeColumn, changedPackagedRuleKeys, coldBootConflictMessage, collectBundle, declaredOwnedObjectNames,
  declaresTenantIndex, displayKeyOverridesPackagedBase, entriesOfMember, fieldNamesOf, fieldPatchYieldKey, foldScalarOverridesPackagedBase,
  indexKeysOf, isLeftOutExtension, isPackagelessActionSlotKey, isPlainRecord, isStoredActionRow, leavesExtensionsOut,
  mergeValidationsByName, optionByValue, overlaySlotEntriesOf, overlaySlotKey, ownFieldNamesOf, ownFieldsTarget,
  packageBodySlot, packagedAddedFields, packagelessActionOwnerKey, packagelessActionSlotEntriesOf,
  packagelessActionSlotKey, parseOverlaySlotKey, parsePackageAction, parsePackageObjectActions, pickBundleMember,
  picklistReferrerOf, recordFieldOf, ruleNamesOf, sameActionDeclaration, sameHolder, sortActionsByOrder,
  stableStringify, storedRowPackageOf, storesObjectLessPackagelessRow, tenantRuleSettingsOf, toRecordManifest,
  validationRuleName, withArrivingMembers, withDeclaredFunctionEntries, withDiscriminator, withTenantRuleSettings,
  withoutField, withoutWithheldMembers,
};
