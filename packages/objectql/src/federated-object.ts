// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

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
