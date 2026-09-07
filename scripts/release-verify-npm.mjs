#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * release-verify-npm -- after `changeset publish`, prove EVERY published
 * package is readable on npm, and keep failing closed when one is not.
 *
 *   node scripts/release-verify-npm.mjs              # from release.yml
 *   node scripts/release-verify-npm.mjs --self-test  # verify this logic
 *   node scripts/release-verify-npm.mjs --dry-run    # print the target set only
 *
 * ## The two defects this replaces (#15321)
 *
 * The last thing the `publish` job used to do was one `npm view`:
 *
 *     if ! npm view "@objectstack/cli@$VERSION" version >/dev/null 2>&1; then
 *       echo "publish ran but @objectstack/cli@$VERSION is still not on npm"
 *       exit 1
 *     fi
 *
 * On the 17.3.0 release (run 8330, job 100996109699) that step exited 1 on a
 * release that had succeeded COMPLETELY -- all 69 packages were on npm, checked
 * one by one afterwards.
 *
 * **① It raced the registry.** npm committed `@objectstack/cli@17.3.0` at
 * 10:53:25.108Z; the check read at 10:53:32, seven seconds later, and got an
 * absence. npm's write path and its CDN-fronted read path are eventually
 * consistent, and seven seconds is well inside that window. One shot,
 * immediately after a 69-package burst, makes every release a bet on how fast
 * the read path settles.
 *
 * **② It looked at 1 package of 69.** The one thing it verified was
 * `@objectstack/cli`. Had a package genuinely failed to publish, this step
 * could not have seen it -- and the false red on `cli` would have MASKED it.
 * That is the more expensive half: it is the case the step exists for. Measured
 * on the same release, `@objectstack/runtime` did not commit until 11:00:32, so
 * between 10:53 and 11:00 the fixed group really was partially readable and
 * nothing was looking.
 *
 * ## Where the retry budget comes from
 *
 * Not a guess -- npm's own `time` field on that release. The burst took
 * ~8 minutes to commit end to end, and the spread from the FIRST read
 * (`cli`, 10:53:25, which is when this verification starts) to the LAST commit
 * (`runtime`, 11:00:32) is 7m07s. `RETRY_BUDGET_MS` is 15 minutes: a little
 * over twice the observed spread, because burst latency scales with whatever
 * else the registry is absorbing and the cost of being wrong in the short
 * direction is a false red on a good release. The cost in the other direction
 * is that a GENUINELY broken publish is reported 15 minutes later -- paid once,
 * by a job that has already spent longer than that building.
 *
 * ## ⛔ It still fails CLOSED, and that is the whole point
 *
 * The retry absorbs LATENCY, never absence. A package still missing when the
 * budget is exhausted exits non-zero, named. So does a registry that could not
 * be read at all: "we could not tell" is not "it is there". There is no
 * `|| true` here, no downgrade to a warning, and no path that reports success
 * without having read every target.
 *
 * The vacuity direction is guarded too: an EMPTY target set is a hard failure,
 * not a green run of zero checks. "Everything published is readable" is worth
 * nothing when the derivation quietly yields nothing, and that fixed point --
 * an empty finding set -- is this repo's standing failure shape.
 *
 * ## Why the target set is DERIVED from the workspace
 *
 * The set is every non-private workspace package, each at the version its own
 * manifest declares. Never a transcribed list: this repo has 69 publishable
 * packages today and the count moves.
 *
 * The alternative source is `changeset publish`'s stdout. It was rejected on
 * the direction it fails in. Parsing the publisher's own report is
 * self-referential -- if the publish died early, printed nothing, or changed
 * its output format, the parse yields an EMPTY set and the verification passes
 * having checked nothing. That is the silent-success direction, and it is
 * exactly the class of bug this card is about.
 *
 * The workspace derivation is independent of the publish's belief: it is the
 * set that OUGHT to be on npm, computed from the tree the guard step already
 * proved matches `github.sha`. Its failure direction is loud. If it ever
 * OVER-selects -- a package the publish deliberately skipped -- the run goes
 * red naming that package, which is noticed within one release. It cannot
 * UNDER-select against `changeset publish`, whose own publishable set is the
 * same workspace filter: a package outside the workspace is not something this
 * repo can publish at all.
 *
 * Two gates keep the derivation honest, and neither is this one:
 *   - `scripts/check-changeset-fixed.mjs` (run by this same job, before the
 *     build) asserts every non-private workspace package is in the Changesets
 *     `fixed` group, so the set and the lockstep group cannot diverge.
 *   - `.changeset/config.json` `ignore` is empty, and a package this repo does
 *     NOT publish is marked `private: true` in its own manifest -- the filter
 *     below reads exactly that field. A future non-empty `ignore` would make
 *     this over-select; that shows up as a named red, not as a silent pass.
 *
 * ## Reading the registry
 *
 * The probe is the abbreviated packument -- `application/vnd.npm.install-v1+json`
 * against `<registry>/<name>` -- and asks whether the version key is present.
 * That is semantically what `npm view <pkg>@<version> version` does and it hits
 * the same CDN-fronted read path, so the thing being measured is the thing
 * consumers see. It is one HTTP request rather than an npm subprocess, which is
 * what makes checking 69 of them affordable.
 *
 * Probes run SEQUENTIALLY. #2191 is this repo's standing lesson about bursts of
 * concurrent requests against a shared backend, and the cost here is small:
 * only the first round probes the whole set, and every later round probes just
 * the packages still missing.
 *
 * dispatch-gates: no-path-population -- the self-test drives synthetic package maps and a stub registry; the live workspace read and the network read both belong to the release run, which no pull request schedules
 */

