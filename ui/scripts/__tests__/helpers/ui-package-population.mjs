// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ui-package-population -- the ONE place the size of the ui package population
 * is written down, as anti-vacuity floors.
 *
 *   import { UI_PUBLISHED_PACKAGE_FLOOR } from './helpers/ui-package-population.mjs';
 *   expect(published.length).toBeGreaterThanOrEqual(UI_PUBLISHED_PACKAGE_FLOOR);
 *
 * A floor here answers one question: "did the scan find a population at all,
 * or did a lost workspace root, a broken glob or a renamed manifest field leave
 * it reading nothing?" It is NOT a census. A census pinned at today's measured
 * value goes red on every legitimate package deletion, and one deletion then
 * edits a floor in every file that spelled the count (objectstack#26444 counted
 * five for a single retirement). So each floor sits at about two thirds of the
 * value measured below -- the `vite-dts-wiring-ratchet` precedent: measured 22,
 * floor 15 -- and is written once, here, for every reader:
 *
 *   - `scripts/check-node-esm-load.mjs` and `scripts/check-published-dist-tooling.mjs`
 *     (`MIN_PACKAGES`, the gates' own refusal to judge a collapsed scan);
 *   - `package-files-exist`, `side-effects-declaration-consistency`,
 *     `check-dist-completeness`, `zero-test-member-exclusion-9106`,
 *     `check-doc-links` and `quick-reference-commands-4149` under `scripts/__tests__/`.
 *
 * It is an `.mjs` module, not a `.ts` helper like its neighbours, because the two
 * gate scripts above import it at run time under plain `node`.
 *
 * Re-measuring: a floor moves only when its population has shrunk to near it,
 * and then to about two thirds of the new measurement, with the measurement and
 * its commit recorded in the table below. ⛔ Never raise a floor to track growth:
 * growth is routine and the floor's job is only to refuse an empty scan.
 *
 * Measured on objectstack `origin/main` `6a7c0fe3` (2026-10-27, right after
 * `@object-ui/app-shell` became private):
 *
 *   population                                   measured   floor   margin
 *   published packages (release group)                 36      24       12
 *   workspace members (packages/*, apps/*, examples/*)  43      28       15
 *   `sideEffects: false` declarers                     11       7        4
 *   `sideEffects` array declarers                      17      11        6
 *   tsc-built packages                                 11       7        4
 */

/**
 * Packages that publish to npm: not `private: true`, in the changesets release
 * group. Readers whose population is a superset of these (packages declaring
 * `files` or `exports`, package directories carrying a README) read this floor
 * too: if the published set is there, so is theirs.
 */
export const UI_PUBLISHED_PACKAGE_FLOOR = 24;

/** Every manifest under the three workspace globs, private ones included. */
export const UI_WORKSPACE_MEMBER_FLOOR = 28;

/** Packages declaring `"sideEffects": false`. */
export const UI_SIDE_EFFECTS_FALSE_FLOOR = 7;

/** Packages declaring `sideEffects` as an array of paths. */
export const UI_SIDE_EFFECTS_ARRAY_FLOOR = 11;

/** Packages whose build runs `tsc` (the `check-dist-completeness` population). */
export const UI_TSC_BUILT_PACKAGE_FLOOR = 7;
