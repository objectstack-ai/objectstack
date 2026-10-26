// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 1] The leaf readers of `SecurityPlugin` — the per-object inputs
 * every gate layer reads: the row-level security policy collection (with its
 * ADR-0105 D3 admission and the authored-tenant-policy warning), the
 * unresolved-posture probes, the field-level masks and required-permission
 * folds, and the field-name tables — moved out of `security-plugin.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same reads, the same verdicts, the same caches,
 * failing open or closed exactly where they did. The one module-level
 * declaration only these bodies read moved with them, also unedited:
 * `isDelegatedPrincipalLeg`.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), applied per method. The class keeps
 * every method — the published `dist/*.d.ts` lists each one's name,
 * docblock and position — and each body is one literal of exactly the
 * {@link ObjectInputsHost} members that method reads, plus a `.call`; a body
 * that reads no member takes no host and is called directly. The `async`
 * methods are no longer `async`: each returns the moved function's own
 * promise, so a caller awaits the same promise the body settles, with no extra
 * wrapper. A method is handed over as a closure that calls it on the plugin at
 * call time, so a test double or spy set on the plugin is still the one the
 * body reaches — the moved bodies that call one another (the policy
 * collection's admission, the probes, the mask and fold helpers, the
 * field-name loader) do so through the plugin, exactly as before.
 *
 * Each member was classified on its own declaration, one rule for all: a field
 * declared `readonly` (the caches, `ownershipFloorAlternates`,
 * `warnedAuthoredTenantPolicies`) goes by value, because it is never
 * reassigned; every other field (`ql`, `metadata`, `logger`, `rlsCompiler`,
 * `permissionEvaluator`, `fieldMasker`) and the `orgScopingEnabled` accessor
 * goes as a GETTER, so each read happens when the body makes it — `start()`
 * assigns `ql`, `metadata` and `logger` after construction, and tests replace
 * `permissionEvaluator` on a constructed plugin.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { SecurityPlugin } from './security-plugin.js';
import type { PermissionSet, RowLevelSecurityPolicy } from '@objectstack/spec/security';
import type { FieldMaskingRule, NumberComparandDoorFieldMeta } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { MatchesFilterOptions } from '@objectstack/formula';
import type { FieldConditionVerdict } from '@objectstack/core';
import { intersectFieldMasks } from './explain-engine.js';
import { storedFormCheckJudge } from './rls-check-stored-form.js';
import type { FieldConditionJudge } from './permission-evaluator.js';
import type { RlsFieldGuard } from './rls-compiler.js';
import { declaredComparisonColumns } from './declared-comparison-columns.js';
import { isPlatformTenantPolicy, isAuthoredTenantPolicy } from './platform-tenant-policies.js';
import { objectDefaultRowScopePolicy } from './object-default-row-scope.js';
import { withOwnershipFloorAlternates } from './platform-ownership-policies.js';
import type { UnresolvedPostureCause } from './unresolved-posture.js';

/**
 * [ADR-0090 D10; ruling of record 6278784335 on #24341, letter B] Whether
 * `context` is a DELEGATED principal's own leg — an agent acting on behalf of
 * a user, whose sets are its ceiling and whose row bound is the delegator's
 * leg, AND-ed in beside it. The spelling is the read door's own test for the
 * delegated case (`onBehalfOf.userId`); the delegator's leg runs on the
 * context `resolveDelegatorContext` rebuilt, which carries none.
 *
 * Read by {@link SecurityPlugin.collectRLSPolicies} alone: a ceiling's silence
 * is not Layer 1 silence, so the object's declared default row scope is not
 * collected on that leg. Every row bound comes from the delegator, as before
 * the identity objects declared their defaults.
 */
function isDelegatedPrincipalLeg(context: unknown): boolean {
  const onBehalfOf = (context as { onBehalfOf?: { userId?: unknown } } | null | undefined)?.onBehalfOf;
  return typeof onBehalfOf?.userId === 'string' && onBehalfOf.userId !== '';
}

