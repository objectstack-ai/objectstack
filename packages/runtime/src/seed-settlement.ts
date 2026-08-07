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
}

/** The registered service object: the read-only contract plus its bookkeeping. */
interface SeedSettlementTracker extends ISeedSettlementService {
    __declare(): SeedSourceHandle;
}

/** A no-op handle for hosts whose context cannot carry the service at all. */
const INERT_HANDLE: SeedSourceHandle = { settle: () => {}, suppress: () => {} };

function createTracker(): SeedSettlementTracker {
    let inFlight = 0;
    const suppressed: SeedSuppressionReason[] = [];

    return {
        snapshot(): SeedSettlementSnapshot {
            return {
                pending: inFlight + suppressed.length,
                inFlight,
                // Copy: a consumer must not be able to edit the tally it reads.
                suppressed: [...suppressed],
            };
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
            };
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
