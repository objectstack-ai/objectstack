/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { __unstable__loadDesignSystem } from 'tailwindcss';
import { headerColorClass, headerColorVocabulary } from '../headerColor';

/**
 * objectui#6178 — the CSS-GENERATION half of the fix.
 *
 * `DetailSection.headerColor.test.tsx` proves which class string reaches the
 * DOM. That is not the property this defect is about: the previous code put
 * `bg-<value>` in the DOM too, and a rendering assertion was green the whole
 * time it generated no CSS. Tailwind v4 emits a rule only when BOTH hold —
 *
 *   1. the class appears as a COMPLETE token in text the `@source` scan reads,
 *   2. the class is a utility the design system can actually build.
 *
 * so both are asserted here, against the two artifacts that decide them: the
 * module's own source text, and Tailwind's design system loaded on this
 * workspace's real `@theme`.
 *
 * What this file still cannot show: it does not run the scanner (that lives in
 * `@tailwindcss/oxide`, which this workspace does not declare at the root) and
 * it does not verify any app's `@source` globs. It asserts the token property
 * the scanner requires, on the file the globs cover.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const moduleSource = fs.readFileSync(path.join(here, '..', 'headerColor.ts'), 'utf8');
const callSiteSource = fs.readFileSync(path.join(here, '..', 'DetailSection.tsx'), 'utf8');

/** Every class the vocabulary can put in the DOM. */
const vocabularyClasses = Object.values(headerColorVocabulary);

/**
 * The workspace theme, as shipped. `@object-ui/components`' `index.css` is the
 * one `@theme` block every consuming app loads (see `skills/objectui/rules/
 * styling.md`), so a token this vocabulary spends has to be defined there —
 * `bg-accent` is not a stock Tailwind utility, it exists only because that
 * block defines `--color-accent`.
 */
function themeBlock(): string {
  const css = fs.readFileSync(path.join(repoRoot, 'packages/components/src/index.css'), 'utf8');
  const start = css.indexOf('@theme {');
  expect(start, 'components/src/index.css should declare a @theme block').toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('unterminated @theme block');
}

async function designSystem() {
  const twEntry = path.join(repoRoot, 'node_modules/tailwindcss/index.css');
  const twDir = path.dirname(fs.realpathSync(twEntry));
  return __unstable__loadDesignSystem(`@import "tailwindcss";\n${themeBlock()}\n`, {
    base: repoRoot,
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss'
        ? path.join(twDir, 'index.css')
        : id.startsWith('tailwindcss/')
          ? path.join(twDir, id.slice('tailwindcss/'.length))
          : path.resolve(base, id);
      return { base: path.dirname(file), path: file, content: fs.readFileSync(file, 'utf8') };
    },
  });
}

describe('headerColor — the resolver', () => {
  it('maps the two values the @object-ui/types mirror documents', () => {
    // These are the examples on `DetailViewSection.headerColor`. Both worked
    // before this module — by collision with other files' literal classes —
    // so the fix has to keep them working, not merely stop lying.
    expect(headerColorClass('muted')).toBe('bg-muted');
    expect(headerColorClass('primary/10')).toBe('bg-primary/10');
  });

  it('passes a value that is already a `bg-*` class through untouched', () => {
    expect(headerColorClass('bg-accent')).toBe('bg-accent');
    expect(headerColorClass('bg-[color:var(--brand)]')).toBe('bg-[color:var(--brand)]');
  });

  it('returns undefined rather than fabricating a class', () => {
    for (const input of [undefined, '', '   ', 'not-a-token', 'blue-100', 'muted-'])
      expect(headerColorClass(input)).toBeUndefined();
  });

  it('does not hand back an inherited Object.prototype member', () => {
    for (const input of ['constructor', 'toString', 'hasOwnProperty', '__proto__'])
      expect(headerColorClass(input)).toBeUndefined();
  });

  it('trims surrounding whitespace before looking up', () => {
    expect(headerColorClass('  muted  ')).toBe('bg-muted');
  });
});

describe('headerColor — (1) the scanner can extract every class it can emit', () => {
  it('the vocabulary is non-empty and every entry is a complete `bg-` class', () => {
    expect(vocabularyClasses.length).toBeGreaterThan(0);
    for (const cls of vocabularyClasses) {
      expect(cls.startsWith('bg-')).toBe(true);
      // A complete token, not a fragment awaiting concatenation.
      expect(cls).not.toMatch(/[${}`\s]/);
    }
  });

  it('every class appears VERBATIM in the module source the @source glob reads', () => {
    // This is the property the v4 extractor needs and the old code lacked.
    for (const cls of vocabularyClasses) expect(moduleSource).toContain(`'${cls}'`);
  });

  it('neither the module nor the call sites build a class by interpolation', () => {
    // The regression pin. `bg-` + an interpolation is never a complete token,
    // so it contributes nothing to the stylesheet — measured on the console
    // build, deleting the old expression left the compiled CSS byte-identical.
    // Scoped to the colour-utility prefixes: an interpolated React `key` or
    // DOM id is not this defect, and four of them live in sibling files here.
    const interpolatedUtility =
      /`(?:bg|text|border|ring|from|via|to|fill|stroke|shadow|outline|decoration|divide|placeholder)-\$\{/;
    for (const [name, src] of [['headerColor.ts', moduleSource], ['DetailSection.tsx', callSiteSource]] as const) {
      expect(src, `${name} must not interpolate a Tailwind class`).not.toMatch(interpolatedUtility);
    }
    // …and the call sites do go through the resolver, so the check above is
    // not passing because `headerColor` stopped being read at all.
    expect(callSiteSource.match(/headerColorClass\(section\.headerColor\)/g) ?? []).toHaveLength(2);
  });
});

describe('headerColor — (2) Tailwind emits a rule for every class it can emit', () => {
  it('the instrument answers NO for a non-utility (control)', async () => {
    const ds = await designSystem();
    // `bg-` is exactly what the extractor could take from the old template
    // literal, and it builds nothing — the defect, at the compiler.
    expect(ds.candidatesToCss(['bg-'])[0]).toBeNull();
    expect(ds.candidatesToCss(['bg-not-a-token'])[0]).toBeNull();
    expect(ds.candidatesToCss(['bg-mutedd'])[0]).toBeNull();
    // …and YES for a class this workspace's theme defines, so a green result
    // below means "emitted", not "instrument inert".
    expect(ds.candidatesToCss(['bg-muted'])[0]).toContain('background-color');
  });

  it('every vocabulary class builds against the shipped @theme', async () => {
    const ds = await designSystem();
    const built = Object.fromEntries(
      vocabularyClasses.map((cls) => [cls, ds.candidatesToCss([cls])[0]]),
    );
    for (const cls of vocabularyClasses) {
      expect(built[cls], `${cls} produced no CSS rule`).toBeTruthy();
      expect(built[cls]).toContain('background-color');
    }
  });
});
