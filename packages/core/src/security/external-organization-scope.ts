// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0015 §10, ADR-0095 D1] The one reading of the organization scope an
 * external object states, and the three ways out every door spells.
 *
 * Under a walled tenancy posture (`isolated` or `group`) every external object
 * (ADR-0015 `external`: an object bound to a datasource whose schema the
 * platform does not own) states its organization scope, in one of three ways:
 * its own `organization_id` field, `tenancy: { enabled: false }`, or
 * `systemFields: { tenant: false }`. The rule, the boot refusal of an object
 * stating none, the Layer 0 denial of one registered after the boot and the
 * write wall's refusal live in `@objectstack/plugin-security`'s
 * `external-organization-scope.ts`, whose module docblock is the full account.
 *
 * ## One predicate, every door
 *
 * {@link externalOrganizationScopeOf} is the one reading of the declaration.
 * The plugin's boot refusal enumerates the registry with it, its
 * `getObjectSecurityMeta` reads it for the Layer 0 input
 * (`externalOrganizationScopeUndeclared`, through
 * {@link externalOrganizationScopeIsUndeclared}), and the sync-in pull in
 * `@objectstack/service-automation` reads it to decide whose rows it may copy.
 * They cannot disagree, because none re-derives the question.
 *
 * ## Why it lives here, in `@objectstack/core`
 *
 * The reading is pure and everything it composes already sits at this layer:
 * {@link isFederatedObject} (`./tenant-field.ts`), the spec's
 * `isTenancyDisabled`, and `@objectstack/metadata-core`'s
 * {@link TENANT_SCOPE_FIELD_DEF} through {@link hasPhantomTenantAnchor}. A
 * service that needs the answer then depends on the kernel, which it already
 * does, rather than on the security plugin's package; the plugin re-exports
 * these bindings under its own module paths, so its public surface is
 * unchanged and every importer resolves to the same functions.
 */

import { isTenancyDisabled } from '@objectstack/spec/data';

// [#6562] The injected-column DEFINITION table lives in `@objectstack/metadata-core`
// (the registry that provisions the columns re-exports it from there, and the `/meta`
// read path consumes the same one). Importing the constant — rather than restating
// its shape here — is what makes the provenance test track the producer instead of a
// copy that can drift silently.
import { TENANT_SCOPE_FIELD_DEF } from '@objectstack/metadata-core';

import { isFederatedObject } from './tenant-field.js';

/** The one column the Layer 0 wall keys on. */
const TENANT_SCOPE_COLUMN = 'organization_id';

/** Pick a field definition out of either registered `fields` shape. */
function readFieldDef(schema: unknown, name: string): unknown {
  const fields = (schema as { fields?: unknown } | null | undefined)?.fields;
  if (Array.isArray(fields)) return fields.find((f) => (f as { name?: unknown } | null)?.name === name);
  if (fields && typeof fields === 'object') return (fields as Record<string, unknown>)[name];
  return undefined;
}

// ── Provenance of a federated object's `organization_id` (#7835) ────────────

/**
 * Structural identity against the shipped constant. Flat by construction —
 * every value in {@link TENANT_SCOPE_FIELD_DEF} is a primitive — so a flat
 * comparison is exact rather than a shortcut, and an extra or missing key is a
 * mismatch: any mismatch answers "not the platform's anchor", which leaves the
 * Layer 0 wall enforcing. The fail direction is toward isolation, never toward
 * exposure.
 *
 * The array shape carries an additional `name` key that the object shape
 * expresses as the map key; it is excluded so both shapes reach the same
 * verdict about the same column.
 */
function equalsShippedDef(def: unknown, shipped: Readonly<Record<string, unknown>>): boolean {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return false;
  const actual = { ...(def as Record<string, unknown>) };
  delete actual.name;
  const shippedKeys = Object.keys(shipped);
  if (Object.keys(actual).length !== shippedKeys.length) return false;
  return shippedKeys.every((k) => actual[k] === shipped[k]);
}

