// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5706] The ADR-0010 §3.3 lock gate must not fail OPEN.
//
// ---------------------------------------------------------------------------
// The defect
// ---------------------------------------------------------------------------
// `getEffectiveLock` is the single source of truth for the lock gate, and both
// of its callers are write-path admission:
//
//   assertLockAllowsWrite   → save / publish / rollback
//   assertLockAllowsDelete  → delete
//
// Its overlay read was wrapped in a bare `catch { /* DB unavailable */ }` that
// fell through to `lock: 'none'`. `'none'` is not a neutral placeholder there —
// it is the verdict "the author declared no protection", and
// `evaluateLockForWrite` / `evaluateLockForDelete` turn it straight into
// "allow". A `sys_metadata` read that FAILED therefore became a write that was
// PERFORMED on an item whose overlay row declared it protected.
//
// Measured on `origin/main` before the fix, with an overlay row carrying
// `_lock` and ONLY the gate's own read rejecting (`connect ECONNREFUSED`):
//
//   saveMetaItem(_lock='no-overlay')   -> RESOLVED { success: true }   (update:sys_metadata ran)
//   deleteMetaItem(_lock='no-delete')  -> RESOLVED { success: true }   (delete:sys_metadata ran)
//
// while the very same rows, read successfully, produce 403 ITEM_LOCKED. The
// audit trail does not save it either: the allowed path writes its ordinary
// `outcome: 'allowed'` row, so nothing afterwards records that the write should
// have been denied. (This test asserts that fact about `outcome` directly, in
// the "the audit trail did not compensate" case — it is the reason the defect
// was invisible.)
//
// ADR-0049 is fail-closed; ADR-0110 D3 is the rule that a miss and an outage
// are different facts. Reading one as the other disarmed a protection gate.
//
// ---------------------------------------------------------------------------
// The window, stated honestly
// ---------------------------------------------------------------------------
// NOT "the metadata store is down" — a fully dead store fails the write too.
// The window is "the READ failed and the write still succeeded": a transient
// error, one timed-out query, a read-replica fault, partial pool exhaustion.
// That is exactly what `engineWithTransientLockReadFault` models: the FIRST
// `sys_metadata` read (the gate's) rejects, every read and write after it
// works. Narrow — and the shape is wrong at any width.
//
// ---------------------------------------------------------------------------
// Reverse verification, direction predicted BEFORE running
// ---------------------------------------------------------------------------
// Ordinary red. Restoring the bare
// `} catch { /* DB unavailable — fall through to 'none'. */ }` turns the
// fail-closed cases red — measured 5 red / 7 green — and every one of the five
// fails in exactly the shape the issue reported, with the resolved value
// printed in the assertion message:
//
//   expected a rejection, but the call resolved with
//     {"success":true,…,"message":"Saved customization overlay (env-wide, …)"}
//     {"success":true,"reset":true,…,"message":"Customization overlay deleted — view/v1 …"}
//
// (#5265 — that first line is the measurement AS TAKEN, kept verbatim rather
// than back-dated. Re-run today it reads `"Saved view 'v1' (env-wide, …)"`:
// this file's registry holds no artifact for `v1`, so the save overlays
// nothing and the receipt no longer claims it does. Neither the direction nor
// the 5/7 split changes — only the noun in the resolved value.)
//
// (#5927 — and now the SECOND line, for the same reason on the reset path.
// These fail-closed cases pass no `registryItems`, so `v1` is artifact-backed
// on neither side; re-run today the delete resolves
// `"Deleted view 'v1' — it no longer exists. …"`. Same treatment: the
// measurement stands as taken, and the 5/7 split is untouched — what these
// assertions read is the REJECTION, never the resolved sentence.)
//
// Predicted 4 (the four in the first describe); the fifth is the last case of
// the artifact describe, which is itself a fail-closed assertion and only lives
// there for narrative reasons. Recorded as measured rather than rounded to the
// prediction.
//
// The seven that stay green under the restored defect are the point of the
// other describes, and they are green for a *reason*, not by vacuum:
//   * artifact-level locks never consult the overlay at all (the read is not
//     reached), so they were never affected — the regression guard proves the
//     fix did not "fix" something that was already right;
//   * an unprovisioned `sys_metadata` still resolves to 'none' and still
//     allows the write, which is first boot and must keep working;
//   * a genuine miss (healthy store, no lock row) still allows the write —
//     without this, "fail closed" could be satisfied by refusing everything.

