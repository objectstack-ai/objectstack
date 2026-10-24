/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Builds `dist/index.css` for `@object-ui/plugin-kanban` — the CSS half of this
 * package's `build` script, run after `vite build`.
 *
 * All of the reasoning lives in two places and neither is repeated here:
 * `src/index.css`'s header explains the narrow `@reference` shape, and
 * `scripts/build-plugin-stylesheet.mjs` at the repository root explains the
 * subtraction and the assertions that guard it (objectui#4929). This file holds
 * only what is specific to THIS package.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

import { isEntrypoint } from '../../../scripts/invoked-as.mjs';
import { createPluginStylesheetBuilder } from '../../../scripts/build-plugin-stylesheet.mjs';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_NAME = '@object-ui/plugin-kanban';

/**
 * Utilities that MUST survive the subtraction, spanning both reasons a rule can
 * be plugin-only.
 *
 * The first three resolve `@theme` tokens `@object-ui/components` declares but
 * does not publish, so this build is the only producer they can ever have — if
 * the subtraction over-reaches, these are what silently disappear, and no test
 * that renders a board in this repo would notice (every in-repo host compiles
 * this package's source directly and never loads this sheet). The last three are
 * plain utilities that simply are not in components' sheet.
 *
 * Deliberately a handful of named specimens, not a count: a threshold would have
 * to be re-tuned every time a card renderer gains a class, and the edit that
 * silences a real regression would look exactly like the edit that keeps it
 * current.
 */
export const MUST_SURVIVE = [
  'bg-muted/10',
  'bg-card/60',
  'shadow-primary/25',
  'cursor-grabbing',
  '[writing-mode:vertical-rl]',
  'snap-mandatory',
];

/**
 * Leak ceiling, not a budget. Measured on this card: 50 classes survive the
 * subtraction; a lost `source(none)` would put it in the thousands.
 */
export const CLASS_CEILING = 600;

export const builder = createPluginStylesheetBuilder({ postcss, tailwind });

export const buildOptions = {
  packageRoot: PACKAGE_ROOT,
  packageName: PACKAGE_NAME,
  mustSurvive: MUST_SURVIVE,
  classCeiling: CLASS_CEILING,
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
