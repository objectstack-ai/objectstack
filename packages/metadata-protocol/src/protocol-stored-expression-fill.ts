// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32527] The metadata doors' half of the stored-expression fill at the
 * change (ruling 6816429574, letter A): the save or publish that adds a stored
 * computed field (a non-`formula` field declaring `expression`), changes its
 * expression, or turns a formula into one fills the object's existing rows
 * with the write's own computation and reports the count per field. Not
 * opt-in.
 *
 * ## Which doors
 *
 * Every door that makes a changed `object` or `object_extension` definition
 * live for the data plane runs its registry write-through and then its
 * storage sync; three of them are authoring doors, and each fills:
 *
 * - `saveMetaItem` in publish mode (`PUT /api/v1/meta/:type/:name`), and the
 *   doors that save through it;
 * - `publishMetaItem` (`POST /api/v1/meta/:type/:name/publish`);
 * - `publishPackageDrafts` (`POST /api/v1/packages/:id/publish-drafts`),
 *   which registers the batch's objects before its per-item side effects, so
 *   it captures before that registration.
 *
 * [#32700] …and the history doors that make a restored definition live
 * (`protocol-package-commits.ts`) fill it the same way, after the storage
 * sync they now run as the save door does:
 *
 * - `rollbackMetaItem` (`POST /api/v1/meta/:type/:name/rollback`);
 * - `revertCommit` (`POST /api/v1/packages/:id/commits/:commitId/revert`),
 *   which captures each object before its first restore and fills it once
 *   after the loop; and `rollbackToPackageCommit`
 *   (`POST /api/v1/packages/:id/rollback`), a loop of `revertCommit`, whose
 *   answer carries every step's notices.
 *
 * A draft save makes nothing live and fills nothing. A peer applying another
 * node's mutation (`applyRemoteMetadataMutation`) fills nothing either: the
 * node whose door took the change filled the shared rows once.
 *
 * ## The fill and its report
 *
 * The door captures the object BEFORE its write-through
 * ({@link captureStoredExpressionChange}) and fills AFTER the object is served
 * and its storage synced ({@link fillStoredExpressionChange}). The walk and its
 * writes are the engine's (`@objectstack/objectql`'s
 * `captureStoredExpressions`, the walk `os migrate stored-expressions` runs):
 * every row, every organization, under `preserveAudit`. Each changed field is
 * reported on the door's existing `advisories` — the key a refused storage
 * sync rides (`object-storage-sync-refused`), with the same element shape:
 *
 * - `stored-expression-filled` (`info`): the rows written for that field, and
 *   how many the object holds;
 * - `stored-expression-fill-incomplete` (`warning`): a row the fill could not
 *   write, an object it could not read, or a storage sync that was refused,
 *   with what is left and how to fill it.
 *
 * The save or publish itself is never failed by its fill: the definition is
 * live and stays live, and the answer says what the rows hold.
 */

import type { RuntimeAuthoringIssue } from './runtime-authoring-gate.js';
import { OBJECT_EXTENSION_TYPE } from './protocol-object-extension-item.js';
import { clientFacingFailureText } from './protocol-client-failures.js';

/** The rule id of a field whose existing rows the change filled. Stable across releases. */
export const STORED_EXPRESSION_FILLED = 'stored-expression-filled';
/** The rule id of a field whose existing rows the change did not finish filling. Stable across releases. */
export const STORED_EXPRESSION_FILL_INCOMPLETE = 'stored-expression-fill-incomplete';

/** What the engine's fill reports, as far as the doors read it (`StoredExpressionBackfillReport`). */
export interface StoredExpressionFillReport {
    scannedRecords: number;
    fields: ReadonlyArray<{
        object: string;
        field: string;
        nullRows: number;
        staleRows: number;
        faultedRows: number;
        written: number;
        /** Rows another write changed after the fill read them, left to that write (which computed the value). */
        concurrentRows?: number;
    }>;
    skippedRows: number;
    truncated: boolean;
    unreadableObjects: ReadonlyArray<string>;
    failures: ReadonlyArray<{ recordId: string; error: string }>;
}

/** The engine's capture of one object (`StoredExpressionCapture`). */
export interface StoredExpressionFillCapture {
    readonly object: string;
    changedFields(): string[];
    fillChanged(): Promise<StoredExpressionFillReport | undefined>;
}

/**
 * The object whose rows a write of `type`/`name` can change the stored
 * computed fields of: an `object` is named by itself, an `object_extension`
 * by the object it extends. `undefined` for every other type.
 */
function filledObjectOf(type: string, name: string): string | undefined {
    return type === 'object' || type === OBJECT_EXTENSION_TYPE ? name : undefined;
}

/**
 * Capture `name`'s stored computed fields before the door's write-through
 * makes the change live. `undefined` for a type that defines no object, or an
 * engine without the capture (a test double, a metadata-only store), which
 * fills nothing.
 */
export function captureStoredExpressionChange(
    engine: { captureStoredExpressions?(object: string): StoredExpressionFillCapture } | undefined,
    type: string,
    name: string,
): StoredExpressionFillCapture | undefined {
    const object = filledObjectOf(type, name);
    if (object === undefined || typeof engine?.captureStoredExpressions !== 'function') return undefined;
    return engine.captureStoredExpressions(object);
}

