// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29919] The one fold both SQL outboxes' `nextDueAt` end in: the earlier of
 * a deferred row's due time and the instant the oldest claim becomes reapable.
 *
 * Both cells are `Field.number` epoch-ms columns, read back raw from whatever
 * driver holds them, so each is coerced and a cell that denotes no instant
 * (`null`, a non-numeric value) contributes nothing rather than a `NaN` that
 * would poison the comparison. A claim is reaped once it is STRICTLY older than
 * the TTL (`claimed_at < now - claimTtlMs`), hence the `+ 1`.
 */
export function earliestDueAt(deferredAt: unknown, claimedAt: unknown, claimTtlMs: number): number | null {
    const candidates: number[] = [];
    const deferred = instantMs(deferredAt);
    if (deferred !== null) candidates.push(deferred);
    const claimed = instantMs(claimedAt);
    if (claimed !== null) candidates.push(claimed + claimTtlMs + 1);
    return candidates.length > 0 ? Math.min(...candidates) : null;
}

function instantMs(cell: unknown): number | null {
    if (cell === null || cell === undefined || cell === '') return null;
    const n = Number(cell);
    return Number.isFinite(n) ? n : null;
}
