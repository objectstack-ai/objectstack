/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `src/index.css` must not scan this package's own TEST files (objectui#8446),
 * nor its own PROSE (objectui#9569).
 *
 * ## What was wrong
 *
 * Tailwind v4 scans source TEXT, not an import graph. `src/index.css` declared
 * `@source '../src/**' + '/*.{ts,tsx}'` with no exclusion, so every one of the
 * 243 test files under `src/**' + '/__tests__/` was a source for the PUBLISHED
 * `dist/index.css`. A class-shaped token written as a test's expected value —
 * even one sitting in a prose comment — therefore compiled a real utility into
 * the shipped bundle, which means a test could create the very production
 * utility it was asserting on. Measured on #8435: `.\32 xl\:grid-cols-6` was
 * in the sheet with the UNFIXED renderer, sourced entirely from assertion
 * strings.
 *
 * ## The instrument
 *
 * A sentinel token that exists nowhere else in the repository, written in THIS
 * file — which lives under `__tests__/` and is therefore exactly the kind of
 * file the exclusion must keep out of the scan. If the exclusions are removed,
 * this file becomes a source, the sentinel compiles, and the negative
 * assertion below goes red. The probe is live only because it is self-hosted:
 * it does not depend on any other test continuing to name a fixture class.
 *
 * ## Why the positive assertion is not optional
 *
 * "No test-sourced rules" is satisfied by a stylesheet compiled from NOTHING —
 * an implementation strictly worse than the fix (delete the `@source` line
 * outright) would pass a negative-only test. The positive half pins a
 * production-sourced utility and a floor on the rule count, so an empty or
 * gutted sheet fails.
 *
 * ## Why `base` is still passed explicitly
 *
 * It no longer has to be. `src/index.css` used to open with a bare
 * `@import 'tailwindcss'`, leaving automatic source detection ON and rooted at
 * the PROCESS CWD: vitest runs from the repo root while `pnpm build` runs from
 * this package directory, and the two compiled different stylesheets from the
 * same bytes. That entry now carries `source(none)` (objectui#9569), so nothing
 * is detected automatically and this reading is CWD-independent by construction
 * -- `base` governs only the automatic root, never the `@source` lines, which
 * resolve against the entry stylesheet's own directory. It is kept because it
 * costs nothing and still pins this reading to the directory the build runs in
 * if that entry ever loses the `source(none)`.
 *
 * ## The prose half (objectui#9569)
 *
 * Automatic detection scanned every non-ignored file in the package, so class
 * names quoted in `CHANGELOG.md`, `README.md` and the docs beside the renderers
 * compiled into the published sheet. `changeset:version` writes changeset bodies
 * into `CHANGELOG.md`, which made that a live channel from a release note into
 * `dist/index.css` -- and, through the plugin builders' subtraction, out of the
 * sibling packages' sheets. The second test below pins the door shut with its
 * own lit control, because a negative assertion about a token nothing mentions
 * any more would pass for the wrong reason.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindPostcss from '@tailwindcss/postcss';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const entry = resolve(packageRoot, 'src/index.css');

/**
 * Deliberately absent from every other file in the repository, and an
 * arbitrary-value utility so no production source can ever legitimately name
 * it. Its ONLY occurrence is this line, in a file under `__tests__/`.
 */
const SENTINEL = 'mt-[3.7331px]';

/**
 * The part of the sentinel that Tailwind's selector escaping leaves alone
 * (`.mt-\[3\.7331px\]` escapes the brackets and the dot, never the digits).
 * Asserting on THIS rather than on a hand-escaped selector is what keeps the
 * negative assertion from passing for the wrong reason.
 */
const SENTINEL_VALUE = '3.7331px';

/**
 * Named by this package's `CHANGELOG.md` and by no shipped source in it. Under
 * the pre-objectui#9569 entry this compiled a real rule into `dist/index.css`.
 */
const PROSE_ONLY_CLASS = 'flex-shrink-0';

async function compilePublishedStylesheet(): Promise<{
  css: string;
  selectors: Set<string>;
}> {
  const source = await readFile(entry, 'utf8');
  const result = await postcss([tailwindPostcss({ base: packageRoot })]).process(source, {
    from: entry,
  });
  const selectors = new Set<string>();
  postcss.parse(result.css, { from: entry }).walkRules((rule) => {
    selectors.add(rule.selector);
  });
  return { css: result.css, selectors };
}

describe('packages/components/src/index.css @source scan', () => {
  it('does not compile tokens that only test files name, and still compiles shipped ones', async () => {
    const { css, selectors } = await compilePublishedStylesheet();

    // POSITIVE — a sheet compiled from nothing must not pass.
    expect(selectors.has('.flex-col')).toBe(true);
    expect(selectors.size).toBeGreaterThan(800);

    // NEGATIVE — this file is scanned only if the exclusions are gone.
    expect(SENTINEL).toContain(SENTINEL_VALUE);
    expect(css).not.toContain(SENTINEL_VALUE);
  }, 60_000);

  it("does not compile a class that only this package's CHANGELOG prose names", async () => {
    const changelog = await readFile(resolve(packageRoot, 'CHANGELOG.md'), 'utf8');

    // CONTROL — the door this asserts is shut must still exist. `CHANGELOG.md`
    // is append-only, so an entry that once named this class keeps naming it; if
    // this ever goes red the probe needs re-pointing at a token the file does
    // carry, NOT deleting.
    expect(changelog).toContain(PROSE_ONLY_CLASS);

    // `flex-shrink-0` is the deprecated Tailwind v3 alias this repo migrated
    // away from, so no shipped source emits it — compiling it would not merely
    // be waste, it would be wrong. The only reason it was ever in the published
    // sheet is the changelog entry announcing that migration.
    const { css, selectors } = await compilePublishedStylesheet();
    expect(selectors.has(`.${PROSE_ONLY_CLASS}`)).toBe(false);
    expect(css).not.toContain(`.${PROSE_ONLY_CLASS}`);
  }, 60_000);
});
