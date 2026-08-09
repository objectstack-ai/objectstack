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