import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isEntrypoint } from './invoked-as.mjs';
import { listWorkspacePackages } from './release-github-releases.mjs';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` as a self-test's only success condition makes "every
// case held" and "the cases never ran" print the same line -- which is the same
// class of defect as the one this script fixes, so it is closed here the way
// PR #13487 validated on check-doc-authoring: what is pinned is the registered
// NAMES, not a number. Every section opens with `battery('<name>')`, every
// assertion is attributed to the battery most recently opened, and the floor
// requires the OPENED set to equal the DECLARED set with each battery at or
// above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows. A set difference says WHICH
// battery stopped; a count says only that something did.
//
// The counts are a FLOOR, not an equality -- adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  '1. The backoff schedule is bounded and spends its whole budget': 8,
  '2. The #15321 false red: a cold read seven seconds after the commit': 6,
  '3. The masked defect: runtime never lands, and cli is fine': 6,
  '4. Absence after the budget is a HARD failure, never softened': 5,
  '5. An unreadable registry is a failure, not a pass': 4,
  '6. Targets are derived, and an empty derivation is refused': 7,
  '7. The failure text names what is absent, and only that': 6,
  '8. The registry probe: present, absent, and unreadable': 6,
  '9. The job summary is written SYNCHRONOUSLY, before process.exit': 4,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 9;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

/** Cases registered per battery: `battery()` opens one, `registerCase()` files into it. */
const batteryCases = new Map();
let openBattery = null;

/** Open a battery. Every assertion after this line is attributed to it. */
function battery(name) {
  openBattery = name;
}

/** Called by the self-test's own assertion sink, once per assertion. */
function registerCase() {
  const name = openBattery ?? UNATTRIBUTED_BATTERY;
  batteryCases.set(name, (batteryCases.get(name) ?? 0) + 1);
}

/**
 * The floor: every declared battery RAN, and ran its cases (#13489).
 *
 * Evaluated after every battery has had its chance and BEFORE the verdict, so
 * the success line can only be printed by a run in which the set of batteries
 * that registered assertions EQUALS the set declared.
 */
function batteryFloorFailures() {
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batteryCases) {
    if (declared.includes(name)) continue;
    problems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (problems.length) {
    problems.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** See "Where the retry budget comes from" in the header — 7m07s observed, 15m budgeted. */
export const RETRY_BUDGET_MS = 15 * 60 * 1000;

/** First wait after the first round comes back short. */
export const FIRST_DELAY_MS = 5 * 1000;

/** The backoff never waits longer than this between rounds. */
export const CAP_DELAY_MS = 60 * 1000;

/** Per-request ceiling, so one hung socket cannot eat the whole budget. */
export const REQUEST_TIMEOUT_MS = 15 * 1000;

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const USER_AGENT = 'objectstack-release-verify-npm';

/**
 * The package whose presence in the derived set is asserted before any probing.
 *
 * Not a transcribed list and not a count — one anchor whose absence means the
 * derivation broke rather than that the workspace shrank. `@objectstack/cli` is
 * the package `release-integrity` audits, the one the approval screen names,
 * and the one the guard step reads out of the object database, so a target set
 * that does not contain it is not describing this release.
 */
export const ANCHOR_PACKAGE = '@objectstack/cli';

/** A registry read did not produce an answer. Never green, never a clean red. */
export class RegistryUnreadable extends Error {}

// ---------------------------------------------------------------------------
// The backoff schedule
// ---------------------------------------------------------------------------

/**
 * The waits between probing rounds, in order, summing to exactly `budgetMs`.
 *
 * Exponential from `firstMs`, capped at `capMs`, with the final wait truncated
 * so the schedule never overspends. A budget of 0 yields no waits at all, which
 * is the SHAPE THE OLD STEP HAD: one round, then a verdict. The self-test drives
 * the #15321 repro through exactly that, so the old behaviour is a parameter of
 * this code rather than a second implementation nothing holds to it.
 *
 * @param {number} budgetMs
 * @param {{ firstMs?: number, capMs?: number }} [options]
 * @returns {number[]}
 */
export function backoffDelays(budgetMs, { firstMs = FIRST_DELAY_MS, capMs = CAP_DELAY_MS } = {}) {
  const delays = [];
  let next = firstMs;
  let spent = 0;
  while (spent < budgetMs) {
    const delay = Math.min(next, capMs, budgetMs - spent);
    if (delay <= 0) break;
    delays.push(delay);
    spent += delay;
    next = Math.min(next * 2, capMs);
  }
  return delays;
}

// ---------------------------------------------------------------------------
// The target set
// ---------------------------------------------------------------------------

/**
 * Every package this release owes the registry, at the version its own manifest
 * declares.
 *
 * Membership comes from `listWorkspacePackages` in
 * `scripts/release-github-releases.mjs` — the release lane's existing answer to
 * "which packages are publishable", itself built on
 * `scripts/workspace-enumerator.mjs`, this repo's one parse of
 * `pnpm-workspace.yaml`. Reusing it rather than writing a fourth private copy
 * of `manifest.private !== true` is the point: two release-lane scripts
 * disagreeing about which packages a release contains is its own defect.
 *
 * The version is read PER PACKAGE rather than assumed from one release number.
 * The Changesets `fixed` group makes those equal today and
 * `check-changeset-fixed.mjs` keeps it that way, so this is not a disagreement
 * with that invariant — it is a derivation that does not depend on it.
 *
 * @param {Map<string, { name: string; version: string; dir: string }>} packages
 * @returns {{ name: string; version: string }[]} sorted by name
 */
export function resolveVerificationTargets(packages) {
  const targets = [];
  for (const pkg of packages.values()) {
    if (!pkg || !pkg.name) continue;
    targets.push({ name: pkg.name, version: pkg.version });
  }
  return targets.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Refuse a target set that cannot mean what a green run would claim.
 *
 * Returns the problems; empty means the set is usable. Both legs are vacuity
 * guards, not sanity theatre: an empty set makes "everything is readable" a
 * true statement about nothing, and a set missing a version cannot be probed at
 * all — reporting either as a pass is the failure mode this script exists to
 * remove.
 *
 * @param {{ name: string; version: string }[]} targets
 * @param {{ anchor?: string, releaseVersion?: string }} [options]
 * @returns {string[]}
 */
export function targetSetProblems(targets, { anchor = ANCHOR_PACKAGE, releaseVersion } = {}) {
  const problems = [];
  if (!Array.isArray(targets) || targets.length === 0) {
    problems.push(
      'the publishable-package derivation produced NO targets. Verifying zero packages would report '
        + '"every published package is on npm" having read nothing — refusing to pass vacuously.',
    );
    return problems;
  }
  for (const target of targets) {
    if (!target.version) {
      problems.push(`${target.name} declares no version in its manifest, so there is nothing to look up on npm.`);
    }
  }
  const anchored = targets.find((t) => t.name === anchor);
  if (!anchored) {
    problems.push(
      `${anchor} is not in the derived target set. It is the package this workflow audits, names on the `
        + 'approval screen and reads out of the object database, so a set without it is not describing '
        + 'this release — the derivation is broken, not the workspace.',
    );
  } else if (releaseVersion && anchored.version !== releaseVersion) {
    problems.push(
      `${anchor} carries ${anchored.version} in the workspace but this run was approved for `
        + `${releaseVersion}. Refusing to report on a version nobody approved.`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Reading the registry
// ---------------------------------------------------------------------------

/**
 * Is `version` of `name` readable on the registry right now?
 *
 * Resolves `true` / `false`; THROWS `RegistryUnreadable` when the registry did
 * not answer. The three outcomes are kept apart on purpose — "absent" and
 * "could not ask" are both non-green, but only one of them names a package the
 * repair dispatch can act on.
 *
 * @param {string} name
 * @param {string} version
 * @param {{ registry?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<boolean>}
 */
export async function probeVersion(name, version, options = {}) {
  const {
    registry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY || DEFAULT_REGISTRY,
    fetchImpl = fetch,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = options;
  const url = `${registry.replace(/\/$/, '')}/${name.replace('/', '%2F')}`;
  let res;
  try {
    res = await fetchImpl(url, {
      headers: {
        // The abbreviated packument: every published version key and the
        // dist-tags, at a fraction of the full document's size.
        Accept: 'application/vnd.npm.install-v1+json',
        'User-Agent': USER_AGENT,
        // Ask the CDN for a revalidated copy. It is not a guarantee — the whole
        // premise here is that the read path settles on its own schedule — but
        // a request that does NOT ask has strictly worse odds each round.
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new RegistryUnreadable(`GET ${url} — ${err.message}`);
  }
  // A package with no versions at all 404s. That is an ABSENCE, not an
  // unreadable registry: it is precisely the answer "this is not published yet".
  if (res.status === 404) return false;
  if (!res.ok) throw new RegistryUnreadable(`GET ${url} → HTTP ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new RegistryUnreadable(`GET ${url} → response was not JSON (${err.message})`);
  }
  if (!body || typeof body !== 'object' || typeof body.versions !== 'object' || body.versions === null) {
    throw new RegistryUnreadable(`GET ${url} → no 'versions' map in the response`);
  }
  return Object.prototype.hasOwnProperty.call(body.versions, version);
}

