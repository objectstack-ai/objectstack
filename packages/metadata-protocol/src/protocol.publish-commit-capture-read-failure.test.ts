// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8896] `publishPackageDrafts` must not FABRICATE a revert-plan entry when
 * the pre-publish capture read fails.
 *
 * Before promoting anything, the publish captures each artifact's pre-publish
 * state so the turn can be recorded as one revertible ADR-0067 commit:
 * `existedBefore: false` → the commit CREATED it, so revert = soft-remove;
 * `true` → it edited an existing artifact, so revert = restoreVersion.
 *
 * That capture sat behind a bare `catch` which pushed
 * `{ existedBefore: false, prevVersion: null }` — the literal opposite of the
 * healthy branch's `existedBefore: !!activeRow` for any artifact that DID
 * exist. So a read that failed was answered with a value, and the value chosen
 * was the destructive one: reverting that commit DELETES an artifact whose
 * previous version was supposed to be restored.
 *
 * ## The comment/code contradiction the card asks about, decided
 *
 * The comment five lines above read "Best-effort: a capture failure just omits
 * that item from the revert plan, never blocks the publish." Both halves were
 * wrong, in different directions, and the fix answers both:
 *
 *   - the CODE never omitted — it fabricated (see above);
 *   - and OMITTING would not have been correct either: an item missing from the
 *     plan is simply not reverted, so the revert silently leaves the newly
 *     published version live while reporting the turn undone.
 *
 * Both are the same defect underneath — a revert plan derived from a read that
 * did not happen — so neither the comment nor the code was the survivor. The
 * capture is discriminated by error TYPE instead, and the comment now describes
 * that.
 *
 * ## Why refusing the publish is the safe direction here
 *
 * The capture pass runs BEFORE Phase 1's transaction, so a throw leaves nothing
 * written: the draft stays a draft, no active row appears, no commit is
 * recorded. Refusing to publish beats publishing with a revert plan that would
 * delete an artifact on the way back.
 *
 * Every expectation below is written against LITERALS — the exact injected
 * error object, its literal message and code, the literal `existedBefore` /
 * `prevVersion` values read out of the stored commit row, literal row states.
 * The failure cases are paired with positive controls in the same file: a
 * capture that RUNS over a first publish (`existedBefore: false` is then the
 * TRUTH) and over a second publish (`existedBefore: true, prevVersion: 2`) —
 * the value the fabricated entry destroyed — plus proof, in the benign case,
 * that the injected throw actually fired.
 *
 * The reproduction is built on the post-#8986 tree: seam 4 now sits downstream
 * of that card's pre-flight gates, so the fixture publishes through them (no
 * declared package namespace → the ADR-0028 prefix gate is grandfathered) and
 * the capture loop is reached the way a real publish reaches it.
 */

import { describe, it, expect } from 'vitest';
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

interface CommitItem {
    type: string;
    name: string;
    existedBefore: boolean;
    prevVersion: number | null;
}

/** ADR-0048 overlay key — `(type, name, org, state, package)`. */
const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

/**
 * The overlay reads this fixture serves use flat equality plus `$or`, so those
 * are the two shapes implemented — and every OTHER combinator is refused
 * loudly rather than read as a field name (#8494). A double that silently
 * answers a combinator it does not implement is wrong in the direction no
 * assertion can see: `row['$and']` is `undefined`, so the clause "does not
 * match" for a reason that has nothing to do with the data.
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
 * Stub engine + a ONE-SHOT injector on the pre-publish capture read.
 *
 * The capture is `findOne('sys_metadata', { where: { …, state: 'active' } })`
 * and it is the FIRST such read a publish makes. The injector is one-shot so
 * only the capture fails: the promote path's own reads run normally, which is
 * what keeps the assertions about "nothing was written" attributable to this
 * seam and not to a generally broken engine.
 */
