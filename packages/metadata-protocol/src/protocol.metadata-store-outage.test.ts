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
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

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
function engineThatCannotBeRead(
    error: (object: string) => unknown,
    registryItems: Record<string, any> = {},
) {
    // [#13324] The object reaches the factory, so a missing-table fault can be
    // phrased for the table that was actually read. A driver never names one
    // table while failing a read of another, and `isMissingTableError` now
    // tells those two apart — a fixed phrase would make this fixture assert
    // the benign verdict for a fault no driver produces here.
    const reject = vi.fn(async (object: string, query?: EngineFindOneQueryInput) => {
                                       assertEngineFindOnePredicate(object, query); throw error(object); });
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
        findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return rows[0] ?? null; }),
    } as any;
}

/** The real driver phrasings for "the table has not been provisioned yet". */
const missingTable = (object = 'sys_metadata') =>
    Object.assign(new Error(`SQLITE_ERROR: no such table: ${object}`), { code: 'SQLITE_ERROR' });

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

// ---------------------------------------------------------------------------
// [#5707] The same rule on the LAYERED read — kept in this file on purpose
// ---------------------------------------------------------------------------
// `getMetaItemLayered` is a different method and a different read, which is why
// PR #5705 did not reach it (scope = the issue). It is the same DEFECT, so its
// coverage lives next to the four reads above: a future edit that re-widens one
// catch and not the others is then a diff in one file, and the shared
// `expectStoreUnavailable` keeps the envelope from drifting per-method.
//
// What the swallow answered is worse-shaped here than on the singular read. A
// 404 at least says "I have no item for you"; the layered envelope makes three
// POSITIVE claims at once, all of them about what the author declared:
//
//   overlay: null        → "this item has never been customised"
//   overlayScope: null   → "no org and no env scope holds a row"
//   effective === code   → "what runs today is the packaged artifact, verbatim"
//
// and it makes them with HTTP 200, so no client can tell. The Studio diff tab
// exists to answer "what did I change?" — during an outage it answered
// "nothing", which is #5532's error (an availability failure told as an
// authorship fact) landing in the diff view instead of on a 404.
//
// Reverse verification, direction predicted BEFORE running: ordinary red.
// Restoring `} catch { /* DB unavailable — overlay stays null */ }` turns the
// three outage cases below red (they resolve instead of throwing) and leaves
// the three benign/healthy cases green — that separation is what shows the
// change is the outage split and not a blanket "layered now throws".

