/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Pins the SOURCE SET of `@object-ui/runner`'s stylesheet (objectui#8454).
 *
 * This package is `private: false` with `files: ["dist"]`, so `src/index.css`
 * compiles into bytes a consumer installs. Two things about it went wrong at
 * once, and neither one produced any error at build time:
 *
 *  1. every `@source` path named a directory that does not exist. Tailwind
 *     resolves a relative `@source` against `dirname(<entry css>)` — here
 *     `packages/runner/src/` — so `./src/**` meant `packages/runner/src/src`
 *     and `../../packages/<pkg>/src` meant `packages/packages/<pkg>/src`. A
 *     glob whose base is missing scans nothing and is not an error: deleting
 *     all five lines was measured byte-identical to keeping them.
 *  2. nothing excluded test files. What kept the sheet non-empty was Tailwind's
 *     automatic source detection, which roots at the PROCESS CWD (`base`
 *     defaults to `process.cwd()`), i.e. `packages/runner` when `pnpm build`
 *     runs — so runner's own tests were scanned and shipped, down to ordinary
 *     English words picked out of prose comments.
 *
 * ## Why a naive assertion passes while broken
 *
 * "The published sheet contains no test-sourced class" is satisfied perfectly
 * by a sheet compiled from NOTHING — which is exactly the state defect (1) put
 * this package in for the four sibling trees. So the negative assertion below
 * is paired with a positive one that a sheet compiled from nothing fails: a
 * themed utility that ONLY `@object-ui/components`' shipped source can supply.
 * And the negative is not a bare absence either — it is a DIFFERENCE against a
 * second compile of the same entry with the `@source not` lines stripped, so an
 * exclusion that silently stopped matching anything fails here rather than
 * passing quietly.
 *
 * ## Why it compiles instead of reading `dist/`
 *
 * CI runs the suite on an unbuilt worktree, so `dist/` is legitimately absent
 * and a test that read the artifact would pass vacuously — the same reasoning
 * `scripts/__tests__/plugin-published-stylesheet.test.ts` records. It runs the
 * real `@tailwindcss/postcss` over the real entry instead, with `base` pinned
 * to the package root so the automatic-detection root is the one `pnpm build`
 * uses no matter which directory the suite was launched from.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindPostcss from '@tailwindcss/postcss';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `packages/runner` — what `process.cwd()` is when this package builds. */
const PACKAGE_ROOT = resolve(HERE, '../..');
const ENTRY = resolve(PACKAGE_ROOT, 'src/index.css');
const ENTRY_DIR = dirname(ENTRY);

const entryCss = readFileSync(ENTRY, 'utf8');

/**
 * Class names in a compiled selector, undoing Tailwind's CSS escapes.
 * Mirrors `classesIn` in `scripts/build-plugin-stylesheet.mjs`; not imported
 * from there because the root tsconfig sets `allowJs: false`, so a `.ts` test
 * under `packages/` cannot pull in a plain `.mjs` helper.
 */
function classesIn(selector: string): string[] {
  const found: string[] = [];
  const re = /\.((?:\\.|[^\s.,>+~()[\]:#*'"\\])+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(selector))) {
    found.push(
      m[1]
        .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) =>
          String.fromCodePoint(parseInt(hex, 16)),
        )
        .replace(/\\(.)/g, '$1'),
    );
  }
  return found;
}

/**
 * Compile the entry the way this package's build does. `base` is the
 * automatic-detection root and defaults to `process.cwd()` — pinning it to the
 * package root is what makes this reading independent of where vitest started
 * (from the repo root the same bytes scan the whole monorepo instead).
 */
async function compileClasses(css: string, base: string = PACKAGE_ROOT): Promise<Set<string>> {
  const result = await postcss([tailwindPostcss({ base })]).process(css, {
    from: ENTRY,
  });
  const classes = new Set<string>();
  postcss.parse(result.css, { from: ENTRY }).walkRules((rule) => {
    for (const selector of rule.selectors) for (const cls of classesIn(selector)) classes.add(cls);
  });
  return classes;
}

/** `@source` / `@source not` directives, in file order, params unquoted. */
function sourceDirectives(css: string): { negated: boolean; pattern: string }[] {
  const out: { negated: boolean; pattern: string }[] = [];
  for (const line of css.split('\n')) {
    const m = /^@source\s+(not\s+)?['"](.+)['"]\s*;/.exec(line.trim());
    if (m) out.push({ negated: Boolean(m[1]), pattern: m[2] });
  }
  return out;
}

/** The literal directory prefix of a glob — everything before the first `*`. */
function globBase(pattern: string): string {
  const star = pattern.indexOf('*');
  const literal = star === -1 ? pattern : pattern.slice(0, star);
  return resolve(ENTRY_DIR, literal.replace(/\/[^/]*$/, ''));
}

// Cost paid at import time on purpose: module evaluation is bound by no test or
// hook timeout, and each compile is ~0.6s. AGENTS.md's testing-discipline
// section is explicit that a `beforeAll` would be the WORSE place for it:
// `hookTimeout` (10s) is narrower than `testTimeout` (15s).
const shipped = await compileClasses(entryCss);
const withTestSources = await compileClasses(
  entryCss
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('@source not '))
    .join('\n'),
);