function makeStubEngine() {
    const rows = new Map<string, Row>();
    const sideTables: Record<string, Array<Record<string, unknown>>> = {};
    const activeReads: Array<Record<string, unknown>> = [];
    let nextId = 0;
    let captureFailure: unknown = null;
    let captureFailureFired = false;

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
            if (table === 'sys_metadata' && opts?.where?.state === 'active') {
                activeReads.push(opts.where);
                if (captureFailure !== null) {
                    const err = captureFailure;
                    captureFailure = null;
                    captureFailureFired = true;
                    throw err;
                }
            }
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
        activeReads,
        armCaptureFailure: (error: unknown) => { captureFailure = error; captureFailureFired = false; },
        captureFailureFired: () => captureFailureFired,
    };
}

/** [#8308] Authored OWD — the publish gate refuses an OWD-less custom object. */
const objectBody = (name: string, label: string) => ({
    name,
    label,
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
});

/** The revert plan as it was actually STORED, parsed from the commit row. */
const storedCommitItems = (sideTables: Record<string, Array<Record<string, unknown>>>): CommitItem[][] =>
    (sideTables['sys_metadata_commit'] ?? []).map((c) => JSON.parse(String(c.items)) as CommitItem[]);

const rowsInState = (rows: Map<string, Row>, state: string) =>
    Array.from(rows.values()).filter((r) => r.state === state);

/** The real driver phrasings, verbatim. */
const connectionDropped = () =>
    Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' });

async function rejection(run: () => Promise<unknown>): Promise<Record<string, unknown> & { message?: string }> {
    let caught: unknown;
    let resolved: unknown;
    let didResolve = false;
    try {
        resolved = await run();
        didResolve = true;
    } catch (e) {
        caught = e;
    }
    expect(
        didResolve,
        `expected a rejection, but the publish resolved with ${JSON.stringify(resolved)}`,
    ).toBe(false);
    return caught as Record<string, unknown> & { message?: string };
}

