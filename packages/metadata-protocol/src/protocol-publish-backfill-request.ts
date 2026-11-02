// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim: the publish-
// backfill entry, receipt, page size, refusal and request reader.
//
// A MOVE, not a redesign: every declaration below is byte-identical to the text that stood
// above `ObjectStackProtocolImplementation`; only the imports and the export list at the foot
// are new. `protocol.ts` re-exports what it exported.
import type { MetadataIssueEntry } from './protocol-metadata-issues.js';

/**
 * [#24253] One field a `publishPackageDrafts` backfill will write: the entry as
 * the request named it, plus the literal its draft declares. Built only by
 * `planPublishBackfill`, so every value here was judged before the publish.
 */
export interface PublishBackfillEntry {
    object: string;
    field: string;
    value: unknown;
}

/**
 * [#24253] The `backfillApplied` receipt of `publishPackageDrafts`, declared as
 * `PublishPackageDraftsResponseSchema.backfillApplied` in `@objectstack/spec/api`.
 * `updated` counts the rows this publish wrote, so a row that already held a
 * value (a database column DEFAULT fills one on the SQL driver) is not counted.
 */
export type PublishBackfillReceipt = {
    success: boolean;
    fields: Array<{ object: string; field: string; updated: number; error?: string; code?: string }>;
};

/** [#24253] Rows read and written per round of one field's backfill. */
export const PUBLISH_BACKFILL_PAGE_SIZE = 200;

/**
 * [#24253] The 400 a `publishPackageDrafts` backfill request is refused with:
 * every entry that cannot be honoured, by path, in one answer, before anything
 * is promoted or written. The headline names the first; `issues[]` names all.
 */
export function publishBackfillRefusal(
    packageId: string,
    issues: MetadataIssueEntry[],
): Error & { code: 'VALIDATION_ERROR'; status: 400; issues: MetadataIssueEntry[] } {
    const first = issues[0]!;
    const err = new Error(
        `Nothing was published: the backfill of package '${packageId}' cannot be honoured `
        + `(${issues.length} ${issues.length === 1 ? 'problem' : 'problems'}; first at ${first.path}: ${first.message}) `
        + 'Fix or drop the named entries and publish again.',
    ) as Error & { code: 'VALIDATION_ERROR'; status: 400; issues: MetadataIssueEntry[] };
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    err.issues = issues;
    return err;
}

/**
 * [#24253] The shape half of the backfill judgement: an array of
 * `{ object, field }` pairs, each named once, and the caller's context to write
 * as. Read before any server state, so a malformed request is refused the same
 * way whatever the package holds. Absent is nothing asked; so is `[]`.
 */
function readPublishBackfillRequest(
    packageId: string,
    backfill: unknown,
    context: unknown,
): Array<{ object: string; field: string }> {
    if (backfill === undefined) return [];
    const issues: MetadataIssueEntry[] = [];
    if (!Array.isArray(backfill)) {
        throw publishBackfillRefusal(packageId, [{
            path: 'backfill',
            message: 'Must be an array of { object, field } pairs naming the fields this publish adds.',
            code: 'invalid_type',
        }]);
    }
    const entries: Array<{ object: string; field: string }> = [];
    const seen = new Set<string>();
    backfill.forEach((entry: unknown, i: number) => {
        const path = `backfill.${i}`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            issues.push({ path, message: 'Must be an object { object, field }.', code: 'invalid_type' });
            return;
        }
        const extra = Object.keys(entry).filter((k) => k !== 'object' && k !== 'field');
        if (extra.length > 0) {
            issues.push({
                path,
                message: `Unrecognized ${extra.length === 1 ? 'key' : 'keys'} ${extra.map((k) => `'${k}'`).join(', ')}: `
                    + 'an entry names an object and a field, and the value written is the field\'s own defaultValue.',
                code: 'unrecognized_keys',
            });
            return;
        }
        const { object, field } = entry as { object?: unknown; field?: unknown };
        if (typeof object !== 'string' || object.length === 0 || typeof field !== 'string' || field.length === 0) {
            issues.push({ path, message: 'Both `object` and `field` must be non-empty strings.', code: 'invalid_type' });
            return;
        }
        const key = `${object}.${field}`;
        if (seen.has(key)) {
            issues.push({ path, message: `'${key}' is named more than once.`, code: 'custom' });
            return;
        }
        seen.add(key);
        entries.push({ object, field });
    });
    if (entries.length > 0 && (!context || typeof context !== 'object')) {
        issues.push({
            path: 'backfill',
            message: 'A backfill writes as the caller, and no caller context reached this publish: '
                + 'pass the caller\'s execution context as `context`. It is never written as the system.',
            code: 'custom',
        });
    }
    if (issues.length > 0) throw publishBackfillRefusal(packageId, issues);
    return entries;
}

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { readPublishBackfillRequest };