import { describe, it, expect, vi } from 'vitest';
import { ErrorCode } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** A registry holding only what the test explicitly puts in it. */
function registry(items: Record<string, unknown> = {}) {
    return {
        getObject: () => undefined,
        getItem: (_type: string, name: string) => items[name],
        listItems: () => [],
        applyNavContributions: (x: unknown) => x,
        isPackageDisabled: () => false,
        getObjectOwner: () => undefined,
    };
}

/** An outage: the lock row may well exist and simply was not seen. */
const connectionRefused = () =>
    Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' });

/** The real driver phrasing for "the table has not been provisioned yet". */
const missingTable = () =>
    Object.assign(new Error('SQLITE_ERROR: no such table: sys_metadata'), { code: 'SQLITE_ERROR' });

/**
 * The stored overlay row the gate is supposed to read. `checksum` is what the
 * optimistic-concurrency check compares against, and it must be present:
 * without it the save is refused by a 409 from a LATER layer, which would mask
 * whether the lock gate allowed the write at all.
 */
function lockedOverlayRow(lock: string) {
    return {
        id: 'row-1',
        type: 'view',
        name: 'v1',
        state: 'active',
        organization_id: null,
        package_id: null,
        checksum: 'sha256:stored-head',
        metadata: JSON.stringify({ name: 'v1', label: 'Governed', _lock: lock, _lockReason: 'governed by ops' }),
    };
}

type Harness = {
    engine: any;
    /** Every engine call, in order — the evidence that a write did or did not run. */
    calls: string[];
    /** Rows written to `sys_metadata_audit`. */
    auditRows: any[];
};

/**
 * The failure the issue is about: the FIRST `sys_metadata` read — the lock
 * gate's own — rejects with `error`; everything after it, reads and writes
 * alike, succeeds. `failFirstRead: false` gives the identical world with a
 * healthy gate read, which is the control every fail-closed case is compared
 * against.
 */
function engineWithTransientLockReadFault(opts: {
    lock: string;
    failFirstRead: boolean;
    error?: () => unknown;
    registryItems?: Record<string, unknown>;
    /** Omit the overlay row entirely — a genuine "nothing is locked" miss. */
    noOverlayRow?: boolean;
}): Harness {
    const calls: string[] = [];
    const auditRows: any[] = [];
    const row = lockedOverlayRow(opts.lock);
    const raise = opts.error ?? connectionRefused;
    let reads = 0;

    const engine: any = {
        registry: registry(opts.registryItems ?? {}),
        findOne: vi.fn(async (object: string, query: any) => {
            if (object !== 'sys_metadata') {
                calls.push(`findOne:${object}`);
                return null;
            }
            reads += 1;
            calls.push(`findOne:sys_metadata#${reads}`);
            if (opts.failFirstRead && reads === 1) throw raise();
            if (opts.noOverlayRow) return null;
            if (query?.where?.state === 'draft') return null;
            return row;
        }),
        find: vi.fn(async (object: string) => { calls.push(`find:${object}`); return []; }),
        insert: vi.fn(async (object: string, values: any) => {
            calls.push(`insert:${object}`);
            if (object === 'sys_metadata_audit') auditRows.push(values);
            return { id: 'inserted', ...values };
        }),
        update: vi.fn(async (object: string) => { calls.push(`update:${object}`); return { ...row }; }),
        delete: vi.fn(async (object: string) => { calls.push(`delete:${object}`); return { deleted: 1 }; }),
        count: vi.fn(async () => 0),
        transaction: vi.fn(async (fn: any) => fn(engine)),
        execute: vi.fn(async () => ({})),
        getObjectSchema: vi.fn(async () => undefined),
    };
    return { engine, calls, auditRows };
}

/** A protocol in TENANT scope — control-plane (`environmentId` undefined) skips both gates. */
function protocolFor(h: Harness) {
    return new ObjectStackProtocolImplementation(h.engine, undefined, 'env_1');
}

// [#5599] The body carries a real view key (`type` / `columns`), not identity
// alone. It used to be `{ name, label }`, which the `view` schema accepted only
// because its union had a member that stripped unknown keys and required none —
// the hole #5599 closed. Nothing here needs a contentless body: this file's
// subject is WHICH writes the lock gate admits, not what a view looks like.
const save = (p: ObjectStackProtocolImplementation) =>
    p.saveMetaItem({
        type: 'view',
        name: 'v1',
        // [#7741] carries the object binding the inline arm now requires.
        item: { name: 'v1', label: 'Edited', type: 'grid', columns: ['name'], object: 'task', viewKind: 'list' },
    } as any);

