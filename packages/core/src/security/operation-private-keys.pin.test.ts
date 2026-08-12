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
 *
 * ── [#7706] Why the scan surface is git's and not `readdirSync`'s ─────────────
 *
 * This pin used to crawl `packages/` with `readdirSync`/`statSync` and skip a
 * hand-maintained denylist (`node_modules`, `dist`, `build`, `.turbo`,
 * `coverage`, `.next`). That crawl was wrong in two ways that only showed up
 * inside merge-queue builds, where the suite runs concurrently with a full
 * monorepo build rather than against a quiet checkout:
 *
 *  1. NONDETERMINISM. The denylist was never exhaustive against what a build
 *     actually deposits. `check:skill-examples` extracts every marked prose code
 *     block verbatim into `packages/spec/.examples-build/*.ts` — under
 *     `packages/`, matching `.ts`, and in none of the six skipped names. Any
 *     docs or skill example that *shows* the convention therefore became a
 *     transient offender, and whether the pin saw it depended purely on how the
 *     vitest shard interleaved with that gate. Same tree, different verdict.
 *
 *  2. COST. The crawl read all ~3,600 `.ts` files under `packages/` and ran the
 *     regex on each — ~355ms on an idle machine, under vitest's DEFAULT 5s
 *     timeout. On a queue runner busy with a full build that overran, and the
 *     observed failure was `Error: Test timed out in 5000ms` with NO offender
 *     list: the assertion never ran at all, so the pin reported nothing about
 *     the property it guards while taking unrelated PRs out of the batch.
 *
 * Both are fixed by asking git for the candidate set instead of the filesystem.
 * The surface is now tracked files PLUS untracked ones, with ignored paths
 * excluded (`--others --exclude-standard` / `--untracked`) — i.e. exactly the
 * files a human authored, never build output, because build output is ignored
 * by construction. That deliberately does NOT narrow to tracked-only: the
 * docblock above promises a fourth author goes red "the first time they run the
 * suite", and a file they have written but not yet `git add`ed is untracked.
 * Tracked-only would defer that to commit time — and since PR CI runs only the
 * affected subset, a new consumer outside `packages/core` would not go red until
 * the merge queue, the most expensive place to find out. `--untracked` keeps the
 * local-loop promise intact while still excluding the build output that caused
 * (1).
 *
 * `git grep` is a PREFILTER, never the verdict. It searches for the two
 * identifiers as FIXED STRINGS, which is a provably exact superset of what
 * `declarationMatcher()` can match (the regex cannot match text that lacks the literal
 * identifier), so no judgement moves into git's regex dialect — the JS regex
 * below remains the sole authority on what counts as a declaration. Reading only
 * the handful of files that mention a symbol, rather than all ~3,600, is also
 * what removes the timeout exposure: one `git grep` process instead of ~3,600
 * sequential `readFileSync` round-trips, which is the part that degrades
 * non-linearly when a runner is I/O-saturated.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
/** …/packages/core/src/security → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');

/** git speaks repo-relative POSIX paths; match it so the two sets compare. */
const toRepoPath = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

/** The one file allowed to declare the convention. */
const HOME = toRepoPath(join(HERE, 'operation-private-keys.ts'));

/** The two guarded identifiers, as data — naming them cannot declare them. */
const PREFIX_SYMBOL = 'OPERATION_PRIVATE_KEY_PREFIX';
const HELPER_SYMBOL = 'withoutOperationPrivateKeys';

/**
 * A DECLARATION of either symbol — `const OPERATION_PRIVATE_KEY_PREFIX =` or
 * `function withoutOperationPrivateKeys(`, with or without `export`.
 *
 * Anchored at a statement start so that imports (`import { … }`), re-exports
 * (`export { … } from`), calls and prose never match. Both spellings a copy
 * could plausibly take are covered: a `function` declaration is what all three
 * copies used, and `const … =` catches the arrow-function rewrite.
 *
 * The statement anchor is also why this very file — which quotes both spellings
 * in its docblock and passes both to `git grep` below — is not its own offender:
 * a docblock line begins with ` * `, and a string-literal or regex-source line
 * begins with something other than `const`/`let`/`var`/`function` followed by a
 * guarded name. That property is load-bearing, so it is asserted rather than
 * trusted — see the last test.
 *
 * Returned as a FRESH regex per call, never shared. A `/g` regex carries
 * `lastIndex` across calls, so one shared instance makes the result depend on
 * the order files happen to come back in: after a successful `.test()` on the
 * home file, a later `matchAll` on the same pattern silently resumes from the
 * middle of the text and reports one declaration instead of two. That is the
 * same species of order-dependent verdict this file exists to eliminate, so it
 * is designed out rather than reset around.
 */
const declarationMatcher = (): RegExp =>
  /^\s*(?:export\s+)?(?:const|let|var|function)\s+(OPERATION_PRIVATE_KEY_PREFIX|withoutOperationPrivateKeys)\b\s*[=(<]/gm;

/**
 * Generous on purpose (#7706). The scan costs tens of milliseconds, so this is
 * not a budget — it is headroom against a merge-queue runner that is doing a
 * full monorepo build at the same time. The default 5s was the whole failure:
 * the pin timed out before the assertion ran, and a pin that reports nothing is
 * indistinguishable from a pin that found nothing.
 */
const SCAN_TIMEOUT_MS = 60_000;

function git(args: string[]): string[] {
  let stdout: string;
  try {
    stdout = execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    });
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    // `git grep` exits 1 for "found nothing", which is data. Anything else is a
    // BROKEN scan, and must not be allowed to read as "no offenders" — throwing
    // here, plus the anti-vacuity tests below, is what keeps a green result
    // meaning "looked and found nothing" rather than "never looked".
    if (failure.status === 1) return [];
    throw new Error(
      `git ${args.join(' ')} failed with status ${String(failure.status)}: ${failure.stderr ?? ''}`,
    );
  }
  return stdout.split('\0').filter((line) => line.length > 0);
}

