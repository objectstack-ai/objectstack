#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * release-dist-tags -- after a STABLE publish, move every pre-release npm
 * dist-tag that a release has overtaken up to `latest`, and remove every tag of
 * a retired channel.
 *
 *   node scripts/release-dist-tags.mjs                # plan: print every move and removal, write nothing
 *   node scripts/release-dist-tags.mjs --apply        # perform them (`npm dist-tag add` / `rm`)
 *   RELEASE_VERSION=V node scripts/release-dist-tags.mjs --apply
 *                                                     # from release.yml's `publish` job
 *   node scripts/release-dist-tags.mjs --self-test    # verify this logic
 *
 * ## The defect (#25581)
 *
 * A pre-release cycle publishes the fixed group under a dist-tag -- `next`,
 * `rc` -- and the stable release that ends the cycle moves `latest` and
 * nothing else. The pre-release tags stay where the cycle left them. Measured
 * on the registry at filing time, identically for every package of the group:
 *
 *     {"rc":"17.0.0-rc.6","latest":"18.0.0","next":"18.0.0-next.5"}
 *
 * so `npx create-objectstack@next` scaffolds 18.0.0-next.5, a pre-release of
 * the version already out as `latest`, and `@rc` is a whole major behind.
 * Nothing tells the user; every fix that went into the stable release is
 * missing. It recurs after every cycle that ends in a stable release.
 *
 * ## The rule
 *
 * For each package of the fixed group, with REFERENCE the stable version just
 * released (or, run by hand without `RELEASE_VERSION`, the package's own
 * `latest`):
 *
 *   - a tag other than `latest` whose version is a semver PRE-RELEASE below
 *     REFERENCE is stale, and moves to REFERENCE. Moved rather than removed, so
 *     `@next` keeps resolving and never to something older than `@latest`;
 *   - a pre-release tag AT or ABOVE REFERENCE is a cycle in progress (say
 *     `next` = 19.0.0-next.1 over `latest` = 18.1.0) and is left alone;
 *   - a tag on a STABLE version is not a pre-release tag -- a maintenance line
 *     someone pinned on purpose -- and is left alone, as is anything that is
 *     not semver at all; `latest` itself is never written;
 *   - a tag in `RETIRED_TAGS` is REMOVED (`npm dist-tag rm`), whatever version
 *     it points at. The release channels are `latest` (stable) and `next`
 *     (pre-release, published by release.yml in pre mode); `rc` is retired, so
 *     moving it would keep a channel alive that nothing publishes to any more.
 *     The rule for the live tags above is unchanged: `next` still moves.
 *
 * ## What it refuses, and why
 *
 *   - A pre-release REFERENCE moves nothing, and removes nothing. A pre-release
 *     publish carries its own tag and leaves `latest` where it was, so there is
 *     nothing to catch up; a retired tag goes at the next stable publish.
 *   - With `RELEASE_VERSION` given, a package whose registry `latest` is not
 *     that version is SKIPPED with a warning, after a short bounded re-read for
 *     the registry's read path to settle. Moving `next` to a version that is
 *     not `latest` could point it BELOW `latest` -- the defect, re-created.
 *   - An empty target set is a failure, not a green run over nothing.
 *
 * ## Non-blocking by the caller, honest by itself
 *
 * The card's requirement is that a failure here WARNS without failing the
 * release: npm already has every package by the time this runs, and a stale
 * tag is a nuisance, never a reason to withhold the GitHub Releases or the
 * runtime image. That is the CALLER's job -- the step in release.yml carries
 * `continue-on-error: true`. This script stays honest: any tag it could not
 * read or write is printed as a `::warning::` naming the package, and the exit
 * code is non-zero, so the step's own outcome says the sweep is incomplete.
 *
 * ## Credentials
 *
 * Reads are anonymous (`GET <registry>/-/package/<name>/dist-tags`). Writes go
 * through the npm CLI, `npm dist-tag add <name>@<version> <tag>`, so they use
 * whatever npm is already configured with: in release.yml, the `$HOME/.npmrc`
 * the publish step wrote from `NPM_TOKEN`; by hand, the maintainer's own
 * `npm login`. This file never reads, prints or forwards a token.
 *
 * ## The one-time cleanup
 *
 * The tags the defect has already left behind are swept by the next stable
 * publish on its own. To sweep them now, a holder of the npm publish rights
 * runs, from a checkout of main:
 *
 *     node scripts/release-dist-tags.mjs            # read the plan
 *     node scripts/release-dist-tags.mjs --apply    # perform it
 *
 * ⛔ Not through a `workflow_dispatch` of release.yml: its only dispatch lanes
 * are the publish repair lane and the version-PR refresh, and neither is a
 * place to put a tag sweep -- see the header of that file.
 *
 * The target set is every non-private workspace package, derived by
 * `listWorkspacePackages` in `scripts/release-github-releases.mjs` -- the
 * release lane's one answer to "which packages does a release contain", which
 * `scripts/release-verify-npm.mjs` reuses too.
 */

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import YAML from 'yaml';
import { isEntrypoint } from './invoked-as.mjs';
import { listWorkspacePackages } from './release-github-releases.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);