describe('[#5707] the layered read stops painting an outage as "nothing was customised"', () => {
    /** The registry's artifact baseline — the layer an outage used to promote to `effective`. */
    const codeBaseline = { name: 'acct', label: 'Account (packaged)' };

    it('throws the same 503 envelope instead of resolving a fabricated 3-layer view', async () => {
        const err = connectionRefused();
        const p = new ObjectStackProtocolImplementation(
            engineThatCannotBeRead(() => err, { acct: codeBaseline }),
        );

        const caught = await rejection(
            () => p.getMetaItemLayered({ type: 'object', name: 'acct' } as any),
        );
        expectStoreUnavailable(caught, err);
    });

    it('the two failures that used to render IDENTICALLY are now told apart', async () => {
        // Same registry, same request, same all-reads-fail engine — only the
        // error TYPE differs, and before the fix both produced byte-identical
        // envelopes (`overlay: null`, `overlayScope: null`, `effective = code`,
        // HTTP 200). That indistinguishability IS the defect: one of them means
        // "nothing was ever customised", the other means "I could not look".
        const benign = new ObjectStackProtocolImplementation(
            engineThatCannotBeRead(missingTable, { acct: codeBaseline }),
        );
        const outage = new ObjectStackProtocolImplementation(
            engineThatCannotBeRead(connectionRefused, { acct: codeBaseline }),
        );

        const firstBoot: any = await benign.getMetaItemLayered({ type: 'object', name: 'acct' } as any);
        expect([firstBoot.overlay, firstBoot.overlayScope]).toEqual([null, null]);
        expect(firstBoot.effective).toBe(firstBoot.code);

        const caught = await rejection(
            () => outage.getMetaItemLayered({ type: 'object', name: 'acct' } as any),
        );
        expect([caught.status, caught.code]).toEqual([503, 'SERVICE_UNAVAILABLE']);
    });

    it('a failed ORG-scope read does not silently demote to the env row it never got to', async () => {
        // The org lookup runs first and the env lookup is inside the same
        // `try`, so the swallow hid BOTH: an env-wide overlay row that was
        // perfectly readable was reported as "no overlay" because the org read
        // failed ahead of it.
        const err = connectionRefused();
        const engine = engineWithRows([]);
        engine.findOne = vi.fn(async (_o: string, opts: any) => {
            if (opts?.where?.organization_id === 'org_acme') throw err;
            return { type: 'object', name: 'acct', state: 'active', metadata: JSON.stringify({ name: 'acct', label: 'Env overlay' }) };
        });

        const caught = await rejection(
            () => p_layered(engine, { type: 'object', name: 'acct', organizationId: 'org_acme' }),
        );
        expectStoreUnavailable(caught, err);
    });

    it('an unprovisioned sys_metadata still renders the code layer (benign, unchanged)', async () => {
        // First boot: no overlay row EXISTS, so `overlay: null`,
        // `overlayScope: null` and `effective === code` are the truth — and the
        // diff tab must keep rendering rather than 503 on every fresh install.
        const p = new ObjectStackProtocolImplementation(
            engineThatCannotBeRead(missingTable, { acct: codeBaseline }),
        );

        const res: any = await p.getMetaItemLayered({ type: 'object', name: 'acct' } as any);
        expect(res.code).toMatchObject({ label: 'Account (packaged)' });
        expect(res.overlay).toBeNull();
        expect(res.overlayScope).toBeNull();
        expect(res.effective).toBe(res.code);
    });

    it('an unprovisioned sys_metadata + nothing anywhere is still an all-null envelope, not a 503', async () => {
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(missingTable));

        const res: any = await p.getMetaItemLayered({ type: 'object', name: 'ghost' } as any);
        expect(res.code).toBeNull();
        expect(res.overlay).toBeNull();
        expect(res.effective).toBeNull();
    });

    it('a healthy store still reports the overlay layer and its scope', async () => {
        const engine = engineWithRows([], { acct: codeBaseline });
        engine.findOne = vi.fn(async (_o: string, opts: any) =>
            (opts?.where?.organization_id === null
                ? { type: 'object', name: 'acct', state: 'active', metadata: JSON.stringify({ name: 'acct', label: 'Env overlay' }) }
                : null),
        );

        const res: any = await p_layered(engine, { type: 'object', name: 'acct' });
        expect(res.overlay).toMatchObject({ label: 'Env overlay' });
        expect(res.overlayScope).toBe('env');
        expect(res.effective).toBe(res.overlay);
    });
});

/** `getMetaItemLayered` on a protocol built over `engine` — the call is 3 lines otherwise. */
function p_layered(engine: any, request: Record<string, unknown>): Promise<any> {
    return new ObjectStackProtocolImplementation(engine).getMetaItemLayered(request as any);
}