const remove = (p: ObjectStackProtocolImplementation) =>
    p.deleteMetaItem({ type: 'view', name: 'v1' } as any);

/** Capture a rejection without letting a resolve pass silently. */
async function rejection(run: () => Promise<unknown>): Promise<any> {
    let caught: any;
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
        `expected a rejection, but the call resolved with ${JSON.stringify(resolved)}`,
    ).toBe(false);
    return caught;
}

/** Every assertion the outage envelope owes a caller (shared with #5532). */
function expectStoreUnavailable(caught: any) {
    expect(caught?.status).toBe(503);
    expect(caught?.code).toBe('SERVICE_UNAVAILABLE');
    // ADR-0112: the wire code must be in the declared vocabulary, or the
    // envelope fails `ApiErrorSchema.parse` at the boundary that ships it.
    expect(ErrorCode.safeParse(caught?.code).success).toBe(true);
    // The driver's own error rides as `cause` for the operator-side log.
    expect((caught?.cause as any)?.code).toBe('ECONNREFUSED');
}

/** No row was written to `sys_metadata` — the write really did not happen. */
function expectNoOverlayWrite(h: Harness) {
    expect(h.calls).not.toContain('update:sys_metadata');
    expect(h.calls).not.toContain('insert:sys_metadata');
    expect(h.calls).not.toContain('delete:sys_metadata');
}

describe('[#5706] an unreadable lock state refuses the write instead of allowing it', () => {
    it('save is refused with 503 when the gate cannot read the overlay lock', async () => {
        const h = engineWithTransientLockReadFault({ lock: 'no-overlay', failFirstRead: true });

        const caught = await rejection(() => save(protocolFor(h)));

        expectStoreUnavailable(caught);
        // The regression, verbatim: this used to resolve `{ success: true }`.
        expectNoOverlayWrite(h);
        // It really was the GATE's read that failed — it is the first one.
        expect(h.calls[0]).toBe('findOne:sys_metadata#1');
    });

    it('delete is refused with 503 on the same unreadable lock state', async () => {
        const h = engineWithTransientLockReadFault({ lock: 'no-delete', failFirstRead: true });

        const caught = await rejection(() => remove(protocolFor(h)));

        expectStoreUnavailable(caught);
        expectNoOverlayWrite(h);
        expect(h.calls[0]).toBe('findOne:sys_metadata#1');
    });

    it('a `full` lock is protected on both gates by the same read', async () => {
        const saveH = engineWithTransientLockReadFault({ lock: 'full', failFirstRead: true });
        const deleteH = engineWithTransientLockReadFault({ lock: 'full', failFirstRead: true });

        expectStoreUnavailable(await rejection(() => save(protocolFor(saveH))));
        expectStoreUnavailable(await rejection(() => remove(protocolFor(deleteH))));
        expectNoOverlayWrite(saveH);
        expectNoOverlayWrite(deleteH);
    });

    it('the audit trail did not compensate — which is why this was invisible', async () => {
        // Pre-fix, the allowed path wrote its ordinary `outcome: 'allowed'`
        // row, so no `outcome: 'denied'` row ever recorded that this write
        // should have been refused. Post-fix the write never happens, so the
        // honest audit state is NO row at all — the same semantics #5705 gave
        // its 503 path, not a widened audit surface.
        const h = engineWithTransientLockReadFault({ lock: 'no-overlay', failFirstRead: true });

        await rejection(() => save(protocolFor(h)));

        expect(h.auditRows.map((r) => r.outcome)).not.toContain('allowed');
        expect(h.auditRows).toEqual([]);
    });
});

