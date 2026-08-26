// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  InMemoryMetadataActivationStore,
  ObjectStoreMetadataActivationStore,
  type MetadataActivationStoreEngine,
} from '@objectstack/core';

import type { FlowActivationStore } from './engine.js';

/**
 * [ADR-0126 §4/§7.2] The packaged-FLOW binding of the activation ledger —
 * `sys_metadata_activation` rows carrying `metadata_type: 'flow'`.
 *
 * ## What this replaces, and why the replacement is durable
 *
 * The engine used to carry its off-switch in a process-local `flowEnabled`
 * map. #10243 measured what that costs: the bit was NOT a row, so no
 * organization wall scoped it — `toggleFlow` wrote an in-process map keyed by
 * flow NAME only, and the automation service is ONE instance per environment.
 * On a real `isolated` posture a tenant org owner switched a shipped flow off
 * and an unrelated tenant in a DIFFERENT organization read it off. ADR-0126
 * §7.2 retires that mechanism rather than refining it: the durable ledger row
 * IS the sanctioned off-switch, and this module is how the engine reaches it.
 *
 * ## Where the row contract lives now (#12350)
 *
 * ⚠️ The §4 row semantics are NOT written here any more. They live once, in
 * `@objectstack/core`'s {@link ObjectStoreMetadataActivationStore} — read that
 * module for the four load-bearing properties (`organization_id` never
 * written, org-carrying rows skipped on read, absence means ACTIVE, a driver
 * `0` reads as false) and for why `core` is the home rather than the package
 * that declares the object.
 *
 * This file is now exactly what is FLOW-specific: the `metadata_type`
 * discriminator, and the names the automation engine and its `index.ts` export.
 * The action twin in `@objectstack/objectql` is the same three lines over the
 * same class — which is the whole point of #12350, since neither package can
 * import the other.
 *
 * Two implementations, mirroring the `sys_flow_dispatch` pair next door:
 *   - {@link InMemoryFlowActivationStore} — tests and hosts with no ObjectQL.
 *   - {@link ObjectStoreFlowActivationStore} — the real `sys_metadata_activation`.
 */

/**
 * The ledger's `metadata_type` for this consumer. Flows are the first consumer
 * (ADR-0126 §7); the ledger is generic, so every read and write is scoped by
 * this discriminator and never assumes it owns the table.
 */
const METADATA_TYPE = 'flow';

/**
 * The exact ObjectQL slice this store needs: a keyed read, an insert, and an
 * update. Narrower than `SuspendedRunStoreEngine` on purpose, and deliberately
 * WITHOUT `delete`: re-enabling updates the `active` bit, it never removes the
 * row, and demanding only what is used keeps every test double honest about
 * that. An alias of the shared slice — one contract, so a double that
 * satisfies one satisfies the other.
 */
export type FlowActivationStoreEngine = MetadataActivationStoreEngine;

/**
 * In-memory {@link FlowActivationStore} — process-lifetime only.
 *
 * ⚠️ This is NOT the retired `flowEnabled` map wearing a new name. The
 * difference is the one #10243 turned on: this store is only ever reached
 * through {@link AutomationEngine.toggleFlow}, which is reached from the wire
 * only through a door that refuses a tenant admin in a walled posture
 * (ADR-0126 §5). What it lacks versus the ObjectStore implementation is
 * DURABILITY, not scoping — and a host running without ObjectQL has no durable
 * plane to write to in the first place.
 */
export class InMemoryFlowActivationStore
  extends InMemoryMetadataActivationStore
  implements FlowActivationStore {}

/**
 * Durable {@link FlowActivationStore} backed by the `sys_metadata_activation`
 * object (ADR-0126 §4).
 *
 * A binding, not an implementation: it fixes the `metadata_type` and nothing
 * else. The one-argument constructor is deliberate — a caller that had to pass
 * the discriminator could pass the wrong one, and the flow leg has exactly one
 * correct value.
 *
 * All access uses a system context: the object is `managedBy: 'engine-owned'`
 * and declares `apiMethods: ['get', 'list']`, i.e. the generic data API cannot
 * write it at all — these rows are written by the ADR-0126 enable/disable
 * action and by nothing else.
 */
export class ObjectStoreFlowActivationStore
  extends ObjectStoreMetadataActivationStore
  implements FlowActivationStore {
  constructor(engine: FlowActivationStoreEngine) {
    super(engine, METADATA_TYPE);
  }
}