// ---------------------------------------------------------------------------
// [#5840] The OTHER read in these same two methods — the MetadataService one
// ---------------------------------------------------------------------------
// Everything above is about the `sys_metadata` overlay read, whose failure the
// protocol can see because it arrives as a throw. The second source each of
// these methods consults — the `metadata` SERVICE, i.e. the loader chain
// (filesystem, database, attached repository) — failed silently: a loader that
// throws is warn-logged and skipped inside `MetadataManager`, and its `get()`
// dropped the `degraded` verdict `loadDiagnosed` had already computed. So an
// unreachable metadata database arrived here as the ordinary `undefined` of a
// name nobody declared, and the SAME two methods that now refuse to guess on
// their overlay half went on guessing on this one:
//
//   getMetaItem        → falls through, item stays undefined → 404 "not found"
//   getMetaItemLayered → `code: null` → `lockSource = code ?? overlay ?? {}`
//                        → `editable: true, deletable: true` on an item whose
//                          code layer may declare `_lock: 'full'`
//
// The second is the sharper one, and it is the shape ADR-0110 D3 names
// outright: an availability failure widening an affordance. `getDiagnosed`
// (#5840) is the seam that makes the failure visible at all; these cases pin
// what each method does with it.
//
// Reverse verification, direction predicted BEFORE running: ordinary red, and
// it must be taken on the CONSUMER, not the producer. These doubles feed the
// return contract directly, so reverting `MetadataManager.getDiagnosed` cannot
// turn them red — only deleting the two `if (… degraded)` branches in
// `protocol.ts` can. Two laps therefore prove two different halves, and
// neither substitutes for the other.
//
// Predicted for the consumer lap: 5 red / 3 green across the two describes
// below — every case that expects a 503, and only those, with all three
// narrowness/back-compat cases green (they assert the branch does NOT fire).
// Measured: exactly that, and the 18 #5532/#5707 cases above stayed green,
// which is what shows this is the third read joining the rule rather than a
// blanket "these methods now throw".

/** A services registry holding one `metadata` service — what the protocol probes. */
function servicesWith(metadata: unknown): () => Map<string, any> {
    const registry = new Map<string, any>([['metadata', metadata]]);
    return () => registry;
}

const LOADER_FAILURE = 'database: connect ECONNREFUSED 10.0.0.5:5432';

/**
 * A `metadata` service whose loader chain is DOWN. `get()` answers exactly what
 * it answered before this issue — `undefined`, indistinguishable from a miss —
 * and `getDiagnosed()` reports the verdict that was being computed and thrown
 * away all along.
 */
const metadataServiceInOutage = () => ({
    get: vi.fn(async () => undefined),
    getDiagnosed: vi.fn(async () => ({ data: undefined, degraded: true, errors: [LOADER_FAILURE] })),
});

/** A `metadata` service that answered, and simply does not hold the item. */
const metadataServiceWithMiss = () => ({
    get: vi.fn(async () => undefined),
    getDiagnosed: vi.fn(async () => ({ data: undefined, degraded: false, errors: [] })),
});

/** A `metadata` service that holds `body`. */
const metadataServiceHolding = (body: unknown) => ({
    get: vi.fn(async () => body),
    getDiagnosed: vi.fn(async () => ({ data: body, degraded: false, errors: [] })),
});

/** A service that predates #5840: `get` only, no way to report the difference. */
const legacyMetadataService = (body?: unknown) => ({ get: vi.fn(async () => body) });

/** The outage envelope, for a cause built from loader messages rather than a driver error. */
function expectLoaderOutage(caught: any) {
    expect(caught?.status).toBe(503);
    expect(caught?.code).toBe('SERVICE_UNAVAILABLE');
    expect(ErrorCode.safeParse(caught?.code).success).toBe(true);
    expect(caught.message).toContain('unknown');
    expect(caught.message.toLowerCase()).not.toContain('not found');
    // The failing loaders' own words reach the operator on `cause`, which is
    // what `logWithheldServerFault` prints (#5437) — the protocol never sees a
    // driver error here, because `MetadataManager` already absorbed it.
    expect(String((caught.cause as Error)?.message)).toContain(LOADER_FAILURE);
}

/** A protocol whose overlay store is healthy and empty — only the SERVICE half varies. */
function protocolWithService(metadata: unknown, registryItems: Record<string, any> = {}) {
    return new ObjectStackProtocolImplementation(
        engineWithRows([], registryItems),
        servicesWith(metadata),
    );
}

