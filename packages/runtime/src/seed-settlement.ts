// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Producer side of the `seed-settlement` contract (#4795).
 *
 * The contract, and why the consumer may not just look at `seed-datasets`
 * instead, is documented once in
 * `@objectstack/spec/contracts/seed-settlement.ts`. This module is the
 * bookkeeping behind it: every seeding host declares its source before it
 * decides what to do with it, and settles that source at the exact moment its
 * boot-time write is done — the same moment it emits `app:seeded`.
 *
 * Registration follows the register-once-then-mutate discipline
 * {@link ./seed-datasets.ts} spells out: `registerService` THROWS on a
 * duplicate name, and a second config app (or a marketplace install) must
 * extend the tally rather than clobber it or lose itself in a `catch`. So the
 * tracker object is registered by the first source and read back by every
 * later one.
 *
 * **Which rows a seed wrote travels the same way (#23354).** The loader reports
 * the ids every dataset landed on (`SeedLoadResult.landedIds`); a source
 * publishes them through its handle BEFORE it settles, and the per-organization
 * replayer records its own through {@link recordOrganizationReplay}. The
 * seed-ownership claims read them back through `seededRecordIds`, so they hand
 * over the seed's rows and nothing else (ADR-0138 D1) without a second copy of
 * the loader's key and reference rules.
 *
 * **A source that is never settled is not a leak — it is the answer.** A
 * multi-tenant or `skipSeedData` boot suppresses its source on purpose and the
 * tally stays pending for the life of the process, which is what tells the
 * ADR-0104 attestation to stand down rather than certify rows nobody wrote.
 * The same holds accidentally: a host that throws between declaring and
 * settling leaves the deployment warn-first, which is the recoverable
 * direction (`os migrate … --apply` closes it on real evidence) and strictly
 * better than certifying over a seed whose fate is unknown.
 */

import type {
    ISeedSettlementService,
    SeedSettlementSnapshot,
    SeedSuppressionReason,
} from '@objectstack/spec/contracts';
import { SEED_SETTLEMENT_SERVICE } from '@objectstack/spec/contracts';

/**
 * What one seed load reports about the rows it landed on: its per-dataset
 * results, of which only the object and `landedIds` are read here. Typed this
 * narrowly so a host hands the loader's `results` array straight through.
 */
export type SeedLandingReport = readonly { readonly object: string; readonly landedIds?: readonly string[] }[];

/** The subset of a kernel / plugin context this module pokes at. */
interface SeedSettlementHost {
    kernel?: { getService?: (n: string) => unknown; registerService?: (n: string, v: unknown) => unknown };
    getService?: (n: string) => unknown;
    registerService?: (n: string, v: unknown) => unknown;
}

/**
 * Handle a seeding host holds over its own declared source. Both methods are
 * idempotent and terminal: the first call decides the source's fate and every
 * later one is a no-op, so a double-settle (the in-budget path racing a
 * background continuation) cannot drive the tally negative.
 */
export interface SeedSourceHandle {
    /** This source's boot-time write is done — the rows it will write are in. */
    settle(): void;
    /** This source will not run at boot; nothing it describes gets written. */
    suppress(reason: SeedSuppressionReason): void;
    /**
     * Publish the rows this source's load landed on — call it BEFORE
     * {@link settle}, so a consumer running inside `app:seeded` already reads
     * them. Additive: a source that loads in several passes publishes each.
     */
    publishLanded(report: SeedLandingReport): void;
}

/** The registered service object: the read-only contract plus its bookkeeping. */
interface SeedSettlementTracker extends ISeedSettlementService {
    __declare(): SeedSourceHandle;
    __recordOrganizationReplay(organizationId: string, report: SeedLandingReport): void;
}

/** A no-op handle for hosts whose context cannot carry the service at all. */
const INERT_HANDLE: SeedSourceHandle = { settle: () => {}, suppress: () => {}, publishLanded: () => {} };

/** Fold one load's report into an object → ids index. */
function addLanded(into: Map<string, Set<string>>, report: SeedLandingReport): void {
    for (const result of report) {
        if (!result?.object || !Array.isArray(result.landedIds) || result.landedIds.length === 0) continue;
        let ids = into.get(result.object);
        if (!ids) {
            ids = new Set();
            into.set(result.object, ids);
        }
        for (const id of result.landedIds) if (typeof id === 'string' && id.length > 0) ids.add(id);
    }
}

function createTracker(): SeedSettlementTracker {
    let inFlight = 0;
    const suppressed: SeedSuppressionReason[] = [];
    // The rows every boot-time source of this process landed on. Bounded by
    // the seed itself: a boot loads its bundle once, and a source that loads in
    // passes adds the same rows again.
    const bootLanded = new Map<string, Set<string>>();
    // The rows of the MOST RECENT per-organization replay, and only that one.
    // An organization is replayed once, when it is created, so a process that
    // creates thousands would otherwise hold every replay's rows for its whole
    // life; the reader that needs one (the default organization's owner bind)
    // asks in the same call that created the organization.
    let lastReplay: { organizationId: string; landed: Map<string, Set<string>> } | undefined;

    return {
        snapshot(): SeedSettlementSnapshot {
            return {
                pending: inFlight + suppressed.length,
                inFlight,
                // Copy: a consumer must not be able to edit the tally it reads.
                suppressed: [...suppressed],
            };
        },
        seededRecordIds(object: string, organizationId?: string): readonly string[] {
            const index = organizationId === undefined
                ? bootLanded
                : lastReplay?.organizationId === organizationId ? lastReplay.landed : undefined;
            const ids = index?.get(object);
            // Copy, for the same reason as `suppressed` above.
            return ids ? [...ids] : [];
        },
        __declare(): SeedSourceHandle {
            inFlight += 1;
            let closed = false;
            return {
                settle() {
                    if (closed) return;
                    closed = true;
                    inFlight -= 1;
                },
                suppress(reason: SeedSuppressionReason) {
                    if (closed) return;
                    closed = true;
                    inFlight -= 1;
                    suppressed.push(reason);
                },
                publishLanded(report: SeedLandingReport) {
                    addLanded(bootLanded, report);
                },
            };
        },
        __recordOrganizationReplay(organizationId: string, report: SeedLandingReport): void {
            const landed = new Map<string, Set<string>>();
            addLanded(landed, report);
            lastReplay = { organizationId, landed };
        },
    };
}

function readTracker(ctx: unknown): SeedSettlementTracker | undefined {
    const c = ctx as SeedSettlementHost | null | undefined;
    const looksLikeTracker = (v: unknown): v is SeedSettlementTracker =>
        !!v && typeof (v as SeedSettlementTracker).__declare === 'function';
    if (typeof c?.getService === 'function') {
        try { const v = c.getService(SEED_SETTLEMENT_SERVICE); if (looksLikeTracker(v)) return v; } catch { /* unregistered */ }
    }
    if (typeof c?.kernel?.getService === 'function') {
        try { const v = c.kernel.getService(SEED_SETTLEMENT_SERVICE); if (looksLikeTracker(v)) return v; } catch { /* unregistered */ }
    }
    return undefined;
}

/**
 * Declare one seed source on this kernel and get the handle that closes it.
 *
 * Call this BEFORE deciding whether the source runs inline, replays per org, or
 * is suppressed — the whole point is that the source is counted from the moment
 * it is known to exist, so a consumer reading at `kernel:ready` can never catch
 * the pipeline in a gap where a real source is invisible.
 *
 * Best-effort like the rest of the seed wiring: a context that cannot register
 * services gets an inert handle and the consumer simply finds no service, which
 * reads as "no seed pipeline" — the pre-#4795 behaviour, never a boot failure.
 */
export function declareSeedSource(ctx: unknown): SeedSourceHandle {
    const c = ctx as SeedSettlementHost | null | undefined;
    const existing = readTracker(ctx);
    if (existing) return existing.__declare();

    const tracker = createTracker();
    try {
        if (typeof c?.kernel?.registerService === 'function') c.kernel.registerService(SEED_SETTLEMENT_SERVICE, tracker);
        else if (typeof c?.registerService === 'function') c.registerService(SEED_SETTLEMENT_SERVICE, tracker);
        else return INERT_HANDLE;
    } catch {
        // Lost a check→register race with a concurrent source: use the tracker
        // that won rather than a private one nobody can read.
        const winner = readTracker(ctx);
        return winner ? winner.__declare() : INERT_HANDLE;
    }
    return tracker.__declare();
}

/**
 * Read the live tally, for hosts that want it without declaring a source.
 * Returns `undefined` when no seed pipeline has registered on this kernel.
 */
export function readSeedSettlement(ctx: unknown): SeedSettlementSnapshot | undefined {
    return readTracker(ctx)?.snapshot();
}

/**
 * Record the rows one per-organization replay landed on, replacing the previous
 * replay's — `seededRecordIds(object, organizationId)` answers for the most
 * recent replay only (see the contract for why that bound is the design).
 *
 * Best-effort like the rest of the seed wiring: on a kernel with no tracker
 * there is no reader either, so nothing is lost by doing nothing.
 */
export function recordOrganizationReplay(
    ctx: unknown,
    organizationId: string,
    report: SeedLandingReport,
): void {
    if (!organizationId) return;
    readTracker(ctx)?.__recordOrganizationReplay(organizationId, report);
}
