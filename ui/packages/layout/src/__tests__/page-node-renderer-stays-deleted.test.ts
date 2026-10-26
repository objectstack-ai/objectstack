/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/layout` has no page-node renderer — the tombstone for
 * objectui#3223.
 *
 * The `page` key belongs to `@object-ui/components`'s `PageRenderer`: it is the
 * one that understands page types (record/home/app/utility), named regions and
 * `PageVariablesProvider`. This package carried a second renderer for the same
 * node (`Page`, renamed `PageNodeRenderer` in objectui#3161 / objectstack#4115
 * batch 7) that was registered nowhere and imported by nothing — reachable only
 * as a public export. Deleted under ADR-0049 (enforce-or-remove).
 *
 * Why a test and not just the deletion: what made the dead renderer expensive
 * was never its behaviour — it had none, nothing called it — but the claim its
 * mere presence made. A reader (or an AI author) who greps `PageNodeRenderer`
 * and finds it exported from `@object-ui/layout` reasonably concludes that this
 * package is where page rendering lives, and wires a second implementation of a
 * key that already has an owner. Re-adding the export is a one-line change and
 * looks like filling a gap; this file is what turns it into a red test naming
 * the decision to reverse first.
 *
 * Scope, stated honestly: this is a SOURCE-level ban inside this package, not a
 * proof about the composed registry. It cannot tell you which renderer wins at
 * runtime — `packages/components`' own registration tests own that question.
 * What it pins is that `@object-ui/layout` does not re-enter the race.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** `packages/layout/src` — one level up from `src/__tests__`. */
const SRC = resolve(__dirname, '..');

/** Source files that legitimately discuss the removal (this file, and the
 *  barrel's note explaining why `page` is not registered here). */
const MAY_MENTION = new Set([
  '__tests__/page-node-renderer-stays-deleted.test.ts',
  '__tests__/spec-symbol-batch7.test.ts',
  'index.ts',
]);

/** Every `.ts`/`.tsx` under `src/`, relative to `src/`. */
function sourceFiles(dir = SRC, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return sourceFiles(join(dir, entry.name), rel);
    return /\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

describe('the layout page-node renderer stays deleted (objectui#3223)', () => {
  it('has no `./Page` module', () => {
    expect(existsSync(join(SRC, 'Page.tsx'))).toBe(false);
    expect(existsSync(join(SRC, 'Page.ts'))).toBe(false);
  });

  it('does not re-export it from the package barrel', () => {
    const barrel = readFileSync(join(SRC, 'index.ts'), 'utf8');
    expect(barrel).not.toMatch(/export\s+\*\s+from\s+['"]\.\/Page['"]/);
    // …nor under a named re-export. The barrel's prose may still explain the
    // removal (it does); only an `export { … }` naming it is banned.
    expect(barrel).not.toMatch(/export\s*(type\s*)?\{[^}]*\bPageNodeRenderer\b/);
  });

  it('does not register the `page` key — that owner is @object-ui/components', () => {
    const barrel = readFileSync(join(SRC, 'index.ts'), 'utf8');
    // `page:card` is this package's own key and stays (the `page-header` alias
    // was retired by objectui#10859 batch 8).
    expect(barrel).not.toMatch(/ComponentRegistry\.register\(\s*['"]page['"]/);
  });

  it('leaves no source file naming the removed component', () => {
    const offenders = sourceFiles()
      .filter((file) => !MAY_MENTION.has(file))
      .filter((file) => /\bPageNodeRenderer\b/.test(readFileSync(join(SRC, file), 'utf8')));

    expect(offenders).toEqual([]);
  });
});
