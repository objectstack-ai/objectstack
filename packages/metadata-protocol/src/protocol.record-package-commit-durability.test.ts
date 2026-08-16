// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9066] A `sys_metadata_commit` write that FAILS must not be silent.
 *
 * `recordPackageCommit` is the ADR-0067 commit writer `publishPackageDrafts`
 * calls with the revert plan it captured a few lines earlier. Its `catch` used
 * to be bare — `return null`, for every reason, with nothing logged:
 *
 *     } catch {
 *         // Commit store unavailable (or insert raced) — the publish itself
 *         // already succeeded; grouping is a best-effort overlay on top.
 *         return null;
 *     }
 *
 * The comment's premise was true and its conclusion was not. The row is not a
 * grouping label: it is the ONLY record of the turn's revert plan
 * (`existedBefore` / `prevVersion` per artifact) that `revertCommit` and
 * `rollbackToPackageCommit` can act on. When it does not land, the artifacts
 * are live, the response says `success: true` with `commitId` merely ABSENT,
 * and the turn can never be reverted — the AGENTS.md durability-degradation
 * shape exactly: the system keeps looking normal while something it claims to
 * persist did not land. And a commit store that is failing stays failing, so
 * every later publish lost its plan the same silent way.
 *
 * ## What this file pins, and what it deliberately does NOT
 *
 * ONLY the silence changes. The publish must still succeed and the `catch`
 * must still answer `null` — unwinding live artifacts over a missing history
 * row would be strictly worse than losing the row, and telling the CALLER that
 * the turn is unrevertible is a response-field question the #8896 ruling
 * forbids for this family. Both halves are asserted below, not assumed: every
 * failure case checks `success`, `publishedCount`, the active row, AND the
 * absence of `commitId`.
 *
 * Classification is by error TYPE through the shared `isMissingTableError`
 * predicate (`@objectstack/metadata/errors`), the same vocabulary the read
 * seams in this file ask (#5532 / #5980 / #8896):
 *
 *   - unprovisioned commit store → `info`, ONCE per protocol instance (a
 *     configuration fact, identical on every publish, fixed in one place);
 *   - everything else → `error`, per turn, naming the consequence and the fix.
 *
 * Every expectation is written against LITERALS — the injected error object
 * itself, its literal message, the literal sentences an operator reads — and
 * each failure case is paired with a positive control, so "no error was
 * logged" can never pass on a harness that never published at all.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// cannot accept a call ObjectQL refuses. From `@objectstack/metadata-core`, not
// `@objectstack/objectql` — objectql depends on THIS package, so that import
// would close a dependency cycle turbo rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    version?: number;
}

/** ADR-0048 overlay key — `(type, name, org, state, package)`. */
const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

/**
 * The overlay reads this fixture serves use flat equality plus `$or`, so those
 * are the two shapes implemented — every OTHER combinator is refused loudly
 * rather than read as a field name (#8494). A double that silently answers a
 * combinator it does not implement is wrong in the direction no assertion can
 * see: `row['$and']` is `undefined`, so the clause "does not match" for a
 * reason that has nothing to do with the data.
 */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            if (!(v as Array<Record<string, unknown>>).some((c) => matchesWhere(row, c))) return false;
            continue;
        }
        if (k.startsWith('$')) {
            throw new Error(`fake engine: unsupported combinator ${k}`);
        }
        // `undefined` = "dimension not constrained"; `null` = "must be NULL".
        if (v === undefined) continue;
        if (row[k] !== v) return false;
    }
    return true;
}

/**
 * Stub engine with an injector on the `sys_metadata_commit` INSERT only.
 *
 * The injection is STICKY, not one-shot, because the defect's second half is
 * that a failing commit store stays failing: two publishes in a row have to be
 * observable to tell "said once" apart from "said per turn". Every other table
 * — `sys_metadata` above all — keeps working, so a publish that still reports
 * success is attributable to this seam and not to a generally broken engine.
 */
