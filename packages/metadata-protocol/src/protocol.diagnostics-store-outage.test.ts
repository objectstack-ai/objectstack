// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8855] A diagnostics sweep that could not READ the store must not publish
// "0 problems".
//
// ---------------------------------------------------------------------------
// The defect, measured on origin/main @ 8664a2c99 BEFORE the fix
// ---------------------------------------------------------------------------
// `getMetaDiagnostics` wrapped its per-type read in an UNTYPED `catch` that
// `continue`d. The comment named a benign reason ("type not listable in this
// kernel scope") and that reason is real — but the catch took everything else
// with it, including the one error the callee exists to raise: the 503 #5532
// raised out of `getMetaItems` so that an outage would stop looking like
// emptiness.
//
// Prediction was written down BEFORE the run; the run matched it exactly. With
// an engine whose every read rejects, `getMetaDiagnostics({})`:
//
//   [outage: connect ECONNREFUSED 10.0.0.5:5432]  RESOLVED
//     total=0  scannedTypes=26  scannedItems=0  Object.keys(stats).length=0
//   [benign: SQLITE_ERROR: no such table: sys_metadata]  RESOLVED
//     total=0  scannedTypes=26  scannedItems=0  Object.keys(stats).length=26
//     every stat = {"count":0,"locked":0,"packages":[]}
//
// Two user-visible harms out of one `catch`, and the benign run above is what
// makes them legible — it is the SAME payload shape minus the missing `stats`:
//
//   * `stats[t]` is never written, so an unreadable type is ABSENT from the
//     response rather than zero. The Studio directory tile the field's own doc
//     names ("so the Studio directory page can render tile counts") simply
//     loses the type, byte-shaped like an environment that declares none of it.
//   * `total` counts entries that FAILED validation, and a store nobody can
//     read contributes none — so the endpoint whose whole job is reporting
//     problems answered `total: 0` at the exact moment it could read nothing.
//     Green is the failure mode.
//
// `scannedTypes` stayed at the full 26 in both runs: it is computed from the
// INTENT (`targetTypes.length`, fixed before the loop) and never decremented on
// `continue`, so the payload asserted "I scanned 26" having scanned 0.
//
// ---------------------------------------------------------------------------
// What the fix is, and what it deliberately is NOT
// ---------------------------------------------------------------------------
// NOT "delete the catch" — the benign skip is genuine and stays. The catch is
// NARROWED: the 503 the producer already classified is rethrown UNCHANGED,
// everything else still skips the type. No payload field was added; a per-type
// degradation marker would be a public-surface addition and is explicitly not
// this card's to make.
//
// Classification reads the envelope the PRODUCER built rather than re-deriving
// it. Re-running `isMissingTableError` here would re-wrap an already-shaped 503
// in another 503 and displace the driver error riding as `cause` — which is why
// `expect(caught.cause).toBe(err)` below is an identity check, not a shape
// check: it is what proves the envelope was propagated and not rebuilt.
//
// ---------------------------------------------------------------------------
// Reverse verification, direction predicted BEFORE running
// ---------------------------------------------------------------------------
// Ordinary red, and — this is the point — red on the OUTAGE half only. Restore
// the bare `} catch { continue; }` and the three outage cases go red by
// RESOLVING instead of throwing, while every benign / selective / healthy case
// below stays green. A blanket "diagnostics now throws" would have taken the
// benign and selective controls with it; a fix that only looked like it worked
// would leave the outage cases green. The two halves are in one file so a
// future edit that re-widens the catch is a diff nobody can read as harmless.
//
// ---------------------------------------------------------------------------
// [#8924] The SECOND classified verdict: the request-arm 400
// ---------------------------------------------------------------------------
// The same catch swallowed one more producer-classified error: the refusal
// `canonicalizeMetaRequestType` raises inside `getMetaItems` (`status: 400`,
// `code: 'INVALID_REQUEST'`) for an unrecognised spelling of a DECLARED type.
// Only the `request.type` arm can reach it — the full-sweep arm's target set
// comes canonical out of the registry. Measured on a booted kernel before the
// fix: `GET /api/v1/meta/diagnostics?type=fieldes` answered
// `200 {"entries":[],"total":0,"scannedTypes":1,"scannedItems":0,"stats":{}}`
// — "scanned 1 type, no issues" — while the sibling door `/meta/fieldes`
// refused the same spelling with the 400 that names both accepted spellings.
// Ruled 2026-08-20 (option 1): rethrow the 400 the same way the 503 is
// rethrown. The [#8924] describe below pins the refusal, the two spellings
// that must KEEP answering (a recognised plural, a plural-of-nothing), and —
// the positive control — that a genuine listing failure still skips even when
// it wears an unrelated status, so the guard admits exactly the two
// classified verdicts and never widens into a blanket throw.

