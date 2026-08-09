// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tombstones for RETIRED authorable keys (#3855).
 *
 * Removing a key an author can write has one hard requirement: the removal must
 * be **audible**. None of the schemas that carried a deprecated alias is
 * `.strict()` — `FieldSchema` says so in a comment and records that the trap
 * already bit once (`dataQuality` / `cached` outlived their keys by a release
 * and were silently stripped, #3726 / #3733, the ADR-0104 class). So simply
 * deleting the key from the Zod object does not produce an error; it produces a
 * **silent strip**, which is the exact failure mode #3713 → #3743 → #3838 →
 * #3854 spent four PRs eliminating, reintroduced one layer down.
 *
 * A tombstone keeps the key declared but makes it unwritable, so the removal
 * lands in the two channels an upgrading author — very often an AI (ADR-0033) —
 * actually reads:
 *
 *   1. **`tsc`.** The input type becomes `never`, so assigning anything to the
 *      key fails to compile at the authoring site, before anything runs.
 *   2. **The parse.** A value reaching the runtime raises the prescription
 *      itself — not a generic "unrecognized key". This matters because upgrades
 *      do not happen in the order we imagine: someone jumping several majors at
 *      once gets the same message as someone stepping one, whereas a load-time
 *      conversion (ADR-0087 D2) only covers N−1 and would have already retired.
 *
 * The prescription — not a "deprecated" label — is the payload. AGENTS.md
 * ("Removing an authorable spec key also requires a tombstone entry … so the
 * rejection itself carries the prescription") names the compile/validation
 * error as the one upgrade channel every consumer is guaranteed to hit: an
 * agent bumping `@objectstack/spec` sees THIS string, not our docs site. Write
 * it as an instruction, with the FROM → TO mapping and the one-line fix.
 *
 * **The `os migrate meta` sentence is standardized — do not choose a verb.**
 * A prescription whose surface an ADR-0087 conversion covers closes with
 * exactly this sentence, whether the conversion STRIPS the key or REWRITES
 * its value (#6856, maintainer-ruled 2026-08-09):
 *
 *     Run `os migrate meta --from <N>` to rewrite existing sources automatically.
 *
 * The sentence states a property of the TOOL — it rewrites your source
 * files — never the fate of the key. The retired "rewrite it" spelling was
 * misread over strip conversions because "it" has two antecedents (the key
 * vs your sources) and the wrong reading promises a value conversion that
 * never happens; "existing sources" has one antecedent. The KEY's fate
 * belongs in the body prose ("Delete the key…", "Rename the key to…"),
 * which every prescription already carries — the sentence never restates
 * it. ONE exception: a conversion that rewrites only PART of the value
 * keeps the two-clause form naming which part — "… to rewrite the <X> case
 * … automatically; <what the tool does with the rest>." (model:
 * `ui/dashboard.zod.ts` `compareTo.offset`). Both shapes are pinned
 * class-wide by `retired-key-migrate-sentence.test.ts`; a new spelling
 * fails the pin, not code review.
 *
 * Tombstones age out, exactly like the `UNKNOWN_KEY_GUIDANCE` entries in
 * `data/object.zod.ts`: drop one ~two majors after the removal, by which point
 * it is archaeology rather than an upgrade (the history lives in CHANGELOG.md).
 */

import { z } from 'zod';

/**
 * Declare a key that has been REMOVED from the spec.
 *
 * Accepts only `undefined` — i.e. absence. Any authored value is rejected with
 * `guidance`, and `z.input` types the key as `never` so the same mistake fails
 * `tsc` first.
 *
 * @param guidance - The upgrade prescription. State what replaced the key, the
 *   version that removed it, and the one-line fix — this string IS the migration
 *   doc for anyone who hits it. When an ADR-0087 conversion covers the surface,
 *   close with the house `os migrate meta` sentence (module docblock above —
 *   the wording is pinned, not a choice).
 *
 * @example
 * ```ts
 * conditionalRequired: retiredKey(
 *   '`conditionalRequired` was removed in @objectstack/spec 17.0.0 (#3855). ' +
 *   'Rename the key to `requiredWhen` — the value (a CEL predicate) is unchanged. ' +
 *   'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
 * ),
 * ```
 */
export function retiredKey(guidance: string) {
  return z.never({ error: () => guidance }).optional().describe(`[REMOVED] ${guidance}`);
}
