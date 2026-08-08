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
