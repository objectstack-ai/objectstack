// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6615] The shared home for Postgres' `«sub-object» "x" of relation "y" …`
 * phrase.
 *
 * The defect class this pins is a **substring** one, so no single phrase can
 * express it: Postgres' write-path missing-COLUMN message contains a complete,
 * legal missing-TABLE phrase inside it. That is pinned first and explicitly
 * ({@link SUPERSTRING}) rather than left implicit in a corpus row, because it
 * is the thing all three consumers separately grew a repair for and the only
 * reason this module exists.
 *
 * The corpus is then driven as a table across **both** exported widths at once.
 * That shape is the point: the two functions must disagree on exactly the rows
 * where the width difference is deliberate, and agree everywhere else. A test
 * per function could not see that, and collapsing the two into one regex —
 * the recorded risk on the card — would show up here as a column that stopped
 * differing.
 */

import { describe, it, expect } from 'vitest';
import { matchMissingColumnOfRelation, isRelationSubObjectPhrase } from './relation-sub-object.js';

/**
 * The hole itself, stated as an assertion rather than as prose.
 *
 * The left string means "the column is misspelled, the table is fine"; the
 * right string is the phrasing Postgres uses for "the table is gone", and it
 * sits inside the left one verbatim. A consumer classifying by "does this say a
 * relation is missing" therefore CANNOT get this right by tightening that
 * question — which is why every consumer asks the narrower question first.
 */
const SUPERSTRING = 'column "label" of relation "sys_team" does not exist';
const MISSING_TABLE_PHRASE = 'relation "sys_team" does not exist';

