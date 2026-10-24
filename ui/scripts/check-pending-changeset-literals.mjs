#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-pending-changeset-literals -- a test's source may not NAME a pending
 * release declaration that `.changeset/` currently carries.
 *
 *   node scripts/check-pending-changeset-literals.mjs          # scan the tree
 *   node scripts/check-pending-changeset-literals.mjs --json   # the same reading as JSON
 *
 * Exit: 0 = the intersection is empty
 *       1 = at least one test source names a declaration the tree carries
 *
 * ## The hazard (objectui#9583, out of the ruling on objectui#9472)
 *
 * `scripts/markdown-test-inputs.mjs` resolves markdown path literals out of
 * every test's source and offers the ones that EXIST in the tree. A literal
 * naming a PENDING declaration therefore becomes a candidate, gets adjudicated
 * into that file's ledger, and then `pnpm changeset:version` deletes exactly
 * those files. On the post-version tree the scanner stops offering the
 * document, the ledger line it was written into turns into a finding, and
 * `Validate the post-version tree` reds on the scheduled `Changeset Release`
 * lane.
 *
 * ⭐ Why that needs a gate of its own rather than a repair each time: the
 * instrument that notices lives on a POST-VERSION tree, which exists nowhere
 * except inside that scheduled job. Every ordinary check is green while the
 * literal is being written, because the file it names is sitting right there;
 * the signal arrives days later, in a lane whose failure blocks the version
 * pull request's refresh rather than anything on the author's page. Two suites
 * had done it, and the repairs (objectui#9582 and the sibling work on
 * objectui#9617 / objectui#9602) are one-at-a-time fixes for a rule nothing
 * held.
 *
 * ## What this asks, and why the population is exactly the right one
 *
 * The question is a total predicate on the PRE-version tree, from two things it
 * can both see: the `.changeset/` directory, and the markdown literals the
 * scanner resolves out of test sources. Their intersection must be empty.
 *
 * ⭐ The literals come from `deriveCandidates()` in
 * `scripts/markdown-test-inputs.mjs` rather than from a second scanner written
 * here, and that is correctness rather than thrift. The hazard runs THROUGH
 * that scanner: a literal it cannot resolve never becomes a ledger entry and so
 * can never go stale. Asking it is therefore the pre-version image of the very
 * instrument that reds post-version, and the two cannot drift apart. A
 * re-implementation would have to be kept equal to it by hand, and the day it
 * stopped being equal this gate would go quiet while the release lane kept
 * failing.
 *
 * A consequence worth stating rather than discovering: the scanner's blind
 * spots are this gate's blind spots. A literal inside a comment (the scanner
 * masks comments first), one assembled from a variable, or one carrying an
 * interpolation is invisible here -- and invisible to the hazard, for the same
 * reason.
 *
 * ## ⛔ What this gate does NOT claim
 *
 * ⛔ It does not claim that every finding it prints would, today, red the
 * post-version tree. A document covered by a ledger CLASS entry (`.changeset/**`
 * -- a test that walks the whole directory) produces no audit finding when the
 * file disappears, because the entry names a rule and not a file. The rule is
 * nonetheless the rule: whether a literal is absorbed that way is a property of
 * the LEDGER LINE BESIDE THE TEST, not of the test, and it can change without
 * the test being touched. A gate that asked the narrower question would have to
 * read the ledger's adjudication to decide, and would go quiet the moment
 * somebody re-adjudicated the test for unrelated reasons.
 *
 * ⛔ It does not see a name that is not in `.changeset/` TODAY. A test literal
 * spelling a declaration that lands next week becomes a finding on the pull
 * request that ADDS the declaration, not on the one that wrote the literal.
 * That is the predicate the hazard has -- the file has to exist for the scanner
 * to offer it -- and the reason a test fixture should spell a name neither
 * namespace a committed declaration comes from can produce (`pnpm changeset`
 * generates `adjective-animal-verb`; this repository commits an
 * issue-number-and-slug name, the convention `.changeset/README.md` states).
 *
 * ## `.changeset/README.md` is not a declaration
 *
 * It is documentation, `changeset version` never consumes it, and tests name it
 * legitimately. The exclusion is the one `NOT_A_CHANGESET` the four sibling
 * `.changeset/` gates already share, imported rather than spelled a fifth time
 * -- `check-changeset-overwrite.mjs`'s header carries the measured reason this
 * repository imports such predicates instead of copying them.
 *
 * ## Where it runs
 *
 * `scripts/__tests__/check-pending-changeset-literals.test.ts` runs it over the
 * real tree, so the ordinary vitest suite is the blocking copy -- the placement
 * `check-installed-spec-pin-claims.mjs` and `doc-version-claims.test.ts`
 * already have, and for the same reason: this reads the tree, needs no install,
 * no build and no base ref, so a dedicated workflow would buy a second thing to
 * keep wired and nothing else.
 *
 * ⭐ The two pull-request shapes that can make the intersection non-empty both
 * reach that suite, and neither leg is assumed here -- the test pins them:
 *
 *   a change to a TEST SOURCE   `packages/**`, `scripts/**` and the other scan
 *                               roots are not on the `Decide whether this
 *                               change needs a full run` exclusion list, so the
 *                               shards run.
 *   a change that ADDS a        `.changeset/**` IS on that exclusion list, and
 *   DECLARATION                 the second stage rescues it: the same
 *                               `markdown-test-inputs.mjs` answers that a test
 *                               reads it, and the shards run.
 *
 * `pnpm check:pending-changeset-literals` is the human entry point.
 */

