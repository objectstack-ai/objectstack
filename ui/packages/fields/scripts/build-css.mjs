/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Builds `dist/index.css` from `src/index.css` — the file `@object-ui/fields`
 * has always PROMISED via its `"./style.css"` export and, until objectui#4059,
 * never once shipped.
 *
 * The subtraction itself — the components-sheet diff, its normalisation of
 * Tailwind's inlined `var()` fallbacks, its at-rule context keys and the
 * write-time assertions that guard it — lives in
 * `scripts/build-plugin-stylesheet.mjs` at the repository root and is NOT
 * repeated here. This file held the original copy of it; objectui#6405
 * re-pointed it at that module against a byte-for-byte check of the emitted
 * sheet, so there is now one implementation and a fix to it reaches every
 * package that ships a supplement sheet. `src/index.css`'s own header explains
 * the narrow `@reference` shape. What stays below is what is specific to THIS
 * package — including the history, because this is where it was worked out.
 *
 * ## What was wrong (objectui#4059)
 *
 * `packages/fields/package.json` declared `"./style.css": "./dist/index.css"`
 * while `scripts.build` was `tsc && vite build` and `src` held no `.css` file
 * at all, so Vite's library build had nothing to extract. Every published
 * tarball up to and including 17.3.0 contains ZERO `.css` files (measured over
 * the full `tar -tzf` listing), which means a consumer's
 * `@import '@object-ui/fields/style.css'` did not merely render badly — it
 * failed to resolve and took their build down with it.
 *
 * ## Why the file has to exist rather than the export be deleted
 *
 * Deleting the export was the cheaper fix and was ruled out on a measurement:
 * fields' class surface is NOT a subset of what `@object-ui/components`'
 * published sheet carries. Compiling fields' own source against components'
 * theme and diffing against `@object-ui/components@17.3.0`'s published
 * `dist/index.css` leaves 155 classes that exist only here — `cursor-crosshair`
 * (SignatureField), `group/email` (index.tsx), the whole tag colour map
 * (`text-indigo-700`, `bg-pink-50`, …), `min-w-[8ch]` (TagsField),
 * `hover:fill-yellow-500` (RatingField), and so on.
 *
 * 17 of those depend on the ObjectUI `@theme` block, which lives in
 * `packages/components/src/index.css` and is NOT published (that package ships
 * `dist` only). `bg-primary/20`, `hover:bg-accent/30`, `ring-destructive/50`
 * and friends therefore have exactly one possible producer in the world: a
 * build inside this monorepo that can see that theme. No amount of consumer-side
 * `@source` configuration can regenerate them.
 *
 * ## The "narrow" shape, and why it is not just `@import 'tailwindcss'`
 *
 * The naive fix — give fields a normal Tailwind entry — re-emits preflight, the
 * theme and ~1350 utilities the consumer already got from
 * `@object-ui/components/style.css`, i.e. ~180 kB of near-pure duplication. The
 * same objection retired two `@source` lines from the quick-start guide in
 * objectui#3884 for costing 100 kB and buying 14 selectors; it applies with more
 * force to a stylesheet we ship ourselves.
 *
 * So this build emits the DIFFERENCE and nothing else: `src/index.css`
 * `@reference`s components' entry — theme tokens, the class-based `dark`
 * variant and the animate plugin become available for resolution while emitting
 * nothing — and imports only the utilities layer, so there is no preflight and
 * no `:root` theme block to begin with; the shared builder then subtracts every
 * rule components' sheet already ships. The result is a supplement of a few kB.
 * It is only correct when loaded AFTER the components sheet, which is what the
 * `exports` docs, the guides and the banner below all say.
 *
 * ## The coupling, stated plainly
 *
 * `src/index.css` `@reference`s `packages/components/src/index.css` over a
 * build-time relative path, and the builder reads that package's BUILT
 * `dist/index.css`. Both are inside the monorepo and neither is reachable from
 * the published tarball — the same shape of coupling `@object-ui/components`'
 * own `scripts/build-css.mjs` has to its `src/index.css`, one directory further
 * away. Nothing in the published artifact refers to either path.
 *
 * Reading components' built artifact rather than re-compiling its entry is
 * deliberate: it is by definition "what the consumer already has", and it is
 * not sensitive to the working directory. Re-compiling was tried first and is
 * subtly wrong — Tailwind's automatic source detection resolves against the
 * process cwd, so compiling components' entry from THIS package's directory
 * scanned `packages/fields` and folded fields' own classes into the set being
 * subtracted. Every fields-only rule then looked "already shipped" and the
 * verification, which trusts that set, could not see it.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

