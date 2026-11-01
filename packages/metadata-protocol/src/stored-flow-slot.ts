// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Which stored row of a shipped flow name holds the registry's bare slot (#28717)
 *
 * The SchemaRegistry keeps ONE bare (package-less) slot per flow name, and
 * the registry hydration (`hydrateOverlayIntoRegistry`) registers every stored
 * `sys_metadata` row of a name into it. Before this rule the last row read
 * won the slot. A shipped flow name can hold two stored rows at once: the
 * shipping package's declared override in its `<base>.custom` pair (ADR-0146
 * D9 item 1, #28412) and a legacy package-less row saved before the override
 * existed. When the store read the legacy row last, the automation boot pull
 * — which reads the registry, not the store — never saw the override, armed
 * the base, and a record change fired before `kernel:ready` ran the base flow.
 *
 * ## The rule
 *
 * The declared override keeps the slot. It is told apart by the one
 * served-override predicate (`isServedOverrideRowOf`) judged on the row's
 * stored binding, the `package_id` column the hydration records
 * (`storedRowBindingOf`), ⛔ never a body's `_packageId`. Every other pair of
 * stored rows is unchanged: the last one read takes the slot. The same row
 * read again (same binding) always replaces itself, so a re-save of the
 * override, declared or not, is what the slot holds.
 *
 * ## The row that loses the slot is kept, stored and shadowed
 *
 * It is not deleted and not migrated: `flow` has `allowEnvironmentOverlay:
 * false`, and the declared flow write door is #28412's. It stays at rest and
 * is never armed. So that the boot names it, the override's registry body
 * carries it under a non-enumerable symbol ({@link shadowedStoredRowsOf}),
 * with its own stored binding still recorded on it. The boot pull lists it
 * beside the override, and its precedence ranks it as the runtime row it is:
 * shadowed, in the receipt, and named in the shadowing warning with the
 * override that wins. Keyed by the shadowed row's binding, so a row read again
 * is carried once. Like the binding, it never leaves the process.
 */

import { isServedOverrideRowOf } from './served-override.js';
import { storedRowBindingOf } from './stored-row-binding.js';

const SHADOWED_STORED_ROWS: unique symbol = Symbol.for('objectstack.metadata-protocol.shadowedStoredRows') as never;

type ShadowRecord = Map<string | null, object>;

function shadowRecordOf(item: unknown): ShadowRecord | undefined {
    if (item === null || typeof item !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(item, SHADOWED_STORED_ROWS)) return undefined;
    return (item as { [SHADOWED_STORED_ROWS]?: ShadowRecord })[SHADOWED_STORED_ROWS];
}

function writeShadowRecord(item: object, record: ShadowRecord): void {
    Object.defineProperty(item, SHADOWED_STORED_ROWS, {
        value: record,
        enumerable: false,
        writable: false,
        configurable: true,
    });
}

/** Carry `from`'s shadowed rows onto `to`, and add `loser` (by its binding) when given. */
function carryShadowed(from: unknown, to: object, loser?: object): void {
    const record: ShadowRecord = new Map(shadowRecordOf(from) ?? []);
    if (loser !== undefined) {
        const binding = storedRowBindingOf(loser);
        record.delete(binding === undefined ? null : binding);
        record.set(binding === undefined ? null : binding, loser);
    }
    if (record.size > 0) writeShadowRecord(to, record);
}

/**
 * The stored flow rows a registry body holds the bare slot over: each one the
 * hydration kept out of the slot, with its stored binding recorded on it. An
 * empty list for a body that displaced none, a code artifact, or a copy.
 */
export function shadowedStoredRowsOf(item: unknown): readonly object[] {
    return [...(shadowRecordOf(item)?.values() ?? [])];
}

/**
 * Settle the bare slot of one flow name between the row it `held` and the
 * stored row now `incoming`, both bound by {@link storedRowBindingOf}, for the
 * name's shipping package `basePackageId` (the loader's set's owner, or none).
 * Returns `true` when `incoming` takes the slot, `false` when the held
 * declared override keeps it. Records the row that loses on the one that wins.
 */
export function incomingTakesStoredFlowSlot(held: unknown, incoming: unknown, basePackageId: unknown): boolean {
    const heldBinding = storedRowBindingOf(held);
    // An empty slot, or one holding no stored row: nothing to settle.
    if (heldBinding === undefined || held === null || typeof held !== 'object') return true;
    if (incoming === null || typeof incoming !== 'object') return true;
    const incomingBinding = storedRowBindingOf(incoming);
    // The same stored row read again replaces itself, keeping what it shadowed.
    if (heldBinding === incomingBinding) {
        carryShadowed(held, incoming);
        return true;
    }
    const isOverride = (item: unknown, binding: string | null | undefined) =>
        isServedOverrideRowOf({ type: 'flow', package_id: binding ?? null, metadata: item }, basePackageId);
    const incomingIsOverride = isOverride(incoming, incomingBinding);
    if (!incomingIsOverride && isOverride(held, heldBinding)) {
        carryShadowed(held, held, incoming);
        return false;
    }
    if (incomingIsOverride) carryShadowed(held, incoming, held);
    return true;
}
