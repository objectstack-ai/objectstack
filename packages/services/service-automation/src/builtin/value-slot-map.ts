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
 *    `input`;
 *  - `screen` `defaults` (#19939) — an object form's prefill, served to the
 *    client (and, through {@link resolveValueSlot}, a field's `defaultValue`
 *    and an object form's `recordId`);
 *  - `notify` `templateData` and `payload` (#19939) — handed to the messaging
 *    service (and, through {@link resolveValueSlot}, each `recipients` value
 *    or list entry, `sourceObject`, `sourceId` and `actorId`).
 *
 * A `loop`'s and a `map`'s `collection` (#19939) is a value slot too, whose
 * literal is a list: {@link resolveCollectionSlot}.
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
        out[key] = resolveValueSlot(engine, value, variables, `${slot}.${key}`, context);
    }
    return out;
}

/**
 * Resolve ONE value-slot value — the per-key rule of
 * {@link resolveValueSlotMap}, for a slot that holds a single value rather than
 * a map: since #19939 a `screen` field's `defaultValue` and an object form's
 * `recordId` (`fields[].defaultValue`, `recordId` in the ledger), evaluated
 * before the screen goes on the wire — and a `notify` node's `recipients` (the
 * value, or each entry of a list), `sourceObject`, `sourceId` and `actorId`,
 * evaluated before the notification is handed on. The map resolver calls this per key, so
 * the dispatch by shape is spelled once: an envelope-shaped value is evaluated
 * by `AutomationEngine.evaluateValueEnvelope` (`where` names it in a refusal
 * or a fault, `fields[0].defaultValue`), and every other value is a literal,
 * handed on as a copy.
 */
export function resolveValueSlot(
    engine: AutomationEngine,
    value: unknown,
    variables: VariableMap,
    where: string,
    context: AutomationContext,
): unknown {
    return isExpressionEnvelopeShaped(value)
        ? engine.evaluateValueEnvelope(value, variables, where, context)
        : interpolate(value, variables, context);
}

/**
 * Resolve a `loop`'s (with a `body`) or a `map`'s `collection` — the list the
 * node iterates, a `value` slot whose literal is a list (#19939, the spec's
 * `FlowCollectionSlotSchema`). The executor half of the same rule:
 *
 *  - an envelope-shaped value is a CEL value envelope, EVALUATED by
 *    `AutomationEngine.evaluateValueEnvelope` in the run's scope and context,
 *    like every value slot's — a malformed one, or one that faults on the live
 *    variables (an absent variable, key or index), throws with its source;
 *  - an inline array is the list AS WRITTEN — never handed to the
 *    interpolator, whose recursion would resolve a `{…}` in a string the
 *    executors never interpolated: an inline list's elements are data.
 *
 * Nothing else arrives: each executor's `parseNodeConfig` has refused a string
 * — a `{…}` token of the retired dialect, and a variable's bare name, which the
 * structured `loop` and `map` never read (the interpolator handed the name
 * back, and every run failed at the node) — and every other value. The caller
 * checks the result is a list ({@link collectionNotAList}).
 */
export function resolveCollectionSlot(
    engine: AutomationEngine,
    value: unknown,
    variables: VariableMap,
    context: AutomationContext,
): unknown {
    return isExpressionEnvelopeShaped(value)
        ? engine.evaluateValueEnvelope(value, variables, 'collection', context)
        : value;
}

/**
 * Why an evaluated `collection` is no list — the returned failure a `loop` and
 * a `map` fail the node with, naming what the envelope evaluated to and its
 * source. A `null` lands here, the guarded form's answer for an absent list:
 * it fails the node as an unresolved `{token}` did, and a guard answering `[]`
 * iterates nothing instead.
 */
export function collectionNotAList(value: unknown, resolved: unknown): string {
    const source = (value as { source?: unknown } | null)?.source;
    const kind = resolved === null ? '`null`'
        : resolved === undefined ? 'nothing'
            : typeof resolved === 'object' ? 'a map'
                : `a ${typeof resolved}`;
    return `collection evaluated to ${kind}, not a list — source: \`${typeof source === 'string' ? source : ''}\``;
}