/**
 * Does this object's `organization_id` exist only in the registry — i.e. is it
 * the platform's injected anchor on an object whose storage the platform never
 * provisioned?
 *
 * `applySystemFields` injects `organization_id` into every object that has not
 * opted out, federated ones included, but the platform provisions no storage
 * for a federated object. The question is provenance, answered by identity
 * against the shipped declaration: `applySystemFields` spreads
 * {@link TENANT_SCOPE_FIELD_DEF} verbatim and an authored field of the same
 * name suppresses the injection, so a registered def equal to the constant can
 * only have come from the platform (`@objectstack/plugin-security`'s
 * `federated-phantom-anchors.ts`, which re-exports this binding, carries the
 * full account).
 *
 * `true` ⇒ Layer 0 must treat the object as carrying NO tenant column, because
 * it does not. `false` for every local object (the platform DID provision the
 * column there) and for a federated object whose author declared a real remote
 * `organization_id`.
 */
export function hasPhantomTenantAnchor(schema: unknown): boolean {
  if (!isFederatedObject(schema)) return false;
  return equalsShippedDef(readFieldDef(schema, TENANT_SCOPE_COLUMN), TENANT_SCOPE_FIELD_DEF);
}

// ── The declaration an external object makes ──────────────────────────────

/**
 * What an external object states about its organization scope.
 *
 * - `tenant-field-unenforceable` — `tenancy.tenantField` names a column other
 *   than `organization_id`, which the wall does not read on an external object
 *   (judged first: a tenant field the wall cannot read is refused whatever
 *   else the object declares, unless it opted out of tenancy altogether).
 * - `shared` — the wall's own two opt-out clauses, `tenancy.enabled: false` or
 *   `systemFields.tenant: false`; the whole-block `systemFields: false` is in
 *   neither and states nothing.
 * - `walled` — it declares its own `organization_id` (any definition other
 *   than the platform's injected one; a parsed copy of the shipped definition
 *   carries the parser's defaults and so counts as the author's). An object
 *   with its own column is never answered `shared` unless it also opted out,
 *   because the wall walls it.
 * - `undeclared` — none of the above.
 */
export type ExternalOrganizationScope = 'walled' | 'shared' | 'undeclared' | 'tenant-field-unenforceable';

/** The declared `tenancy.tenantField`, when it names a column other than the wall's. */
export function declaredForeignTenantField(schema: unknown): string | null {
  const declared = (schema as { tenancy?: { tenantField?: unknown } } | null | undefined)?.tenancy?.tenantField;
  if (typeof declared !== 'string' || declared === '' || declared === TENANT_SCOPE_COLUMN) return null;
  return declared;
}

/**
 * The declaration an external object makes, or `null` for an object that is
 * not external (the question does not arise: the platform provisions its
 * columns, so its `organization_id` is real wherever it is registered).
 */
export function externalOrganizationScopeOf(schema: unknown): ExternalOrganizationScope | null {
  if (!isFederatedObject(schema)) return null;
  // The wall's two opt-out clauses, exactly as `getObjectSecurityMeta` reads
  // `tenancyDisabled`: an object that opted out is shared whatever column it
  // carries, because the wall composes nothing on it.
  const systemFields = (schema as { systemFields?: unknown }).systemFields;
  const optedOut =
    isTenancyDisabled(schema) ||
    (!!systemFields && typeof systemFields === 'object' && (systemFields as { tenant?: unknown }).tenant === false);
  if (!optedOut && declaredForeignTenantField(schema) !== null) return 'tenant-field-unenforceable';
  if (optedOut) return 'shared';
  if (readFieldDef(schema, TENANT_SCOPE_COLUMN) !== undefined && !hasPhantomTenantAnchor(schema)) return 'walled';
  return 'undeclared';
}

/**
 * Does Layer 0 deny this object under a walled posture because it is external
 * and states no enforceable organization scope? `false` for every local
 * object and for an external object that declared `walled` or `shared`.
 */
export function externalOrganizationScopeIsUndeclared(schema: unknown): boolean {
  const scope = externalOrganizationScopeOf(schema);
  return scope === 'undeclared' || scope === 'tenant-field-unenforceable';
}

/** The three ways out, as every refusal and warning spells them. */
export const EXTERNAL_SCOPE_REMEDY =
  'Declare one of three on each: an `organization_id` field of its own, when the remote rows carry the ' +
  'organization column and the driver returns it (a remote column of another name is mapped onto it with ' +
  "`external.columnMap: { <remote column>: 'organization_id' }`) — the rows are then walled by organization; " +
  '`tenancy: { enabled: false }` — the object is shared by every organization; or ' +
  '`systemFields: { tenant: false }` — the same opt-out, spelled on the system fields.';
