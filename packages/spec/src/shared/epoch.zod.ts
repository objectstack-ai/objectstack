// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * An INSTANT: milliseconds since the Unix epoch (`Date.now()`).
 *
 * ## Why this exists as a shared schema and not as a naming rule
 *
 * `check:duration-unit-keys` (#14478, maintainer ruling B) makes a
 * duration-shaped `z.number()` carry its unit in its KEY NAME, because two
 * sibling keys both spelled `ttl` in different units are indistinguishable at
 * the authoring site. An epoch instant is numerically the same shape and reads
 * the same way to that rule — `startTime: z.number().describe('Boot timestamp
 * (ms)')` names a unit in prose and carries none in the name — but it is a
 * DIFFERENT confusion, and renaming it to `startTimeMs` would resolve the wrong
 * one: measured on this package's own authorable surface, all 51 distinct `*Ms`
 * keys are durations (`timeoutMs`, `backoffMs`, `latencyMs`, `uptimeMs`, …) and
 * all 51 distinct `*At` keys are instants (`createdAt`, `expiresAt`,
 * `lastUsedAt`, …). Spelling an instant `*Ms` would move it INTO the duration
 * family, which is the opposite of the ruling's purpose.
 *
 * So the exemption is a DECLARATION ON THE CONTRACT, never a gate ledger:
 * a key whose value IS this schema is an instant, the gate recognises that
 * structurally, and no allowlist anywhere names the key. The ruling's words:
 * "epoch instants move to a shared `EpochMs` schema".
 *
 * ## What it declares
 *
 * `z.number().int()` — an integer, because `Date.now()` is one and a
 * fractional epoch is a bug at the producer, not a value to carry. Sites that
 * previously declared a bare `z.number()` are tightened by adopting this; the
 * four that already declared `.int()` keep exactly what they had.
 *
 * No `.min()`: a pre-1970 instant is negative and legitimate, and inventing a
 * floor here would refuse data this schema has no business judging.
 *
 * ## How to use it
 *
 * Compose it and describe the instant at the site — the site's `.describe()`
 * wins over this one, and the reference page prints the site's prose:
 *
 * ```ts
 * createdAt: EpochMs.describe('Unix timestamp in milliseconds when the scope was created'),
 * registeredAt: EpochMs.optional().describe('Unix timestamp in milliseconds when the service was registered'),
 * ```
 *
 * Name the key `*At`. That is this package's measured convention for an
 * instant, and it is what keeps an instant out of the `*Ms` duration family.
 */
export const EpochMs = z.number().int().describe('Unix timestamp in milliseconds (epoch)');
