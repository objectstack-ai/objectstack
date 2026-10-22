// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D2] What `ObjectQLPlugin.init` does on a kernel, for a rig that
 * boots a bare `ObjectQL` beside the `SecurityPlugin`: put the SOURCE of the
 * `security` service in the engine's slot, read at every `ReadableIds`
 * composition and never cached.
 *
 * Since the `controlled_by_parent` derivation answers the engine's leaf
 * (ADR-0139 D6), every read of a `controlled_by_parent` object on a real
 * engine composes it from the security service — `canReadObject` and
 * `getReadFilter` of the master — and an engine with an EMPTY slot answers
 * every leaf `$in: []`, fail-closed. On a kernel the slot is always filled;
 * a rig that wires the engine by hand fills it here, or every detail read,
 * and every write whose probe reads the detail as the caller (the by-id
 * pre-image, the predicate write's readable rows), sees no row.
 *
 * The key is `Symbol.for`, the one slot every bundle of the engine names
 * (`SECURITY_SERVICE_SOURCE_SLOT` in `@objectstack/objectql`'s engine, which
 * is deliberately not re-exported).
 */
export const ENGINE_SECURITY_SERVICE_SOURCE_SLOT: unique symbol = Symbol.for('objectstack.objectql.securityServiceSource');

export function wireEngineSecuritySource(engine: object, source: () => unknown): void {
  (engine as Record<symbol, unknown>)[ENGINE_SECURITY_SERVICE_SOURCE_SLOT] = source;
}
