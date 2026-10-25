/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The seam half of objectui#7472: `@object-ui/cli` GENERATES code that imports
 * this package's icon seam, and nothing else can notice when that breaks.
 *
 * `packages/cli/src/utils/app-generator.ts` emits a `src/Layout.tsx` into the
 * user's application. Since objectui#7472 that file writes
 *
 *     import { …, LazyIcon, isLucideIconName } from '@object-ui/components';
 *
 * instead of rolling its own lucide lookup, which is what objectui#5935's
 * ruling requires of every container — verbatim and untranslated, because the
 * wording is the operative clause:
 *
 *     「本裁定后新容器 ⛔ 不得再自带解析器,一律走 seam」
 *
 * WHY THE TEST IS HERE AND NOT THERE. Two constraints meet:
 *
 *  1. The generated app's own `tsc` run cannot judge this import. Nothing
 *     installs the temp app's dependencies, so `@object-ui/*` does not resolve
 *     and those diagnostics are deliberately exempt (see the type-check gate's
 *     header in `packages/cli/src/__tests__/app-generator.test.ts`). A rename
 *     here would sail through it.
 *  2. The CLI's test file may not import this package by its specifier.
 *     `@object-ui/cli` declares `@object-ui/components` as a RUNTIME dependency
 *     for a reason no scanner can see, and that reason is carried by a
 *     `DECLARED_WITHOUT_IMPORT` row in `scripts/check-unused-dependencies.mjs`;
 *     a package import from the CLI's own `src/` would make the row stale and
 *     erase the only written record of why the declaration is not a
 *     devDependency.
 *
 * ⇒ The names cross the package boundary as DATA. The list below is pinned
 * identically in `app-generator.test.ts` ("names exactly the icons the seam-side
 * contract test puts through the seam"), so the two cannot drift apart in
 * silence: whichever side moves first goes red naming the other.
 *
 * ⛔ This file does not widen `scripts/check-lucide-icon-record-names.mjs`, and
 * nothing here argues that it should. The generated template sits outside that
 * census by construction — it is emitted from inside a template literal, it
 * used a namespace import, and its lookup base was a property access — so its
 * absence from `DECLARED_RECORD_READERS` was correct rather than a miss. The
 * template was the thing that diverged, and it is the thing that moved.
 */
import { describe, expect, it } from 'vitest';

// Through the package's PUBLIC entry, which is the surface the generated app
// gets — never `../lib/lazy-icon`, which would pass on a seam that had stopped
// re-exporting either name.
import { isLucideIconName, LazyIcon, getLazyIcon } from '../index';

/**
 * Every icon name the CLI's routed fixture authors in its `app.json`, in order.
 * Pinned identically in `packages/cli/src/__tests__/app-generator.test.ts`.
 */
const AUTHORED_BY_CLI_FIXTURE = ['Flame', 'House', 'Users', 'List'];

/** Every icon name the generated `src/Layout.tsx` hardcodes in the template itself. */
const HARDCODED_BY_CLI_TEMPLATE = ['ChevronRight'];

describe('the icon seam the CLI generates code against', () => {
  it('exports the two names the generated layout imports', () => {
    expect(typeof isLucideIconName).toBe('function');
    expect(typeof LazyIcon).toBe('function');
    // `getLazyIcon` is the third public spelling of the same seam. It is not
    // what the generated layout uses, and pinning it here is deliberate: it
    // keeps this file a statement about the SEAM's public surface rather than
    // about one caller's two imports.
    expect(typeof getLazyIcon).toBe('function');
  });

  it('resolves every icon name the CLI fixture authors', () => {
    // Non-empty guard: a silently emptied list would satisfy the loop below
    // without resolving anything.
    expect(AUTHORED_BY_CLI_FIXTURE).toHaveLength(4);
    for (const name of AUTHORED_BY_CLI_FIXTURE) {
      expect(isLucideIconName(name), `authored icon ${name} does not resolve`).toBe(true);
    }
  });

  it('resolves every icon name the CLI template hardcodes', () => {
    expect(HARDCODED_BY_CLI_TEMPLATE).toHaveLength(1);
    for (const name of HARDCODED_BY_CLI_TEMPLATE) {
      expect(isLucideIconName(name), `hardcoded icon ${name} does not resolve`).toBe(true);
    }
  });

  it('really rejects, so the assertions above are readings rather than a yes-machine', () => {
    // CONTROL, known direction, HITS in this same run.
    expect(isLucideIconName('NotAnIconAnywhere')).toBe(false);
    expect(isLucideIconName('')).toBe(false);
    expect(isLucideIconName(undefined)).toBe(false);
  });

  it('keeps the canonical PascalCase spellings the pre-fix lookup accepted', () => {
    // The migration reading, and it is NOT the one objectui#7472's triage
    // predicted. The replaced lookup indexed lucide's named-export NAMESPACE,
    // so its vocabulary was "every export key"; the seam accepts
    // `toKebabIconName(name)`. The feared "a generated app that relies on bare
    // PascalCase loses its icons" is therefore false for the CANONICAL
    // PascalCase spellings — converting exactly those is what the tokeniser is
    // for.
    for (const name of ['Flame', 'House', 'Users', 'List', 'ChevronRight', 'ChevronsUpDown']) {
      expect(isLucideIconName(name), name).toBe(true);
    }
  });

  it('additionally accepts the kebab spelling the namespace index rejected', () => {
    // The direction the change BUYS, and the point of having one vocabulary:
    // `lucideIcons['chevron-right']` was `undefined`, so the kebab spelling
    // every other container in this platform accepts rendered nothing in a
    // generated app and rendered fine everywhere else.
    for (const name of ['chevron-right', 'house', 'flame']) {
      expect(isLucideIconName(name), name).toBe(true);
    }
  });

  it('does NOT accept lucide alias spellings, which is where the change narrows', () => {
    // Measured, not assumed, and pinned because it is the migration note the
    // change owes its readers. lucide's namespace exports each icon three ways
    // — `House`, `HouseIcon`, `LucideHouse`. Only the canonical one is an
    // `icons` key, so the alias spellings resolved in a generated app and
    // nowhere else in the platform. Aligning the template is what removes them.
    for (const alias of ['HouseIcon', 'LucideHouse']) {
      expect(isLucideIconName(alias), alias).toBe(false);
    }
  });

  it('accepts the digit-suffixed canonical spellings, which were never an alias case', () => {
    // objectui#9414 corrected this file's OWN reading. `Building2` sat in the
    // list above as though it were a fourth alias shape, and it never was: it
    // is the PascalCase component lucide exports for the canonical key
    // `building-2`, exactly as `House` is for `house`. What rejected it was
    // this seam's tokeniser, which split `lower-or-digit -> Upper` and
    // `acronym-run -> Word` and never `letter -> digit` — so `Building2`
    // became `building2`, matched no canonical name, and a generated app
    // authoring the spelling lucide's own site shows got the `Database` glyph
    // with no error, no warning and no log.
    //
    // ⚠ The two facts this file already had were both true and the WRONG
    // conclusion was drawn from them: the alias spellings really did resolve
    // only in a generated app, and `Building2` really did resolve there too.
    // The first is a narrowing the migration owes its readers; the second was
    // a defect on this side of the seam, wearing the first one's clothes.
    //
    // ⛔ Nothing about the alias narrowing above moved. `HouseIcon` and
    // `LucideHouse` are still out, and still for the reason stated there.
    for (const canonical of ['Building2', 'Grid2x2', 'BarChart3']) {
      expect(isLucideIconName(canonical), canonical).toBe(true);
    }
  });
});
