// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * repo-walk-testkit.ts — the file list a repo-radius tree walk reads.
 *
 * The retirement pins in `src/` end in a "tree-scoped absence" leg: they walk
 * whole repo roots (`packages`, `examples`, `skills`, `content`, `scripts`, or
 * a subset) and fail on any surviving reference to what was retired. Each one
 * used to walk the FILESYSTEM with its own `readdirSync` recursion, so it read
 * whatever happened to be on disk — including generated output that `.gitignore`
 * keeps out of git, and that CI's checkout therefore never holds.
 *
 * ## The measured wrong answer this closes
 *
 * `@objectstack/docs`' build runs `gen:upgrade-guide`, which writes the
 * protocol upgrade guide into `content/docs/protocol-upgrade/` (gitignored). The
 * guide names the keys and defs a major retired, because that is its job. On a
 * checkout that had built the docs, four walks went red on that page with no
 * source file wrong — `api/export-job-family-retirement`,
 * `system/compliance-families-retirement`,
 * `integration/connector-connection-timeout-retirement` and
 * `data/currency-mode-family-closure.pin` (its rule B) — while CI stayed green
 * over the same commit. The single-file copy the publish lane writes,
 * `packages/spec/protocol-upgrade-guide.md` (gitignored too), reddened three of
 * the same four the same way. A local verdict that differs from CI's costs a dev
 * a round chasing a defect that does not exist.
 *
 * ## The reading: what git does not ignore
 *
 * `git ls-files --cached --others --exclude-standard` — every tracked file, plus
 * every untracked file that is NOT ignored. That is exactly what `git add -A`
 * would commit, so it is exactly what can reach CI:
 *
 *   - a tracked file is listed whatever `.gitignore` says (CI checks it out);
 *   - a new file not yet added is still listed, so a dev's own fresh page is
 *     judged before it is pushed, as it was by the filesystem walk;
 *   - generated, gitignored output is never listed — the upgrade guide's pages,
 *     its single-file copy, `json-schema/`, tsup's `*.bundled_*.mjs`, and
 *     whatever the next generator writes under an ignored path — with no list
 *     of names here to keep in step with `.gitignore`. `.gitignore` is the one
 *     register of "generated, not authored", and turbo's input hashing already
 *     reads the tree through it, so the walk and its cache key now agree.
 *
 * ⛔ It narrows and never widens: each caller's `skipDir` rule (its old
 * `SKIPPED_DIRS`, plus dot-directories where it skipped those) still applies to
 * every directory below a root, so a tracked file the filesystem walk never
 * entered stays out. Measured at `cb9841aa2` over the five-root radius, on a
 * built checkout: the git reading added 0 files and dropped 1,537, every one
 * ignored (`packages/spec/json-schema/` and the generated migration registry).
 *
 * ## Loud, never empty
 *
 * An empty listing reads as a clean tree, so nothing here may produce one by
 * accident: the walked directory must exist as a directory (the `readdirSync`
 * it replaces threw on a missing root the same way, and a renamed root must not
 * quietly cover nothing), and any non-zero git exit — outside a checkout, or a
 * `.git` pointing nowhere — throws with git's own message. ⛔ Never an empty
 * answer in place of an error.
 *
 * A path git lists that is gone from disk (a tracked file deleted in the work
 * tree, or one removed between the listing and the stat) cannot hold a
 * surviving reference, so it is left out; every other stat failure is
 * re-raised.
 *
 * The git child runs with `gitFreeEnv()` (scripts/git-env.mjs): under a git
 * hook the inherited `GIT_DIR` / `GIT_INDEX_FILE` outrank `cwd`, and the listing
 * must describe the checkout the walked directory lies in.
 *
 * It lives in `scripts/lib/` for the reason `export-origins-testkit.ts` records:
 * the BUILD config compiles `src/` as CommonJS, and a shared test helper there
 * would enter the emitting program. The pin is `repo-walk-testkit.test.ts`.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { gitFreeEnv } from '../../../../scripts/git-env.mjs';

/** Tracked files, plus untracked files git does not ignore — what `git add -A` would commit. */
const GIT_VISIBLE_LISTING = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];

export interface RepoWalkOptions {
  /**
   * A directory BELOW the walked directory whose subtree the walk never enters,
   * judged by the directory's own name at any depth — the filesystem walk's
   * `SKIPPED_DIRS` rule, unchanged. The walked directory's own path is never judged.
   */
  skipDir?: (name: string) => boolean;
}

/**
 * Every file below `dir` that git does not ignore, as absolute paths in the
 * order of their path below `dir` — the files a `readdirSync` descent from
 * `dir` would reach, minus what `.gitignore` keeps out of git.
 *
 * Takes ONE directory, the way the descent it replaces did, so a caller keeps
 * its `for (const root of WALK_ROOTS)` loop over `path.join(REPO_ROOT, root)`:
 * that is the spelling `check:cross-package-test-inputs` folds into the walked
 * roots it holds against the declared globs.
 */
export function listRepoWalkFiles(dir: string, options: RepoWalkOptions = {}): string[] {
  const skipDir = options.skipDir ?? (() => false);
  if (!fs.statSync(dir).isDirectory()) {
    throw new Error(`listRepoWalkFiles: ${dir} is not a directory`);
  }
  // With `cwd` inside the checkout and no pathspec, git lists the subtree below
  // `cwd`, each path relative to it.
  const listing = spawnSync('git', GIT_VISIBLE_LISTING, {
    cwd: dir,
    encoding: 'utf8',
    env: gitFreeEnv(),
    maxBuffer: 1 << 28,
  });
  if (listing.error) throw listing.error;
  if (listing.status !== 0) {
    throw new Error(
      `listRepoWalkFiles: \`git ${GIT_VISIBLE_LISTING.join(' ')}\` in ${dir} exited ` +
        `${listing.status}: ${listing.stderr.trim()}`,
    );
  }
  const files: string[] = [];
  for (const rel of [...new Set(listing.stdout.split('\0').filter(Boolean))].sort()) {
    if (rel.split('/').slice(0, -1).some(skipDir)) continue;
    const full = path.join(dir, rel);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(full);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
      throw err;
    }
    // `isFile()` is false for a symlink and for a nested repository's directory
    // entry, as `Dirent.isFile()` was in the walk this replaces.
    if (stat.isFile()) files.push(full);
  }
  return files;
}