import { isEntrypoint } from '../../../scripts/invoked-as.mjs';
import { createPluginStylesheetBuilder } from '../../../scripts/build-plugin-stylesheet.mjs';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_NAME = '@object-ui/fields';

/**
 * Utilities that MUST survive the subtraction, spanning both reasons a rule can
 * be fields-only.
 *
 * The first three resolve `@theme` tokens that `@object-ui/components` declares
 * but does not publish, so this build is the only producer they can ever have —
 * if the subtraction over-reaches, these are what silently disappear and no test
 * that renders a field in this repo would notice (every in-repo host compiles
 * fields' source directly and never loads this sheet). The last three are plain
 * utilities that simply are not in components' sheet.
 *
 * Deliberately a handful of named specimens, not a count: a threshold would have
 * to be re-tuned every time a widget gains a class, and the edit that silences a
 * real regression would look exactly like the edit that keeps it current.
 */
export const MUST_SURVIVE = [
  'bg-primary/20',
  'hover:bg-accent/30',
  'ring-destructive/50',
  'cursor-crosshair',
  'min-w-[8ch]',
  'hover:fill-yellow-500',
];

/**
 * Leak ceiling, not a budget. Measured on main@59df371f7: 157 classes correct,
 * and 1923 when the `source(none)` pin was absent from `src/index.css` and the
 * build ran from the repo root — a valid, much larger stylesheet full of other
 * packages' utilities rather than a failure, which is why the ceiling has to
 * assert the pin is still doing its job. It sits far above the real value on
 * purpose: a number that needed re-tuning every time a widget gained a class
 * would be edited into uselessness.
 */
export const CLASS_CEILING = 600;

/**
 * The banner the emitted sheet opens with — passed to the shared builder rather
 * than inherited from it.
 *
 * `@object-ui/fields` ships this stylesheet to consumers, and these exact bytes
 * have been at the top of it since objectui#4059. The shared default says the
 * same things in different words and names a different producing script;
 * adopting it would have been a diff in a published file, and objectui#6405's
 * acceptance gate was that re-pointing this build changes `dist/index.css` by
 * not one byte. `build({ header })` is the documented per-package hook for
 * exactly this, so the wording lives here and the subtraction lives there —
 * neither is a second copy of the other.
 */
export const HEADER = [
  '/*! @object-ui/fields — utilities this package adds on top of @object-ui/components.',
  ' *',
  ' * IMPORT AFTER the components sheet; this is a supplement, not a standalone stylesheet:',
  ' *',
  " *   @import '@object-ui/components/style.css';",
  " *   @import '@object-ui/fields/style.css';",
  ' *',
  ' * Preflight, the theme tokens and every utility the two packages share live in the',
  ' * components sheet and are deliberately not repeated here. Generated by',
  ' * packages/fields/scripts/build-css.mjs — do not edit.',
  ' */',
].join('\n');

export const builder = createPluginStylesheetBuilder({ postcss, tailwind });

export const buildOptions = {
  packageRoot: PACKAGE_ROOT,
  packageName: PACKAGE_NAME,
  mustSurvive: MUST_SURVIVE,
  classCeiling: CLASS_CEILING,
  header: HEADER,
};

if (isEntrypoint(import.meta.url)) {
  const { css, survivors, survivingClasses, droppedRules, droppedAtRules } =
    await builder.build(buildOptions);
  console.log(
    `✓ built dist/index.css (${(css.length / 1024).toFixed(2)} kB) — ` +
      `${survivors.size} rules kept (${survivingClasses.size} classes), ` +
      `${droppedRules} rules + ${droppedAtRules} at-rules already in @object-ui/components' sheet`,
  );
}
