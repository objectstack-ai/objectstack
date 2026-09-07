// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * tsup-drop-sources-content -- the ONE place `sourcesContent: false` is
 * decided for every tsup/esbuild build in this tree (#16469, the build half
 * of #15905's E3 standard question 1: "is `.js.map` `sourcesContent`
 * published?" -- answered "no" by construction).
 *
 * `sourcemap: true` is tsup's own option and stays untouched everywhere --
 * `mappings` (stack-trace positions) are unaffected. `sourcesContent` has no
 * tsup-level knob; esbuild owns it, and esbuild's own default is `true` --
 * nobody decided to publish the complete original source of every package
 * (comments included) to npm, it fell out of a default nobody looked at.
 * tsup's `esbuildOptions(options, context)` hook is the one place a tsup
 * config reaches esbuild's real `BuildOptions` before the build runs, so
 * that is where this is set.
 *
 * `packages/**\/tsup.config.ts` import this and wire it in:
 *
 *     import { dropSourcesContent } from '../../scripts/tsup-drop-sources-content.mjs';
 *     export default defineConfig({
 *       ...
 *       esbuildOptions: dropSourcesContent,
 *     });
 *
 * A config that already uses `esbuildOptions` for something else calls this
 * INSIDE its own hook body instead of assigning the export directly (see
 * `packages/spec/tsup.config.ts` for the shape once it exists there).
 *
 * There is no monorepo-wide tsup config every package extends -- most
 * packages share the repo-root `tsup.config.ts` directly (`tsup --config
 * ../../tsup.config.ts` in their `build` script; see `pnpm --filter <pkg> run
 * build`'s definition to confirm a given package's shape), and that root
 * config is one of this file's callers, so those packages need no change of
 * their own. The ~20 packages with a bespoke entry shape carry their own
 * `tsup.config.ts` and each needs this same one-line wire-up.
 * `check:sourcemap-no-sources-content` (scripts/check-sourcemap-no-sources-content.mjs)
 * is the pin that catches a config that skips it, or a future tsup/esbuild
 * upgrade that changes the default back.
 *
 * @param {import('esbuild').BuildOptions} options
 */
export function dropSourcesContent(options) {
  options.sourcesContent = false;
}