function makeStubEngine() {
    const rows = new Map<string, Row>();
    const sideTables: Record<string, Array<Record<string, unknown>>> = {};
    let nextId = 0;
    let commitFailure: unknown = null;
    let commitAttempts = 0;

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            return r ? { key: k, row: r } : null;
        }
        for (const [k, r] of rows) if (matchesWhere(r as unknown as Record<string, unknown>, w)) return { key: k, row: r };
        return null;
    };

    const engine = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            if (table !== 'sys_metadata') {
                return (sideTables[table] ?? []).find((r) => matchesWhere(r, opts.where)) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown> }) {
            const where = opts?.where ?? {};
            if (table !== 'sys_metadata') {
                return (sideTables[table] ?? []).filter((r) => matchesWhere(r, where));
            }
            return Array.from(rows.values())
                .filter((r) => matchesWhere(r as unknown as Record<string, unknown>, where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_commit') {
                commitAttempts += 1;
                if (commitFailure !== null) throw commitFailure;
            }
            nextId += 1;
            if (table !== 'sys_metadata') {
                (sideTables[table] ??= []).push({ id: `x_${nextId}`, ...data });
                return { id: `x_${nextId}` };
            }
            const row = { id: `r_${nextId}`, ...data } as unknown as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...data } as unknown as Row;
            rows.delete(found.key);
            rows.set(keyOf(merged as unknown as Record<string, unknown>), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: undefined, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            // No declared package namespace → the ADR-0028 prefix pre-flight is
            // grandfathered, exactly as for a legacy package.
            getPackage: () => undefined,
        },
    };

    return {
        engine,
        rows,
        sideTables,
        failCommitWith: (error: unknown) => { commitFailure = error; },
        commitAttempts: () => commitAttempts,
    };
}

/** [#8308] Authored OWD — the publish gate refuses an OWD-less custom object. */
const objectBody = (name: string, label: string) => ({
    name,
    label,
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
});

/** The real driver phrasings, verbatim. */
const connectionDropped = () =>
    Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' });
const unprovisionedSqlite = () =>
    Object.assign(new Error('SQLITE_ERROR: no such table: sys_metadata_commit'), { code: 'SQLITE_ERROR' });
const unprovisionedPostgres = () =>
    Object.assign(new Error('relation "sys_metadata_commit" does not exist'), { code: '42P01' });

type Protocol = InstanceType<typeof ObjectStackProtocolImplementation>;

/** Draft one object into `app.demo` and publish the package. */
async function publishOne(protocol: Protocol, name: string, label: string) {
    await (protocol as never as {
        saveMetaItem: (r: unknown) => Promise<unknown>;
    }).saveMetaItem({
        type: 'object', name, item: objectBody(name, label),
        packageId: 'app.demo', mode: 'draft',
    });
    return protocol.publishPackageDrafts({ packageId: 'app.demo' }) as Promise<{
        success: boolean;
        publishedCount: number;
        commitId?: string;
    }>;
}

const commitRows = (sideTables: Record<string, Array<Record<string, unknown>>>) =>
    sideTables['sys_metadata_commit'] ?? [];

const activeNames = (rows: Map<string, Row>) =>
    Array.from(rows.values()).filter((r) => r.state === 'active').map((r) => r.name).sort();

