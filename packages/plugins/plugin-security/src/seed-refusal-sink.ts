// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18091] `reportThroughSink` — the ONE derivation of "a seeder refusal
 * reaches the author even when no logger was injected".
 *
 * ## Why this is a module and not a third hand-written copy
 *
 * The doubly-optional call `logger?.warn?.(…)` evaluates to NOTHING when the
 * caller passed no logger: the declaration is dropped, one internal counter
 * moves, and no human is told. That shape has now been repaired
 * instance-by-instance TWICE — once on the permission-set axis (#17516) and
 * once on the capability axis (#18023) — and each repair restated the same two
 * lines at its own call site. A shape repaired one instance at a time is a
 * CLASS that has not been fixed, which is why the five remaining refusal sites
 * in the two declared-metadata seeders share ONE delivery derivation instead of
 * gaining five more copies of it.
 *
 * What is shared here is exactly the part that is axis-INDEPENDENT: WHERE the
 * line goes. ⛔ What is deliberately NOT shared is the wording, the token, the
 * record and the consequence — those are axis-specific (four of the six parts a
 * refusal report is made of), and folding them into one generic sentence is the
 * failure mode `seed-refusal-diagnostics.ts` is written to avoid.
 *
 * ## The three spellings this replaces, and why each is wrong
 *
 *  - ⛔ `logger?.warn?.(…)` — silent with no sink. THE defect.
 *  - ⛔ `(logger?.warn ?? console.warn)(…)` — evaluates to a bare function and
 *    calls it with `this === undefined`; a class-based host sink
 *    (`@objectstack/core`'s `ObjectLogger`) reaches for `this` and throws. The
 *    property-access call form below keeps the receiver — the same measured
 *    conclusion `logSeedDurabilityFailure`, `reportPermissionSetNameCollisions`
 *    and `reportCapabilityNameCollisions` all record.
 *  - ⛔ `if (logger) logger.warn(…)` — correct for a sink whose `warn` the TYPE
 *    guarantees, but it THROWS for a host the type cannot reach (a plain-JS
 *    embedder, or a cast). `permission-set-projection.ts` records that measured
 *    hazard on `ProjectionLogger.warn`: a sink that lies about its shape
 *    throws `logger?.warn is not a function` inside a per-row durability catch
 *    and aborts the very batch that function promises never to stop.
 *
 * So the guard below is a `typeof` check rather than a truthiness test, and it
 * is strictly better than BOTH halves of the old trade-off: a lying host no
 * longer buys its silence with a throw — it gets the console, and the author
 * still hears the refusal.
 *
 * ⚠️ This is the REFUSAL channel only. The end-of-pass `logger?.info?.(…)`
 * summary in each seeder keeps its outer `?.` deliberately: a pass that did its
 * work and refused nothing MUST stay silent on every console channel with no
 * sink injected, which is the discriminating control #18023 landed. Routing a
 * healthy boot's info line to `console.info` would turn every one of those
 * controls into noise and buy no author anything.
 */

import type { CollisionReportSink } from './permission-set-name-collision.js';

/**
 * Re-exported for the reason #18088 gave when it did the same: a consumer of
 * this delivery rule never declares a second structural copy of the sink.
 */
export type { CollisionReportSink };

/**
 * Print one refusal so it reaches the author.
 *
 * `warn`, not `error`: every caller here reports FUNCTIONAL degradation (#4632)
 * — the deployment is visibly less than it was authored to be. Nothing claimed
 * to be persisted silently failed to land; the write was deliberately never
 * attempted, or the read that would have decided it never answered.
 *
 * @param logger the host sink, or `undefined` when none was injected
 * @param message the fully worded, axis-specific line — ⛔ never assembled here
 * @param meta the structured half of the same finding
 */
export function reportThroughSink(
  logger: CollisionReportSink | undefined,
  message: string,
  meta?: Record<string, any>,
): void {
  // ⛔ `typeof`, not truthiness — see the module header's third bullet. The
  // property-access call form keeps the receiver for a class-based sink.
  if (logger && typeof logger.warn === 'function') logger.warn(message, meta);
  else console.warn(message, meta);
}
