// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveInjectedColumnProvenance } from '@objectstack/spec/data';

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
 * [#21910, generalized by #21918] Is `fieldName` a column the registry
 * INJECTED into a federated object, and that the federated object does not
 * provision?
 *
 * `applySystemFields` injects the platform's columns into every object it
 * registers, ADR-0015 `external` ones included (the #7865 ruling, direction
 * B): the tenant anchor `organization_id`, the ADR-0117 D1 anchor
 * `owning_business_unit_id`, the owner `owner_id`, and the audit columns
 * `created_by` / `updated_by` / `created_at` / `updated_at`. The platform
 * provisions no storage for a federated object, so on one, each such column
 * exists in the registered schema and nowhere else. A lookup among them is
 * never a reference to anything: no remote row can hold its value.
 *
 * WHICH columns those are is not decided here. It is the registry's own
 * provenance, `resolveInjectedColumnProvenance` (the #7865 marker,
 * `@objectstack/spec/data`), which answers `'injected-unprovisioned'` exactly
 * for an injected column whose registered definition is the platform's own,
 * on an object whose storage the platform does not provision. ⛔ No list of
 * column names lives here or at any caller. #21910 drew the line at
 * `organization_id` alone, and the business-unit and user deletes then failed
 * on the next injected anchor. A list would only move the line to the next
 * column the registry injects.
 *
 * Two conjuncts:
 *
 * - the object is federated, by {@link isFederatedObject}, the same predicate
 *   `buildDriverOptions`, the related-record read and every schema-sync seam
 *   ask. The provenance below implies it (its `'injected-unprovisioned'` is
 *   only ever answered on an `external` object), so this conjunct changes no
 *   verdict. It comes first because the cascade asks this for every relation
 *   of every registered object on every delete, and it lets a local object
 *   answer without deriving its injection plan;
 * - the provenance answers `'injected-unprovisioned'`. A column the author
 *   declared answers `'author'` and stays a column, including an author's own
 *   `organization_id` or `owner_id`: it may map a real remote column, and a
 *   reader keeps treating it as one (#7859's recorded reasoning). A column
 *   that is neither injected nor declared answers `'absent'`.
 *
 * Every engine reader of an injected column is enumerated, with its
 * disposition, by `federated-injected-column-readers.test.ts`, which fails on
 * a reader with none. The readers that ask this predicate:
 *
 * - `ObjectQL.cascadeDeleteRelations` does not probe a federated object on such
 *   a column. The probe was refused as an unknown column, so deleting the
 *   organization, business unit or user it names was refused;
 * - `ObjectQL.planCascadeAtomicity` does not count such a column as making the
 *   federated object a participant, so its participant test stays the scan's;
 * - `LifecycleService`'s reap and archive passes do not partition a federated
 *   object's rows per tenant on an `organization_id` that is such a column.
 */
export function isFederatedUnprovisionedInjectedColumn(schema: unknown, fieldName: string): boolean {
  return (
    isFederatedObject(schema) &&
    resolveInjectedColumnProvenance(schema, fieldName) === 'injected-unprovisioned'
  );
}
