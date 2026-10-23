// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 9] The field readers of `SecurityPlugin`, moved out of
 * `security-plugin.ts`:
 *
 * - `resolveProjectionFieldMask`, the derivation every published field
 *   projection shares: the schema's field universe, the caller's permission
 *   sets (the configured fallback set on the metadata plane), the posture its
 *   gates read, the evaluator's field map with the per-field capability fold,
 *   and the delegator's intersection, refused where the middleware's prologue
 *   refuses the delegator (#25107).
 * - `computeReadableFields`, the readable projection the data plane's and the
 *   metadata plane's readers both answer from: every schema field not masked
 *   non-readable, a partially masked field kept as a served column (#8993).
 * - `resolveCallerPosture`, the one object posture a caller's gates read, the
 *   middleware's and the projections' alike, with the stand-in for a caller
 *   who resolved no set (#20995, #21063).
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same universe, the same steps in the same
 * order, the same answers. What only these bodies read moved with them, also
 * unedited: `EMPTY_REQUIRED_PERMISSIONS`, the stand-in's empty capability
 * contract, and the `intersectFieldMasks` import name.
 *
 * ## How the moved bodies reach the class
 *
 * The shape cuts 1 to 8 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps all three private methods — the
 * published `dist/*.d.ts` lists each one's name, docblock and position — and
 * each body is one literal of exactly the {@link FieldReadersHost} members that
 * method reads, plus a `.call`. A method is handed over as a closure that calls
 * it on the plugin at call time, so a test double or spy set on the plugin is
 * still the one the body reaches: the derivation still asks the plugin's field
 * universe, set resolution, fallback sets, posture and field folds, and the
 * four public projections and the middleware still reach these methods
 * through the plugin. All three methods were async and all three functions
 * still are; each method now returns its function's promise.
 *
 * Each field was classified on its own declaration, by the rule cut 1 set.
 * `metadata`, `permissionEvaluator`, `ql` and `tenancyPosture` are not
 * declared `readonly` (`start()` assigns three of them after construction,
 * and tests replace `permissionEvaluator` on a constructed plugin), so they go
 * as GETTERS, and each read happens when the body makes it.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * The four public projections stay in the class whole —
 * `getReadableFields`, `getMetadataReadableFields`, `getWritableFields` and
 * `getQueryableFields` — because each body is no longer than its stub would
 * be. The posture type `ObjectSecurityMeta` keeps its one declaration there,
 * where the posture reader and every gate read it; this module names it
 * through the class's own signature, and the capability-contract type through
 * the posture's own field (below). `PermissionSet` is imported from
 * `@objectstack/spec/security`, `FieldMaskingRule` from
 * `@objectstack/spec/data`, and the delegator's resolution and its
 * organization check from `explain-engine.js`, as `security-plugin.ts` imports
 * them.
 *
 * The system-context page anchors the projections' elevation read on this
 * module's `resolveProjectionFieldMask`, which is where the read now sits.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { SecurityPlugin } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';
import type { FieldMaskingRule } from '@objectstack/spec/data';
import { delegatedOrganizationRefusal, intersectFieldMasks, resolveDelegatorContext } from './explain-engine.js';

/**
 * The `SecurityPlugin` members the functions below read — every one of them,
 * and no other; each function's `this` is the `Pick` of the members IT reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface FieldReadersHost {
  readonly metadata: SecurityPlugin['metadata'];
  readonly permissionEvaluator: SecurityPlugin['permissionEvaluator'];
  readonly ql: SecurityPlugin['ql'];
  readonly tenancyPosture: SecurityPlugin['tenancyPosture'];
  computeQueryGuardFieldPerms: SecurityPlugin['computeQueryGuardFieldPerms'];
  computeReadPartialMaskRules: SecurityPlugin['computeReadPartialMaskRules'];
  foldFieldRequiredPermissions: SecurityPlugin['foldFieldRequiredPermissions'];
  getObjectFieldNames: SecurityPlugin['getObjectFieldNames'];
  getObjectSecurityMeta: SecurityPlugin['getObjectSecurityMeta'];
  resolveCallerPosture: SecurityPlugin['resolveCallerPosture'];
  resolveFallbackPermissionSets: SecurityPlugin['resolveFallbackPermissionSets'];
  resolvePermissionSetsForContext: SecurityPlugin['resolvePermissionSetsForContext'];
  resolveProjectionFieldMask: SecurityPlugin['resolveProjectionFieldMask'];
}

/**
 * The posture type, named through the class's own signature: the interface
 * stays in `security-plugin.ts`, where the posture reader and every gate read
 * it.
 */
type ObjectSecurityMeta = Awaited<ReturnType<SecurityPlugin['getObjectSecurityMeta']>>;
/** The capability-contract type, named through the posture's own field. */
type NormalizedRequiredPermissions = ObjectSecurityMeta['requiredPermissions'];

const EMPTY_REQUIRED_PERMISSIONS: NormalizedRequiredPermissions = Object.freeze({
  all: [], read: [], create: [], update: [], delete: [],
}) as NormalizedRequiredPermissions;

/** The body of `SecurityPlugin#computeReadableFields`; the method's docblock there is its contract. */
export async function computeReadableFields(
  this: Pick<FieldReadersHost, 'resolveProjectionFieldMask'>,
  object: string,
  context: any,
  options: { fallbackOnEmptySets: boolean },
): Promise<string[] | undefined> {
  const mask = await this.resolveProjectionFieldMask(object, context, options);
  if (mask.kind === 'answer') return mask.fields;

  // [#8993] A field this caller sees PARTIALLY MASKED is still a served
  // column — the read path REPLACES its value rather than deleting the key —
  // so it stays in the projection (an export header must include the column
  // whose masked values the same caller's rows carry). Mirrors the step-4
  // exclusion exactly: an explicit permission-set deny keeps the field
  // deleted, hence out of the projection.
  const partialRules = mask.readPartialMaskRules();

  // Readable = every schema field NOT explicitly masked non-readable. A field
  // with no permission entry passes through (the field allow-list only
  // enumerates fields it names) — the exact complement of maskResults' delete
  // set, so the export header matches list's readable columns by construction.
  return mask.allFields.filter((f) => mask.fieldPerms[f]?.readable !== false || partialRules[f] !== undefined);
}

/** The body of `SecurityPlugin#resolveProjectionFieldMask`; the method's docblock there is its contract. */
export async function resolveProjectionFieldMask(
  this: Pick<FieldReadersHost, 'computeQueryGuardFieldPerms' | 'computeReadPartialMaskRules' | 'foldFieldRequiredPermissions' | 'getObjectFieldNames' | 'metadata' | 'permissionEvaluator' | 'ql' | 'resolveCallerPosture' | 'resolveFallbackPermissionSets' | 'resolvePermissionSetsForContext' | 'tenancyPosture'>,
  object: string,
  context: any,
  options: { fallbackOnEmptySets: boolean },
): Promise<
  | { kind: 'answer'; fields: string[] | undefined }
  | {
    kind: 'mask';
    allFields: string[];
    fieldPerms: Record<string, { readable: boolean; editable: boolean }>;
    readPartialMaskRules: () => Record<string, FieldMaskingRule>;
    /** [#20935] The middleware's query-guard map for these sets (computeQueryGuardFieldPerms). */
    readQueryGuardPerms: () => Record<string, { readable: boolean; editable: boolean }>;
  }
> {
  const objectName = String(object ?? '');
  if (!objectName) return { kind: 'answer', fields: undefined };
  // The field universe — the SAME source the RLS field pass uses (ObjectQL's
  // live SchemaRegistry first, metadata artifact fallback). `null` → schema
  // not resolvable → let the caller fall back rather than guess.
  const fieldNameSet = await this.getObjectFieldNames(this.metadata, objectName, this.ql);
  if (!fieldNameSet) return { kind: 'answer', fields: undefined };
  const allFields = [...fieldNameSet];
  // System operations bypass FLS (mirrors the middleware's isSystem skip).
  if (context?.isSystem) return { kind: 'answer', fields: allFields };

  let permissionSets = await this.resolvePermissionSetsForContext(context);
  if (permissionSets.length === 0 && options.fallbackOnEmptySets) {
    // [ADR-0106 D7] `resolvePermissionSetsForContext` applies the baseline
    // only for a caller carrying `userId`, so a guest/anonymous caller lands
    // here with nothing. Resolve the configured fallback set explicitly —
    // the same two-step `/auth/me/permissions` performs.
    permissionSets = await this.resolveFallbackPermissionSets(context);
  }
  // [#21908] ADR-0096 D5 strict mode. A principal-less context used to be
  // settled here with the full field set, because the middleware handed it
  // through and no field gate reached it. The middleware now refuses it
  // before any field gate, as it refuses the read of any caller who resolves
  // no set ([#21079]), so it is no longer a case of its own: like every
  // caller who resolves no set, the object's masking rules and [#21063]
  // per-field capability contract reach it (resolveCallerPosture) and it
  // falls through to the mask below. Its object admission is not decided
  // here — `canReadObject` / `canWriteObject` answer it `false`.

  const secMeta = await this.resolveCallerPosture(objectName, permissionSets);
  // [#3545] Posture unresolvable → expose no columns, the same fail-closed
  // stance this method already takes on a dangling delegator below. The
  // per-field capability contract (`fieldRequiredPermissions`) would otherwise
  // default to empty and silently unmask every capability-gated column, and
  // [#20995] the masking rules a caller with no set is held to are unknown
  // ([#21063] as is that caller's field capability contract).
  if (secMeta.unresolved) return { kind: 'answer', fields: [] };
  const basePerms = this.permissionEvaluator.getFieldPermissions(objectName, permissionSets);
  let fieldPerms = this.foldFieldRequiredPermissions(basePerms, secMeta.fieldRequiredPermissions, permissionSets);

  // [ADR-0090 D10] On an on-behalf-of request the projection must NOT widen
  // past the DELEGATOR's — intersect the delegator's field mask too. A
  // dangling delegator fails CLOSED (expose no columns), the same fail-closed
  // stance the CRUD middleware takes on a 'missing' delegator; [#25107] and so
  // does a delegator who is not a member of the organization the request runs
  // in, on a walled posture, which the middleware's prologue refuses
  // ({@link delegatedOrganizationRefusal}). [#20995] Asked
  // only when the caller resolved a set, as the middleware asks it: a caller
  // who resolved none reaches here only for its masking rules and [#21063]
  // its field capability contract, and every one of them already applies to
  // it.
  let delBasePerms: Record<string, { readable: boolean; editable: boolean }> | null = null;
  let delegatorSets: PermissionSet[] | null = null;
  if (permissionSets.length > 0 && context?.onBehalfOf?.userId) {
    const del = await resolveDelegatorContext(this.ql, context);
    if (del.kind === 'missing') return { kind: 'answer', fields: [] };
    if (del.kind === 'resolved') {
      if (delegatedOrganizationRefusal(context, del.context, this.tenancyPosture) !== undefined) {
        return { kind: 'answer', fields: [] };
      }
      delegatorSets = await this.resolvePermissionSetsForContext(del.context);
      delBasePerms = this.permissionEvaluator.getFieldPermissions(objectName, delegatorSets);
      let delFieldPerms = this.foldFieldRequiredPermissions(delBasePerms, secMeta.fieldRequiredPermissions, delegatorSets);
      fieldPerms = intersectFieldMasks(fieldPerms, delFieldPerms);
    }
  }

  return {
    kind: 'mask',
    allFields,
    fieldPerms,
    readPartialMaskRules: () => this.computeReadPartialMaskRules(
      secMeta, permissionSets, delegatorSets, basePerms, delBasePerms,
    ),
    readQueryGuardPerms: () => this.computeQueryGuardFieldPerms(
      objectName, secMeta, permissionSets, delegatorSets,
    ),
  };
}

/** The body of `SecurityPlugin#resolveCallerPosture`; the method's docblock there is its contract. */
export async function resolveCallerPosture(
  this: Pick<FieldReadersHost, 'getObjectSecurityMeta'>,
  object: string,
  permissionSets: PermissionSet[],
): Promise<ObjectSecurityMeta> {
  const posture = await this.getObjectSecurityMeta(object);
  if (permissionSets.length > 0) return posture;
  return {
    isPrivate: false,
    tenancyDisabled: false,
    isBetterAuthManaged: false,
    tenantAnchorIsPhantom: false,
    owdOpensRowWrites: false,
    requiredPermissions: EMPTY_REQUIRED_PERMISSIONS,
    fieldRequiredPermissions: posture.fieldRequiredPermissions,
    fieldMaskingRules: posture.fieldMaskingRules,
    unresolved: posture.unresolved,
    // [#10401] Explanation only, and present only on the refusing path.
    unresolvedCause: posture.unresolvedCause,
  };
}
