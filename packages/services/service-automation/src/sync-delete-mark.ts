// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D3] Delete marking: what a pull does with a row the source no
 * longer has. Both pulls (the connector source, `./connector-pull.ts`, and the
 * datasource source, `./datasource-pull.ts`) mark through
 * {@link SyncDeleteMarker}; a pull never deletes a row physically.
 *
 * ## The policy
 *
 * The source block's `deletePolicy`, absent reading as `'mark'` (the schema
 * declares no default, so an authored value stays distinguishable):
 *
 * - **`'ignore'`** leaves every row as it is, a mark an earlier run stamped
 *   included.
 * - **`'mark'`** stamps the platform column `_sync_deleted_at` on a row the
 *   source deleted, and clears it when a later pull reads the row again. Two
 *   detections:
 *   - **`deletedField`**, on any pull that declares it: a read row whose
 *     source value in that field is truthy is marked, and every other read row
 *     is cleared. It is the only way an incremental pull, which never sees an
 *     absent row, learns of a delete; an incremental source under `'mark'`
 *     without one is refused before anything is read
 *     (`incrementalSourceDeleteRefusal`, `@objectstack/spec/data`, the same
 *     rule the mapping's parse refuses).
 *   - **absence**, on a full pull whose read was complete
 *     ({@link SyncDeleteMarker.markAbsent}): every row of this mapping the run
 *     did not read is marked. The caller decides completeness by the ADR's
 *     terms and, when the read was not complete, records why
 *     ({@link SyncDeletesNote}).
 *
 * ## Which rows are this mapping's, and which the run read
 *
 * A row is this mapping's when its `_sync_source` holds the mapping's name
 * (ADR-0153 D4's column; two mappings on one target object each mark only
 * their own rows this way, and ADR-0153's open point on that case stays open:
 * nothing here refuses it). Two packages may each hold a mapping of one name
 * (ADR-0150 D3); their rows on one target share a `_sync_source`, which is that
 * same open case, and the read and write of every step run under the pull's
 * context, so a job's organization scopes them (`{ isSystem, tenantId }`).
 *
 * A row the run read was written by it, so its `_sync_pulled_at` is at or
 * after the run's start ({@link SyncDeleteMarkerInit.runStartedAt}): the
 * absence mark takes the rows stamped before it. A row the source sent but the
 * import runner refused was read and not restamped, so its key is excluded by
 * name; past {@link REFUSED_KEY_LIMIT} such keys the run marks nothing by
 * absence (`unjudged, rows refused`).
 *
 * The keys are compared within one run only: a complete read restamps every
 * live row's `_sync_external_id` in the spelling of the mapping as it is now,
 * so a reordered `upsertKey` is never compared with an older spelling here.
 *
 * ## How it writes
 *
 * Each mark or clear is an update of one row by id, through the protocol's data
 * door, with the pull's write mark (`markSyncPullWrite`): the engine admits a
 * `_sync_` column from that write only, and its hooks and audit run as on any
 * write. The value is an ISO 8601 string. The rows to change are found first,
 * paged by id, under the pull's read context.
 */

import { SYNC_PROVENANCE_COLUMNS } from '@objectstack/spec/data';
import type { ConnectorPullProtocol } from './connector-pull.js';

type Rec = Record<string, unknown>;

const [SYNC_SOURCE, SYNC_EXTERNAL_ID, SYNC_PULLED_AT, , SYNC_DELETED_AT] = SYNC_PROVENANCE_COLUMNS;

/**
 * What a run did about deletes, as its `sys_sync_run.deletes` says it.
 *
 * - `judged`: a full pull whose read was complete marked by absence;
 * - `by deletedField`: an incremental pull marked through `deletedField` only;
 * - `ignored`: `deletePolicy: 'ignore'`;
 * - `unjudged, …`: a full pull that marks nothing by absence, and why — a
 *   NULL watermark on the source (a row whose watermark became NULL would read
 *   as absent), a connector source with no `paging` declared (one response is
 *   not known to be the whole set), a connector source whose declared paging
 *   the pull does not follow yet (it reads one response), or more refused rows
 *   than the exclusion holds.
 */
export type SyncDeletesNote =
    | 'judged'
    | 'by deletedField'
    | 'ignored'
    | 'unjudged, null watermark'
    | 'unjudged, no paging declared'
    | 'unjudged, pages not followed'
    | 'unjudged, rows refused';

/** The most refused-row keys the absence mark excludes by name. */
export const REFUSED_KEY_LIMIT = 1000;

/** Rows read per page when finding the rows to mark or clear. */
const MARK_PAGE_SIZE = 500;

/** The source block's delete policy, as the pull reads it (absent ⇒ `'mark'`). */
export interface SyncDeletePolicy {
    policy: 'mark' | 'ignore';
    /** `deletedField`, when declared. */
    deletedField?: string;
}

/** The delete policy a stored source block declares; tolerant of an unparsed block. */
export function syncDeletePolicyOf(block: unknown): SyncDeletePolicy {
    const b = block !== null && typeof block === 'object' ? block as Rec : {};
    const deletedField = typeof b.deletedField === 'string' && b.deletedField.length > 0 ? b.deletedField : undefined;
    return { policy: b.deletePolicy === 'ignore' ? 'ignore' : 'mark', ...(deletedField ? { deletedField } : {}) };
}

export interface SyncDeleteMarkerInit {
    protocol: ConnectorPullProtocol;
    environmentId?: string;
    mapping: string;
    targetObject: string;
    policy: SyncDeletePolicy;
    /** The pull's read context: a job's `{ isSystem, tenantId }` scopes every find to its organization. */
    readContext: unknown;
    /** The pull's write context, carrying `markSyncPullWrite`. */
    writeContext: unknown;
    /** ISO 8601, taken before the run's first write: every row the run writes is stamped at or after it. */
    runStartedAt: string;
}

/** The absence mark's range on a datasource source: rows whose copied watermark is non-NULL and at or above `start`. */
export interface SyncMarkRange {
    /** The target field `fieldMapping` copies `watermark.field` onto. */
    field: string;
    /** `watermark.start`, in the field's storage form. */
    start: string | number;
}

/**
 * The delete marking of one pull. Under `'ignore'` every method is a no-op.
 */
export class SyncDeleteMarker {
    /** Rows this run stamped `_sync_deleted_at` on. */
    marked = 0;
    /** Rows this run cleared it on. */
    cleared = 0;
    /** Whether any row of this mapping may carry a mark: read once, then kept true by a mark. */
    private mayCarryMark: boolean | undefined;
    /** Keys of rows read but not written (refused by the runner), up to {@link REFUSED_KEY_LIMIT} + 1. */
    private readonly unwritten = new Set<string>();

    constructor(private readonly init: SyncDeleteMarkerInit) {}

    get policy(): SyncDeletePolicy['policy'] {
        return this.init.policy.policy;
    }

    /**
     * One batch the pull wrote: the source rows as read, the rows as handed to
     * the import runner (stamped with `_sync_external_id`), and which of them
     * were written. Marks the rows `deletedField` says were deleted, clears
     * every other read row, and remembers the refused rows' keys.
     */
    async afterBatch(sourceRows: ReadonlyArray<Rec>, stampedRows: ReadonlyArray<Rec>, written: readonly boolean[]): Promise<void> {
        if (this.policy !== 'mark') return;
        const { deletedField } = this.init.policy;
        const toMark: string[] = [];
        const toClear: string[] = [];
        stampedRows.forEach((row, i) => {
            const key = row[SYNC_EXTERNAL_ID];
            if (typeof key !== 'string' || key === '') return;
            if (written[i] !== true && this.unwritten.size <= REFUSED_KEY_LIMIT) this.unwritten.add(key);
            if (deletedField !== undefined && Boolean(sourceRows[i]?.[deletedField])) toMark.push(key);
            else toClear.push(key);
        });
        if (toMark.length > 0) {
            this.marked += await this.stamp(
                { [SYNC_EXTERNAL_ID]: { $in: toMark }, [SYNC_DELETED_AT]: { $null: true } }, new Date().toISOString());
        }
        if (toClear.length > 0 && await this.anyMarked()) {
            this.cleared += await this.stamp({ [SYNC_EXTERNAL_ID]: { $in: toClear }, [SYNC_DELETED_AT]: { $null: false } }, null);
        }
    }

    /**
     * Whether the absence mark can exclude every refused row by name: false
     * past {@link REFUSED_KEY_LIMIT} keys, where the caller records
     * `unjudged, rows refused` and marks nothing by absence.
     */
    canMarkAbsent(): boolean {
        return this.unwritten.size <= REFUSED_KEY_LIMIT;
    }

    /**
     * The absence mark of a full pull whose read was complete: every row of
     * this mapping not stamped by this run, not refused by it, not marked
     * already and, on a datasource source, inside `range`. The caller has
     * judged completeness and {@link canMarkAbsent}.
     */
    async markAbsent(range?: SyncMarkRange): Promise<void> {
        if (this.policy !== 'mark') return;
        const where: Rec = {
            [SYNC_DELETED_AT]: { $null: true },
            [SYNC_PULLED_AT]: { $lt: this.init.runStartedAt },
            ...(this.unwritten.size > 0 ? { [SYNC_EXTERNAL_ID]: { $nin: [...this.unwritten] } } : {}),
        };
        // [ADR-0153 D3] Only rows the read could have read: a change of
        // `watermark.start` or `watermark.field` marks nothing outside the range.
        const scoped = range
            ? { $and: [where, { [range.field]: { $null: false } }, { [range.field]: { $gte: range.start } }] }
            : where;
        this.marked += await this.stamp(scoped, new Date().toISOString());
    }

    /** Is any row of this mapping marked? Read once; a mark this run makes keeps it true. */
    private async anyMarked(): Promise<boolean> {
        if (this.mayCarryMark === undefined) {
            this.mayCarryMark = (await this.find({ [SYNC_DELETED_AT]: { $null: false } }, undefined, 1)).length > 0;
        }
        return this.mayCarryMark;
    }

    /** Set `_sync_deleted_at` to `value` on every row of this mapping `where` matches; answers how many. */
    private async stamp(where: Rec, value: string | null): Promise<number> {
        let count = 0;
        let after: unknown;
        for (;;) {
            const page = await this.find(where, after, MARK_PAGE_SIZE);
            for (const row of page) {
                await this.init.protocol.updateData({
                    object: this.init.targetObject,
                    id: String(row.id),
                    data: { [SYNC_DELETED_AT]: value },
                    context: this.init.writeContext,
                    ...(this.init.environmentId ? { environmentId: this.init.environmentId } : {}),
                } as never);
                count++;
            }
            if (page.length < MARK_PAGE_SIZE) break;
            after = page[page.length - 1].id;
        }
        if (value !== null && count > 0) this.mayCarryMark = true;
        return count;
    }

    /** The ids of this mapping's rows `where` matches, after `after` in id order. */
    private async find(where: Rec, after: unknown, limit: number): Promise<Rec[]> {
        const parts: Rec[] = [{ [SYNC_SOURCE]: this.init.mapping }, where];
        if (after !== undefined) parts.push({ id: { $gt: after } });
        const res = await this.init.protocol.findData({
            object: this.init.targetObject,
            query: {
                object: this.init.targetObject,
                where: { $and: parts },
                fields: ['id'],
                orderBy: [{ field: 'id', order: 'asc' }],
                limit,
                count: false,
            },
            context: this.init.readContext,
            ...(this.init.environmentId ? { environmentId: this.init.environmentId } : {}),
        } as never);
        const rows = Array.isArray(res) ? res : Array.isArray((res as Rec | undefined)?.records) ? (res as { records: Rec[] }).records : [];
        return rows.filter((r): r is Rec => r !== null && typeof r === 'object' && r.id !== undefined && r.id !== null);
    }
}