function spyConsole() {
    return {
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
        info: vi.spyOn(console, 'info').mockImplementation(() => {}),
        warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('[#9066] recordPackageCommit — a failed sys_metadata_commit write is no longer silent', () => {
    // ── POSITIVE CONTROL — nothing injected. Without it, every "no error was
    //    logged" below would also pass on a fixture that never wrote a commit.

    it('control: a healthy publish records the commit row, returns its id, and logs nothing', async () => {
        const stub = makeStubEngine();
        const spy = spyConsole();
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);

        const res = await publishOne(protocol, 'solo_ticket', 'v1');

        expect(res.success).toBe(true);
        expect(res.publishedCount).toBe(1);
        expect(typeof res.commitId).toBe('string');
        expect(commitRows(stub.sideTables)).toHaveLength(1);
        expect(commitRows(stub.sideTables)[0].package_id).toBe('app.demo');
        expect(spy.error).not.toHaveBeenCalled();
        expect(spy.info).not.toHaveBeenCalled();
    });

    // ── THE FIX — a commit write that failed for a non-benign reason is LOUD.

    it('a non-benign write failure logs at error, naming the lost revert plan and the fix', async () => {
        const stub = makeStubEngine();
        const spy = spyConsole();
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);
        stub.failCommitWith(connectionDropped());

        const res = await publishOne(protocol, 'solo_ticket', 'v1');

        // Proof the write was really attempted and really threw — otherwise the
        // assertions below are about a publish that never reached the seam.
        expect(stub.commitAttempts()).toBe(1);
        expect(commitRows(stub.sideTables)).toEqual([]);

        // ⛔ The publish keeps its outcome. Only the silence changed.
        expect(res.success).toBe(true);
        expect(res.publishedCount).toBe(1);
        expect(activeNames(stub.rows)).toEqual(['solo_ticket']);
        // `commitId` is ABSENT, not null and not invented — the observable the
        // #8896 ruling says the caller already has. No new response field.
        expect('commitId' in res).toBe(false);

        expect(spy.error).toHaveBeenCalledTimes(1);
        const line = String(spy.error.mock.calls[0][0]);
        // The driver's own reason, the turn's identity, and the AGENTS.md pair:
        // the CONSEQUENCE, then the FIX.
        expect(line).toContain('connection terminated unexpectedly');
        expect(line).toContain("package 'app.demo'");
        expect(line).toContain('(apply, 1 item(s))');
        expect(line).toContain('The publish itself SUCCEEDED and reports success');
        expect(line).toContain('can never be reverted');
        expect(line).toContain('Fix: restore write access to sys_metadata_commit');
        // Not the unprovisioned branch.
        expect(spy.info).not.toHaveBeenCalled();
    });

    it('a second failed turn logs again — the count of unrevertible turns is not collapsed', async () => {
        const stub = makeStubEngine();
        const spy = spyConsole();
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);
        stub.failCommitWith(connectionDropped());

        await publishOne(protocol, 'solo_ticket', 'v1');
        await publishOne(protocol, 'second_ticket', 'v1');

        expect(stub.commitAttempts()).toBe(2);
        expect(activeNames(stub.rows)).toEqual(['second_ticket', 'solo_ticket']);
        // Each line is a DIFFERENT turn whose plan was lost, so each is said.
        expect(spy.error).toHaveBeenCalledTimes(2);
        expect(String(spy.error.mock.calls[1][0])).toContain("package 'app.demo'");
    });

    it('a missing COLUMN on a provisioned commit store stays loud (the superstring case)', async () => {
        const stub = makeStubEngine();
        const spy = spyConsole();
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);
        stub.failCommitWith(
            Object.assign(
                new Error('column "items" of relation "sys_metadata_commit" does not exist'),
                { code: '42703' },
            ),
        );

        const res = await publishOne(protocol, 'solo_ticket', 'v1');

        expect(res.publishedCount).toBe(1);
        expect(spy.error).toHaveBeenCalledTimes(1);
        expect(String(spy.error.mock.calls[0][0]))
            .toContain('column "items" of relation "sys_metadata_commit" does not exist');
        expect(spy.info).not.toHaveBeenCalled();
    });

    // ── THE BENIGN CASE — an unprovisioned commit store is a deployment state,
    //    not a store that broke: informational, and said once.

    it('an UNPROVISIONED commit store is informational, not an error (sqlite phrasing)', async () => {
        const stub = makeStubEngine();
        const spy = spyConsole();
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);
        stub.failCommitWith(unprovisionedSqlite());

        const res = await publishOne(protocol, 'solo_ticket', 'v1');

        expect(stub.commitAttempts()).toBe(1);
        expect(res.success).toBe(true);
        expect(res.publishedCount).toBe(1);
        expect('commitId' in res).toBe(false);
        expect(spy.error).not.toHaveBeenCalled();
        expect(spy.info).toHaveBeenCalledTimes(1);
        const line = String(spy.info.mock.calls[0][0]);
        expect(line).toContain('sys_metadata_commit is not provisioned');
        expect(line).toContain('no turn can be reverted');
        expect(line).toContain('Fix: provision the commit store');
    });

    it('an UNPROVISIONED commit store in the postgres phrasing (42P01) is benign too', async () => {
        const stub = makeStubEngine();
        const spy = spyConsole();
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);
        stub.failCommitWith(unprovisionedPostgres());

        const res = await publishOne(protocol, 'solo_ticket', 'v1');

        expect(res.publishedCount).toBe(1);
        expect(stub.commitAttempts()).toBe(1);
        expect(spy.error).not.toHaveBeenCalled();
        expect(spy.info).toHaveBeenCalledTimes(1);
    });

    it('the unprovisioned note is said ONCE per instance, and again for a fresh one', async () => {
        const stub = makeStubEngine();
        const spy = spyConsole();
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);
        stub.failCommitWith(unprovisionedSqlite());

        await publishOne(protocol, 'solo_ticket', 'v1');
        await publishOne(protocol, 'second_ticket', 'v1');

        // Both turns really reached the seam; only the first one spoke.
        expect(stub.commitAttempts()).toBe(2);
        expect(activeNames(stub.rows)).toEqual(['second_ticket', 'solo_ticket']);
        expect(spy.info).toHaveBeenCalledTimes(1);

        // A DIFFERENT protocol is a different composition — it has never said
        // it, so it says it. (This is why the flag is per-instance and not a
        // module-level `let`.)
        const other = new ObjectStackProtocolImplementation(stub.engine as never);
        await publishOne(other, 'third_ticket', 'v1');
        expect(spy.info).toHaveBeenCalledTimes(2);
        expect(spy.error).not.toHaveBeenCalled();
    });
});
