// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0015 §10, ADR-0095 D1] Under a walled tenancy posture every external
 * object states its organization scope.
 *
 * ## The rule
 *
 * An external object (ADR-0015 `external`: an object bound to a datasource
 * whose schema the platform does not own) carries whatever columns the remote
 * carries. The platform injects `organization_id` into its registered schema
 * like every other object's, but provisions no storage for it, so on an
 * external object the injected anchor is a column the query will never find
 * (`federated-phantom-anchors.ts`). Whether such an object's rows belong to one
 * organization or to every organization is therefore a fact only its author
 * knows, and under a walled posture (`isolated` or `group`) the object must
 * SAY it, in one of three ways:
 *
 *  - its own `organization_id` field — the remote rows carry the organization
 *    column and the driver returns it; the Layer 0 wall then keys on it, and
 *    the engine's floor (`external-driver-floor.ts`) re-applies the predicate
 *    to whatever a driver answers, so a row without the column reads to no one;
 *  - `tenancy: { enabled: false }` — the object is shared by every organization;
 *  - `systemFields: { tenant: false }` — the same opt-out, spelled on the
 *    system fields. These two are the wall's own opt-out clauses, and the only
 *    ones: the whole-block `systemFields: false` is in neither (the registry's
 *    recorded reading), so it states nothing here.
 *
 * An external object that states none is REFUSED BY NAME when the boot
 * completes ({@link refuseUndeclaredExternalObjectScope}, run from a
 * `kernel:ready` handler beside the ADR-0131 D5 refusal of a declaration the
 * posture does not read), and one registered after the boot — a Studio
 * import, a runtime datasource — is DENIED at Layer 0 (`computeTenantLayer0Verdict`
 * answers `deny`, the shape the owner anchor took: no provable scope, no row)
 * and REFUSED on every write by the write wall (`composeWriteTenantWall`,
 * ahead of its scope pre-test, with {@link undeclaredExternalScopeWriteRefusal}'s
 * sentence). The undeclared state is a configuration defect, and a defect
 * fails toward isolation, never toward exposure.
 *
 * `tenancy.tenantField` on an external object is refused the same way: the
 * wall keys on `organization_id` alone, and the one reader of a declared
 * tenant field — the storage the platform provisions — is exactly what an
 * external object has none of. A remote column of another name reaches the
 * wall through `external.columnMap`, mapped onto `organization_id`.
 *
 * The `single` posture reads none of this: it enforces no wall, so no
 * declaration is owed and nothing is refused.
 *
 * ## One predicate, two doors
 *
 * {@link externalOrganizationScopeOf} is the one reading of the declaration.
 * The boot refusal enumerates the registry with it; `getObjectSecurityMeta`
 * reads it for the Layer 0 input (`externalOrganizationScopeUndeclared`), so an
 * object the boot never saw meets the same verdict at its first read. The two
 * cannot disagree, because neither re-derives the question.
 *
 * The reading, its Layer 0 projection and {@link EXTERNAL_SCOPE_REMEDY} live in
 * `@objectstack/core`'s security module (`external-organization-scope.ts`
 * there), because a service asks the same question — the sync-in pull in
 * `@objectstack/service-automation` decides by it whose rows it may copy — and
 * should not load this plugin to ask it. This module re-exports those
 * bindings, so its public surface is unchanged and every importer resolves to
 * the one implementation.
 */

import {
  declaredForeignTenantField,
  EXTERNAL_SCOPE_REMEDY,
  externalOrganizationScopeOf,
} from '@objectstack/core';
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';

// Re-exported, not restated: `@objectstack/core`'s bindings are the one reading.
export {
  declaredForeignTenantField,
  EXTERNAL_SCOPE_REMEDY,
  externalOrganizationScopeIsUndeclared,
  externalOrganizationScopeOf,
  type ExternalOrganizationScope,
} from '@objectstack/core';

/**
 * The write wall's refusal of an external object that states no organization
 * scope, as the caller reads it: the rule, the object, and the three ways out
 * — never the "no active organization" sentence, which would send a caller
 * who has one to join one. The developer half names the posture and the door.
 */
export function undeclaredExternalScopeWriteRefusal(
  object: string,
  operation: string,
  posture: TenancyPosture,
): { message: string; developerMessage: string } {
  return {
    message:
      `[Security] Access denied: under the '${posture}' tenancy posture every external object states its ` +
      `organization scope, and '${object}' states none the organization wall can enforce — so this ${operation} is ` +
      `refused. ${EXTERNAL_SCOPE_REMEDY}`,
    developerMessage:
      `[ADR-0015 §10] '${object}' is an external object registered after the boot (the boot refuses one by name) ` +
      `whose organization scope is undeclared, so the Layer 0 wall answers \`deny\` for it under the '${posture}' ` +
      `posture: every read answers no row, and every ${operation} is refused here, ahead of the wall's scope ` +
      'pre-test, whatever organization the caller carries. System contexts are unaffected.',
  };
}

