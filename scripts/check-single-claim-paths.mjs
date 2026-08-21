#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check:single-claim-paths — at most ONE open PR may modify a declared
 * at-most-one-writer path.
 *
 *   node scripts/check-single-claim-paths.mjs              # judge this PR (CI)
 *   node scripts/check-single-claim-paths.mjs --self-test  # verify it offline
 *
 * ⚠️ Repo paths are named UNQUOTED in this header on purpose, and the self-test
 * fixtures below use paths that exist in no repo. Both are load-bearing; the
 * last section carries the measurement that forces them.
 *
 * ## The defect this blocks
 *
 * Two PRs reached green independently while shipping ONE physical change. Both
 * added the same generated changeset file and both rewrote the objectui pin
 * from the same old sha to the same new sha — a byte-identical hunk. The first
 * entered the merge queue; the second was green and one flip from enqueueing
 * behind it, where it would have conflicted on both files.
 *
 * Nothing objected, and no gate was broken. The repo's Duplicate Fix Guard asks
 * whether two open PRs claim the same CARD, and it answered correctly: these
 * claimed two different cards, both legitimate, independently filed, and
 * neither a duplicate of the other AS WRITTEN. One names a bump; the other
 * names a reason for that bump. The duplication existed only in the diff, and
 * nothing in CI compared what the PRs actually DO.
 *
 * That is the gap this fills. The card key and the diff key are different
 * questions, and the older gate is not weakened, widened, or replaced here.
 *
 * ## The key: a declared list, not repo-wide diff intersection
 *
 * The general form of this check — flag two open PRs whose changed-path sets
 * intersect at all — is unusable, and that is measured rather than assumed.
 * Over the 300 most recent PRs (numbers 8936 through 9584, complete file sets,
 * no pagination truncation), pairs whose OPEN WINDOWS overlapped and which
 * shared at least one changed path:
 *
 *   any shared changed path (repo-wide)  ->  68 concurrent pairs
 *   the declared list below              ->   0 concurrent pairs
 *
 * The repo-wide key's own top collisions say why it can never ship: the lock
 * file (33 pairs), one plugin manifest (21), the root manifest (15). Those are
 * ordinary concurrent work in a repo taking ~18 merges a day, so a gate keyed
 * that way is ~68 false accusations per 300 PRs — noise on day one, and every
 * one of them names two authors who both did nothing wrong.
 *
 * One caveat on that 0, stated because the method has a real limit and a
 * clean-looking number should not hide it: the files endpoint returns a PR's
 * diff against its CURRENT merge base, so a retrospective sweep sees today's
 * diffs, not the ones that were live at the time. The incident pair itself is
 * invisible to it — the second PR's pin write left its cumulative diff once a
 * merge commit brought in a main that already carried the first PR's identical
 * write. Read commit by commit, that PR's first commit does touch the pin, so
 * the pair IS a true positive and the sweep simply cannot see it any more. The
 * number to trust from that table is therefore the 68, which is the one that
 * decides the design; the 0 is a floor on the declared key, not a proof.
 *
 * So the key is an explicit list of paths that are ALREADY single-writer by
 * landing discipline, and the gate declares that reality instead of inferring
 * it. Additions are cheap to make and must not be cheap to make CARELESSLY,
 * which is why each entry carries a reason and the self-test fails an entry
 * that does not. The reason is the review surface.
 *
 * ## What this catches, and what it does not
 *
 * It catches: two open PRs that both write a listed path, whether their hunks
 * are identical or not. Two DIFFERENT pin targets in flight at once is as much
 * a violation as the same one twice — the surface admits one open claim.
 *
 * It does not catch: two PRs that fix the same thing DIFFERENTLY on unlisted
 * paths. They share no listed path and no hash, and the measurement above says
 * the only key that would reach them is the one with 68 false positives. That
 * limit is named, not hidden, and narrowing it is a fresh measurement's job.
 *
 * ## The action: the LATER PR goes red, and it names the earlier one
 *
 * Failing both would be symmetric and unhelpful — neither author is wrong, and
 * the earlier one would go red through no action of their own. Failing the
 * earlier one would reward racing. So this takes the Duplicate Fix Guard's
 * rule unchanged: first come, first served, the lower PR number keeps its claim
 * and stays green, and the higher one fails with a pointer to it by number,
 * URL and branch. One name in the failure is the whole remedy — the reader
 * closes one PR, or folds one into the other.
 *
 * Red rather than a warning, deliberately. An annotation that lands where
 * nobody looks buys nothing; this repo has already priced a signal whose only
 * home was a run page no one watches, and the ruling there was that invisible
 * is the expensive half. A red check on the PR is the visible channel.
 *
 * ## Cost, and why the expensive branch almost never runs
 *
 * The obvious objection to any diff-keyed gate is that it must fetch every open
 * PR's file list on every run. This one does not, because it asks the cheap
 * question first: it lists THIS PR's files, intersects with the list, and when
 * the intersection is empty it returns having made exactly one paginated call.
 * That is the overwhelmingly common path — 1 of those 300 PRs touched a listed
 * path, so the branch that walks other PRs runs on roughly 0.3% of runs, and
 * when it does it walks the open set (9 PRs when this was written), not 300.
 *
 * ## Why a moving merge base is correct here, not a hole
 *
 * The files endpoint diffs a PR against its CURRENT merge base, so once the
 * earlier PR merges, the identical hunk disappears from the later PR's file
 * list and this gate goes green. That is not a miss, it is the right answer:
 * main already carries the change, the second PR no longer writes the path, and
 * there is nothing left to collide. The incident specimen shows exactly this —
 * the second PR's first commit touched the pin, and the pin left its cumulative
 * diff the moment a merge commit brought the already-landed main in.
 *
 * The consequence to keep in mind is about WHEN this must run: it can only see
 * a collision while both PRs are open and unmerged, which is why the wiring
 * subscribes to opened, reopened, edited and synchronize rather than to a
 * single event.
 *
 * ## Exit codes — and why "cannot tell" is never 0
 *
 *   0  judged, clean.
 *   1  judged, an earlier open PR already claims a listed path.
 *   2  NOT WIRED — no PR context. A usage/wiring failure, never a verdict
 *      about any PR, and never a statement that the board is clean.
 *
 * A gate that cannot read its input has verified nothing, and exiting 0 there
 * reads as "no violations" — the anti-pattern this repo keeps paying for. The
 * inverse matters too: a mis-wired gate must not read as an accusation, because
 * it would be red on every PR at once for something no author did.
 *
 * A file list that could not be walked to the end is a third thing again. It is
 * reported as UNDETERMINED, loudly, and never silently folded into the clean
 * answer — a degraded list and a complete one must never look alike. It does
 * not turn the PR red, because pagination is not something its author did.
 *
 * ## Why the paths above are unquoted, and the fixtures fictional
 *
 * The dispatch-gates derivation resolves a check family to its script file and
 * scans THAT FILE for quoted path literals as watch hints, comments and test
 * fixtures included. Written the ordinary way, this header would emit a hint
 * per path and fabricate MATCHED leads for cards touching none of this. So repo
 * paths are named unquoted in prose, the only quoted real path is the declared
 * input below — where a hint is exactly right — and every fixture path below
 * names a tree that does not exist, so a hint on one can never match anything.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { isEntrypoint } from './invoked-as.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** The wiring that gives this gate a PR to judge. */