describe('@object-ui/runner published stylesheet — source set', () => {
  it('resolves every @source path to a directory that exists', () => {
    const directives = sourceDirectives(entryCss);
    // Non-vacuity: the check above is trivially satisfied by a file with no
    // `@source` at all, which is the shape this card had to rule out.
    expect(directives.filter((d) => !d.negated).length).toBeGreaterThanOrEqual(5);

    const missing = directives
      .map((d) => ({ ...d, base: globBase(d.pattern) }))
      .filter((d) => !existsSync(d.base));
    expect(missing).toEqual([]);
  });

  it('the historical spellings really did point at nothing (control)', () => {
    // Without this, the assertion above could be green because every path
    // resolves to the package dir by accident rather than by being correct.
    expect(existsSync(resolve(ENTRY_DIR, 'src'))).toBe(false);
    expect(existsSync(resolve(ENTRY_DIR, '../../packages/components/src'))).toBe(false);
  });

  it('compiles utilities that only a dependency can supply', () => {
    // `bg-popover` is used by ten shipped files under `packages/components/src`
    // (popover, dropdown-menu, tooltip, select, …) and by nothing in this
    // package's own `src`. It can therefore only come from the
    // `../../components/src/**` line, and it is absent the moment that line
    // stops resolving — which is what shipped before objectui#8454.
    expect(shipped).toContain('bg-popover');
    expect(readFileSync(resolve(PACKAGE_ROOT, 'src/LayoutRenderer.tsx'), 'utf8')).not.toContain(
      'bg-popover',
    );
    // Lit control for the two assertions above: a class this package's OWN
    // source supplies, so a compile that produced nothing cannot pass either.
    expect(shipped).toContain('flex-col');
  });

  it('keeps test-sourced classes out of the published sheet', () => {
    // `paused` reaches the candidate list only as an English word inside a
    // prose comment in `packages/components/src/__tests__/`. It is a real
    // Tailwind utility (`animation-play-state: paused`), so without the
    // exclusions it compiles into bytes every consumer downloads.
    expect(withTestSources).toContain('paused');
    expect(shipped).not.toContain('paused');

    // And the exclusions must still be subtracting something at all: an
    // `@source not` that quietly stopped matching would otherwise leave every
    // assertion in this file green.
    const removed = [...withTestSources].filter((cls) => !shipped.has(cls));
    expect(removed.length).toBeGreaterThan(0);
    expect([...shipped].filter((cls) => !withTestSources.has(cls))).toEqual([]);
  });

  it('compiles the same classes from the package root as from an empty directory — no class comes from prose (objectui#11586)', async () => {
    // `base` only changes what Tailwind's automatic detection scans. If the
    // sheet is the same when detection would root at an empty directory, the
    // `@source` lines supply every class, and this package's `CHANGELOG.md`,
    // which `pnpm changeset:version` writes changeset prose into, adds none.
    // Before `source(none)` it added `flex-shrink-0` and `isolate` on `main`,
    // and on the 17.7.0 release head also `paused`, `invert` and `flex-nowrap`.
    const empty = mkdtempSync(join(tmpdir(), 'objectui-11586-'));
    try {
      const fromEmpty = await compileClasses(entryCss, empty);
      // CONTROL: comparing two empty compiles proves nothing.
      expect(fromEmpty.has('bg-popover')).toBe(true);
      expect([...shipped].filter((cls) => !fromEmpty.has(cls)).sort()).toEqual([]);
      expect([...fromEmpty].filter((cls) => !shipped.has(cls)).sort()).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("does not compile a class that only this package's CHANGELOG names", () => {
    // CONTROL: the door must still exist. `CHANGELOG.md` is append-only, so the
    // entry announcing the `flex-shrink-0` → `shrink-0` rename keeps naming it.
    // If this goes red, re-point the probe at a token the file still carries.
    // Do not delete it.
    expect(readFileSync(resolve(PACKAGE_ROOT, 'CHANGELOG.md'), 'utf8')).toContain('flex-shrink-0');
    // The deprecated Tailwind v3 alias. No shipped source emits it, and it was
    // in this sheet only because detection read that changelog entry.
    expect(shipped.has('flex-shrink-0')).toBe(false);
  });
});
