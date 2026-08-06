// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5532] A `sys_metadata` read that FAILED is not a metadata item that does
// not exist.
//
// ---------------------------------------------------------------------------
// The defect
// ---------------------------------------------------------------------------
// Every customization-overlay read in `getMetaItems` / `getMetaItem` was
// wrapped in a bare `catch {}` whose comment named the reason it was swallowing
// ("DB not available") and then answered as if the row simply was not there.
// The emptiness travelled the whole read chain unremarked and each consumer
// gave it a different, equally wrong name:
//
//   GET /meta/object/acct            → "Metadata item object/acct not found"
//   GET /meta/object/acct?state=draft→ NO_DRAFT / 404 "no pending draft exists"
//   GET /meta/object                 → `items: []` — "this env declares none"
//
// Measured on `origin/main` before the fix, with an engine whose reads reject
// with `connect ECONNREFUSED 10.0.0.5:5432`:
//
//   RESOLVE getMetaItem(econnrefused)        -> { type, name, ...no item }
//   THROW   getMetaItemCached(econnrefused)  status=undefined code=undefined
//                                            msg=Metadata item object/acct not found
//   THROW   getMetaItem(state=draft, …)      status=404 code=NO_DRAFT
//   RESOLVE getMetaItems(econnrefused)       -> { items: [] }
//
// ADR-0110 D3 is the rule those answers break: a miss and an outage are
// different facts with opposite meanings, and the dispositions they call for
// are opposite too — "create it / fix your link" vs. "the backend is down,
// retry". #5108 fixed exactly this in `DatabaseLoader`'s plural read and #5089
// in `listForIndex`; this is the same rule one layer up, on the protocol's own
// overlay reads, singular and plural.
//
// ---------------------------------------------------------------------------
// The one benign reason, and why the discrimination is by error TYPE
// ---------------------------------------------------------------------------
// `sys_metadata` not provisioned yet: there are then genuinely no overlay rows,
// so falling through to the registry IS the truth and first boot must not
// explode. That is `isMissingTableError` — the same predicate `DatabaseLoader`
// (#5108) and this package's `SysMetadataRepository` (#4867) ask, so a driver
// quirk is taught to the platform once. Everything else is an outage.
//
// ---------------------------------------------------------------------------
// Reverse verification, direction predicted BEFORE running
// ---------------------------------------------------------------------------
// Ordinary red, on both halves, and they fail differently — which is the point:
//
//   * Restore `} catch { /* DB not available */ }` at the four overlay reads →
//     7 red / 5 green, and they go red in exactly the shape the issue reported:
//     the singular and preview reads RESOLVE with no item, the plural reads
//     resolve `{ items: [] }`, the draft read throws 404. (Predicted 6 — the
//     six outage cases; the seventh is the miss-vs-outage comparison, whose
//     OUTAGE half is one of the same six. Recorded rather than rounded off.)
//   * Restore `throw new Error(\`Metadata item …/… not found\`)` → 3 red /
//     9 green: the two "a real miss is a structured 404" cases plus the benign
//     first-boot miss, all on `status`/`code` being `undefined`, while every
//     503 case stays GREEN. That separation is deliberate: it is what proves
//     the 404 is fix C's own contribution and not an artifact of the outage
//     split.
//
// The "benign / working store" describe is the opposite guard — it exists to
// catch the overreach where a fix starts calling first boot, or a plain
// unreferenced item, an outage.

import { describe, it, expect, vi } from 'vitest';
import { ErrorCode } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** A registry with nothing in it — the overlay read is the only source. */
function emptyRegistry(items: Record<string, any> = {}) {
    return {
        getObject: () => undefined,
        getItem: (_type: string, name: string) => items[name],
        listItems: () => [],
        applyNavContributions: (x: any) => x,
        isPackageDisabled: () => false,
        getObjectOwner: () => undefined,
    };
}

/**
 * An engine whose every read REJECTS with `error` — the shape of a metadata
 * store the protocol cannot reach.
 */
function engineThatCannotBeRead(error: () => unknown, registryItems: Record<string, any> = {}) {
    const reject = vi.fn(async () => { throw error(); });
    return {
        registry: emptyRegistry(registryItems),
        find: reject,
        findOne: reject,
    } as any;
}

/** An engine that answers reads normally, from `rows`. */
function engineWithRows(rows: any[] = [], registryItems: Record<string, any> = {}) {
    return {
        registry: emptyRegistry(registryItems),
        find: vi.fn(async () => rows),
        findOne: vi.fn(async () => rows[0] ?? null),
    } as any;
}

/** The real driver phrasings for "the table has not been provisioned yet". */
const missingTable = () =>
    Object.assign(new Error('SQLITE_ERROR: no such table: sys_metadata'), { code: 'SQLITE_ERROR' });

/** An outage: the rows may well exist and simply were not seen. */
const connectionRefused = () =>
    Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' });

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

/** Every assertion the outage envelope owes a caller. */
function expectStoreUnavailable(caught: any, cause: unknown) {
    expect(caught?.status).toBe(503);
    expect(caught?.code).toBe('SERVICE_UNAVAILABLE');
    // ADR-0112: the wire code must be in the declared vocabulary, or the
    // envelope fails `ApiErrorSchema.parse` at the boundary that ships it.
    expect(ErrorCode.safeParse(caught?.code).success).toBe(true);
    // The words a client reads say "unknown", never "does not exist".
    expect(caught.message).toContain('unknown');
    expect(caught.message.toLowerCase()).not.toContain('not found');
    // The driver's own error is not lost — it rides as `cause`, which is what
    // `logWithheldServerFault` prints for the operator (#5437).
    expect(caught.cause).toBe(cause);
}