const where = (object: string, field: string) => `object "${object}" · field "${field}"`;
const path = (object: string, field: string) => `objects.${object}.fields.${field}`;
const rows = (n: number) => `${n} row${n === 1 ? '' : 's'}`;

/** The remedy for rows the door's fill left: a write of each, or the command over all of them. */
function fillRemedy(object: string, field: string): string {
    return 'Each such row is computed when it is next written. To fill them all at once, run '
        + `\`os migrate stored-expressions --object ${object} --field ${field} --changed --apply\` against the `
        + 'database (its dry run, without --apply, lists them first).';
}

/**
 * Fill what the captured change made live, once the object is served and its
 * storage synced, and say per field what the rows hold: one advisory for each
 * field that computes something new. Nothing when the change made no such
 * field live.
 *
 * `storageRefused`: the door's storage sync was refused, so a column this
 * change added may not exist; the fill is not attempted (every row's write
 * would fail on it) and each field is reported unfilled.
 */
export async function fillStoredExpressionChange(
    capture: StoredExpressionFillCapture | undefined,
    options: { storageRefused?: boolean } = {},
): Promise<RuntimeAuthoringIssue[]> {
    if (!capture) return [];
    const { object } = capture;
    if (options.storageRefused) {
        return capture.changedFields().map((field) => ({
            rule: STORED_EXPRESSION_FILL_INCOMPLETE,
            severity: 'warning' as const,
            where: where(object, field),
            path: path(object, field),
            message: `'${object}.${field}' computes a new value at this change, and the object's existing rows were NOT `
                + 'filled with it: the storage sync this change needed was refused (the notice before this one). Until '
                + 'they are written, those rows hold NULL or the old value, and every reader of the column reads it.',
            hint: `Resolve the storage refusal first. ${fillRemedy(object, field)}`,
        }));
    }
    let report: StoredExpressionFillReport | undefined;
    try {
        report = await capture.fillChanged();
    } catch (err: unknown) {
        // Handed to the caller below, on the answer it reads; the change itself stays live.
        console.warn(`[Protocol] the stored-expression fill of '${object}' did not run: ${(err as Error)?.message ?? String(err)}`);
        const reason = clientFacingFailureText(err, 'the reason is in the server log');
        return capture.changedFields().map((field) => ({
            rule: STORED_EXPRESSION_FILL_INCOMPLETE,
            severity: 'warning' as const,
            where: where(object, field),
            path: path(object, field),
            message: `'${object}.${field}' computes a new value at this change, and the fill of the object's existing `
                + `rows did not run (${reason}). Until they are written, those rows hold NULL or the old value, and every `
                + 'reader of the column reads it.',
            hint: fillRemedy(object, field),
        }));
    }
    if (!report) return [];
    const whole = report.failures.length === 0 && report.skippedRows === 0 && !report.truncated
        && report.unreadableObjects.length === 0;
    // An object that holds no row (a new one, as a rule) had nothing to fill: a
    // clean answer stays unchanged.
    if (whole && report.scannedRecords === 0) return [];
    const notices: RuntimeAuthoringIssue[] = [];
    for (const f of report.fields) {
        const concurrent = f.concurrentRows ?? 0;
        const left = Math.max(0, f.nullRows + f.staleRows - f.written - concurrent);
        const meanwhile = concurrent > 0
            ? ` ${rows(concurrent)} written by another write while the fill ran computed it there, and were not written over.`
            : '';
        const faulted = f.faultedRows > 0
            ? ` On ${rows(f.faultedRows)} the expression does not evaluate, so it computes NULL there, as any write of them stores.`
            : '';
        if (whole || (left === 0 && report.unreadableObjects.length === 0 && !report.truncated)) {
            notices.push({
                rule: STORED_EXPRESSION_FILLED,
                severity: 'info',
                where: where(f.object, f.field),
                path: path(f.object, f.field),
                message: `'${f.object}.${f.field}' computes a new value at this change, so the platform filled the `
                    + `object's existing rows: ${rows(f.written)} of ${report.scannedRecords} written with the value its `
                    + `expression computes; the others already held it.${meanwhile}${faulted}`,
                hint: 'Nothing to do: every row holds what a write of it would store.',
            });
            continue;
        }
        const why = [
            report.failures.length > 0 ? `${rows(report.failures.length)} refused the write` : '',
            report.skippedRows > 0
                ? `${rows(report.skippedRows)} hold a value that a field which does not evaluate there would replace with NULL`
                : '',
            report.unreadableObjects.length > 0 || report.truncated ? 'the object\'s rows could not all be read' : '',
        ].filter(Boolean).join('; ');
        notices.push({
            rule: STORED_EXPRESSION_FILL_INCOMPLETE,
            severity: 'warning',
            where: where(f.object, f.field),
            path: path(f.object, f.field),
            message: `'${f.object}.${f.field}' computes a new value at this change, and the fill of the object's existing `
                + `rows did not finish: ${rows(f.written)} written, ${left > 0 ? `${rows(left)} not` : 'others not read'} `
                + `(${why}). Until they are written, those rows hold NULL or the old value, and every reader of the column `
                + `(filters, sorts, roll-ups, reports) reads it.${meanwhile}${faulted}`,
            hint: fillRemedy(f.object, f.field),
        });
    }
    return notices;
}