/**
 * The posture `getObjectSecurityMeta` resolves, as the class declares it: the
 * `ObjectSecurityMeta` interface stays in `security-plugin.ts` beside its one
 * producer, and the moved signatures name it exactly as they did.
 */
type ObjectSecurityMeta = Awaited<ReturnType<SecurityPlugin['getObjectSecurityMeta']>>;

/**
 * The `SecurityPlugin` members the functions below read — every one of them,
 * and no other; each function's `this` is the `Pick` of the members IT reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface ObjectInputsHost {
  readonly datetimeFieldNamesCache: SecurityPlugin['datetimeFieldNamesCache'];
  readonly fieldMasker: SecurityPlugin['fieldMasker'];
  readonly fieldNamesCache: SecurityPlugin['fieldNamesCache'];
  readonly logger: SecurityPlugin['logger'];
  readonly metadata: SecurityPlugin['metadata'];
  readonly numberComparandFieldsCache: SecurityPlugin['numberComparandFieldsCache'];
  readonly orgScopingEnabled: SecurityPlugin['orgScopingEnabled'];
  readonly ownershipFloorAlternates: SecurityPlugin['ownershipFloorAlternates'];
  readonly permissionEvaluator: SecurityPlugin['permissionEvaluator'];
  readonly ql: SecurityPlugin['ql'];
  readonly rlsCompiler: SecurityPlugin['rlsCompiler'];
  readonly tenancyDisabledCache: SecurityPlugin['tenancyDisabledCache'];
  readonly warnedAuthoredTenantPolicies: SecurityPlugin['warnedAuthoredTenantPolicies'];
  admitCollectedPolicy: SecurityPlugin['admitCollectedPolicy'];
  computePartialMaskRules: SecurityPlugin['computePartialMaskRules'];
  computeReadPartialMaskRules: SecurityPlugin['computeReadPartialMaskRules'];
  foldFieldRequiredPermissions: SecurityPlugin['foldFieldRequiredPermissions'];
  getObjectFieldNames: SecurityPlugin['getObjectFieldNames'];
  loadObjectFieldNames: SecurityPlugin['loadObjectFieldNames'];
  probeMetadataOutage: SecurityPlugin['probeMetadataOutage'];
  probeUnpublishedDraft: SecurityPlugin['probeUnpublishedDraft'];
  warnAuthoredTenantPolicyOnce: SecurityPlugin['warnAuthoredTenantPolicyOnce'];
  writeCheckFieldOptions: SecurityPlugin['writeCheckFieldOptions'];
}

/** The body of `SecurityPlugin#collectRLSPolicies`; the method's docblock there is its contract. */
export function collectRLSPolicies(
  this: Pick<ObjectInputsHost, 'admitCollectedPolicy' | 'ownershipFloorAlternates' | 'ql' | 'rlsCompiler'>,
  permissionSets: PermissionSet[],
  objectName: string,
  operation: string,
  heldPositions: string[] | undefined,
  principal: unknown,
): RowLevelSecurityPolicy[] {
  const allPolicies: RowLevelSecurityPolicy[] = [];
  const floorAlternates = this.ownershipFloorAlternates.all();

  for (const ps of permissionSets) {
    if (ps.rowLevelSecurity) {
      // [#21729] A contributed alternate match lands BESIDE the floor policy
      // it relieves, in the floor's own domain, and only in a set that ships
      // an enabled floor of its limb (`withOwnershipFloorAlternates`). Every
      // reader of the collection — the by-id pre-image gate, the bulk write
      // filter, the post-image check, `checkAuthoredRowWrite`, explain — sees
      // the same list, because this is the one place they all collect from.
      for (const policy of withOwnershipFloorAlternates(ps.rowLevelSecurity, floorAlternates)) {
        if (this.admitCollectedPolicy(policy, objectName)) allPolicies.push(policy);
      }
    }
  }

  const held = this.rlsCompiler.getApplicablePolicies(objectName, operation, allPolicies, heldPositions);
  if (held.length > 0 || isDelegatedPrincipalLeg(principal)) return held;
  // [#24164 ruling E′] The held sets are silent on this object and
  // operation: the object's own `defaultRowScope`, if it declares one. Read
  // from the registry the engine compiles every find against, only here, on
  // an empty collection (two in-memory map lookups, no I/O).
  const schema = typeof this.ql?.getSchema === 'function' ? this.ql.getSchema(objectName) : null;
  const objectDefault = objectDefaultRowScopePolicy(objectName, schema);
  if (objectDefault === null || !this.admitCollectedPolicy(objectDefault, objectName)) return held;
  return this.rlsCompiler.getApplicablePolicies(objectName, operation, [objectDefault], heldPositions);
}

