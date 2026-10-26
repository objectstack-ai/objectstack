import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
 *
 * ⚠️ objectstack#25712 retired every assertion here that read a workflow: they
 * read objectui's, which sit under `ui/.github/workflows/` and run nowhere under
 * the monorepo. The note above the CI page section below lists them and the root
 * gates that carry both holes now. That section reads no workflow and stays.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOC = 'content/docs/guide/ci-cd-pipeline.md';
const doc = fs.readFileSync(path.join(repoRoot, DOC), 'utf8');

/**
 * `filename -> why this workflow must subscribe merge_group`.
 *
 * Hand-maintained, and it carries the REASONS only — since objectui#6160 it no
 * longer decides the MEMBERSHIP. The floor derived out of `REQUIRED_CONTEXTS`
 * did that until objectstack#25712 retired it (the note below).
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
 * Its two mechanical honesty checks (an entry naming a workflow that no longer
 * exists failed; an entry naming a workflow that produces no required context
 * failed) retired with objectstack#25712, with the floor they held it under:
 * both read objectui's workflows. The CI page section below still reads the
 * map, as the list the page points at.
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

// Retired with objectstack#25712: step 1 (`subscribes merge_group in each
// workflow that produces one`, `keeps the list honest — every name in it is a
// workflow that exists` and `runs the test suite on a queue build, not only on
// pull requests`); the floor derived from `REQUIRED_CONTEXTS` (objectui#6160:
// `deriveMergeGroupFloor()` and its three cases, which resolved each context
// through `./workflow-checks.ts`); and step 2 (`filters no pull request at the
// trigger`, `keeps ONE ignore list, on the push trigger`, `gates every step
// after the gate, in every gated job` and both fail-OPEN cases, on objectui's
// `ci.yml` and `lint.yml`). Each read objectui's workflows from
// `ui/.github/workflows/`, which runs nowhere under the monorepo: GitHub runs
// the root `.github/workflows/` alone.
//
// The root gates carry both #3523 holes for the contexts the repository
// requires today, `Lint UI` and `Build & E2E UI` among them.
// `scripts/check-required-contexts.mjs` (`check:required-contexts`, in the root
// `Lint · CI, release & engine gates` job) derives from the root registry and
// holds the workflow of every required context to a `merge_group:` trigger (its
// assertion 6) and to a `pull_request` trigger with no path filter (its
// assertion 7). The root `ci.yml` makes its path decision in its `filter` job
// instead, and `check:workflow-status-functions`, in the same job, holds every
// job-level `if:` that reads a `needs.*.outputs` value to a status function,
// the half of the objectstack#4928 filter contract that keeps a dead filter
// from skipping to green.

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
 * What made that trade worth taking was that the map was read by an assertion:
 * a member that stopped subscribing failed the first test in this file, and a
 * member that stopped existing failed the second. Both read objectui's
 * workflows and retired with objectstack#25712 (the note above), so this now
 * pins the page to a map no other assertion reads, while prose is read by no
 * one until it has already misled someone.
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
   * Every workflow the page may not enumerate: the map's entries. Until
   * objectstack#25712 this also took the derived floor's, the larger set since
   * objectui#6160; that floor read objectui's workflows and retired with the
   * assertions above, so the map is the one list left to scan.
   */
  const CURRENT_SUBSCRIBERS = new Set(MUST_SUBSCRIBE_MERGE_GROUP.keys());

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
