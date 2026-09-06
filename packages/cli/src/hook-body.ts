// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/cli/hook-body` — the public entry for the hook-body extractor.
 *
 * ## Why this entry exists (#15325)
 *
 * `extractHookBody` decides whether a hook or script action is still shippable
 * **body-only**: it peels the handler to its statements, refuses the forbidden
 * tokens, infers capabilities, and throws a `HookBodyExtractionError` carrying
 * `kind` / `freeIdentifiers` / `nodeOnlyIdentifiers`. `os build` applies it to
 * lower a handler, `os lint` calls the same function so its verdict cannot
 * drift from the build's. An app that wants to assert "my hooks are still
 * metadata-only" — and to RUN the lowered `source` through the real QuickJS
 * runner in a test — needs this exact function, not a lookalike: a local
 * reimplementation passes its own tests while diverging from the rule the
 * build actually applies, which is the failure mode #13651 was filed about.
 *
 * Until 17.3.0 the extractor was reachable as a deep `dist/utils/` import, and
 * one out-of-repo consumer (hotcrm's hook-body fidelity harness) reached it
 * that way on purpose. #13123 then sealed this package behind an `exports`
 * map and named the remedy for an out-of-repo consumer in its own body:
 * ratify the subpath as public surface rather than read `dist/` paths. That
 * remedy was applied to `./console` for cloud's `objectos-runtime` (#13662);
 * this entry applies it to the second consumer.
 *
 * ## Why a dedicated file and not the internal module itself
 *
 * `./console` points its subpath straight at `dist/utils/console.js`, so every
 * export that module ever gains is public the moment it lands. The card asks
 * for four names, and that is what this file re-exports — by name, no star. An
 * export `extract-hook-body.ts` grows tomorrow is NOT public until someone
 * edits this list, and `test/published-subpath-hook-body.pin.test.ts` holds
 * the packed `.d.ts` to exactly these four so the widening is a deliberate,
 * reviewed, `minor`-bumped act rather than a side effect of a refactor.
 *
 * ⛔ Do not add to this list to make something convenient reachable. A new
 * name here is a new public contract on a published package.
 */

export { extractHookBody, HookBodyExtractionError } from './utils/extract-hook-body.js';
export type { ExtractedBody, HookBodyRefusalKind } from './utils/extract-hook-body.js';
