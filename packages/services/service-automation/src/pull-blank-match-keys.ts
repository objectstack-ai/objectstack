// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pull's reading of the import runner's blank-match-key skips, shared by
 * both sources (`./connector-pull.ts`, `./datasource-pull.ts`) so neither
 * imports the other.
 */

import type { ImportRunSummary } from '@objectstack/core';

/**
 * [#31810] A pulled record whose match key is blank is a row ERROR on a pull,
 * not the import door's quiet skip: an uploaded file is read by the person who
 * chose `skipBlankMatchKey`, while a pull runs unattended, and its run outcome
 * is read from `errors` alone (a skip leaves the run `completed`). So each
 * `BLANK_MATCH_KEY` skip the runner reports is rewritten as a failed row, and
 * the tallies move with it. The import door's own blank-key behaviour is
 * untouched — this is the pull's reading of the runner's report.
 */
export function refuseBlankMatchKeys(
    summary: ImportRunSummary,
    mappingName: string,
    matchFields: string[],
): { summary: ImportRunSummary; count: number } {
    let count = 0;
    const results = summary.results.map((r) => {
        if (r.action !== 'skipped' || r.code !== 'BLANK_MATCH_KEY') return r;
        count++;
        // The runner's row, its `row` and its code kept: the verdict is the
        // runner's, only its reading (skip → failure) is the pull's.
        return {
            ...r,
            ok: false,
            action: 'failed' as const,
            error: `Mapping "${mappingName}": the pulled record has no value for upsertKey ${matchFields.join(' + ')}, `
                + 'so it was not written — a pull never creates a record it cannot match again',
        };
    });
    if (count === 0) return { summary, count };
    return {
        summary: { ...summary, results, skipped: summary.skipped - count, errors: summary.errors + count },
        count,
    };
}
