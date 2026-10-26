/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ZOD WRAPPER KEYS — the one literal list both language sides read
 * (`d3bf4fa6f`, ruled 2026-08-31; objectui#5872 class (3)).
 *
 * ## What the list is
 *
 * The `_def` / `def` member names a Zod node exposes for the schema it wraps.
 * Walking them is how a reader gets from a wrapped node — a pipe, an effect, a
 * refinement, an `.optional()` — down to the object `shape` underneath. Nothing
 * here is a judgement: it is a vocabulary, transcribed from Zod's internals.
 * The walk that consumes it stays with each caller (see the boundary below).
 *
 * ## Why it needed a home of its own, and not the usual one
 *
 * The copies had grown OUT of TypeScript and into `.mjs` CI gate scripts, so
 * they now span a language boundary. `@object-ui/test-support` is `private:
 * true` and its `exports["."]` resolves to `./src/index.ts` — TypeScript
 * SOURCE — so a bare `node scripts/check-*.mjs` cannot import it and there is
 * no build artefact for it to reach. That is the wall the card behind `d3bf4fa6f` was filed
 * to get a ruling on, and the ruling's answer is this file's shape:
 *
 *   - the data lives in `zod-wrapper-keys.json`, which needs no build step and
 *     no declaration file — `resolveJsonModule` types it for every TypeScript
 *     consumer, and `node` reads it through the `exports` subpath directly;
 *   - `@object-ui/test-support/zod-wrapper-keys` is that subpath, which is what
 *     the two `.mjs` gates import (the workspace root declares the package as a
 *     devDependency so the bare specifier resolves from `scripts/`);
 *   - this module re-exports it for the TypeScript side, typed and documented,
 *     and `index.ts` carries it onto the package surface.
 *
 * A `.mjs` data module was the other shape the ruling allowed, and was measured
 * and rejected: `index.ts` re-exporting from a `.mjs` is TS7016 in every
 * CONSUMER's program (the root config sets `allowJs: false`), so it would have
 * cost either `allowJs` in each of the nine dependent packages or a hand-written
 * `.d.mts` — the "second source of truth, free to drift silently" that
 * `tsconfig.scripts.json`'s header already argues against. JSON has neither
 * cost. The price JSON does charge is that it cannot carry its own prose, which
 * is why this module exists rather than a bare re-export.
 *
 * ## The boundary — DATA only (part of the ruling, not a preference)
 *
 * The ruling covers the LIST. It deliberately does not open a door for sharing
 * a function across the `.mjs` / TypeScript boundary: each caller keeps its own
 * walk, and the walks are legitimately not identical — the designer gate reads
 * `node._def ?? node.def ?? node._zod?.def` where the action gate reads
 * `s._def ?? s.def`. Consolidating THOSE is a separate question that needs its
 * own ruling on its own terms; do not fold it in here.
 *
 * ## Non-vacuity — the duty this list leaves with its callers
 *
 * The failure this list exists to prevent is not "the copies disagree", it is
 * what a disagreeing copy DOES: a walk that stops matching returns no shape,
 * the vocabulary derived from it becomes the empty set, and every "the renderer
 * implements every name the spec accepts" assertion built on it passes over
 * nothing. Measured on this exact family in PR #6047: on an empty vocabulary,
 * three of four parity gates stayed GREEN.
 *
 * So a caller owes an assertion that separates "resolved a shape" from
 * "resolved nothing". Both `.mjs` gates already pay it — they raise
 * `ExtractionError` rather than return an empty key set — and
 * `scripts/__tests__/zod-wrapper-keys.shared.test.ts` pins the other half: that
 * EVERY entry here is load-bearing, one fixture per key, so emptying this list
 * (or deleting a single entry) turns those gates red instead of quiet.
 *
 * ⚠️ That pin is deliberately driven from fixtures, not from whatever
 * `@objectstack/spec` currently ships. Measured on `@objectstack/spec@17.2.0`:
 * `ui.ActionSchema` and `automation.FlowNodeSchema` are reachable ONLY through
 * a wrapper key, but `data.FieldSchema` and `data.ObjectSchema` expose `.shape`
 * at depth 0 — so a counter-test anchored on the installed schemas would be
 * vacuous for the designer gate today, and could go vacuous for the others the
 * next time upstream unwraps something. Fixtures cannot rot that way.
 */

import keys from './zod-wrapper-keys.json';

/**
 * The `_def` / `def` member names to walk when unwrapping a Zod node, in the
 * order every in-tree reader has always tried them.
 *
 * `readonly` because it is a vocabulary, not a working array: a caller that
 * wants to filter or reorder should copy it. The `.mjs` gates read the same
 * bytes through `@object-ui/test-support/zod-wrapper-keys`.
 */
export const ZOD_WRAPPER_KEYS: readonly string[] = keys;