const WIRING_WORKFLOW = '.github/workflows/single-claim-path-guard.yml';

export const EXIT_CLEAN = 0;
export const EXIT_CONFLICT = 1;
export const EXIT_NOT_WIRED = 2;

/**
 * The at-most-one-writer paths.
 *
 * Keep this list LITERAL and TINY. It is not a heuristic and it must not grow
 * into one: every entry asserts that the repo's landing discipline already
 * allows one open claim on that path, and the gate merely makes the existing
 * rule mechanical. An entry that is not already true is a new policy wearing a
 * gate's clothes.
 *
 * Adding one requires a `reason` saying WHY the path admits a single writer —
 * the self-test rejects an entry without one, so the justification cannot be
 * dropped on the way in. Anything that is merely hot (a lock file, a root
 * manifest, a shared registry) does NOT belong here; the header's measurement
 * shows those are ordinary concurrent work, and listing one would produce a
 * steady stream of red on PRs that are both correct.
 */
export const SINGLE_CLAIM_PATHS = [
  {
    path: '.objectui-sha',
    reason:
      'The objectui pin. It holds one sha, so two open PRs writing it are either the same bump twice ' +
      '(the incident behind this gate: a byte-identical hunk under two card numbers) or two different ' +
      'targets racing, and the second to land always conflicts. Pin bumps are routine, which is what ' +
      'makes the collision recurrent rather than a one-off.',
  },
];

