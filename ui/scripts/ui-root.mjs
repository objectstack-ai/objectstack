// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ui-root -- the ONE answer to "where is the objectui tree?"
 *
 *   import { uiRoot } from '../scripts/ui-root.mjs';
 *   const README = path.join(uiRoot(), 'packages/core/README.md');
 *
 * ## Why a helper, and why it is anchored on THIS file
 *
 * objectui is being merged into the objectstack monorepo as `ui/` (objectstack
 * ruling D1, the parent epic of this change). Every script and test that found
 * "the repo root" by walking up to a marker -- `.git`, `pnpm-workspace.yaml`,
 * `git rev-parse --show-toplevel`, a find-up -- stops at the OBJECTSTACK root
 * there, not at the objectui tree: `.git` and `pnpm-workspace.yaml` live one
 * level up, and the nested `pnpm-workspace.yaml` is removed because a nested
 * workspace root is ignored. Measured on the merge spike: a test that joined
 * that root with `packages/core/...` read a directory that does not exist and
 * failed, and 71 files carried one of those lookups.
 *
 * This module's own location is the one fact that is true in both layouts: it
 * sits at `<objectui tree>/scripts/ui-root.mjs`, standalone or under `ui/`. So
 * the root is RESOLVED FROM THIS FILE, by one `..`, and never searched for.
 * Nothing here reads the filesystem, consults git, or looks at the cwd.
 *
 * ## The rule this backs
 *
 * `pnpm check:ui-root-lookups` (`scripts/check-ui-root-lookups.mjs`) refuses a
 * new marker-based root lookup outside this file; its header names the shapes.
 * Root `AGENTS.md`'s rule that a test roots a filesystem read on its OWN file,
 * never on `process.cwd()`, is unchanged -- this helper is rooted on a file
 * too, and `scripts/check-test-path-roots.mjs` classifies a read rooted on
 * `uiRoot()` as self-rooted for that reason.
 *
 * ⛔ Node builtins only: scripts that run BEFORE `pnpm install` may import this
 * (`scripts/check-pre-install-import-graph.mjs` holds that property).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the objectui tree: the directory that holds `scripts/`, `packages/` and `apps/`. */
export const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The objectui tree root, as an absolute path with no trailing separator.
 *
 * A function rather than only a constant so a call site reads as a lookup
 * (`uiRoot()`) and so a future need to validate the answer has one place to go.
 */
export function uiRoot() {
  return UI_ROOT;
}
