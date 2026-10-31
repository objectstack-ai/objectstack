// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28355] The `denied` audit row a single-item metadata door owes for a
 * refusal that writes no row of its own.
 *
 * `sys_metadata_audit.code` documents `not_overridable`, `not_creatable`,
 * `invalid_metadata` and `destructive_change` as `denied` values, and the four
 * single-item doors (`saveMetaItem`, `publishMetaItem`, `rollbackMetaItem`,
 * `deleteMetaItem`) do refuse with exactly those catalogued codes — but only
 * the lock gate (`item_locked`) and the optimistic-concurrency check
 * (`metadata_conflict`) ever wrote a row. Every other refusal left the trail
 * silent, so a reader of `/audit` concluded that a refused attempt never
 * happened.
 *
 * The row is stamped where the door hands the refusal back to its caller,
 * not at each of the many sites inside the door that can raise one: those
 * codes are thrown by shared helpers the doors reach in several places
 * (`refuseOrganizationScopedWrite`, the overlay and create gates, the
 * authoring-rule and spec gates, the destructive-change gate), so a per-site
 * write would leave any site added later silent again. One seam per door
 * reads the code the refusal carries and nothing else.
 *
 * What it deliberately does NOT do:
 *
 *  - It mints no new value. The map below is closed, and each value is one
 *    the column already documents. A refusal whose code is not in it — a
 *    driver fault, `INVALID_REQUEST`, `RESOURCE_CONFLICT`, any 5xx — leaves
 *    no row, exactly as before; lower-casing whatever `code` arrived would
 *    turn the column's closed set into an open one (the `batch_aborted`
 *    argument in the object file).
 *  - It does not re-stamp `item_locked` or `metadata_conflict`: their gates
 *    already write their own row, and neither code is in the map.
 *  - It writes one row per refusal even when one door hands it back through
 *    another: the first seam to record a refusal marks it, and every outer
 *    seam it passes through after that leaves it alone.
 *  - The batch publish keeps its own `batch_aborted` row with the causal code
 *    in `note`; it is not one of these doors.
 *
 * `note` carries {@link clientFacingFailureText}: it is wire-visible through
 * `GET /meta/:type/:name/audit`, and these refusals declare a 4xx, so their
 * sentence is the one the caller was already shown.
 */

import type { MetadataAuditEntry } from './protocol.js';
import { canonicalMetaType, clientFacingFailureText } from './protocol.js';

/**
 * The catalogued refusal codes (ADR-0112, SCREAMING) whose door stamps a
 * `denied` row, and the persisted audit value each one is stored as (D6b —
 * the column keeps its own lower-case vocabulary).
 */
export const REFUSAL_AUDIT_CODES: Readonly<Record<string, string>> = Object.freeze({
    NOT_OVERRIDABLE: 'not_overridable',
    NOT_CREATABLE: 'not_creatable',
    INVALID_METADATA: 'invalid_metadata',
    DESTRUCTIVE_CHANGE: 'destructive_change',
});

/** The door a refusal left, and the request fields its row is keyed on. */
export interface RefusalAuditDoor {
    operation: 'save' | 'publish' | 'rollback' | 'delete';
    type: unknown;
    name: unknown;
    actor: unknown;
    source: string;
}

/**
 * Name-mangled like `__pendingAudit`: an internal hand-off between two seams,
 * never a wire field. `clientFacingFailureText` / `clientFacingFailureCode`
 * read `message` / `code` only.
 */
type RefusalWithAuditMark = { code?: unknown; __refusalAudited?: true };

/**
 * The row `err` owes at `door`, or `null` when it owes none: its code is not
 * one of {@link REFUSAL_AUDIT_CODES}, an earlier seam already recorded it, or
 * the request names no item to key the row on.
 */
export function refusalAuditEntry(err: unknown, door: RefusalAuditDoor): MetadataAuditEntry | null {
    if (err === null || typeof err !== 'object') return null;
    const refusal = err as RefusalWithAuditMark;
    if (refusal.__refusalAudited) return null;
    if (typeof refusal.code !== 'string' || !Object.prototype.hasOwnProperty.call(REFUSAL_AUDIT_CODES, refusal.code)) return null;
    // No row without an identity: the trail is keyed on `(type, name)`, and
    // minting one for a request that names no item would file a fictional
    // item in a compliance ledger.
    if (typeof door.type !== 'string' || door.type === '') return null;
    if (typeof door.name !== 'string' || door.name === '') return null;
    return {
        // The writer refuses a non-canonical type; the door may be handed a
        // plural spelling it has not folded yet when the refusal comes first.
        type: canonicalMetaType(door.type),
        name: door.name,
        organizationId: null,
        operation: door.operation,
        outcome: 'denied',
        // adr0112-ok: D6b — persisted audit column, its own vocabulary
        code: REFUSAL_AUDIT_CODES[refusal.code]!,
        ...(typeof door.actor === 'string' && door.actor !== '' ? { actor: door.actor } : {}),
        source: door.source,
        note: clientFacingFailureText(err, refusal.code),
    };
}

/**
 * Run a door's body; when it refuses with a code that owes a row, record the
 * row and rethrow the same refusal untouched.
 *
 * `record` is the protocol's own `recordMetadataAudit`, handed in as a
 * closure so a spy set on the instance is the one reached. It is best-effort
 * by contract (ADR-0010 §3.6) and never replaces the refusal the caller gets.
 */
export async function withRefusalAudit<T>(
    record: (entry: MetadataAuditEntry) => Promise<void>,
    door: RefusalAuditDoor,
    run: () => Promise<T>,
): Promise<T> {
    try {
        return await run();
    } catch (err) {
        const entry = refusalAuditEntry(err, door);
        if (entry) {
            (err as RefusalWithAuditMark).__refusalAudited = true;
            await record(entry);
        }
        throw err;
    }
}
