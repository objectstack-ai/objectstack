// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7284] The `__` operation-private-key convention has exactly ONE owner.
 *
 * This is the pin the extraction is worth having. The three copies #7284 found
 * were byte-equivalent in behaviour and each was covered by its own package's
 * tests, so nothing in the repository went red while the rule was being copied
 * by hand a third time — the finding was made by a human reading three diffs
 * months apart. A fourth consumer is written the same way the first three were:
 * by opening the nearest existing one and copying the block out of it. Extracting
 * the helper without pinning it just resets that counter to one.
 *
 * So the assertion is about the SHAPE of the repository, not about behaviour: no
 * file outside this module may declare its own `OPERATION_PRIVATE_KEY_PREFIX` or
 * its own `withoutOperationPrivateKeys`. A fourth author who copies the block
 * turns this red the first time they run the suite, with a message naming the
 * import to use instead.
 *
 * ⛔ Scope, deliberately narrow — this pin does NOT try to detect "a consumer
 * that should have used the helper and did not". That is the interesting
 * question and it is not decidable by scanning: forwarding an envelope is
 * spelled a dozen ways, and a regex ambitious enough to catch them all would be
 * a false-red generator, which is worse than the gap (an inert or noisy gate
 * reads as a gate that is watching — `validate-security-posture.ts`'s hazard).
 * What IS decidable is redeclaration, which is exactly how all three copies got
 * here.
 *
 * Reworded freely: the pin matches DECLARATIONS, not mentions. Documentation,
 * comments and tests may name either symbol as much as they like.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
/** …/packages/core/src/security → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');
const PACKAGES = join(REPO_ROOT, 'packages');

/** The one file allowed to declare the convention. */
const HOME = join(HERE, 'operation-private-keys.ts');

/**
 * A DECLARATION of either symbol — `const OPERATION_PRIVATE_KEY_PREFIX =` or
 * `function withoutOperationPrivateKeys(`, with or without `export`.
 *
 * Anchored at a statement start so that imports (`import { … }`), re-exports
 * (`export { … } from`), calls and prose never match. Both spellings a copy
 * could plausibly take are covered: a `function` declaration is what all three
 * copies used, and `const … =` catches the arrow-function rewrite.
 */
const DECLARATION =
  /^\s*(?:export\s+)?(?:const|let|var|function)\s+(OPERATION_PRIVATE_KEY_PREFIX|withoutOperationPrivateKeys)\b\s*[=(<]/gm;

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', 'coverage', '.next']);

/** Every `.ts`/`.tsx` file under `packages/`, excluding build output. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

describe('the `__` operation-private-key convention has one owner (#7284)', () => {
  it('is declared in exactly one file, and that file is the shared home', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(PACKAGES)) {
      if (file === HOME) continue;
      const text = readFileSync(file, 'utf8');
      DECLARATION.lastIndex = 0;
      if (DECLARATION.test(text)) offenders.push(relative(REPO_ROOT, file));
    }

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : [
            'These files declare their own copy of the `__` operation-private-key convention:',
            ...offenders.map((f) => `  - ${f}`),
            '',
            'That rule has a single owner since #7284. Import it instead:',
            '',
            "  import { withoutOperationPrivateKeys } from '@objectstack/core';",
            '',
            'The reasoning — why a consumer must drop these keys, why by PREFIX and',
            'never by a name list, and why the copy is load-bearing in both',
            'directions — lives at packages/core/src/security/operation-private-keys.ts.',
            'If you are adding a consumer, add it to that header\'s "Known consumers"',
            'list rather than re-deriving the argument locally.',
          ].join('\n'),
    ).toEqual([]);
  });

  it('the home really does declare both symbols — the scan cannot pass vacuously', () => {
    // #4690: a check that finds nothing because it is looking in the wrong place
    // reads exactly like a check that found no violations. Anchor it.
    const text = readFileSync(HOME, 'utf8');
    const found = [...text.matchAll(DECLARATION)].map((m) => m[1]).sort();

    expect(found).toEqual(['OPERATION_PRIVATE_KEY_PREFIX', 'withoutOperationPrivateKeys']);
  });

  it('the scan reaches the packages that used to hold the copies', () => {
    // The second half of the same anti-vacuity guard: prove the walker actually
    // descends into the three consumer packages, so a future refactor of
    // SKIP_DIRS or the walk cannot silently narrow the scan to `packages/core`.
    const scanned = sourceFiles(PACKAGES).map((f) => relative(REPO_ROOT, f));

    for (const consumer of [
      'packages/plugins/plugin-audit/src/comment-access-hooks.ts',
      'packages/services/service-storage/src/attachment-access-hooks.ts',
      'packages/plugins/plugin-reports/src/report-service.ts',
    ]) {
      expect(scanned).toContain(consumer);
    }
  });
});
