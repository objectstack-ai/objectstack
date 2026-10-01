#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * release-verify-npm -- after `changeset publish`, prove EVERY published
 * package is readable on npm, and keep failing closed when one is not.
 *
 *   node scripts/release-verify-npm.mjs              # from release.yml
 *   node scripts/release-verify-npm.mjs --self-test  # verify this logic
 *   node scripts/release-verify-npm.mjs --dry-run    # print the target set only
 *   RELEASE_VERSION=V node scripts/release-verify-npm.mjs --probe [--root DIR]
 *                                                    # one read, no waiting: is
 *                                                    # the whole group on npm?
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
 * ## `--probe` — the same question BEFORE anyone waits for the answer (#20627)
 *
 * `release.yml`'s `release-integrity` audit repairs an already-published
 * release: it backfills the GitHub Releases, the ADR-0087 D4 asset and the
 * runtime image. It used to read "already published" off the
 * `@objectstack/cli` canary alone, which is the defect ② above in a second
 * place. A publish commits the group over minutes and `cli` is not the last:
 * npm's own `time` field on 17.5.0 has the first package at 07:54:59.851Z,
 * `cli` at 07:58:57.256Z, `console` at 08:05:24.355Z and `spec`, last, at
 * 08:09:33.521Z. A landing audited at 08:05:53Z read `cli`, backfilled, and its
 * image build went red installing a group npm did not have yet.
 *
 * So "published" has ONE definition, this file's: every package of the derived
 * target set is readable at its own manifest's version. `--probe` asks it with
 * the same derivation, the same refusals and the same `verifyAllPublished`, in
 * ONE round (a budget of 0 — the parameter battery 2 already drives) and prints
 * one JSON line: `state` is `published`, `unpublished` (some package is
 * definitively absent) or `unknown` (nothing is absent, but a read failed).
 * One round, not fifteen minutes of backoff, because the direction of error is
 * the safe one: a cold read answers `unpublished` and the backfill waits for
 * the next landing, while a false `published` is impossible — every package
 * has to answer present. The exit status is 0 for all three answers; it is
 * non-zero only when there is no answer (a target set this file refuses, an
 * unreadable workspace, or no RELEASE_VERSION to hold the anchor to).
 *
 * `--root` names the workspace the set is derived from. The audit passes the
 * VERSION COMMIT's tree, because that is the tree the publish job checked out
 * and ran this file over: a later landing's tree can carry a package no
 * release of this version contains, which would read as absent forever.
 *
 * The self-test's battery 12 runs the audit step itself — its text, read out of
 * `.github/workflows/release.yml` — against a throwaway repository, a stub
 * registry and stub `npm` / `gh` / `curl`, so the wiring is pinned where it
 * lives rather than described here.
 *
 * Battery 13 pins WHICH TREE that backfill builds from (#20982). The audit runs
 * on `github.sha`, the head of whichever push is audited, while the publish job
 * builds the version commit. Battery 13 runs the audit step, then the
 * job's three backfill steps, then the publish job's own D4 step, all from
 * their text in `release.yml`, with each step's `env:` read from there too.
 * The fixture has a landing that moved `packages/spec/src` after the version
 * commit. It asserts that the attached `spec-changes.json` is byte-identical to
 * the publish job's, and that every Release is created at the version commit.
 * Each backfill step must also refuse a tree that is not at the version commit.
 */

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';
import { listWorkspacePackages } from './release-github-releases.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

/** The workflow whose audit step battery 12 runs. Read by the self-test only. */
const RELEASE_WORKFLOW = resolve(SCRIPTS_DIR, '..', '.github/workflows/release.yml');

/** The step in `release-integrity` that reads npm and decides every backfill. */
const AUDIT_STEP_NAME = 'Audit the release that main actually carries';

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
  '10. The probe: the whole group in one read, three answers': 9,
  '11. The 17.5.0 publish window, replayed on npm\'s own clock': 7,
  '12. The audit step backfills only a version whose whole group is on npm': 14,
  '13. The backfill builds from the version commit\'s tree, as the publish does': 11,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 13;

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

/** The reason a target carries when the registry answered and the version is not there. */
export const NOT_ON_REGISTRY = 'not on the registry';

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
      reasons.set(key, NOT_ON_REGISTRY);
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
    missing: pending.map((t) => ({ ...t, reason: reasons.get(`${t.name}@${t.version}`) ?? NOT_ON_REGISTRY })),
    rounds,
    waitedMs,
    checked: targets.length,
  };
}

// ---------------------------------------------------------------------------
// The probe — the same definition, asked once (`--probe`, see the header)
// ---------------------------------------------------------------------------

/**
 * The group's state on npm, read off one `verifyAllPublished` result.
 *
 *   published    every target is readable
 *   unpublished  at least one target is DEFINITIVELY absent — the group is not
 *                (yet) all on npm, whatever else could not be read
 *   unknown      nothing is definitively absent, but at least one read failed
 *
 * Absence outranks unreadability because it is evidence and the other is not:
 * one package the registry answered "no" for already settles the question.
 *
 * @param {{ ok: boolean, missing: { reason: string }[] }} result
 * @returns {'published' | 'unpublished' | 'unknown'}
 */
export function groupState(result) {
  if (result.ok) return 'published';
  return result.missing.some((m) => m.reason === NOT_ON_REGISTRY) ? 'unpublished' : 'unknown';
}

/**
 * Is the WHOLE target set readable on npm right now? One round, no waiting.
 *
 * This is `verifyAllPublished` with a budget of 0, not a second loop: the
 * refusals (an empty set, a set without the anchor) and the per-target reasons
 * are the verifier's own. The sleep it is handed throws, so a future change
 * that made the probe wait would fail here rather than stall an audit.
 *
 * @param {{ targets: { name: string, version: string }[], probe: (name: string, version: string) => Promise<boolean> }} opts
 * @returns {Promise<{ state: 'published' | 'unpublished' | 'unknown', checked: number,
 *                     missing: { name: string, version: string, reason: string }[] }>}
 */
export async function probeGroup({ targets, probe }) {
  const result = await verifyAllPublished({
    targets,
    probe,
    budgetMs: 0,
    sleep: async () => {
      throw new Error('the group probe asks once; it never waits for the registry to settle');
    },
  });
  return { state: groupState(result), checked: result.checked, missing: result.missing };
}

/**
 * The probe's log line, for a human reading the audit (stdout carries the JSON).
 *
 * @param {string} version
 * @param {{ state: string, checked: number, missing: { name: string, version: string, reason: string }[] }} answer
 * @returns {string}
 */