describe('[#5532] an unreadable sys_metadata is a 503, not "that item does not exist"', () => {
    it('the singular active read no longer answers a miss it never verified', async () => {
        const err = connectionRefused();
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(() => err));

        const caught = await rejection(() => p.getMetaItem({ type: 'object', name: 'acct' } as any));
        expectStoreUnavailable(caught, err);
    });

    it('getMetaItemCached propagates the outage instead of relabelling it "not found"', async () => {
        const err = connectionRefused();
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(() => err));

        const caught = await rejection(() => p.getMetaItemCached({ type: 'object', name: 'acct' } as any));
        expectStoreUnavailable(caught, err);
        // The regression this replaces, verbatim.
        expect(caught.message).not.toContain('Metadata item object/acct not found');
    });

    it('the draft read stops reporting an outage as "there is no pending draft"', async () => {
        const err = connectionRefused();
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(() => err));

        const caught = await rejection(
            () => p.getMetaItem({ type: 'object', name: 'acct', state: 'draft' } as any),
        );
        expectStoreUnavailable(caught, err);
        // NO_DRAFT is a lifecycle fact ("nobody is editing this"). A publish
        // flow reads it as "nothing to publish" and moves on.
        expect(caught.code).not.toBe('NO_DRAFT');
    });

    it('the ?preview=draft overlay stops silently serving the published world', async () => {
        const err = connectionRefused();
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(() => err));

        const caught = await rejection(
            () => p.getMetaItem({ type: 'object', name: 'acct', previewDrafts: true } as any),
        );
        expectStoreUnavailable(caught, err);
    });

    it('the PLURAL read stops answering "this environment declares none of these"', async () => {
        const err = connectionRefused();
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(() => err));

        const caught = await rejection(() => p.getMetaItems({ type: 'object' } as any));
        expectStoreUnavailable(caught, err);
    });

    it('the plural draft-preview overlay is held to the same rule', async () => {
        const err = connectionRefused();
        // The active overlay read must succeed so control actually reaches the
        // draft-preview block: only its own read fails.
        const engine = engineWithRows([]);
        let call = 0;
        engine.find = vi.fn(async (_o: string, opts: any) => {
            call += 1;
            if (opts?.where?.state === 'draft') throw err;
            return [];
        });

        const p = new ObjectStackProtocolImplementation(engine);
        const caught = await rejection(
            () => p.getMetaItems({ type: 'object', previewDrafts: true } as any),
        );
        expectStoreUnavailable(caught, err);
        expect(call).toBeGreaterThan(1); // the active read really did run first
    });
});

describe('[#5532 / fix C] a REAL miss is a structured 404, not an unattributable throw', () => {
    it('getMetaItemCached carries status 404 + the catalog code', async () => {
        const p = new ObjectStackProtocolImplementation(engineWithRows([]));

        const caught = await rejection(() => p.getMetaItemCached({ type: 'object', name: 'ghost' } as any));
        expect(caught.status).toBe(404);
        expect(caught.code).toBe('RESOURCE_NOT_FOUND');
        expect(ErrorCode.safeParse(caught.code).success).toBe(true);
        expect(caught.message).toBe('Metadata item object/ghost not found');
    });

    it('is distinguishable from the outage by code alone — which is the whole point', async () => {
        const missP = new ObjectStackProtocolImplementation(engineWithRows([]));
        const outageP = new ObjectStackProtocolImplementation(
            engineThatCannotBeRead(connectionRefused),
        );

        const miss = await rejection(() => missP.getMetaItemCached({ type: 'object', name: 'ghost' } as any));
        const outage = await rejection(() => outageP.getMetaItemCached({ type: 'object', name: 'ghost' } as any));

        expect([miss.status, miss.code]).toEqual([404, 'RESOURCE_NOT_FOUND']);
        expect([outage.status, outage.code]).toEqual([503, 'SERVICE_UNAVAILABLE']);
    });
});

describe('[#5532] the benign case and the healthy case are untouched', () => {
    it('an unprovisioned sys_metadata still falls through to the registry', async () => {
        // First boot: the table does not exist, so "no overlay row" IS the
        // truth and the code-authored item must still be served.
        const p = new ObjectStackProtocolImplementation(
            engineThatCannotBeRead(missingTable, { acct: { name: 'acct', label: 'Account' } }),
        );

        const res: any = await p.getMetaItem({ type: 'object', name: 'acct' } as any);
        expect(res.item?.name).toBe('acct');
        expect(res.item?.label).toBe('Account');
    });

    it('an unprovisioned sys_metadata + nothing anywhere is a 404 miss, not a 503', async () => {
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(missingTable));

        const caught = await rejection(() => p.getMetaItemCached({ type: 'object', name: 'acct' } as any));
        expect(caught.status).toBe(404);
        expect(caught.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('an unprovisioned sys_metadata still lists the registry items (plural)', async () => {
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(missingTable));

        const res: any = await p.getMetaItems({ type: 'object' } as any);
        expect(res.items).toEqual([]);
    });

    it('a healthy store still serves the overlay row it holds', async () => {
        const p = new ObjectStackProtocolImplementation(
            engineWithRows([
                { type: 'object', name: 'acct', state: 'active', metadata: JSON.stringify({ name: 'acct', label: 'Overlaid' }) },
            ]),
        );

        const res: any = await p.getMetaItem({ type: 'object', name: 'acct' } as any);
        expect(res.item?.label).toBe('Overlaid');
    });
});