const isScannedSource = (path: string) => /\.tsx?$/.test(path) && !path.endsWith('.d.ts');

/**
 * The scan surface: every `.ts`/`.tsx` file under `packages/` that a human
 * authored — tracked plus untracked, ignored paths (build output) excluded.
 */
function scannedFiles(): string[] {
  return git([
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    'packages',
  ]).filter(isScannedSource);
}

/**
 * The subset of the scan surface that so much as mentions either identifier.
 * Fixed-string, so it is an exact superset of `declarationMatcher()`'s matches; the regex
 * still decides which of these — if any — is an actual declaration.
 */
function filesMentioningASymbol(): string[] {
  return git([
    'grep',
    '--files-with-matches',
    '-z',
    '--untracked',
    '--text',
    '--fixed-strings',
    '-e',
    PREFIX_SYMBOL,
    '-e',
    HELPER_SYMBOL,
    '--',
    'packages',
  ]).filter(isScannedSource);
}

function declaringFiles(): string[] {
  return filesMentioningASymbol().filter((file) =>
    declarationMatcher().test(readFileSync(join(REPO_ROOT, file), 'utf8')),
  );
}

describe('the `__` operation-private-key convention has one owner (#7284)', () => {
  it(
    'is declared in exactly one file, and that file is the shared home',
    () => {
      const offenders = declaringFiles().filter((file) => file !== HOME);

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
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'the home really does declare both symbols — the scan cannot pass vacuously',
    () => {
      // #4690: a check that finds nothing because it is looking in the wrong
      // place reads exactly like a check that found no violations. Anchor it at
      // both stages, because since #7706 there are two places the scan can go
      // silently blind: the git prefilter can fail to reach the home file at
      // all, and the regex can fail to match it.
      expect(filesMentioningASymbol()).toContain(HOME);

      // Deliberately AFTER a full scan, not before: this is the regression pin
      // for the shared-`lastIndex` trap described on `declarationMatcher`. With
      // one shared `/g` regex, whether this sees two declarations or one depends
      // on where HOME fell in the scan order — green today, red the day a
      // package is added after it. It must be indifferent to that.
      declaringFiles();

      const text = readFileSync(join(REPO_ROOT, HOME), 'utf8');
      const found = [...text.matchAll(declarationMatcher())].map((m) => m[1]).sort();

      expect(found).toEqual([PREFIX_SYMBOL, HELPER_SYMBOL].sort());
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'the scan reaches the packages that used to hold the copies',
    () => {
      // The second half of the same anti-vacuity guard: prove the scan actually
      // descends into the three consumer packages, so a future refactor of the
      // scan surface cannot silently narrow it to `packages/core`.
      const scanned = scannedFiles();

      for (const consumer of [
        'packages/plugins/plugin-audit/src/comment-access-hooks.ts',
        'packages/services/service-storage/src/attachment-access-hooks.ts',
        'packages/plugins/plugin-reports/src/report-service.ts',
      ]) {
        expect(scanned).toContain(consumer);
      }

      // Every file the prefilter surfaces must be one the enumerated surface
      // covers. If the two ever disagree — different pathspec, different ignore
      // rules — the pin would be judging a set it does not enumerate, and this
      // is the only place that would say so.
      const surface = new Set(scanned);
      expect(filesMentioningASymbol().filter((f) => !surface.has(f))).toEqual([]);
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'this pin quotes both symbols without declaring them',
    () => {
      // The docblock names both spellings in prose and passes both to `git grep`
      // as string literals, so this file is always in the prefilter's output. It
      // must never be in the offender list. Asserting it makes the "statement
      // anchor" claim above executable: loosen the matcher into something that
      // matches mentions and this goes red immediately, rather than the pin
      // quietly reporting itself and training everyone to ignore it.
      const self = toRepoPath(fileURLToPath(import.meta.url));

      expect(filesMentioningASymbol()).toContain(self);
      expect(declaringFiles()).not.toContain(self);
    },
    SCAN_TIMEOUT_MS,
  );
});
