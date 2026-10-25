#!/usr/bin/env node
/**
 * The convention for how this repository spells a GitHub Action reference, and
 * the gate that keeps the odd one out visible.
 *
 *   Run:  node scripts/check-action-ref-convention.mjs
 *         node scripts/check-action-ref-convention.mjs --list   # the census
 *   Exit: 0 = OK, 1 = an undeclared off-convention ref, a stale exception, or a
 *         collapsed census
 *
 * ## THE CONVENTION
 *
 * **Default spelling: a floating major tag, `owner/action@vN`.** Every `uses:`
 * in `.github/workflows/**` is written that way unless it is a declared
 * exception.
 *
 * **An exception is marked by an entry in `DECLARED_EXCEPTIONS` below**, keyed
 * by workflow file and action path, carrying a reason and the issue that owns
 * it. That is the ONLY form an exception takes here. Nothing else counts — in
 * particular a trailing `# v9.0.0`-style comment beside the ref is a version
 * HINT, not a reason, and this gate does not read it as one.
 *
 * ## WHY THE EXCEPTION MECHANISM IS THE POINT, NOT THE DEFAULT
 *
 * objectui#8465. On `origin/main` there were 13 distinct action references.
 * Exactly ONE was spelled differently from the other twelve — a commit SHA on
 * `actions/stale` — and it was the only reference in the repository that had
 * never resolved. 236 scheduled runs of the stale-issues workflow since
 * 2026-01-16, 0 successes, every one of them failing in `Set up job`. Eight
 * months, silent, because nothing downstream consumes that job (the broken ref
 * itself was objectui#8126).
 *
 * That workflow is GONE — objectui#8548 retired it under enforce-or-remove
 * rather than repairing it (a declared automation with zero consumers and zero
 * successes), and objectui#8126 closed with it. Its entry left this table in
 * the same commit, because rule 2 below would otherwise have turned the
 * deletion into a red `main`. ⛔ The convention did NOT leave with it: it was
 * never about that one reference, and the next off-convention ref is what it
 * exists to make loud.
 *
 * ⛔ The finding is NOT "SHA pinning is wrong". It is normally the MORE secure
 * spelling and supply-chain guidance recommends it; whether this repository
 * should move to it wholesale is a live question and a decision of its own, not
 * something this gate answers or forecloses. The finding is the SOLE INSTANCE:
 * one reference written in a form nothing else in the tree used, with no
 * convention that would have made it stand out and nothing verifying it.
 *
 * The asymmetry is the whole mechanism. A floating tag that stops resolving is
 * loud on the next run of every workflow that uses it. A lone off-convention ref
 * that never resolved is silent for as long as nobody happens to look. So the
 * durable fix is not a spelling — it is that deviating from the spelling now
 * requires an edit to THIS file, with a reason and an issue number, reviewed
 * like any other change.
 *
 * ## WHY THE DEFAULT IS THE FLOATING MAJOR TAG
 *
 * Because that is what the tree already is: 12 of the 13 refs, and the repo's
 * one deliberately reasoned per-ref pin (`changesets/action@v1`, held there by
 * `scripts/__tests__/changeset-release-action-ref-pin.test.ts` against two
 * properties of v1's source) is itself a tag. Declaring it costs nothing, moves
 * no reference, and closes no door: a later decision to pin everything to SHAs
 * changes the constant below and empties the exception table, and it would need
 * this same exception mechanism anyway.
 *
 * ⛔ Do NOT read this default as a ruling against SHA pinning, and ⛔ do not
 * "unify" the tree in either direction by editing refs under cover of this
 * gate. Changing the repository's pinning posture is a supply-chain decision
 * that belongs on its own card (objectui#8465 triage, 2026-09-08).
 *
 * ## WHAT THIS GATE DOES NOT DO
 *
 * It checks SPELLING, not resolvability. A SHA that points at no commit and a
 * SHA that points at a real one are indistinguishable from here — resolving
 * either needs the network. That is deliberate and it is not the hole this
 * closes: what failed in objectui#8465 was that the odd ref had no reason
 * attached and no second instance to compare against, and both of those are
 * checkable offline. A declared exception still has to be correct; the gate only
 * guarantees that someone wrote down why it exists.
 *
 * ## THE THREE WAYS THIS GATE GOES RED
 *
 *   1. An off-convention ref with no entry in `DECLARED_EXCEPTIONS`.
 *   2. An entry in `DECLARED_EXCEPTIONS` that matches nothing any more. An
 *      escape hatch nobody removes is how a baseline turns into a permanent
 *      skip-list — the same staleness check `DOCUMENTATION_EXEMPT` and
 *      `KNOWN_OFFENDERS` carry elsewhere in this repository.
 *   3. The census collapsing. A parser that stops finding refs reports a clean
 *      tree, which is the one way a scan like this lies. Floors below.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/** The declared default: a floating major tag, `@v` followed by digits only. */
