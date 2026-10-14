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
 * Git answers a pathspec that matches nothing with nothing, at exit 0, so a
 * renamed root would silently cover nothing. Each root is therefore required to
 * exist as a directory (the `readdirSync` it replaces threw on a missing root
 * the same way), and any non-zero git exit throws with git's own message —
 * ⛔ never an empty answer, which would read as a clean tree.
 *
 * A path git lists that is gone from disk (a tracked file deleted in the work
 * tree, or one removed between the listing and the stat) cannot hold a
 * surviving reference, so it is left out; every other stat failure is
 * re-raised.
 *
 * The git child runs with `gitFreeEnv()` (scripts/git-env.mjs): under a git
 * hook the inherited `GIT_DIR` / `GIT_INDEX_FILE` outrank `cwd`, and the listing
 * must describe the checkout `repoRoot` names.
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
const GIT_VISIBLE_LISTING = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'] as const;

export interface RepoWalkOptions {
  /**
   * A directory BELOW a root whose subtree the walk never enters, judged by the
   * directory's own name at any depth — the filesystem walk's `SKIPPED_DIRS`
   * rule, unchanged. The root's own path segments are never judged.
   */
  skipDir?: (name: string) => boolean;
}

/**
 * Every file under `roots` that git does not ignore, as `/`-separated paths
 * relative to `repoRoot`, root by root, each root's files sorted.
 *
 * @param repoRoot the checkout's top level; every root is resolved against it.
 * @param roots repo-relative directories (`'content'`, `'packages/spec/src'`).
 */
export function listRepoWalkFiles(
  repoRoot: string,
  roots: readonly string[],
  options: RepoWalkOptions = {},
): string[] {
  const skipDir = options.skipDir ?? (() => false);
  const files: string[] = [];
  for (const root of roots) {
    const rootDir = path.join(repoRoot, root);
    if (!fs.statSync(rootDir).isDirectory()) {
      throw new Error(`listRepoWalkFiles: walk root '${root}' is not a directory under ${repoRoot}`);
    }
    const listing = spawnSync('git', [...GIT_VISIBLE_LISTING, '--', root], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: gitFreeEnv(),
      maxBuffer: 1 << 28,
    });
    if (listing.error) throw listing.error;
    if (listing.status !== 0) {
      throw new Error(
        `listRepoWalkFiles: \`git ${GIT_VISIBLE_LISTING.join(' ')} -- ${root}\` in ${repoRoot} exited ` +
          `${listing.status}: ${listing.stderr.trim()}`,
      );
    }
    const prefix = `${root.split(path.sep).join('/').replace(/\/+$/, '')}/`;
    const listed = [...new Set(listing.stdout.split('\0').filter(Boolean))].sort();
    for (const rel of listed) {
      if (!rel.startsWith(prefix)) {
        throw new Error(`listRepoWalkFiles: git listed '${rel}' for walk root '${root}', which does not contain it`);
      }
      if (rel.slice(prefix.length).split('/').slice(0, -1).some(skipDir)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(path.join(repoRoot, rel));
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
        throw err;
      }
      // `isFile()` is false for a symlink, as `Dirent.isFile()` was in the walk this replaces.
      if (stat.isFile()) files.push(rel);
    }
  }
  return files;
}