/** The sentence for an object whose only declaration is a tenant field the wall does not read. */
export function foreignTenantFieldSentence(object: string, tenantField: string): string {
  return (
    `'${object}' declares \`tenancy.tenantField: '${tenantField}'\`, which the organization wall does not read on ` +
    'an external object: the wall keys on `organization_id` alone, and a declared tenant field is read only by ' +
    `the storage the platform provisions. Map the remote column onto the wall's column instead — ` +
    `\`external.columnMap: { ${tenantField}: 'organization_id' }\` with an \`organization_id\` field — or declare ` +
    '`tenancy: { enabled: false }`.'
  );
}

/** One external object the boot refuses, with what it stated. */
export interface UndeclaredExternalObject {
  object: string;
  scope: 'undeclared' | 'tenant-field-unenforceable';
  tenantField?: string;
}

/**
 * The boot refusal: under a walled posture, the registered external objects
 * that state no organization scope, named, with the three ways out.
 */
export class ExternalObjectOrganizationScopeUndeclaredError extends Error {
  readonly posture: TenancyPosture;
  readonly objects: readonly UndeclaredExternalObject[];

  constructor(posture: TenancyPosture, objects: readonly UndeclaredExternalObject[]) {
    super(externalScopeRefusalMessage(posture, objects));
    this.name = 'ExternalObjectOrganizationScopeUndeclaredError';
    this.posture = posture;
    this.objects = [...objects];
  }
}

function externalScopeRefusalMessage(posture: TenancyPosture, objects: readonly UndeclaredExternalObject[]): string {
  const undeclared = objects.filter((o) => o.scope === 'undeclared').map((o) => `'${o.object}'`);
  const foreign = objects.filter((o) => o.scope === 'tenant-field-unenforceable');
  const parts: string[] = [
    `[security] under the '${posture}' tenancy posture every external object states its organization scope, ` +
      `and ${objects.length === 1 ? 'one registered external object states' : `${objects.length} registered external objects state`} ` +
      'none that the organization wall can enforce.',
  ];
  if (undeclared.length > 0) {
    parts.push(`Stating nothing: ${undeclared.join(', ')}. ${EXTERNAL_SCOPE_REMEDY}`);
  }
  for (const o of foreign) parts.push(foreignTenantFieldSentence(o.object, o.tenantField ?? ''));
  parts.push("Then restart. The 'single' posture enforces no wall and owes no declaration.");
  return parts.join(' ');
}

/** Every registered external object stating no enforceable organization scope. */
export function undeclaredExternalObjectsOf(objects: readonly unknown[]): UndeclaredExternalObject[] {
  const out: UndeclaredExternalObject[] = [];
  for (const schema of objects) {
    const name = (schema as { name?: unknown } | null | undefined)?.name;
    if (typeof name !== 'string' || name === '') continue;
    const scope = externalOrganizationScopeOf(schema);
    if (scope === 'undeclared') out.push({ object: name, scope });
    else if (scope === 'tenant-field-unenforceable') {
      out.push({ object: name, scope, tenantField: declaredForeignTenantField(schema) ?? '' });
    }
  }
  return out.sort((a, b) => a.object.localeCompare(b.object));
}

/** The engine's registered objects, read tolerantly: an engine without a registry lists none. */
export function registeredObjectsOf(ql: unknown): unknown[] {
  try {
    const objects = (ql as { registry?: { getAllObjects?: () => unknown } } | null | undefined)?.registry?.getAllObjects?.();
    return Array.isArray(objects) ? objects : [];
  } catch {
    return [];
  }
}

/**
 * Refuse the boot when a walled posture holds an external object that states
 * no organization scope. Under `single` nothing is read and nothing is refused.
 */
export function refuseUndeclaredExternalObjectScope(posture: TenancyPosture, objects: readonly unknown[]): void {
  if (!postureEnforcesWall(posture)) return;
  const undeclared = undeclaredExternalObjectsOf(objects);
  if (undeclared.length > 0) throw new ExternalObjectOrganizationScopeUndeclaredError(posture, undeclared);
}

/**
 * The warning for an external object registered AFTER the boot that states no
 * organization scope: said once per object, at the first read that computes its
 * posture, naming the verdict (every read and write of it is denied) and the
 * three ways out.
 */
export function undeclaredExternalScopeDenialWarning(object: string, posture: TenancyPosture, schema: unknown): string {
  const foreign = declaredForeignTenantField(schema);
  return (
    `[security] under the '${posture}' tenancy posture every external object states its organization scope, and ` +
    `'${object}' states none the organization wall can enforce; it was registered after the boot, so the wall ` +
    'denies every read and write of it (zero rows, writes refused) until it does. ' +
    (foreign !== null ? foreignTenantFieldSentence(object, foreign) : EXTERNAL_SCOPE_REMEDY)
  );
}
