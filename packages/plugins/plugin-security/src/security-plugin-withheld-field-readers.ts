// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106 D1/D7, #34901] The body of
 * `SecurityPlugin#getMetadataReadableWithheldFields`: which of the fields a
 * disabled package withholds from an object's served schema may be DISCLOSED
 * to a caller. The contract is the member's docblock on `ISecurityService`
 * (`@objectstack/spec/contracts`).
 *
 * ## Why the readable projection cannot answer it
 *
 * A served object read names the withheld fields in its `_withheldFields` read
 * decoration, and the metadata plane's projection (`applyObjectSchemaMask`,
 * `@objectstack/metadata-core`) must drop every entry the caller may not read,
 * or a disable discloses a field's existence that ADR-0106 D1 removes whole.
 * `getMetadataReadableFields` enumerates the LIVE object's fields, which leave
 * a withheld field out, so it names a withheld field for no caller: it cannot
 * tell a denied caller from an admitted one.
 *
 * ## The derivation
 *
 * The same evaluator, sets and folds the readable projection takes
 * (`resolveProjectionFieldMask`, `computeReadableFields`), with the withheld
 * fields' own declarations read from the STORAGE definition
 * (`SchemaRegistry.getStorageObject`, every `extend` contribution folded in):
 *
 * 1. the withheld names (`SchemaRegistry.getWithheldExtensionFields`); none ⇒
 *    `[]`, and a system context ⇒ all of them;
 * 2. the caller's permission sets, or the configured fallback set when it
 *    resolves none (ADR-0106 D7, as the metadata-plane projection does);
 * 3. the object's posture; unresolved ⇒ `[]` (fail closed, as #3545);
 * 4. the evaluator's field map, with the per-field capability fold over the
 *    live fields' `requiredPermissions` AND the stored withheld fields';
 * 5. the on-behalf-of delegator's map intersected in (ADR-0090 D10), and the
 *    delegator's refusals answered `[]`, as the projection answers them;
 * 6. a computed withheld field is folded over what it reads
 *    (`foldComputedFieldReads`): withheld when it reads a field the caller may
 *    not read, a field this object masks, or a live field withheld for what it
 *    reads through a reference.
 *
 * Two places it is deliberately NARROWER than the readable projection, each
 * failing closed (an entry dropped costs the console a hint; one served
 * wrongly discloses a field): a computed withheld field that reads through a
 * reference is not admitted (its referenced object is not walked here), and
 * a withheld field whose capability fold denies it is not admitted even when a
 * `maskingRule` would serve it masked on the data plane.
 *
 * `undefined` when the registry offers neither storage read, or the object has
 * no storage definition: the consumer drops every entry for it.
 */

import type { SecurityPlugin } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';
import { delegatedOrganizationRefusal, intersectFieldMasks } from './explain-engine.js';
import { foldComputedFieldReads, readComputedFieldExpression, type ComputedFieldInput } from './field-masker.js';

/**
 * The `SecurityPlugin` members {@link computeMetadataReadableWithheldFields}
 * reads, each typed AS the class member, the shape `FieldReadersHost` takes
 * (`security-plugin-field-readers.ts`, whose header carries the reasoning).
 * `permissionEvaluator`, `ql` and `tenancyPosture` go as getters.
 */
export interface WithheldFieldReadersHost {
  readonly permissionEvaluator: SecurityPlugin['permissionEvaluator'];
  readonly ql: SecurityPlugin['ql'];
  readonly tenancyPosture: SecurityPlugin['tenancyPosture'];
  foldFieldRequiredPermissions: SecurityPlugin['foldFieldRequiredPermissions'];
  resolveCallerPosture: SecurityPlugin['resolveCallerPosture'];
  resolveDelegatorForContext: SecurityPlugin['resolveDelegatorForContext'];
  resolveFallbackPermissionSets: SecurityPlugin['resolveFallbackPermissionSets'];
  resolveHopWithheldFields: SecurityPlugin['resolveHopWithheldFields'];
  resolvePermissionSetsForContext: SecurityPlugin['resolvePermissionSetsForContext'];
}

/** The two registry reads the derivation needs, both added to `SchemaRegistry` for this purpose or before it. */
interface WithheldFieldRegistry {
  getWithheldExtensionFields(name: string): Record<string, unknown> | undefined;
  getStorageObject(name: string): { fields?: unknown } | undefined;
}

/** The stored field definitions of `storage`, by name (the record `packages/spec` declares, or a list of named entries). */
function storedFieldDefinitions(storage: { fields?: unknown }): Record<string, unknown> {
  const fields = storage.fields;
  if (Array.isArray(fields)) {
    const out: Record<string, unknown> = {};
    for (const f of fields) if (f && typeof f === 'object' && (f as { name?: unknown }).name) out[String((f as { name: unknown }).name)] = f;
    return out;
  }
  return fields && typeof fields === 'object' ? fields as Record<string, unknown> : {};
}