// ---------------------------------------------------------------------------
// The verification loop
// ---------------------------------------------------------------------------

/** The production wait. Injected in the self-test so no case sleeps. */
const realSleep = (ms) => new Promise((resolve_) => { setTimeout(resolve_, ms); });

/**
 * Probe every target, retrying only what is still missing, until the set is
 * empty or the budget is spent.
 *
 * @param {object} opts
 * @param {{ name: string, version: string }[]} opts.targets
 * @param {(name: string, version: string) => Promise<boolean>} opts.probe
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {number} [opts.budgetMs] 0 reproduces the old one-shot step
 * @param {number} [opts.firstDelayMs]
 * @param {number} [opts.capDelayMs]
 * @param {(line: string) => void} [opts.log]
 * @returns {Promise<{ ok: boolean, missing: { name: string, version: string, reason: string }[],
 *                     rounds: number, waitedMs: number, checked: number }>}
 */
export async function verifyAllPublished({
  targets,
  probe,
  sleep = realSleep,
  budgetMs = RETRY_BUDGET_MS,
  firstDelayMs = FIRST_DELAY_MS,
  capDelayMs = CAP_DELAY_MS,
  log = () => {},
}) {
  const problems = targetSetProblems(targets);
  if (problems.length) throw new Error(problems.join(' '));

  const delays = backoffDelays(budgetMs, { firstMs: firstDelayMs, capMs: capDelayMs });
  const reasons = new Map();
  let pending = [...targets];
  let rounds = 0;
  let waitedMs = 0;

  for (;;) {
    rounds += 1;
    const stillPending = [];
    for (const target of pending) {
      const key = `${target.name}@${target.version}`;
      let present;
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential by design (#2191)
        present = await probe(target.name, target.version);
      } catch (err) {
        reasons.set(key, `registry unreadable — ${err instanceof Error ? err.message : String(err)}`);
        stillPending.push(target);
        continue;
      }
      if (present) {
        reasons.delete(key);
        continue;
      }
      reasons.set(key, 'not on the registry');
      stillPending.push(target);
    }
    pending = stillPending;

    if (pending.length === 0) {
      return { ok: true, missing: [], rounds, waitedMs, checked: targets.length };
    }
    if (rounds > delays.length) break;

    const delay = delays[rounds - 1];
    log(
      `  ${pending.length} of ${targets.length} package(s) not readable yet after round ${rounds}; `
        + `waiting ${Math.round(delay / 1000)}s (${Math.round((waitedMs + delay) / 1000)}s of `
        + `${Math.round(budgetMs / 1000)}s budget spent).`,
    );
    // eslint-disable-next-line no-await-in-loop -- the backoff IS the loop
    await sleep(delay);
    waitedMs += delay;
  }

  return {
    ok: false,
    missing: pending.map((t) => ({ ...t, reason: reasons.get(`${t.name}@${t.version}`) ?? 'not on the registry' })),
    rounds,
    waitedMs,
    checked: targets.length,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * The failure text. Names the packages that are ABSENT — never a package that
 * was fine.
 *
 * The old message named `@objectstack/cli` on a release where `cli` was the one
 * package definitely published, so whoever picked it up went and looked at a
 * healthy package. The repair channel is a `workflow_dispatch` with `force`, so
 * the message has to hand that dispatch something to act on.
 *
 * Line 1 is the Actions annotation and is deliberately ONE line: the runner
 * parses `::error::` at line start only, and a multi-line annotation would need
 * escaping that makes the text unreadable in the log. The detail block below it
 * is ordinary output.
 *
 * @param {{ ok: boolean, missing: { name: string, version: string, reason: string }[],
 *           rounds: number, waitedMs: number, checked: number }} result
 * @returns {string}
 */
export function formatFailure(result) {
  const { missing, rounds, waitedMs, checked } = result;
  const names = missing.map((m) => `${m.name}@${m.version}`);
  const waitedS = Math.round(waitedMs / 1000);
  const lines = [];
  lines.push(
    `::error::publish ran but ${missing.length} of ${checked} package(s) are still not readable on npm `
      + `after ${rounds} round(s) over ${waitedS}s: ${names.join(', ')}`,
  );
  lines.push('');
  lines.push(`Not readable after the full retry budget (${waitedS}s, ${rounds} rounds):`);
  for (const m of missing) lines.push(`  - ${m.name}@${m.version} — ${m.reason}`);
  lines.push('');
  lines.push(
    'The other '
      + String(checked - missing.length)
      + ' package(s) ARE readable, so this is a partial publish, not a failed one.',
  );
  lines.push(
    'Repair: re-run Release via workflow_dispatch with `force: true`. `changeset publish` skips versions '
      + 'the registry already has, so it republishes only what is listed above — a repair, never a duplicate.',
  );
  return lines.join('\n');
}

/**
 * The success text. Says what was checked and how long the read path took to
 * settle, so the next person to tune `RETRY_BUDGET_MS` has measurements rather
 * than this docblock.
 *
 * @param {{ rounds: number, waitedMs: number, checked: number }} result
 * @returns {string}
 */
export function formatSuccess(result) {
  const { rounds, waitedMs, checked } = result;
  const settled = waitedMs === 0
    ? 'on the first read'
    : `after ${Math.round(waitedMs / 1000)}s of backoff across ${rounds} rounds`;
  return `::notice::all ${checked} published package(s) are readable on npm — settled ${settled}.`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * @param {{ argv?: string[], env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<number>} process exit code
 */
export async function main({ argv = process.argv.slice(2), env = process.env } = {}) {
  const targets = resolveVerificationTargets(listWorkspacePackages());
  const problems = targetSetProblems(targets, { releaseVersion: env.RELEASE_VERSION });
  if (problems.length) {
    console.error(`::error::cannot verify the publish — ${problems[0]}`);
    for (const problem of problems.slice(1)) console.error(`  - ${problem}`);
    return 1;
  }

  if (argv.includes('--dry-run')) {
    console.log(`${targets.length} package(s) would be verified on npm:`);
    for (const t of targets) console.log(`  ${t.name}@${t.version}`);
    return 0;
  }

  console.log(
    `Verifying ${targets.length} published package(s) on npm, with up to `
      + `${Math.round(RETRY_BUDGET_MS / 1000)}s of bounded backoff for the registry's read path to settle.`,
  );

  const result = await verifyAllPublished({
    targets,
    probe: (name, version) => probeVersion(name, version),
    log: (line) => console.log(line),
  });

  if (!result.ok) {
    console.error(formatFailure(result));
    appendStepSummary(env, [
      '### npm publish verification: FAILED',
      '',
      `${result.missing.length} of ${result.checked} package(s) not readable after `
        + `${Math.round(result.waitedMs / 1000)}s:`,
      '',
      ...result.missing.map((m) => `- \`${m.name}@${m.version}\` — ${m.reason}`),
    ]);
    return 1;
  }

  console.log(formatSuccess(result));
  appendStepSummary(env, [
    '### npm publish verification: OK',
    '',
    `All ${result.checked} published package(s) readable on npm`
      + (result.waitedMs === 0
        ? ' on the first read.'
        : ` after ${Math.round(result.waitedMs / 1000)}s of backoff (${result.rounds} rounds).`),
  ]);
  return 0;
}

/**
 * Best-effort append to the job summary; never the reason a release fails.
 *
 * ⚠️ SYNCHRONOUS on purpose. A `import('node:fs').then(...)` here is a floating
 * promise, and the caller's `process.exit(await main())` discards pending
 * microtasks — so the lazy form wrote the summary on NEITHER path while
 * reading, in every review, exactly like one that did.
 */
function appendStepSummary(env, lines) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  try {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  } catch {
    /* a summary that cannot be written is not a publish failure */
  }
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/**
 * A registry stub with a settling read path.
 *
 * `coldReads` is how many times a package answers ABSENT before it starts
 * answering present — the 17.3.0 shape, where the version was committed and the
 * read had not caught up. `never` is a package that genuinely did not publish.
 *
 * @param {{ coldReads?: Record<string, number>, never?: string[], throwsFor?: Record<string, string> }} spec
 */
function stubRegistry(spec = {}) {
  const remaining = new Map(Object.entries(spec.coldReads ?? {}));
  const never = new Set(spec.never ?? []);
  const throwsFor = new Map(Object.entries(spec.throwsFor ?? {}));
  const calls = [];
  const probe = async (name, version) => {
    calls.push(`${name}@${version}`);
    const boom = throwsFor.get(name);
    if (boom) throw new RegistryUnreadable(boom);
    if (never.has(name)) return false;
    const left = remaining.get(name) ?? 0;
    if (left > 0) {
      remaining.set(name, left - 1);
      return false;
    }
    return true;
  };
  return { probe, calls };
}

/** A clock that records what it was asked to wait for and waits for none of it. */
function stubSleep() {
  const waits = [];
  return { sleep: async (ms) => { waits.push(ms); }, waits };
}

/** Build a workspace map of the shape `listWorkspacePackages` returns. */
function stubPackages(entries) {
  return new Map(entries.map((e) => [e.name, { name: e.name, version: e.version, dir: `/tmp/${e.name}` }]));
}

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798).
let selfTestReachedVerdict = false;

export async function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => {
    registerCase();
    return cases.push({ name, ok: Boolean(ok), detail });
  };

  // The release's real shape, small enough to read: the anchor, a package that
  // committed early, and the one that committed last.
  const RELEASE = [
    { name: '@objectstack/cli', version: '17.3.0' },
    { name: '@objectstack/spec', version: '17.3.0' },
    { name: '@objectstack/runtime', version: '17.3.0' },
  ];

  // ── 1. The backoff schedule ───────────────────────────────────────────────
  battery('1. The backoff schedule is bounded and spends its whole budget');
  {
    const zero = backoffDelays(0);
    t('a zero budget yields NO waits — one round, then a verdict (the old step)', zero.length === 0, JSON.stringify(zero));

    const d = backoffDelays(RETRY_BUDGET_MS);
    const sum = d.reduce((a, b) => a + b, 0);
    t('the schedule spends exactly the budget, never more', sum === RETRY_BUDGET_MS, `sum=${sum} budget=${RETRY_BUDGET_MS}`);
    t('no single wait exceeds the cap', d.every((x) => x <= CAP_DELAY_MS), JSON.stringify(d.slice(0, 6)));
    // All but the LAST, which is truncated to land on the budget exactly.
    const body = d.slice(0, -1);
    t('the waits never shrink, up to the truncated final one', body.every((x, i) => i === 0 || body[i - 1] <= x), JSON.stringify(d.slice(-4)));
    t('it starts at FIRST_DELAY_MS', d[0] === FIRST_DELAY_MS, String(d[0]));
    t('it retries more than once — a budget spent on one wait is not backoff', d.length > 1, String(d.length));

    // The measured worst case from #15321: 7m07s from the first read to the
    // last commit. The budget has to be able to sit through it.
    const OBSERVED_SPREAD_MS = (7 * 60 + 7) * 1000;
    t('the budget outlasts the 7m07s spread measured on the 17.3.0 burst', RETRY_BUDGET_MS > OBSERVED_SPREAD_MS, `${RETRY_BUDGET_MS} > ${OBSERVED_SPREAD_MS}`);

    const tiny = backoffDelays(7000, { firstMs: 5000, capMs: 60000 });
    t('a budget smaller than two waits is truncated, not overspent', tiny.reduce((a, b) => a + b, 0) === 7000, JSON.stringify(tiny));
  }

  // ── 2. The #15321 repro ───────────────────────────────────────────────────
  battery('2. The #15321 false red: a cold read seven seconds after the commit');
  {
    // THE reading. `cli@17.3.0` was committed at 10:53:25.108 and read at
    // 10:53:32 — present on npm, absent to the reader. One cold read.
    const oldShape = stubRegistry({ coldReads: { '@objectstack/cli': 1 } });
    const oldResult = await verifyAllPublished({
      targets: [RELEASE[0]],           // the old step looked at cli and nothing else
      probe: oldShape.probe,
      sleep: stubSleep().sleep,
      budgetMs: 0,                     // ...and it did not retry
    });
    t('OLD SHAPE reds on a package that IS published', oldResult.ok === false, JSON.stringify(oldResult.missing));
    t('OLD SHAPE names @objectstack/cli — the package that was fine', oldResult.missing[0].name === '@objectstack/cli', JSON.stringify(oldResult.missing));
    t('OLD SHAPE read the registry exactly once', oldShape.calls.length === 1, JSON.stringify(oldShape.calls));

    // Same registry, same cold read, this script's parameters. `runtime` stays
    // cold for 11 rounds — the schedule reaches ~7m10s of waiting by then,
    // which is the 7m07s the 17.3.0 burst actually took to commit it.
    const newShape = stubRegistry({ coldReads: { '@objectstack/cli': 1, '@objectstack/spec': 2, '@objectstack/runtime': 11 } });
    const clock = stubSleep();
    const newResult = await verifyAllPublished({
      targets: RELEASE,
      probe: newShape.probe,
      sleep: clock.sleep,
      budgetMs: RETRY_BUDGET_MS,
    });
    t('NEW SHAPE absorbs the cold read and goes GREEN', newResult.ok === true, JSON.stringify(newResult));
    t('NEW SHAPE waited, rather than concluding on the first read', newResult.rounds > 1 && clock.waits.length > 0, `rounds=${newResult.rounds} waits=${clock.waits.length}`);
    t('NEW SHAPE checked all three packages, not just the anchor', newResult.checked === 3, String(newResult.checked));
  }

  // ── 3. The masked defect ──────────────────────────────────────────────────
  battery('3. The masked defect: runtime never lands, and cli is fine');
  {
    // The case the step exists for and could not see: cli readable immediately,
    // one package of the fixed group genuinely absent.
    const reg = stubRegistry({ never: ['@objectstack/runtime'] });
    const oldResult = await verifyAllPublished({
      targets: [RELEASE[0]],
      probe: reg.probe,
      sleep: stubSleep().sleep,
      budgetMs: 0,
    });
    t('OLD SHAPE reports GREEN on a partial publish', oldResult.ok === true, JSON.stringify(oldResult));
    t('OLD SHAPE never even asked about @objectstack/runtime', !reg.calls.some((c) => c.startsWith('@objectstack/runtime')), JSON.stringify(reg.calls));

    const reg2 = stubRegistry({ never: ['@objectstack/runtime'] });
    const newResult = await verifyAllPublished({
      targets: RELEASE,
      probe: reg2.probe,
      sleep: stubSleep().sleep,
      budgetMs: 60_000,
    });
    t('NEW SHAPE reds on the partial publish', newResult.ok === false, JSON.stringify(newResult.missing));
    t('NEW SHAPE names @objectstack/runtime', newResult.missing.map((m) => m.name).includes('@objectstack/runtime'), JSON.stringify(newResult.missing));
    t('NEW SHAPE does NOT name the packages that are fine', newResult.missing.length === 1, JSON.stringify(newResult.missing));
    t('retries probe only what is still missing', reg2.calls.filter((c) => c.startsWith('@objectstack/cli')).length === 1, JSON.stringify(reg2.calls.slice(0, 8)));
  }

  // ── 4. Fail closed ────────────────────────────────────────────────────────
  battery('4. Absence after the budget is a HARD failure, never softened');
  {
    const reg = stubRegistry({ never: ['@objectstack/spec', '@objectstack/runtime'] });
    const clock = stubSleep();
    const result = await verifyAllPublished({
      targets: RELEASE,
      probe: reg.probe,
      sleep: clock.sleep,
      budgetMs: 30_000,
    });
    t('the budget being spent does not turn absence into success', result.ok === false, JSON.stringify(result.missing));
    t('every wait in the schedule was actually taken', clock.waits.reduce((a, b) => a + b, 0) === 30_000, JSON.stringify(clock.waits));
    t('the round count exceeds the wait count by exactly one', result.rounds === clock.waits.length + 1, `${result.rounds} vs ${clock.waits.length}`);
    t('both absent packages are named', result.missing.length === 2, JSON.stringify(result.missing));
    t('the failure text is not a warning and not empty', formatFailure(result).includes('still not readable on npm'), formatFailure(result).split('\n')[0].slice(12, 60));
  }

  // ── 5. Unreadable is not green ────────────────────────────────────────────
  battery('5. An unreadable registry is a failure, not a pass');
  {
    const reg = stubRegistry({ throwsFor: { '@objectstack/spec': 'GET … → HTTP 503' } });
    const result = await verifyAllPublished({
      targets: RELEASE,
      probe: reg.probe,
      sleep: stubSleep().sleep,
      budgetMs: 20_000,
    });
    t('a registry that never answers is NOT reported as published', result.ok === false, JSON.stringify(result.missing));
    t('the unreadable package is named', result.missing[0].name === '@objectstack/spec', JSON.stringify(result.missing));
    t('and the reason says the registry was unreadable, not that it was absent', result.missing[0].reason.includes('registry unreadable'), result.missing[0].reason);
    t('a throw does not abandon the other packages', result.missing.length === 1, JSON.stringify(result.missing));
  }

  // ── 6. Derivation ─────────────────────────────────────────────────────────
  battery('6. Targets are derived, and an empty derivation is refused');
  {
    const derived = resolveVerificationTargets(stubPackages([
      { name: '@objectstack/runtime', version: '17.3.0' },
      { name: '@objectstack/cli', version: '17.3.0' },
    ]));
    t('the derivation returns every package it is handed', derived.length === 2, JSON.stringify(derived));
    t('and sorts them, so the log and the failure list are stable', derived[0].name === '@objectstack/cli', JSON.stringify(derived.map((d) => d.name)));
    t('each target carries the version from its OWN manifest', derived.every((d) => d.version === '17.3.0'), JSON.stringify(derived));

    t('an empty target set is REFUSED, never a vacuous pass', targetSetProblems([]).length === 1, JSON.stringify(targetSetProblems([])));
    t(
      'a target set without the anchor package is refused',
      targetSetProblems([{ name: '@objectstack/spec', version: '17.3.0' }]).some((p) => p.includes(ANCHOR_PACKAGE)),
      JSON.stringify(targetSetProblems([{ name: '@objectstack/spec', version: '17.3.0' }])),
    );
    t(
      'a versionless manifest is refused rather than looked up as undefined',
      targetSetProblems([{ name: ANCHOR_PACKAGE, version: '' }]).some((p) => p.includes('no version')),
      JSON.stringify(targetSetProblems([{ name: ANCHOR_PACKAGE, version: '' }])),
    );
    t(
      'a workspace disagreeing with the approved version is refused',
      targetSetProblems([{ name: ANCHOR_PACKAGE, version: '17.3.0' }], { releaseVersion: '17.4.0' }).some((p) => p.includes('nobody approved')),
      JSON.stringify(targetSetProblems([{ name: ANCHOR_PACKAGE, version: '17.3.0' }], { releaseVersion: '17.4.0' })),
    );
  }

  // ── 7. The message ────────────────────────────────────────────────────────
  battery('7. The failure text names what is absent, and only that');
  {
    const result = {
      ok: false,
      missing: [{ name: '@objectstack/runtime', version: '17.3.0', reason: 'not on the registry' }],
      rounds: 19,
      waitedMs: 900_000,
      checked: 69,
    };
    const text = formatFailure(result);
    t('it names the absent package', text.includes('@objectstack/runtime@17.3.0'), text.split('\n')[0].slice(9, 80));
    t('it does NOT name a package that was fine', !text.includes('@objectstack/cli'), 'no cli in the text');
    t('it says how many of how many', text.includes('1 of 69'), text.split('\n')[0].slice(9, 80));
    t('it points at the repair channel the maintainer actually has', text.includes('force: true'), 'force mentioned');
    t('the annotation is a single line', text.split('\n')[0].startsWith('::error::') && !text.split('\n')[1].startsWith('::'), 'one-line annotation');
    t(
      'the success text says what settled and how long it took',
      formatSuccess({ rounds: 3, waitedMs: 35_000, checked: 69 }).includes('69 published package(s)'),
      formatSuccess({ rounds: 3, waitedMs: 35_000, checked: 69 }).slice(10, 70),
    );
  }

  // ── 8. The probe ──────────────────────────────────────────────────────────
  battery('8. The registry probe: present, absent, and unreadable');
  {
    const packument = (versions) => ({
      ok: true,
      status: 200,
      json: async () => ({ versions: Object.fromEntries(versions.map((v) => [v, {}])) }),
    });
    let seen = null;
    const fetchImpl = async (url, init) => { seen = { url, init }; return packument(['17.2.0', '17.3.0']); };

    t('a version present in the packument reads as published', await probeVersion('@objectstack/cli', '17.3.0', { fetchImpl }) === true);
    t('a version absent from the packument reads as NOT published', await probeVersion('@objectstack/cli', '17.4.0', { fetchImpl }) === false);
    t('the scope separator is encoded for the registry', seen.url.endsWith('/@objectstack%2Fcli'), seen.url);
    t('it asks for the abbreviated packument', seen.init.headers.Accept.includes('install-v1+json'), seen.init.headers.Accept);

    const notFound = async () => ({ ok: false, status: 404, json: async () => ({}) });
    t('a 404 is an ABSENCE, not an unreadable registry', await probeVersion('@objectstack/new', '17.3.0', { fetchImpl: notFound }) === false);

    const boom = async () => ({ ok: false, status: 503, json: async () => ({}) });
    let threw = false;
    try {
      await probeVersion('@objectstack/cli', '17.3.0', { fetchImpl: boom });
    } catch (err) {
      threw = err instanceof RegistryUnreadable;
    }
    t('a 5xx THROWS rather than answering "absent"', threw, 'RegistryUnreadable');
  }

  // ── 9. The job summary ────────────────────────────────────────────────────
  battery('9. The job summary is written SYNCHRONOUSLY, before process.exit');
  {
    // This battery exists for a bug that was live in this file: the append was
    // `import('node:fs').then(...)`, a floating promise, and the caller's
    // `process.exit(await main())` discards pending microtasks. It wrote the
    // summary on NEITHER path while reading exactly like one that did — and a
    // deferred write cannot be told from a working one by inspection.
    const dir = mkdtempSync(join(tmpdir(), 'release-verify-npm-'));
    try {
      const file = join(dir, 'summary.md');
      appendStepSummary({ GITHUB_STEP_SUMMARY: file }, ['### line one', 'line two']);
      // Read IMMEDIATELY, with no await in between: a deferred write fails here.
      const written = readFileSync(file, 'utf8');
      t('the summary is on disk the instant the call returns', written.includes('### line one'), JSON.stringify(written));
      t('every line is written, not just the first', written.includes('line two'), JSON.stringify(written));

      appendStepSummary({ GITHUB_STEP_SUMMARY: file }, ['appended']);
      t('a second call APPENDS rather than replacing', readFileSync(file, 'utf8').includes('### line one'), 'both blocks present');

      let threw = false;
      try {
        appendStepSummary({ GITHUB_STEP_SUMMARY: join(dir, 'no', 'such', 'dir', 's.md') }, ['x']);
      } catch {
        threw = true;
      }
      t('an unwritable summary path is swallowed — it is not a publish failure', !threw, 'no throw');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // The floor runs BEFORE the verdict below, so a success line can only be
  // printed by a run in which every declared battery registered its cases.
  for (const message of batteryFloorFailures()) cases.push({ name: message, ok: false });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  x ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`x release-verify-npm self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `OK release-verify-npm self-test: ${cases.length} cases pass across `
      + `${Object.keys(SELF_TEST_BATTERIES).length} batteries (the #15321 false red reproduced and absorbed, `
      + 'the masked partial publish caught, and absence still fatal).',
  );
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const code = await selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\nx release-verify-npm self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  } else {
    process.exit(await main());
  }
}