export const DEFAULT_SPELLING = /^v\d+$/;

/** Human-readable name for the default, used in the failure text. */
export const DEFAULT_SPELLING_LABEL = 'a floating major tag (@vN)';

/**
 * `workflow file + action path -> why this ref is spelled differently`.
 * Each entry is one deliberate deviation, argued where it was added.
 *
 * ⛔ Adding an entry here is the deliberate, reviewable act that objectui#8465
 * found missing. Every entry needs a real reason and the issue that owns it —
 * "it was like that already" is not a reason, it is the defect.
 *
 * The test below rejects an entry that no longer matches an off-convention ref,
 * so this table cannot rot into a permanent skip-list. That is not theory: the
 * first entry this table held named `stale.yml :: actions/stale`, and when
 * objectui#8548 deleted that workflow the entry stopped matching anything.
 * Leaving it would have made every pull request red on a `main` nobody broke,
 * so it went in the deletion's own commit — which is exactly the rule working.
 *
 * ⚠️ An entry is matched by workflow and action, NOT by spelling: this gate
 * cannot tell one off-convention spelling of a declared action from another, so
 * whatever an entry's reason says about the spelling (a sha, never a branch) is
 * held by a pin of its own or by nothing. The `half-state-patrol.yml` entry's is
 * held in `scripts/__tests__/ci-cd-pipeline-doc.test.ts`. The gate's red
 * branches are pinned over synthetic tables in
 * `scripts/__tests__/check-action-ref-convention.test.ts`, so they do not depend
 * on what this table holds.
 */
export const DECLARED_EXCEPTIONS = [
  {
    workflow: 'half-state-patrol.yml',
    action: 'objectstack-ai/objectstack/.github/actions/half-state-patrol',
    issue: 'objectui#11174',
    reason:
      "objectstack's composite half-state patrol, pinned to a 40-character objectstack commit sha " +
      'and never a branch or tag, by the ruling on objectstack-ai/objectstack#18471 that every ' +
      'sibling board calls the action at a sha. The runner places the whole objectstack ' +
      'repository at the referenced commit, so the pin freezes the sweeper with the action at one ' +
      'reviewed moment; a floating ref would re-adopt every upstream change on the next scheduled ' +
      'run, with nothing in this repository to roll back to.',
  },
  // The four below share one reason, said once: each is a third-party action
  // that runs holding a credential, so the code a floating tag resolves to
  // would receive that credential on the next run after the tag moved, with
  // nothing here reviewing it. A commit sha cannot move; the trailing
  // `# vX.Y.Z` comment names the release it is. First-party `actions/*` refs
  // stay on the floating-tag default.
  {
    workflow: 'changeset-release.yml',
    action: 'changesets/action',
    issue: 'objectui#13430',
    reason:
      'runs with NPM_TOKEN and GITHUB_TOKEN in the publish and version-PR steps; pinned to the ' +
      'v1.9.0 commit, the one the workflow comment and the ref-pin test say both v1 properties ' +
      'were read at (scripts/__tests__/changeset-release-action-ref-pin.test.ts holds the sha).',
  },
  {
    workflow: 'check-links.yml',
    action: 'lycheeverse/lychee-action',
    issue: 'objectui#13430',
    reason:
      'receives GITHUB_TOKEN through its env and its token input default; pinned to the v2.9.0 ' +
      'commit so the link checker cannot change under that token between reviews.',
  },
  {
    workflow: 'dependabot-auto-merge.yml',
    action: 'dependabot/fetch-metadata',
    issue: 'objectui#13430',
    reason:
      'receives GITHUB_TOKEN as its github-token input in a job that approves and enqueues ' +
      'Dependabot pull requests; pinned to the v3.1.0 commit.',
  },
  {
    workflow: 'changelog.yml',
    action: 'orhun/git-cliff-action',
    issue: 'objectui#13430',
    reason:
      'defaults its github_token input to the job token, which holds contents: write in this ' +
      'job; pinned to the v4.9.1 commit.',
  },
];