/** A stored field's own `requiredPermissions` (ADR-0066 D3), or `undefined` when it declares none. */
function declaredRequiredPermissions(def: unknown): string[] | undefined {
  const rp = (def as { requiredPermissions?: unknown } | undefined)?.requiredPermissions;
  return Array.isArray(rp) && rp.length > 0 ? rp.map(String) : undefined;
}

/** The body of `SecurityPlugin#getMetadataReadableWithheldFields`; the contract is the member's docblock on `ISecurityService`. */
export async function computeMetadataReadableWithheldFields(
  this: Pick<WithheldFieldReadersHost, 'foldFieldRequiredPermissions' | 'permissionEvaluator' | 'ql' | 'resolveCallerPosture' | 'resolveDelegatorForContext' | 'resolveFallbackPermissionSets' | 'resolveHopWithheldFields' | 'resolvePermissionSetsForContext' | 'tenancyPosture'>,
  object: string,
  context: any,
): Promise<string[] | undefined> {
  const objectName = String(object ?? '');
  if (!objectName) return undefined;
  const registry = this.ql?.registry as Partial<WithheldFieldRegistry> | undefined;
  if (typeof registry?.getWithheldExtensionFields !== 'function' || typeof registry.getStorageObject !== 'function') {
    return undefined;
  }

  // 1. The withheld names. Nothing withheld is the common case and costs no set resolution.
  const withheld = Object.keys(registry.getWithheldExtensionFields(objectName) ?? {});
  if (withheld.length === 0) return [];
  if (context?.isSystem) return withheld;
  const storage = registry.getStorageObject(objectName);
  if (!storage) return undefined;
  const stored = storedFieldDefinitions(storage);

  // 2. The caller's sets, the D7 fallback set when it resolves none.
  let permissionSets: PermissionSet[] = await this.resolvePermissionSetsForContext(context);
  if (permissionSets.length === 0) permissionSets = await this.resolveFallbackPermissionSets(context);

  // 3. The posture; unresolvable answers nothing, as the projection does (#3545).
  const secMeta = await this.resolveCallerPosture(objectName, permissionSets);
  if (secMeta.unresolved) return [];

  // 4. The evaluator's map with the capability fold: the live fields' contract
  //    from the posture, the withheld fields' from their stored definition.
  const fieldRequiredPermissions: Record<string, string[]> = { ...secMeta.fieldRequiredPermissions };
  const computedFieldInputs: Record<string, ComputedFieldInput> = { ...secMeta.computedFieldInputs };
  const readsThroughReference = new Set<string>();
  for (const name of withheld) {
    const required = declaredRequiredPermissions(stored[name]);
    if (required) fieldRequiredPermissions[name] = required;
    const input = readComputedFieldExpression(stored[name]);
    if (input !== undefined) {
      computedFieldInputs[name] = input;
      if (input.hops.size > 0) readsThroughReference.add(name);
    }
  }
  let fieldPerms = this.foldFieldRequiredPermissions(
    this.permissionEvaluator.getFieldPermissions(objectName, permissionSets),
    fieldRequiredPermissions,
    permissionSets,
  );

  // 5. The delegator's intersection, asked where the projection asks it.
  if (permissionSets.length > 0 && context?.onBehalfOf?.userId) {
    const del = await this.resolveDelegatorForContext(context);
    if (del.kind === 'missing') return [];
    if (del.kind === 'resolved') {
      if (delegatedOrganizationRefusal(context, del.context, this.tenancyPosture) !== undefined) return [];
      const delegatorSets = await this.resolvePermissionSetsForContext(del.context);
      const delegatorPerms = this.foldFieldRequiredPermissions(
        this.permissionEvaluator.getFieldPermissions(objectName, delegatorSets),
        fieldRequiredPermissions,
        delegatorSets,
      );
      fieldPerms = intersectFieldMasks(fieldPerms, delegatorPerms);
    }
  }

  // 6. What a computed withheld field reads: every masked field counts as not
  //    served whole, and the live fields withheld through a reference too.
  const hopWithheld = await this.resolveHopWithheldFields(secMeta, context, { fallbackOnEmptySets: true });
  const { withheld: notServed } = foldComputedFieldReads(
    fieldPerms,
    computedFieldInputs,
    Object.keys(secMeta.fieldMaskingRules ?? {}),
    hopWithheld,
  );

  return withheld.filter((name) =>
    fieldPerms[name]?.readable !== false && !notServed.has(name) && !readsThroughReference.has(name));
}
