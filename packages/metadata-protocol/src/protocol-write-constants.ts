// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim:
 * the flow fallback verdict's not-replayed conversions and the clone path's stripped lifecycle columns.
 *
 * A MOVE, not a redesign: every declaration below is byte-identical to the text
 * that stood above `ObjectStackProtocolImplementation`; only the imports and the
 * export list at the foot are new. `protocol.ts` re-exports what it exported.
 */

/**
 * ADR-0087 conversions the save door's flow fallback verdict (#21982) does
 * not replay, by id — the same DEFAULT-FLIP refusal the automation engine's
 * canonicalizer makes (`CONVERSIONS_NOT_REPLAYED_AT_REHYDRATION` in
 * `service-automation/src/engine.ts`), because the fallback stands in for that
 * canonicalizer and must reach the same verdict on the same body.
 *
 * - `flow-decision-mode-inclusive-explicit` (#15429) rewrites an omitted
 *   decision `mode` into `'inclusive'`, which is sound only where "this body
 *   predates the flip" is a fact; a save never knows that, exactly as the
 *   engine's canonicalizer does not.
 */
export const FLOW_FALLBACK_VERDICT_NOT_REPLAYED: readonly string[] = [
    'flow-decision-mode-inclusive-explicit',
];

// Lifecycle columns the engine always owns; the clone path drops them by NAME
// so the insert re-stamps fresh values instead of copying the source's. Mirrors
// record-validator's SKIP_FIELDS (system-injected, never author-supplied).
const CLONE_STRIP_FIELDS: readonly string[] = [
    'id', 'created_at', 'created_by', 'updated_at', 'updated_by',
];

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { CLONE_STRIP_FIELDS };
