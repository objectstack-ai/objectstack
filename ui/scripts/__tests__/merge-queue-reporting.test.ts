import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REQUIRED_CONTEXTS } from '../dependabot-merge-gate.mjs';
import { producedCheckNames, readWorkflows, subscribesMergeGroup } from './workflow-checks.js';

/**
 * objectui#3523 — the merge queue was enforced and validated nothing.
 *
 * Two independent holes produced one P0, and this file pins both shut, because
 * each of them is invisible in exactly the way that makes CI look healthy.
 *
 *  1. **Nothing subscribed `merge_group`.** A ruleset requires every change to
 *     land through the merge queue (#3243 measured a direct push to `main`
 *     returning 405 `Changes must be made through the merge queue`), yet not one
 *     of the repository's workflows carried the trigger — repo-wide
 *     `event=merge_group` runs stood at total_count = 0, historically. A queue
 *     nothing subscribes to can only carry an EMPTY required-check set, so it
 *     rebuilt each pull request on the current `main` and let it through without
 *     running anything. On 2026-08-07 #3503, #3510 and #3516 all merged with
 *     `Type Check` at conclusion=failure, on a `main` that #3498 had left with a
 *     TS2578; #3505 hot-fixed the result.
 *
 *  2. **`paths-ignore` on the `pull_request` trigger.** `paths-ignore` skips the
 *     WHOLE workflow when every changed file matches, and GitHub has no per-job
 *     path filter, so a docs-only or changeset-only PR started neither `ci.yml`
 *     nor `lint.yml` — #3509 measured zero check runs from them. A check that is
 *     never created does not fail a required-status-check rule, it leaves the PR
 *     pending forever; inside the queue it fails on the ruleset's 60-minute
 *     status-check timeout. So none of those contexts could be made required
 *     while the filter lived on the trigger, which is why the queue's required
 *     set was empty in the first place. `control-bytes.yml` and `docs-links.yml`
 *     had already reached this conclusion for themselves — their headers say a
 *     gate a markdown-only PR cannot start "rebuilds the hole it exists to
 *     close" — but the two heavyweight workflows had not.
 *
 * The fix is deliberately ordered: subscribe the trigger first (pure addition),
 * then move the path decision from the trigger into the jobs, and only then may
 * a maintainer write these contexts into the branch-protection and queue
 * required sets. Reversing that order deadlocks the whole repository, which is
 * what the assertions below exist to prevent someone re-doing by halves.
 *
 * Deliberately NOT asserted: which contexts are actually required. That lives in
 * repository settings, which no test in this repo can read and no agent may
 * change.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowDir = path.join(repoRoot, '.github/workflows');
const DOC = 'content/docs/guide/ci-cd-pipeline.md';
const doc = fs.readFileSync(path.join(repoRoot, DOC), 'utf8');

/**
 * `filename -> why this workflow must subscribe merge_group`.
 *
 * Hand-maintained, and it carries the REASONS only — since objectui#6160 it no
 * longer decides the MEMBERSHIP. `DERIVED_MERGE_GROUP_FLOOR` below does that,
 * out of `REQUIRED_CONTEXTS`.
 *
 * The header this replaced said the set could not be derived at all, because
 * "may this context be required?" is a property of the repository's settings and
 * not of the YAML. That premise is still true and the conclusion no longer
 * follows: `REQUIRED_CONTEXTS` in `scripts/dependabot-merge-gate.mjs` is already
 * a human's written-down answer to exactly that question, so deriving from it
 * mechanises nothing — it stops one judgement being written down twice in two
 * files that then drift apart. Which is what happened: the map named six
 * workflows while eight produced an unfiltered blocking check, and by the time
 * anyone acted on that it was seven against ten, because PR #6159 added its own
 * entry by hand without closing the class (objectui#6160).
 *
 * Two mechanical honesty checks keep what is left of it true: an entry naming a
 * workflow that no longer exists fails, so the list cannot rot into a
 * comfortable fiction the way a stale count does (#3261); and an entry naming a
 * workflow that produces no required context fails, so this map can only ever be
 * a SUBSET of the derived floor and the derivation cannot silently narrow past
 * it.
 */