/** The body of `SecurityPlugin#admitCollectedPolicy`; the method's docblock there is its contract. */
export function admitCollectedPolicy(
  this: Pick<ObjectInputsHost, 'orgScopingEnabled' | 'warnAuthoredTenantPolicyOnce'>,
  policy: RowLevelSecurityPolicy,
  objectName: string,
): boolean {
  if (!this.orgScopingEnabled && isPlatformTenantPolicy(policy)) {
    return false;
  }
  if (!this.orgScopingEnabled && isAuthoredTenantPolicy(policy)) {
    this.warnAuthoredTenantPolicyOnce(policy, objectName);
  }
  return true;
}

/** The body of `SecurityPlugin#warnAuthoredTenantPolicyOnce`; the method's docblock there is its contract. */
export function warnAuthoredTenantPolicyOnce(
  this: Pick<ObjectInputsHost, 'logger' | 'warnedAuthoredTenantPolicies'>,
  policy: RowLevelSecurityPolicy,
  objectName: string,
): void {
  const key = `${objectName} ${policy.name ?? ''}`;
  if (this.warnedAuthoredTenantPolicies.has(key)) return;
  this.warnedAuthoredTenantPolicies.add(key);
  this.logger.warn?.(
    '[security/ADR-0105] authored RLS policy references the active organization but org isolation ' +
      'is inactive — it is retained and will fail closed (zero rows). Install ' +
      '@objectstack/organizations (or drop the policy) if this is not intended.',
    { object: objectName, policy: policy.name, using: policy.using },
  );
}

/** The body of `SecurityPlugin#resolveUnresolvedCause`; the method's docblock there is its contract. */
export async function resolveUnresolvedCause(
  this: Pick<ObjectInputsHost, 'probeMetadataOutage' | 'probeUnpublishedDraft'>,
  object: string,
): Promise<UnresolvedPostureCause> {
  if (await this.probeMetadataOutage(object)) return 'metadata_unavailable';
  return await this.probeUnpublishedDraft(object);
}

/** The body of `SecurityPlugin#probeMetadataOutage`; the method's docblock there is its contract. */
export async function probeMetadataOutage(
  this: Pick<ObjectInputsHost, 'metadata'>,
  object: string,
): Promise<boolean> {
  const service = this.metadata as
    | { getDiagnosed?: (type: string, name: string) => Promise<{ degraded?: unknown }> }
    | undefined;
  if (typeof service?.getDiagnosed !== 'function') return false;
  try {
    const diagnosed = await service.getDiagnosed('object', object);
    return diagnosed?.degraded === true;
  } catch {
    return false;
  }
}