describe('[#5840] a MetadataService outage stops arriving as "nobody declared this"', () => {
    it('the singular read throws 503 instead of falling through to a 404', async () => {
        const p = protocolWithService(metadataServiceInOutage());

        const caught = await rejection(() => p.getMetaItem({ type: 'object', name: 'acct' } as any));
        expectLoaderOutage(caught);
    });

    it('getMetaItemCached stops relabelling that outage "Metadata item object/acct not found"', async () => {
        const p = protocolWithService(metadataServiceInOutage());

        const caught = await rejection(() => p.getMetaItemCached({ type: 'object', name: 'acct' } as any));
        expectLoaderOutage(caught);
        // The comment above that 404 claims "reaching here now means a real
        // miss". This is the half that used to make it untrue.
        expect(caught.message).not.toContain('Metadata item object/acct not found');
    });

    it('a miss and an outage are told apart by code alone — the whole point', async () => {
        const missP = protocolWithService(metadataServiceWithMiss());
        const outageP = protocolWithService(metadataServiceInOutage());

        const miss = await rejection(() => missP.getMetaItemCached({ type: 'object', name: 'ghost' } as any));
        const outage = await rejection(() => outageP.getMetaItemCached({ type: 'object', name: 'ghost' } as any));

        expect([miss.status, miss.code]).toEqual([404, 'RESOURCE_NOT_FOUND']);
        expect([outage.status, outage.code]).toEqual([503, 'SERVICE_UNAVAILABLE']);
    });

    it('the layered read refuses to publish a `code: null` it never verified', async () => {
        const p = protocolWithService(metadataServiceInOutage());

        const caught = await rejection(
            () => p.getMetaItemLayered({ type: 'object', name: 'acct' } as any),
        );
        expectLoaderOutage(caught);
    });

    it('and that is what stops an outage from unlocking a locked artifact', async () => {
        // The concrete widening. `lockSource = code ?? overlay ?? {}`, so a
        // code layer that never arrived resolves the protection envelope from
        // `{}` — `editable: true, deletable: true` on an item the packager
        // locked. Left column: what the truth looks like. Right column: what
        // the outage used to render, and now cannot.
        const locked = { name: 'acct', label: 'Account', _lock: 'full' };

        const healthy: any = await protocolWithService(
            metadataServiceHolding(locked),
        ).getMetaItemLayered({ type: 'object', name: 'acct' } as any);
        expect(healthy.lock).toBe('full');
        expect([healthy.editable, healthy.deletable]).toEqual([false, false]);

        const caught = await rejection(
            () => protocolWithService(metadataServiceInOutage())
                .getMetaItemLayered({ type: 'object', name: 'acct' } as any),
        );
        expectLoaderOutage(caught);
        // Never the silently-permissive envelope.
        expect(caught.editable).toBeUndefined();
    });
});

describe('[#5840] the narrowness is the design — three things it deliberately does not do', () => {
    it('a registry hit still answers, degraded service or not', async () => {
        // A registry item IS a real declaration, so the answer contains no
        // unfounded claim and is served exactly as before. The 503 fires only
        // where the alternative would have been "this does not exist".
        const p = protocolWithService(metadataServiceInOutage(), {
            acct: { name: 'acct', label: 'Account (packaged)' },
        });

        const res: any = await p.getMetaItem({ type: 'object', name: 'acct' } as any);
        expect(res.item?.label).toBe('Account (packaged)');

        const layered: any = await p.getMetaItemLayered({ type: 'object', name: 'acct' } as any);
        expect(layered.code).toMatchObject({ label: 'Account (packaged)' });
    });

    it('a clean MISS still renders the all-null layered envelope, not a 503', async () => {
        const p = protocolWithService(metadataServiceWithMiss());

        const res: any = await p.getMetaItemLayered({ type: 'object', name: 'ghost' } as any);
        expect(res.code).toBeNull();
        expect(res.overlay).toBeNull();
        expect(res.effective).toBeNull();
    });

    it('a service that predates `getDiagnosed` behaves exactly as it did', async () => {
        // It cannot report the distinction, so it is read as "not degraded" —
        // precisely what it could express before, unchanged. The alternative
        // (treating an un-probeable service as suspect) would 503 every host
        // whose `metadata` slot is a shim.
        const holding = protocolWithService(legacyMetadataService({ name: 'acct', label: 'From shim' }));
        const res: any = await holding.getMetaItem({ type: 'object', name: 'acct' } as any);
        expect(res.item?.label).toBe('From shim');

        const empty = protocolWithService(legacyMetadataService(undefined));
        const caught = await rejection(() => empty.getMetaItemCached({ type: 'object', name: 'ghost' } as any));
        expect([caught.status, caught.code]).toEqual([404, 'RESOURCE_NOT_FOUND']);
    });
});

