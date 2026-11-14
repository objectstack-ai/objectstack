// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Keep the banner's promise: "seeding continues in the background; its result
 * prints after this banner" (#33233).
 *
 * The ready banner says that when the seed is still writing as it prints
 * (`⚠ Seeds:   pending`, `printSeedsStillWriting` in `./format.ts`). Nothing
 * kept the promise on a clean seed: the seeder's completion lines are `info`,
 * under the default `warn` level, so the terminal went quiet and a reader could
 * not tell a seed that landed from one still writing.
 *
 * `os serve` composes this beside its `objectstack:seed-settled` announcer:
 *
 *  - {@link SeedResultAfterBanner.noteBanner} is handed the snapshot the banner
 *    prints, inside the banner thunk, so the promise is read from exactly what
 *    the reader was shown. It returns the snapshot unchanged.
 *  - {@link SeedResultAfterBanner.settled} is called with the per-source
 *    summary when the announcer sends its one settle message. It prints the
 *    result ONCE, and only when the banner promised it: a seed that settled
 *    before the banner already has its `Seeds:` row there, and printing it
 *    again would be noise.
 *
 * Best-effort like the IPC send it rides beside: a print that throws is
 * swallowed, so it can neither cost the message nor take a healthy server down.
 *
 * Kept out of `../commands/serve.ts` on purpose: this is a small piece of
 * state with no dependency on the boot, and its tests should not load the
 * command's whole plugin graph to exercise it.
 */

import type { SeedSettlementSnapshot } from '@objectstack/spec/contracts';
import type { SeedSourceSummary } from './format.js';

/** What {@link createSeedResultAfterBanner} returns. */
export interface SeedResultAfterBanner {
  /** Record what the banner showed; returns `snapshot` unchanged. */
  noteBanner: (snapshot: SeedSettlementSnapshot | undefined) => SeedSettlementSnapshot | undefined;
  /** The seed settled: print its result iff the banner promised it, once. */
  settled: (sources: readonly SeedSourceSummary[]) => void;
}

export function createSeedResultAfterBanner(
  printResult: (sources: readonly SeedSourceSummary[]) => void,
): SeedResultAfterBanner {
  let promised = false;
  return {
    noteBanner: (snapshot) => {
      promised = !!snapshot && snapshot.inFlight > 0;
      return snapshot;
    },
    settled: (sources) => {
      if (!promised) return;
      promised = false;
      try {
        printResult(sources);
      } catch {
        /* human-facing nicety — best-effort */
      }
    },
  };
}
