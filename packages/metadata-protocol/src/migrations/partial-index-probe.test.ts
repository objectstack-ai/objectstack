// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { DatabaseSync } from 'node:sqlite';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    classifyIndexFailure,
    dropIndexQuietly,
    logProblem,
    probeThenReplaceIndex,
    type IndexExec,
} from './partial-index-probe.js';

/**
 * The probe-first order, tested where it lives (#6418).
 *
 * Both migrations in this directory delegate their DDL sequence here, so the
 * ORDER is asserted once — against a real SQLite database — rather than
 * inferred twice from each caller's outcomes.
 */
describe('probe-first partial index replacement (#6418)', () => {
    let db: DatabaseSync;
    let exec: IndexExec;

    const REAL = 'idx_probe_real';
    const PROBE = 'idx_probe_probe';
    const EXISTING_DDL = 'CREATE UNIQUE INDEX `idx_probe_real` on `t` (`k`)';

    const buildSql = (indexName: string): string =>
        `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON t (COALESCE(k, '')) WHERE live = 1`;

    const indexDdl = (name: string): string | undefined =>
        (db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name) as
            | { sql?: string }
            | undefined)?.sql ?? undefined;

    beforeEach(() => {
        db = new DatabaseSync(':memory:');
        db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, k TEXT, live INTEGER);');
        db.exec(EXISTING_DDL);
        exec = async (sql: string) => db.exec(sql);
    });

    afterEach(() => {
        db.close();
    });

    it('builds under the probe name FIRST, and only then claims the real one', async () => {
        const seen: string[] = [];
        const recording: IndexExec = async (sql: string) => {
            seen.push(sql);
            return db.exec(sql);
        };

        const outcome = await probeThenReplaceIndex(recording, {
            indexName: REAL,
            probeIndexName: PROBE,
            buildSql,
        });

        expect(outcome).toEqual({ status: 'created' });
        // The real name is never mentioned until the probe has been built AND
        // dropped — that ordering IS the fix.
        const firstRealMention = seen.findIndex((sql) => sql.includes(REAL));
        const probeCreate = seen.findIndex((sql) => sql.startsWith('CREATE') && sql.includes(PROBE));
        expect(probeCreate).toBeGreaterThanOrEqual(0);
        expect(firstRealMention).toBeGreaterThan(probeCreate);
        expect(seen[firstRealMention]).toContain('DROP INDEX IF EXISTS');
        // No probe residue survives.
        expect(indexDdl(PROBE)).toBeUndefined();
        expect(indexDdl(REAL)!.toLowerCase()).toContain('where live = 1');
    });

    it('a failed probe touches NOTHING — the previous index is byte-for-byte intact', async () => {
        // Two live rows sharing a key: the tighter index cannot be built.
        db.prepare('INSERT INTO t (id, k, live) VALUES (?,?,?)').run('a', null, 1);
        db.prepare('INSERT INTO t (id, k, live) VALUES (?,?,?)').run('b', null, 1);

        const outcome = await probeThenReplaceIndex(exec, {
            indexName: REAL,
            probeIndexName: PROBE,
            buildSql,
        });

        expect(outcome.status).toBe('conflict');
        expect(outcome.failedAt).toBe('probe');
        expect(outcome.detail).toContain('UNIQUE constraint failed');
        expect(indexDdl(REAL)).toEqual(EXISTING_DDL);
        expect(indexDdl(PROBE)).toBeUndefined();
    });

    it('clears probe residue left by a process that died mid-probe', async () => {
        db.exec(`CREATE INDEX ${PROBE} ON t (id)`);

        const outcome = await probeThenReplaceIndex(exec, {
            indexName: REAL,
            probeIndexName: PROBE,
            buildSql,
        });

        expect(outcome.status).toBe('created');
        expect(indexDdl(PROBE)).toBeUndefined();
    });

    it('distinguishes a post-probe rebuild failure, the one branch that CAN leave the name empty', async () => {
        const racing: IndexExec = async (sql: string) => {
            if (sql.includes(REAL) && sql.startsWith('CREATE')) throw new Error('database is locked');
            return db.exec(sql);
        };

        const outcome = await probeThenReplaceIndex(racing, {
            indexName: REAL,
            probeIndexName: PROBE,
            buildSql,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failedAt).toBe('replace');
        expect(indexDdl(REAL)).toBeUndefined();
    });

    it('never throws, whatever the driver does', async () => {
        const hostile: IndexExec = async () => {
            throw new Error('connection reset');
        };

        await expect(
            probeThenReplaceIndex(hostile, { indexName: REAL, probeIndexName: PROBE, buildSql }),
        ).resolves.toEqual({ status: 'failed', detail: 'connection reset', failedAt: 'probe' });
        // …including a driver that rejects with a non-Error.
        const weird: IndexExec = async () => Promise.reject('just a string');
        const outcome = await probeThenReplaceIndex(weird, {
            indexName: REAL,
            probeIndexName: PROBE,
            buildSql,
        });
        expect(outcome.detail).toBe('just a string');
    });

    it('dropIndexQuietly swallows the dialects that have no IF EXISTS form', async () => {
        const mysqlish: IndexExec = vi.fn(async () => {
            throw new Error("You have an error in your SQL syntax near 'IF EXISTS'");
        });
        await expect(dropIndexQuietly(mysqlish, REAL)).resolves.toBeUndefined();
        expect(mysqlish).toHaveBeenCalledWith(`DROP INDEX IF EXISTS ${REAL}`);
    });

    it('classifies data conflicts ahead of dialect refusals', () => {
        // MySQL's duplicate message mentions the key, so the data verdict has to
        // win or a real conflict reads as "no partial index support here".
        expect(classifyIndexFailure("Duplicate entry 'a-b' for key 'idx_probe_real'")).toBe('conflict');
        expect(classifyIndexFailure('UNIQUE constraint failed: t.k')).toBe('conflict');
        expect(classifyIndexFailure('duplicate key value violates unique constraint')).toBe('conflict');
        expect(classifyIndexFailure('near "WHERE": syntax error')).toBe('unsupported');
        expect(classifyIndexFailure('Functional index on a column is not supported')).toBe('unsupported');
        expect(classifyIndexFailure('disk I/O error')).toBe('failed');
    });

    /**
     * #6699 — the substance of the migration onto `@objectstack/types`'
     * `isUniqueViolationError`: the conflict is judged on the channels the
     * driver actually wrote it to, not on prose alone.
     *
     * Every message below is deliberately USELESS — none carries a word any
     * unique-violation vocabulary's message limb looks for — so each case can
     * pass ONLY by reading `code` / `errno`. The second assertion in each case
     * proves that: run the same prose through the classifier on its own and the
     * verdict is `failed`, which is what this module answered for all of them
     * while it carried its own message-only regex.
     */
    it.each([
        ['a SQLite extended result code', { code: 'SQLITE_CONSTRAINT_UNIQUE' }],
        ["mysql2's symbolic name", { code: 'ER_DUP_ENTRY' }],
        ['a bare MySQL errno', { errno: 1062 }],
        ['a Postgres SQLSTATE', { code: '23505' }],
    ])('reads a conflict off %s when the message says nothing (#6699)', (_label, channels) => {
        const error = Object.assign(new Error('insert failed'), channels);
        expect(classifyIndexFailure(error)).toBe('conflict');
        expect(classifyIndexFailure(error.message)).toBe('failed');
    });

    it('follows a pooled wrapper down to the cause (#6699)', () => {
        // Pool and query-builder layers re-throw with the original attached, so
        // the only copy of the condition is one step down.
        const wrapped = Object.assign(new Error('Write failed'), {
            cause: Object.assign(new Error('insert failed'), { code: '23505' }),
        });
        expect(classifyIndexFailure(wrapped)).toBe('conflict');
        expect(classifyIndexFailure(wrapped.message)).toBe('failed');
    });

    it('keeps the data verdict ahead of the dialect verdict on the OBJECT channel too (#6699)', () => {
        // The arm order, re-pinned where widening the input could have broken
        // it: a duplicate reported on `code`, wrapped by a layer whose prose is
        // a dialect refusal. Judged on the message alone this is `unsupported`
        // — "this database cannot build this index" for a real data conflict,
        // exactly the misreport the ordering exists to prevent.
        const both = Object.assign(new Error('near "WHERE": syntax error'), {
            code: 'SQLITE_CONSTRAINT_UNIQUE',
        });
        expect(classifyIndexFailure(both)).toBe('conflict');
        expect(classifyIndexFailure(both.message)).toBe('unsupported');
        // …and on a single string carrying both facts, unchanged since #6418.
        expect(
            classifyIndexFailure('near "WHERE": syntax error — duplicate key value violates unique constraint'),
        ).toBe('conflict');
    });

    it('a dialect refusal carrying its own code is still `unsupported` (#6699)', () => {
        // Widening the input from `string` to the error object must not blind
        // the second arm: MySQL's parse error has `code` and `errno` too, and
        // neither is a unique-violation signal, so the verdict has to come from
        // the message exactly as before.
        const parseError = Object.assign(
            new Error("You have an error in your SQL syntax ... near 'WHERE state'"),
            { code: 'ER_PARSE_ERROR', errno: 1064 },
        );
        expect(classifyIndexFailure(parseError)).toBe('unsupported');
        const io = Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR', errno: 10 });
        expect(classifyIndexFailure(io)).toBe('failed');
    });

    it('the probe hands the ERROR to the classifier, not its message (#6699)', async () => {
        // The threading pin, and the only test here that can see it: every
        // assertion above still passes if `probeThenReplaceIndex` keeps
        // unwrapping `err.message` before classifying. This one cannot — the
        // verdict exists nowhere but on `code`.
        const codeOnly: IndexExec = async (sql: string) => {
            if (sql.startsWith('CREATE')) {
                throw Object.assign(new Error('insert failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
            }
            return db.exec(sql);
        };

        const outcome = await probeThenReplaceIndex(codeOnly, {
            indexName: REAL,
            probeIndexName: PROBE,
            buildSql,
        });

        expect(outcome.status).toBe('conflict');
        expect(outcome.failedAt).toBe('probe');
        // `detail` is unchanged — still the driver's own prose, for the operator.
        expect(outcome.detail).toBe('insert failed');
        // The probe is what failed, so the previous index is untouched.
        expect(indexDdl(REAL)).toEqual(EXISTING_DDL);
        expect(indexDdl(PROBE)).toBeUndefined();
    });

    /* ────────────────────────────────────────────────────────────────────── *
     *  #6848 — the DIALECT arm walks `cause` to the same depth as the first
     * ────────────────────────────────────────────────────────────────────── */

    /** A neutral wrapper: matches NEITHER vocabulary, so it can only carry. */
    const wrap = (cause: unknown): Error => Object.assign(new Error('pool query failed'), { cause });

    /** `leaf` behind `depth` neutral wrappers (`depth: 0` is the leaf itself). */
    const nest = (depth: number, leaf: unknown): unknown =>
        depth === 0 ? leaf : wrap(nest(depth - 1, leaf));

    it('grades a WRAPPED dialect refusal `unsupported`, not `failed` (#6848)', () => {
        // The shape a pooled or query-builder layer produces: useless outer
        // prose, the dialect's actual answer one step down `cause`. Before this
        // the second arm stopped at the outer message and returned `failed` —
        // which costs `overlay-index` its fallback lookup index, because that
        // branch is reached on `unsupported` and nowhere else.
        const wrapped = Object.assign(new Error('Write failed'), {
            cause: new Error('near "WHERE": syntax error'),
        });
        expect(classifyIndexFailure(wrapped)).toBe('unsupported');
        // The control: the outer prose alone is still, correctly, `failed`.
        expect(classifyIndexFailure('Write failed')).toBe('failed');

        // …and the same for the functional-key-parts refusal, one layer deeper
        // and on a plain object rather than an Error.
        expect(classifyIndexFailure({ message: 'Write failed', cause: { cause: { message: 'Functional index on a column is not supported' } } })).toBe(
            'unsupported',
        );
    });

    it('keeps the data verdict ahead of the dialect verdict ACROSS the chain (#6848)', () => {
        // The inversion risk of widening the second arm: both arms now walk, so
        // the ordering has to hold at every depth, not just at the top. Outer
        // prose is a dialect refusal; the real condition is a conflict reported
        // on `code` two levels down. `conflict` must still win.
        const misleading = Object.assign(new Error('near "WHERE": syntax error'), {
            cause: wrap(Object.assign(new Error('insert failed'), { code: '23505' })),
        });
        expect(classifyIndexFailure(misleading)).toBe('conflict');
    });

    it('reads the dialect arm to exactly the depth the conflict arm reads (#6848)', () => {
        // The card's whole point, pinned as a PARITY rather than as a number:
        // whatever depth `isUniqueViolationError` reaches, this module's dialect
        // arm reaches the same one. Expressed this way the assertion survives a
        // deliberate change to the shared bound and still goes red the moment
        // the two arms drift apart again.
        const DEPTHS = [0, 1, 2, 3, 4, 5, 6];
        const dialectReach = DEPTHS.map(
            (d) => classifyIndexFailure(nest(d, new Error('near "WHERE": syntax error'))) === 'unsupported',
        );
        const conflictReach = DEPTHS.map(
            (d) =>
                classifyIndexFailure(nest(d, Object.assign(new Error('insert failed'), { code: '23505' }))) ===
                'conflict',
        );

        expect(dialectReach).toEqual(conflictReach);
        // …and the shared profile is the predicate's `MAX_CAUSE_DEPTH` of 4
        // counted from the thrown value, so the equality above cannot pass by
        // both arms reaching nothing (or everything).
        expect(dialectReach).toEqual([true, true, true, true, true, false, false]);
    });

    it('joins the chain with a newline, so no phrase is synthesised across a wrapper (#6848)', () => {
        // Two of the dialect alternatives are multi-word. Neither message below
        // is a refusal on its own, and joining them with a SPACE would forge
        // `where clause` out of text no layer ever wrote.
        const spliced = Object.assign(new Error('rebuild attempt landed where'), {
            cause: new Error('clause parsing completed'),
        });
        expect(classifyIndexFailure('rebuild attempt landed where')).toBe('failed');
        expect(classifyIndexFailure('clause parsing completed')).toBe('failed');
        expect(classifyIndexFailure(spliced)).toBe('failed');
    });

    it('terminates on a `cause` chain that loops, exactly as the predicate does (#6848)', () => {
        // `isUniqueViolationError` bounds rather than detects cycles — it keeps
        // no visited set — so this walk must not either, and the bound has to be
        // what stops both. A self-referential cause must return a verdict rather
        // than exhaust the stack.
        const loop = new Error('disk I/O error') as Error & { cause?: unknown };
        loop.cause = loop;
        expect(classifyIndexFailure(loop)).toBe('failed');

        // …and a two-node cycle whose refusal is only on the INNER node is still
        // found, because the bound is reached after the answer, not before it.
        const outer = new Error('Write failed') as Error & { cause?: unknown };
        const inner = new Error('near "WHERE": syntax error') as Error & { cause?: unknown };
        outer.cause = inner;
        inner.cause = outer;
        expect(classifyIndexFailure(outer)).toBe('unsupported');
    });

    it('the probe classifies a wrapped refusal, and leaves `detail` the OUTER prose (#6848)', async () => {
        // End-to-end through `probeThenReplaceIndex`: the verdict widens, the
        // operator-facing text does not. `detail` stays the driver's own outer
        // message, which is the contract `probeThenReplaceIndex` already had.
        const wrapping: IndexExec = async (sql: string) => {
            if (sql.startsWith('CREATE')) {
                throw Object.assign(new Error('Write failed'), {
                    cause: new Error('near "WHERE": syntax error'),
                });
            }
            return db.exec(sql);
        };

        const outcome = await probeThenReplaceIndex(wrapping, {
            indexName: REAL,
            probeIndexName: PROBE,
            buildSql,
        });

        expect(outcome.status).toBe('unsupported');
        expect(outcome.failedAt).toBe('probe');
        expect(outcome.detail).toBe('Write failed');
        // The probe is what failed, so the previous index is untouched.
        expect(indexDdl(REAL)).toEqual(EXISTING_DDL);
        expect(indexDdl(PROBE)).toBeUndefined();
    });

    it('logProblem prefers error(), falls back to warn(), and tolerates neither', () => {
        const full = { warn: vi.fn(), error: vi.fn() };
        logProblem(full, 'msg', 'detail');
        expect(full.error).toHaveBeenCalledTimes(1);
        expect(full.error.mock.calls[0]![1]).toBeInstanceOf(Error);
        expect(full.warn).not.toHaveBeenCalled();

        const warnOnly = { warn: vi.fn() };
        logProblem(warnOnly, 'msg', 'detail');
        expect(warnOnly.warn).toHaveBeenCalledWith('msg', { detail: 'detail' });

        expect(() => logProblem(undefined, 'msg', 'detail')).not.toThrow();
        expect(() => logProblem({}, 'msg', 'detail')).not.toThrow();
    });
});