describe('[#6615] the superstring hole every consumer repairs', () => {
    it('the missing-COLUMN phrase literally contains a legal missing-TABLE phrase', () => {
        expect(SUPERSTRING).toContain(MISSING_TABLE_PHRASE);
        // …and the missing-table phrase is well-formed on its own terms: the
        // anchored postgres limb `service-analytics` and `metadata` both use
        // matches it. So the containment is not a near-miss to be regexed away.
        expect(MISSING_TABLE_PHRASE).toMatch(
            /relation\s+["'`]?[A-Za-z0-9_$.]+["'`]?\s+does not exist/i,
        );
    });

    it('both exports recognise it, which is what lets a consumer subtract it first', () => {
        expect(matchMissingColumnOfRelation(SUPERSTRING)).toBe('label');
        expect(isRelationSubObjectPhrase(SUPERSTRING)).toBe(true);
    });

    it('neither export claims the bare missing-TABLE phrase — subtraction must not eat it', () => {
        // The direction that matters: if either width matched this, every
        // genuinely missing table would become a hard failure and #5033's
        // deliberate leniency would be gone.
        expect(matchMissingColumnOfRelation(MISSING_TABLE_PHRASE)).toBeUndefined();
        expect(isRelationSubObjectPhrase(MISSING_TABLE_PHRASE)).toBe(false);
    });
});

/**
 * One row per wording this repo actually carries, both widths in one place.
 *
 * `column` is the strict extractor's expected answer (`undefined` = no match);
 * `wide` is the exclusion predicate's. Rows where they differ are the width
 * difference being deliberate, and are commented as such.
 */
const CORPUS: ReadonlyArray<
    readonly [name: string, message: string, column: string | undefined, wide: boolean]
> = [
    // ── both widths agree: postgres' write-path missing column (42703) ──
    ['PG write-path missing column', SUPERSTRING, 'label', true],
    [
        'PG write-path missing column, single-quoted identifiers',
        "column 'label' of relation 'sys_team' does not exist",
        'label',
        true,
    ],
    [
        'PG write-path missing column, backtick-quoted identifiers',
        'column `label` of relation `sys_team` does not exist',
        'label',
        true,
    ],
    [
        'PG write-path missing column, bare (unquoted) relation',
        'column "label" of relation sys_team does not exist',
        'label',
        // The extractor's relation limb is `\S+` — quoted or bare. The wide
        // detector needs no relation quoting either: it stops at `of relation`.
        true,
    ],
    [
        'PG write-path missing column, schema-qualified relation',
        'column "label" of relation "public"."sys_team" does not exist',
        'label',
        true,
    ],

    // ── the width difference, on purpose: other sub-objects of a LIVE relation ──
    [
        'PG missing constraint of a relation (42704)',
        'constraint "uq_sys_team_name" of relation "sys_team" does not exist',
        // Not a COLUMN, so the extractor has nothing to extract and says so.
        // The exclusion still must fire: the relation is present, so this is
        // not a missing table, and calling it one restarts `event_seq` at 1.
        undefined,
        true,
    ],
    [
        'PG missing trigger of a relation (42704)',
        'trigger "trg_audit" of relation "sys_team" does not exist',
        undefined,
        true,
    ],
    [
        'PG column ALREADY EXISTS on a relation (42701)',
        'column "environment_id" of relation "sys_metadata" already exists',
        // The extractor is anchored to `does not exist` — a different verdict
        // is a different error and it must not be reported as a missing column.
        // The exclusion is verdict-blind by design: whatever this error is, the
        // relation is present, so `isMissingTableError` must not claim it.
        undefined,
        true,
    ],
    [
        'a quoted identifier the extractor deliberately cannot read',
        // Postgres permits arbitrary quoted identifiers. The extractor's
        // `[a-z0-9_]+` misses this and that miss is the CHEAP direction (a
        // vaguer message); the exclusion must not miss it, because its miss is
        // the EXPENSIVE one (a corruption verdict returns).
        'column "first name" of relation "sys_team" does not exist',
        undefined,
        true,
    ],

    // ── both widths stay out: nothing here is about a sub-object of a relation ──
    ['PG missing table', MISSING_TABLE_PHRASE, undefined, false],
    [
        'PG read-path missing column — no relation named at all',
        'column "bogus" does not exist',
        undefined,
        false,
    ],
    ['sqlite missing table', 'no such table: sys_team', undefined, false],
    ['sqlite missing column', 'no such column: bogus', undefined, false],
    ['sqlite unknown column, other spelling', 'table sys_team has no column named label', undefined, false],
    ['mysql missing table', "Table 'app.sys_team' doesn't exist", undefined, false],
    ['mysql unknown column', "Unknown column 'label' in 'field list'", undefined, false],
    [
        'PG not-null violation — names a column AND a relation, but is neither question',
        'null value in column "organization_id" of relation "sys_team" violates not-null constraint',
        // The extractor wants `does not exist`; this says `violates`. Correct:
        // the column is right there, it was just left empty, and `mapDataError`
        // routes this to its `notNull` limb for a different message entirely.
        undefined,
        // The exclusion fires, and must: the relation exists. This wording is
        // already the reason a verdict-blind exclusion is the right width.
        true,
    ],
    [
        'the dataset-compiler refusal that #5717 anchored the postgres limb away from',
        'Dataset includes relationship "owner" which does not exist on object "account"',
        undefined,
        false,
    ],
    ['empty message', '', undefined, false],
];

describe('[#6615] one phrase, two widths, one corpus', () => {
    it.each(CORPUS)('extractor: %s', (_name, message, column) => {
        expect(matchMissingColumnOfRelation(message)).toBe(column);
    });

    it.each(CORPUS)('wide detector: %s', (_name, message, _column, wide) => {
        expect(isRelationSubObjectPhrase(message)).toBe(wide);
    });

    it('the two widths genuinely differ — collapsing them would be caught here', () => {
        // The card's recorded risk is that a shared home quietly becomes ONE
        // regex, wrong for one caller whichever width wins. This asserts the
        // gap is non-empty in the one direction it can be: every message the
        // extractor claims is also a sub-object phrase, and strictly more
        // messages are sub-object phrases than are missing columns.
        const extractorHits = CORPUS.filter(([, , column]) => column !== undefined);
        const wideHits = CORPUS.filter(([, , , wide]) => wide);
        expect(extractorHits.length).toBeGreaterThan(0);
        expect(wideHits.length).toBeGreaterThan(extractorHits.length);
        for (const [name, , column, wide] of CORPUS) {
            if (column !== undefined) {
                expect(wide, `${name}: extracted a column but is not a sub-object phrase`).toBe(true);
            }
        }
    });

    it('the extractor never returns a relation name, only a column name', () => {
        // Guards against the one misuse the export shape cannot prevent by
        // itself: reading this answer as "which table".
        expect(matchMissingColumnOfRelation(SUPERSTRING)).not.toBe('sys_team');
    });
});