/** The workflow whose `publish` step battery 6 reads. Read by the self-test only. */
const RELEASE_WORKFLOW = resolve(SCRIPTS_DIR, '..', '.github/workflows/release.yml');

/** The step that publishes; the sweep must run after it, in the same job. */
const PUBLISH_STEP_NAME = 'Publish to npm + push version tags';

/** The step this file is wired into release.yml as. */
export const SWEEP_STEP_NAME = 'Move stale pre-release dist-tags up to latest';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const USER_AGENT = 'objectstack-release-dist-tags';

/**
 * Dist-tags of retired release channels. Removed, never moved: a moved `rc`
 * would still resolve, and a reader of the registry would take it for a live
 * channel. The live channels are `latest` and `next` (docs/releases-maintenance.md,
 * "Release channels"); a channel retired later is added here.
 */
export const RETIRED_TAGS = Object.freeze(['rc']);

/** Per-request ceiling, so one hung socket cannot hold the step. */
export const REQUEST_TIMEOUT_MS = 15 * 1000;

/**
 * Waits before re-reading a package whose `latest` is not yet RELEASE_VERSION.
 * By the time this runs, release-verify-npm has already read every version on
 * the registry, so the lag left is the dist-tags read path's; a minute is
 * plenty, and a package still behind after it is skipped with a warning.
 */
export const LATEST_SETTLE_DELAYS_MS = Object.freeze([5_000, 10_000, 20_000, 30_000]);

// ── The self-test's own battery roster and floor ──────────────────────────
//
// Pinned by NAME, never by one total (AGENTS.md, "Writing a `--self-test`"):
// every assertion is filed under the battery most recently opened, and the
// floor requires the opened set to equal the declared set with each battery at
// or above its own count. The counts are a floor, not an equality.
const SELF_TEST_BATTERIES = Object.freeze({
  '1. The plan: stale pre-release tags move, everything else stays': 10,
  '2. The reference: a stable release, and the registry agreeing with it': 7,
  '3. Plan mode writes nothing; --apply writes exactly the plan': 5,
  '4. Failures are named, counted and never stop the rest': 7,
  '5. End to end: a stub registry and a stub npm on PATH': 7,
  '6. The release.yml wiring: after the publish, non-blocking, no token': 9,
  '7. Retired channels: removed, never moved, and only those': 9,
});

// Deleting an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 7;

const UNATTRIBUTED_BATTERY = '(no battery open)';
const batteryCases = new Map();
let openBattery = null;

function battery(name) {
  openBattery = name;
}

function registerCase() {
  const name = openBattery ?? UNATTRIBUTED_BATTERY;
  batteryCases.set(name, (batteryCases.get(name) ?? 0) + 1);
}

function batteryFloorFailures() {
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}`
        + ' — a battery deleted from the roster takes its own floor with it.',
    );
  }
  for (const [name, count] of batteryCases) {
    if (declared.includes(name)) continue;
    problems.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]}.`,
    );
  }
  if (problems.length) {
    problems.push('A battery below its floor means cases STOPPED RUNNING — find what stopped registering and restore it.');
  }
  return problems;
}

// Set by `selfTest()` only after its verdict prints, and read at the dispatch:
// a `return` above the verdict would otherwise exit 0 having printed nothing.
let selfTestReachedVerdict = false;

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/** A registry read did not produce an answer. */
export class RegistryUnreadable extends Error {}

/**
 * Which of `tags` are stale against `reference`, which belong to a retired
 * channel, and which pre-release tags are kept because a cycle is in progress.
 *
 * Pure: no registry, no npm. `latest` is never in any list.
 *
 * @param {Record<string, string>} tags  the package's dist-tags
 * @param {string} reference             a stable semver version
 * @param {readonly string[]} [retired]  tags to remove rather than move
 * @returns {{ moves: { tag: string, from: string, to: string }[], removes: { tag: string, from: unknown }[], kept: { tag: string, version: string }[] }}
 */