const MUST_SUBSCRIBE_MERGE_GROUP = new Map<string, string>([
  ['ci.yml', 'produces Type Check, Build & E2E, Test (the shard aggregator) and Changeset Fixed Group Check'],
  ['lint.yml', 'produces Lint — the ESLint error ratchets'],
  [
    'changeset-presence.yml',
    'produces Changeset Declaration — added by objectui#3387 with no path filter at all, for the ' +
      'reason this list exists: it reports on every pull request, so it is requirable, and a ' +
      'requirable context that skips the queue build stalls it',
  ],
  [
    'repo-gates.yml',
    'produces Repo Gates — objectui#12214 folded fifteen one-check gate workflows into this one ' +
      'job (the control-byte scan and docs-link check among them, the two contexts #3523 first ' +
      'found safe to require). Their shared reason carries over unchanged: each gate reads the ' +
      'tree or a markdown-only surface, so the workflow carries no path filter, reports on every ' +
      'pull request, and is requirable; `scripts/dependabot-merge-gate.mjs` classifies it as a ' +
      'required context',
  ],
  [
    'governed-surface-guard.yml',
    'produces Governed Surface Queue Guard — added by objectui#6596. The one entry here whose ' +
      'REASON is the queue build itself rather than merely reporting on it: its `pull_request` leg ' +
      'is deliberately green whatever it finds, and its refusal exists only on `merge_group`, so a ' +
      'missing subscription would remove the entire verdict rather than just delay it. It carries ' +
      'no path filter either — a skipped job counts as SUCCESS in branch protection, which on a ' +
      'check whose whole job is to refuse is the failure mode itself — so it reports on every pull ' +
      'request and is requirable; `scripts/dependabot-merge-gate.mjs` classifies it as a required ' +
      'context',
  ],
]);

/**
 * The floor, DERIVED — objectui#6160.
 *
 * ## What it is protecting
 *
 * `main` sits behind an enforced merge queue (#3243). A context the repository
 * REQUIRES, produced by a workflow that does not subscribe `merge_group`, never
 * reports on the queue build — and a required check that never reports does not
 * FAIL the queue, it STALLS it until the ruleset's 60-minute status-check
 * timeout. That is the whole reason a floor exists here at all: objectui#3523,
 * where nothing subscribed, the queue's required set could therefore only be
 * empty, and #3503 / #3510 / #3516 merged on 2026-08-07 with `Type Check` at
 * `conclusion=failure`.
 *
 * ## Why it derives instead of being listed
 *
 * `REQUIRED_CONTEXTS` is the other place this repository writes down "this check
 * is blocking and reports on every pull request". Every name in it is a check a
 * maintainer may put in the required set, so every workflow producing one is
 * exactly a workflow that must subscribe `merge_group`. Reading the membership
 * off that list instead of off a second hand-kept one means a gate added to
 * `REQUIRED_CONTEXTS` is inside this floor the moment it is added, with nobody
 * having to remember a second file.
 *
 * The check names come from `REQUIRED_CONTEXTS`; the name -> workflow-file
 * mapping is `producedCheckNames()`, the same parser
 * `dependabot-merge-gate.test.ts` partitions its buckets with. One parser, so
 * the two files cannot disagree about which workflow produces what.
 *
 * ## The precondition, and why it is pinned rather than assumed
 *
 * A derived floor is an improvement only while it is a SUPERSET of what the hand
 * map named. A derivation that quietly narrows would read as more coverage while
 * asserting less — this card's own defect, one level up. So the containment is
 * itself an assertion below ("loses nothing the hand-maintained map named"), and
 * so is the resolvability of every `REQUIRED_CONTEXTS` name: a renamed check that
 * resolves to no workflow drops that workflow out of the floor silently, which is
 * the same narrowing wearing a different hat.
 *
 * Measured on this tree when the derivation landed: every one of the map's
 * entries produces a `REQUIRED_CONTEXTS` check (nothing is lost) and every
 * workflow producing one subscribes `merge_group` (the floor is satisfiable
 * today, and no workflow YAML needed changing — the missing thing was the
 * assertion, not the trigger).
 */
function deriveMergeGroupFloor(): { byWorkflow: Map<string, string[]>; unresolved: string[] } {
  const produced = producedCheckNames();
  const byWorkflow = new Map<string, string[]>();
  const unresolved: string[] = [];

  for (const context of REQUIRED_CONTEXTS) {
    const file = produced.get(context);
    if (!file) {
      unresolved.push(context);
      continue;
    }
    byWorkflow.set(file, [...(byWorkflow.get(file) ?? []), context]);
  }

  return { byWorkflow, unresolved };
}

const DERIVED_MERGE_GROUP_FLOOR = deriveMergeGroupFloor();

/** Workflows whose path filtering had to move from the trigger into the jobs. */
const FILTER_MOVED_INTO_JOBS = ['ci.yml', 'lint.yml'];

const read = (file: string): string => fs.readFileSync(path.join(workflowDir, file), 'utf8');