/**
 * Non-vacuity floors. A census that collapses reports an empty offender list,
 * and an empty offender list renders exactly like a healthy repository.
 *
 * Sized well under today's readings — 35 workflow files, 110 refs, 12 distinct,
 * measured on this commit, one workflow and one distinct ref below the reading
 * these floors were written against (objectui#8548 retired `stale.yml`) — so
 * ordinary churn never trips them, but far enough above zero that a parser
 * regression cannot pass. ⚠️ The floors themselves are NOT lowered for that
 * deletion: they still sit far under the reading, and moving a floor down every
 * time the population shrinks by one is how a floor stops being able to fail.
 * `CONTROL_ACTION` is the positive control: a term known to be present,
 * asserted in the same run as the counts, because a zero without one is not a
 * reading.
 */
export const FLOORS = { workflowFiles: 20, distinctRefs: 8, totalRefs: 40 };
export const CONTROL_ACTION = 'actions/checkout';

export function workflowDir(root = repoRoot()) {
  return path.join(root, '.github', 'workflows');
}

export function listWorkflows(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .sort();
}

/**
 * Every real `uses:` reference in one workflow source.
 *
 * Comment lines are stripped FIRST. Every workflow in this repository discusses
 * action refs in prose — this file's own header does — and a scan that counted
 * the prose would report references no file uses. objectui#8465's triage hit
 * exactly this: a `changesets/action@v1` followed by a trailing backtick, inside
 * a comment, read as a 14th reference. The `uses:` key position is the second
 * belt: a mention has to sit at the start of a line, optionally behind a YAML
 * sequence dash, to count.
 */
export function parseRefs(source, file = '(source)') {
  const found = [];
  source.split('\n').forEach((line, index) => {
    if (/^\s*#/.test(line)) return;
    const match = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line);
    if (!match) return;
    const ref = match[1].replace(/^['"]|['"]$/g, '');
    found.push({ file, line: index + 1, ref });
  });
  return found;
}

/**
 * How a reference is spelled.
 *
 * `local` and `docker` carry no version to spell, so the convention has nothing
 * to say about them and they are exempt by SHAPE rather than by declaration —
 * stated here rather than left implicit, because an unexplained silent pass is
 * the shape this gate exists to remove. Neither occurs in the tree today.
 */
export function classify(ref) {
  if (ref.startsWith('./') || ref.startsWith('../')) return { kind: 'local', conforms: true };
  if (ref.startsWith('docker://')) return { kind: 'docker', conforms: true };

  const at = ref.lastIndexOf('@');
  if (at === -1) return { kind: 'unversioned', conforms: false, action: ref, version: '' };

  const action = ref.slice(0, at);
  const version = ref.slice(at + 1);
  if (DEFAULT_SPELLING.test(version)) return { kind: 'tag-major', conforms: true, action, version };
  if (/^[0-9a-f]{40}$/.test(version)) return { kind: 'sha', conforms: false, action, version };
  return { kind: 'other', conforms: false, action, version };
}

export function scan(root = repoRoot(), { exceptions = DECLARED_EXCEPTIONS } = {}) {
  const dir = workflowDir(root);
  const files = listWorkflows(dir);

  const refs = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const hit of parseRefs(source, file)) {
      refs.push({ ...hit, ...classify(hit.ref) });
    }
  }

  const offConvention = refs.filter((r) => !r.conforms);
  const matched = new Set();
  const offenders = [];

  for (const ref of offConvention) {
    const index = exceptions.findIndex((e) => e.workflow === ref.file && e.action === ref.action);
    if (index === -1) offenders.push(ref);
    else matched.add(index);
  }

  const stale = exceptions.filter((_, index) => !matched.has(index));

  const distinct = [...new Set(refs.map((r) => r.ref))].sort();
  const census = {
    workflowFiles: files.length,
    totalRefs: refs.length,
    distinctRefs: distinct.length,
    controlPresent: refs.some((r) => r.action === CONTROL_ACTION),
  };

  return { files, refs, distinct, offenders, stale, census, exceptions };
}