import { describe, it, expect, vi } from 'vitest';
import { ErrorCode } from '@objectstack/spec/api';
import { DEFAULT_METADATA_TYPE_REGISTRY, getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The set the sweep walks — derived from the same two spec symbols the
 * implementation derives `targetTypes` from, so this pin does not rot into a
 * hardcoded 26 the day the registry grows.
 */
const SWEPT_TYPES: string[] = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => getMetadataTypeSchema(e.type))
    .map((e) => e.type);

/** A registry with nothing in it — the overlay read is the only source. */
function emptyRegistry(overrides: Record<string, unknown> = {}) {
    return {
        getObject: () => undefined,
        getItem: () => undefined,
        listItems: () => [],
        applyNavContributions: (x: any) => x,
        isPackageDisabled: () => false,
        getObjectOwner: () => undefined,
        ...overrides,
    };
}

/** An engine whose every read REJECTS — a metadata store the protocol cannot reach. */
function engineThatCannotBeRead(error: () => unknown) {
    const reject = vi.fn(async () => { throw error(); });
    return { registry: emptyRegistry(), find: reject, findOne: reject } as any;
}

/** The real driver phrasing for "the table has not been provisioned yet". */
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
        `expected a rejection, but the sweep resolved with ${JSON.stringify(resolved)}`,
    ).toBe(false);
    return caught;
}

/** Every assertion the outage envelope owes a caller (the #5532 envelope, unchanged). */
function expectStoreUnavailable(caught: any, cause: unknown) {
    expect(caught?.status).toBe(503);
    expect(caught?.code).toBe('SERVICE_UNAVAILABLE');
    // ADR-0112: the wire code must be in the declared vocabulary, or the
    // envelope fails `ApiErrorSchema.parse` at the boundary that ships it.
    expect(ErrorCode.safeParse(caught?.code).success).toBe(true);
    // The words a client reads say "unknown", never "does not exist".
    expect(caught.message).toContain('unknown');
    // IDENTITY, not shape: the driver error rides as `cause` on the envelope
    // #5532 built. A re-classification here would have re-wrapped that envelope
    // and put the 503 itself in `cause`, hiding the driver line
    // `logWithheldServerFault` prints for the operator (#5437).
    expect(caught.cause).toBe(cause);
}