describe('[#5706] the gate still reaches the verdicts it could actually establish', () => {
    it('a readable overlay lock is still a 403 ITEM_LOCKED, not a 503', async () => {
        // The control for every case above: same row, same protocol, healthy
        // read. Without this, "fail closed" could be satisfied by a gate that
        // merely stopped distinguishing anything.
        const h = engineWithTransientLockReadFault({ lock: 'no-overlay', failFirstRead: false });

        const caught = await rejection(() => save(protocolFor(h)));

        expect(caught.status).toBe(403);
        expect(caught.code).toBe('ITEM_LOCKED');
        expect(caught.lock).toBe('no-overlay');
        expect(caught.message).toContain('source=overlay');
        expectNoOverlayWrite(h);
        // The denial IS audited — this is the row the fail-open path lost.
        expect(h.auditRows.map((r) => [r.operation, r.outcome])).toEqual([['save', 'denied']]);
    });

    it('a readable delete lock is still a 403 ITEM_LOCKED', async () => {
        const h = engineWithTransientLockReadFault({ lock: 'no-delete', failFirstRead: false });

        const caught = await rejection(() => remove(protocolFor(h)));

        expect(caught.status).toBe(403);
        expect(caught.code).toBe('ITEM_LOCKED');
        expect(h.auditRows.map((r) => [r.operation, r.outcome])).toEqual([['delete', 'denied']]);
    });

    it('a genuine miss — healthy store, no lock row — still allows the write', async () => {
        // "Fail closed" must not become "refuse everything". Nothing is locked
        // here and the gate established that fact, so the save proceeds.
        const h = engineWithTransientLockReadFault({ lock: 'none', failFirstRead: false, noOverlayRow: true });

        const res: any = await save(protocolFor(h));

        expect(res.success).toBe(true);
        expect(h.calls).toContain('insert:sys_metadata');
    });
});

describe('[#5706] the benign unprovisioned store is still not an outage', () => {
    it('first boot: an unprovisioned sys_metadata still resolves to "unlocked" and saves', async () => {
        // The table does not exist, so there genuinely are no overlay rows and
        // `'none'` IS the truth. A first boot must not 503 — this is the one
        // error class `rethrowUnlessMetadataStoreUnprovisioned` lets through.
        const h = engineWithTransientLockReadFault({
            lock: 'none',
            failFirstRead: true,
            error: missingTable,
            noOverlayRow: true,
        });

        const res: any = await save(protocolFor(h));

        expect(res.success).toBe(true);
        expect(h.calls[0]).toBe('findOne:sys_metadata#1');
    });

    it('first boot: delete is likewise not turned into a 503', async () => {
        const h = engineWithTransientLockReadFault({
            lock: 'none',
            failFirstRead: true,
            error: missingTable,
        });

        const res: any = await remove(protocolFor(h));

        expect(res.success).toBe(true);
    });
});

describe('[#5706] artifact-level locks are unaffected — they never reach the overlay read', () => {
    // The issue records this as a mitigation and it must stay true: a packaged
    // `_lock` is answered from the in-memory registry BEFORE the overlay read,
    // so it was never fail-open and must not now become a 503 either. This is
    // the guard against "fixing" something that was already correct.
    const packagedLock = (lock: string) => ({
        v1: { name: 'v1', _packageId: 'pkg-governance', _lock: lock, _lockReason: 'shipped locked' },
    });

    it('a packaged `full` lock still refuses a save with 403, even mid-outage', async () => {
        const h = engineWithTransientLockReadFault({
            lock: 'none',
            failFirstRead: true,
            registryItems: packagedLock('full'),
        });

        const caught = await rejection(() => save(protocolFor(h)));

        expect(caught.status).toBe(403);
        expect(caught.code).toBe('ITEM_LOCKED');
        expect(caught.message).toContain('source=artifact');
        // The overlay read was never even attempted — artifact wins first.
        expect(h.calls).not.toContain('findOne:sys_metadata#1');
    });

    it('a packaged `no-delete` lock still refuses a delete with 403, even mid-outage', async () => {
        const h = engineWithTransientLockReadFault({
            lock: 'none',
            failFirstRead: true,
            registryItems: packagedLock('no-delete'),
        });

        const caught = await rejection(() => remove(protocolFor(h)));

        expect(caught.status).toBe(403);
        expect(caught.code).toBe('ITEM_LOCKED');
        expect(caught.message).toContain('source=artifact');
        expect(h.calls).not.toContain('findOne:sys_metadata#1');
    });

    it('an artifact-backed item with NO packaged lock still consults the overlay — and fails closed', async () => {
        // Measured, not assumed: the artifact branch short-circuits on ANY
        // non-'none' packaged lock, whichever operation is being judged — it
        // does not ask whether that lock blocks THIS operation. So the two
        // cases above pass because the read is skipped, and this case is what
        // proves the skip is conditional rather than universal: an
        // artifact-backed item whose packaged `_lock` is 'none' does reach the
        // overlay read, where the fix now applies.
        const h = engineWithTransientLockReadFault({
            lock: 'none',
            failFirstRead: true,
            registryItems: { v1: { name: 'v1', _packageId: 'pkg-governance' } },
        });

        const caught = await rejection(() => save(protocolFor(h)));

        expectStoreUnavailable(caught);
        expect(h.calls).toContain('findOne:sys_metadata#1');
    });
});