/** The body of `SecurityPlugin#probeUnpublishedDraft`; the method's docblock there is its contract. */
export async function probeUnpublishedDraft(
  this: Pick<ObjectInputsHost, 'ql'>,
  object: string,
): Promise<UnresolvedPostureCause> {
  if (typeof this.ql?.findOne !== 'function') return 'unknown';
  try {
    const row = await this.ql.findOne('sys_metadata', {
      where: { type: 'object', name: object, state: 'draft' },
      context: { isSystem: true },
    });
    return row ? 'unpublished_draft' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The body of `SecurityPlugin#computePartialMaskRules`; the method's docblock there is its contract. */
export function computePartialMaskRules(
  this: Pick<ObjectInputsHost, 'permissionEvaluator'>,
  secMeta: { fieldMaskingRules: Record<string, FieldMaskingRule>; fieldRequiredPermissions: Record<string, string[]> },
  permissionSets: PermissionSet[],
  delegatorSets: PermissionSet[] | null,
): Record<string, FieldMaskingRule> {
  const entries = Object.entries(secMeta.fieldMaskingRules ?? {});
  if (entries.length === 0) return {};
  const held = this.permissionEvaluator.getSystemPermissions(permissionSets);
  const delHeld = delegatorSets ? this.permissionEvaluator.getSystemPermissions(delegatorSets) : null;
  const out: Record<string, FieldMaskingRule> = {};
  for (const [field, rule] of entries) {
    const caps = secMeta.fieldRequiredPermissions[field] ?? [];
    const unmasked =
      caps.length > 0 &&
      caps.every((c) => held.has(c)) &&
      (!delHeld || caps.every((c) => delHeld.has(c)));
    if (!unmasked) out[field] = rule;
  }
  return out;
}

/** The body of `SecurityPlugin#computeQueryGuardFieldPerms`; the method's docblock there is its contract. */
export function computeQueryGuardFieldPerms(
  this: Pick<ObjectInputsHost, 'computePartialMaskRules' | 'foldFieldRequiredPermissions' | 'permissionEvaluator'>,
  objectName: string,
  secMeta: Pick<ObjectSecurityMeta, 'fieldMaskingRules' | 'fieldRequiredPermissions'>,
  permissionSets: PermissionSet[],
  delegatorSets: PermissionSet[] | null,
): Record<string, { readable: boolean; editable: boolean }> {
  let guard = this.permissionEvaluator.getFieldPermissions(objectName, permissionSets);
  guard = this.foldFieldRequiredPermissions(guard, secMeta.fieldRequiredPermissions, permissionSets);
  if (delegatorSets) {
    let delegatorGuard = this.permissionEvaluator.getFieldPermissions(objectName, delegatorSets);
    delegatorGuard = this.foldFieldRequiredPermissions(delegatorGuard, secMeta.fieldRequiredPermissions, delegatorSets);
    guard = intersectFieldMasks(guard, delegatorGuard);
  }
  const out: Record<string, { readable: boolean; editable: boolean }> = { ...guard };
  for (const f of Object.keys(this.computePartialMaskRules(secMeta, permissionSets, delegatorSets))) {
    if (out[f]?.readable !== false) {
      out[f] = { readable: false, editable: out[f]?.editable ?? false };
    }
  }
  return out;
}

/**
 * [#25866] The row a field write is judged on, for the row-conditioned
 * entries (`FieldPermissionSchema.when`) the caller's sets may carry.
 */
export interface FieldWriteRow {
  /** The engine operation the payload rides on. */
  operation: 'insert' | 'update';
  /** The caller's execution context — the `current_user` a `when` resolves against. */
  context: ExecutionContext | undefined;
  /**
   * On an `update`, the stored row the write will change, read as the CALLER
   * reads it (the middleware's memoised pre-image), fetched only when some set
   * carries a `when` for the object. `null` means there is no row to judge —
   * a predicate update, a row absent or invisible to the caller — and absent
   * means the caller holds none (`canWriteObject`): both judge every
   * conditioned entry as its LOCK. Unread on an `insert`, which is judged on
   * each incoming row of the payload.
   */
  preImage?: () => Promise<Record<string, unknown> | null>;
}

/** The entries with a `when` on `objectName` across the sets, as authored (distinct). */
function conditionsOn(objectName: string, sets: ReadonlyArray<PermissionSet | null | undefined>[]): Set<string> {
  const out = new Set<string>();
  const prefix = `${objectName}.`;
  for (const list of sets) {
    for (const ps of list) {
      if (!ps?.fields) continue;
      for (const [key, perm] of Object.entries(ps.fields)) {
        const when = (perm as { when?: string } | null | undefined)?.when;
        if (when !== undefined && key.startsWith(prefix)) out.add(when);
      }
    }
  }
  return out;
}

/** The body of `SecurityPlugin#computeForbiddenFieldWrites`; the method's docblock there is its contract. */
export async function computeForbiddenFieldWrites(
  this: Pick<
    ObjectInputsHost,
    | 'datetimeFieldNamesCache'
    | 'fieldMasker'
    | 'foldFieldRequiredPermissions'
    | 'getObjectFieldNames'
    | 'logger'
    | 'metadata'
    | 'numberComparandFieldsCache'
    | 'permissionEvaluator'
    | 'ql'
    | 'rlsCompiler'
    | 'writeCheckFieldOptions'
  >,
  objectName: string,
  data: Record<string, any> | Record<string, any>[],
  secMeta: Pick<ObjectSecurityMeta, 'fieldRequiredPermissions'>,
  permissionSets: PermissionSet[],
  delegatorSets: PermissionSet[] | null,
  row: FieldWriteRow,
): Promise<string[]> {
  const perms = (judge: FieldConditionJudge | undefined): Record<string, { readable: boolean; editable: boolean }> => {
    let fieldPerms = this.permissionEvaluator.getFieldPermissions(objectName, permissionSets, judge);
    fieldPerms = this.foldFieldRequiredPermissions(fieldPerms, secMeta.fieldRequiredPermissions, permissionSets);
    if (delegatorSets) {
      let delFieldPerms = this.permissionEvaluator.getFieldPermissions(objectName, delegatorSets, judge);
      delFieldPerms = this.foldFieldRequiredPermissions(delFieldPerms, secMeta.fieldRequiredPermissions, delegatorSets);
      fieldPerms = intersectFieldMasks(fieldPerms, delFieldPerms);
    }
    return fieldPerms;
  };
  const forbiddenUnder = (payload: Record<string, any> | Record<string, any>[], fieldPerms: Record<string, { readable: boolean; editable: boolean }>): string[] =>
    Object.keys(fieldPerms).length === 0 ? [] : this.fieldMasker.detectForbiddenWrites(payload, fieldPerms);

  // No set carries a `when` for this object: the row-blind derivation, as
  // before — no row is read, no predicate compiled.
  const conditions = conditionsOn(objectName, [permissionSets, delegatorSets ?? []]);
  if (conditions.size === 0) return forbiddenUnder(data, perms(undefined));

  // [#25866 / ruling of record 6408558941] Some entry votes per row. The row
  // is the incoming row of an insert, each one of a bulk payload on its own,
  // or the stored row of a by-id update, read BEFORE the write as the caller
  // reads it. Each distinct `when` is compiled ONCE, in process — the same
  // compile, user context, field guard and comparand faces an RLS `check`
  // clause takes (`RLSCompiler.compileRowPredicate`) — and judged by the write
  // gate's own stored-form judge (`storedFormCheckJudge` over
  // `matchesFilterCondition`), never by a query rewrite. A condition that
  // yields no filter (an unresolved `current_user.*` for this caller, a column
  // the object does not declare, a comparand the faces refuse — all refused at
  // authoring by the lint rule, so only a request-time cause reaches here) or
  // a row that cannot be judged (no pre-image) leaves the entry `unjudged`: its
  // LOCK, the fail-closed reading, and the line below says why.
  const rows: Array<Record<string, unknown> | null> = row.operation === 'insert'
    ? (Array.isArray(data) ? data : [data]).map((r) => (r && typeof r === 'object' ? r : null))
    : [row.preImage ? await row.preImage() : null];
  const unjudged: FieldConditionJudge = () => 'unjudged';
  if (rows.every((r) => r === null)) {
    if (row.operation === 'update') {
      this.logger.warn?.(
        `[Security] A field permission on '${objectName}' carries a row condition (when) but the ` +
          `${row.preImage ? 'stored row could not be read as the caller (absent or invisible)' : 'update addresses no single row (predicate update, or a reader that holds no row)'}; ` +
          'each conditioned entry is applied as its lock on this write.',
      );
    }
    return forbiddenUnder(data, perms(unjudged));
  }

  const declared = await this.getObjectFieldNames(this.metadata, objectName, this.ql);
  const fieldGuard: RlsFieldGuard | undefined = declared
    ? {
        declared,
        datetime: this.datetimeFieldNamesCache.get(objectName),
        number: this.numberComparandFieldsCache.get(objectName),
      }
    : undefined;
  const columns = await this.writeCheckFieldOptions(objectName);
  const judges = new Map<string, ((image: Record<string, unknown>) => boolean) | null>();
  for (const when of conditions) {
    const outcome = this.rlsCompiler.compileRowPredicate(when, row.context, fieldGuard);
    if (outcome.filter) {
      judges.set(when, storedFormCheckJudge([outcome.filter], columns));
    } else {
      judges.set(when, null);
      this.logger.warn?.(
        `[Security] A field permission on '${objectName}' carries a row condition that cannot be judged for this ` +
          `request (${outcome.cause.reason}) and is applied as its lock: ${when} — ${outcome.cause.detail}`,
      );
    }
  }
  const judgeOf = (image: Record<string, unknown> | null): FieldConditionJudge => (when): FieldConditionVerdict => {
    const judge = judges.get(when);
    if (!judge || image === null) return 'unjudged';
    try {
      return judge(image) ? 'matched' : 'unmatched';
    } catch (thrown) {
      this.logger.warn?.(
        `[Security] A field permission on '${objectName}' carries a row condition the stored-form judge refused ` +
          `and is applied as its lock: ${when} — ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      );
      return 'unjudged';
    }
  };

  if (row.operation === 'update') return forbiddenUnder(data, perms(judgeOf(rows[0])));
  // An insert judges each incoming row on its own values and refuses the
  // union — the same answer the masker gives a bulk payload under one map.
  const forbidden = new Set<string>();
  rows.forEach((image, i) => {
    const payload = (Array.isArray(data) ? data : [data])[i];
    for (const f of forbiddenUnder(payload, perms(judgeOf(image)))) forbidden.add(f);
  });
  return [...forbidden].sort();
}

/** The body of `SecurityPlugin#computeReadPartialMaskRules`; the method's docblock there is its contract. */
export function computeReadPartialMaskRules(
  this: Pick<ObjectInputsHost, 'computePartialMaskRules'>,
  secMeta: { fieldMaskingRules: Record<string, FieldMaskingRule>; fieldRequiredPermissions: Record<string, string[]> },
  permissionSets: PermissionSet[],
  delegatorSets: PermissionSet[] | null,
  basePerms: Record<string, { readable?: boolean; editable?: boolean }>,
  delBasePerms: Record<string, { readable?: boolean; editable?: boolean }> | null,
): Record<string, FieldMaskingRule> {
  const rules = this.computePartialMaskRules(secMeta, permissionSets, delegatorSets);
  for (const f of Object.keys(rules)) {
    if (basePerms[f]?.readable === false || delBasePerms?.[f]?.readable === false) {
      delete rules[f];
    }
  }
  return rules;
}

/** The body of `SecurityPlugin#maskOperationResult`; the method's docblock there is its contract. */
export function maskOperationResult(
  this: Pick<ObjectInputsHost, 'computeReadPartialMaskRules' | 'fieldMasker' | 'foldFieldRequiredPermissions' | 'permissionEvaluator'>,
  opCtx: any,
  permissionSets: PermissionSet[],
  secMeta: ObjectSecurityMeta,
  delegatorSets: PermissionSet[] | null,
): void {
  if (opCtx.result && ['find', 'findOne', 'insert', 'update'].includes(opCtx.operation)) {
    const basePerms = this.permissionEvaluator.getFieldPermissions(opCtx.object, permissionSets);
    // [ADR-0066 D3] AND-gate field-level requiredPermissions into the mask.
    let fieldPerms = this.foldFieldRequiredPermissions(basePerms, secMeta.fieldRequiredPermissions, permissionSets);
    // [ADR-0090 D10] Mask any field the delegator cannot read, too.
    let delBasePerms: Record<string, { readable: boolean; editable: boolean }> | null = null;
    if (delegatorSets) {
      delBasePerms = this.permissionEvaluator.getFieldPermissions(opCtx.object, delegatorSets);
      let delFieldPerms = this.foldFieldRequiredPermissions(delBasePerms, secMeta.fieldRequiredPermissions, delegatorSets);
      fieldPerms = intersectFieldMasks(fieldPerms, delFieldPerms);
    }
    // [#8993] Partial masking: fields whose declared rule applies to this
    // caller are REPLACED with their masked value instead of deleted —
    // EXCEPT where a permission set explicitly marks the field
    // non-readable (strictest wins: a masking rule never widens an
    // explicit deny, so those callers keep getting the key deleted).
    const partialRules = this.computeReadPartialMaskRules(
      secMeta, permissionSets, delegatorSets, basePerms, delBasePerms,
    );
    if (Object.keys(fieldPerms).length > 0 || Object.keys(partialRules).length > 0) {
      opCtx.result = this.fieldMasker.maskResults(opCtx.result, fieldPerms, opCtx.object, partialRules);
    }
  }
}

/** The body of `SecurityPlugin#foldFieldRequiredPermissions`; the method's docblock there is its contract. */
export function foldFieldRequiredPermissions(
  this: Pick<ObjectInputsHost, 'permissionEvaluator'>,
  baseFieldPerms: Record<string, { readable: boolean; editable: boolean }>,
  fieldRequiredPermissions: Record<string, string[]>,
  permissionSets: PermissionSet[],
): Record<string, { readable: boolean; editable: boolean }> {
  const entries = Object.entries(fieldRequiredPermissions ?? {});
  if (entries.length === 0) return baseFieldPerms;
  const held = this.permissionEvaluator.getSystemPermissions(permissionSets);
  const merged: Record<string, { readable: boolean; editable: boolean }> = { ...baseFieldPerms };
  for (const [field, caps] of entries) {
    if (caps.length > 0 && !caps.every((c) => held.has(c))) {
      merged[field] = { readable: false, editable: false };
    }
  }
  return merged;
}

/** The body of `SecurityPlugin#getObjectFieldNames`; the method's docblock there is its contract. */
export async function getObjectFieldNames(
  this: Pick<ObjectInputsHost, 'fieldNamesCache' | 'loadObjectFieldNames'>,
  metadata: any,
  objectName: string,
  ql?: any,
): Promise<Set<string> | null> {
  if (this.fieldNamesCache.has(objectName)) {
    return this.fieldNamesCache.get(objectName) ?? null;
  }
  const result = await this.loadObjectFieldNames(metadata, objectName, ql);
  // Only cache positive resolutions — a `null` may simply mean the
  // schema isn't registered yet at boot, and we want subsequent calls
  // to retry rather than be permanently denied.
  if (result) {
    this.fieldNamesCache.set(objectName, result);
  }
  return result;
}

/** The body of `SecurityPlugin#writeCheckFieldOptions`; the method's docblock there is its contract. */
export async function writeCheckFieldOptions(
  this: Pick<ObjectInputsHost, 'metadata' | 'ql'>,
  object: string,
): Promise<MatchesFilterOptions | undefined> {
  let obj: any;
  try {
    obj = typeof this.ql?.getSchema === 'function' ? this.ql.getSchema(object) : null;
    if (!obj || !obj.fields) obj = await this.metadata?.get?.('object', object);
  } catch {
    return undefined;
  }
  return declaredComparisonColumns(obj);
}

/** The body of `SecurityPlugin#loadObjectFieldNames`; the method's docblock there is its contract. */
export async function loadObjectFieldNames(
  this: Pick<ObjectInputsHost, 'datetimeFieldNamesCache' | 'numberComparandFieldsCache' | 'tenancyDisabledCache'>,
  metadata: any,
  objectName: string,
  ql?: any,
): Promise<Set<string> | null> {
  try {
    // Prefer ObjectQL's per-engine SchemaRegistry as the source of truth
    // for the live field set: it reflects registry-time augmentations
    // (system-field auto-injection like `organization_id`) that the
    // standalone metadata artifact loaded at boot may not include.
    // Fall back to the metadata service for objects ObjectQL doesn't
    // know about (system tables registered through other paths).
    let obj: any = typeof ql?.getSchema === 'function' ? ql.getSchema(objectName) : null;
    if (!obj || !obj.fields) {
      obj = await metadata?.get?.('object', objectName);
    }
    if (!obj || !obj.fields) return null;
    // Populate the tenancy opt-out cache alongside the field set so
    // the RLS filter pass can decide whether a wildcard
    // `organization_id` policy is genuinely "applicable but
    // uncompilable" (deny) versus "not applicable on this object"
    // (skip without contributing to the deny sentinel).
    const tenancyDisabled =
      (obj as any)?.tenancy?.enabled === false ||
      (obj as any)?.systemFields?.tenant === false;
    this.tenancyDisabledCache.set(objectName, !!tenancyDisabled);
    const set = new Set<string>(['id']);
    // [ADR-0053 D-D1 item 7 — #5930] The `datetime` columns, from the same
    // declaration (see `datetimeFieldNamesCache`).
    const datetime = new Set<string>();
    // [#21242] …and every column's type as the number-comparand verdict
    // reads it (see `numberComparandFieldsCache`). The verdict decides which
    // are numeric; this pass only records what each column declares.
    const number = new Map<string, NumberComparandDoorFieldMeta>();
    const noteNumberMeta = (name: string, def: any): void => {
      if (!def || typeof def !== 'object' || typeof def.type !== 'string') return;
      number.set(name, typeof def.returnType === 'string' ? { type: def.type, returnType: def.returnType } : { type: def.type });
    };
    if (Array.isArray(obj.fields)) {
      for (const f of obj.fields) {
        if (f?.name) set.add(String(f.name));
        if (f?.name && f.type === 'datetime') datetime.add(String(f.name));
        if (f?.name) noteNumberMeta(String(f.name), f);
      }
    } else if (typeof obj.fields === 'object') {
      for (const key of Object.keys(obj.fields)) {
        set.add(key);
        const v = (obj.fields as Record<string, any>)[key];
        if (v && typeof v === 'object' && v.name) set.add(String(v.name));
        if (v && typeof v === 'object' && v.type === 'datetime') datetime.add(key);
        noteNumberMeta(key, v);
      }
    } else {
      return null;
    }
    this.datetimeFieldNamesCache.set(objectName, datetime);
    this.numberComparandFieldsCache.set(objectName, number);
    return set;
  } catch {
    return null;
  }
}

/** The body of `SecurityPlugin#extractTargetField`; the method's docblock there is its contract. */
export function extractTargetField(
  using?: string,
): string | null {
  if (!using) return null;
  // Match `field ==` (canonical CEL), `field =` (legacy SQL-ish), or
  // `field IN`/`in`. [#2936] `==` MUST be listed before `=` in the
  // alternation: alternation is ordered, so a bare `=` branch would match
  // the first `=` of `==` and then the `(?=\s|\()` lookahead — seeing the
  // SECOND `=`, not whitespace — would fail, leaving `==` unrecognized (the
  // original bug: real seeds/business policies author equality as `==`, so
  // the field-existence and tenancy-disabled safety nets that consume this
  // were inert for them). `\b` is omitted after the operator because `=` is
  // non-word and the next char (space) is non-word too — a word boundary
  // cannot exist between two non-word chars — so we require the operator to
  // be followed by whitespace or `(` instead. `!=`/`>`/`<`/`>=`/`<=` are
  // deliberately NOT recognized: returning `null` keeps such a policy (the
  // conservative default), matching the pre-#2936 behavior for any shape the
  // regex did not match.
  const m = using.match(/^\s*([a-z_][a-z0-9_]*)\s*(?:==|=|IN|in)(?=\s|\()/);
  return m ? m[1] : null;
}
