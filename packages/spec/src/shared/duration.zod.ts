// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * A DURATION: an elapsed span of time, in milliseconds.
 *
 * ## Why this exists as a shared schema and not only as a naming rule
 *
 * `check:duration-unit-keys` (#14478, maintainer ruling B) makes a
 * duration-shaped `z.number()` carry its unit in its KEY NAME, because two
 * sibling keys both spelled `ttl` in different units are indistinguishable at
 * the authoring site. That gate reads ONE channel — the unit token in the name,
 * cross-checked against the `.describe()` prose — and it deliberately declines
 * to JUDGE a key whose prose names no unit at all, while still listing it:
 * judging those by name alone was measured to be wrong, because most are counts
 * wearing a duration's
 * vocabulary (`contextWindow`, `backoffMultiplier`, `snapshotInterval` "every N
 * events"). A name list long enough to tell those apart is a list that has to
 * be maintained against every new key.
 *
 * Ruling A on #18115 (decision batch #134 item 1) settles it by adding a SECOND
 * declaration channel instead of a longer list:
 *
 * > 声明式:引入与 `EpochMs` 同款的闭合时长类型(`DurationMs` / `DurationSeconds`,
 * > 单位集合由 6 个真时长行决定);体检只认「用了时长类型,或键名带单位」的键;
 * > 17 个无单位数自然出列,6+2+≥2 个真时长各取类型或改名;名字表退为提示。
 *
 * So a duration declares its unit in exactly one of two places, and a numeric
 * key that uses neither is not a duration the census has to guess about:
 *
 * 1. **The value's TYPE** — this schema, or {@link DurationSeconds} beside it.
 *    The unit sits on the contract, where a rename cannot lose it.
 * 2. **A unit token in the KEY NAME** — `timeoutMs`, `retentionDays`. The
 *    channel the gate already reads.
 *
 * This is the counterpart of `EpochMs` (`shared/epoch.zod.ts`) and is declared
 * the same way, for the same reason: a structural declaration ON THE CONTRACT,
 * never an allowlist naming keys in a gate ledger.
 *
 * ⛔ **Step ① of three (#18122) — this module declares the types and converts
 * nothing.** The gate learns to READ channel 1 in #18123 (step ②), and the
 * genuine duration rows each take a type or take a name in #18124 (step ③).
 * Until step ② lands, a key typed `DurationMs` is outside the gate's population
 * rather than exempted by it: the gate recognises exactly one identifier root
 * today, `EpochMs`.
 *
 * ## What it declares, and why this refinement
 *
 * `z.number().int().nonnegative()`, measured against the six genuine duration
 * rows whose unit set the ruling derives from — what each declares today:
 *
 * - `kernel/plugin-lifecycle-advanced.zod.ts` `shutdownTimeout` —
 *   `z.number().int().min(0).default(30000)`
 * - `kernel/plugin-security-advanced.zod.ts` `cors.maxAge` —
 *   `z.number().int().optional()`
 * - `system/metrics.zod.ts` `slideInterval` — `z.number().int().positive().optional()`
 * - `system/auth-config.zod.ts` `session.updateAge` — `z.number().default(60 * 60 * 24)`
 * - `api/contract.zod.ts` `meta.duration` — `z.number().optional()`
 * - `data/field-value.zod.ts` `FileValue.durationSeconds` — `z.number().optional()`
 *   (spelled `FileValue.duration` when this census was taken; renamed by #18669,
 *   ruling A, with the value type left exactly as measured here)
 *
 * `.int()`: three of the six already declare it, and both rows that carry a
 * default default to an integer (`30000`, `60 * 60 * 24`). The three bare
 * `z.number()` rows are TIGHTENED by adopting this — the same tightening the
 * sites that adopted `EpochMs` took.
 *
 * `.nonnegative()`: the weakest floor that every floor declared in that
 * population implies. One row declares `.min(0)` and one `.positive()`; none
 * declares a negative floor, and a span of elapsed time below zero is a bug at
 * the producer rather than a value this schema should carry. `.positive()`
 * would be too strong in the other direction — `.min(0)` admits `0`, and a
 * zero timeout means "do not wait".
 *
 * ⛔ **Two units, because the six rows need two.** `DurationMinutes` /
 * `DurationHours` / `DurationDays` are added when a real row needs one, in the
 * PR that converts it. The unit set is derived from the conversion population,
 * never declared ahead of it.
 *
 * ## How to use it
 *
 * Compose it and describe the duration at the site — the site's `.describe()`
 * replaces this one, and the reference page prints the site's prose:
 *
 * ```ts
 * gracePeriod: DurationMs.default(30000).describe('How long to wait before forcing the operation'),
 * refreshInterval: DurationSeconds.optional().describe('How often the session is refreshed'),
 * ```
 */
export const DurationMs = z.number().int().nonnegative().describe('Duration in milliseconds');
/**
 * The value a `DurationMs` key carries: an elapsed span in milliseconds.
 *
 * Author state and parsed state coincide (`z.number().int().nonnegative()` has
 * no default and no transform), so there is deliberately no `DurationMsParsed`
 * — a permanent synonym is a name an author can only pick wrongly. The
 * isomorphism is pinned in `type-alias-convention.pin.test.ts` (ADR-0122), so
 * the day this schema gains a default or a transform the pin goes red with the
 * alias named.
 */
export type DurationMs = z.input<typeof DurationMs>;

/**
 * A DURATION: an elapsed span of time, in seconds.
 *
 * The seconds half of the closed duration vocabulary — see {@link DurationMs}
 * for why the vocabulary is closed, which refinement it carries and why, and
 * why the unit set is exactly two units today.
 *
 * Seconds is the second unit the population needs, and the row that fixes it is
 * `system/auth-config.zod.ts` `session.updateAge`: it defaults to
 * `60 * 60 * 24`, and the comment above it records that the defaults of the
 * `session.expiresIn` / `session.updateAge` pair are better-auth's own, "7 days
 * / 1 day" — so that number is one day counted in SECONDS. Its sibling
 * `session.expiresIn` states that unit in its prose ("Session duration in
 * seconds"); `updateAge` states it in neither channel, which is the shape this
 * vocabulary exists to close.
 */
export const DurationSeconds = z.number().int().nonnegative().describe('Duration in seconds');
/**
 * The value a `DurationSeconds` key carries: an elapsed span in seconds.
 *
 * Author state and parsed state coincide, so there is deliberately no
 * `DurationSecondsParsed` — see {@link DurationMs} for the ADR-0122 reasoning
 * and the pin that holds it.
 */
export type DurationSeconds = z.input<typeof DurationSeconds>;