export function formatProbe(version, answer) {
  const { state, checked, missing } = answer;
  if (state === 'published') return `probe: all ${checked} package(s) of ${version} are readable on npm.`;
  const shown = missing.slice(0, 5).map((m) => `${m.name}@${m.version} (${m.reason})`);
  const more = missing.length > shown.length ? `, and ${missing.length - shown.length} more` : '';
  return `probe: ${state} — ${missing.length} of ${checked} package(s) of ${version} not readable: ${shown.join(', ')}${more}.`;
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
  const probeMode = argv.includes('--probe');
  const what = probeMode ? 'probe the fixed group' : 'verify the publish';
  if (probeMode && argv.includes('--dry-run')) {
    console.error('::error::--probe reads the registry and --dry-run reads nothing; pass one of them.');
    return 1;
  }
  // The probe answers for ONE release, so it must be told which: without it
  // the anchor check below has nothing to hold the derived set to, and a
  // `--root` pointing at the wrong tree would be answered about silently.
  if (probeMode && !env.RELEASE_VERSION) {
    console.error('::error::--probe needs RELEASE_VERSION — the version whose whole fixed group it is asked about.');
    return 1;
  }

  let targets;
  try {
    const rootAt = argv.indexOf('--root');
    const root = rootAt === -1 ? undefined : argv[rootAt + 1];
    if (rootAt !== -1 && (!root || root.startsWith('--'))) throw new Error('--root needs a directory');
    targets = resolveVerificationTargets(listWorkspacePackages(root === undefined ? undefined : resolve(root)));
  } catch (err) {
    console.error(`::error::cannot ${what} — the workspace could not be read: ${err instanceof Error ? err.message : err}`);
    return 1;
  }
  const problems = targetSetProblems(targets, { releaseVersion: env.RELEASE_VERSION });
  if (problems.length) {
    console.error(`::error::cannot ${what} — ${problems[0]}`);
    for (const problem of problems.slice(1)) console.error(`  - ${problem}`);
    return 1;
  }

  if (probeMode) {
    const answer = await probeGroup({ targets, probe: (name, version) => probeVersion(name, version) });
    // stdout is the answer and nothing else; the log line goes to stderr.
    process.stdout.write(`${JSON.stringify({ version: env.RELEASE_VERSION, ...answer })}\n`);
    console.error(formatProbe(env.RELEASE_VERSION, answer));
    return 0;
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

// ── Battery 12's instruments: the audit step, run as Actions runs it ────────

/**
 * The `run: |` block of the step named `stepName`, read out of a workflow's
 * TEXT and un-indented — the script Actions would hand to bash.
 *
 * Deliberately narrow: a literal block scalar or a plain one-line `run:`, one
 * step of that name, and no `${{ … }}` inside it (the simulation has no
 * expression evaluator, so a block that needs one is refused rather than run
 * half-evaluated).
 *
 * @param {string} workflowText
 * @param {string} stepName
 * @returns {string}
 */
function workflowStepScript(workflowText, stepName) {
  const lines = workflowText.split('\n');
  const indentOf = (line) => line.length - line.trimStart().length;
  const named = lines.flatMap((line, i) => (line.trim() === `- name: ${stepName}` ? [i] : []));
  if (named.length !== 1) throw new Error(`expected ONE step named "${stepName}", found ${named.length}`);
  const dashIndent = indentOf(lines[named[0]]);
  let runAt = -1;
  for (let i = named[0] + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    if (indentOf(lines[i]) <= dashIndent) break; // the next step, or the end of `steps:`
    if (lines[i].trim() === 'run: |') {
      runAt = i;
      break;
    }
    // A plain one-line `run:` (the publish job's D4 step is one). Anything
    // else after `run:` (a folded `>`, a quoted scalar) is not read here.
    const oneLine = /^run: ([^|>'"\s].*)$/.exec(lines[i].trim());
    if (oneLine) {
      if (oneLine[1].includes('${{')) {
        throw new Error(`step "${stepName}"'s run line carries an Actions expression this simulation cannot evaluate`);
      }
      return `${oneLine[1]}\n`;
    }
  }
  if (runAt === -1) throw new Error(`step "${stepName}" has no literal \`run: |\` block`);
  const keyIndent = indentOf(lines[runAt]);
  const body = [];
  for (let i = runAt + 1; i < lines.length; i += 1) {
    if (lines[i].trim() !== '' && indentOf(lines[i]) <= keyIndent) break;
    body.push(lines[i]);
  }
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
  const first = body.find((line) => line.trim() !== '');
  if (!first) throw new Error(`step "${stepName}" has an empty run block`);
  const blockIndent = indentOf(first);
  const script = `${body.map((line) => (line.trim() === '' ? '' : line.slice(blockIndent))).join('\n')}\n`;
  if (script.includes('${{')) {
    throw new Error(`step "${stepName}"'s run block carries an Actions expression this simulation cannot evaluate`);
  }
  return script;
}

/**
 * A registry on 127.0.0.1 serving abbreviated packuments from a mutable set of
 * `name@version` strings; names in `broken` answer 503. Records every name it
 * was asked about, so a case can assert what the audit did NOT read.
 */
async function stubRegistryServer() {
  let present = new Set();
  let broken = new Set();
  const asked = [];
  const server = createServer((req, res) => {
    const name = decodeURIComponent(String(req.url).replace(/^\//, ''));
    asked.push(name);
    if (broken.has(name)) {
      res.writeHead(503);
      res.end();
      return;
    }
    const versions = [...present].filter((p) => p.startsWith(`${name}@`)).map((p) => p.slice(name.length + 1));
    if (versions.length === 0) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name, versions: Object.fromEntries(versions.map((v) => [v, {}])) }));
  });
  await new Promise((resolve_) => { server.listen(0, '127.0.0.1', resolve_); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    asked,
    set(next) {
      present = new Set(next.present ?? []);
      broken = new Set(next.broken ?? []);
      asked.length = 0;
    },
    close: () => new Promise((resolve_) => { server.close(resolve_); }),
  };
}

/**
 * Stub `npm` / `gh` / `curl` for the audit step, each answering from env:
 * `npm view NAME@V version` from STUB_NPM_PRESENT (the same set the registry
 * serves), `gh release view` from STUB_GH, the two ghcr requests from STUB_GHCR.
 */
function writeStubBin(dir) {
  mkdirSync(dir, { recursive: true });
  const stubs = {
    npm: [
      '#!/bin/sh',
      'case ",${STUB_NPM_PRESENT}," in',
      '  *",$2,"*) echo "${2##*@}"; exit 0 ;;',
      'esac',
      'echo "npm error code E404" >&2',
      'exit 1',
    ],
    gh: [
      '#!/bin/sh',
      '[ "$STUB_GH" = present ] || exit 1',
      'case "$*" in *--json*) echo spec-changes.json ;; esac',
      'exit 0',
    ],
    curl: [
      '#!/bin/sh',
      '[ "$STUB_GHCR" = present ] || exit 22',
      'case "$*" in *ghcr.io/token*) echo \'{"token":"stub"}\' ;; esac',
      'exit 0',
    ],
  };
  for (const [name, lines] of Object.entries(stubs)) {
    writeFileSync(join(dir, name), `${lines.join('\n')}\n`);
    chmodSync(join(dir, name), 0o755);
  }
}

/** Run a script the way Actions runs `run:` — bash --noprofile --norc -eo pipefail FILE. */
function runAsActions({ scriptFile, cwd, env }) {
  return new Promise((resolve_, reject) => {
    const child = spawn('bash', ['--noprofile', '--norc', '-eo', 'pipefail', scriptFile], { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (status) => resolve_({ status, stdout, stderr }));
  });
}

/** `key=value` lines of a GITHUB_OUTPUT file, as a map. */
function readOutputs(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

// ── Battery 13's instruments: the backfill steps, run after the audit ───────

/** The `release-integrity` steps that build the backfill, in the job's order. */
const BACKFILL_STEP_NAMES = Object.freeze([
  "Install dependencies (the version commit's tree)",
  'Backfill GitHub Releases (bodies truncated to the API limit)',
  'Backfill spec-changes.json on the GitHub Release (ADR-0087 D4)',
]);

/** The `publish` job's own D4 step: the manifest the backfill's must equal. */
const PUBLISH_D4_STEP_NAME = 'Generate the per-release spec-changes section (ADR-0087 D4)';

/**
 * The scripts the audit and the backfill steps run. They are COMMITTED into
 * battery 13's fixture, together with everything they import, and never
 * symlinked. The backfill runs them from a worktree of the fixture's version
 * commit, and Node resolves a symlinked entry point to its real path, so
 * `release-github-releases.mjs` would read this repository's workspace and
 * CHANGELOGs instead of the fixture's.
 */
const BACKFILL_FIXTURE_SCRIPTS = Object.freeze([
  'release-pending-publish.mjs',
  'release-verify-npm.mjs',
  'release-github-releases.mjs',
  'release-spec-changes.sh',
]);

/**
 * The `env:` map of the step named `stepName`, read out of a workflow's TEXT,
 * with each value left as written (an Actions expression stays unevaluated).
 *
 * @param {string} workflowText
 * @param {string} stepName
 * @returns {Record<string, string>}
 */
function workflowStepEnv(workflowText, stepName) {
  const lines = workflowText.split('\n');
  const indentOf = (line) => line.length - line.trimStart().length;
  const named = lines.flatMap((line, i) => (line.trim() === `- name: ${stepName}` ? [i] : []));
  if (named.length !== 1) throw new Error(`expected ONE step named "${stepName}", found ${named.length}`);
  const dashIndent = indentOf(lines[named[0]]);
  let envAt = -1;
  for (let i = named[0] + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    if (indentOf(lines[i]) <= dashIndent) break;
    if (lines[i].trim() === 'env:') {
      envAt = i;
      break;
    }
  }
  /** @type {Record<string, string>} */
  const env = {};
  if (envAt === -1) return env;
  const keyIndent = indentOf(lines[envAt]);
  for (let i = envAt + 1; i < lines.length; i += 1) {
    const text = lines[i].trim();
    if (text === '' || text.startsWith('#')) continue;
    if (indentOf(lines[i]) <= keyIndent) break;
    const pair = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(text);
    if (!pair) throw new Error(`step "${stepName}": cannot read the env line "${text}"`);
    env[pair[1]] = pair[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

/**
 * Resolve a step's `env:` against the values this simulation knows. An
 * expression it has no value for is REFUSED, never passed through as text or
 * dropped, so a step wired to an output nobody sets fails here.
 *
 * @param {Record<string, string>} raw
 * @param {Record<string, string>} known expression -> value
 * @returns {Record<string, string>}
 */
function resolveStepEnv(raw, known) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const expr = /^\$\{\{\s*(.+?)\s*\}\}$/.exec(value);
    if (expr) {
      if (!Object.hasOwn(known, expr[1])) throw new Error(`env ${key}: no value for \`${expr[1]}\` in this simulation`);
      out[key] = known[expr[1]];
    } else if (value.includes('${{')) {
      throw new Error(`env ${key}: an expression inside a longer value is not evaluated here ("${value}")`);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * `entries` plus every `./x.mjs` they import, transitively, as file names
 * under this directory.
 *
 * @param {readonly string[]} entries
 * @returns {string[]}
 */
function scriptClosure(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    if (!name.endsWith('.mjs')) continue;
    const text = readFileSync(join(SCRIPTS_DIR, name), 'utf8');
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+'\.\/([^']+)'/gm)) queue.push(m[1]);
  }
  return [...seen].sort();
}

/**
 * Battery 13's stubs, on top of battery 12's `curl`. Every call that matters is
 * appended to STUB_LOG with the directory it ran in.
 *
 *   gh    `release view` answers from STUB_GH, as battery 12's does;
 *         `release upload TAG FILE` copies FILE into STUB_UPLOADS.
 *   npm   `view NAME@V version`, `view NAME versions --json` and `pack NAME@V`,
 *         all answered from STUB_NPM_PRESENT; `pack` writes a real tarball.
 *   pnpm  `install` is recorded only. `--filter @objectstack/spec exec tsx
 *         scripts/build-spec-changes.ts` stands in for the generator: it finds
 *         the workspace the way pnpm does, upward from where it runs, and
 *         writes a manifest that is a pure function of that workspace's
 *         `packages/spec/src`. So the bytes say which tree was read.
 */
function writeBackfillStubBin(dir) {
  writeStubBin(dir);
  const stubs = {
    gh: [
      '#!/bin/sh',
      'if [ "$1 $2" = "release upload" ]; then',
      '  printf \'upload\\t%s\\t%s\\n\' "$PWD" "$3" >> "$STUB_LOG"',
      '  cp "$4" "$STUB_UPLOADS/$(printf \'%s\' "$3" | tr \'/@\' \'__\')" || exit 1',
      '  exit 0',
      'fi',
      '[ "$STUB_GH" = present ] || exit 1',
      'case "$*" in *--json*) echo spec-changes.json ;; esac',
      'exit 0',
    ],
    npm: [
      '#!/usr/bin/env node',
      "'use strict';",
      "const fs = require('node:fs');",
      "const os = require('node:os');",
      "const path = require('node:path');",
      "const { spawnSync } = require('node:child_process');",
      "const present = (process.env.STUB_NPM_PRESENT || '').split(',').filter(Boolean);",
      'const [cmd, what, field, flag] = process.argv.slice(2);',
      "const absent = () => { process.stderr.write('npm error code E404\\n'); process.exit(1); };",
      "if (cmd === 'view' && field === 'version') {",
      '  if (!present.includes(what)) absent();',
      "  console.log(what.slice(what.lastIndexOf('@') + 1));",
      '  process.exit(0);',
      '}',
      "if (cmd === 'view' && field === 'versions' && flag === '--json') {",
      "  const versions = present.filter((p) => p.startsWith(`${what}@`)).map((p) => p.slice(what.length + 1));",
      '  if (versions.length === 0) absent();',
      '  console.log(JSON.stringify(versions));',
      '  process.exit(0);',
      '}',
      "if (cmd === 'pack') {",
      '  if (!present.includes(what)) absent();',
      "  const at = what.lastIndexOf('@');",
      '  const name = what.slice(0, at);',
      '  const version = what.slice(at + 1);',
      "  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'stub-npm-pack-'));",
      "  fs.mkdirSync(path.join(stage, 'package'));",
      "  fs.writeFileSync(path.join(stage, 'package', 'package.json'), JSON.stringify({ name, version }) + '\\n');",
      "  const file = `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;",
      "  const tar = spawnSync('tar', ['-czf', path.join(process.cwd(), file), '-C', stage, 'package']);",
      '  fs.rmSync(stage, { recursive: true, force: true });',
      '  if (tar.status !== 0) process.exit(1);',
      '  console.log(file);',
      '  process.exit(0);',
      '}',
      "process.stderr.write(`stub npm: unexpected call: ${process.argv.slice(2).join(' ')}\\n`);",
      'process.exit(2);',
    ],
    pnpm: [
      '#!/usr/bin/env node',
      "'use strict';",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'const args = process.argv.slice(2);',
      "const log = (line) => fs.appendFileSync(process.env.STUB_LOG, `${line}\\n`);",
      "if (args[0] === 'install') {",
      '  log(`install\\t${process.cwd()}`);',
      '  process.exit(0);',
      '}',
      "const generator = ['--filter', '@objectstack/spec', 'exec', 'tsx', 'scripts/build-spec-changes.ts'];",
      'if (generator.every((a, i) => args[i] === a)) {',
      '  let root = process.cwd();',
      "  while (!fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))) {",
      '    const up = path.dirname(root);',
      "    if (up === root) { process.stderr.write('stub pnpm: no workspace above the cwd\\n'); process.exit(1); }",
      '    root = up;',
      '  }',
      "  const spec = path.join(root, 'packages', 'spec');",
      '  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })',
      '    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));',
      "  const src = Object.fromEntries(walk(path.join(spec, 'src')).sort()",
      "    .map((f) => [path.relative(spec, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')]));",
      "  const at = args.indexOf('--previous-package');",
      "  const from = at === -1 ? null : JSON.parse(fs.readFileSync(path.join(args[at + 1], 'package.json'), 'utf8')).version;",
      "  const to = JSON.parse(fs.readFileSync(path.join(spec, 'package.json'), 'utf8')).version;",
      "  fs.writeFileSync(path.join(spec, 'spec-changes.json'), `${JSON.stringify({ release: { from, to }, src }, null, 2)}\\n`);",
      '  log(`generate\\t${root}`);',
      '  process.exit(0);',
      '}',
      "process.stderr.write(`stub pnpm: unexpected call: ${args.join(' ')}\\n`);",
      'process.exit(2);',
    ],
  };
  for (const [name, lines] of Object.entries(stubs)) {
    writeFileSync(join(dir, name), `${lines.join('\n')}\n`);
    chmodSync(join(dir, name), 0o755);
  }
}

/**
 * The Releases API on 127.0.0.1: every tag reads as having no Release (404),
 * and every POST is recorded and answered 201.
 */
async function stubReleasesApi() {
  /** @type {{ tag_name: string; body: string; target_commitish: string }[]} */
  const posts = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      const url = String(req.url);
      if (req.method === 'GET' && url.includes('/releases/tags/')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"message":"Not Found"}');
        return;
      }
      if (req.method === 'POST' && /\/releases$/.test(url)) {
        const body = JSON.parse(data);
        posts.push(body);
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: posts.length, tag_name: body.tag_name }));
        return;
      }
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"message":"unexpected request"}');
    });
  });
  await new Promise((resolve_) => { server.listen(0, '127.0.0.1', resolve_); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    posts,
    reset() {
      posts.length = 0;
    },
    close: () => new Promise((resolve_) => { server.close(resolve_); }),
  };
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

  // ── 10. The probe ─────────────────────────────────────────────────────────
  battery('10. The probe: the whole group in one read, three answers');
  {
    const GROUP = [
      { name: '@objectstack/cli', version: '17.5.0' },
      { name: '@objectstack/console', version: '17.5.0' },
      { name: '@objectstack/spec', version: '17.5.0' },
    ];
    // The audit of run 36540562567 at 08:05:53Z: cli and console readable, spec not.
    const window = stubRegistry({ never: ['@objectstack/spec'] });
    const answer = await probeGroup({ targets: GROUP, probe: window.probe });
    t('cli on npm and spec absent answers "unpublished"', answer.state === 'unpublished', JSON.stringify(answer));
    t('it names spec, and only spec', answer.missing.length === 1 && answer.missing[0].name === '@objectstack/spec', JSON.stringify(answer.missing));
    t('it read every package exactly once — one round, no retry', window.calls.length === GROUP.length, JSON.stringify(window.calls));

    const canary = await probeGroup({ targets: [GROUP[0]], probe: stubRegistry({ never: ['@objectstack/spec'] }).probe });
    t('OLD READING: the cli canary alone answers "published" at that same instant', canary.state === 'published', JSON.stringify(canary));

    const all = await probeGroup({ targets: GROUP, probe: stubRegistry().probe });
    t('the all-published control answers "published", naming nothing', all.state === 'published' && all.missing.length === 0 && all.checked === 3, JSON.stringify(all));

    const blind = await probeGroup({ targets: GROUP, probe: stubRegistry({ throwsFor: { '@objectstack/spec': 'GET … → HTTP 503' } }).probe });
    t('an unreadable package with none absent answers "unknown", never "published"', blind.state === 'unknown', JSON.stringify(blind));

    const mixed = await probeGroup({
      targets: GROUP,
      probe: stubRegistry({ never: ['@objectstack/console'], throwsFor: { '@objectstack/spec': 'GET … → HTTP 503' } }).probe,
    });
    t('one package absent and another unreadable answers "unpublished" — absence is evidence', mixed.state === 'unpublished', JSON.stringify(mixed));

    // The verifier's backoff absorbs a cold read; the probe does not wait for one.
    const cold = await probeGroup({ targets: GROUP, probe: stubRegistry({ coldReads: { '@objectstack/spec': 1 } }).probe });
    t('a cold read answers "unpublished" — the safe direction: the backfill waits for a later landing', cold.state === 'unpublished', JSON.stringify(cold));

    let refused = false;
    try {
      await probeGroup({ targets: [], probe: stubRegistry().probe });
    } catch (err) {
      refused = /NO targets/.test(String(err && err.message));
    }
    t('an empty target set is refused, exactly as the verifier refuses it', refused, 'refused');
  }

  // ── 11. The 17.5.0 window ─────────────────────────────────────────────────
  battery("11. The 17.5.0 publish window, replayed on npm's own clock");
  {
    // npm's own `time` field for 17.5.0, read off the registry: the first
    // package of the group, the canary, the package the 08:05:53Z audit still
    // had, and the last one.
    const LANDED = {
      '@objectstack/sdui-parser': '2026-09-29T07:54:59.851Z',
      '@objectstack/cli': '2026-09-29T07:58:57.256Z',
      '@objectstack/console': '2026-09-29T08:05:24.355Z',
      '@objectstack/spec': '2026-09-29T08:09:33.521Z',
    };
    const GROUP = Object.keys(LANDED).map((name) => ({ name, version: '17.5.0' }));
    const at = (ms) => async (name) => ms >= Date.parse(LANDED[name]);
    const group = async (ms) => (await probeGroup({ targets: GROUP, probe: at(ms) })).state;
    const canary = async (ms) => (await probeGroup({ targets: [GROUP[1]], probe: at(ms) })).state;
    const ms = (iso) => Date.parse(iso);

    t('before the first package lands: unpublished', (await group(ms('2026-09-29T07:54:00Z'))) === 'unpublished');
    t(
      'the instant cli lands: the canary says published, the group does not',
      (await canary(ms(LANDED['@objectstack/cli']))) === 'published' && (await group(ms(LANDED['@objectstack/cli']))) === 'unpublished',
    );
    t('08:05:53Z, the audit of run 36540562567: unpublished', (await group(ms('2026-09-29T08:05:53Z'))) === 'unpublished');
    t('08:09:32Z, a second before spec: unpublished', (await group(ms('2026-09-29T08:09:32Z'))) === 'unpublished');
    t('the instant spec lands, the last of the group: published', (await group(ms(LANDED['@objectstack/spec']))) === 'published');

    // A second-by-second sweep: the two readings disagree EXACTLY while cli is
    // on npm and spec is not, and the group reading is never early.
    let firstLie = null;
    let lastLie = null;
    let groupEarly = null;
    for (let now = ms('2026-09-29T07:54:00Z'); now <= ms('2026-09-29T08:12:00Z'); now += 1000) {
      const g = await group(now);
      if ((await canary(now)) === 'published' && g !== 'published') {
        firstLie ??= now;
        lastLie = now;
      }
      if (g === 'published' && now < ms(LANDED['@objectstack/spec'])) groupEarly ??= now;
    }
    t(
      'the canary reads published while the group is not from 07:58:58Z to 08:09:33Z, 10m35s of it',
      firstLie === ms('2026-09-29T07:58:58Z') && lastLie === ms('2026-09-29T08:09:33Z'),
      `${firstLie && new Date(firstLie).toISOString()} .. ${lastLie && new Date(lastLie).toISOString()}`,
    );
    t('the group reading never says published before spec lands', groupEarly === null, String(groupEarly && new Date(groupEarly).toISOString()));
  }

  // ── 12. The audit step itself ─────────────────────────────────────────────
  battery('12. The audit step backfills only a version whose whole group is on npm');
  {
    // The step's REAL text, read out of release.yml, run by bash the way
    // Actions runs it, in a throwaway repository: base (1.0.0) -> the version
    // commit (1.1.0) -> a landing -> a landing that adds a package no release
    // of 1.1.0 contains. The two release scripts it calls are this checkout's;
    // npm, the GitHub Releases and ghcr are stubs.
    let script = null;
    let unreadable = '';
    try {
      script = workflowStepScript(readFileSync(RELEASE_WORKFLOW, 'utf8'), AUDIT_STEP_NAME);
    } catch (err) {
      unreadable = err instanceof Error ? err.message : String(err);
    }
    t('the audit step is read out of release.yml itself, not a copy of it', script !== null, unreadable);
    let refusedMissing = false;
    try {
      workflowStepScript('jobs:\n  a:\n    steps:\n      - name: Something else\n        run: |\n          true\n', AUDIT_STEP_NAME);
    } catch {
      refusedMissing = true;
    }
    t('a workflow without that step is refused, never simulated as an empty script', refusedMissing);

    const root = mkdtempSync(join(tmpdir(), 'release-verify-npm-audit-'));
    const registry = await stubRegistryServer();
    try {
      const repo = join(root, 'repo');
      mkdirSync(repo);
      const g = (...args) => {
        const r = spawnSync('git', [
          '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid',
          '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args,
        ], { cwd: repo, encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`git ${args.join(' ')} exited ${r.status}: ${r.stderr}`);
        return r.stdout.trim();
      };
      const writePkg = (dir, name, version) => {
        mkdirSync(join(repo, 'packages', dir), { recursive: true });
        writeFileSync(join(repo, 'packages', dir, 'package.json'), `${JSON.stringify({ name, version }, null, 2)}\n`);
      };
      const commit = (message) => {
        g('add', '-A');
        g('commit', '-q', '-m', message);
        return g('rev-parse', 'HEAD');
      };
      g('init', '-q', '-b', 'main');
      writeFileSync(join(repo, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
      writePkg('cli', '@objectstack/cli', '1.0.0');
      writePkg('spec', '@objectstack/spec', '1.0.0');
      const base = commit('base');
      writePkg('cli', '@objectstack/cli', '1.1.0');
      writePkg('spec', '@objectstack/spec', '1.1.0');
      const vc = commit('chore: version packages');
      writeFileSync(join(repo, 'one.txt'), 'one\n');
      const landing = commit('a landing during the publish');
      writePkg('fresh', '@objectstack/fresh', '1.1.0');
      const freshLanding = commit('a package that no release of 1.1.0 contains');
      // After every commit, so `git add -A` never took it: the step runs
      // `node scripts/…` from the repository root, and these are ours.
      symlinkSync(SCRIPTS_DIR, join(repo, 'scripts'));
      const bin = join(root, 'bin');
      writeStubBin(bin);
      const scriptFile = join(root, 'audit-step.sh');
      if (script !== null) writeFileSync(scriptFile, script);

      let runs = 0;
      const audit = async ({ event = 'push', before, head, present, broken = [], releases = false, image = false }) => {
        runs += 1;
        const temp = join(root, `run-${runs}`);
        mkdirSync(temp);
        g('checkout', '-q', '--detach', head);
        registry.set({ present, broken });
        const env = {
          PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
          HOME: process.env.HOME ?? root,
          SHA: head,
          EVENT: event,
          BEFORE: before ?? '',
          GH_TOKEN: 'stub',
          GITHUB_REPOSITORY: 'objectstack-ai/objectstack',
          GITHUB_OUTPUT: join(temp, 'output'),
          GITHUB_STEP_SUMMARY: join(temp, 'summary.md'),
          RUNNER_TEMP: temp,
          npm_config_registry: registry.url,
          STUB_NPM_PRESENT: present.join(','),
          STUB_GH: releases ? 'present' : 'absent',
          STUB_GHCR: image ? 'present' : 'absent',
        };
        const r = script === null ? { status: -1, stdout: '', stderr: 'no script' } : await runAsActions({ scriptFile, cwd: repo, env });
        const summary = existsSync(env.GITHUB_STEP_SUMMARY) ? readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8') : '';
        return { ...r, outputs: readOutputs(env.GITHUB_OUTPUT), summary, asked: [...registry.asked] };
      };
      const said = (r) => `exit ${r.status}; outputs ${JSON.stringify(r.outputs)}; asked ${JSON.stringify(r.asked)}; ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`;
      const backfills = (r) => r.outputs['image-missing'] === 'true' || r.outputs['releases-missing'] === 'true';

      // THE pin: the 17.5.0 window. cli is on npm, spec is not; nothing is
      // backfilled yet, and the image is missing.
      const inWindow = await audit({ before: vc, head: landing, present: ['@objectstack/cli@1.1.0', '@objectstack/spec@1.0.0'] });
      t('IN THE WINDOW (cli on npm, spec not): the audit stays green', inWindow.status === 0, said(inWindow));
      t('...and requests NO image build, though the image is missing', inWindow.outputs['image-missing'] === undefined, said(inWindow));
      t('...and backfills NO GitHub Release, though they are missing', inWindow.outputs['releases-missing'] === undefined, said(inWindow));
      t(
        '...and says why, naming the package npm does not have yet',
        /::notice::.*1 of 2 package\(s\).*@objectstack\/spec@1\.1\.0/.test(inWindow.stdout) && /not fully on npm yet/.test(inWindow.summary),
        said(inWindow),
      );

      // The all-published control: the same landing, spec now on npm.
      const done = await audit({ before: vc, head: landing, present: ['@objectstack/cli@1.1.0', '@objectstack/spec@1.1.0'] });
      t('CONTROL (the whole group on npm, image missing): the backfill branch requests the image', done.status === 0 && done.outputs['image-missing'] === 'true', said(done));
      t('CONTROL: ...and backfills the missing GitHub Releases', done.outputs['releases-missing'] === 'true', said(done));

      const complete = await audit({ before: vc, head: landing, present: ['@objectstack/cli@1.1.0', '@objectstack/spec@1.1.0'], releases: true, image: true });
      t(
        'nothing missing: no backfill, and the group is never read — the common path pays no registry reads',
        complete.status === 0 && !backfills(complete) && complete.asked.length === 0,
        said(complete),
      );

      const blind = await audit({ before: vc, head: landing, present: ['@objectstack/cli@1.1.0'], broken: ['@objectstack/spec'] });
      t(
        'npm unreadable for spec: no backfill off a guess, and a warning says so',
        blind.status === 0 && !backfills(blind) && /::warning::.*could not be read/.test(blind.stdout),
        said(blind),
      );

      // The version push itself: cli is not on npm, so this is a PUBLISH,
      // decided by the cli reading exactly as before — never a backfill.
      const versionPush = await audit({ before: base, head: vc, present: ['@objectstack/cli@1.0.0', '@objectstack/spec@1.0.0'] });
      t('the version push, cli absent: the publish predicate still queues the publish', versionPush.status === 0 && versionPush.outputs['publish-pending'] === 'true', said(versionPush));
      t('...and neither backfills nor reads the group', !backfills(versionPush) && versionPush.asked.length === 0, said(versionPush));

      // The set is the VERSION COMMIT's workspace: a package that landed after
      // it, and that no release of 1.1.0 contains, is not asked about.
      const later = await audit({ before: landing, head: freshLanding, present: ['@objectstack/cli@1.1.0', '@objectstack/spec@1.1.0'] });
      t("a later landing's new package does not hold the backfill back: the image is requested", later.status === 0 && later.outputs['image-missing'] === 'true', said(later));
      t('...because the group read is the version commit\'s: the new package is never asked about', later.asked.length === 2 && !later.asked.includes('@objectstack/fresh'), said(later));
    } finally {
      await registry.close();
      rmSync(root, { recursive: true, force: true });
    }
  }

  // ── 13. The backfill's tree ───────────────────────────────────────────────
  battery('13. The backfill builds from the version commit\'s tree, as the publish does');
  {
    // The audit step, the three backfill steps and the publish job's D4 step,
    // each from its own text in release.yml, with each step's `env:` read from
    // there too. The throwaway repository is base (1.0.0) -> the version
    // commit (1.1.0) -> a landing that moved packages/spec/src. The audit runs
    // on that landing, as `github.sha`.
    const workflowText = readFileSync(RELEASE_WORKFLOW, 'utf8');
    /** @type {Record<string, { script: string; env: Record<string, string> }>} */
    const steps = {};
    let unreadable = '';
    for (const name of [AUDIT_STEP_NAME, ...BACKFILL_STEP_NAMES, PUBLISH_D4_STEP_NAME]) {
      try {
        steps[name] = { script: workflowStepScript(workflowText, name), env: workflowStepEnv(workflowText, name) };
      } catch (err) {
        unreadable += `${name}: ${err instanceof Error ? err.message : String(err)}; `;
      }
    }
    const readable = unreadable === '';
    t('the audit, the three backfill steps and the publish job\'s D4 step are read out of release.yml itself', readable, unreadable);

    const root = mkdtempSync(join(tmpdir(), 'release-verify-npm-backfill-'));
    const registry = await stubRegistryServer();
    const api = await stubReleasesApi();
    try {
      const repo = join(root, 'repo');
      mkdirSync(repo);
      const g = (...args) => {
        const r = spawnSync('git', [
          '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid',
          '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args,
        ], { cwd: repo, encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`git ${args.join(' ')} exited ${r.status}: ${r.stderr}`);
        return r.stdout.trim();
      };
      const write = (rel, text) => {
        mkdirSync(dirname(join(repo, rel)), { recursive: true });
        writeFileSync(join(repo, rel), text);
      };
      const writePkg = (dir, name, version) => write(`packages/${dir}/package.json`, `${JSON.stringify({ name, version }, null, 2)}\n`);
      const commit = (message) => {
        g('add', '-A');
        g('commit', '-q', '-m', message);
        return g('rev-parse', 'HEAD');
      };
      g('init', '-q', '-b', 'main');
      write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
      for (const name of scriptClosure(BACKFILL_FIXTURE_SCRIPTS)) {
        write(`scripts/${name}`, readFileSync(join(SCRIPTS_DIR, name), 'utf8'));
      }
      writePkg('cli', '@objectstack/cli', '1.0.0');
      writePkg('spec', '@objectstack/spec', '1.0.0');
      write('packages/cli/CHANGELOG.md', '# @objectstack/cli\n\n## 1.0.0\n\n- base\n');
      write('packages/spec/CHANGELOG.md', '# @objectstack/spec\n\n## 1.0.0\n\n- base\n');
      write('packages/spec/src/registry.ts', "export const REGISTRY = ['one'];\n");
      commit('base');
      writePkg('cli', '@objectstack/cli', '1.1.0');
      writePkg('spec', '@objectstack/spec', '1.1.0');
      write('packages/cli/CHANGELOG.md', '# @objectstack/cli\n\n## 1.1.0\n\n- the release\n\n## 1.0.0\n\n- base\n');
      // Over the Releases API's limit, so the spec body is truncated and
      // carries its CHANGELOG permalink, the ref this battery reads.
      const longEntry = Array.from({ length: 2000 }, (_, i) => `- change ${i}: ${'x'.repeat(80)}`).join('\n');
      write('packages/spec/CHANGELOG.md', `# @objectstack/spec\n\n## 1.1.0\n\n${longEntry}\n\n## 1.0.0\n\n- base\n`);
      const vc = commit('chore: version packages');
      write('packages/spec/src/registry.ts', "export const REGISTRY = ['one', 'two'];\n");
      const landing = commit('a landing that moved packages/spec/src after the version commit');
      g('checkout', '-q', '--detach', landing);

      const bin = join(root, 'bin');
      writeBackfillStubBin(bin);
      const present = ['@objectstack/cli@1.0.0', '@objectstack/spec@1.0.0', '@objectstack/cli@1.1.0', '@objectstack/spec@1.1.0'];
      registry.set({ present });

      let runs = 0;
      /** Run one step's text the way Actions runs it, in the workspace, with the step's resolved env. */
      const runStep = async (name, known) => {
        runs += 1;
        const temp = join(root, `step-${runs}`);
        mkdirSync(join(temp, 'uploads'), { recursive: true });
        const scriptFile = join(temp, 'step.sh');
        writeFileSync(scriptFile, steps[name].script);
        const env = {
          PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
          HOME: process.env.HOME ?? root,
          GITHUB_SHA: landing,
          GITHUB_REPOSITORY: 'objectstack-ai/objectstack',
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_API_URL: api.url,
          GITHUB_WORKSPACE: repo,
          GITHUB_OUTPUT: join(temp, 'output'),
          GITHUB_STEP_SUMMARY: join(temp, 'summary.md'),
          RUNNER_TEMP: temp,
          npm_config_registry: registry.url,
          STUB_NPM_PRESENT: present.join(','),
          STUB_GH: 'absent',
          STUB_GHCR: 'present',
          STUB_LOG: join(temp, 'stub.log'),
          STUB_UPLOADS: join(temp, 'uploads'),
          ...resolveStepEnv(steps[name].env, known),
        };
        const r = await runAsActions({ scriptFile, cwd: env.GITHUB_WORKSPACE, env });
        const log = existsSync(env.STUB_LOG) ? readFileSync(env.STUB_LOG, 'utf8').split('\n').filter(Boolean) : [];
        return { ...r, temp, outputs: readOutputs(env.GITHUB_OUTPUT), log };
      };
      const said = (r) => `exit ${r.status}; log ${JSON.stringify(r.log)}; ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`;
      const real = (p) => (existsSync(p) ? realpathSync(p) : p);
      const ranIn = (r, verb) => r.log.filter((line) => line.startsWith(`${verb}\t`)).map((line) => real(line.split('\t')[1]));
      const MANIFEST = 'packages/spec/spec-changes.json';
      const SPEC_UPLOAD = '_objectstack_spec_1.1.0';

      let envResolved = readable;
      let envProblem = '';
      const known = { 'secrets.GITHUB_TOKEN': 'stub' };
      const tryStep = async (name, extra) => {
        try {
          return await runStep(name, { ...known, ...extra });
        } catch (err) {
          envResolved = false;
          envProblem += `${name}: ${err instanceof Error ? err.message : String(err)}; `;
          return { status: -1, stdout: '', stderr: envProblem, temp: '', outputs: {}, log: [] };
        }
      };

      // What the publish job builds: its D4 step, in a checkout of the version
      // commit (its `ref:`). And the control: the same step in the landing's
      // tree, which is what the backfill used to build from.
      const publishTree = join(root, 'publish');
      g('worktree', 'add', '--quiet', '--detach', publishTree, vc);
      const landingTree = join(root, 'landing');
      g('worktree', 'add', '--quiet', '--detach', landingTree, landing);
      const publishD4 = async (tree) => {
        if (!readable) return { status: -1, manifest: '', stderr: '' };
        runs += 1;
        const temp = join(root, `step-${runs}`);
        mkdirSync(temp, { recursive: true });
        const scriptFile = join(temp, 'step.sh');
        writeFileSync(scriptFile, steps[PUBLISH_D4_STEP_NAME].script);
        let resolved;
        try {
          resolved = resolveStepEnv(steps[PUBLISH_D4_STEP_NAME].env, { 'steps.guards.outputs.version': '1.1.0' });
        } catch (err) {
          envResolved = false;
          envProblem += `${PUBLISH_D4_STEP_NAME}: ${err instanceof Error ? err.message : String(err)}; `;
          return { status: -1, manifest: '', stderr: envProblem };
        }
        const env = {
          PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
          HOME: process.env.HOME ?? root,
          STUB_NPM_PRESENT: present.join(','),
          STUB_LOG: join(temp, 'stub.log'),
          ...resolved,
        };
        const r = await runAsActions({ scriptFile, cwd: tree, env });
        const manifest = existsSync(join(tree, MANIFEST)) ? readFileSync(join(tree, MANIFEST), 'utf8') : '';
        return { ...r, manifest };
      };
      const published = await publishD4(publishTree);
      const fromLanding = await publishD4(landingTree);
      t(
        'FIXTURE: the landing really moved packages/spec/src — a manifest built in its tree differs from the publish job\'s',
        published.status === 0 && fromLanding.status === 0 && published.manifest !== '' && fromLanding.manifest !== ''
          && published.manifest !== fromLanding.manifest && fromLanding.manifest.includes("'two'"),
        `publish exit ${published.status}, landing exit ${fromLanding.status}; ${published.stderr ?? ''}`,
      );

      // The audit, on the landing: everything on npm, no Releases, image present.
      const audit = readable
        ? await tryStep(AUDIT_STEP_NAME, { 'github.sha': landing, 'github.event_name': 'push', 'github.event.before': vc })
        : { status: -1, outputs: {}, log: [], stderr: '' };
      const tree = audit.outputs['version-tree'] ?? '';
      const treeHead = tree && existsSync(tree) ? spawnSync('git', ['-C', tree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim() : '';
      t(
        'the audit requests the Releases backfill and names a tree that is at the version commit',
        audit.status === 0 && audit.outputs['releases-missing'] === 'true' && audit.outputs['version-commit'] === vc && treeHead === vc,
        `exit ${audit.status}; outputs ${JSON.stringify(audit.outputs)}; tree head ${treeHead}; ${String(audit.stderr).trim().split('\n').slice(-2).join(' | ')}`,
      );

      const fromAudit = {
        'steps.audit.outputs.version': audit.outputs.version ?? '',
        'steps.audit.outputs.version-commit': audit.outputs['version-commit'] ?? '',
        'steps.audit.outputs.version-tree': tree,
      };
      const installRun = readable ? await tryStep(BACKFILL_STEP_NAMES[0], fromAudit) : null;
      t(
        'install: the version commit\'s tree is installed, never the checkout (github.sha)',
        installRun !== null && installRun.status === 0 && ranIn(installRun, 'install').length === 1
          && ranIn(installRun, 'install')[0] === real(tree),
        installRun ? said(installRun) : 'not run',
      );

      api.reset();
      const releasesRun = readable ? await tryStep(BACKFILL_STEP_NAMES[1], fromAudit) : null;
      const posts = [...api.posts];
      t(
        'Releases: every Release is created with target_commitish = the version commit, never the landing',
        releasesRun !== null && releasesRun.status === 0 && posts.length === 2 && posts.every((p) => p.target_commitish === vc),
        `${releasesRun ? said(releasesRun) : 'not run'}; posted ${JSON.stringify(posts.map((p) => [p.tag_name, p.target_commitish]))}`,
      );
      const specBody = posts.find((p) => p.tag_name === '@objectstack/spec@1.1.0')?.body ?? '';
      t(
        '...and the truncated spec body links CHANGELOG.md at the version commit',
        specBody.includes(`/blob/${vc}/packages/spec/CHANGELOG.md#`) && !specBody.includes(landing),
        specBody.slice(0, 400),
      );

      const d4Run = readable ? await tryStep(BACKFILL_STEP_NAMES[2], fromAudit) : null;
      const attached = d4Run && existsSync(join(d4Run.temp, 'uploads', SPEC_UPLOAD))
        ? readFileSync(join(d4Run.temp, 'uploads', SPEC_UPLOAD), 'utf8')
        : '';
      t(
        'D4: the generator runs in the version commit\'s tree, and the asset is uploaded from there',
        d4Run !== null && d4Run.status === 0 && ranIn(d4Run, 'generate').join() === real(tree) && ranIn(d4Run, 'upload').join() === real(tree),
        d4Run ? said(d4Run) : 'not run',
      );
      // THE pin: the bytes a repair attaches are the bytes the publish built.
      t(
        'D4: the attached spec-changes.json is byte-identical to the publish job\'s manifest',
        attached !== '' && attached === published.manifest,
        `attached ${attached.length} bytes, publish ${published.manifest.length} bytes; landing-tree build equal: ${attached === fromLanding.manifest}`,
      );

      // Refusals: no tree named, and a tree that is not the version commit.
      const refuses = async (versionTree) => {
        api.reset();
        const rs = [];
        for (const name of BACKFILL_STEP_NAMES) rs.push(readable ? await tryStep(name, { ...fromAudit, 'steps.audit.outputs.version-tree': versionTree }) : null);
        return {
          ok: rs.every((r) => r !== null && r.status !== 0 && r.log.length === 0) && api.posts.length === 0,
          detail: rs.map((r) => (r ? said(r) : 'not run')).join(' || '),
        };
      };
      const noTree = await refuses('');
      t('an audit that named no tree: every backfill step refuses, and nothing is installed, created or attached', noTree.ok, noTree.detail);
      const wrongTree = await refuses(landingTree);
      t('a tree that is not at the version commit (the landing\'s): every backfill step refuses', wrongTree.ok, wrongTree.detail);

      t('every step\'s env resolved against the values the job sets', envResolved, envProblem);
    } finally {
      await api.close();
      await registry.close();
      rmSync(root, { recursive: true, force: true });
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
      + 'the masked partial publish caught, absence still fatal, the release audit backfilling '
      + 'only a version whose whole group is on npm, and that backfill built from the version commit\'s tree).',
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
