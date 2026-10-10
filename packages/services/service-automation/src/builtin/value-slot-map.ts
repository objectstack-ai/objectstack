// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { isExpressionEnvelopeShaped } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { AutomationEngine } from '../engine.js';
import { interpolate, type VariableMap } from './template.js';

/**
 * Resolve a value-slot MAP — `{ <key>: <value> }`, every value a `value`-role
 * slot of the expression ledger (`FLOW_NODE_EXPRESSION_PATHS`) — to the
 * values the node acts with: the executor half of #11182 ruling D, shared by
 * every node whose map is such a slot.
 *
 *  - `create_record` / `update_record` `fields` (#19938) — the values written;
 *  - `subflow` `input` (#19939) — handed to the child flow as its params;
 *  - `map` `input` (#19939) — handed to each item's child flow, resolved once
 *    per item with the item (and index) variable bound in `variables`;
 *  - `script` `inputs` (#19939) — handed to the registered function as its
 *    `input`.
 *
 * Per key, by SHAPE — the rule the ledger resolver and the spec contract
 * (`FlowValueSlotSchema`) draw with the same predicate, imported rather than
 * re-spelled, so "which values does the validator judge" and "which values
 * does the executor evaluate" cannot drift apart:
 *
 *  - an envelope-shaped TOP-LEVEL value ({@link isExpressionEnvelopeShaped} —
 *    a plain object naming a string `dialect`) is a CEL value envelope, and
 *    is EVALUATED by `AutomationEngine.evaluateValueEnvelope` — the call the
 *    `assignment` executor makes too: one evaluator, one scope (`celScope`,
 *    the PARENT's variables for a callee's map), one notion of malformed
 *    (`valueEnvelopeRefusals`, the call `registerFlow` makes). A malformed
 *    envelope throws rather than degrading to a literal; a value that faults
 *    on the live variables throws with its source (ADR-0032 §1c/§1d). Neither
 *    is handed on. The result is the raw value, its type kept: a list stays a
 *    list, a record a record.
 *  - every other value is a literal — a string, an array, a plain object, an
 *    envelope-shaped object NESTED inside either — and is handed on as it is.
 *    A `{token}` of the retired template dialect never reaches this point:
 *    each executor's `parseNodeConfig` refuses it through
 *    `FlowValueSlotSchema` (the same judge `registerFlow` and
 *    `objectstack validate` call), so a literal here carries no token, and
 *    `interpolate()` is the identity on its text. The call is the one the
 *    CRUD resolver this generalises already made — it hands on a copy, so a
 *    callee that writes into its input never writes into the node's config —
 *    and it goes with the single-brace resolver's other residual calls
 *    (ADR-0032 Sequencing 6). ⛔ Not a fallback for an envelope: the dispatch
 *    is by shape, and an envelope never reaches the interpolator.
 *
 * `context` is the run's: it is what `current_user` is in the CEL scope.
 * `slot` names the map in a refusal (`fields.total`, `input.ownerId`).
 *
 * Before this, the three callee maps were handed to `interpolate()` whole,
 * which recursed into an envelope as plain data: the callee received the
 * object `{ dialect: 'cel', source: '…' }` it spells, with the run reporting
 * success — the same defect #19938 removed from the CRUD `fields` map.
 */
export function resolveValueSlotMap(
    engine: AutomationEngine,
    map: Record<string, unknown> | undefined,
    variables: VariableMap,
    slot: string,
    context: AutomationContext,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(map ?? {})) {
        out[key] = isExpressionEnvelopeShaped(value)
            ? engine.evaluateValueEnvelope(value, variables, `${slot}.${key}`, context)
            : interpolate(value, variables, context);
    }
    return out;
}
