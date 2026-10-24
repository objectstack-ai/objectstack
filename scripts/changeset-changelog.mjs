// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// changeset-changelog (#25638) -- the changelog generator `.changeset/config.json`
// names: `@changesets/cli/changelog`'s own lines, with each entry's commit read
// by `createChangelogAttribution` in scripts/release-pending-publish.mjs.
//
// The stock generator stamps an entry with the newest commit that added its
// changeset file. A revert of a version commit re-adds every changeset that cut
// consumed, so after a re-cut every entry names the revert: 260 of the 265
// entries in 18.1.0's CHANGELOGs open `- 3937697:`, the commit of #25605. Here
// an add that restores the bytes an earlier commit deleted is passed over, and
// the entry names the commit that first added the changeset.
//
// Nothing else moves: the line format is the stock generator's, and whatever
// the attribution cannot decide keeps the stock commit with a `::warning::`.
// The pins live in `node scripts/release-pending-publish.mjs --self-test`,
// which lint.yml runs: an add -> version -> revert -> re-cut fixture through
// these two functions.

import stock from '@changesets/cli/changelog';
import { createChangelogAttribution } from './release-pending-publish.mjs';

/** The two functions `changeset version` calls, attributing from the repository at `cwd`. */
export function changelogFunctions(options = {}) {
  const attribute = createChangelogAttribution({ cwd: process.cwd(), ...options });
  const attributed = (changeset) => ({ ...changeset, commit: attribute(changeset) });
  return {
    getReleaseLine: (changeset, type, opts) => stock.getReleaseLine(attributed(changeset), type, opts),
    getDependencyReleaseLine: (changesets, dependenciesUpdated, opts) =>
      stock.getDependencyReleaseLine(changesets.map(attributed), dependenciesUpdated, opts),
  };
}

export default changelogFunctions();
