// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [commit 5a95b0e93] `operatorFacingErrorText` — the dialect's words for a record an
 * operator reads later.
 *
 * ## The regression this closes, and why "one `cause` away" was not enough
 *
 * Since #16019 the raw-SQL seam declares its own fault: `DATABASE_ERROR` / 500,
 * a COMPOSED message that discloses neither the statement nor the diagnostic,
 * and the dialect error whole under a non-enumerable `cause`. On a LIVE console
 * that costs nothing — the driver writes the dialect's diagnostic to its warn
 * sink one line earlier, with the statement and its bound values cut (#21385).
 * In a STORED record it costs everything:
 * whoever reads a backfill's `detail` a week later never had that line, so
 * *"no such column: foo"* was replaced, irrecoverably for them, by *"the
 * database refused to run a raw statement"*.
 *
 * ## What is asserted here, in both directions
 *
 * The envelope's OWN message is pinned as the composed sentence in the same
 * test that pins the helper's answer as the dialect text — so "after" is never
 * asserted without "before" being visible beside it. The three narrowings are
 * pinned as hard as the unwrap itself, because each one is a way this helper
 * could quietly become a message sniffer:
 *
 *  - an UNDECLARED throw comes back as `messageChannelOf(e) || String(e)` — its
 *    own string `message`, the string itself for a thrown string, `String(e)`
 *    otherwise — with its `cause` never walked. A rule, not byte-identity with
 *    whatever the call site used to compute;
 *  - a DECLARED envelope that is not the raw-path one — the read-exit terminal
 *    `backendStatementFaultError`, the #8931 / PR #9273 half — is left exactly
 *    as it arrived, which is what keeps that decision out of this change;
 *  - the walk is bounded, so a cyclic or absurdly deep chain terminates.
 *
 * ⚠️ The composed sentence below is the PRODUCER's, copied. It is pinned
 * against the real producer by `driver-sql`'s
 * `sql-driver-16657-operator-facing-cause-text.test.ts`, which drives a real
 * `SqlDriver.execute()` refusal through this helper — so a driver that rewords
 * its envelope reddens there rather than silently turning every case in this
 * file into a test of its own fixture.
 */

import { describe, expect, it } from 'vitest';

import { operatorFacingErrorText } from './driver-error-classification.js';
import { redactStatementFromMessage } from './driver-fault-redaction.js';

/** `rawStatementFaultError`'s composed message, verbatim (`sql-driver.ts`). */
const RAW_PATH_COMPOSED =
    'The database refused to run a raw statement. The driver could not attribute the failure ' +
    'to any part of the request, so no verdict about the statement is claimed here. The ' +
    "backend's own diagnostic was written to the server log for an operator to read, with " +
    'the statement and its bound values cut.';

/** `backendStatementFaultError`'s composed message — the READ exit, not this one. */
const READ_EXIT_COMPOSED =
    "The database refused to run this query for object 'crm_case'. The driver could not " +
    'attribute the failure to any part of the request, so no verdict about the query is ' +
    "claimed here. The backend's own diagnostic was written to the server log for an " +
    'operator to read, with the compiled statement and its bound values cut.';

/** knex 3.3.0 + better-sqlite3: `<formatted statement> - <engine diagnostic>`. */
const DIALECT_TEXT = 'select "foo" from "sys_metadata" - no such column: foo';

/**
 * [#21418] What the helper answers for text it reached BELOW the raw-path
 * sentence: THE driver-fault cut's own answer, under the rule the driver's raw
 * terminal writes its log line by. Asserted as identity with the cutter rather
 * than as a spelled-out string, so these cases pin "one cutter, one rule" and
 * never the cutter's marker wording.
 */
const cutBelowRawPath = (text: string): string =>
    redactStatementFromMessage(text, { statementSent: true });

interface Declared extends Error {
    code?: string;
    status?: number;
}

/** The envelope the raw terminal composes, cause carrier and all. */
function rawStatementFault(cause: unknown, message = RAW_PATH_COMPOSED): Declared {
    const err = new Error(message) as Declared;
    err.code = 'DATABASE_ERROR';
    err.status = 500;
    Object.defineProperty(err, 'cause', {
        value: cause,
        enumerable: false,
        writable: true,
        configurable: true,
    });
    return err;
}

/** The dialect error knex hands back, `code` and all. */
function dialectError(text = DIALECT_TEXT): Declared {
    const err = new Error(text) as Declared;
    err.code = 'SQLITE_ERROR';
    return err;
}

describe('[#16657] operatorFacingErrorText — the raw-path envelope', () => {
    it("returns the dialect's own words, where a bare read returns the composed sentence", () => {
        const thrown = rawStatementFault(dialectError());

        // BEFORE — what every site stored until this change, and what the
        // envelope still says on its own message channel. Asserted here so the
        // "after" line below is a comparison rather than a claim.
        expect(thrown.message).toBe(RAW_PATH_COMPOSED);
        expect(thrown.message).not.toContain('no such column');

        // AFTER — the record an operator reads names the column, and [#21418]
        // carries the dialect's diagnostic, not the statement that led it.
        expect(operatorFacingErrorText(thrown)).toBe(cutBelowRawPath(DIALECT_TEXT));
        expect(operatorFacingErrorText(thrown)).toContain('no such column: foo');
        expect(operatorFacingErrorText(thrown)).not.toContain('select "foo" from');
    });

    it('walks PAST a nested wrapper that re-composed the same sentence', () => {
        // A transport that re-wraps the envelope (the shape `rawStatementFault`
        // guards against by passing an already-declared error through) must not
        // strand the dialect text one level deeper than the walk looks.
        const thrown = rawStatementFault(rawStatementFault(dialectError()));

        expect(operatorFacingErrorText(thrown)).toBe(cutBelowRawPath(DIALECT_TEXT));
    });

    it('skips a node that carries no message channel at all', () => {
        const silent = rawStatementFault(dialectError());
        Object.defineProperty(silent, 'cause', {
            value: rawStatementFault(dialectError(), ''),
            enumerable: false,
            writable: true,
            configurable: true,
        });
        // The intermediate node says nothing; the one below it does.
        expect(operatorFacingErrorText(silent)).toBe(cutBelowRawPath(DIALECT_TEXT));
    });

    it('reads a cause that is a bare string, not an Error', () => {
        expect(operatorFacingErrorText(rawStatementFault('no such table: sys_metadata'))).toBe(
            'no such table: sys_metadata',
        );
    });
});

describe('[#16657] operatorFacingErrorText — the fallback channel when no cause speaks', () => {
    it('falls back to the envelope itself when nothing is attached', () => {
        // The measured shape when a transport drops `cause`: there is nothing
        // better to say, and saying `undefined` is worse than saying this.
        const thrown = rawStatementFault(undefined);

        expect(operatorFacingErrorText(thrown)).toBe(RAW_PATH_COMPOSED);
        expect(operatorFacingErrorText(thrown)).not.toBe('');
    });

    it('reads a thrown non-Error on its own channel, where `(e as Error).message` read `undefined` or threw', () => {
        // `(e as Error).message` — the expression this helper replaces at five
        // sites — answered these five two different ways, neither of them a
        // record worth storing. It evaluated to `undefined` for the string, the
        // number and `{}`; for `null` and `undefined` it threw a `TypeError`
        // out of the catch, so no record was written at all and the operation
        // aborted. The helper reads a channel instead, so all five store text.
        expect(operatorFacingErrorText('no such column: foo')).toBe('no such column: foo');
        expect(operatorFacingErrorText(42)).toBe('42');
        expect(operatorFacingErrorText(undefined)).toBe('undefined');
        expect(operatorFacingErrorText(null)).toBe('null');
        expect(operatorFacingErrorText({})).toBe('[object Object]');
    });

    it('falls back to the `name` of a declared envelope whose own message is empty', () => {
        const empty = rawStatementFault(undefined, '');
        expect(operatorFacingErrorText(empty)).toBe('Error');
    });
});

describe('[#16657] operatorFacingErrorText — the narrowings, each pinned', () => {
    it('leaves an UNDECLARED throw exactly as its message channel reads', () => {
        const bare = new Error('no strategy can handle query') as Declared;
        Object.defineProperty(bare, 'cause', {
            value: new Error('a cause nobody declared'),
            enumerable: false,
            writable: true,
            configurable: true,
        });

        // Not `DATABASE_ERROR`, so the chain is not consulted — reading it would
        // be the sniffing #16019 removed.
        expect(operatorFacingErrorText(bare)).toBe('no strategy can handle query');
    });

    it('leaves a declared fault under some OTHER code alone', () => {
        const other = new Error('permission denied') as Declared;
        other.code = 'PERMISSION_DENIED';
        other.status = 403;
        Object.defineProperty(other, 'cause', {
            value: dialectError(),
            enumerable: false,
            writable: true,
            configurable: true,
        });

        expect(operatorFacingErrorText(other)).toBe('permission denied');
    });

    it('leaves the READ-exit envelope untouched — same code, different sentence', () => {
        // `backendStatementFaultError` (#8931 / PR #9273) declares the identical
        // `DATABASE_ERROR` / 500 and carries its dialect error the same way.
        // Whether ITS prose should be unwrapped is a separate decision; this
        // helper does not take it, and that is what the sentence match buys.
        const readExit = rawStatementFault(dialectError(), READ_EXIT_COMPOSED);

        expect(readExit.code).toBe('DATABASE_ERROR');
        expect(operatorFacingErrorText(readExit)).toBe(READ_EXIT_COMPOSED);
        expect(operatorFacingErrorText(readExit)).not.toContain('no such column');
    });
});

describe('[#16657] operatorFacingErrorText — the depth bound actually bounds', () => {
    it('terminates on a CYCLIC cause chain and answers the envelope', () => {
        const cyclic = rawStatementFault(undefined);
        Object.defineProperty(cyclic, 'cause', {
            value: cyclic,
            enumerable: false,
            writable: true,
            configurable: true,
        });

        // The assertion that matters is that this line is reached at all.
        expect(operatorFacingErrorText(cyclic)).toBe(RAW_PATH_COMPOSED);
    });

    it('answers the envelope when the dialect text sits BELOW the bound', () => {
        // MAX_CAUSE_DEPTH is 4 in this module; ten composed wrappers is past it.
        let deep: Declared = rawStatementFault(dialectError());
        for (let i = 0; i < 10; i += 1) deep = rawStatementFault(deep);

        expect(operatorFacingErrorText(deep)).toBe(RAW_PATH_COMPOSED);
    });

    it('still reaches text that sits exactly AT the bound', () => {
        // Four composed nodes above the dialect one — the deepest the walk sees.
        let atBound: Declared = rawStatementFault(dialectError());
        for (let i = 0; i < 3; i += 1) atBound = rawStatementFault(atBound);

        expect(operatorFacingErrorText(atBound)).toBe(cutBelowRawPath(DIALECT_TEXT));
    });
});

/**
 * [#21418] The family's fourth position: the helper's answer is cut by
 * construction, through THE driver-fault cut and no copy of it.
 *
 * Every fixture below binds one synthetic sentinel into a raw statement the
 * way knex prints it on SQLite and MySQL, `<statement, values inlined> -
 * <diagnostic>`, or inlines it where a dialect's own diagnostic carries a value
 * (MySQL's duplicate entry, PostgreSQL's invalid input syntax). Each case
 * asserts, in this order: the fixture really carries the sentinel on the
 * `cause` the helper reads (so its absence afterwards is a measurement, not a
 * property of the fixture); the helper's answer carries none of it; and the
 * dialect's diagnostic survives in that answer. The real producer's leg —
 * a real `SqlDriver.execute()` refusal with the sentinel bound — is
 * `driver-sql`'s `sql-driver-16657-operator-facing-cause-text.test.ts`.
 */
describe('[#21418] operatorFacingErrorText — a bound value reaches no carrier through the helper', () => {
    /** Synthetic, and asserted ABSENT from every answer below. */
    const SENTINEL = 'SENTINEL-21418-BOUND-VALUE';

    /** The `cause` message, read before the helper runs: the non-vacuity leg. */
    const causeMessageOf = (thrown: Declared): string =>
        String((thrown as { cause?: { message?: unknown } }).cause?.message ?? '');

    const RAW_PATH_CELLS: Array<[label: string, dialect: string, diagnostic: string]> = [
        [
            'SQLite, a statement opening with a verb the shared leak predicate lists',
            `insert into "crm_account" ("name", "email") values ('Acme', '${SENTINEL}') - ` +
                'UNIQUE constraint failed: crm_account.email',
            'UNIQUE constraint failed: crm_account.email',
        ],
        [
            // The predicate reads neither the verb nor this diagnostic (#21345's
            // class): only the walk's knowledge that a statement was SENT cuts it.
            'SQLite, a statement opening with a verb the predicate does not list',
            `with s as (select '${SENTINEL}' as v) select translate(v) from s - ` +
                'no such function: translate',
            'no such function: translate',
        ],
        [
            'MySQL, the value inlined in the statement AND in its own diagnostic',
            `insert into \`crm_account\` (\`email\`) values ('${SENTINEL}') - ` +
                `Duplicate entry '${SENTINEL}' for key 'crm_account.email'`,
            "for key 'crm_account.email'",
        ],
        [
            'PostgreSQL, the value inlined in its own diagnostic only',
            'insert into "crm_account" ("age") values ($1) - ' +
                `invalid input syntax for type integer: "${SENTINEL}"`,
            'invalid input syntax for type integer',
        ],
    ];

    for (const [label, dialect, diagnostic] of RAW_PATH_CELLS) {
        it(`the raw-path envelope: ${label}`, () => {
            const thrown = rawStatementFault(dialectError(dialect));
            expect(causeMessageOf(thrown)).toContain(SENTINEL);

            const answer = operatorFacingErrorText(thrown);

            expect(answer).not.toContain(SENTINEL);
            expect(answer).toContain(diagnostic);
            // One cutter, one rule: the answer IS the cut the driver's own
            // raw-terminal line writes for this fault.
            expect(answer).toBe(cutBelowRawPath(dialect));
        });
    }

    it('a re-wrapped envelope, and a dialect text at the depth bound, are cut the same way', () => {
        const dialect = RAW_PATH_CELLS[1][1];
        let atBound: Declared = rawStatementFault(dialectError(dialect));
        for (let i = 0; i < 3; i += 1) atBound = rawStatementFault(atBound);

        for (const thrown of [rawStatementFault(rawStatementFault(dialectError(dialect))), atBound]) {
            const answer = operatorFacingErrorText(thrown);
            expect(answer).not.toContain(SENTINEL);
            expect(answer).toContain('no such function: translate');
        }
    });

    it('a `cause` that is a bare string is cut the same way', () => {
        const dialect = RAW_PATH_CELLS[0][1];
        const answer = operatorFacingErrorText(rawStatementFault(dialect));

        expect(answer).not.toContain(SENTINEL);
        expect(answer).toBe(cutBelowRawPath(dialect));
    });

    it('an UNDECLARED driver dump is cut by the shared leak predicate, as the engine\'s own log line is', () => {
        // No raw-path sentence above it, so the walk knows nothing about where
        // the text came from: the predicate's verdict decides, exactly as it
        // does for `redactBoundStatement`'s log line.
        const dump = dialectError(`update "crm_account" set "email" = '${SENTINEL}' - NOT NULL constraint failed: crm_account.name`);
        dump.code = 'SQLITE_CONSTRAINT';
        expect(dump.message).toContain(SENTINEL);

        const answer = operatorFacingErrorText(dump);

        expect(answer).not.toContain(SENTINEL);
        expect(answer).toContain('NOT NULL constraint failed: crm_account.name');
        expect(answer).toBe(redactStatementFromMessage(dump.message));
    });

    it('the thrown value is not touched: its code, status, class and cause reach every other reader as composed', () => {
        class DialectFault extends Error {}
        const cause = new DialectFault(RAW_PATH_CELLS[0][1]);
        const thrown = rawStatementFault(cause);
        const before = { message: thrown.message, stack: thrown.stack, causeStack: cause.stack };

        expect(operatorFacingErrorText(thrown)).not.toContain(SENTINEL);

        // The cut is of the ANSWER. Classifiers downstream (`isMissingTableError`,
        // `classifyIndexFailure`) read the error object, so it must not move.
        expect(thrown.message).toBe(before.message);
        expect(thrown.stack).toBe(before.stack);
        expect(thrown.code).toBe('DATABASE_ERROR');
        expect(thrown.status).toBe(500);
        expect((thrown as { cause?: unknown }).cause).toBe(cause);
        expect(cause).toBeInstanceOf(DialectFault);
        expect(cause.message).toBe(RAW_PATH_CELLS[0][1]);
        expect(cause.stack).toBe(before.causeStack);
    });

    it('CONTROL: text that is no driver dump comes back byte-identical, empty text included', () => {
        // The cut narrows WHAT is written, never whether: the answers the
        // sections above pin for non-dump text are unchanged by it.
        expect(operatorFacingErrorText(rawStatementFault('no such table: sys_metadata'))).toBe(
            'no such table: sys_metadata',
        );
        expect(operatorFacingErrorText(new Error('connection terminated unexpectedly'))).toBe(
            'connection terminated unexpectedly',
        );
        expect(operatorFacingErrorText(rawStatementFault(undefined))).toBe(RAW_PATH_COMPOSED);
        expect(operatorFacingErrorText('')).toBe('');
    });
});