/** Which floors, if any, the census failed. Empty means the reading is trustworthy. */
export function censusFailures({ census }) {
  const failures = [];
  for (const [key, floor] of Object.entries(FLOORS)) {
    if (census[key] < floor) failures.push(`${key} = ${census[key]}, below the floor of ${floor}`);
  }
  if (!census.controlPresent) {
    failures.push(`the positive control \`${CONTROL_ACTION}\` was not found in any workflow`);
  }
  return failures;
}

export function summarise({ census, distinct, offenders, stale }) {
  return (
    `${census.totalRefs} action reference(s) in ${census.workflowFiles} workflow file(s), ` +
    `${census.distinctRefs} distinct; ${offenders.length} off-convention and undeclared, ` +
    `${stale.length} stale exception(s); ` +
    `${distinct.length ? `control \`${CONTROL_ACTION}\` present: ${census.controlPresent}` : 'no refs'}`
  );
}

function main() {
  const result = scan();
  const collapsed = censusFailures(result);

  if (collapsed.length === 0 && result.offenders.length === 0 && result.stale.length === 0) {
    console.log(`✅  check-action-ref-convention: ${summarise(result)}`);
    return;
  }

  if (collapsed.length > 0) {
    console.error(`\n❌  check-action-ref-convention: the census collapsed — this run proves nothing:\n`);
    for (const f of collapsed) console.error(`    • ${f}`);
    console.error(`
A scan that stops finding references reports an empty offender list, and an
empty offender list looks exactly like a clean repository. Fix the scan (or the
floors, if the repository genuinely shrank) before reading any verdict from it.`);
  }

  if (result.offenders.length > 0) {
    console.error(
      `\n❌  check-action-ref-convention: ${result.offenders.length} action reference(s) ` +
        `are not spelled as ${DEFAULT_SPELLING_LABEL} and are not declared exceptions:\n`,
    );
    for (const o of result.offenders) {
      console.error(`    • ${o.file}:${o.line}  ${o.ref}   [${o.kind}]`);
    }
    console.error(`
This repository writes action references as ${DEFAULT_SPELLING_LABEL} — that is
what 12 of its 13 references were when the convention was written down, and the
convention exists so that the thirteenth is VISIBLE rather than merely present.

objectui#8465: the one reference spelled differently from all the others was
also the only one that had never resolved, and it went unnoticed for eight
months. Nothing about that was about SHAs being bad; it was about there being no
second instance to compare against and no reason written anywhere.

So there are exactly two honest ways forward:

  a) Spell it as ${DEFAULT_SPELLING_LABEL}, like everything around it.
  b) Keep the spelling and DECLARE it: add an entry to DECLARED_EXCEPTIONS in
     scripts/check-action-ref-convention.mjs with the workflow file, the action
     path, the issue that owns the decision, and a real reason.

⛔ Neither of those is "change the other twelve to match this one". Moving this
repository's pinning posture as a whole is a supply-chain decision and belongs on
its own card, not in a pull request that was about something else.`);
  }

  if (result.stale.length > 0) {
    console.error(
      `\n❌  check-action-ref-convention: ${result.stale.length} DECLARED_EXCEPTIONS ` +
        `entr(y/ies) in scripts/check-action-ref-convention.mjs match nothing:\n`,
    );
    for (const e of result.stale) console.error(`    • ${e.workflow} :: ${e.action}   [${e.issue}]`);
    console.error(`
Either the reference now follows the convention, or it moved, or the workflow is
gone. Delete the entry — an exception nobody removes is how an escape hatch turns
into a permanent skip-list, which is the failure this gate was written to end
rather than to repeat.

If you got here from a change to the referenced workflow: deleting the entry IS
the intended outcome, and it is the moment the reason it recorded stops being
load-bearing. Read it once before you delete it.`);
  }

  process.exit(1);
}

// Run only when invoked directly — the test suite imports `scan`/`classify`
// from here and must not trigger a repo scan (or a process.exit) on import.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--list')) {
    const result = scan();
    for (const ref of result.refs) {
      const mark = ref.conforms ? '  ' : '!!';
      console.log(`${mark} ${ref.file}:${ref.line}  ${ref.ref}  [${ref.kind}]`);
    }
    console.log(`\n${summarise(result)}`);
  } else {
    main();
  }
}
