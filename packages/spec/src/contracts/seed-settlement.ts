// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Seed-settlement signal — "has this boot's own seed data finished landing?"
 *
 * ## Why this is a contract and not a service-name sniff (#4795)
 *
 * ADR-0104's fresh-datastore attestation (`platform-objects`) certifies "this
 * store was created empty, so no legacy value can exist here". The inference is
 * about CONTENT, and it expires the moment the boot writes. #4769 moved the
 * attestation off `kernel:ready` onto `app:seeded` for exactly that reason,
 * keeping `kernel:ready` as the backstop for kernels that never seed.
 *
 * That backstop still fires too early in one case. `AppPlugin`'s inline seed
 * races a soft budget (`OS_INLINE_SEED_BUDGET_MS`, default 8s); over budget it
 * logs a warning and finishes **in the background**, so `app:seeded` lands after
 * `kernel:ready`. The backstop then certifies a store whose seed is still
 * writing, flips the gates to strict mid-run, and the tail of the SAME seed run
 * meets a contract its head never saw — one boot, two contracts. Measured on a
 * showcase cold boot with a 1ms budget: attestation at `+0.470s`, seed settled
 * at `+3.617s` — a 3.147s window.
 *
 * The consumer therefore has to ask "is a seed still in flight?" — and the
 * obvious way to ask, poking at the runtime's internal `seed-datasets` service
 * and guessing from an array's length, is precisely the coupling this contract
 * exists to avoid: an array being registered says a seed source EXISTS, never
 * whether it has SETTLED, and the two differ for the whole window that is the
 * bug. So the producer publishes the settlement fact itself, under a name both
 * sides import from the spec.
 *
 * ## Reading it correctly
 *
 * The question is asked at `kernel:ready` or later — never during `init()`.
 * Every seed source is declared in the producer's `start()` (kernel Phase 2),
 * which completes before `kernel:ready` (Phase 3), so an ABSENT service at that
 * point is a fact ("no seed pipeline on this kernel") rather than a not-yet.
 * Asking earlier would record a verdict the same boot can still contradict —
 * the shape `pnpm check:startup-registry-verdict` guards.
 *
 * ## Suppressed sources never settle, and that is the answer, not a gap
 *
 * Two deployment shapes register seed datasets and then deliberately do not run
 * them at boot, so `app:seeded` never fires:
 *
 *  - **multi-tenant** — seeds are replayed per organization on `sys_organization`
 *    insert, so at boot the rows they describe do not exist yet;
 *  - **`skipSeedData`** — an `os migrate` planning boot (#3917) that must not
 *    write to the target database at all.
 *
 * Both report `pending > 0` for the life of the boot, which makes the ADR-0104
 * posture for them fall out of this one predicate: **do not self-certify at
 * boot; wait for `os migrate … --apply` to record the flag on a real scan.**
 * That is the correct answer rather than a missing one — certifying at startup
 * that a per-org replay which has not happened yet holds no violating value is
 * #4769's error with a longer fuse.
 */

/**
 * Why a registered seed source will not settle during this boot.
 *
 * Both values mean "the rows this source describes are not being written by
 * this boot", so nothing observed at startup can prove or disprove a claim
 * about them.
 */
export type SeedSuppressionReason =
  /** Multi-tenant: seeds replay per org on `sys_organization` insert. */
  | 'multi-tenant-replay'
  /** `skipSeedData`: a read-only planning boot that writes nothing (#3917). */
  | 'skip-seed-data';

/** A point-in-time reading of the kernel's seed pipeline. */
export interface SeedSettlementSnapshot {
  /**
   * Seed sources whose boot-time write has not settled — the sum of
   * {@link inFlight} and {@link suppressed}. `0` means every registered source
   * has finished writing (or none was ever registered), and a consumer may act
   * on what the store now holds.
   */
  readonly pending: number;

  /**
   * Sources still writing. Each will settle and emit `app:seeded`, so a
   * consumer that defers on this will be called again.
   */
  readonly inFlight: number;

  /**
   * One entry per source this boot suppressed; these never settle and no
   * `app:seeded` follows. Carried as reasons rather than a count so a consumer
   * can say *why* it is standing down.
   */
  readonly suppressed: readonly SeedSuppressionReason[];
}

/**
 * Read-only settlement probe, registered by the runtime under
 * {@link SEED_SETTLEMENT_SERVICE}.
 *
 * Deliberately read-only: declaring and settling sources is the seeding
 * host's own business, and a consumer that could mutate the tally could
 * certify itself. The surface is one method because one question is all the
 * ADR-0104 attestation needs.
 */
export interface ISeedSettlementService {
  /** Read the live tally. Never cached by the caller — re-read per use. */
  snapshot(): SeedSettlementSnapshot;
}

/** Service-registry slot for {@link ISeedSettlementService}. */
export const SEED_SETTLEMENT_SERVICE = 'seed-settlement' as const;