describe('[#8855] an unreadable metadata store stops being published as "0 problems"', () => {
    it('the whole-corpus sweep propagates the 503 instead of answering total: 0, stats: {}', async () => {
        const err = connectionRefused();
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(() => err));

        const caught = await rejection(() => p.getMetaDiagnostics({}));
        expectStoreUnavailable(caught, err);
    });

    it('the single-type sweep is held to the same rule', async () => {
        const err = connectionRefused();
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(() => err));

        const caught = await rejection(() => p.getMetaDiagnostics({ type: 'object' }));
        expectStoreUnavailable(caught, err);
    });

    it('an outage and a first boot are now distinguishable by the caller — which is the whole point', async () => {
        // ADR-0110 D3, stated as the two answers side by side: the benign case
        // still ANSWERS (200-shaped, every type present at count 0) while the
        // outage THROWS. Before the fix these two produced the same status and
        // differed only by `stats` being empty — a difference no client is
        // documented to read, and one an environment that genuinely declares
        // nothing would produce as well.
        const benign = new ObjectStackProtocolImplementation(engineThatCannotBeRead(missingTable));
        const outage = new ObjectStackProtocolImplementation(engineThatCannotBeRead(connectionRefused));

        const benignResult: any = await benign.getMetaDiagnostics({});
        expect(benignResult.total).toBe(0);
        expect(Object.keys(benignResult.stats)).toHaveLength(SWEPT_TYPES.length);

        const caught = await rejection(() => outage.getMetaDiagnostics({}));
        expect([caught.status, caught.code]).toEqual([503, 'SERVICE_UNAVAILABLE']);
    });
});

describe('[#8855] the discrimination is selective, not a blanket refusal', () => {
    it('an unprovisioned sys_metadata still answers benignly, every type present at count 0', async () => {
        // The control that matters most. `getMetaItems` classifies this by
        // error TYPE (`isMissingTableError`) and returns normally with
        // `items: []`, so it never reaches the diagnostics catch at all — and
        // the sweep must keep publishing a full, honest, all-zero payload.
        // "0 problems" is the RIGHT answer in this cell, and it is exactly the
        // answer a blanket change would have destroyed.
        const p = new ObjectStackProtocolImplementation(engineThatCannotBeRead(missingTable));

        const res: any = await p.getMetaDiagnostics({});
        expect(res.total).toBe(0);
        expect(res.entries).toEqual([]);
        expect(res.scannedItems).toBe(0);
        expect(res.scannedTypes).toBe(SWEPT_TYPES.length);
        expect(Object.keys(res.stats)).toHaveLength(SWEPT_TYPES.length);
        for (const t of SWEPT_TYPES) {
            expect(res.stats[t]).toEqual({ count: 0, locked: 0, packages: [] });
        }
    });

    it('a type that is genuinely not listable in this kernel scope is still skipped', async () => {
        // The benign reason the original comment named, kept alive on purpose:
        // this failure never went through the store-read classification (the
        // registry listing is not one of the guarded reads), carries no 503,
        // and must still cost exactly one type rather than the whole sweep.
        const unlistable = SWEPT_TYPES.find((t) => t !== 'object')!;
        const engine = {
            registry: emptyRegistry({
                listItems: (type: string) => {
                    if (type === unlistable) {
                        throw new Error(`type ${unlistable} is not listable in this kernel scope`);
                    }
                    return [];
                },
            }),
            find: vi.fn(async () => []),
            findOne: vi.fn(async () => null),
        } as any;
        const p = new ObjectStackProtocolImplementation(engine);

        const res: any = await p.getMetaDiagnostics({});
        expect(res.stats[unlistable]).toBeUndefined();
        expect(Object.keys(res.stats)).toHaveLength(SWEPT_TYPES.length - 1);
        expect(res.stats.object).toEqual({ count: 0, locked: 0, packages: [] });
    });

    it('a healthy store still counts the rows it holds', async () => {
        // The positive control on the other side: the sweep is not merely
        // "throws less often", it still does its job.
        const engine = {
            registry: emptyRegistry(),
            find: vi.fn(async (_object: string, opts: any) => (
                opts?.where?.type === 'object' && opts?.where?.state === 'active'
                    ? [{
                        type: 'object',
                        name: 'acct',
                        state: 'active',
                        package_id: 'crm',
                        metadata: JSON.stringify({ name: 'acct', label: 'Account' }),
                    }]
                    : []
            )),
            findOne: vi.fn(async () => null),
        } as any;
        const p = new ObjectStackProtocolImplementation(engine);

        const res: any = await p.getMetaDiagnostics({});
        expect(res.stats.object.count).toBe(1);
        expect(res.stats.object.packages).toEqual(['crm']);
        expect(res.scannedItems).toBe(1);
        expect(res.scannedTypes).toBe(SWEPT_TYPES.length);
    });
});