describe('[#8896] publishPackageDrafts — a failed pre-publish capture must not invent a revert plan', () => {
    // ── POSITIVE CONTROLS — the capture RUNS, so both of its real answers are
    //    observable here. Without these, the refusal below could pass on a
    //    harness that no longer records a commit at all.

    it('control: a capture that RUNS over a NEW artifact records existedBefore=false truthfully', async () => {
        const stub = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);

        await protocol.saveMetaItem({
            type: 'object', name: 'solo_ticket', item: objectBody('solo_ticket', 'v1'),
            packageId: 'app.demo', mode: 'draft',
        } as never);
        const res = await protocol.publishPackageDrafts({ packageId: 'app.demo' });

        expect(res.publishedCount).toBe(1);
        expect(storedCommitItems(stub.sideTables)).toEqual([
            [{ type: 'object', name: 'solo_ticket', existedBefore: false, prevVersion: null }],
        ]);
    });

    it('control: a capture that RUNS over an EXISTING artifact records existedBefore=true and its prevVersion', async () => {
        const stub = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);

        await protocol.saveMetaItem({
            type: 'object', name: 'solo_ticket', item: objectBody('solo_ticket', 'v1'),
            packageId: 'app.demo', mode: 'draft',
        } as never);
        await protocol.publishPackageDrafts({ packageId: 'app.demo' });
        await protocol.saveMetaItem({
            type: 'object', name: 'solo_ticket', item: objectBody('solo_ticket', 'v2'),
            packageId: 'app.demo', mode: 'draft',
        } as never);
        await protocol.publishPackageDrafts({ packageId: 'app.demo' });

        // THIS is the value the fabricated entry destroyed: the second commit
        // must revert by RESTORING version 2, not by soft-removing the object.
        expect(storedCommitItems(stub.sideTables)[1]).toEqual([
            { type: 'object', name: 'solo_ticket', existedBefore: true, prevVersion: 2 },
        ]);
    });

    // ── THE FIX — a capture that could not run must surface, not invent.

    it('a capture read that FAILS refuses the publish and writes nothing', async () => {
        const stub = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);

        await protocol.saveMetaItem({
            type: 'object', name: 'solo_ticket', item: objectBody('solo_ticket', 'v1'),
            packageId: 'app.demo', mode: 'draft',
        } as never);

        const injected = connectionDropped();
        stub.armCaptureFailure(injected);

        const caught = await rejection(() => protocol.publishPackageDrafts({ packageId: 'app.demo' }));

        // The caller receives the READ's own failure, envelope intact — no new
        // error code and no new response field.
        expect(caught).toBe(injected);
        expect(caught.message).toBe('connection terminated unexpectedly');
        expect(caught.code).toBe('ECONNRESET');
        // Proof the capture really ran and really threw.
        expect(stub.captureFailureFired()).toBe(true);

        // The capture pass runs BEFORE Phase 1's transaction, so a refusal
        // leaves the world untouched: the draft is still a draft, no active row
        // appeared, and no commit was recorded.
        expect(rowsInState(stub.rows, 'draft').map((r) => r.name)).toEqual(['solo_ticket']);
        expect(rowsInState(stub.rows, 'active')).toEqual([]);
        expect(storedCommitItems(stub.sideTables)).toEqual([]);
        // Pre-fix this published successfully and stored
        // `existedBefore: false` — a revert plan that soft-REMOVES an artifact
        // whose previous version was never read.
    });

    it('a missing COLUMN on a provisioned sys_metadata stays loud (the superstring case)', async () => {
        const stub = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);

        await protocol.saveMetaItem({
            type: 'object', name: 'solo_ticket', item: objectBody('solo_ticket', 'v1'),
            packageId: 'app.demo', mode: 'draft',
        } as never);

        const injected = Object.assign(
            new Error('column "version" of relation "sys_metadata" does not exist'),
            { code: '42703' },
        );
        stub.armCaptureFailure(injected);

        const caught = await rejection(() => protocol.publishPackageDrafts({ packageId: 'app.demo' }));

        expect(caught).toBe(injected);
        expect(caught.message).toBe('column "version" of relation "sys_metadata" does not exist');
        expect(storedCommitItems(stub.sideTables)).toEqual([]);
    });

    // ── THE ONE BENIGN CASE — with `sys_metadata` unprovisioned there is
    //    genuinely no active row for anything, so `existedBefore: false` IS the
    //    artifact's pre-publish state and the push is kept byte-for-byte.

    it('an UNPROVISIONED sys_metadata is truthful emptiness: the publish proceeds with existedBefore=false', async () => {
        const stub = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);

        await protocol.saveMetaItem({
            type: 'object', name: 'solo_ticket', item: objectBody('solo_ticket', 'v1'),
            packageId: 'app.demo', mode: 'draft',
        } as never);
        stub.armCaptureFailure(
            Object.assign(new Error('SQLITE_ERROR: no such table: sys_metadata'), { code: 'SQLITE_ERROR' }),
        );

        const res = await protocol.publishPackageDrafts({ packageId: 'app.demo' });

        expect(res.success).toBe(true);
        expect(res.publishedCount).toBe(1);
        expect(storedCommitItems(stub.sideTables)).toEqual([
            [{ type: 'object', name: 'solo_ticket', existedBefore: false, prevVersion: null }],
        ]);
        // Proof the benign branch was actually EXERCISED — the capture ran and
        // threw. Without this, the passing publish above would be consistent
        // with a harness in which the injector never fired at all.
        expect(stub.captureFailureFired()).toBe(true);
    });

    it('an UNPROVISIONED sys_metadata in the postgres phrasing (42P01) is benign too', async () => {
        const stub = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);

        await protocol.saveMetaItem({
            type: 'object', name: 'solo_ticket', item: objectBody('solo_ticket', 'v1'),
            packageId: 'app.demo', mode: 'draft',
        } as never);
        stub.armCaptureFailure(
            Object.assign(new Error('relation "sys_metadata" does not exist'), { code: '42P01' }),
        );

        const res = await protocol.publishPackageDrafts({ packageId: 'app.demo' });

        expect(res.publishedCount).toBe(1);
        expect(stub.captureFailureFired()).toBe(true);
    });
});
