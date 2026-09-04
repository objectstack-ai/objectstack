// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where this package reads the app's declared collections from
 * (ADR-0130 D4/D5 — option B; #15229, reader program 5/4 of the ruling on
 * #14512).
 *
 * ## The loss this closes
 *
 * A multi-package artifact today serializes every definition TWICE: once
 * flattened onto the top level, once inside `packages[i].manifest`. Option B
 * removes the flattened copy. Every reader in this package took the flattened
 * copy and nothing else, so under option B `deriveCrudCases` derived ZERO cases
 * and `rlsProbePermissionSet` built an EMPTY probe permission set — and
 * `os verify` printed `✓ verify passed` over an app it had asserted nothing
 * about. That is the reason this package's card carries `priority:p2` while the
 * rest of the reader program carries p3: every other reader loses a capability,
 * this one loses the verification itself and reports success while doing it.
 *
 * ## The rule, and why it is in this order
 *
 * **The caller's original expression answers first; `packages[]` supplies only
 * what the top level LACKS.** Not a re-expression of the same question:
 *
 *   - `config.objects` is truthy for an EMPTY ARRAY, so re-expressing a read as
 *     "resolve everything, then take what came back" silently changes the
 *     answer for a stack that declares `objects: []` — measured on the sibling
 *     card #15006. A falsy top level (absent / null) is the only thing that
 *     reaches `packages[]` here, so a declared-empty collection stays empty.
 *   - Today's artifact is still additive, so the top level is present and the
 *     answer is bit-identical to the one before this change. That is what makes
 *     this card revertible on its own and safe to land BEFORE the emitter half
 *     (#14512) — it is a widening, never a switch.
 *
 * ## Why `resolveArtifactPackageOrder` and never `config.packages`
 *
 * The package order is `@objectstack/core`'s decision (ADR-0130 D4+D5, since
 * #14643): dependency-topological, entry-gated, duplicate-refusing. Iterating
 * `config.packages` here would be a SECOND traversal and therefore a second
 * ordering — two answers to a question the artifact contract answers once. The
 * one behavioural consequence worth stating: a malformed `packages` array now
 * raises that function's ADR-0112 refusal (`code` + `status: 422`) instead of
 * being read as "no collections", which is the loud-over-silent direction this
 * whole card is about.
 */

import { resolveArtifactPackageOrder } from '@objectstack/core';

/**
 * The app's declared members of one collection — the flattened top level when
 * it carries the key, otherwise every package's contribution in dependency
 * order.
 *
 * @param config - The loaded app config (`os verify` gets it from `loadConfig`),
 *   or a compiled artifact. Nullish is tolerated exactly as the `?.` reads it
 *   replaced were.
 * @param key - The collection key, e.g. `objects` / `datasources` / `positions`.
 * @returns The top-level value UNTOUCHED when it is truthy — including a
 *   non-array one, so a malformed config still fails where it used to rather
 *   than being quietly repaired here — otherwise the concatenation of the
 *   package bodies' arrays.
 * @throws The ADR-0112 refusal from `resolveArtifactPackageOrder` when the
 *   artifact carries a malformed `packages` array or a duplicate package id.
 */
export function declaredCollection(config: any, key: string): any[] {
  const declared = config?.[key];
  if (declared) return declared as any[];

  // `resolveArtifactPackageOrder` reads a bare config with no `packages` key as
  // a single-package artifact and hands it straight back, so this branch on
  // today's single-package apps re-reads the same absent key and answers `[]` —
  // the same empty array the `?? []` it replaced produced.
  const bodies = resolveArtifactPackageOrder(config) as Array<Record<string, unknown>> | undefined;
  const merged: any[] = [];
  for (const body of bodies ?? []) {
    const items = body?.[key];
    if (Array.isArray(items)) merged.push(...items);
  }
  return merged;
}