// ---------------------------------------------------------------------------
// [#5980] The SAME rule on the ADR-0067 commit timeline — `listCommits`
// ---------------------------------------------------------------------------
// A fourth read in this same file, and the one whose invented emptiness points
// at a WRITE. `listCommits` reads `sys_metadata_commit` and its `catch` answered
// `[]` for every failure, with no log and no error-type discrimination — its own
// JSDoc said so ("Returns [] if the commit store is unavailable"), which is how
// a defect gets read as a design decision by everyone who arrives after it.
//
// Why it lives in this file rather than beside the commit tests: it is the same
// DEFECT and the same prescription (`rethrowUnlessMetadataStoreUnprovisioned`)
// as the #5532 / #5707 / #5840 reads above, so `expectStoreUnavailable` holds
// the envelope identical across all four seams and a future edit that re-widens
// one catch and not the others is a diff in one file.
//
// What the emptiness costs, and why this seam is worse than a 404. The timeline
// is `revertCommit`'s SELECTION surface:
//
//   GET /packages/:id/commits  → `{ commits: [] }` — "nothing to roll back",
//                                 rendered as an empty history in the Studio at
//                                 the exact moment an operator is trying to roll
//                                 something back;
//   rollbackToPackageCommit    → filters that same `[]`, reverts nothing, and
//                                 returns `success: true` — an operation that
//                                 reports having done the job it never started.
//
// The second is the sharp one and it is asserted below: every other read in this
// file mis-answers a QUESTION, this one mis-reports a WRITE as complete.
//
// Reverse verification, direction predicted BEFORE running: ordinary red, on
// the outage half only. Restoring `} catch { return []; }` turns the 4 outage
// cases below red (they resolve instead of throwing) and leaves the 3
// benign/healthy cases green — that separation is what shows the change is the
// outage split and not a blanket "listCommits now throws". The baseline entry
// `packages/metadata-protocol/src/protocol.ts::listCommits` is removed in the
// same PR, and its gate is shrink-only, so a lap with the limb restored and the
// entry already removed must ALSO fail `check-durability-degradation-log-level`
// — the ledger and the code are pinned to each other in both directions.

/** One `sys_metadata_commit` row, in the driver's snake_case wire shape. */
function commitRow(id: string, createdAt: string, operation = 'apply') {
    return {
        id,
        package_id: 'pkg_crm',
        operation,
        message: `commit ${id}`,
        actor: 'alice',
        item_count: 1,
        items: JSON.stringify([{ type: 'object', name: 'acct', existedBefore: true, prevVersion: 3 }]),
        created_at: createdAt,
    };
}

