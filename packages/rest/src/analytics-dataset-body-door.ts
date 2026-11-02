// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The door parse for `POST {basePath}/analytics/dataset/query`'s OUTER body —
 * the half `analytics-selection-door.ts` does not judge.
 *
 * ## The defect
 *
 * The handler reads four keys off the request body — `selection`,
 * `previewDrafts`, `dataset`, `datasetName` — and used to ignore every other
 * one. So a `runtimeFilter` written beside `selection` instead of inside it
 * answered **200 with the UNFILTERED aggregate**: the predicate was dropped, the
 * number on the dashboard was wider than the one asked for, and nothing in the
 * answer told it apart from a filter that matched everything. The sibling door
 * (`POST /analytics/query`) refuses an unknown key, and this door's own
 * `selection` refuses one with a "did you mean" hint; only the outer body was
 * open. Same anti-pattern as the REST ingress policy's closed query-parameter
 * set (`query-allowlist.ts`), pointed at the body instead of the query string.
 *
 * ## The closed set is MEASURED from the handler's read points
 *
 * {@link DATASET_QUERY_BODY_KEYS} is exactly what `analytics-routes.ts` reads
 * off `req.body` — `selection` (and its door), `previewDrafts` (the ADR-0037 P3
 * draft flag), `dataset` (the inline definition) and `datasetName` (a saved
 * one) — and nothing else. The producers were measured against it before the
 * set was closed: `@objectstack/client`'s `analytics.queryDataset`, the
 * Console's data adapter and `@objectstack/verify` all send a subset of these
 * four and nothing more.
 *
 * ## The remedy names the right place, read off the spec
 *
 * A key the body does not take but `selection` does (`DatasetSelectionSchema`,
 * the one declaration of that wire shape) is a misplaced member, and the
 * refusal says `did you mean \`selection.KEY\`?`. The member list is read off
 * the schema's own shape, ⛔ never transcribed here, so a member the spec adds
 * later is recognised without an edit to this file.
 *
 * Three spellings are not selection members but mean its filter:
 * `filter` / `filters` / `where`. They point at `selection.runtimeFilter`,
 * the one member whose loss WIDENS the answer — the case the card was filed
 * for. The selection schema curates the same three as aliases of
 * `runtimeFilter` one level down; this table answers the same near-miss one
 * level up, where the key is misplaced rather than misspelled.
 *
 * ## The ambiguous body
 *
 * `dataset` beside `datasetName` used to run the inline definition and drop
 * the name without a word, so a caller who meant the saved dataset got the
 * draft's numbers. No producer sends both (measured as above), so both is
 * refused as the same class: a body whose meaning the door would otherwise
 * have to guess. The test is the handler's own truthiness on BOTH keys
 * (`if (!dataset && body.datasetName)`): a truthy inline definition would win
 * over a truthy name. A falsy `datasetName` (`''`, `null`, absent) was never a
 * name to that branch, so `dataset` beside it still runs inline, and a falsy
 * `dataset` beside a name still runs the saved dataset, as both always did.
 *
 * ## The envelope
 *
 * This door's own body-refusal frame, the one `analytics-selection-door.ts`
 * answers an unknown selection key with: `400 VALIDATION_FAILED` + a sentence
 * + `details.fields[]`, each entry an ADR-0114 `{ field, code, message }`
 * (`unknown_field` for an unrecognised key, `invalid_shape` for the ambiguous
 * pair). The sentence opens the way the sibling door's does —
 * `Unrecognized key(s) on this dataset query: …` — so one condition reads the
 * same on both analytics doors.
 *
 * Validation-only: nothing is stripped or rewritten; a body that passes reaches
 * the handler exactly as the caller sent it.
 */

import type { DatasetSelectionRefusal } from './analytics-selection-door.js';

/**
 * Every key `POST …/analytics/dataset/query` reads off its request body —
 * measured from `analytics-routes.ts`, sorted.
 */
export const DATASET_QUERY_BODY_KEYS: readonly string[] = Object.freeze([
    'dataset',
    'datasetName',
    'previewDrafts',
    'selection',
]);

/**
 * Top-level spellings that mean the selection's filter but are not selection
 * members. See the module header for why these three, and only these.
 */
const FILTER_NEAR_MISSES: ReadonlySet<string> = new Set(['filter', 'filters', 'where']);

let selectionMembers: ReadonlySet<string> | undefined;

/**
 * The selection's declared members, read once off `DatasetSelectionSchema`'s
 * shape (lazily, the same way the selection door loads it).
 */
async function getSelectionMembers(): Promise<ReadonlySet<string>> {
    if (!selectionMembers) {
        const { DatasetSelectionSchema } = await import('@objectstack/spec/api');
        const shape = (DatasetSelectionSchema as unknown as { shape?: Record<string, unknown> }).shape;
        selectionMembers = new Set(shape && typeof shape === 'object' ? Object.keys(shape) : []);
    }
    return selectionMembers;
}

function remedyFor(key: string, members: ReadonlySet<string>): string | undefined {
    if (key === 'runtimeFilter' || FILTER_NEAR_MISSES.has(key)) return 'selection.runtimeFilter';
    if (members.has(key)) return `selection.${key}`;
    return undefined;
}

/**
 * Judge the outer body of a dataset query and describe the refusal, or
 * `undefined` when the body passes.
 *
 * A body that is not a plain object answers `undefined`: the route's own
 * checks after this one already answer it, naming the member they need.
 */
export async function datasetQueryBodyRefusal(
    body: unknown,
): Promise<DatasetSelectionRefusal | undefined> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const record = body as Record<string, unknown>;

    const accepted = new Set(DATASET_QUERY_BODY_KEYS);
    // Sorted so a body with several unknown keys always answers the same
    // sentence, whatever order the adapter built the object in.
    const unknown = Object.keys(record).filter((k) => !accepted.has(k)).sort();
    if (unknown.length > 0) {
        const members = await getSelectionMembers();
        const fields = unknown.map((key) => {
            const remedy = remedyFor(key, members);
            return {
                field: key,
                code: 'unknown_field',
                message: remedy
                    ? `Unrecognized key \`${key}\` on this dataset query — did you mean \`${remedy}\`?`
                    : `Unrecognized key \`${key}\` on this dataset query.`,
            };
        });
        const named = unknown
            .map((key) => {
                const remedy = remedyFor(key, members);
                return remedy ? `\`${key}\` (did you mean \`${remedy}\`?)` : `\`${key}\``;
            })
            .join(', ');
        const message = `Unrecognized key(s) on this dataset query: ${named}. `
            + `The request body takes ${DATASET_QUERY_BODY_KEYS.map((k) => `\`${k}\``).join(', ')}; `
            + 'every selection member, the filter included, goes inside `selection`. '
            + 'This door will not ignore a key it does not understand: a dropped filter '
            + 'would answer with the unfiltered aggregate.';
        return { status: 400, body: { code: 'VALIDATION_FAILED', message, details: { fields } } };
    }

    if (record.dataset && record.datasetName) {
        const message = 'Ambiguous dataset query: the body names both `dataset` (an inline definition) '
            + 'and `datasetName` (a saved dataset). Send exactly one — `dataset` to run a draft, '
            + '`datasetName` to run the saved definition.';
        const fields = ['dataset', 'datasetName'].map((field) => ({
            field,
            code: 'invalid_shape',
            message: 'Send either `dataset` or `datasetName`, not both.',
        }));
        return { status: 400, body: { code: 'VALIDATION_FAILED', message, details: { fields } } };
    }

    return undefined;
}