/**
 * A workflow's YAML with whole-line comments removed. Required, not cosmetic:
 * every one of these files discusses `paths-ignore`, `merge_group` and the
 * incident above in prose, and a scan that counted the prose would report
 * triggers and filters that no file has.
 */
function withoutComments(yaml: string): string {
  return yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** A top-level block (`on:`, `jobs:`) up to the next top-level key. */
function topLevelBlock(yaml: string, key: string): string {
  const at = yaml.search(new RegExp(`^${key}:`, 'm'));
  expect(at, `the workflow must still have a top-level \`${key}:\``).toBeGreaterThan(-1);
  const rest = yaml.slice(at);
  const firstLineEnd = rest.indexOf('\n') + 1;
  const after = rest.slice(firstLineEnd);
  const next = after.search(/^[A-Za-z]/m);
  return next === -1 ? rest : rest.slice(0, firstLineEnd + next);
}

/** One two-space child of `on:` / `jobs:`, up to the next child at that indent. */
function nestedBlock(block: string, key: string): string {
  const at = block.search(new RegExp(`^ {2}${key}:`, 'm'));
  if (at === -1) return '';
  const rest = block.slice(at);
  const firstLineEnd = rest.indexOf('\n') + 1;
  if (firstLineEnd === 0) return rest;
  const after = rest.slice(firstLineEnd);
  const next = after.search(/^ {2}\S/m);
  return next === -1 ? rest : rest.slice(0, firstLineEnd + next);
}

/** `- 'pattern'` entries — the shape `paths` / `paths-ignore` lists are written in. */
const quotedEntries = (block: string): string[] =>
  [...block.matchAll(/^\s*-\s*'([^']+)'/gm)].map((m) => m[1]);

/** `':(exclude,glob)pattern'` pathspecs — the shape the in-job gate is written in. */
const excludePathspecs = (yaml: string): string[] =>
  [...yaml.matchAll(/':\(exclude,glob\)([^']+)'/g)].map((m) => m[1]);

/**
 * Every line capturing a `git diff` into `CHANGED` — one per gate, trimmed.
 *
 * Lines rather than whole commands, because the fail-open decision is made
 * entirely by how the capture OPENS: `if ! CHANGED=$(…` is what turns a nonzero
 * `git diff` into `should_run=true`. A capture continued over further lines
 * (every one of these is) still contributes exactly one entry, so the count is
 * the number of gates.
 *
 * Callers must strip comments first (`withoutComments`) — both workflows now
 * discuss this exact shape in prose, and counting the prose would report gates
 * no job has.
 */
const diffCaptureLines = (yaml: string): string[] =>
  yaml
    .split('\n')
    .filter((line) => /CHANGED=\$\(\s*git diff/.test(line))
    .map((line) => line.trim());

/**
 * `file -> the jobs whose diff capture must fail open`.
 *
 * Hand-maintained for the same reason as `MUST_SUBSCRIBE_MERGE_GROUP`, and used
 * only as a FLOOR: the assertion below checks the shape of every capture it
 * finds, so a sixth gate is covered the moment it is written, while the floor is
 * what makes DELETING one red. Without it, the shape check would pass an empty
 * list — green because nothing was produced, not because anything is right.
 */
const FAIL_OPEN_GATES = new Map<string, readonly string[]>([
  // `type-check`, `test` and `e2e` share `id: relevant` (objectui#3523 / PR
  // #3722); `docs` has its own `id: docs-changes` and predates them (#3450),
  // which is how it kept the fail-CLOSED spelling until objectui#3723.
  ['ci.yml', ['type-check', 'test', 'e2e', 'docs']],
  ['lint.yml', ['lint']],
]);

describe('every requirable context reports on a merge-queue build (#3523 step 1)', () => {
  it('subscribes merge_group in each workflow that produces one', () => {
    const missing = [...MUST_SUBSCRIBE_MERGE_GROUP.keys()].filter(
      (file) => !/^ {2}merge_group:/m.test(topLevelBlock(withoutComments(read(file)), 'on')),
    );

    expect(
      missing,
      `These workflows produce a check the repository can require, but do not subscribe ` +
        `\`merge_group\`:\n` +
        missing.map((f) => `  - ${f} (${MUST_SUBSCRIBE_MERGE_GROUP.get(f)})`).join('\n') +
        `\n\nThe merge queue is ENFORCED here (#3243). A required context that does not report ` +
        `on a queue build does not fail the queue, it stalls it until the ruleset's 60-minute ` +
        `status-check timeout — and while nothing at all subscribes, the queue's required set ` +
        `can only be empty, so it rebuilds each PR on the current \`main\` and merges it ` +
        `unvalidated. That is not hypothetical: #3503 / #3510 / #3516 merged on 2026-08-07 with ` +
        `\`Type Check\` at conclusion=failure (objectui#3523).`,
    ).toEqual([]);
  });

  it('keeps the list honest — every name in it is a workflow that exists', () => {
    const files = new Set(fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml')));
    for (const [name, reason] of MUST_SUBSCRIBE_MERGE_GROUP) {
      expect(files, `MUST_SUBSCRIBE_MERGE_GROUP names ${name}, which no longer exists — drop it`).toContain(name);
      expect(reason.length, `MUST_SUBSCRIBE_MERGE_GROUP[${name}] must say which context it produces`).toBeGreaterThan(20);
    }
  });

  it('runs the test suite on a queue build, not only on pull requests', () => {
    // `if: github.event_name == 'pull_request'` predates the queue and was
    // correct while the third event could not happen. Left alone it would make
    // the last validation before `main` the ONLY one that skips every shard.
    const jobs = topLevelBlock(withoutComments(read('ci.yml')), 'jobs');
    const test = nestedBlock(jobs, 'test');
    expect(test, 'ci.yml must still define a `test:` job').not.toEqual('');
    expect(
      test,
      `ci.yml's \`test\` job is restricted to \`pull_request\`, so a merge_group build runs no ` +
        `tests at all. Write the exclusion as "not push" instead — \`test-coverage\` is the push ` +
        `lane, and the queue build is the last check before \`main\` (objectui#3523).`,
    ).not.toMatch(/^\s*if: github\.event_name == 'pull_request'\s*$/m);
  });
});

describe('the merge_group floor derives itself from REQUIRED_CONTEXTS (#6160)', () => {
  const { byWorkflow, unresolved } = DERIVED_MERGE_GROUP_FLOOR;

  it('resolves every required context to the workflow that produces it', () => {
    // Non-vacuity guard, and it comes first because the two assertions after it
    // are both quantified over `byWorkflow`: a derivation that resolved nothing
    // would make them pass while asserting nothing at all — green because
    // nothing was produced, the failure mode this whole file is about.
    expect(
      unresolved,
      `These names are in \`REQUIRED_CONTEXTS\` but no \`pull_request\` workflow produces a check ` +
        `by that name:\n` +
        unresolved.map((name) => `  - ${name}`).join('\n') +
        `\n\nEach one is a workflow silently dropped OUT of the merge_group floor below — the ` +
        `derivation cannot require a subscription of a workflow it failed to identify. Usually a ` +
        `renamed job: fix the name on whichever side is stale. (\`dependabot-merge-gate.test.ts\` ` +
        `fails on the same drift from the other direction — there it means the gate waits forever ` +
        `for a context nothing creates.)`,
    ).toEqual([]);

    expect(
      byWorkflow.size,
      `The derivation resolved no workflows at all, so the floor below is empty and asserts ` +
        `nothing. Either \`REQUIRED_CONTEXTS\` was emptied or \`producedCheckNames()\` stopped ` +
        `parsing \`.github/workflows\`.`,
    ).toBeGreaterThan(0);
  });

  it('requires merge_group of every workflow that produces a required context', () => {
    const workflows = new Map(readWorkflows().map((workflow) => [workflow.file, workflow]));

    const missing = [...byWorkflow.keys()].filter((file) => {
      const workflow = workflows.get(file);
      return !workflow || !subscribesMergeGroup(workflow);
    });

    expect(
      missing,
      `These workflows produce a context \`REQUIRED_CONTEXTS\` declares blocking, but do not ` +
        `subscribe \`merge_group\`:\n` +
        missing.map((f) => `  - ${f} (produces ${byWorkflow.get(f)?.join(', ')})`).join('\n') +
        `\n\nThe merge queue is ENFORCED here (#3243). A required context that does not report on ` +
        `a queue build does not fail the queue, it STALLS it until the ruleset's 60-minute ` +
        `status-check timeout — every queued pull request burns an hour and fails with nothing ` +
        `red to point at. Add \`merge_group:\` to the workflow's \`on:\` block; it is a pure ` +
        `addition and changes nothing about pull requests (objectui#3523 step 1, where the ` +
        `opposite state let #3503 / #3510 / #3516 merge with \`Type Check\` at ` +
        `conclusion=failure).\n\nIf the context genuinely cannot be required, it does not belong ` +
        `in \`REQUIRED_CONTEXTS\` — move it to \`OPTIONAL_CONTEXTS\` or \`NOT_A_GATE\` in ` +
        `\`scripts/dependabot-merge-gate.mjs\` with the reason, rather than weakening this floor.`,
    ).toEqual([]);
  });

  it('loses nothing the hand-maintained map named', () => {
    // The precondition of the whole derivation, pinned rather than assumed: the
    // derived floor must CONTAIN what the hand-maintained map named, or swapping
    // one for the other would look like more coverage while asserting less.
    //
    // It fails in the direction that matters. Adding a workflow to the map that
    // produces no `REQUIRED_CONTEXTS` check reads as "the map now covers
    // something the derivation does not" — which is the two declarations
    // crossing, and is exactly what may not happen quietly.
    const lost = [...MUST_SUBSCRIBE_MERGE_GROUP.keys()].filter((file) => !byWorkflow.has(file));

    expect(
      lost,
      `MUST_SUBSCRIBE_MERGE_GROUP names these workflows, but none of them produces a check listed ` +
        `in \`REQUIRED_CONTEXTS\`:\n` +
        lost.map((f) => `  - ${f} (${MUST_SUBSCRIBE_MERGE_GROUP.get(f)})`).join('\n') +
        `\n\nSince objectui#6160 the floor is DERIVED from \`REQUIRED_CONTEXTS\`, and this map ` +
        `carries only the reasons. So the two declarations have just crossed: either the check ` +
        `belongs in \`REQUIRED_CONTEXTS\` (add it there — that is what puts the workflow inside ` +
        `the floor), or it is not requirable and the entry here is claiming a floor nothing ` +
        `enforces (drop it). Leaving it is the one option that is not available: it would be a ` +
        `hand-maintained membership again, the thing that fell behind twice before anyone noticed.`,
    ).toEqual([]);
  });
});

describe('every context reports on every pull request (#3523 step 2)', () => {
  it.each(FILTER_MOVED_INTO_JOBS)('%s filters no pull request at the trigger', (file) => {
    const pullRequest = nestedBlock(topLevelBlock(withoutComments(read(file)), 'on'), 'pull_request');
    expect(pullRequest, `${file} must still trigger on \`pull_request\``).not.toEqual('');

    for (const key of ['paths-ignore', 'paths']) {
      expect(
        pullRequest,
        `${file} filters its \`pull_request\` trigger by \`${key}\`. That skips the WHOLE ` +
          `workflow — GitHub has no per-job path filter — so on a PR whose files all match, the ` +
          `contexts this file produces are never created. A required check that is never created ` +
          `leaves the PR pending forever and fails a queue build on the 60-minute timeout, which ` +
          `is why they could not be required at all before objectui#3523 (#3509 measured a ` +
          `docs-only PR starting zero of them). Put the path decision in the jobs instead, the ` +
          `way \`ci.yml\`'s \`docs\` job has since #3450.`,
      ).not.toMatch(new RegExp(`^\\s*${key}:`, 'm'));
    }
  });

  it.each(FILTER_MOVED_INTO_JOBS)('%s keeps ONE ignore list, on the push trigger', (file) => {
    // The push lane keeps its `paths-ignore` — branch protection and the merge
    // queue judge pull requests and queue builds, never pushes to `main`, so
    // filtering there costs nothing and saves a full run on every docs merge.
    // That makes it the single authored home for the list, and the in-job gates
    // are held to it here rather than being four hand-synced copies (#3261's
    // lesson: a hand-copied enumeration drifts by construction).
    const push = nestedBlock(topLevelBlock(withoutComments(read(file)), 'on'), 'push');
    const declared = quotedEntries(push);
    expect(
      declared.length,
      `${file}'s \`push\` trigger no longer declares \`paths-ignore\` entries — the in-job gates ` +
        `below have nothing left to be checked against.`,
    ).toBeGreaterThan(0);

    const inJob = [...new Set(excludePathspecs(read(file)))];
    expect(
      inJob.length,
      `${file} declares no \`:(exclude,glob)…\` pathspec, so no job short-circuits and the ` +
        `expensive steps now run on every docs-only PR. objectui#3523 moved the filter into the ` +
        `jobs; it did not delete it.`,
    ).toBeGreaterThan(0);

    expect(
      [...inJob].sort(),
      `${file}'s in-job exclusion list has drifted from the \`paths-ignore\` on its \`push\` ` +
        `trigger. The two must stay identical: the trigger is what the in-job gate replaced for ` +
        `pull requests, and any difference silently means PRs and pushes are judged by different ` +
        `rules (objectui#3523).`,
    ).toEqual([...new Set(declared)].sort());
  });

  it.each(FILTER_MOVED_INTO_JOBS)('%s gates every step after the gate, in every gated job', (file) => {
    const jobs = topLevelBlock(withoutComments(read(file)), 'jobs');
    const keys = [...jobs.matchAll(/^ {2}([a-z0-9][a-z0-9-]*):[ \t]*$/gm)].map((m) => m[1]);
    expect(keys.length, `the ${file} \`jobs:\` parse returned implausibly few keys`).toBeGreaterThan(0);

    const gatedJobs = keys.filter((key) => /^\s*id: relevant$/m.test(nestedBlock(jobs, key)));
    expect(
      gatedJobs.length,
      `${file} has no job carrying the \`id: relevant\` short-circuit. Removing it does not make ` +
        `the gate stricter — it makes every expensive step run on every docs-only PR ` +
        `(objectui#3523).`,
    ).toBeGreaterThan(0);

    for (const key of gatedJobs) {
      const block = nestedBlock(jobs, key);
      const after = block.slice(block.search(/^\s*id: relevant$/m));
      // Step boundaries inside a job body: `      - name: …`.
      const steps = after.split(/^ {6}- name: /m).slice(1);
      expect(steps.length, `${file}'s \`${key}\` job has no steps after its gate`).toBeGreaterThan(0);

      const ungated = steps
        .filter((step) => !step.includes('steps.relevant.outputs.should_run'))
        .map((step) => step.split('\n')[0].trim());

      expect(
        ungated,
        `${file}'s \`${key}\` job runs these steps regardless of its own short-circuit:\n` +
          ungated.map((s) => `  - ${s}`).join('\n') +
          `\n\nEvery step after \`id: relevant\` must carry ` +
          `\`if: steps.relevant.outputs.should_run == 'true'\` (combined with its own condition ` +
          `where it already has one). A step that ignores the gate turns a docs-only PR into a ` +
          `full install-and-build, which is the cost objectui#3523 kept while moving the filter.`,
      ).toEqual([]);
    }
  });

  it('fails OPEN: EVERY gate that cannot compute the diff runs everything', () => {
    // The direction matters more than the code. objectstack#4928 named this the
    // filter contract after the opposite spelling — a diff whose failure was
    // swallowed into an empty result — produced a fully green pull request with
    // no job having run and no red signal anywhere.
    //
    // This assertion used to be a single `toMatch` per FILE, which is why it
    // reported green while `ci.yml`'s `docs` gate was still fail-CLOSED
    // (objectui#3723): the three gates PR #3722 added satisfied the regex on
    // ci.yml's behalf, and a whole-file match cannot tell four captures from
    // three plus a swallow. It is now per CAPTURE, so each gate answers for
    // itself and a fifth spelled the closed way cannot hide behind the others.
    for (const file of FILTER_MOVED_INTO_JOBS) {
      const expected = FAIL_OPEN_GATES.get(file) ?? [];
      const captures = diffCaptureLines(withoutComments(read(file)));

      expect(
        captures.length,
        `${file} declares ${captures.length} \`CHANGED=$(git diff …)\` captures, fewer than the ` +
          `${expected.length} gates that must have one (${expected.join(', ')}). A gate whose diff ` +
          `capture is gone either no longer filters at all, or filters by some other means this ` +
          `test cannot check the direction of — and with none left, the shape assertion below ` +
          `passes an empty list (objectui#3523, objectui#3723).`,
      ).toBeGreaterThanOrEqual(expected.length);

      const failClosed = captures.filter((line) => !line.startsWith('if ! CHANGED=$(git diff'));
      expect(
        failClosed,
        `${file} captures a \`git diff\` without letting its failure mean RUN:\n` +
          failClosed.map((line) => `  - ${line}`).join('\n') +
          `\n\nEvery gate must open its capture as \`if ! CHANGED=$(git diff …); then\` and treat ` +
          `the failure branch as should_run=true. Swallowing the failure instead — the ` +
          `\`2>/dev/null || echo ""\` this file's \`docs\` job used until objectui#3723 — makes ` +
          `"the diff could not be computed" indistinguishable from "nothing changed", so a ` +
          `shallow checkout or a malformed sha skips the job's real work and still reports ` +
          `success. When the filter cannot tell, it must RUN (objectstack#4928).`,
      ).toEqual([]);
    }
  });

  it('fails OPEN in effect, not only in shape: no gate swallows its diff failure', () => {
    // `if !` is necessary but not sufficient. `if ! CHANGED=$(git diff … || echo
    // "")` reads as fail-open and is not: `|| echo ""` makes the command succeed
    // whatever git did, so the failure branch becomes unreachable and the gate is
    // fail-CLOSED again with the safe spelling wrapped around it. Same for
    // `2>/dev/null`, which additionally deletes git's own explanation of what
    // went wrong from the run log — the one diagnostic a future reader gets.
    for (const file of FILTER_MOVED_INTO_JOBS) {
      const code = withoutComments(read(file));
      for (const [shape, why] of [
        [/\|\|\s*echo\s*""/, '`|| echo ""` makes the capture succeed even when git failed'],
        [/2>\s*\/dev\/null/, '`2>/dev/null` hides why git failed'],
      ] as const) {
        expect(
          code,
          `${file} still contains ${why}. Both halves of the fail-CLOSED spelling objectui#3723 ` +
            `removed must stay out: the gate's failure branch has to be reachable, and the run ` +
            `log has to say what happened (objectstack#4928).`,
        ).not.toMatch(shape);
      }
    }
  });
});

/**
 * The page's copy of the same list (objectui#4154).
 *
 * `content/docs/guide/ci-cd-pipeline.md` opened its `## Merge Queue` section with
 * "Five workflows subscribe:" and named five, while the map above held six — the
 * page went stale the moment objectui#3735 added `skills-paths.yml`, and stale
 * prose reads exactly as authoritative as fresh prose. That is objectui#3261's
 * defect one subsystem over, and it lands on the one reader the paragraph is
 * written for: someone deciding whether a new gate of theirs has to subscribe.
 *
 * The page now points at `MUST_SUBSCRIBE_MERGE_GROUP` instead of copying it, and
 * these assertions keep it that way. The honest caveat, recorded rather than
 * hidden: this pins a copy to a copy, since the map is itself hand-maintained.
 * What makes that trade worth taking is that the map is read by an assertion —
 * a member that stops subscribing fails the first test in this file, and a member
 * that stops existing fails the second — while prose is read by no one until it
 * has already misled someone.
 *
 * Two paragraphs, two different rules, because they are two different kinds of
 * claim:
 *
 *   - the LIVE claim ("which workflows subscribe") may not enumerate and may not
 *     count. It cannot go stale if it holds no instances;
 *   - the DATED clause (those four did not subscribe until objectui#3523, PR
 *     #3722) keeps its four names. A past fact cannot drift, and the sentence
 *     needs them: "none of the first four" has no antecedent once the live list
 *     is gone.
 *
 * The exemption is therefore granted per PARAGRAPH, anchored on the #3523 link,
 * rather than to the four names anywhere in the section — otherwise a future
 * present-tense sentence naming exactly those four would pass while being short
 * by every subscriber added since, which is this issue verbatim.
 *
 * The residual hole, stated rather than left for the next reader to find: a
 * present-tense list of exactly those four names, written INSIDE the dated
 * paragraph and carrying no count, still passes. That is a sentence someone has
 * to author deliberately and falsely; what these assertions exist to stop is
 * DRIFT, and a page holding no live list cannot drift — a seventh subscriber
 * changes nothing on it. Every other spelling of the old sentence is red: five of
 * the six names outside the dated paragraph, any of the two later ones inside it,
 * and any cardinality anywhere in the section.
 */
const HISTORY_ANCHOR = 'objectui/issues/3523';

/**
 * The workflows the dated clause names — the ones PR #3722 subscribed for
 * objectui#3523 step 1. Asserted below to be a subset of the map, so the
 * exemption cannot be widened into a second live list by adding names to it.
 */
const HISTORY_NON_SUBSCRIBERS = ['ci.yml', 'lint.yml'];
// The dated paragraph also names `control-bytes.yml` and `docs-links.yml`, the
// other two PR #3722 subscribed. objectui#12214 folded both into
// `repo-gates.yml`, so they are no longer subscribers at all: the live rule
// above cannot flag a name no workflow carries, and they need no exemption.

/**
 * The `## Merge Queue` section, from its heading to the next `## `.
 *
 * The scoping is load-bearing, not tidiness: `ci.yml` has a section of its own
 * further down the same page and is named dozens of times there, so a whole-file
 * scan for subscriber names would report all of them.
 */
function mergeQueueSection(): string {
  const start = doc.indexOf('\n## Merge Queue\n');
  expect(start, `${DOC} must still have a "## Merge Queue" section`).toBeGreaterThan(-1);
  const rest = doc.slice(start + 1);
  const next = rest.indexOf('\n## ');
  return next === -1 ? rest : rest.slice(0, next);
}

/** Blank-line-separated paragraphs; a bullet list is one paragraph, as authored. */
const paragraphsOf = (section: string): string[] =>
  section
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

/** `ci.yml` but not `eslint.yml`, and not the tail of a longer path. */
const namesWorkflow = (text: string, file: string): boolean =>
  new RegExp(`(?<![\\w./-])${file.replace(/\./g, '\\.')}`).test(text);

describe('ci-cd-pipeline.md does not keep its own copy of the subscriber list (#4154)', () => {
  /**
   * Every workflow the page may not enumerate: the map's entries AND the derived
   * floor's, which since objectui#6160 is the larger set. Scanning only the map
   * would have let the page name the subscribers the map does not — the same
   * drift this describe exists to stop, hiding in the gap the map had already
   * fallen behind by.
   */
  const CURRENT_SUBSCRIBERS = new Set([
    ...MUST_SUBSCRIBE_MERGE_GROUP.keys(),
    ...DERIVED_MERGE_GROUP_FLOOR.byWorkflow.keys(),
  ]);

  it('names no current subscriber outside the dated #3523 paragraph', () => {
    const offenders: string[] = [];
    for (const paragraph of paragraphsOf(mergeQueueSection())) {
      const dated = paragraph.includes(HISTORY_ANCHOR);
      for (const file of CURRENT_SUBSCRIBERS) {
        if (!namesWorkflow(paragraph, file)) continue;
        if (dated && HISTORY_NON_SUBSCRIBERS.includes(file)) continue;
        offenders.push(`${file} — in ${dated ? 'the dated #3523 paragraph' : 'a live paragraph'}: "${paragraph.split('\n')[0].slice(0, 72)}…"`);
      }
    }

    expect(
      offenders,
      `The "## Merge Queue" section of ${DOC} enumerates workflows that subscribe ` +
        `\`merge_group\` today:\n` +
        offenders.map((o) => `  - ${o}`).join('\n') +
        `\n\nThat list belongs in exactly one place, \`MUST_SUBSCRIBE_MERGE_GROUP\` in this file, ` +
        `which is the copy an assertion reads. A second copy in prose is short by one subscriber ` +
        `the day the next gate lands and still reads as authoritative — the page said "Five ` +
        `workflows subscribe" for as long as it took someone to count the YAML (objectui#4154, ` +
        `the same defect objectui#3261 removed from lint.yml). Point at the map instead. The one ` +
        `exemption is the dated paragraph linking #3523, which names the four workflows that did ` +
        `not subscribe before it: that is a past fact and cannot drift.`,
    ).toEqual([]);
  });

  it('states no count of subscribing workflows', () => {
    // "Five workflows subscribe" is the drift itself: a number is wrong the
    // moment the set changes and nothing on the page can notice.
    const counted = [
      ...mergeQueueSection().matchAll(
        /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\b[^.\n]{0,24}?workflows?\b/gi,
      ),
    ].map((m) => m[0]);

    expect(
      counted,
      `The "## Merge Queue" section of ${DOC} hard-codes how many workflows subscribe ` +
        `\`merge_group\`:\n` +
        counted.map((c) => `  - "${c}"`).join('\n') +
        `\n\nThe map in this file is the list; the page states no cardinality, for the same ` +
        `reason the Core CI section states no job count (objectui#3451) and this page's workflow ` +
        `inventory states no workflow count (objectui#3212). A count that nothing reads drifts ` +
        `silently — this one said five while six subscribed (objectui#4154).`,
    ).toEqual([]);
  });

  it('keeps the pointer that replaced the list', () => {
    // Without this, deleting the pointer passes both assertions above: no names,
    // no count, and nothing telling the reader where the answer actually lives.
    // Green because nothing was produced is the failure mode this whole file is
    // about.
    const section = mergeQueueSection();
    for (const marker of ['MUST_SUBSCRIBE_MERGE_GROUP', 'scripts/__tests__/merge-queue-reporting.test.ts']) {
      expect(
        section,
        `The "## Merge Queue" section of ${DOC} no longer names \`${marker}\`. The section may ` +
          `not enumerate subscribers (above), so the pointer is the only thing left that answers ` +
          `"which workflows subscribe, and why that one?" — dropping it leaves the reader with a ` +
          `rule and no way to check an instance (objectui#4154).`,
      ).toContain(marker);
    }
  });

  it('keeps the dated exemption honest — its names are all map entries', () => {
    for (const file of HISTORY_NON_SUBSCRIBERS) {
      expect(
        [...MUST_SUBSCRIBE_MERGE_GROUP.keys()],
        `HISTORY_NON_SUBSCRIBERS names ${file}, which is not in MUST_SUBSCRIBE_MERGE_GROUP. The ` +
          `exemption exists for one dated sentence about the four workflows PR #3722 subscribed ` +
          `(objectui#3523 step 1); it is not a place to park names the live rule would reject. ` +
          `If ${file} genuinely stopped being a requirable gate, check that the #3523 paragraph ` +
          `still reads correctly, then update both lists together.`,
      ).toContain(file);
    }
  });
});