describe('[#5980] an unreadable commit store is a 503, not "this package has no history"', () => {
    it('the timeline read stops inventing an empty history it never verified', async () => {
        const err = connectionRefused();
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(() => err));

        const caught = await rejection(() => p.listCommits({ packageId: 'pkg_crm' }));
        expectStoreUnavailable(caught, err);
    });

    it('a timeout is an outage too — the discrimination is by TYPE, not by phrasing', async () => {
        // The guard's conservative direction: an error it does not recognise is
        // NOT benign. A driver phrasing nobody enumerated must cost one
        // retryable 503, never a silent "no history".
        const err = Object.assign(new Error('Query read timeout after 30000ms'), { code: 'ETIMEDOUT' });
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(() => err));

        const caught = await rejection(() => p.listCommits({ packageId: 'pkg_crm' }));
        expectStoreUnavailable(caught, err);
    });

    it('a permission failure is an outage, not an empty package', async () => {
        const err = Object.assign(new Error('permission denied for table sys_metadata_commit'), {
            code: '42501',
        });
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(() => err));

        const caught = await rejection(() => p.listCommits({ packageId: 'pkg_crm' }));
        expectStoreUnavailable(caught, err);
    });

    it('rollbackToPackageCommit stops reporting `success: true` for a rollback it never performed', async () => {
        // The consequence that points at a write. The target commit is found
        // (that read is a separate `findOne` and it succeeds), then the TIMELINE
        // read fails — and the filter over `[]` selected nothing to revert, so
        // the method reported a clean success for having done nothing. An
        // operator reads that as "the rollback went through".
        const err = connectionRefused();
        const engine = engineWithRows([]);
        engine.findOne = vi.fn(async () => commitRow('cmt_target', '2026-08-01T00:00:00.000Z'));
        engine.find = vi.fn(async () => { throw err; });

        const p = new ObjectStackProtocolImplementation(engine);
        const caught = await rejection(
            () => p.rollbackToPackageCommit({ commitId: 'cmt_target' }),
        );
        expectStoreUnavailable(caught, err);
        // The regression this replaces, verbatim: never a success envelope.
        expect(caught.success).toBeUndefined();
        expect(caught.revertedCommits).toBeUndefined();
    });
});

describe('[#5980] the benign case and the healthy timeline are untouched', () => {
    it('an unprovisioned sys_metadata_commit still reads as an empty history', async () => {
        // First boot, before migrations: there genuinely are no commits, so `[]`
        // IS the truth and the packages screen must render rather than 503.
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(missingTable));

        await expect(p.listCommits({ packageId: 'pkg_crm' })).resolves.toEqual([]);
    });

    it('a healthy store with no commits for this package is still `[]`', async () => {
        const p = new ObjectStackProtocolImplementation(engineWithRows([]));

        await expect(p.listCommits({ packageId: 'pkg_crm' })).resolves.toEqual([]);
    });

    it('a healthy store still maps the rows and still orders them newest-first', async () => {
        // The regression half: the mapping and the sort are the behaviour every
        // consumer depends on, and neither is touched by the catch change. Rows
        // are handed over oldest-first on purpose — the sort, not the driver, is
        // what makes the timeline newest-first.
        const p = new ObjectStackProtocolImplementation(
            engineWithRows([
                commitRow('cmt_old', '2026-08-01T00:00:00.000Z'),
                commitRow('cmt_new', '2026-08-03T00:00:00.000Z'),
                commitRow('cmt_mid', '2026-08-02T00:00:00.000Z', 'revert'),
            ]),
        );

        const commits = await p.listCommits({ packageId: 'pkg_crm' });
        expect(commits.map((c) => c.id)).toEqual(['cmt_new', 'cmt_mid', 'cmt_old']);
        expect(commits[1]!.operation).toBe('revert');
        expect(commits[0]).toMatchObject({
            id: 'cmt_new',
            operation: 'apply',
            message: 'commit cmt_new',
            actor: 'alice',
            itemCount: 1,
            createdAt: '2026-08-03T00:00:00.000Z',
        });
        // `items` arrives as a JSON string from the driver and is parsed here.
        expect(commits[0]!.items).toEqual([
            { type: 'object', name: 'acct', existedBefore: true, prevVersion: 3 },
        ]);
    });
});
