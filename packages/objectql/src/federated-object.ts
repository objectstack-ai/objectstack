// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveInjectedColumnProvenance } from '@objectstack/spec/data';
import { DEFAULT_TENANT_FIELD } from './tenancy/system-write-organization.js';

/**
 * Is `schema` a federated object (ADR-0015 `external`), one whose schema is
 * owned by the REMOTE database?
 *
 * This is the ONE spelling of that question for this package's schema-sync
 * seams. A federated object is never a DDL target: its storage belongs to the
 * remote, so a sync binds it with the driver's DDL-free
 * `registerExternalObject` (the object -> remote-table mapping and the
 * coercion maps a read needs) and never calls `syncSchema`. Three seams make
 * that decision, and all three ask this predicate, so they cannot drift apart:
 *
 * - the boot sync, `ObjectQLPlugin.syncRegisteredSchemas` (and its DDL-free
 *   sibling and the `kernel:ready` reconciliation);
 * - the runtime sync, `ObjectQL.syncSchemas`, which install-local installs,
 *   rehydrates and template seeding run after registering objects;
 * - the single-object sync, `ObjectQL.syncObjectSchema`.
 *
 * They did drift (#21777). The runtime sync had no federated branch, so it sent
 * DDL to every federated object in the registry. The driver refused it, as
 * designed for an external-schema datasource, and the refusal was logged as
 * the #4632 durability ERROR, although nothing durable was lost. Every
 * install-local install on a showcase host printed that false alarm.
 *
 * It is a PRESENCE test, `external != null`, and deliberately not a reading of
 * the datasource's `schemaMode`. An object with no `external` block is not
 * federated, whatever datasource it lands on. If its DDL is refused, that is a
 * real lost sync, and it keeps the ERROR.
 */
export function isFederatedObject(schema: unknown): boolean {
  return (schema as { external?: unknown } | null | undefined)?.external != null;
}

/**
 * [#21910] Is `fieldName` a federated object's platform-INJECTED tenant
 * anchor: the `organization_id` lookup to `sys_organization` that the
 * registry adds and the remote table does not have?
 *
 * `applySystemFields` injects `organization_id` into every object it
 * registers, ADR-0015 `external` ones included (the #7865 ruling, direction
 * B), and the platform provisions no storage for a federated object. So on
 * one, that column exists in the registered schema and nowhere else, and it
 * is never a reference to an organization: no remote row can hold one. The
 * engine's referential cascade asks this in both of its walks, so the two
 * cannot disagree about which objects take part in an organization delete:
 *
 * - `ObjectQL.cascadeDeleteRelations` does not probe the remote table on it
 *   (the probe was refused as an unknown column, and every organization
 *   delete answered 500);
 * - `ObjectQL.planCascadeAtomicity` does not count that column as making the
 *   federated object a participant, so its participant test stays the scan's.
 *
 * Three conjuncts, and each one is the narrowing:
 *
 * - the column is the tenant anchor, `organization_id`. The other anchors
 *   the registry injects (`owner_id`, `created_by`, ...) are not this
 *   question;
 * - the object is federated, by {@link isFederatedObject}, the same predicate
 *   `buildDriverOptions` and the related-record read ask;
 * - the field is the platform's own definition, by the #7865 provenance
 *   marker. An `organization_id` the author declared answers `'author'` and
 *   stays a relation: it may map a real remote column, and its probe keeps
 *   #8895's discriminate or propagate.
 */
export function isFederatedInjectedTenantAnchor(schema: unknown, fieldName: string): boolean {
  return (
    fieldName === DEFAULT_TENANT_FIELD &&
    isFederatedObject(schema) &&
    resolveInjectedColumnProvenance(schema, fieldName) === 'injected-unprovisioned'
  );
}
