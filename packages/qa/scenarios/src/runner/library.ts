// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where the runner reads the open card library from: this repository's
 * `docs/qa/scenarios/` when it runs from a checkout, or the copy the published
 * package carries when it runs from npm (`npx @objectstack/scenarios run`).
 *
 * The package build copies the open library, and only it, into
 * `dist/library/` with the repository's layout (`scripts/pack-library.mjs`):
 * `dist/library/docs/qa/scenarios/*.json` and
 * `dist/library/docs/qa/platform-checklist/areas/*.json`. So the root either
 * answer names reads the same relative paths, and `libraryOf` judges a
 * `--cards` directory against the open library of THAT root: the shipped copy
 * is `open`, any other directory the private overlay.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { OPEN_LIBRARY_DIR } from '../loader.js';

/** The capability-area closed set, relative to a library root. */
export const CAPABILITY_AREAS_DIR = 'docs/qa/platform-checklist/areas';

/** The package directory the published copy of the open library lives under. */
export const PACKED_LIBRARY_DIR = 'dist/library';

const PACKAGE_NAME = '@objectstack/scenarios';
/** Where this package sits in the repository. */
const PACKAGE_IN_REPO = 'packages/qa/scenarios';

export interface LibraryRoot {
  /** The directory `docs/qa/scenarios` and `docs/qa/platform-checklist/areas` are read under. */
  root: string;
  /** `true` in a repository checkout; `false` when the package was installed from npm. */
  checkout: boolean;
}

function packageRoot(from: string): string {
  for (let dir = resolve(from); ; ) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name === PACKAGE_NAME) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`no ${PACKAGE_NAME} package.json above ${from}`);
    dir = up;
  }
}

/**
 * The library root for code running at `from` (a directory inside this
 * package). A checkout is recognised by the package sitting at
 * `packages/qa/scenarios` of a pnpm workspace that holds the open library, so
 * an install of the package inside some other workspace is never read as one.
 */
export function locateLibraryRoot(from: string): LibraryRoot {
  const pkg = packageRoot(from);
  const repo = resolve(pkg, '../../..');
  if (
    existsSync(join(repo, 'pnpm-workspace.yaml')) &&
    existsSync(join(repo, OPEN_LIBRARY_DIR)) &&
    existsSync(join(repo, PACKAGE_IN_REPO)) &&
    realpathSync(join(repo, PACKAGE_IN_REPO)) === realpathSync(pkg)
  ) {
    return { root: repo, checkout: true };
  }
  const root = join(pkg, PACKED_LIBRARY_DIR);
  if (!existsSync(join(root, OPEN_LIBRARY_DIR))) {
    throw new Error(`${PACKAGE_NAME} at ${pkg} carries no card library (${PACKED_LIBRARY_DIR}/${OPEN_LIBRARY_DIR}): reinstall the package, or build it in a checkout`);
  }
  return { root, checkout: false };
}