export function planTags(tags, reference, retired = RETIRED_TAGS) {
  const moves = [];
  const removes = [];
  const kept = [];
  for (const [tag, version] of Object.entries(tags ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (tag === 'latest') continue;
    // Before any version test: a retired tag goes whatever it points at, a
    // stable version or a value that is not semver at all.
    if (retired.includes(tag)) {
      removes.push({ tag, from: version });
      continue;
    }
    if (typeof version !== 'string' || !semver.valid(version)) continue;
    if (semver.prerelease(version) === null) continue;
    if (semver.lt(version, reference)) moves.push({ tag, from: version, to: reference });
    else kept.push({ tag, version });
  }
  return { moves, removes, kept };
}

/**
 * Read one package's dist-tags. `null` when the package is not on the registry
 * at all (404); throws `RegistryUnreadable` when the registry did not answer.
 *
 * @param {string} name
 * @param {{ registry?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<Record<string, string> | null>}
 */
export async function readDistTags(name, options = {}) {
  const {
    registry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY || DEFAULT_REGISTRY,
    fetchImpl = fetch,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = options;
  const url = `${registry.replace(/\/$/, '')}/-/package/${name.replace('/', '%2F')}/dist-tags`;
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new RegistryUnreadable(`GET ${url} — ${err.message}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new RegistryUnreadable(`GET ${url} → HTTP ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new RegistryUnreadable(`GET ${url} → response was not JSON (${err.message})`);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RegistryUnreadable(`GET ${url} → not a dist-tags object`);
  }
  return body;
}

/**
 * Move one tag with the npm CLI. Resolves `null` on success, or the failure text.
 *
 * @param {{ name: string, tag: string, to: string }} move
 * @returns {Promise<string | null>}
 */
export async function npmDistTagAdd({ name, tag, to }) {
  const result = spawnSync('npm', ['dist-tag', 'add', `${name}@${to}`, tag], { encoding: 'utf8' });
  if (result.error) return `could not run npm: ${result.error.message}`;
  if (result.status !== 0) {
    const tail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim().split('\n').slice(-3).join(' | ');
    return `npm dist-tag add exited ${result.status}${tail ? `: ${tail}` : ''}`;
  }
  return null;
}

/**
 * Remove one tag with the npm CLI. Resolves `null` on success, or the failure text.
 *
 * @param {{ name: string, tag: string }} removal
 * @returns {Promise<string | null>}
 */
export async function npmDistTagRm({ name, tag }) {
  const result = spawnSync('npm', ['dist-tag', 'rm', name, tag], { encoding: 'utf8' });
  if (result.error) return `could not run npm: ${result.error.message}`;
  if (result.status !== 0) {
    const tail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim().split('\n').slice(-3).join(' | ');
    return `npm dist-tag rm exited ${result.status}${tail ? `: ${tail}` : ''}`;
  }
  return null;
}

const realSleep = (ms) => new Promise((resolve_) => { setTimeout(resolve_, ms); });

/**
 * Plan, and with `apply` perform, the sweep over every target package.
 *
 * Sequential on purpose: this repo's standing lesson about bursts of
 * concurrent writes against a shared backend is the tag-push race that
 * `scripts/release-publish.sh` exists for.
 *
 * @param {object} opts
 * @param {string[]} opts.names                package names, sorted
 * @param {string} [opts.releaseVersion]       the stable version just released
 * @param {boolean} [opts.apply]
 * @param {(name: string) => Promise<Record<string, string> | null>} opts.read
 * @param {(move: { name: string, tag: string, to: string }) => Promise<string | null>} opts.write
 * @param {(removal: { name: string, tag: string }) => Promise<string | null>} [opts.remove]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {readonly number[]} [opts.settleDelays]
 * @param {(line: string) => void} [opts.log]
 * @returns {Promise<{ moved: object[], planned: object[], removed: object[], plannedRemovals: object[], kept: object[], skipped: object[], failures: object[] }>}
 */
export async function sweep({
  names,
  releaseVersion,
  apply = false,
  read,
  write,
  remove = npmDistTagRm,
  sleep = realSleep,
  settleDelays = LATEST_SETTLE_DELAYS_MS,
  log = (line) => console.log(line),
}) {
  const out = { moved: [], planned: [], removed: [], plannedRemovals: [], kept: [], skipped: [], failures: [] };
  for (const name of names) {
    let tags;
    try {
      tags = await read(name);
      // Only a run told which version it released waits for the registry to
      // agree: by hand, the registry's own `latest` IS the reference.
      for (const delay of releaseVersion ? settleDelays : []) {
        if (!tags || tags.latest === releaseVersion) break;
        await sleep(delay);
        tags = await read(name);
      }
    } catch (err) {
      out.failures.push({ name, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (!tags) {
      out.skipped.push({ name, reason: 'not on the registry' });
      continue;
    }
    const latest = tags.latest;
    if (!latest || !semver.valid(latest) || semver.prerelease(latest) !== null) {
      out.skipped.push({ name, reason: `no stable latest (latest is ${latest ?? 'unset'})` });
      continue;
    }
    if (releaseVersion && latest !== releaseVersion) {
      // A warning, not a quiet skip: the run released `releaseVersion`, and a
      // package whose `latest` says otherwise is a state somebody should read.
      out.failures.push({
        name,
        reason: `latest is ${latest}, not ${releaseVersion}; nothing moved, so no tag can end up below latest`,
      });
      continue;
    }
    const { moves, removes, kept } = planTags(tags, latest);
    for (const k of kept) {
      out.kept.push({ name, ...k });
      log(`  kept   ${name} ${k.tag}: ${k.version} (ahead of latest ${latest}, a pre-release cycle in progress)`);
    }
    for (const move of moves) {
      const row = { name, ...move };
      if (!apply) {
        out.planned.push(row);
        log(`  plan   ${name} ${move.tag}: ${move.from} → ${move.to}`);
        continue;
      }
      const failure = await write(row);
      if (failure) {
        out.failures.push({ name, reason: `${move.tag}: ${move.from} → ${move.to} not moved — ${failure}` });
        continue;
      }
      out.moved.push(row);
      log(`  moved  ${name} ${move.tag}: ${move.from} → ${move.to}`);
    }
    for (const removal of removes) {
      const row = { name, ...removal };
      if (!apply) {
        out.plannedRemovals.push(row);
        log(`  plan   ${name} ${removal.tag}: ${removal.from} → removed (retired channel)`);
        continue;
      }
      const failure = await remove(row);
      if (failure) {
        out.failures.push({ name, reason: `${removal.tag}: ${removal.from} not removed — ${failure}` });
        continue;
      }
      out.removed.push(row);
      log(`  removed ${name} ${removal.tag}: ${removal.from} (retired channel)`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<number>} process exit code
 */
export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  read = (name) => readDistTags(name),
  write = npmDistTagAdd,
  remove = npmDistTagRm,
  sleep = realSleep,
  log = (line) => console.log(line),
  warn = (line) => console.error(line),
} = {}) {
  const apply = argv.includes('--apply');
  const releaseVersion = env.RELEASE_VERSION || undefined;

  if (releaseVersion !== undefined) {
    if (!semver.valid(releaseVersion)) {
      warn(`::error::RELEASE_VERSION is ${JSON.stringify(releaseVersion)}, which is not a semver version.`);
      return 1;
    }
    if (semver.prerelease(releaseVersion) !== null) {
      log(
        `${releaseVersion} is a pre-release: its publish moved its own dist-tag and left latest alone, `
          + 'so no tag has been overtaken. Nothing to do.',
      );
      return 0;
    }
  }

  let names;
  try {
    const rootAt = argv.indexOf('--root');
    const root = rootAt === -1 ? undefined : argv[rootAt + 1];
    if (rootAt !== -1 && (!root || root.startsWith('--'))) throw new Error('--root needs a directory');
    names = [...listWorkspacePackages(root === undefined ? undefined : resolve(root)).keys()].sort();
  } catch (err) {
    warn(`::error::the workspace could not be read: ${err instanceof Error ? err.message : err}`);
    return 1;
  }
  if (names.length === 0) {
    warn('::error::the publishable-package derivation produced NO packages; refusing to report a sweep over nothing.');
    return 1;
  }

  log(
    `${apply ? 'Sweeping' : 'Planning (read-only; pass --apply to write)'} the dist-tags of ${names.length} package(s)`
      + ` against ${releaseVersion ? `the release ${releaseVersion}` : "each package's own latest"}.`,
  );
  const result = await sweep({ names, releaseVersion, apply, read, write, remove, sleep, log });

  for (const s of result.skipped) log(`  skip   ${s.name}: ${s.reason}`);
  for (const f of result.failures) warn(`::warning::dist-tags of ${f.name}: ${f.reason}`);
  const done = apply
    ? `${result.moved.length} tag(s) moved, ${result.removed.length} retired tag(s) removed`
    : `${result.planned.length} tag(s) would move, ${result.plannedRemovals.length} retired tag(s) would be removed`;
  log(
    `${done}, ${result.kept.length} kept ahead of latest, ${result.skipped.length} package(s) skipped, `
      + `${result.failures.length} failure(s).`,
  );
  return result.failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/** A dist-tags registry on a free port: `tags` maps a package name to its dist-tags. */
async function stubRegistry(tags) {
  const asked = [];
  const server = createServer((req, res) => {
    const m = /^\/-\/package\/(.+)\/dist-tags$/.exec(String(req.url));
    const name = m ? decodeURIComponent(m[1]) : null;
    asked.push(name ?? String(req.url));
    if (name && tags[name] === 'broken') {
      res.writeHead(503);
      res.end();
      return;
    }
    if (!name || !tags[name]) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(tags[name]));
  });
  await new Promise((resolve_) => { server.listen(0, '127.0.0.1', resolve_); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    asked,
    close: () => new Promise((resolve_) => { server.close(resolve_); }),
  };
}

export async function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => {
    registerCase();
    return cases.push({ name, ok: Boolean(ok), detail });
  };
  const quiet = () => {};

  // The registry state measured on the card, and after 18.1.0 published.
  const FILED = { rc: '17.0.0-rc.6', latest: '18.0.0', next: '18.0.0-next.5' };
  const NOW = { rc: '17.0.0-rc.6', next: '18.0.0-next.5', latest: '18.1.0' };

  // ── 1. The plan ───────────────────────────────────────────────────────────
  battery('1. The plan: stale pre-release tags move, everything else stays');
  {
    const filed = planTags(FILED, '18.0.0');
    t('the filed state: next moves to latest', JSON.stringify(filed.moves.map((m) => m.tag)) === '["next"]', JSON.stringify(filed));
    t('each move lands on the reference', filed.moves.every((m) => m.to === '18.0.0'), JSON.stringify(filed.moves));
    t('a move records where the tag was', filed.moves.find((m) => m.tag === 'next')?.from === '18.0.0-next.5');
    t('latest itself is never planned', ![...filed.moves, ...filed.removes, ...filed.kept].some((r) => r.tag === 'latest'));
    const now = planTags(NOW, '18.1.0');
    t('the state after 18.1.0: next still moves', now.moves.length === 1 && now.moves[0].tag === 'next' && now.moves[0].to === '18.1.0', JSON.stringify(now));
    const ahead = planTags({ latest: '18.1.0', next: '19.0.0-next.1', beta: '18.0.0-beta.2' }, '18.1.0');
    t('a pre-release AHEAD of latest is a cycle in progress, and is kept', ahead.kept.length === 1 && ahead.kept[0].tag === 'next', JSON.stringify(ahead));
    t('... while a stale sibling beside it still moves', ahead.moves.length === 1 && ahead.moves[0].tag === 'beta', JSON.stringify(ahead));
    t('a pre-release of the SAME version as latest is below it, and moves', planTags({ latest: '18.1.0', next: '18.1.0-next.3' }, '18.1.0').moves.length === 1);
    t('a tag on a STABLE version is a maintenance line, never touched', planTags({ latest: '18.1.0', v17: '17.5.0' }, '18.1.0').moves.length === 0);
    const odd = planTags({ latest: '18.1.0', canary: 'not-a-version', next: 42 }, '18.1.0');
    t('a non-semver value is ignored, not moved and not thrown on', odd.moves.length === 0 && odd.kept.length === 0, JSON.stringify(odd));
  }

  // ── 2. The reference ──────────────────────────────────────────────────────
  battery('2. The reference: a stable release, and the registry agreeing with it');
  {
    const names = ['@objectstack/cli'];
    const write = async () => null;
    const remove = async () => null;
    const pre = await main({ argv: ['--apply'], env: { RELEASE_VERSION: '19.0.0-next.1' }, read: async () => { throw new Error('read'); }, write, remove, log: quiet, warn: quiet });
    t('a pre-release RELEASE_VERSION is a no-op, exit 0, nothing read', pre === 0);
    const bad = await main({ argv: ['--apply'], env: { RELEASE_VERSION: 'v-latest' }, read: async () => NOW, write, remove, log: quiet, warn: quiet });
    t('a non-semver RELEASE_VERSION is refused', bad === 1);

    const match = await sweep({ names, releaseVersion: '18.1.0', apply: true, read: async () => NOW, write, remove, sleep: async () => {}, log: quiet });
    t('latest == RELEASE_VERSION: next moves and rc is removed', match.moved.length === 1 && match.removed.length === 1 && match.failures.length === 0, JSON.stringify(match));

    let reads = 0;
    const lagging = await sweep({
      names, releaseVersion: '18.1.0', apply: true, write, remove, sleep: async () => {}, log: quiet,
      read: async () => { reads += 1; return reads < 3 ? { ...NOW, latest: '18.0.0' } : NOW; },
    });
    t('a lagging latest is re-read until it agrees, then the tags move', lagging.moved.length === 1 && lagging.removed.length === 1 && reads === 3, `reads=${reads} ${JSON.stringify(lagging)}`);

    reads = 0;
    const slept = [];
    const behind = await sweep({
      names, releaseVersion: '18.1.0', apply: true, log: quiet,
      read: async () => { reads += 1; return { ...NOW, latest: '18.0.0' }; },
      write: async () => 'must not be called',
      remove: async () => 'must not be called',
      sleep: async (ms) => { slept.push(ms); },
    });
    t('a latest that never agrees moves NOTHING, removes nothing, and is a named failure', behind.moved.length === 0 && behind.removed.length === 0 && behind.failures.length === 1 && /latest is 18\.0\.0, not 18\.1\.0/.test(behind.failures[0].reason), JSON.stringify(behind));
    t('... after exactly the bounded settle schedule', JSON.stringify(slept) === JSON.stringify(LATEST_SETTLE_DELAYS_MS) && reads === LATEST_SETTLE_DELAYS_MS.length + 1, `${JSON.stringify(slept)} reads=${reads}`);

    const preLatest = await sweep({ names, apply: true, read: async () => ({ latest: '18.0.0-rc.1', next: '17.0.0-next.1' }), write, remove, log: quiet });
    t('by hand, a package whose latest is a pre-release is skipped', preLatest.moved.length === 0 && preLatest.skipped.length === 1, JSON.stringify(preLatest));
  }

  // ── 3. Plan mode vs --apply ───────────────────────────────────────────────
  battery('3. Plan mode writes nothing; --apply writes exactly the plan');
  {
    const names = ['@objectstack/cli', '@objectstack/spec'];
    const writes = [];
    const write = async (m) => { writes.push(`${m.name}@${m.to} ${m.tag}`); return null; };
    const removals = [];
    const remove = async (r) => { removals.push(`${r.name} ${r.tag}`); return null; };
    const plan = await sweep({ names, read: async () => NOW, write, remove, log: quiet });
    t('plan mode calls no writer and no remover', writes.length === 0 && removals.length === 0, JSON.stringify({ writes, removals }));
    t('plan mode reports every move and every removal it would make', plan.planned.length === 2 && plan.plannedRemovals.length === 2 && plan.moved.length === 0 && plan.removed.length === 0, JSON.stringify(plan));
    const applied = await sweep({ names, apply: true, read: async () => NOW, write, remove, log: quiet });
    t('--apply performs each planned move and removal once', writes.length === 2 && applied.moved.length === 2 && removals.length === 2 && applied.removed.length === 2, JSON.stringify({ writes, removals }));
    t('--apply writes the next tag of each package to latest', writes.includes('@objectstack/cli@18.1.0 next') && writes.includes('@objectstack/spec@18.1.0 next'), JSON.stringify(writes));
    const ahead = await sweep({ names: ['x'], apply: true, read: async () => ({ latest: '18.1.0', next: '19.0.0-next.1' }), write: async () => 'must not be called', remove: async () => 'must not be called', log: quiet });
    t('--apply never writes a tag that is ahead of latest', ahead.moved.length === 0 && ahead.failures.length === 0 && ahead.kept.length === 1, JSON.stringify(ahead));
  }

  // ── 4. Failures ───────────────────────────────────────────────────────────
  battery('4. Failures are named, counted and never stop the rest');
  {
    const names = ['a', 'b', 'c'];
    const readers = {
      a: async () => { throw new RegistryUnreadable('GET a → HTTP 503'); },
      b: async () => null,
      c: async () => NOW,
    };
    const mixed = await sweep({ names, apply: true, read: (n) => readers[n](), write: async () => null, remove: async () => 'E403 forbidden', log: quiet });
    t('an unreadable registry is a failure naming the package', mixed.failures.some((f) => f.name === 'a' && /503/.test(f.reason)), JSON.stringify(mixed.failures));
    t('a package not on the registry is a skip, not a failure', mixed.skipped.some((s) => s.name === 'b') && !mixed.failures.some((f) => f.name === 'b'));
    t('a refused write is a failure naming the tag and the reason', mixed.failures.some((f) => f.name === 'c' && /^rc: .*not removed.*E403/.test(f.reason)), JSON.stringify(mixed.failures));
    t('... and the other tag of the same package still moves', mixed.moved.length === 1 && mixed.moved[0].tag === 'next', JSON.stringify(mixed.moved));

    const warned = [];
    const code = await main({ argv: ['--apply'], env: {}, read: (n) => (n === '@objectstack/cli' ? readers.a() : NOW), write: async () => null, remove: async () => null, log: quiet, warn: (l) => warned.push(l) });
    t('main exits non-zero when anything failed', code === 1);
    t('... and prints one ::warning:: per failure', warned.filter((l) => l.startsWith('::warning::dist-tags of @objectstack/cli')).length === 1, JSON.stringify(warned));
    const empty = mkdtempSync(join(tmpdir(), 'dist-tags-empty-'));
    try {
      writeFileSync(join(empty, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
      const vacuous = await main({ argv: ['--root', empty], env: {}, read: async () => NOW, write: async () => null, remove: async () => null, log: quiet, warn: quiet });
      t('an empty package set is refused, not a green sweep over nothing', vacuous === 1);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }

  // ── 5. End to end ─────────────────────────────────────────────────────────
  battery('5. End to end: a stub registry and a stub npm on PATH');
  {
    const root = mkdtempSync(join(tmpdir(), 'dist-tags-e2e-'));
    const registry = await stubRegistry({
      '@objectstack/cli': NOW,
      'create-objectstack': { ...NOW, next: '19.0.0-next.1' },
      '@objectstack/new': undefined,
    });
    try {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
      const pkg = (dir, manifest) => {
        mkdirSync(join(root, 'packages', dir), { recursive: true });
        writeFileSync(join(root, 'packages', dir, 'package.json'), JSON.stringify(manifest));
      };
      pkg('cli', { name: '@objectstack/cli', version: '18.1.0' });
      pkg('create', { name: 'create-objectstack', version: '18.1.0' });
      pkg('new', { name: '@objectstack/new', version: '18.1.0' });
      pkg('private', { name: '@objectstack/internal', version: '18.1.0', private: true });
      const bin = join(root, 'bin');
      mkdirSync(bin);
      const npmLog = join(root, 'npm.log');
      writeFileSync(
        join(bin, 'npm'),
        `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(npmLog)}\n`,
      );
      chmodSync(join(bin, 'npm'), 0o755);
      // ASYNC spawn: the stub registry lives in THIS process, and a spawnSync
      // would block the very event loop that has to answer the child's reads.
      const run = (args, extraEnv = {}) => new Promise((resolve_) => {
        const child = spawn(process.execPath, [SELF, ...args, '--root', root], {
          env: {
            PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
            HOME: process.env.HOME ?? root,
            npm_config_registry: registry.url,
            ...extraEnv,
          },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('close', (status) => resolve_({ status, stdout, stderr }));
      });

      const plan = await run([]);
      let npmCalls = '';
      try { npmCalls = readFileSync(npmLog, 'utf8'); } catch { /* not written */ }
      t('plan run exits 0 and spawns no npm', plan.status === 0 && npmCalls === '', `${plan.status} ${plan.stderr} ${npmCalls}`);
      t('the private package is never asked about', !registry.asked.includes('@objectstack/internal'), JSON.stringify(registry.asked));
      t('the scoped name reaches the registry encoded', registry.asked.includes('@objectstack/cli'), JSON.stringify(registry.asked));

      const applied = await run(['--apply'], { RELEASE_VERSION: '18.1.0' });
      try { npmCalls = readFileSync(npmLog, 'utf8').trim().split('\n').sort(); } catch { npmCalls = ['(npm never called)']; }
      const want = [
        'dist-tag add @objectstack/cli@18.1.0 next',
        'dist-tag rm @objectstack/cli rc',
        'dist-tag rm create-objectstack rc',
      ];
      t('--apply exits 0', applied.status === 0, `${applied.status} ${applied.stderr}`);
      t('npm is called with exactly the moves, in its own argv form', JSON.stringify(npmCalls) === JSON.stringify(want), JSON.stringify(npmCalls));
      t('the log names each move and each removal', /moved {2}@objectstack\/cli next: 18\.0\.0-next\.5 → 18\.1\.0/.test(applied.stdout) && /removed @objectstack\/cli rc: 17\.0\.0-rc\.6 \(retired channel\)/.test(applied.stdout), applied.stdout);
      t('the package not yet on npm is a logged skip', /skip {3}@objectstack\/new: not on the registry/.test(applied.stdout), applied.stdout);
    } finally {
      await registry.close();
      rmSync(root, { recursive: true, force: true });
    }
  }

  // ── 6. The release.yml wiring ─────────────────────────────────────────────
  battery('6. The release.yml wiring: after the publish, non-blocking, no token');
  {
    let steps = [];
    try {
      const doc = YAML.parse(readFileSync(RELEASE_WORKFLOW, 'utf8'));
      steps = doc?.jobs?.publish?.steps ?? [];
    } catch (err) {
      t(`release.yml parses (${err.message})`, false);
    }
    const publishAt = steps.findIndex((s) => s.name === PUBLISH_STEP_NAME);
    const sweepAt = steps.findIndex((s) => s.name === SWEEP_STEP_NAME);
    const step = steps[sweepAt] ?? {};
    t('the publish job carries the publish step', publishAt !== -1, `publishAt=${publishAt}`);
    t(`the publish job carries "${SWEEP_STEP_NAME}"`, sweepAt !== -1, `sweepAt=${sweepAt}`);
    t('... AFTER the publish step', sweepAt > publishAt, `publishAt=${publishAt} sweepAt=${sweepAt}`);
    t('it is non-blocking: continue-on-error is true', step['continue-on-error'] === true, JSON.stringify(step['continue-on-error']));
    t('it runs only when the publish step reported published', /steps\.publish\.outputs\.published == 'true'/.test(String(step.if ?? '')), String(step.if));
    t('it runs this script with --apply', /node scripts\/release-dist-tags\.mjs --apply/.test(String(step.run ?? '')), String(step.run));
    t('RELEASE_VERSION is the guarded version', step.env?.RELEASE_VERSION === '${{ steps.guards.outputs.version }}', JSON.stringify(step.env));
    t('it carries NO token of its own — the publish step\'s .npmrc is the credential', !JSON.stringify(step).includes('secrets.'), JSON.stringify(step));
    t('it is bounded: timeout-minutes is set', Number.isInteger(step['timeout-minutes']) && step['timeout-minutes'] > 0, JSON.stringify(step['timeout-minutes']));
  }

  // ── 7. Retired channels ───────────────────────────────────────────────────
  battery('7. Retired channels: removed, never moved, and only those');
  {
    t('the retired list is exactly rc — the live channels are latest and next', JSON.stringify(RETIRED_TAGS) === '["rc"]' && Object.isFrozen(RETIRED_TAGS), JSON.stringify(RETIRED_TAGS));
    const now = planTags(NOW, '18.1.0');
    t('the registry today: rc is a removal and next is a move, never the other way', JSON.stringify(now.removes) === '[{"tag":"rc","from":"17.0.0-rc.6"}]' && JSON.stringify(now.moves.map((m) => m.tag)) === '["next"]', JSON.stringify(now));
    t('a retired tag on a STABLE version is still removed', planTags({ latest: '18.1.0', rc: '18.1.0' }, '18.1.0').removes.length === 1);
    const aheadRc = planTags({ latest: '18.1.0', rc: '19.0.0-rc.1' }, '18.1.0');
    t('a retired tag AHEAD of latest is removed, not kept as a cycle in progress', aheadRc.removes.length === 1 && aheadRc.kept.length === 0, JSON.stringify(aheadRc));
    t('a retired tag on a non-semver value is removed, not skipped', planTags({ latest: '18.1.0', rc: 'garbage' }, '18.1.0').removes.length === 1);
    const live = planTags({ latest: '18.1.0', next: '18.1.0-next.3' }, '18.1.0');
    t('next is never retired: a stale next moves and nothing is removed', live.moves.length === 1 && live.removes.length === 0, JSON.stringify(live));
    const unlisted = planTags(NOW, '18.1.0', []);
    t('control: the list decides — with no retired tags, rc is a stale pre-release and moves', unlisted.removes.length === 0 && JSON.stringify(unlisted.moves.map((m) => m.tag)) === '["next","rc"]', JSON.stringify(unlisted));
    const lines = [];
    await sweep({ names: ['x'], read: async () => NOW, write: async () => 'must not be called', remove: async () => 'must not be called', log: (l) => lines.push(l) });
    t('the plan output names the removal as a removal', lines.some((l) => /^ {2}plan {3}x rc: 17\.0\.0-rc\.6 → removed \(retired channel\)$/.test(l)) && lines.some((l) => /^ {2}plan {3}x next: 18\.0\.0-next\.5 → 18\.1\.0$/.test(l)), JSON.stringify(lines));
    const adds = [];
    const rms = [];
    await sweep({ names: ['x'], apply: true, read: async () => NOW, write: async (m) => { adds.push(m.tag); return null; }, remove: async (r) => { rms.push(r.tag); return null; }, log: quiet });
    t('--apply removes rc through the remover and never adds it', JSON.stringify(rms) === '["rc"]' && !adds.includes('rc') && JSON.stringify(adds) === '["next"]', JSON.stringify({ adds, rms }));
  }

  for (const message of batteryFloorFailures()) cases.push({ name: message, ok: false });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  x ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`x release-dist-tags self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `OK release-dist-tags self-test: ${cases.length} cases pass across ${Object.keys(SELF_TEST_BATTERIES).length} batteries `
      + '(stale next moved to latest, retired rc removed, a cycle in progress kept, nothing moved below a latest the run did not set, '
      + 'failures named without stopping the rest, and the release.yml step wired after the publish, non-blocking).',
  );
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const code = await selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\nx release-dist-tags self-test: selfTest() returned without reaching its verdict,\n'
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