describe('[#8924] a caller error the producer classified is refused loudly, never published as "0 problems"', () => {
    /** A healthy engine — the only failure in play is the caller's spelling. */
    function healthyEngine() {
        return {
            registry: emptyRegistry(),
            find: vi.fn(async () => []),
            findOne: vi.fn(async () => null),
        } as any;
    }

    it("an unrecognised spelling of a declared type rejects with the producer's 400, not 200-with-empty-stats", async () => {
        const p = new ObjectStackProtocolImplementation(healthyEngine());

        // Before the fix this RESOLVED with
        // `{ entries: [], total: 0, scannedTypes: 1, scannedItems: 0, stats: {} }`
        // — the exact payload objectui's DiagnosticsPage renders as "All clear".
        const caught = await rejection(() => p.getMetaDiagnostics({ type: 'fieldes' }));

        // The ADR-0112 envelope is the contract: code + status, and the code
        // must be in the declared wire vocabulary.
        expect(caught?.status).toBe(400);
        expect(caught?.code).toBe('INVALID_REQUEST');
        expect(ErrorCode.safeParse(caught?.code).success).toBe(true);
        // The refusal TEACHES: it names both accepted spellings at the moment
        // of the mistake. Asserted on top of code+status, never instead.
        expect(caught.message).toContain("'field'");
        expect(caught.message).toContain("'fields'");
    });

    it('a recognised plural still answers — what is refused is the unrecognised spelling, not the plural form', async () => {
        const p = new ObjectStackProtocolImplementation(healthyEngine());

        const res: any = await p.getMetaDiagnostics({ type: 'fields' });
        expect(res.total).toBe(0);
        expect(res.scannedTypes).toBe(1);
        expect(res.stats.fields).toEqual({ count: 0, locked: 0, packages: [] });
    });

    it('a name that is a plural of NOTHING still answers benignly — the second verdict (#8421) lives on the mint door, not here', async () => {
        const p = new ObjectStackProtocolImplementation(healthyEngine());

        // `metaUrlSpellingRefusal('fieldz')` is null: 'fieldz' reaches for no
        // declared type, so the request-boundary refusal deliberately stays
        // silent and the sweep answers an honest count-0 entry for it.
        const res: any = await p.getMetaDiagnostics({ type: 'fieldz' });
        expect(res.total).toBe(0);
        expect(res.scannedTypes).toBe(1);
        expect(res.stats.fieldz).toEqual({ count: 0, locked: 0, packages: [] });
    });

    it('a genuine listing failure wearing an UNRELATED status still skips — the guard admits exactly the two classified verdicts', async () => {
        // The positive control for the fix itself, constructed deliberately
        // because the benign-skip population is empty in kernel scope (six
        // booted scopes, zero skips) — nothing exercises this by accident.
        // A widened guard (`if (status)` / rethrow-everything) turns every
        // benign skip into a sweep failure; this test is what goes red.
        const unlistable = SWEPT_TYPES.find((t) => t !== 'object')!;
        const engine = {
            registry: emptyRegistry({
                listItems: (type: string) => {
                    if (type === unlistable) {
                        throw Object.assign(
                            new Error(`type ${unlistable} is not listable in this kernel scope`),
                            { status: 500 },
                        );
                    }
                    return [];
                },
            }),
            find: vi.fn(async () => []),
            findOne: vi.fn(async () => null),
        } as any;
        const p = new ObjectStackProtocolImplementation(engine);

        const res: any = await p.getMetaDiagnostics({});
        expect(res.stats[unlistable]).toBeUndefined();
        expect(Object.keys(res.stats)).toHaveLength(SWEPT_TYPES.length - 1);
        expect(res.stats.object).toEqual({ count: 0, locked: 0, packages: [] });
    });
});
