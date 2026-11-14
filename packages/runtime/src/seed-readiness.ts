// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The boot seed's state, as `GET /ready` reports it (#33233).
 *
 * ## The gap this closes
 *
 * `/ready` answered `200 { status: 'ready' }` from the moment the kernel ran,
 * and `AppPlugin`'s inline seed can still be writing then: past its soft budget
 * (`OS_INLINE_SEED_BUDGET_MS`) it continues detached, and a seed deferred to
 * `kernel:bootstrapped` (demo staff, seed files) starts after it. A second
 * process that trusted "ready" acted on half-seeded data. The settle was
 * announced only on the `os serve` / `os dev` IPC channel
 * (`objectstack:seed-settled`), which a script, a test or a cloud health check
 * in another process does not hold.
 *
 * ## What is read: the two records the kernel already keeps
 *
 *  - `seed-settlement` ({@link readSeedSettlement}): how many sources are still
 *    writing. `inFlight > 0` is `pending`.
 *  - `seed-summary`: one outcome per source, recorded when its load finishes.
 *    Once nothing is in flight, the seed is `failed` when any recorded outcome
 *    is not clean, and `settled` otherwise.
 *
 * "Clean" is the verdict the `objectstack:seed-settled` IPC message already
 * calls `ok` (`composeSeedSettledMessage` in `@objectstack/cli`): no rejected
 * record, no reference field dropped from a written row, no install that came
 * up empty. The HTTP reading and the IPC message are the same fact on two
 * channels, so they must not disagree about it.
 *
 * ## Suppressed sources read `settled`
 *
 * A multi-tenant or `skipSeedData` boot suppresses its source on purpose: no
 * boot-time write is coming, ever, so a consumer waiting for one must not wait
 * forever. That is the IPC message's rule too (it keys on `inFlight`, never on
 * `pending`).
 *
 * ## No seed pipeline: no reading
 *
 * When no source was ever declared on the kernel, there is nothing to report
 * and `undefined` is returned: `/ready` then answers exactly the body it did
 * before. Asked at request time, after `kernel:ready`, an absent tracker is a
 * fact (every source is declared in Phase 2 `start()`), not a not-yet.
 */

import { readSeedSettlement } from './seed-settlement.js';
import type { SeedSourceOutcome } from './seed-summary.js';

/** The boot seed's state on `GET /ready`'s 200 body. */
export type SeedReadiness = 'pending' | 'settled' | 'failed';

/** The subset of a kernel this module reads. */
interface SeedReadinessHost {
    getService?: (name: string) => unknown;
}

/**
 * Whether one source's outcome is clean — the per-source half of the
 * `objectstack:seed-settled` message's `ok`.
 */
export function seedOutcomeIsClean(outcome: SeedSourceOutcome): boolean {
    return outcome.rejected === 0 && (outcome.droppedRefs ?? 0) === 0 && !outcome.emptyInstall;
}

/** The recorded per-source outcomes, or an empty list when none was recorded. */
function readSeedOutcomes(kernel: unknown): readonly SeedSourceOutcome[] {
    const host = kernel as SeedReadinessHost | null | undefined;
    try {
        // `getService` THROWS on an unregistered name; a seed that settled
        // without recording an outcome (the basic-insert fallback) leaves none.
        const summary: unknown = host?.getService?.('seed-summary');
        return Array.isArray(summary) ? (summary as SeedSourceOutcome[]) : [];
    } catch {
        return [];
    }
}

/**
 * Read the boot seed's state off the host kernel, or `undefined` when no seed
 * pipeline is registered on it. Re-read per call — never cached, the tally
 * moves while the seed writes.
 */
export function readSeedReadiness(kernel: unknown): SeedReadiness | undefined {
    const snapshot = readSeedSettlement(kernel);
    if (!snapshot || typeof snapshot.inFlight !== 'number') return undefined;
    if (snapshot.inFlight > 0) return 'pending';
    return readSeedOutcomes(kernel).every(seedOutcomeIsClean) ? 'settled' : 'failed';
}
