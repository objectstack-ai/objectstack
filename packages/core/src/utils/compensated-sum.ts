// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20489, #20544] The sum of `nums`, added in order with
 * Kahan-Babuska-Neumaier compensation — the summation SQLite (3.43 and later)
 * uses for its own `sum` and `avg`, transcribed from its
 * `kahanBabuskaNeumaierStep` and the finalizers' overflow guard.
 *
 * Why: a naive fold (`reduce((a, b) => a + b, 0)`) and SQLite answer two
 * different doubles for the same values. A `number` column holding `0.1`,
 * `0.2` and `0.3` sums to `0.6` on SQLite and to `0.6000000000000001` naively
 * (`avg` `0.19999999999999998` against `0.20000000000000004`), so
 * `having { s: { $eq: 0.6 } }` kept a group on one face and dropped it on
 * another. Compensated, the faces agree, and the answer is the more accurate
 * one (`1e16 + 1 - 1e16` is `1`, not `0`).
 *
 * ## Why it lives here
 *
 * Every platform fold that adds a group's values in JavaScript calls this one
 * function, so a `sum` is the same double on every face the platform owns:
 *
 * - `@objectstack/objectql`'s rows path (`in-memory-aggregation.ts`, the fold
 *   `engine.aggregate` runs itself), where it was written;
 * - `@objectstack/driver-memory`'s native `aggregate` (`memory-driver.ts`,
 *   `computeAggregate`) and its analytics face (`memory-analytics.ts`, the
 *   `sum` / `avg` measure accumulator);
 * - `@objectstack/service-analytics`' draft preview (`preview-evaluator.ts`,
 *   the `sum` / `avg` arms).
 *
 * Neither `driver-memory` nor `service-analytics` has objectql among its
 * runtime dependencies, and this is the package all three already stand on —
 * the same reason `bucketDateKey` lives here. A second transcription is how a
 * face comes to answer its own double again.
 *
 * ## What does not move
 *
 * Two addends (the compensated `a + b` IS the naive one), integers whose
 * partial sums stay within 2^53 (every addition is exact), and a non-finite
 * total. `s` below is exactly the naive running sum; once it overflows or
 * meets a NaN, the error term is non-finite and the naive answer is returned
 * as it was, which is SQLite's rule too. An empty list sums to `0`. Which
 * values count as addends, and what an empty group answers, stay each
 * caller's own rule: this function only adds.
 *
 * ⚠️ Residual, stated: PostgreSQL and MySQL add their doubles natively without
 * compensation, and the platform does not wrap that arithmetic, so over three
 * or more fractions their native path can still differ from this one in the
 * last place. An exact `$eq` on a fractional sum compares doubles; compare
 * with a range.
 */
export function compensatedSum(nums: readonly number[]): number {
  let s = 0;
  let c = 0;
  for (const r of nums) {
    const t = s + r;
    c += Math.abs(s) > Math.abs(r) ? (s - t) + r : (r - t) + s;
    s = t;
  }
  return Number.isFinite(c) ? s + c : s;
}