/** The declared paths, as a plain array — the form the verdict layer wants. */
export const declaredPaths = () => SINGLE_CLAIM_PATHS.map((entry) => entry.path);

/**
 * The PR context, or null when this process was handed none.
 *
 * Presence, not truthiness, for the same reason the sibling PR-scoped guard
 * uses it: the witness that the workflow really ran this step is the variable
 * existing, not it being non-empty.
 */
export function readPrContext(env) {
  const wired = Object.hasOwn(env, 'PR_NUMBER');
  if (!wired) return null;
  return {
    number: String(env.PR_NUMBER ?? '').trim(),
    repo: String(env.GITHUB_REPOSITORY ?? '').trim(),
    token: String(env.GITHUB_TOKEN ?? '').trim(),
  };
}

/**
 * The verdict: `{ exit, lines }`, pure, so the self-test drives every arm
 * without a network.
 *
 * `others` carries only the open PRs that were found to write a listed path;
 * `undetermined` carries the ones whose file list could not be walked to the
 * end, so the two can never be confused with each other or with a clean board.
 */
export function judge(ctx) {
  if (ctx === null) {
    return {
      exit: EXIT_NOT_WIRED,
      lines: [
        'check:single-claim-paths: NOT WIRED — PR_NUMBER is not set, so this run was handed no pull',
        'request and judged nothing. This is a wiring or usage failure, NOT a verdict: it says nothing',
        'about whether any PR claims a single-claim path, and no author caused it.',
        '',
        `Fix:  run it from the workflow that supplies the context (${WIRING_WORKFLOW}), or locally with`,
        '      PR_NUMBER=123 GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=... node scripts/check-single-claim-paths.mjs',
      ],
    };
  }

  const where = ctx.number ? `PR #${ctx.number}` : 'this PR';
  const claimed = ctx.claimed ?? [];
  const undetermined = ctx.undetermined ?? [];

  if (claimed.length === 0) {
    return {
      exit: EXIT_CLEAN,
      lines: [
        `✓ check:single-claim-paths: ${where} modifies none of the ${declaredPaths().length} declared ` +
          `at-most-one-writer path(s), so there is nothing to serialise.`,
      ],
    };
  }

  const mine = Number(ctx.number);
  const conflicts = ctx.others ?? [];
  const older = conflicts.filter((other) => Number(other.number) < mine);
  const newer = conflicts.filter((other) => Number(other.number) > mine);

  const lines = [];
  const undeterminedLines = undetermined.map(
    (other) =>
      `::warning::UNDETERMINED — the file list of #${other.number} could not be walked to the end, so ` +
      `this run could not prove it does not claim ${claimed.join(', ')}.`,
  );

  for (const other of newer) {
    lines.push(
      `  #${other.number} (newer) also modifies ${other.paths.join(', ')} — it will fail its own run of ` +
        `this guard; ${where} keeps its claim.`,
    );
  }

  if (older.length === 0) {
    return {
      exit: EXIT_CLEAN,
      lines: [
        ...undeterminedLines,
        `✓ check:single-claim-paths: ${where} claims ${claimed.join(', ')}, and no EARLIER open PR does.`,
        ...lines,
        ...(undetermined.length > 0
          ? ['', `  ${undetermined.length} open PR(s) could not be judged — see the UNDETERMINED warning(s) above.`]
          : []),
      ],
    };
  }

  const pointers = older.map(
    (other) =>
      `  - ${other.paths.join(', ')} is already claimed by #${other.number} ` +
      `(${other.htmlUrl}, branch \`${other.headRef}\`${other.draft ? ', draft' : ''})`,
  );

  return {
    exit: EXIT_CONFLICT,
    lines: [
      ...undeterminedLines,
      `::error::${where} modifies a path an earlier open PR already claims: ${claimed.join(', ')}`,
      '',
      `✗ check:single-claim-paths: ${where} modifies an at-most-one-writer path that is already claimed.`,
      '',
      ...pointers,
      ...lines,
      '',
      '  These paths admit ONE open PR at a time. Two open PRs writing one of them are either the same',
      '  physical change under two card numbers, or two different targets racing — and the second to',
      '  land conflicts either way. The card key cannot see this: the Duplicate Fix Guard compares which',
      '  ISSUE each PR claims, and two legitimately different cards can be dischargeable by one commit.',
      '',
      '  If this PR is the duplicate, close it and add anything it uniquely covers to the earlier PR or a',
      '  follow-up issue. If the EARLIER one is abandoned, close it first — this check re-runs on',
      "  'edited' and 'synchronize', and goes green once the conflict is gone. It also goes green on its",
      '  own once the earlier PR MERGES, because the path then leaves this PR’s diff against main.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Collection — the only part that touches the network.
//
// The cheap question first: this PR's own files. When they miss the declared
// list entirely (roughly 99.7% of runs, per the header measurement) this
// returns without looking at another PR at all.
// ---------------------------------------------------------------------------

/** GitHub caps this endpoint at 3000 files; 30 pages of 100 is that ceiling. */
const MAX_PAGES = 30;

async function listPrPaths(api, repo, number) {
  const paths = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await api(`/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
    for (const file of batch) paths.push(file.filename);
    if (batch.length < 100) return { paths, complete: true };
  }
  return { paths, complete: false };
}

export async function collect(ctx, api) {
  const declared = declaredPaths();
  const self = await listPrPaths(api, ctx.repo, ctx.number);
  const claimed = declared.filter((path) => self.paths.includes(path));
  if (claimed.length === 0) return { ...ctx, claimed: [], others: [], undetermined: [] };

  const openPrs = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await api(`/repos/${ctx.repo}/pulls?state=open&per_page=100&page=${page}`);
    openPrs.push(...batch);
    if (batch.length < 100) break;
  }

  const others = [];
  const undetermined = [];
  for (const other of openPrs) {
    if (String(other.number) === String(ctx.number)) continue;
    const theirs = await listPrPaths(api, ctx.repo, other.number);
    const shared = claimed.filter((path) => theirs.paths.includes(path));
    if (shared.length > 0) {
      others.push({
        number: other.number,
        htmlUrl: other.html_url,
        headRef: other.head?.ref ?? '(unknown)',
        draft: Boolean(other.draft),
        paths: shared,
      });
    } else if (!theirs.complete) {
      undetermined.push({ number: other.number });
    }
  }

  return { ...ctx, claimed, others, undetermined };
}

const githubApi = (token) => async (path) => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return response.json();
};

// ---------------------------------------------------------------------------
// Self-test — the verdict layer, the exit-code contract, the declared list's
// own invariants, the short-circuit that makes this affordable, and the wiring.
// ---------------------------------------------------------------------------

function selfTest() {
  const cases = [];
  const t = (name, actual, expected) => cases.push([name, actual, expected]);

  const other = (number, extra = {}) => ({
    number,
    htmlUrl: `https://example.invalid/pull/${number}`,
    headRef: `claude/issue-${number}-slug`,
    draft: false,
    paths: ['.objectui-sha'],
    ...extra,
  });
  const verdict = (patch) => judge({ number: '200', repo: 'o/r', token: 't', claimed: [], others: [], undetermined: [], ...patch });

  // --- The declared list's own invariants. The list is the whole key, so a
  // careless edit to it is the realistic way this gate becomes noise.
  t('every declared entry names a path', SINGLE_CLAIM_PATHS.every((e) => typeof e.path === 'string' && e.path.length > 0), true);
  t('every declared entry carries a reason', SINGLE_CLAIM_PATHS.every((e) => typeof e.reason === 'string' && e.reason.trim().length > 0), true);
  t('the declared list holds no duplicates', new Set(declaredPaths()).size, declaredPaths().length);
  t('the objectui pin is declared (the incident surface)', declaredPaths().includes('.objectui-sha'), true);
  // The measured false-positive paths, kept executable. Listing any of these
  // would fire on ordinary concurrent work: 33, 21 and 15 pairs respectively
  // among the 300 PRs measured in the header.
  t(
    'the measured high-collision paths are NOT declared',
    ['pnpm-lock.yaml', 'package.json', 'packages/plugins/plugin-auth/package.json'].some((p) => declaredPaths().includes(p)),
    false,
  );
  t('the list is tiny — a list that grew past a handful is not a declaration any more', SINGLE_CLAIM_PATHS.length <= 5, true);

  // --- The common path: a PR touching nothing declared is clean and SAYS it
  // judged, so a green here is never confused with a run that did no work.
  const untouched = verdict({ claimed: [] });
  t('a PR touching no declared path is clean', untouched.exit, EXIT_CLEAN);
  t('the clean verdict says what it checked', untouched.lines.join('\n').includes('declared at-most-one-writer path'), true);

  // --- First come, first served. Both arms, because failing the wrong one is
  // the failure mode that would make this gate worse than nothing.
  const later = verdict({ claimed: ['.objectui-sha'], others: [other(100)] });
  t('an EARLIER open PR on a declared path fails THIS PR', later.exit, EXIT_CONFLICT);
  t('the failure names the earlier PR by number', later.lines.join('\n').includes('#100'), true);
  t('the failure names the earlier PR by URL', later.lines.join('\n').includes('https://example.invalid/pull/100'), true);
  t('the failure names the earlier PR branch', later.lines.join('\n').includes('claude/issue-100-slug'), true);
  t('the failure is annotated for the GitHub UI', later.lines.join('\n').includes('::error::'), true);

  const earlier = verdict({ claimed: ['.objectui-sha'], others: [other(900)] });
  t('a NEWER open PR on a declared path leaves THIS PR green', earlier.exit, EXIT_CLEAN);
  t('the green run still names the newer PR', earlier.lines.join('\n').includes('#900'), true);
  t('the newer PR is told it will fail its own run', earlier.lines.join('\n').includes('fail its own run'), true);

  t(
    'with both an earlier and a newer claimant, only the earlier one turns this PR red',
    verdict({ claimed: ['.objectui-sha'], others: [other(100), other(900)] }).exit,
    EXIT_CONFLICT,
  );
  t(
    'claiming a declared path with NO other claimant is clean',
    verdict({ claimed: ['.objectui-sha'], others: [] }).exit,
    EXIT_CLEAN,
  );
  t(
    'a draft claimant still counts — work in flight is exactly what must be seen',
    verdict({ claimed: ['.objectui-sha'], others: [other(100, { draft: true })] }).lines.join('\n').includes('draft'),
    true,
  );

  // --- The failure has to carry the remedy, not just the verdict.
  const failed = later.lines.join('\n');
  t('the failure says the card-keyed gate cannot see this', failed.includes('Duplicate Fix Guard'), true);
  t('the failure tells the reader to close one PR', failed.includes('close it'), true);
  t('the failure says it re-runs and can go green', failed.includes('goes green'), true);

  // --- UNDETERMINED is its own answer. It must never read as clean, and it
  // must never turn an author red for a pagination limit.
  const undet = verdict({ claimed: ['.objectui-sha'], others: [], undetermined: [{ number: 777 }] });
  t('an unwalkable file list does not turn this PR red', undet.exit, EXIT_CLEAN);
  t('an unwalkable file list is reported as UNDETERMINED', undet.lines.join('\n').includes('UNDETERMINED'), true);
  t('the UNDETERMINED report names the PR it could not judge', undet.lines.join('\n').includes('#777'), true);
  t('UNDETERMINED is annotated so it is visible in the UI', undet.lines.join('\n').includes('::warning::'), true);
  t('a clean run with nothing undetermined emits no warning', earlier.lines.join('\n').includes('::warning::'), false);

  // --- Wiring absent: never clean, never an accusation.
  const unwired = judge(readPrContext({}));
  t('no PR context at all exits NOT WIRED', unwired.exit, EXIT_NOT_WIRED);
  t('NOT WIRED says it judged nothing', unwired.lines.join('\n').includes('judged nothing'), true);
  t('NOT WIRED does not read as a clean board', unwired.lines.join('\n').includes('✓'), false);
  t('a present PR number is wired', readPrContext({ PR_NUMBER: '42' })?.number, '42');
  t('an unset environment is not wired', readPrContext({}), null);

  // --- The short-circuit. This is the property that makes the gate affordable,
  // and it is invisible in the verdict layer, so it is pinned here against a
  // recording fake API. Fixture paths name a tree that exists in no repo.
  const calls = [];
  const fakeApi = (files) => async (path) => {
    calls.push(path);
    if (/\/pulls\?/.test(path)) return path.includes('page=1') ? [{ number: 100, html_url: 'u', head: { ref: 'r' }, draft: false }] : [];
    const match = path.match(/\/pulls\/(\d+)\/files/);
    if (match && path.includes('page=1')) return (files[match[1]] ?? []).map((filename) => ({ filename }));
    return [];
  };

  const ctxOf = (number) => ({ number: String(number), repo: 'o/r', token: 't' });
  return (async () => {
    calls.length = 0;
    const quiet = await collect(ctxOf(200), fakeApi({ 200: ['fixture/tree/alpha.ts', 'fixture/tree/beta.ts'] }));
    t('a PR touching no declared path claims nothing', quiet.claimed, []);
    t('...and it costs exactly ONE api call — no other PR is fetched', calls.length, 1);
    t('...and that one call is this PR’s own file list', /\/pulls\/200\/files/.test(calls[0]), true);

    calls.length = 0;
    const loud = await collect(ctxOf(200), fakeApi({ 200: ['.objectui-sha'], 100: ['.objectui-sha'] }));
    t('a PR touching a declared path claims it', loud.claimed, ['.objectui-sha']);
    t('...and the earlier open PR writing it is found', loud.others.map((o) => o.number), [100]);
    t('...and only then are other PRs fetched', calls.length > 1, true);
    t('the collected conflict turns into a red verdict', judge({ ...loud }).exit, EXIT_CONFLICT);

    calls.length = 0;
    const alone = await collect(ctxOf(200), fakeApi({ 200: ['.objectui-sha'], 100: ['fixture/tree/gamma.ts'] }));
    t('an open PR touching OTHER paths is not a conflict', alone.others, []);
    t('...so a lone claimant stays green', judge({ ...alone }).exit, EXIT_CLEAN);

    // --- The wiring. A gate whose workflow step is deleted or whose trigger
    // loses an activity type is not a weaker gate, it is a silent one.
    const wiringPath = join(ROOT, WIRING_WORKFLOW);
    const wiring = existsSync(wiringPath) ? readFileSync(wiringPath, 'utf8') : '';
    const wiringLines = wiring.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
    t('the wiring workflow exists', wiring !== '', true);
    t('the wiring workflow runs this script', wiring.includes('node scripts/check-single-claim-paths.mjs'), true);
    t('the wiring passes the PR number (the wired-ness witness)', /PR_NUMBER:/.test(wiring), true);
    t('the wiring passes a token, without which no file list can be read', /GITHUB_TOKEN:/.test(wiring), true);
    for (const activity of ['opened', 'reopened', 'edited', 'synchronize']) {
      t(`the wiring subscribes to '${activity}' (a collision only exists while both PRs are open)`, new RegExp(`types:\\s*\\[[^\\]]*\\b${activity}\\b[^\\]]*\\]`).test(wiring), true);
    }
    // Both permission assertions read the COMMENT-STRIPPED workflow, and that
    // is not tidiness — it is a hole this file's own ablation sweep found. The
    // header comment above the permissions block has to be able to say the
    // words contents read to explain why the scope is there, and a naive scan
    // of the whole file therefore passed with the real grant DELETED: a phantom
    // check, green because of the prose describing it. Only executable lines
    // are scanned.
    t('the wiring can read pull requests', /pull-requests:\s*read/.test(wiringLines), true);
    // Naming a permissions block sets every unlisted scope to none, and this
    // job checks the repo out to reach this script. Without the contents scope
    // it dies in checkout, before judging anything.
    t('the wiring can read contents, which its checkout step requires', /contents:\s*read/.test(wiringLines), true);
    t('the guard job invokes no package manager (it needs node and nothing else)', /\b(pnpm|corepack|yarn|npm)\b/.test(wiringLines), false);

    // --- The older gate must still be there, unweakened. This gate ADDS a
    // second question; it does not replace the card-keyed one.
    const siblingPath = join(ROOT, '.github/workflows/duplicate-fix-guard.yml');
    const sibling = existsSync(siblingPath) ? readFileSync(siblingPath, 'utf8') : '';
    t('the card-keyed duplicate gate still exists', sibling !== '', true);
    t('...and still asks its own question', sibling.includes('No other open PR may claim the same issue'), true);

    let failedCount = 0;
    for (const [name, actual, expected] of cases) {
      const ok = JSON.stringify(actual) === JSON.stringify(expected);
      if (!ok) failedCount++;
      console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
    }
    if (failedCount) {
      console.error(`✗ check-single-claim-paths self-test: ${failedCount} of ${cases.length} case(s) failed.`);
      process.exit(1);
    }
    console.log(`✓ check-single-claim-paths self-test: ${cases.length} cases pass.`);
  })();
}

// The basename comparison, as in the sibling guard: a future importer must not
// trigger a judgment as a side effect.
const isMain = isEntrypoint(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) {
    await selfTest();
  } else {
    const ctx = readPrContext(process.env);
    const resolved = ctx === null ? null : await collect(ctx, githubApi(ctx.token));
    const result = judge(resolved);
    const emit = result.exit === EXIT_CLEAN ? console.log : console.error;
    for (const line of result.lines) emit(line);
    process.exit(result.exit);
  }
}
