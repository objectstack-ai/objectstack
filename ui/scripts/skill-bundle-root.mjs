// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * skill-bundle-root -- the ONE answer to "which directory are `skills/objectui/...`
 * labels relative to?"
 *
 *   import { SKILL_BUNDLE, skillBundleBase } from './skill-bundle-root.mjs';
 *   const base = skillBundleBase(root);                     // root, or the monorepo root above it
 *   const guide = readFileSync(join(base, `${SKILL_BUNDLE}/rules/protocol.md`), 'utf8');
 *
 * ## Why
 *
 * The published objectui skill bundle was `skills/objectui/` in this tree. At the
 * cutover it moves into the objectstack monorepo's published catalog, the
 * workspace root's `skills/` (decision C, objectstack#25752 item 17d; moved by
 * objectstack#25803), one level above this tree. Every reader here still names
 * the bundle's files `skills/objectui/...`; that label is now relative to the
 * monorepo root rather than to `uiRoot()`. This module decides which.
 *
 * ## The rule
 *
 *   `root` itself when `<root>/skills/objectui` exists: a fixture that writes the
 *   bundle into a scratch root, or a tree that still carries it. Else the PARENT
 *   when `<parent>/skills/objectui` exists: the monorepo. Else `root`, so the
 *   reader's own empty-population refusal still names the path it expected.
 *
 * The probe is a directory under a root already known, never a marker search, so
 * `scripts/check-ui-root-lookups.mjs` does not judge it.
 *
 * ⛔ Node builtins only, like `ui-root.mjs`.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { uiRoot } from './ui-root.mjs';

/** The bundle's directory, as every reader spells its labels. */
export const SKILL_BUNDLE = 'skills/objectui';

/**
 * The directory `SKILL_BUNDLE` labels are relative to, for a reader rooted at `root`.
 *
 * @param {string} [root] the reader's own root (`uiRoot()` unless a fixture hands one in)
 * @returns {string}
 */
export function skillBundleBase(root = uiRoot()) {
  if (existsSync(path.join(root, SKILL_BUNDLE))) return root;
  const parent = path.dirname(root);
  if (existsSync(path.join(parent, SKILL_BUNDLE))) return parent;
  return root;
}

/**
 * The absolute path of a repo-relative label: a `skills/objectui/...` label from
 * `skillBundleBase(root)`, every other label from `root`.
 *
 * @param {string} root
 * @param {string} label
 * @returns {string}
 */
export function labelPath(root, label) {
  const base = label === SKILL_BUNDLE || label.startsWith(`${SKILL_BUNDLE}/`) ? skillBundleBase(root) : root;
  return path.join(base, label);
}

/**
 * The walk a reader of this tree's `skills/` directory makes: the directory, and
 * the base its labels are relative to.
 *
 * Here `skills/` held the bundle and nothing else, so walking it walked the
 * bundle. The monorepo's `skills/` is the whole published catalog, every
 * objectstack skill beside this one, so there the walk narrows to the bundle.
 *
 * @param {string} [root]
 * @returns {{ dir: string, base: string }}
 */
export function skillsWalk(root = uiRoot()) {
  const base = skillBundleBase(root);
  return base === root
    ? { dir: path.join(root, 'skills'), base: root }
    : { dir: path.join(base, SKILL_BUNDLE), base };
}