import path from 'node:path';

import { NOT_A_CHANGESET } from './check-changeset-presence.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { REPO_ROOT, deriveCandidates } from './markdown-test-inputs.mjs';

/** The directory `pnpm changeset` writes into and `changeset version` empties. */
export const CHANGESET_DIR = '.changeset';

/**
 * Is this repository-relative path a PENDING release declaration — one
 * `changeset version` consumes and deletes?
 *
 * `.changeset/README.md` is documentation and survives every release, so naming
 * it is not the hazard; the shared `NOT_A_CHANGESET` is what says so.
 */
export function isPendingDeclaration(relative) {
  const normalised = relative.split(path.sep).join('/');
  if (!normalised.startsWith(`${CHANGESET_DIR}/`)) return false;
  const name = normalised.slice(normalised.lastIndexOf('/') + 1);
  return name.endsWith('.md') && !NOT_A_CHANGESET.has(name);
}

/**
 * Every `{ test, document }` pair where a test source names a declaration the
 * tree currently carries. Empty is the passing answer.
 */
export function findings({ root = REPO_ROOT } = {}) {
  const out = [];
  for (const [test, { documents }] of deriveCandidates({ root })) {
    for (const document of documents) {
      if (isPendingDeclaration(document)) out.push({ test, document });
    }
  }
  return out.sort((a, b) => a.test.localeCompare(b.test) || a.document.localeCompare(b.document));
}

function report(found) {
  if (found.length === 0) {
    console.log('✅  No test source names a pending changeset.');
    console.log(
      `    Asked of every markdown literal \`scripts/markdown-test-inputs.mjs\` resolves out of a test source.`,
    );
    return 0;
  }

  console.error('❌  A test source names a PENDING changeset:\n');
  for (const { test, document } of found) console.error(`    • ${test}\n        names ${document}`);
  console.error(`
\`pnpm changeset:version\` DELETES that file. The scanner in
scripts/markdown-test-inputs.mjs offers only documents that exist, so the
literal becomes a ledger entry on the pre-version tree and the entry has
nothing to resolve to on the post-version one — \`Validate the post-version
tree\` reds on the scheduled Changeset Release lane, days later, in a job no
reader of a pull request sees.

Fix: spell a name no committed declaration can wear. \`pnpm changeset\`
generates \`adjective-animal-verb\` and this repository commits an
issue-number-and-slug name (see .changeset/README.md), so a \`fixture-\` prefix
belongs to neither namespace — and if the assertion routes by path PREFIX, the
basename carries no meaning at all.
`);
  return 1;
}

function main(argv = process.argv.slice(2)) {
  const found = findings();
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ findings: found }, null, 2));
    return found.length === 0 ? 0 : 1;
  }
  return report(found);
}

// Only run when invoked as a script — the test imports the predicates above.
if (isEntrypoint(import.meta.url)) {
  process.exit(main());
}
