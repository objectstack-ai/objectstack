/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5817 — `AppSidebar` is gone from `@object-ui/app-shell`, and the
 * package entry does not export it.
 *
 * ## Why it went
 *
 * Nothing in this repository mounted it: `ConsoleLayout` renders
 * `UnifiedSidebar`. objectui#5720 censused its consumers, found none visible
 * in this org, and deprecated it rather than deleting it, because the package
 * is public on npm. The maintainer then ruled that the removal need not wait
 * for a major release, on the condition that the console's function is not
 * affected; the console never rendered this component.
 *
 * ## ⚠ WHAT THIS FILE CANNOT ASSERT — read before adding a case here
 *
 * A SOURCE SCAN, in the shape of `rootLandingHasOneResolver-10042.test.ts`. It
 * proves the component file is absent and that neither barrel between the
 * component and the package entry names it in code. It does not read the
 * built `dist/index.d.ts`: the build is not a test prerequisite here, and a
 * stale `dist/` would answer for a tree that no longer exists.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

/**
 * Comments are dropped before scanning, for the reason the #7256 and #10042
 * scans give: prose may name a removed component while explaining why it is
 * gone, and a rule that forbids that only pressures the next author to delete
 * the explanation.
 */
const stripComments = (src: string): string => mask(src);

/** The removed component, in code, in any position. */
const REMOVED = /\bAppSidebar\b/;

/** The sidebar this package still publishes, which is the control's subject. */
const SURVIVING = /\bUnifiedSidebar\b/;

const COMPONENT = 'packages/app-shell/src/layout/AppSidebar.tsx';
const SURVIVING_COMPONENT = 'packages/app-shell/src/layout/UnifiedSidebar.tsx';

/** Both hops between the component and `@object-ui/app-shell`'s entry. */
const BARRELS = ['packages/app-shell/src/layout/index.ts', 'packages/app-shell/src/index.ts'] as const;

describe('objectui#5817 — AppSidebar is removed from @object-ui/app-shell', () => {
  it('the component source file is gone', () => {
    expect(existsSync(path.join(repoRoot, COMPONENT))).toBe(false);
  });

  it.each(BARRELS)('%s does not export AppSidebar', (barrel) => {
    expect(stripComments(read(barrel))).not.toMatch(REMOVED);
  });

  it('CONTROL — the same reader finds the sidebar this package DOES publish', () => {
    // Without this, a path that resolved nowhere, or a `maskComments` that
    // started returning '', would pass every absence above as a scan of nothing.
    expect(existsSync(path.join(repoRoot, SURVIVING_COMPONENT))).toBe(true);
    for (const barrel of BARRELS) {
      expect(stripComments(read(barrel))).toMatch(SURVIVING);
    }
  });
});
