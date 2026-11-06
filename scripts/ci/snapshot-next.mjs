#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// snapshot-next -- the guard and the debut rule of release.yml's `next`
// snapshot lane (ADR-0125, amendment of 2026-11-05; ruling record 6663894403).
//
//   node scripts/ci/snapshot-next.mjs preflight [--main-ref REF] [--record FILE]
//       before any deployment is queued, and again after the approval: refuses
//       while `.changeset/pre.json` says `mode: pre` -- read TWICE, in the
//       selected commit's tree and at REF (default `refs/remotes/origin/main`,
//       main as this job's checkout fetched it), so a cycle entered on main
//       after the selected commit, or during the approval wait, is seen -- when
//       the publishable set
//       is not the Changesets fixed group, and when any member of that group has
//       no version on npm (the debut rule). `--record` writes every member's
//       dist-tags as read, which `verify` compares against after the publish.
//   node scripts/ci/snapshot-next.mjs guard [--pack-dir DIR] [--json-out FILE]
//       after `changeset version --snapshot next`, before the publish: fails
//       when any package would publish under a dist-tag other than `next`, when
//       the versions are not one snapshot of the whole group, and -- reading the
//       packed manifests, since pnpm substitutes `workspace:*` at pack time --
//       when a packed manifest still carries a `workspace:` range or a range on
//       a group member that the snapshot version does not satisfy.
//   node scripts/ci/snapshot-next.mjs verify --record FILE --version V
//       after the publish: every member's `next` is V and `latest` did not move.
//   node scripts/ci/snapshot-next.mjs dry-run [--main-ref REF] [--keep]
//       the rehearsal: the registry reading of `preflight` (reported, not
//       stopped on), then the bare `changeset version --snapshot next`, then
//       `guard` with the pack, then the tree put back. Publishes nothing and
//       needs no npm token. Run locally or by the lane before the approval.
//       It refuses a dirty tree and owns the tree while it runs: the restore
//       puts every tracked path back to HEAD, so an edit made meanwhile is lost.
//   node scripts/ci/snapshot-next.mjs supersede --workflow release.yml [--dry-run]
//       the daily supersede (ADR-0125, amendment of 2026-11-06; ruling record
//       6677910954, line 3: "the next day's run supersedes it"). Run by the
//       scheduled start once today's preflight has passed: cancels YESTERDAY's
//       scheduled snapshot prompt still waiting at the `release` environment --
//       an OLDER `schedule` run of the workflow whose snapshot job is `waiting`.
//       Never a dispatch run (a human's own act), never a job that has started
//       (a cancel there is the half-published group), never a stable `Publish`
//       prompt (that is `stale-prompts`' question, and the ruling leaves it
//       untouched), never the calling run. A read the API would not answer
//       after the retries defers to tomorrow's run: nothing judged, nothing
//       cancelled, a warning. `--dry-run` prints the verdict and sends no POST.
//   node scripts/ci/snapshot-next.mjs --self-test
//
// ## Why each check exists
//
// The ruling binds one dist-tag: a snapshot is published under `next` alone and
// ⛔ never moves `latest`. A package can reach `latest` from this lane four ways,
// and each has its check here:
//
//   1. the publish command's own tag. The lane runs exactly PUBLISH_COMMAND, and
//      `changeset publish --tag T` gives every release in its plan tag T (v3's
//      `getReleaseTag` returns the given tag before anything else). The self-test
//      pins release.yml's snapshot job to one call of
//      scripts/release-snapshot-publish.sh, that script to that one publish line,
//      and both to no other publishing command; `guard` refuses a
//      `@changesets/cli` major other than the one whose rule was read.
//   2. pre mode, where changesets publishes under the pre state's tag instead.
//      Refused before any deployment is queued (changesets itself refuses both
//      `version --snapshot` and `publish --tag` in pre mode, so an approval then
//      would fail after the click). The selected commit's own tree is not
//      enough: it is older than main's tip by construction, and the approval
//      can wait a day, so a cycle entered on main since then would not show
//      there -- and a snapshot published under it would overwrite the cycle's
//      `next`. `preflight` therefore also reads main's tip as fetched
//      (MAIN_REF) and refuses on `mode: pre` at either; a MAIN_REF that does
//      not resolve is NOT MEASURED, never a pass.
//   3. a `publishConfig.tag`, an `.npmrc` `tag` or an `npm_config_tag` that a
//      package or the environment carries. Refused by `guard`.
//   4. a package's FIRST publish, which takes `latest` whatever tag the client
//      sends -- the one case a tag check cannot see, because that publish DOES
//      carry `next`. Hence the debut rule: a fixed-group member with no version
//      on npm refuses the snapshot, and the stable lane debuts it.
//
// `verify` is the after-the-fact reading of the same promise: every member's
// `next` names the snapshot and its `latest` is what it was before the publish.
// A `latest` that moved to the snapshot is an incident for the maintainer, never
// repaired with a counter-publish (AGENTS.md Prime Directive 15).
//
// ## The two starts, and the two clocks (ADR-0125, amendment of 2026-11-06)
//
// The preflight starts two ways and is the same preflight on either: a
// `workflow_dispatch` carrying `snapshot_next` (the proposal by hand, D4), and a
// daily `schedule` (ruling 6677910954, line 1). release.yml already carried a
// `schedule:` for the 6-hourly bookkeeping refresh, so the file now fires TWO
// crons on one `schedule:`, told apart the way fleet-patrols.yml tells its four
// apart: a `schedule` event carries the cron that fired it (`github.event.schedule`),
// and every scheduled job's `if:` names its own. That makes a cron under
// `schedule:` and the same string in a job's `if:` ONE fact spelled several times,
// and `snapshotWiring` holds them together: a cron no job names (a run that does
// nothing), a job naming a cron the schedule never fires (a job that never runs),
// the snapshot jobs disagreeing with each other, `version-pr` on the snapshot
// cron, and a `!=` (a third cron would then start the lane by default) are each
// refused. The hour itself is release.yml's to argue, at its `schedule:` block;
// nothing here spells it.
//
// ⛔ Nothing here publishes, tags, pushes or writes a dist-tag. `dry-run` runs the
// version step and `changeset pack` in the working tree and puts the tree back;
// `supersede` cancels one kind of waiting run and writes nothing else.

import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { boardReadBudget } from '../board-read.mjs';
import { EXIT_FINDINGS, EXIT_PREREQUISITE_NOT_MET } from '../import-prerequisite.mjs';
import { isEntrypoint } from '../invoked-as.mjs';
import { listWorkspacePackages } from '../release-github-releases.mjs';
import { PUBLISH_JOB_NAME, retryingReads, TransientReadFailure } from '../release-pending-publish.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const RELEASE_WORKFLOW = resolve(HERE, '../../.github/workflows/release.yml');
const PUBLISH_SCRIPT = resolve(HERE, '../release-snapshot-publish.sh');

// The one dist-tag this lane writes, and the one command that writes it -- the
// ruling's own words. release.yml's snapshot job runs it through PUBLISH_SCRIPT_CALL,
// that script carries this line and no other publishing command, and neither
// carries a tag push, a Release or a dist-tag write (pinned by the self-test).
export const SNAPSHOT_TAG = 'next';
export const PUBLISH_COMMAND = 'changeset publish --tag next --no-git-tag';
export const PUBLISH_SCRIPT_CALL = 'bash scripts/release-snapshot-publish.sh';
// The publish line as the script spells it: the ruling's command, its exit kept
// so npm's answers print before the script exits with it (release-publish.sh's
// shape).
export const PUBLISH_LINE = `${PUBLISH_COMMAND} || publish_status=$?`;
export const VERSION_COMMAND = 'changeset version --snapshot next';

// The version `changeset version --snapshot next` writes with this repository's
// `.changeset/config.json` (no `snapshot` block): `0.0.0-<tag>-<UTC datetime>`,
// the template-less default of @changesets/assemble-release-plan. `0.0.0` puts a
// snapshot below every stable version, which is what lets the stable lane's
// dist-tag step move `next` up to each new stable (ADR-0125 amendment, line 7).
export const SNAPSHOT_VERSION = /^0\.0\.0-next-\d{14}$/;

// The @changesets/cli major whose publish rule (point 1 of the header) was read.
export const CHANGESETS_CLI_MAJOR = 3;

// release.yml's names for this lane: the dispatch input and the three job ids.
export const SNAPSHOT_INPUT = 'snapshot_next';
export const PREFLIGHT_JOB = 'snapshot-next-preflight';
export const SNAPSHOT_JOB = 'snapshot-next';
// The daily supersede (header): the job, and the one call it makes.
export const SUPERSEDE_JOB = 'snapshot-next-supersede';
export const SUPERSEDE_CALL = 'node scripts/ci/snapshot-next.mjs supersede --workflow release.yml';
// The bookkeeping job the OTHER cron starts (#11233), which the snapshot cron never starts.
export const BOOKKEEPING_JOB = 'version-pr';
// One daily tick, `M H * * *` -- the ruling binds once a day, never a repeat.
export const DAILY_CRON = /^\d{1,2} \d{1,2} \* \* \*$/;
// The approval screen's shape as the jobs API names it, read by `supersede` to
// find a waiting snapshot prompt; the self-test holds release.yml's `name:` to
// render inside it and outside PUBLISH_JOB_NAME.
export const SNAPSHOT_JOB_NAME = /^Snapshot next of main ([0-9a-f]{12}) \(awaiting approval\)$/;
// The stable lane's jobs that a snapshot dispatch must not start.
export const STABLE_JOBS = Object.freeze(['release-integrity', 'full-battery', 'publish', 'docker']);
// Every job the daily snapshot cron must leave skipped: the stable lane, the
// stable prompt sweep (ruling line 3 leaves it untouched) and the bookkeeping job.
export const NEVER_ON_SNAPSHOT_SCHEDULE = Object.freeze([...STABLE_JOBS, 'stale-prompts', BOOKKEEPING_JOB]);
// Main's tip as the job's `fetch-depth: 0` checkout fetched it: the second
// place `preflight` reads the RC cycle (header, check 2). Both jobs pass it.
export const MAIN_REF = 'refs/remotes/origin/main';
const PRE_JSON = '.changeset/pre.json';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const REQUEST_TIMEOUT_MS = 15_000;
const DEP_FIELDS = Object.freeze(['dependencies', 'peerDependencies', 'optionalDependencies']);
const ALL_DEP_FIELDS = Object.freeze([...DEP_FIELDS, 'devDependencies']);

/** A registry read that produced no answer. */
export class RegistryUnreadable extends Error {}

// Set by `selfTest()` only after its verdict prints, and read at the dispatch.
let selfTestReachedVerdict = false;

// ---------------------------------------------------------------------------
// The rules -- pure
// ---------------------------------------------------------------------------

/** The RC-cycle refusal: `.changeset/pre.json` text (or null when absent). */
export function preModeRefusal(preJsonText) {
  if (preJsonText === null || preJsonText === undefined) return null;
  let mode;
  try {
    mode = JSON.parse(preJsonText)?.mode;
  } catch (err) {
    return `.changeset/pre.json is not JSON (${err.message}), so whether a release-candidate cycle owns \`next\` is unknown. Refusing rather than guessing.`;
  }
  if (mode === 'pre') {
    return '.changeset/pre.json says `mode: pre`: a release-candidate cycle owns the `next` channel (ADR-0087), and changesets refuses both `version --snapshot` and `publish --tag` in pre mode. No snapshot is cut until the cycle exits.';
  }
  if (mode !== 'exit') {
    return `.changeset/pre.json carries mode ${JSON.stringify(mode)}, which is neither \`pre\` nor \`exit\`. Refusing rather than guessing what it means for \`next\`.`;
  }
  return null;
}

/**
 * The RC-cycle refusals from BOTH readings: `.changeset/pre.json` in the
 * selected commit's tree and at MAIN_REF (each text, or null when absent).
 * Either one in `mode: pre` refuses; each refusal names where it was read.
 */
export function preCycleRefusals({ atCommit, atMain, mainRef = MAIN_REF }) {
  const out = [];
  const commit = preModeRefusal(atCommit);
  if (commit) out.push(`at the selected commit: ${commit}`);
  const main = preModeRefusal(atMain);
  if (main) out.push(`at ${mainRef} (main's tip as this job fetched it, newer than the selected commit): ${main}`);
  return out;
}

/** The fixed group's member names, or a refusal when the config is not one group. */
export function fixedGroup(config) {
  const fixed = config?.fixed;
  if (!Array.isArray(fixed) || fixed.length !== 1 || !Array.isArray(fixed[0]) || fixed[0].length === 0) {
    return { names: [], problem: `.changeset/config.json must carry exactly one non-empty \`fixed\` group (found ${JSON.stringify(fixed)?.slice(0, 80)}); the snapshot is one version of that group.` };
  }
  return { names: [...fixed[0]].sort(), problem: null };
}

/** The publishable workspace and the fixed group must be the same set. */
export function groupProblems(fixedNames, publishableNames) {
  const fixed = new Set(fixedNames);
  const publishable = new Set(publishableNames);
  const problems = [];
  for (const name of [...publishable].sort()) {
    if (!fixed.has(name)) problems.push(`${name} is publishable but not in the fixed group, so the snapshot would not version it and \`changeset publish\` could ship it at its own version`);
  }
  for (const name of [...fixed].sort()) {
    if (!publishable.has(name)) problems.push(`${name} is in the fixed group but is not a publishable workspace package`);
  }
  return problems;
}

/**
 * The debut rule over one registry reading per member: `null` = never
 * published (404). A member with versions but no `latest` is refused too: npm
 * gives `latest` to a publish when the package has none, so that publish would
 * write it.
 */
export function debutRefusals(states) {
  const refusals = [];
  for (const [name, state] of Object.entries(states).sort(([a], [b]) => a.localeCompare(b))) {
    if (state === null) {
      refusals.push(`${name} has no version on npm: its first publish would take \`latest\` whatever tag it carries. The stable lane debuts it; no snapshot is cut until it has.`);
    } else if (!state.distTags?.latest) {
      refusals.push(`${name} is on npm with no \`latest\` dist-tag, so a publish would set it. Refusing.`);
    }
  }
  return refusals;
}

/** The versions the snapshot step wrote, judged as ONE snapshot of the whole group. */
export function versionProblems(packages) {
  const problems = [];
  const versions = new Set();
  for (const { name, version } of packages) {
    versions.add(version);
    if (!SNAPSHOT_VERSION.test(String(version))) {
      problems.push(`${name}@${version} is not a \`next\` snapshot version (expected 0.0.0-next-YYYYMMDDHHMMSS). Either the version step did not run, or it found no changeset to version.`);
    }
  }
  if (packages.length === 0) problems.push('no publishable package was found, so there is nothing to judge -- refusing to pass over nothing');
  if (versions.size > 1) problems.push(`the publishable packages carry ${versions.size} versions (${[...versions].slice(0, 4).join(', ')}); a snapshot of the fixed group is one version`);
  return { problems, version: versions.size === 1 ? [...versions][0] : null };
}

/** A tag a manifest, an `.npmrc` or the environment would hand the publish. */
export function tagOverrideProblems({ manifests = [], npmrcs = [], env = {} }) {
  const problems = [];
  for (const { name, manifest } of manifests) {
    const tag = manifest?.publishConfig?.tag;
    if (tag !== undefined && tag !== SNAPSHOT_TAG) problems.push(`${name} declares publishConfig.tag ${JSON.stringify(tag)}, which could publish it under a dist-tag other than \`next\``);
  }
  for (const { path, text } of npmrcs) {
    for (const line of String(text).split('\n')) {
      const m = /^\s*tag\s*=\s*(.*?)\s*$/.exec(line);
      if (m && m[1] !== SNAPSHOT_TAG) problems.push(`${path} sets \`tag\` to ${JSON.stringify(m[1])}, which could publish under a dist-tag other than \`next\``);
    }
  }
  for (const key of ['npm_config_tag', 'NPM_CONFIG_TAG']) {
    if (Object.hasOwn(env, key) && env[key] !== SNAPSHOT_TAG) problems.push(`the environment sets ${key} (value not printed), which could publish under a dist-tag other than \`next\``);
  }
  return problems;
}

/**
 * Changesets' own publish plan (`changeset publish-plan -o`), judged: it must
 * publish exactly the group, each member at the snapshot version, and tag
 * nothing. The plan's `tag` field is NOT the tag that ships -- `publish-plan`
 * takes no `--tag`, and `changeset publish --tag next` overrides every
 * release's tag (header, point 1) -- so it is not read.
 */
export function planProblems(plan, { fixedNames, version }) {
  const problems = [];
  const entries = Array.isArray(plan) ? plan.flat() : [];
  const published = new Map();
  for (const entry of entries) {
    if (entry?.kind === 'tag-only') {
      problems.push(`the plan would create a git tag for ${entry.name}; the snapshot lane creates none`);
      continue;
    }
    if (entry?.kind !== 'publish') {
      problems.push(`the plan carries an entry of kind ${JSON.stringify(entry?.kind)} this guard does not know`);
      continue;
    }
    published.set(entry.name, entry.version);
  }
  for (const name of fixedNames) {
    if (!published.has(name)) problems.push(`${name} is not in the publish plan: the snapshot would ship the group without it`);
    else if (published.get(name) !== version) problems.push(`the plan publishes ${name}@${published.get(name)}, not the snapshot ${version}`);
  }
  for (const name of published.keys()) {
    if (!fixedNames.includes(name)) problems.push(`the plan publishes ${name}, which is not in the fixed group`);
  }
  return { problems, count: published.size };
}

/** One packed manifest, as `pnpm pack` substituted it, judged against the snapshot. */
export function packedManifestProblems(manifest, { name, version, fixedNames }) {
  const problems = [];
  const fixed = new Set(fixedNames);
  if (manifest?.name !== name) problems.push(`the tarball packed for ${name} carries the name ${JSON.stringify(manifest?.name)}`);
  if (manifest?.version !== version) problems.push(`${name}: the packed version is ${JSON.stringify(manifest?.version)}, not ${version}`);
  const tag = manifest?.publishConfig?.tag;
  if (tag !== undefined && tag !== SNAPSHOT_TAG) problems.push(`${name}: the packed manifest declares publishConfig.tag ${JSON.stringify(tag)}`);
  let internal = 0;
  for (const field of ALL_DEP_FIELDS) {
    for (const [dep, range] of Object.entries(manifest?.[field] ?? {})) {
      if (String(range).startsWith('workspace:')) {
        problems.push(`${name}: ${field}.${dep} is still ${JSON.stringify(range)} in the packed manifest -- the publish would ship a range no registry can resolve`);
        continue;
      }
      if (!DEP_FIELDS.includes(field) || !fixed.has(dep)) continue;
      internal += 1;
      if (!semver.validRange(range) || !semver.satisfies(version, range, { includePrerelease: true })) {
        problems.push(`${name}: ${field}.${dep} is ${JSON.stringify(range)}, which the snapshot ${version} does not satisfy -- an install of ${name}@next would not resolve ${dep}@next`);
      }
    }
  }
  return { problems, internal };
}

// ---------------------------------------------------------------------------
// The reads
// ---------------------------------------------------------------------------

/**
 * One package's registry state: `{ distTags, versions }`, `null` when the
 * package has never been published (the abbreviated packument answers 404),
 * and a `RegistryUnreadable` throw when the registry did not answer. The
 * dist-tags endpoint is not used: for a scoped package that was never
 * published it answers 401, which cannot be told from a refusal to read.
 */
export async function readRegistryState(name, { registry = DEFAULT_REGISTRY, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const url = `${registry.replace(/\/$/, '')}/${name.replace('/', '%2F')}`;
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: 'application/vnd.npm.install-v1+json', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new RegistryUnreadable(`GET ${url} -- ${err.message}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new RegistryUnreadable(`GET ${url} -> HTTP ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new RegistryUnreadable(`GET ${url} -> not JSON (${err.message})`);
  }
  if (!body || typeof body !== 'object' || typeof body['dist-tags'] !== 'object' || typeof body.versions !== 'object') {
    throw new RegistryUnreadable(`GET ${url} -> no dist-tags / versions in the answer`);
  }
  return { distTags: { ...body['dist-tags'] }, versions: Object.keys(body.versions).length };
}

/** Every member's registry state, eight at a time; unreadable ones are listed, never guessed. */
export async function readGroupStates(names, { read = readRegistryState, concurrency = 8 } = {}) {
  const states = {};
  const unread = [];
  const queue = [...names];
  const worker = async () => {
    while (queue.length) {
      const name = queue.shift();
      try {
        states[name] = await read(name);
      } catch (err) {
        unread.push(`${name}: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, worker));
  return { states, unread: unread.sort() };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readOptional(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/**
 * `.changeset/pre.json` at REF, read from git: the text, or null when REF's
 * tree has no such file. Throws when REF does not resolve or git cannot read
 * it -- whether main is in a cycle is then unknown, which is never a pass.
 */
export function readPreJsonAt(root, ref) {
  if (!/^[A-Za-z0-9._/-]+$/.test(ref)) throw new Error(`${JSON.stringify(ref)} is not a ref spelling this reader accepts`);
  const commit = run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root });
  if (commit.status !== 0) throw new Error(`${ref} does not resolve to a commit here, so whether main has entered a release-candidate cycle is unknown (the checkout must fetch main: fetch-depth: 0)`);
  const ls = run('git', ['ls-tree', '--name-only', ref, '--', PRE_JSON], { cwd: root });
  if (ls.status !== 0) throw new Error(`git ls-tree ${ref} -- ${PRE_JSON} failed (exit ${ls.status}): ${ls.stderr.trim()}`);
  if (ls.stdout.trim() === '') return null;
  const show = run('git', ['show', `${ref}:${PRE_JSON}`], { cwd: root });
  if (show.status !== 0) throw new Error(`git show ${ref}:${PRE_JSON} failed (exit ${show.status}): ${show.stderr.trim()}`);
  return show.stdout;
}

function workspaceState(root) {
  const config = readJson(join(root, '.changeset/config.json'));
  const group = fixedGroup(config);
  const publishable = [...listWorkspacePackages(root).values()].sort((a, b) => a.name.localeCompare(b.name));
  return { group, publishable };
}

// ---------------------------------------------------------------------------
// The modes
// ---------------------------------------------------------------------------

/** The refusals that hold before any deployment is queued. Returns the report. */
export async function preflight({
  root = REPO_ROOT,
  read = readRegistryState,
  mainRef = MAIN_REF,
  readPre = () => ({ atCommit: readOptional(join(root, PRE_JSON)), atMain: readPreJsonAt(root, mainRef) }),
} = {}) {
  const refusals = [];
  const { atCommit, atMain } = readPre();
  refusals.push(...preCycleRefusals({ atCommit, atMain, mainRef }));
  const { group, publishable } = workspaceState(root);
  if (group.problem) refusals.push(group.problem);
  refusals.push(...groupProblems(group.names, publishable.map((p) => p.name)));
  const { states, unread } = await readGroupStates(group.names, { read });
  refusals.push(...debutRefusals(states));
  return {
    ok: refusals.length === 0 && unread.length === 0,
    members: group.names.length,
    refusals,
    unread,
    mainRef,
    packages: group.names.map((name) => ({ name, latest: states[name]?.distTags?.latest ?? null, next: states[name]?.distTags?.next ?? null, published: Object.hasOwn(states, name) ? states[name] !== null : null })),
  };
}

function run(cmd, args, { cwd = REPO_ROOT, env = process.env } = {}) {
  return spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function changesetBin(root) {
  return join(root, 'node_modules/.bin/changeset');
}

function changesetsCliMajor(root) {
  try {
    return semver.major(readJson(join(root, 'node_modules/@changesets/cli/package.json')).version);
  } catch {
    return null;
  }
}

function npmrcFiles(root, publishable) {
  const out = [];
  for (const dir of [root, ...publishable.map((p) => p.dir)]) {
    const path = join(dir, '.npmrc');
    if (existsSync(path)) out.push({ path: path.slice(root.length + 1) || '.npmrc', text: readFileSync(path, 'utf8') });
  }
  return out;
}

/** After the version step: the static checks, the plan, and (with `packDir`) the packed manifests. */
export async function guard({ root = REPO_ROOT, packDir = null, env = process.env } = {}) {
  const problems = [];
  const pre = preModeRefusal(readOptional(join(root, '.changeset/pre.json')));
  if (pre) problems.push(pre);
  const major = changesetsCliMajor(root);
  if (major !== CHANGESETS_CLI_MAJOR) {
    problems.push(`@changesets/cli major ${major ?? 'unreadable'} is installed, but the rule that \`changeset publish --tag next\` tags every release \`next\` was read on major ${CHANGESETS_CLI_MAJOR}. Re-read it before this lane publishes.`);
  }
  const { group, publishable } = workspaceState(root);
  if (group.problem) problems.push(group.problem);
  problems.push(...groupProblems(group.names, publishable.map((p) => p.name)));
  const { problems: vProblems, version } = versionProblems(publishable);
  problems.push(...vProblems);
  const manifests = publishable.map((p) => ({ name: p.name, manifest: readJson(join(p.dir, 'package.json')) }));
  problems.push(...tagOverrideProblems({ manifests, npmrcs: npmrcFiles(root, publishable), env }));

  const report = { ok: false, version, tag: SNAPSHOT_TAG, members: group.names.length, planned: 0, packed: 0, internalRanges: 0, packages: [], problems };
  if (problems.length > 0 || !version) return report;

  const scratch = mkdtempSync(join(tmpdir(), 'snapshot-next-plan-'));
  try {
    const planFile = join(scratch, 'publish-plan.json');
    const planRun = run(changesetBin(root), ['publish-plan', '-o', planFile], { cwd: root });
    if (planRun.status !== 0 || !existsSync(planFile)) {
      problems.push(`\`changeset publish-plan\` failed (exit ${planRun.status}): ${(planRun.stderr || planRun.stdout).trim().split('\n').slice(-3).join(' / ')}`);
      return report;
    }
    const plan = readJson(planFile).plan;
    const judged = planProblems(plan, { fixedNames: group.names, version });
    problems.push(...judged.problems);
    report.planned = judged.count;
    if (packDir) {
      rmSync(packDir, { recursive: true, force: true });
      mkdirSync(packDir, { recursive: true });
      const packRun = run(changesetBin(root), ['pack', '--from-publish-plan', planFile, '--out-dir', packDir], { cwd: root });
      if (packRun.status !== 0) {
        problems.push(`\`changeset pack\` failed (exit ${packRun.status}): ${(packRun.stderr || packRun.stdout).trim().split('\n').slice(-3).join(' / ')}`);
        return report;
      }
      const packedPlan = readJson(join(packDir, 'publish-plan.json')).plan.flat().filter((e) => e.kind === 'publish');
      for (const entry of packedPlan.sort((a, b) => a.name.localeCompare(b.name))) {
        const tarball = join(packDir, entry.tarball?.path ?? '');
        const untar = run('tar', ['-xzOf', tarball, 'package/package.json'], { cwd: root });
        if (untar.status !== 0) {
          problems.push(`${entry.name}: could not read package/package.json out of ${entry.tarball?.path}`);
          continue;
        }
        const manifest = JSON.parse(untar.stdout);
        const { problems: p, internal } = packedManifestProblems(manifest, { name: entry.name, version, fixedNames: group.names });
        problems.push(...p);
        report.internalRanges += internal;
        report.packed += 1;
        report.packages.push({ name: entry.name, version: manifest.version, tag: SNAPSHOT_TAG, internalRanges: internal });
      }
      if (report.packed !== group.names.length) problems.push(`${report.packed} of ${group.names.length} group members were packed`);
    } else {
      report.packages = group.names.map((name) => ({ name, version, tag: SNAPSHOT_TAG, internalRanges: null }));
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  report.ok = problems.length === 0;
  return report;
}

/** After the publish: `next` names the snapshot and `latest` did not move. */
export function verifyTags({ before, after, version }) {
  const incidents = [];
  const pending = [];
  const notes = [];
  for (const { name, latest } of before.packages) {
    const now = after[name];
    if (!now) {
      pending.push(`${name}: not readable yet`);
      continue;
    }
    if (now.distTags.latest !== latest) {
      if (now.distTags.latest === version) incidents.push(`${name}: \`latest\` moved from ${latest} to the snapshot ${version}`);
      else notes.push(`${name}: \`latest\` moved from ${latest} to ${now.distTags.latest} -- not to the snapshot, so a stable publish ran meanwhile`);
    }
    if (now.distTags.next !== version) pending.push(`${name}: \`next\` is ${now.distTags.next ?? 'unset'}, not ${version}`);
  }
  return { incidents, pending, notes };
}

async function verify({ recordFile, version, read = readRegistryState, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), delays = [10_000, 20_000, 30_000, 60_000, 60_000, 60_000, 120_000, 120_000] }) {
  const before = readJson(recordFile);
  const names = before.packages.map((p) => p.name);
  let last = null;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    const { states } = await readGroupStates(names, { read });
    const after = Object.fromEntries(Object.entries(states).filter(([, s]) => s !== null));
    last = verifyTags({ before, after, version });
    if (last.incidents.length > 0 || last.pending.length === 0) break;
    if (attempt < delays.length) await sleep(delays[attempt]);
  }
  return last;
}

// The tree as `git status` sees it: tracked changes and untracked files.
function treeState(root) {
  const res = run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root });
  if (res.status !== 0) throw new Error(`git status failed: ${res.stderr.trim()}`);
  return res.stdout.split('\n').filter(Boolean);
}

function untracked(root) {
  const res = run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root });
  if (res.status !== 0) throw new Error(`git ls-files failed: ${res.stderr.trim()}`);
  return new Set(res.stdout.split('\n').filter(Boolean));
}

/** Put back what the version step moved: tracked paths from HEAD, and only the untracked files it created. */
function restoreTree(root, untrackedBefore) {
  const restore = run('git', ['restore', '--source=HEAD', '--staged', '--worktree', '--', '.'], { cwd: root });
  if (restore.status !== 0) throw new Error(`git restore failed: ${restore.stderr.trim()}`);
  for (const path of untracked(root)) {
    if (!untrackedBefore.has(path)) rmSync(join(root, path), { force: true });
  }
  const left = treeState(root);
  if (left.length > 0) throw new Error(`the tree was not restored: ${left.slice(0, 5).join(', ')}`);
}

async function dryRun({ root = REPO_ROOT, keep = false, read = readRegistryState, mainRef = MAIN_REF } = {}) {
  console.log(`snapshot-next dry-run: nothing is published, tagged or pushed; no npm token is read.`);
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
  console.log(`tree: ${root} at ${head}`);
  const pre = await preflight({ root, read, mainRef });
  console.log(`preflight: RC cycle read at the tree and at ${mainRef}; ${pre.members} fixed-group member(s) read on npm; ${pre.refusals.length} refusal(s), ${pre.unread.length} unread.`);
  for (const r of pre.refusals) console.log(`  REFUSED  ${r}`);
  for (const u of pre.unread) console.log(`  UNREAD   ${u}`);

  const dirty = treeState(root);
  if (dirty.length > 0) {
    console.error(`::error::the working tree is not clean (${dirty.length} path(s)); the dry run reads everything the version step moves as its output, so it runs on a clean tree only.`);
    return EXIT_PREREQUISITE_NOT_MET;
  }
  if (!existsSync(changesetBin(root))) {
    console.error('::error::node_modules/.bin/changeset is missing -- run `pnpm install --frozen-lockfile` first.');
    return EXIT_PREREQUISITE_NOT_MET;
  }
  const before = untracked(root);
  const packDir = mkdtempSync(join(tmpdir(), 'snapshot-next-pack-'));
  let report;
  try {
    console.log(`version: ${VERSION_COMMAND} (bare; never \`pnpm run version\`)`);
    const v = run(changesetBin(root), ['version', '--snapshot', SNAPSHOT_TAG], { cwd: root });
    if (v.status !== 0) {
      console.error(`::error::\`${VERSION_COMMAND}\` failed (exit ${v.status}): ${(v.stderr || v.stdout).trim().split('\n').slice(-5).join(' / ')}`);
      return EXIT_FINDINGS;
    }
    const moved = treeState(root);
    const kinds = { manifest: 0, changelog: 0, changeset: 0, other: [] };
    for (const line of moved) {
      const path = line.slice(3);
      if (/(^|\/)package\.json$/.test(path)) kinds.manifest += 1;
      else if (/(^|\/)CHANGELOG\.md$/.test(path)) kinds.changelog += 1;
      else if (path.startsWith('.changeset/')) kinds.changeset += 1;
      else kinds.other.push(path);
    }
    console.log(`version step moved ${moved.length} path(s): ${kinds.manifest} package.json, ${kinds.changelog} CHANGELOG.md, ${kinds.changeset} .changeset/ file(s), ${kinds.other.length} other${kinds.other.length ? ` (${kinds.other.slice(0, 5).join(', ')})` : ''} -- none of it is ever committed.`);
    report = await guard({ root, packDir });
  } finally {
    if (!keep) restoreTree(root, before);
    rmSync(packDir, { recursive: true, force: true });
  }
  console.log(`guard: ${report.members} member(s) · version ${report.version ?? 'none'} · tag ${report.tag} · planned ${report.planned} · packed ${report.packed} · ${report.internalRanges} intra-group range(s) in the packed manifests, all checked against the snapshot`);
  console.log('would publish (name · version · dist-tag · intra-group ranges in the packed manifest):');
  for (const p of report.packages) console.log(`  ${p.name} · ${p.version} · ${p.tag} · ${p.internalRanges}`);
  for (const p of report.problems) console.log(`  GUARD    ${p}`);
  console.log(keep ? 'tree: left versioned (--keep)' : 'tree: restored to HEAD');
  const refused = pre.refusals.length + pre.unread.length + report.problems.length;
  console.log(
    refused === 0
      ? `VERDICT: a snapshot of ${head.slice(0, 10)} would publish ${report.packed} package(s) at ${report.version} under \`${SNAPSHOT_TAG}\` alone.`
      : `VERDICT: REFUSED -- ${pre.refusals.length} preflight refusal(s), ${pre.unread.length} unread, ${report.problems.length} guard problem(s). The lane would publish nothing.`,
  );
  return refused === 0 ? 0 : EXIT_FINDINGS;
}

// ---------------------------------------------------------------------------
// release.yml, read as text: the lane's wiring
// ---------------------------------------------------------------------------

/** Each job's lines under `jobs:`, keyed by id. */
export function jobBlocks(yamlText) {
  const lines = String(yamlText).split('\n');
  const start = lines.findIndex((line) => line === 'jobs:');
  const blocks = new Map();
  if (start === -1) return blocks;
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      current = m[1];
      blocks.set(current, []);
      continue;
    }
    if (current) blocks.get(current).push(line);
  }
  return blocks;
}

const codeLines = (block) => (block ?? []).filter((line) => !/^\s*#/.test(line));

// A publishing or tag-writing act the snapshot jobs must never carry.
const FORBIDDEN_IN_SNAPSHOT = Object.freeze([
  [/\bgit\s+push\b/, 'a `git push`'],
  [/\bgh\s+release\b/, 'a `gh release` call'],
  [/\bnpm\s+dist-tag\b/, 'an `npm dist-tag` write'],
  [/\b(npm|pnpm|yarn)\s+publish\b/, 'a direct `npm publish` / `pnpm publish`'],
  [/\bpnpm\s+run\s+(release|version)\b/, '`pnpm run release` / `pnpm run version`'],
  [/release-publish\.sh|release-dist-tags\.mjs|release-github-releases\.mjs/, 'a stable post-publish script'],
  [/release-spec-changes\.sh\s+--(prepare|attach)\b/, 'the stable lane\'s spec-changes `--prepare` / `--attach`'],
  [/docker-publish\.yml/, 'the runtime image'],
]);

/** The snapshot lane's wiring in release.yml and its publish script; empty means it holds. */
export function snapshotWiring(yamlText, publishScriptText) {
  const findings = [];
  const blocks = jobBlocks(yamlText);
  const preflightJob = blocks.get(PREFLIGHT_JOB);
  const snapshotJob = blocks.get(SNAPSHOT_JOB);
  if (!preflightJob) findings.push(`release.yml has no \`${PREFLIGHT_JOB}\` job`);
  if (!snapshotJob) findings.push(`release.yml has no \`${SNAPSHOT_JOB}\` job`);
  if (!preflightJob || !snapshotJob) return findings;
  const pre = codeLines(preflightJob);
  const snap = codeLines(snapshotJob);
  const has = (lines, re) => lines.some((line) => re.test(line));

  // The approval screen.
  const nameLine = snap.find((line) => /^ {4}name:/.test(line)) ?? '';
  const name = nameLine.replace(/^ {4}name:\s*/, '').replace(/^['"]|['"]$/g, '');
  const rendered = name.replace(/\$\{\{[^}]*\}\}/g, '0123456789ab');
  if (!/^Snapshot next of main /.test(name) || !/needs\.snapshot-next-preflight\.outputs\.commit/.test(name)) {
    findings.push(`\`${SNAPSHOT_JOB}\`'s name must say it is a \`next\` snapshot and name the main commit from the preflight (got ${JSON.stringify(name)})`);
  }
  if (PUBLISH_JOB_NAME.test(rendered)) findings.push(`\`${SNAPSHOT_JOB}\`'s name matches the stable prompt shape PUBLISH_JOB_NAME, so it would be read as a stable prompt`);
  if (!has(snap, /^ {4}environment:\s*release\s*$/)) findings.push(`\`${SNAPSHOT_JOB}\` is not held at \`environment: release\``);
  if (has(pre, /^ {4}environment:/)) findings.push(`\`${PREFLIGHT_JOB}\` carries an environment: its refusals must land before any deployment is queued`);

  // Needs, the status function, the group, the permissions.
  const needs = (snap.find((line) => /^ {4}needs:/.test(line)) ?? '').replace(/^ {4}needs:\s*/, '').replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  if (needs.join() !== PREFLIGHT_JOB) findings.push(`\`${SNAPSHOT_JOB}\` must need \`${PREFLIGHT_JOB}\` alone (needs: ${needs.join(', ') || 'none'})`);
  const ifAt = snap.findIndex((line) => /^ {4}if:/.test(line));
  const ifText = ifAt === -1 ? '' : snap.slice(ifAt + 1).filter((l) => /^ {6}/.test(l)).join(' ').trim() || snap[ifAt].replace(/^ {4}if:\s*/, '');
  if (!ifText.startsWith('success() &&')) findings.push(`\`${SNAPSHOT_JOB}\`'s \`if:\` does not open with \`success() &&\`, so a refused preflight would not stop it`);
  for (const [job, lines] of [[PREFLIGHT_JOB, pre], [SNAPSHOT_JOB, snap]]) {
    if (has(lines, /\binputs\.force\b/)) findings.push(`\`${job}\` reads \`inputs.force\`: the snapshot lane never reads the repair lane's input`);
    if (has(lines, /^\s*continue-on-error:\s*true\b/)) findings.push(`\`${job}\` sets continue-on-error, so a refusal there cannot conclude failure`);
  }
  const group = (snap.find((line) => /^ {6}group:/.test(line)) ?? '').replace(/^ {6}group:\s*/, '');
  if (!group || /^release-publish-/.test(group)) findings.push(`\`${SNAPSHOT_JOB}\` needs a concurrency group of its own, never the stable \`release-publish-\` group (got ${JSON.stringify(group)})`);
  if (!has(snap, /^ {6}contents:\s*read\s*$/) || has(snap, /^ {6}contents:\s*write\b/)) findings.push(`\`${SNAPSHOT_JOB}\` must hold \`contents: read\` and nothing more for contents: it pushes no tag and cuts no Release`);

  // The publish: one call of the publish script from the job, and in that
  // script exactly one publish line, spelled as the ruling spells it.
  const script = String(publishScriptText ?? '').split('\n').filter((line) => !/^\s*#/.test(line));
  if (has(snap, /\bchangeset\s+publish\b/)) findings.push(`\`${SNAPSHOT_JOB}\` runs \`changeset publish\` itself; the publish lives in \`${PUBLISH_SCRIPT_CALL}\` alone`);
  const calls = snap.filter((line) => line.includes(PUBLISH_SCRIPT_CALL));
  if (calls.length !== 1) findings.push(`\`${SNAPSHOT_JOB}\` must call \`${PUBLISH_SCRIPT_CALL}\` exactly once (found ${calls.length})`);
  const publishLines = script.filter((line) => /\bchangeset\s+publish\b/.test(line));
  if (publishLines.length !== 1 || publishLines[0].trim() !== PUBLISH_LINE) {
    findings.push(`the publish script must run exactly one publish, \`${PUBLISH_LINE}\` (found ${publishLines.length}: ${publishLines.map((l) => l.trim()).join(' | ') || 'none'})`);
  }
  // npm's answer record, in release-publish.sh's order: the scan, then the
  // record started and handed to npm, then the publish, then the answers, then
  // the publish's own exit.
  const lineAt = (re) => script.findIndex((line) => re.test(line));
  const scanAt = lineAt(/node ui\/scripts\/check-published-dist-tooling\.mjs --no-build\b/);
  const recordAt = lineAt(/^NPM_RECORD_DIR="\$\(node scripts\/release-verify-npm\.mjs --start-npm-record\)"$/);
  const logsDirAt = lineAt(/^export npm_config_logs_dir="\$NPM_RECORD_DIR"$/);
  const logsMaxAt = lineAt(/^export npm_config_logs_max=100000$/);
  const scriptPublishAt = lineAt(/\bchangeset\s+publish\b/);
  const answersAt = lineAt(/^node scripts\/release-verify-npm\.mjs --npm-answers\b/);
  const exitAt = lineAt(/^exit "\$publish_status"$/);
  if (scanAt === -1 || scriptPublishAt === -1 || scanAt > scriptPublishAt) findings.push('the publish script must run `check-published-dist-tooling.mjs --no-build` before the publish');
  if ([recordAt, logsDirAt, logsMaxAt].some((i) => i === -1)) {
    findings.push('the publish script must start npm\'s answer record as release-publish.sh does: `release-verify-npm.mjs --start-npm-record`, then export `npm_config_logs_dir` and `npm_config_logs_max`');
  } else if (!(scanAt < recordAt && recordAt < logsDirAt && logsDirAt < scriptPublishAt && logsMaxAt < scriptPublishAt)) {
    findings.push('the publish script must start npm\'s answer record after the dist-tooling scan (its npm runs stay out of the record) and before the publish');
  }
  if (answersAt === -1 || answersAt < scriptPublishAt || exitAt === -1 || exitAt < answersAt) findings.push('the publish script must print `release-verify-npm.mjs --npm-answers` after the publish, whatever its exit, then exit with the publish\'s status');
  for (const [re, what] of FORBIDDEN_IN_SNAPSHOT) {
    if (script.some((line) => re.test(line))) findings.push(`the publish script carries ${what}: the snapshot lane pushes no tag, cuts no Release, moves no dist-tag and builds no image`);
  }
  const at = (lines, re) => lines.findIndex((line) => re.test(line));
  const guardAt = at(snap, /node scripts\/ci\/snapshot-next\.mjs guard\b/);
  const publishAt = at(snap, /bash scripts\/release-snapshot-publish\.sh\b/);
  const versionAt = at(snap, /\bchangeset version --snapshot next\s*$/);
  if (versionAt === -1) findings.push(`\`${SNAPSHOT_JOB}\` never runs the bare \`${VERSION_COMMAND}\``);
  if (guardAt === -1 || publishAt === -1 || guardAt > publishAt || versionAt > guardAt) findings.push(`\`${SNAPSHOT_JOB}\` must run the version step, then \`snapshot-next.mjs guard\`, then the publish`);
  for (const [job, lines] of [[PREFLIGHT_JOB, pre], [SNAPSHOT_JOB, snap]]) {
    const runs = lines.filter((line) => /node scripts\/ci\/snapshot-next\.mjs (preflight|dry-run)\b/.test(line));
    const unmain = runs.filter((line) => !line.includes(` --main-ref ${MAIN_REF}`));
    if (unmain.length) findings.push(`\`${job}\` reads the RC cycle without \`--main-ref ${MAIN_REF}\` (${unmain.map((l) => l.trim()).join(' | ')}): a cycle entered on main after the selected commit would not be seen`);
  }
  if (at(snap, /node scripts\/ci\/snapshot-next\.mjs preflight\b/) === -1 || at(snap, /node scripts\/ci\/snapshot-next\.mjs preflight\b/) > versionAt) findings.push(`\`${SNAPSHOT_JOB}\` must re-run \`snapshot-next.mjs preflight\` after the approval, before the version step`);
  if (at(snap, /node scripts\/ci\/snapshot-next\.mjs verify\b/) < publishAt) findings.push(`\`${SNAPSHOT_JOB}\` must run \`snapshot-next.mjs verify\` after the publish`);
  if (at(pre, /scheduled-full-run\.mjs --snapshot-commit\b/) === -1) findings.push(`\`${PREFLIGHT_JOB}\` never selects the commit with \`scheduled-full-run.mjs --snapshot-commit\``);
  if (at(pre, /scheduled-full-run\.mjs --release-gate\b.*--require-distance-zero\b/) === -1) findings.push(`\`${PREFLIGHT_JOB}\` never runs \`scheduled-full-run.mjs --release-gate\` with \`--require-distance-zero\``);
  if (at(pre, /node scripts\/ci\/snapshot-next\.mjs preflight\b/) === -1) findings.push(`\`${PREFLIGHT_JOB}\` never runs \`snapshot-next.mjs preflight\``);
  if (at(pre, /node scripts\/ci\/snapshot-next\.mjs dry-run\b/) === -1) findings.push(`\`${PREFLIGHT_JOB}\` never runs the dry run`);
  for (const [job, lines] of [[PREFLIGHT_JOB, pre], [SNAPSHOT_JOB, snap]]) {
    for (const [re, what] of FORBIDDEN_IN_SNAPSHOT) {
      if (has(lines, re)) findings.push(`\`${job}\` carries ${what}: the snapshot lane pushes no tag, cuts no Release, moves no dist-tag and builds no image`);
    }
  }

  // The clocks (header: "The two starts, and the two clocks"). Two crons on one
  // `schedule:`, each named by the jobs it starts and by no other.
  const crons = declaredCrons(yamlText);
  const bookkeeping = blocks.get(BOOKKEEPING_JOB);
  if (crons.length !== 2) findings.push(`release.yml must declare exactly two crons under \`schedule:\` -- the 6-hourly bookkeeping refresh and the daily snapshot proposal (found ${JSON.stringify(crons)})`);
  if (!bookkeeping) findings.push(`release.yml has no \`${BOOKKEEPING_JOB}\` job, so the bookkeeping cron has no reader`);
  const clocks = { [PREFLIGHT_JOB]: guardClock(preflightJob), [SNAPSHOT_JOB]: guardClock(snapshotJob), ...(bookkeeping ? { [BOOKKEEPING_JOB]: guardClock(bookkeeping) } : {}) };
  for (const [job, clock] of Object.entries(clocks)) {
    if (clock.unequal.length) findings.push(`\`${job}\`'s \`if:\` compares github.event.schedule with \`!=\` (${clock.unequal.join(', ')}): a third cron would start it by default. Name the cron it runs on.`);
    if (clock.equal.length !== 1) findings.push(`\`${job}\`'s \`if:\` must name exactly one cron it runs on (found ${clock.equal.length}: ${clock.equal.join(', ') || 'none'})`);
    for (const cron of clock.equal) {
      if (!crons.includes(cron)) findings.push(`\`${job}\`'s \`if:\` names cron '${cron}', which \`schedule:\` does not declare: a job whose if: names a cron the schedule never fires never runs`);
    }
    if (clock.equal.length && !/github\.event_name == 'schedule'/.test(clock.text)) findings.push(`\`${job}\`'s \`if:\` reads github.event.schedule without saying it is on the \`schedule\` event`);
  }
  const snapshotCron = clocks[PREFLIGHT_JOB].equal.length === 1 ? clocks[PREFLIGHT_JOB].equal[0] : null;
  if (snapshotCron !== null) {
    if (clocks[SNAPSHOT_JOB].equal[0] !== snapshotCron) findings.push(`\`${SNAPSHOT_JOB}\` names cron '${clocks[SNAPSHOT_JOB].equal[0] ?? ''}' while \`${PREFLIGHT_JOB}\` names '${snapshotCron}': one clock spelled two ways`);
    if (clocks[BOOKKEEPING_JOB]?.equal[0] === snapshotCron) findings.push(`\`${BOOKKEEPING_JOB}\` runs on the snapshot cron '${snapshotCron}': the bookkeeping refresh keeps its own clock, and the daily proposal starts no other job`);
    if (!DAILY_CRON.test(snapshotCron)) findings.push(`the snapshot cron '${snapshotCron}' is not one daily tick (\`M H * * *\`): the ruling binds once a day`);
  }
  const named = new Set(Object.values(clocks).flatMap((clock) => clock.equal));
  for (const cron of crons) {
    if (!named.has(cron)) findings.push(`cron '${cron}' is declared under \`schedule:\` but no scheduled job's \`if:\` names it: a run that does nothing`);
  }
  for (const job of [PREFLIGHT_JOB, SNAPSHOT_JOB]) {
    if (!/inputs\.snapshot_next/.test(clocks[job].text)) findings.push(`\`${job}\`'s \`if:\` lost its dispatch arm (\`inputs.snapshot_next\`): the daily cron proposes, and a dispatch is the same proposal by hand`);
  }

  // The daily supersede (header; ruling line 3).
  const supersedeJob = blocks.get(SUPERSEDE_JOB);
  if (!supersedeJob) {
    findings.push(`release.yml has no \`${SUPERSEDE_JOB}\` job: yesterday's unapproved scheduled prompt would hold the group, and today's would pend behind it unseen`);
  } else {
    const sup = codeLines(supersedeJob);
    const clock = guardClock(supersedeJob);
    if (!clock.text.startsWith('success() &&')) findings.push(`\`${SUPERSEDE_JOB}\`'s \`if:\` does not open with \`success() &&\`: a refused preflight must leave yesterday's prompt standing`);
    if (!/github\.event_name == 'schedule'/.test(clock.text) || clock.equal.length !== 1 || (snapshotCron !== null && clock.equal[0] !== snapshotCron)) findings.push(`\`${SUPERSEDE_JOB}\` must run on the snapshot cron alone (if: ${clock.text || 'none'})`);
    if (/\binputs\./.test(clock.text)) findings.push(`\`${SUPERSEDE_JOB}\` reads a dispatch input: a dispatch is a human's own act and supersedes nothing`);
    const supNeeds = (sup.find((line) => /^ {4}needs:/.test(line)) ?? '').replace(/^ {4}needs:\s*/, '').replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    if (supNeeds.join() !== PREFLIGHT_JOB) findings.push(`\`${SUPERSEDE_JOB}\` must need \`${PREFLIGHT_JOB}\` alone (needs: ${supNeeds.join(', ') || 'none'}): it supersedes only once today's proposal has passed`);
    if (has(sup, /^ {4}environment:/)) findings.push(`\`${SUPERSEDE_JOB}\` carries an environment: a cancel is never held for an approval`);
    if (!has(sup, /^ {6}actions:\s*write\s*$/)) findings.push(`\`${SUPERSEDE_JOB}\` must hold \`actions: write\`: the cancel is POST .../runs/{id}/cancel`);
    if (!has(sup, /^ {6}contents:\s*read\s*$/) || has(sup, /^ {6}contents:\s*write\b/)) findings.push(`\`${SUPERSEDE_JOB}\` must hold \`contents: read\` and nothing more for contents`);
    const supCalls = sup.filter((line) => line.includes(SUPERSEDE_CALL));
    if (supCalls.length !== 1) findings.push(`\`${SUPERSEDE_JOB}\` must run \`${SUPERSEDE_CALL}\` exactly once (found ${supCalls.length})`);
    if (has(sup, /\binputs\.force\b/)) findings.push(`\`${SUPERSEDE_JOB}\` reads \`inputs.force\`: the snapshot lane never reads the repair lane's input`);
    if (has(sup, /^\s*continue-on-error:\s*true\b/)) findings.push(`\`${SUPERSEDE_JOB}\` sets continue-on-error, so a cancel that did not land cannot conclude failure`);
    for (const [re, what] of FORBIDDEN_IN_SNAPSHOT) {
      if (has(sup, re)) findings.push(`\`${SUPERSEDE_JOB}\` carries ${what}: it cancels one kind of waiting run and writes nothing else`);
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// The clocks: release.yml's `schedule:` crons, and the cron a job's `if:` names
// ---------------------------------------------------------------------------

/**
 * The cron strings release.yml declares under `on: schedule:`, in order -- a
 * text reading of the file's own two-space YAML, as `jobBlocks` is.
 */
export function declaredCrons(yamlText) {
  const lines = String(yamlText).split('\n');
  const on = lines.findIndex((line) => /^on:\s*$/.test(line));
  if (on === -1) return [];
  const crons = [];
  let inSchedule = false;
  for (const line of lines.slice(on + 1)) {
    if (/^\S/.test(line)) break;
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (/^ {2}\S/.test(line)) {
      inSchedule = /^ {2}schedule:\s*$/.test(line);
      continue;
    }
    if (!inSchedule) continue;
    const m = /^ {4}- cron: '([^']+)'\s*(#.*)?$/.exec(line);
    if (m) crons.push(m[1]);
  }
  return crons;
}

/**
 * A job's `if:` as one line (a `>-` block folded), and the crons it compares
 * `github.event.schedule` against, by operator. Comment lines are skipped.
 */
export function guardClock(jobLines) {
  const code = codeLines(jobLines);
  const ifAt = code.findIndex((line) => /^ {4}if:/.test(line));
  if (ifAt === -1) return { text: '', equal: [], unequal: [] };
  const folded = [];
  for (const line of code.slice(ifAt + 1)) {
    if (!/^ {6,}\S/.test(line)) break;
    folded.push(line.trim());
  }
  const text = (folded.length ? folded.join(' ') : code[ifAt].replace(/^ {4}if:\s*(>-|\|)?\s*/, '')).replace(/\s+/g, ' ').trim();
  return {
    text,
    equal: [...text.matchAll(/github\.event\.schedule\s*==\s*'([^']+)'/g)].map((m) => m[1]),
    unequal: [...text.matchAll(/github\.event\.schedule\s*!=\s*'([^']+)'/g)].map((m) => m[1]),
  };
}

// ---------------------------------------------------------------------------
// The daily supersede: yesterday's scheduled prompt, and nothing else
// ---------------------------------------------------------------------------

/**
 * The supersede's judgment -- pure. Each run is `{ id, event, status, createdAt,
 * jobs: [{ name, status }], environments: [name] }`. Cancelled: a run OLDER than
 * the calling one, started by `schedule`, still `waiting` as a run, whose
 * snapshot job (SNAPSHOT_JOB_NAME) is `waiting` at the `release` environment and
 * which holds no stable prompt. Every other run is untouched, with its reason.
 */
export function judgeSnapshotPrompts({ runs, currentRunId, currentCreatedAt }) {
  const cancel = [];
  const untouched = [];
  const since = Date.parse(currentCreatedAt);
  for (const run of runs) {
    const id = String(run.id);
    const entry = { id, event: run.event };
    if (id === String(currentRunId)) {
      untouched.push({ ...entry, reason: 'the calling run' });
      continue;
    }
    // ⛔ Never a stable prompt, whatever else the run holds: that is
    // `stale-prompts`' question (release-pending-publish.mjs `sweep`), and the
    // ruling leaves the stable sweep untouched.
    if (run.jobs.some((j) => PUBLISH_JOB_NAME.test(j.name))) {
      untouched.push({ ...entry, reason: 'holds a stable publish prompt, which this job never touches (the stable sweep is stale-prompts\' alone)' });
      continue;
    }
    if (run.event !== 'schedule') {
      untouched.push({ ...entry, reason: `a ${run.event} run: a dispatch is a human's own act, and nothing supersedes it` });
      continue;
    }
    // ⛔ The mid-flight guard: a run whose snapshot job was approved is
    // `in_progress`, and cancelling THAT is the half-published fixed group the
    // job's concurrency comment forbids. Only a job GitHub is still holding at
    // the environment -- no step run -- is ever a candidate.
    if (run.status !== 'waiting') {
      untouched.push({ ...entry, reason: `run status ${run.status}, not waiting: its snapshot job has started or finished, and a cancel there could leave the group half on npm` });
      continue;
    }
    const prompts = run.jobs.filter((j) => j.status === 'waiting' && SNAPSHOT_JOB_NAME.test(j.name));
    if (prompts.length === 0) {
      untouched.push({ ...entry, reason: 'no snapshot job waiting at an environment' });
      continue;
    }
    if (!run.environments.includes('release')) {
      untouched.push({ ...entry, reason: 'not waiting on the release environment' });
      continue;
    }
    if (!(Number.isFinite(since) && Date.parse(run.createdAt) < since)) {
      untouched.push({ ...entry, reason: 'not older than the calling run' });
      continue;
    }
    cancel.push({ ...entry, commit: SNAPSHOT_JOB_NAME.exec(prompts[0].name)[1], createdAt: run.createdAt, reason: 'an earlier proposal nobody approved, superseded by this run' });
  }
  return { cancel, untouched };
}

function githubHttp({ apiUrl, token, dryRun }) {
  return async (method, path) => {
    // Structural, not a flag checked later: a dry run cannot reach a write.
    if (dryRun && method !== 'GET') throw new Error(`--dry-run refuses ${method} ${path}`);
    const res = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'objectstack-snapshot-next',
      },
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body };
  };
}

function expectOk(res, what) {
  if (res.unread) throw new TransientReadFailure(`${what}: ${res.unread.message}`, { cause: res.unread });
  if (res.status !== 200) throw new Error(`${what} answered HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
  return res.body;
}

/**
 * The runs the supersede judges, in `judgeSnapshotPrompts`' shape. Two listings,
 * because the `?status=waiting` filter was measured answering an empty list for
 * a run another reader saw waiting (release-pending-publish.mjs,
 * `collectWaitingRuns`): the waiting filter, and the workflow's newest
 * `schedule` runs on main. Every run either names, and the calling run, is read
 * directly and only that read's status is judged; a waiting run's jobs and
 * pending deployments are read too.
 */
export async function collectSnapshotRuns({ http, repo, workflow, currentRunId, recent = 50 }) {
  const listPath = `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs`;
  const waiting = expectOk(await http('GET', `${listPath}?status=waiting&per_page=100`), `listing ${workflow}'s waiting runs`);
  const scheduled = expectOk(await http('GET', `${listPath}?event=schedule&branch=main&per_page=${recent}`), `listing ${workflow}'s scheduled runs`);
  const ids = new Set([...waiting.workflow_runs.map((r) => String(r.id)), ...scheduled.workflow_runs.map((r) => String(r.id)), String(currentRunId)].filter(Boolean));
  const runs = [];
  let current = null;
  for (const id of ids) {
    const r = expectOk(await http('GET', `/repos/${repo}/actions/runs/${id}`), `reading run ${id}`);
    const run = { id: String(r.id), event: r.event, status: r.status, createdAt: r.created_at, jobs: [], environments: [] };
    if (id === String(currentRunId)) current = run;
    runs.push(run);
    if (r.status !== 'waiting') continue;
    const jobs = expectOk(await http('GET', `/repos/${repo}/actions/runs/${id}/jobs?filter=latest&per_page=100`), `listing run ${id}'s jobs`);
    run.jobs = jobs.jobs.map((j) => ({ name: j.name, status: j.status }));
    const pending = expectOk(await http('GET', `/repos/${repo}/actions/runs/${id}/pending_deployments`), `reading run ${id}'s pending deployments`);
    run.environments = pending.map((p) => p.environment && p.environment.name).filter(Boolean);
  }
  return { runs, current, listed: { waiting: waiting.workflow_runs.length, scheduled: scheduled.workflow_runs.length } };
}

/**
 * The supersede: read, judge, cancel yesterday's scheduled prompt. Answers the
 * exit code. `env`, `http`, `sleep`, `log` and `warn` are injectable so the
 * self-test drives the whole path offline -- the defaults are the live job's.
 */
export async function supersede({ workflow, dryRun = false, env = process.env, http = null, sleep, log = console.log, warn = console.error }) {
  const repo = env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is required');
  const currentRunId = env.GITHUB_RUN_ID || '';
  if (!currentRunId) throw new Error('GITHUB_RUN_ID is required: the supersede judges runs OLDER than the calling one');
  if (!http && !env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required');
  const raw = http ?? githubHttp({ apiUrl: env.GITHUB_API_URL || 'https://api.github.com', token: env.GITHUB_TOKEN, dryRun });
  // ONE retry budget for the whole read, as the stable sweep holds one.
  const reads = retryingReads(raw, boardReadBudget({ sleep }));
  const summarise = (lines) => {
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  };

  let read;
  try {
    read = await collectSnapshotRuns({ http: reads, repo, workflow, currentRunId });
  } catch (error) {
    if (!(error instanceof TransientReadFailure)) throw error;
    // ⛔ Exit 0 here, and only here: nothing was judged, so nothing was
    // cancelled, and tomorrow's proposal runs this again from scratch -- the
    // work is deferred, not lost. A 4xx, a body that does not add up and a
    // cancel that did not land still fail the job.
    const why = `${error.message}. Nothing was judged and nothing was cancelled; tomorrow's proposal runs this again and re-reads every waiting run, so the work is deferred, not lost.`;
    warn(`::warning::the daily supersede of ${workflow} could not read the Actions API this run: ${why}`);
    summarise([`### Yesterday's scheduled snapshot prompt: NOT READ this run`, '', `- ${why}`]);
    return 0;
  }
  if (!read.current) throw new Error(`run ${currentRunId} (the calling run) was not readable, so "older than this run" cannot be judged`);
  const verdict = judgeSnapshotPrompts({ runs: read.runs, currentRunId, currentCreatedAt: read.current.createdAt });

  const waiting = read.runs.filter((r) => r.status === 'waiting').length;
  const lines = [
    `### Yesterday's scheduled snapshot prompt (${waiting} waiting run(s) of ${workflow})`,
    '',
    `- readings: \`?status=waiting\` listed ${read.listed.waiting}, newest \`schedule\` runs listed ${read.listed.scheduled}; ${read.runs.length} run(s) read directly`,
  ];
  const failures = [];
  for (const c of verdict.cancel) {
    const url = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${c.id}`;
    if (dryRun) {
      log(`would cancel run ${c.id}: Snapshot next of main ${c.commit} -- ${c.reason}`);
      lines.push(`- would cancel [${c.id}](${url}): \`Snapshot next of main ${c.commit}\` (${c.createdAt}), ${c.reason}`);
      continue;
    }
    const res = await reads('POST', `/repos/${repo}/actions/runs/${c.id}/cancel`);
    if (res.status === 202) {
      log(`::notice::cancelled run ${c.id}: its "Snapshot next of main ${c.commit}" prompt (scheduled ${c.createdAt}) was still waiting, and this run's proposal supersedes it. Nothing was published from it; this run's prompt now holds the group.`);
      lines.push(`- cancelled [${c.id}](${url}): \`Snapshot next of main ${c.commit}\` (${c.createdAt}), ${c.reason}`);
    } else if (res.status === 409) {
      log(`run ${c.id} finished before it could be cancelled (HTTP 409) -- nothing waiting there any more.`);
      lines.push(`- [${c.id}](${url}) finished before the cancel landed`);
    } else {
      failures.push(`cancel of run ${c.id} answered HTTP ${res.status}`);
    }
  }
  for (const u of verdict.untouched) lines.push(`- untouched ${u.id}: ${u.reason}`);
  if (verdict.cancel.length === 0) lines.push('- nothing to supersede');
  log(lines.join('\n'));
  summarise(lines);

  if (failures.length > 0) {
    for (const f of failures) log(`::error::${f}`);
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the RC cycle: pre mode refuses, exit and absence pass, the unreadable refuses': 5,
  'the RC cycle at both readings: the selected commit and main\'s tip': 8,
  'the fixed group: one group, equal to the publishable set': 5,
  'the debut rule: never published or no latest refuses': 4,
  'the versions: one 0.0.0-next snapshot of the whole group': 5,
  'the tag overrides: publishConfig, .npmrc and the environment': 6,
  'the plan: exactly the group at the snapshot, no git tag': 5,
  'the packed manifests: no workspace range, every intra-group range satisfied': 7,
  'the registry read: 404 is never published, anything unread is never guessed': 5,
  'verify: next names the snapshot, latest never moves to it': 4,
  'release.yml: the snapshot wiring': 21,
  'release.yml: exclusivity, evaluated job by job': 7,
  'release.yml: two clocks on one schedule': 13,
  'release.yml: the daily supersede job': 9,
  'supersede: yesterday\'s scheduled prompt is cancelled, nothing else is': 12,
  'release-snapshot-publish.sh, run with a stubbed changeset: npm\'s answer record': 7,
});
const SELF_TEST_BATTERY_FLOOR = 16;

export async function selfTest() {
  const seen = new Map();
  let open = null;
  const battery = (name) => {
    open = name;
  };
  const failures = [];
  const t = async (label, fn) => {
    seen.set(open, (seen.get(open) ?? 0) + 1);
    try {
      const ok = await fn();
      if (ok !== true) failures.push(`[${open}] ${label}`);
    } catch (err) {
      failures.push(`[${open}] ${label} -- threw ${err.message}`);
    }
  };
  const V = '0.0.0-next-20261106120000';
  const FIXED = ['@objectstack/cli', '@objectstack/spec', '@objectstack/service-push'];

  battery('the RC cycle: pre mode refuses, exit and absence pass, the unreadable refuses');
  await t('absent pre.json passes', () => preModeRefusal(null) === null);
  await t('mode pre refuses, naming the cycle', () => /mode: pre/.test(preModeRefusal('{"mode":"pre","tag":"next"}') ?? ''));
  await t('mode exit passes', () => preModeRefusal('{"mode":"exit","tag":"next"}') === null);
  await t('an unknown mode refuses', () => preModeRefusal('{"mode":"weird"}') !== null);
  await t('unparseable JSON refuses', () => preModeRefusal('{not json') !== null);

  battery('the RC cycle at both readings: the selected commit and main\'s tip');
  const PRE = '{"mode":"pre","tag":"next","initialVersions":{},"changesets":[]}';
  const EXITED = '{"mode":"exit","tag":"next","initialVersions":{},"changesets":[]}';
  // The whole preflight, on this repository's real fixed group, with every
  // member published (so only the cycle can refuse) and pre.json stubbed at
  // each of the two readings.
  const allPublished = async () => ({ distTags: { latest: '18.3.0' }, versions: 1 });
  const cycle = (atCommit, atMain) => preflight({ read: allPublished, readPre: () => ({ atCommit, atMain }) });
  await t('pre at the selected commit only refuses, naming the commit', async () => {
    const r = await cycle(PRE, null);
    return !r.ok && r.refusals.length === 1 && r.refusals[0].startsWith('at the selected commit:');
  });
  await t('⭐ pre at main\'s tip only (entered after the commit, or during the approval wait) refuses, naming main', async () => {
    const r = await cycle(null, PRE);
    return !r.ok && r.refusals.length === 1 && r.refusals[0].startsWith(`at ${MAIN_REF}`);
  });
  await t('pre at both refuses once per reading', async () => {
    const r = await cycle(PRE, PRE);
    return !r.ok && r.refusals.length === 2;
  });
  await t('pre at neither (absent, or exited) passes', async () => (await cycle(null, null)).ok && (await cycle(EXITED, null)).ok && (await cycle(null, EXITED)).ok);
  // The git reader, on a scratch repository: main has pre.json, the older commit has not.
  const repo = mkdtempSync(join(tmpdir(), 'snapshot-next-pre-'));
  try {
    const git = (...args) => run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a'), '1\n');
    git('add', 'a');
    git('commit', '-qm', 'c');
    const older = git('rev-parse', 'HEAD').stdout.trim();
    mkdirSync(join(repo, '.changeset'));
    writeFileSync(join(repo, PRE_JSON), PRE);
    git('add', PRE_JSON);
    git('commit', '-qm', 'enter pre');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('checkout', '-q', '--detach', older);
    await t('the git reader sees pre.json at main\'s tip while the detached tree has none', () => readPreJsonAt(repo, MAIN_REF) === PRE && readOptional(join(repo, PRE_JSON)) === null);
    await t('a ref whose tree has no pre.json reads as absent', () => readPreJsonAt(repo, older) === null);
    await t('a main ref that does not resolve throws (NOT MEASURED), never reads as absent', () => {
      try {
        readPreJsonAt(repo, 'refs/remotes/origin/nope');
        return false;
      } catch (err) {
        return /does not resolve/.test(err.message);
      }
    });
    await t('the default preflight reads the tree AND main\'s tip: the detached scratch tree refuses on main\'s cycle', async () => {
      const readPre = () => ({ atCommit: readOptional(join(repo, PRE_JSON)), atMain: readPreJsonAt(repo, MAIN_REF) });
      const r = await preflight({ read: allPublished, readPre });
      return r.refusals.length === 1 && r.refusals[0].startsWith(`at ${MAIN_REF}`) && r.mainRef === MAIN_REF;
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }

  battery('the fixed group: one group, equal to the publishable set');
  await t('one group is read, sorted', () => fixedGroup({ fixed: [['b', 'a']] }).names.join() === 'a,b' && fixedGroup({ fixed: [['a']] }).problem === null);
  await t('two groups refuse', () => fixedGroup({ fixed: [['a'], ['b']] }).problem !== null);
  await t('no group refuses', () => fixedGroup({}).problem !== null && fixedGroup({ fixed: [[]] }).problem !== null);
  await t('equal sets pass', () => groupProblems(['a', 'b'], ['b', 'a']).length === 0);
  await t('a publishable package outside the group, and a member that is not publishable, are each named', () => {
    const p = groupProblems(['a', 'c'], ['a', 'b']);
    return p.length === 2 && p[0].startsWith('b is publishable') && p[1].startsWith('c is in the fixed group');
  });

  battery('the debut rule: never published or no latest refuses');
  await t('every member published with latest passes', () => debutRefusals({ a: { distTags: { latest: '18.3.0' } } }).length === 0);
  await t('⭐ a never-published member refuses, naming it (the @objectstack/service-push case)', () => {
    const r = debutRefusals({ '@objectstack/cli': { distTags: { latest: '18.3.0' } }, '@objectstack/service-push': null });
    return r.length === 1 && r[0].startsWith('@objectstack/service-push has no version on npm');
  });
  await t('a member with versions but no latest refuses', () => debutRefusals({ a: { distTags: { next: '1.0.0-next.0' } } }).length === 1);
  await t('every refusal is listed, in name order', () => debutRefusals({ z: null, a: null }).map((r) => r[0]).join() === 'a,z');

  battery('the versions: one 0.0.0-next snapshot of the whole group');
  await t('one snapshot version passes and is returned', () => {
    const r = versionProblems([{ name: 'a', version: V }, { name: 'b', version: V }]);
    return r.problems.length === 0 && r.version === V;
  });
  await t('a stable version refuses (the version step did not run)', () => versionProblems([{ name: 'a', version: '18.3.0' }]).problems.length === 1);
  await t('a calculated-version snapshot refuses (it would sit above the next patch)', () => versionProblems([{ name: 'a', version: '18.4.0-next-20261106120000' }]).problems.length === 1);
  await t('two snapshot versions refuse', () => versionProblems([{ name: 'a', version: V }, { name: 'b', version: '0.0.0-next-20261106120001' }]).problems.some((p) => p.includes('2 versions')));
  await t('no package refuses rather than passing over nothing', () => versionProblems([]).problems.length === 1);

  battery('the tag overrides: publishConfig, .npmrc and the environment');
  await t('none passes', () => tagOverrideProblems({ manifests: [{ name: 'a', manifest: { publishConfig: { access: 'public' } } }], npmrcs: [{ path: '.npmrc', text: 'auto-install-peers=true\n' }], env: {} }).length === 0);
  await t('publishConfig.tag latest refuses', () => tagOverrideProblems({ manifests: [{ name: 'a', manifest: { publishConfig: { tag: 'latest' } } }] }).length === 1);
  await t('publishConfig.tag next passes', () => tagOverrideProblems({ manifests: [{ name: 'a', manifest: { publishConfig: { tag: 'next' } } }] }).length === 0);
  await t('an .npmrc tag line refuses', () => tagOverrideProblems({ npmrcs: [{ path: 'packages/a/.npmrc', text: 'x=1\n tag = beta \n' }] }).length === 1);
  await t('npm_config_tag in the environment refuses, without its value', () => {
    const p = tagOverrideProblems({ env: { npm_config_tag: 'latest' } });
    return p.length === 1 && !p[0].includes('"latest"');
  });
  await t('NPM_CONFIG_TAG next passes', () => tagOverrideProblems({ env: { NPM_CONFIG_TAG: 'next' } }).length === 0);

  battery('the plan: exactly the group at the snapshot, no git tag');
  const entry = (name, version = V) => ({ kind: 'publish', name, version, access: 'public', tag: 'latest' });
  await t('the whole group at the snapshot passes (the plan\'s own tag field is not read)', () => planProblems([[entry(FIXED[0])], [entry(FIXED[1]), entry(FIXED[2])]], { fixedNames: FIXED, version: V }).problems.length === 0);
  await t('a member missing from the plan refuses', () => planProblems([[entry(FIXED[0]), entry(FIXED[1])]], { fixedNames: FIXED, version: V }).problems.length === 1);
  await t('a member at another version refuses', () => planProblems([[entry(FIXED[0]), entry(FIXED[1]), entry(FIXED[2], '18.3.0')]], { fixedNames: FIXED, version: V }).problems.length === 1);
  await t('a package outside the group refuses', () => planProblems([[...FIXED.map((n) => entry(n)), entry('stray')]], { fixedNames: FIXED, version: V }).problems.length === 1);
  await t('a tag-only entry refuses', () => planProblems([[...FIXED.map((n) => entry(n)), { kind: 'tag-only', name: 'x', version: V }]], { fixedNames: FIXED, version: V }).problems.length === 1);

  battery('the packed manifests: no workspace range, every intra-group range satisfied');
  const judge = (manifest) => packedManifestProblems({ name: FIXED[0], version: V, ...manifest }, { name: FIXED[0], version: V, fixedNames: FIXED });
  await t('exact and caret ranges on the snapshot pass, and are counted', () => {
    const r = judge({ dependencies: { [FIXED[1]]: V, other: '^1.0.0' }, peerDependencies: { [FIXED[2]]: `^${V}` } });
    return r.problems.length === 0 && r.internal === 2;
  });
  await t('⭐ a workspace:* left in the packed manifest refuses', () => judge({ dependencies: { [FIXED[1]]: 'workspace:*' } }).problems.length === 1);
  await t('a workspace range in devDependencies refuses too', () => judge({ devDependencies: { x: 'workspace:^' } }).problems.length === 1);
  await t('a stable range on a group member refuses (the snapshot does not satisfy ^18)', () => judge({ peerDependencies: { [FIXED[1]]: '^18.0.0' } }).problems.length === 1);
  await t('a stable range on a non-member is not judged', () => judge({ dependencies: { zod: '^3.0.0' } }).problems.length === 0);
  await t('a wrong packed version or name refuses', () => judge({ version: '18.3.0' }).problems.length === 1 && packedManifestProblems({ name: 'x', version: V }, { name: FIXED[0], version: V, fixedNames: FIXED }).problems.length === 1);
  await t('a packed publishConfig.tag refuses', () => judge({ publishConfig: { tag: 'latest' } }).problems.length === 1);

  battery('the registry read: 404 is never published, anything unread is never guessed');
  const answering = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  await t('404 reads as never published', async () => (await readRegistryState('@o/a', { fetchImpl: answering(404, {}) })) === null);
  await t('200 reads dist-tags and a version count', async () => {
    const s = await readRegistryState('@o/a', { fetchImpl: answering(200, { 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} } }) });
    return s.distTags.latest === '1.0.0' && s.versions === 1;
  });
  await t('a 401 (the dist-tags endpoint\'s answer for a never-published scoped name) is unreadable, never "absent"', async () => {
    try {
      await readRegistryState('@o/a', { fetchImpl: answering(401, {}) });
      return false;
    } catch (err) {
      return err instanceof RegistryUnreadable;
    }
  });
  await t('an answer without dist-tags is unreadable', async () => {
    try {
      await readRegistryState('@o/a', { fetchImpl: answering(200, { versions: {} }) });
      return false;
    } catch (err) {
      return err instanceof RegistryUnreadable;
    }
  });
  await t('the group read lists every unreadable member and guesses none', async () => {
    const { states, unread } = await readGroupStates(['a', 'b', 'c'], {
      read: async (n) => {
        if (n === 'b') throw new RegistryUnreadable('boom');
        return n === 'c' ? null : { distTags: { latest: '1.0.0' } };
      },
    });
    return unread.length === 1 && unread[0].startsWith('b:') && !Object.hasOwn(states, 'b') && states.c === null;
  });

  battery('verify: next names the snapshot, latest never moves to it');
  const before = { packages: [{ name: 'a', latest: '18.3.0' }, { name: 'b', latest: '18.3.0' }] };
  const tags = (latest, next) => ({ distTags: { latest, next } });
  await t('next on the snapshot and latest unchanged pass', () => {
    const r = verifyTags({ before, after: { a: tags('18.3.0', V), b: tags('18.3.0', V) }, version: V });
    return r.incidents.length === 0 && r.pending.length === 0;
  });
  await t('⭐ latest moved TO the snapshot is an incident', () => verifyTags({ before, after: { a: tags(V, V), b: tags('18.3.0', V) }, version: V }).incidents.length === 1);
  await t('latest moved to another stable is a note, not an incident', () => {
    const r = verifyTags({ before, after: { a: tags('18.4.0', V), b: tags('18.3.0', V) }, version: V });
    return r.incidents.length === 0 && r.notes.length === 1;
  });
  await t('next not yet on the snapshot is pending', () => verifyTags({ before, after: { a: tags('18.3.0', '18.2.0') }, version: V }).pending.length === 2);

  battery('release.yml: the snapshot wiring');
  const yml = readFileSync(RELEASE_WORKFLOW, 'utf8');
  const sh = readFileSync(PUBLISH_SCRIPT, 'utf8');
  // The publish script's code line (its header comments spell the command too).
  const PUBLISH_LINE_RE = /\nchangeset publish --tag next --no-git-tag \|\| publish_status=\$\?\n/;
  const fires = (mutated, needle) => mutated !== yml && snapshotWiring(mutated, sh).some((f) => f.includes(needle));
  const firesSh = (mutated, needle) => mutated !== sh && snapshotWiring(yml, mutated).some((f) => f.includes(needle));
  await t('the checked-in release.yml and publish script hold', () => {
    const f = snapshotWiring(yml, sh);
    if (f.length) failures.push(...f.map((x) => `  wiring: ${x}`));
    return f.length === 0;
  });
  await t('the approval-screen name renders outside PUBLISH_JOB_NAME', () => !PUBLISH_JOB_NAME.test('Snapshot next of main 0123456789ab (awaiting approval)') && PUBLISH_JOB_NAME.test('Publish 18.3.0 to npm (awaiting approval)'));
  await t('a snapshot job named like a stable prompt is refused', () => fires(yml.replace(/(\n {2}snapshot-next:\n(?: {4}#[^\n]*\n)*) {4}name: [^\n]*/, '$1    name: Publish ${{ needs.snapshot-next-preflight.outputs.commit-short }} to npm (awaiting approval)'), 'stable prompt shape'));
  await t('a snapshot job without environment: release is refused', () => fires(yml.replace(/(\n {2}snapshot-next:[\s\S]*?\n) {4}environment: release\n/, '$1'), 'environment: release'));
  await t('an if: under !cancelled() is refused', () => fires(yml.replace(/(\n {2}snapshot-next:[\s\S]*?\n {4}if: >-\n\s*)success\(\) &&/, '$1!cancelled() &&'), 'success() &&'));
  await t('the stable publish group is refused', () => fires(yml.replace('group: release-snapshot-next-', 'group: release-publish-'), 'concurrency group'));
  await t('contents: write is refused', () => fires(yml.replace(/(\n {2}snapshot-next:[\s\S]*?\n {6})contents: read/, '$1contents: write'), 'contents: read'));
  await t('a publish with another tag is refused', () => firesSh(sh.replace(PUBLISH_LINE_RE, '\nchangeset publish --tag latest --no-git-tag || publish_status=$?\n'), 'exactly one publish'));
  await t('a publish that keeps git tags is refused', () => firesSh(sh.replace(PUBLISH_LINE_RE, '\nchangeset publish --tag next || publish_status=$?\n'), 'exactly one publish'));
  await t('a git push in the publish script, or in the job, is refused', () => firesSh(sh.replace(PUBLISH_LINE_RE, `\n${PUBLISH_LINE}\ngit push origin --tags\n`), 'git push') && fires(yml.replace(`          ${PUBLISH_SCRIPT_CALL}\n`, `          ${PUBLISH_SCRIPT_CALL}\n          git push origin --tags\n`), 'git push'));
  await t('a publish run inline in the job is refused', () => fires(yml.replace(`          ${PUBLISH_SCRIPT_CALL}\n`, `          ${PUBLISH_SCRIPT_CALL}\n          changeset publish --tag next --no-git-tag\n`), 'runs `changeset publish` itself'));
  await t('a guard after the publish is refused', () => fires(yml.replace(/node scripts\/ci\/snapshot-next\.mjs guard\b/, 'node scripts/ci/snapshot-next.mjs gaurd'), 'then the publish'));
  await t('a preflight without the distance-zero gate is refused', () => fires(yml.replace(/(--release-commit "\$commit") --require-distance-zero/, '$1'), '--require-distance-zero'));
  await t('a snapshot job reading inputs.force is refused', () => fires(yml.replace(/(\n {2}snapshot-next:[\s\S]*?\n {4}if: >-\n[^\n]*\n)/, '$1      !inputs.force &&\n'), 'inputs.force'));
  await t('a publish script that starts no npm answer record is refused', () => firesSh(sh.replace(/\nNPM_RECORD_DIR="[^\n]*\n/, '\n'), 'answer record') && firesSh(sh.replace(/\nexport npm_config_logs_dir="\$NPM_RECORD_DIR"\n/, '\n'), 'answer record'));
  await t('a record started before the dist-tooling scan is refused (the scan\'s npm runs would land in it)', () => {
    const rec = sh.match(/\nNPM_RECORD_DIR="[^\n]*\n/)?.[0] ?? '';
    const cut = sh.replace(rec, '\n').replace(/\nif ! node ui\/scripts\/check-published-dist-tooling/, `${rec}if ! node ui/scripts/check-published-dist-tooling`);
    return firesSh(cut, 'after the dist-tooling scan');
  });
  await t('a publish script that never prints npm\'s answers is refused', () => firesSh(sh.replace(/\nnode scripts\/release-verify-npm\.mjs --npm-answers \\\n[^\n]*\n/, '\n'), '--npm-answers'));
  await t('a publish whose exit is not kept (the answers would never print on a failure) is refused', () => firesSh(sh.replace(PUBLISH_LINE_RE, `\n${PUBLISH_COMMAND}\n`), 'exactly one publish') && firesSh(sh.replace(/\nexit "\$publish_status"\n/, '\n'), 'exit with the publish'));
  await t('a preflight in either job without --main-ref is refused', () => fires(yml.replace(/(node scripts\/ci\/snapshot-next\.mjs preflight) --main-ref refs\/remotes\/origin\/main\n/, '$1\n'), '--main-ref') && fires(yml.replace(/(node scripts\/ci\/snapshot-next\.mjs preflight) --main-ref refs\/remotes\/origin\/main --record/, '$1 --record'), '--main-ref'));
  await t('a dry run without --main-ref is refused', () => fires(yml.replace(/(snapshot-next\.mjs dry-run) --main-ref refs\/remotes\/origin\/main/, '$1'), '--main-ref'));
  await t('pnpm run version in the lane is refused', () => fires(yml.replace(/changeset version --snapshot next\s*\n/, 'changeset version --snapshot next\n          pnpm run version\n'), 'pnpm run version'));

  battery('release.yml: exclusivity, evaluated job by job');
  // fleet-write's evaluator reads every job's `if:` the way GitHub does; imported
  // here only, so the lane's own path loads none of it.
  const { jobsStartedBy, declaredDispatchInputs, dispatchRunInputs } = await import('../pm/fleet-write/validate.mjs');
  const declared = declaredDispatchInputs(yml);
  const started = (text, event, sent, schedule = null) => jobsStartedBy(text, { event, inputs: dispatchRunInputs(declaredDispatchInputs(text), sent), schedule });
  const touchesSnapshot = (r) => [...r.runs, ...r.mayRun].filter((j) => j === PREFLIGHT_JOB || j === SNAPSHOT_JOB || j === SUPERSEDE_JOB);
  // The two crons, read off the file and told apart by the job each starts; neither is spelled here.
  const ymlCrons = declaredCrons(yml);
  const bookkeepingCron = guardClock(jobBlocks(yml).get(BOOKKEEPING_JOB) ?? []).equal[0] ?? null;
  const snapshotCron = guardClock(jobBlocks(yml).get(PREFLIGHT_JOB) ?? []).equal[0] ?? null;
  await t('the input is declared, boolean, default false', () => declared?.[SNAPSHOT_INPUT]?.type === 'boolean' && declared[SNAPSHOT_INPUT].default === 'false');
  await t('push and the bookkeeping cron never reach the snapshot jobs', () => bookkeepingCron !== null && touchesSnapshot(started(yml, 'push', {})).length === 0 && touchesSnapshot(started(yml, 'schedule', {}, bookkeepingCron)).length === 0);
  await t('the repair dispatch, the force repair and the refresh never reach them', () => [{}, { force: true }, { refresh_version_pr: true }].every((sent) => touchesSnapshot(started(yml, 'workflow_dispatch', sent)).length === 0));
  await t('⭐ a snapshot dispatch starts the preflight and runs NONE of the stable lane\'s jobs', () => {
    const r = started(yml, 'workflow_dispatch', { [SNAPSHOT_INPUT]: true });
    return r.runs.includes(PREFLIGHT_JOB) && [...r.runs, ...r.mayRun].includes(SNAPSHOT_JOB) && STABLE_JOBS.every((j) => r.skipped.includes(j)) && r.unread.length === 0;
  });
  await t('force beside the snapshot widens nothing: still no stable job', () => {
    const r = started(yml, 'workflow_dispatch', { [SNAPSHOT_INPUT]: true, force: true });
    return STABLE_JOBS.every((j) => r.skipped.includes(j)) && r.runs.includes(PREFLIGHT_JOB);
  });
  await t('the refresh beside the snapshot runs the bookkeeping alone (the harmless reading)', () => {
    const r = started(yml, 'workflow_dispatch', { [SNAPSHOT_INPUT]: true, refresh_version_pr: true });
    return touchesSnapshot(r).length === 0 && r.runs.includes('version-pr') && STABLE_JOBS.every((j) => r.skipped.includes(j));
  });
  await t('⛔ the pin can fail: release-integrity without the snapshot negation starts on a snapshot dispatch', () => {
    const cut = yml.replace(/(\n {2}release-integrity:[\s\S]*?) && !inputs\.snapshot_next\)/, '$1)');
    return cut !== yml && started(cut, 'workflow_dispatch', { [SNAPSHOT_INPUT]: true }).runs.includes('release-integrity');
  });

  battery('release.yml: two clocks on one schedule');
  // The checked-in file's clocks are judged by the wiring case above; here the readers, the exclusivity
  // by cron, and that every clock pin can fail. The crons are the file's own (read, never spelled).
  const q = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await t('release.yml declares two distinct crons under schedule:, and the readers find one on version-pr and one on the preflight', () => ymlCrons.length === 2 && ymlCrons[0] !== ymlCrons[1] && bookkeepingCron !== null && snapshotCron !== null && bookkeepingCron !== snapshotCron && ymlCrons.includes(bookkeepingCron) && ymlCrons.includes(snapshotCron));
  await t('the snapshot cron is one daily tick, and the three snapshot jobs name it alike', () => DAILY_CRON.test(snapshotCron) && [SNAPSHOT_JOB, SUPERSEDE_JOB].every((job) => guardClock(jobBlocks(yml).get(job) ?? []).equal.join() === snapshotCron));
  await t('declaredCrons reads nothing from a file with no on: block, and guardClock reads a job with no if: as clockless', () => declaredCrons('jobs:\n  a:\n    runs-on: x\n').length === 0 && guardClock(['    runs-on: x']).equal.length === 0);
  await t('the bookkeeping cron starts version-pr alone, nothing undecided', () => {
    const r = started(yml, 'schedule', {}, bookkeepingCron);
    return r.runs.join() === BOOKKEEPING_JOB && r.mayRun.length === 0 && r.unread.length === 0;
  });
  await t('⭐ the snapshot cron starts the preflight ALONE: the snapshot job and the supersede may run behind it, and every stable job, stale-prompts and version-pr are skipped', () => {
    const r = started(yml, 'schedule', {}, snapshotCron);
    return r.runs.join() === PREFLIGHT_JOB && [...r.mayRun].sort().join() === [SNAPSHOT_JOB, SUPERSEDE_JOB].sort().join() && NEVER_ON_SNAPSHOT_SCHEDULE.every((j) => r.skipped.includes(j)) && r.unread.length === 0;
  });
  await t('a schedule run whose cron is not named leaves version-pr and the preflight undecided -- the reader does not guess which clock fired', () => {
    const r = started(yml, 'schedule', {});
    return r.runs.length === 0 && r.mayRun.includes(BOOKKEEPING_JOB) && r.mayRun.includes(PREFLIGHT_JOB) && r.unread.length === 0;
  });
  await t('a snapshot dispatch starts no supersede: a dispatch is a human\'s own act', () => started(yml, 'workflow_dispatch', { [SNAPSHOT_INPUT]: true }).skipped.includes(SUPERSEDE_JOB));
  await t('⛔ the pin can fail: version-pr without its cron conjunct starts on the snapshot cron', () => {
    const cut = yml.replace(new RegExp(`\\(github\\.event_name == 'schedule' && github\\.event\\.schedule == '${q(bookkeepingCron)}'\\)`), "github.event_name == 'schedule'");
    return cut !== yml && started(cut, 'schedule', {}, snapshotCron).runs.includes(BOOKKEEPING_JOB) && fires(cut, 'no scheduled job');
  });
  await t('the snapshot job naming another cron than the preflight is refused (one clock spelled two ways)', () => fires(yml.replace(new RegExp(`(\\n {2}snapshot-next:[\\s\\S]*?github\\.event\\.schedule == )'${q(snapshotCron)}'`), "$1'59 23 * * *'"), 'one clock spelled two ways'));
  await t('a != on the clock is refused (a third cron would start the lane by default)', () => fires(yml.replace(new RegExp(`(\\n {2}snapshot-next-preflight:[\\s\\S]*?github\\.event\\.schedule) == '${q(snapshotCron)}'`), `$1 != '${bookkeepingCron}'`), '`!=`'));
  await t('version-pr on the snapshot cron is refused', () => fires(yml.replace(new RegExp(`(\\n {2}version-pr:[\\s\\S]*?github\\.event\\.schedule == )'${q(bookkeepingCron)}'`), `$1'${snapshotCron}'`), 'runs on the snapshot cron'));
  await t('a cron declared under schedule: that no job names is refused, and a cron a job names that schedule: does not declare is refused', () => fires(yml.replace(/(\n {2}schedule:\n(?:(?: {4}#[^\n]*| {4}- cron: '[^']*')\n)+)/, "$1    - cron: '5 5 * * *'\n"), 'no scheduled job') && fires(yml.replace(`    - cron: '${snapshotCron}'`, "    - cron: '5 5 * * *'"), 'does not declare'));
  await t('a snapshot cron that is not one daily tick is refused, and a preflight that lost its dispatch arm is refused', () => fires(yml.replaceAll(`'${snapshotCron}'`, "'17 */12 * * *'"), 'not one daily tick') && fires(yml.replace(/(\n {2}snapshot-next-preflight:[\s\S]*?\n {4}if: >-\n[^\n]*\n)[\s\S]*?(\n {4}runs-on:)/, '$1$2'), 'dispatch arm'));

  battery('release.yml: the daily supersede job');
  const supBlock = jobBlocks(yml).get(SUPERSEDE_JOB);
  await t('the checked-in supersede job exists, needs the preflight alone, runs on the snapshot cron, and calls the supersede once', () => Array.isArray(supBlock) && guardClock(supBlock).text.startsWith('success() &&') && guardClock(supBlock).equal.join() === snapshotCron && codeLines(supBlock).filter((l) => l.includes(SUPERSEDE_CALL)).length === 1);
  const supAt = yml.indexOf(`\n  ${SUPERSEDE_JOB}:\n`);
  await t('a release.yml without the supersede job is refused', () => supAt > 0 && fires(`${yml.slice(0, supAt)}\n`, `has no \`${SUPERSEDE_JOB}\``));
  const mutSup = (re, to) => yml.slice(0, supAt) + yml.slice(supAt).replace(re, to);
  await t('an if: under !cancelled() is refused', () => fires(mutSup(/(\n {4}if: >-\n\s*)success\(\) &&/, '$1!cancelled() &&'), 'success() &&'));
  await t('a supersede that reads a dispatch input is refused', () => fires(mutSup(/(github\.event_name == 'schedule' && github\.event\.schedule == '[^']*')/, '$1 && inputs.snapshot_next'), 'dispatch input'));
  await t('actions: read instead of write is refused', () => fires(mutSup(/\n {6}actions: write\n/, '\n      actions: read\n'), 'actions: write'));
  await t('an environment on the supersede is refused', () => fires(mutSup(/(\n {4}runs-on: ubuntu-latest\n)/, '$1    environment: release\n'), 'carries an environment'));
  await t('a supersede needing the snapshot job too is refused', () => fires(mutSup(/\n {4}needs: \[snapshot-next-preflight\]\n/, '\n    needs: [snapshot-next-preflight, snapshot-next]\n'), 'alone'));
  await t('a git push, or a second supersede call, in the job is refused', () => fires(mutSup(new RegExp(`(\\n {8}run: ${q(SUPERSEDE_CALL)}\\n)`), '$1      - run: git push origin --tags\n'), 'git push') && fires(mutSup(new RegExp(`(\\n {8}run: ${q(SUPERSEDE_CALL)}\\n)`), `$1      - run: ${SUPERSEDE_CALL}\n`), 'exactly once'));
  await t('the snapshot job needing the supersede is refused (it needs the preflight alone)', () => fires(yml.replace(/(\n {2}snapshot-next:[\s\S]*?\n {4}needs: )\[snapshot-next-preflight\]/, '$1[snapshot-next-preflight, snapshot-next-supersede]'), 'alone'));

  battery('supersede: yesterday\'s scheduled prompt is cancelled, nothing else is');
  const NOW = '2026-11-06T01:17:40Z';
  const YDAY = '2026-11-05T01:17:35Z';
  const snapJob = (status, sha = '0123456789ab') => ({ name: `Snapshot next of main ${sha} (awaiting approval)`, status });
  const aRun = (id, over = {}) => ({ id, event: 'schedule', status: 'waiting', createdAt: YDAY, jobs: [snapJob('waiting')], environments: ['release'], ...over });
  const judgeRuns = (runs) => judgeSnapshotPrompts({ runs, currentRunId: '200', currentCreatedAt: NOW });
  await t('⭐ yesterday\'s scheduled prompt, waiting at release, is cancelled, naming its commit', () => {
    const r = judgeRuns([aRun('100')]);
    return r.cancel.length === 1 && r.cancel[0].id === '100' && r.cancel[0].commit === '0123456789ab' && r.untouched.length === 0;
  });
  await t('the calling run is untouched', () => judgeRuns([aRun('200', { createdAt: NOW })]).cancel.length === 0);
  await t('a dispatch run is untouched: a human\'s own act', () => {
    const r = judgeRuns([aRun('100', { event: 'workflow_dispatch' })]);
    return r.cancel.length === 0 && /human/.test(r.untouched[0].reason);
  });
  await t('⛔ an approved run (in_progress) is never touched: a cancel there is the half-published group', () => {
    const r = judgeRuns([aRun('100', { status: 'in_progress', jobs: [snapJob('in_progress')] })]);
    return r.cancel.length === 0 && /started/.test(r.untouched[0].reason);
  });
  await t('⛔ a run holding a stable Publish prompt is never touched, whatever else it holds', () => {
    const r = judgeRuns([aRun('100', { jobs: [{ name: 'Publish 18.4.0 to npm (awaiting approval)', status: 'waiting' }] })]);
    return r.cancel.length === 0 && /stable/.test(r.untouched[0].reason) && PUBLISH_JOB_NAME.test('Publish 18.4.0 to npm (awaiting approval)');
  });
  await t('a run waiting on another environment, or with no snapshot job waiting, is untouched', () => judgeRuns([aRun('100', { environments: ['staging'] })]).cancel.length === 0 && judgeRuns([aRun('100', { jobs: [snapJob('completed')] })]).cancel.length === 0);
  await t('a run no older than the calling one is untouched', () => judgeRuns([aRun('300', { createdAt: '2026-11-07T01:17:35Z' })]).cancel.length === 0);
  await t('two older unapproved proposals are both cancelled (each judged on its own)', () => judgeRuns([aRun('100'), aRun('101', { createdAt: '2026-11-04T01:17:35Z' })]).cancel.length === 2);
  // The live path, with a stubbed Actions API.
  const stubHttp = ({ waiting = [], scheduled = [], runs = {}, cancelStatus = 202, fail = null }) => {
    const seen = [];
    const http = async (method, path) => {
      seen.push({ method, path });
      if (fail && fail.test(path)) return { status: 502, body: 'bad gateway' };
      if (method === 'POST') return { status: cancelStatus, body: null };
      if (/\/runs\?status=waiting/.test(path)) return { status: 200, body: { total_count: waiting.length, workflow_runs: waiting.map((id) => ({ id })) } };
      if (/\/runs\?event=schedule/.test(path)) return { status: 200, body: { workflow_runs: scheduled.map((id) => ({ id })) } };
      const m = /\/actions\/runs\/(\d+)(\/jobs|\/pending_deployments)?/.exec(path);
      if (!m || !runs[m[1]]) return { status: 404, body: {} };
      const r = runs[m[1]];
      if (m[2] === '/jobs') return { status: 200, body: { jobs: r.jobs } };
      if (m[2] === '/pending_deployments') return { status: 200, body: r.environments.map((name) => ({ environment: { name } })) };
      return { status: 200, body: { id: Number(m[1]), event: r.event, status: r.status, created_at: r.createdAt } };
    };
    return { seen, http };
  };
  const liveEnv = { GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '200', GITHUB_TOKEN: 't' };
  const yesterday = { event: 'schedule', status: 'waiting', createdAt: YDAY, jobs: [snapJob('waiting')], environments: ['release'] };
  const today = { event: 'schedule', status: 'in_progress', createdAt: NOW, jobs: [], environments: [] };
  const quiet = () => {};
  const drive = (s, over = {}) => supersede({ workflow: 'release.yml', env: liveEnv, http: s.http, sleep: async () => {}, log: quiet, warn: quiet, ...over });
  await t('⭐ live: the waiting filter empty, the schedule listing names yesterday\'s run, which is read directly and cancelled with ONE POST, exit 0', async () => {
    const s = stubHttp({ scheduled: [200, 100], runs: { 100: yesterday, 200: today } });
    const exit = await drive(s);
    const posts = s.seen.filter((x) => x.method === 'POST');
    return exit === 0 && posts.length === 1 && posts[0].path === '/repos/o/r/actions/runs/100/cancel';
  });
  await t('live: --dry-run judges the same and sends no POST', async () => {
    const s = stubHttp({ waiting: [100], runs: { 100: yesterday, 200: today } });
    return (await drive(s, { dryRun: true })) === 0 && !s.seen.some((x) => x.method === 'POST');
  });
  await t('live: a 409 (finished first) is exit 0; any other cancel answer is exit 1', async () => {
    const a = stubHttp({ waiting: [100], runs: { 100: yesterday, 200: today }, cancelStatus: 409 });
    const b = stubHttp({ waiting: [100], runs: { 100: yesterday, 200: today }, cancelStatus: 500 });
    return (await drive(a)) === 0 && (await drive(b)) === 1;
  });
  await t('live: a listing still answering 5xx after the retries is deferred -- exit 0, nothing cancelled, a warning', async () => {
    const s = stubHttp({ waiting: [100], runs: { 100: yesterday, 200: today }, fail: /status=waiting/ });
    let warned = false;
    const exit = await drive(s, { warn: (m) => { warned = warned || /could not read/.test(m); } });
    return exit === 0 && warned && !s.seen.some((x) => x.method === 'POST');
  });

  battery('release-snapshot-publish.sh, run with a stubbed changeset: npm\'s answer record');
  {
    // The script, copied into a scratch root beside a symlink to the real
    // release-verify-npm.mjs (its imports resolve from the real file, so it
    // reads this repository's workspace). The scratch root holds a stub
    // `node_modules/.bin/changeset` -- the script puts that directory first on
    // PATH -- which records what npm would be handed and writes one npm debug
    // log for the anchor package into the logs dir; a stub dist-tooling scan
    // writes a log of its own wherever npm's logs dir points, so a record
    // started before the scan would hold it. `git` is stubbed to log any call.
    const { ANCHOR_PACKAGE, tarballName, npmRecordDir, resolveVerificationTargets } = await import('../release-verify-npm.mjs');
    const box = mkdtempSync(join(tmpdir(), 'snapshot-next-publish-sh-'));
    try {
      const root = join(box, 'root');
      const bin = join(box, 'bin');
      for (const d of [join(root, 'scripts'), join(root, 'ui/scripts'), join(root, 'node_modules/.bin'), bin]) mkdirSync(d, { recursive: true });
      copyFileSync(PUBLISH_SCRIPT, join(root, 'scripts/release-snapshot-publish.sh'));
      symlinkSync(resolve(HERE, '../release-verify-npm.mjs'), join(root, 'scripts/release-verify-npm.mjs'));
      const anchor = resolveVerificationTargets(listWorkspacePackages(REPO_ROOT)).find((x) => x.name === ANCHOR_PACKAGE);
      writeFileSync(join(root, 'ui/scripts/check-published-dist-tooling.mjs'), [
        "import { appendFileSync, writeFileSync } from 'node:fs';",
        "appendFileSync(process.env.STUB_LOG, `scan ${process.argv.slice(2).join(' ')}\\n`);",
        "if (process.env.npm_config_logs_dir) writeFileSync(`${process.env.npm_config_logs_dir}/scan-debug-0.log`, '0 verbose cli node npm\\n');",
        "process.exit(Number(process.env.STUB_SCAN_EXIT || 0));",
      ].join('\n'));
      writeFileSync(join(root, 'node_modules/.bin/changeset'), [
        '#!/bin/sh',
        'printf \'argv=%s\\nlogs_dir=%s\\nlogs_max=%s\\nglobalconfig=%s\\n\' "$*" "$npm_config_logs_dir" "$npm_config_logs_max" "${npm_config_globalconfig-unset}" > "$STUB_SEEN"',
        `printf '%s\\n' '0 verbose cli node npm' '8 verbose argv "publish" "--ignore-scripts" "${tarballName(anchor.name, anchor.version)}" "--json"' '17 http fetch PUT 200 https://registry.npmjs.org/@objectstack%2fcli 812ms' '26 verbose exit 0' > "$npm_config_logs_dir/2026-11-06T00_00_00_000Z-debug-0.log"`,
        'echo "changeset $*" >> "$STUB_LOG"',
        'exit "${STUB_CHANGESET_EXIT:-0}"',
      ].join('\n'));
      writeFileSync(join(bin, 'git'), '#!/bin/sh\necho "git $*" >> "$STUB_LOG"\n');
      chmodSync(join(root, 'node_modules/.bin/changeset'), 0o755);
      chmodSync(join(bin, 'git'), 0o755);
      const runScript = ({ changesetExit = 0, scanExit = 0 } = {}) => {
        const runnerTemp = mkdtempSync(join(box, 'runner-'));
        const recordDir = npmRecordDir({ RUNNER_TEMP: runnerTemp });
        mkdirSync(recordDir, { recursive: true });
        writeFileSync(join(recordDir, 'stale-debug-0.log'), 'a stale record from another run');
        const seen = join(runnerTemp, 'seen');
        const stubLog = join(runnerTemp, 'log');
        const env = { PATH: `${bin}:${process.env.PATH}`, HOME: box, RUNNER_TEMP: runnerTemp, STUB_SEEN: seen, STUB_LOG: stubLog, STUB_CHANGESET_EXIT: String(changesetExit), STUB_SCAN_EXIT: String(scanExit), npm_config_globalconfig: '/home/runner/.config/pnpm/rc' };
        const r = spawnSync('bash', [join(root, 'scripts/release-snapshot-publish.sh')], { cwd: root, env, encoding: 'utf8' });
        return {
          status: r.status,
          out: `${r.stdout}${r.stderr}`,
          seen: existsSync(seen) ? readFileSync(seen, 'utf8') : '',
          calls: existsSync(stubLog) ? readFileSync(stubLog, 'utf8').trim().split('\n') : [],
          record: existsSync(recordDir) ? readdirSync(recordDir) : [],
          recordDir,
        };
      };
      const good = runScript();
      await t('a clean publish exits 0, after the scan, with the ruling\'s command and no git call', () => good.status === 0 && good.calls.join(' ; ') === `scan --no-build ; changeset ${PUBLISH_COMMAND.replace(/^changeset /, '')}`);
      await t('npm is handed the record dir release-verify-npm.mjs names, its 10-file cap lifted, the inherited globalconfig dropped', () => good.seen.includes(`logs_dir=${good.recordDir}\n`) && good.seen.includes('logs_max=100000\n') && good.seen.includes('globalconfig=unset'));
      await t('the record is emptied first, and the scan\'s npm runs stay out of it: the publish\'s log is the only one', () => good.record.length === 1 && good.record[0].startsWith('2026-11-06'));
      await t('⭐ npm\'s answer for the package is printed, with the count line', () => good.out.includes(`${ANCHOR_PACKAGE}@${anchor.version} — npm ACCEPTED the upload: PUT 200 in 812 ms`) && /npm's answers: 1 of \d+ package\(s\) accepted/.test(good.out));
      const bad = runScript({ changesetExit: 7 });
      await t('a failed publish still prints npm\'s answers, then exits with the publish\'s own status', () => bad.status === 7 && bad.out.includes('npm\'s answer per package'));
      await t('and calls no git at all', () => !bad.calls.some((c) => c.startsWith('git')) && !good.calls.some((c) => c.startsWith('git')));
      const refused = runScript({ scanExit: 1 });
      await t('a red dist-tooling scan stops the script before the record and the publish', () => refused.status === 1 && !refused.calls.some((c) => c.startsWith('changeset')) && refused.record.join() === 'stale-debug-0.log');
    } finally {
      rmSync(box, { recursive: true, force: true });
    }
  }

  // The floor, before the verdict.
  const declaredNames = Object.keys(SELF_TEST_BATTERIES);
  if (declaredNames.length < SELF_TEST_BATTERY_FLOOR) failures.push(`SELF_TEST_BATTERIES declares ${declaredNames.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}`);
  for (const [name, count] of seen) if (!declaredNames.includes(name)) failures.push(`battery "${name}" registered ${count} case(s) but is not declared`);
  for (const name of declaredNames) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) failures.push(count === 0 ? `battery "${name}" DID NOT RUN -- 0 cases, ${SELF_TEST_BATTERIES[name]} pinned` : `battery "${name}" registered ${count} case(s), below its floor of ${SELF_TEST_BATTERIES[name]}`);
  }
  if (failures.length) {
    console.error(`snapshot-next self-test FAILED (${failures.length}):\n${failures.map((f) => `  - ${f}`).join('\n')}`);
    return 1;
  }
  const total = [...seen.values()].reduce((a, b) => a + b, 0);
  console.log(`snapshot-next: self-test OK -- ${total} case(s) across ${seen.size} batteries`);
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValue(argv, flag) {
  const at = argv.indexOf(flag);
  if (at === -1) return null;
  const value = argv[at + 1];
  return value && !value.startsWith('--') ? value : '';
}

function summary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    writeFileSync(file, `${lines.join('\n')}\n`, { flag: 'a' });
  } catch {
    // The summary is a convenience; the log carries every line.
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--self-test')) {
    const exit = await selfTest();
    if (exit === 0 && !selfTestReachedVerdict) {
      console.error('snapshot-next self-test: selfTest() returned 0 without reaching its verdict -- refusing to report a pass.');
      return 1;
    }
    return exit;
  }
  const mode = argv[0];
  if (mode === 'preflight') {
    let report;
    try {
      report = await preflight({ mainRef: argValue(argv, '--main-ref') ?? MAIN_REF });
    } catch (err) {
      console.error(`::error::snapshot preflight NOT MEASURED -- ${err.message}`);
      return EXIT_PREREQUISITE_NOT_MET;
    }
    const record = argValue(argv, '--record');
    if (record) writeFileSync(record, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`snapshot-next preflight: RC cycle read at the tree and at ${report.mainRef}; ${report.members} fixed-group member(s), ${report.refusals.length} refusal(s), ${report.unread.length} unread.`);
    for (const r of report.refusals) console.log(`::error::snapshot refused -- ${r}`);
    for (const u of report.unread) console.log(`::error::snapshot refused, NOT MEASURED -- npm could not be read for ${u}`);
    summary(['### `next` snapshot preflight', '', `- fixed-group members read on npm: \`${report.members}\``, `- refusals: \`${report.refusals.length}\`, unread: \`${report.unread.length}\``, ...report.refusals.map((r) => `  - ${r}`)]);
    if (report.unread.length && !report.refusals.length) return EXIT_PREREQUISITE_NOT_MET;
    return report.ok ? 0 : EXIT_FINDINGS;
  }
  if (mode === 'guard') {
    const packDir = argValue(argv, '--pack-dir');
    let report;
    try {
      report = await guard({ packDir: packDir ? resolve(packDir) : null });
    } catch (err) {
      console.error(`::error::snapshot guard NOT MEASURED -- ${err.message}`);
      return EXIT_PREREQUISITE_NOT_MET;
    }
    const out = argValue(argv, '--json-out');
    if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`snapshot-next guard: ${report.members} member(s) at ${report.version ?? 'no single version'} under \`${report.tag}\`; planned ${report.planned}, packed ${report.packed}, ${report.internalRanges} intra-group range(s) checked.`);
    for (const p of report.packages) console.log(`  ${p.name}@${p.version} -> ${p.tag}`);
    for (const p of report.problems) console.log(`::error::snapshot guard -- ${p}`);
    return report.ok ? 0 : EXIT_FINDINGS;
  }
  if (mode === 'verify') {
    const record = argValue(argv, '--record');
    const version = argValue(argv, '--version');
    if (!record || !version) {
      console.error('::error::verify needs --record FILE (the preflight record) and --version V');
      return EXIT_PREREQUISITE_NOT_MET;
    }
    const r = await verify({ recordFile: record, version });
    for (const n of r.notes) console.log(`::warning::${n}`);
    for (const i of r.incidents) console.log(`::error::INCIDENT -- ${i}. A snapshot must never move \`latest\`: report it to the maintainer; never repair it with a counter-publish.`);
    for (const p of r.pending) console.log(`::error::${p}`);
    if (r.incidents.length || r.pending.length) return EXIT_FINDINGS;
    console.log(`snapshot-next verify: every member's \`next\` is ${version}, and no \`latest\` moved to it.`);
    return 0;
  }
  if (mode === 'dry-run') {
    try {
      return await dryRun({ keep: argv.includes('--keep'), mainRef: argValue(argv, '--main-ref') ?? MAIN_REF });
    } catch (err) {
      console.error(`::error::snapshot dry run failed -- ${err.message}`);
      return EXIT_PREREQUISITE_NOT_MET;
    }
  }
  if (mode === 'supersede') {
    const workflow = argValue(argv, '--workflow');
    if (!workflow) {
      console.error('::error::supersede needs --workflow FILE (release.yml)');
      return EXIT_PREREQUISITE_NOT_MET;
    }
    try {
      return await supersede({ workflow, dryRun: argv.includes('--dry-run') });
    } catch (err) {
      console.error(`::error::snapshot supersede failed -- ${err.message}`);
      return 1;
    }
  }
  console.error(
    'usage: snapshot-next.mjs preflight [--main-ref REF] [--record FILE]\n' +
      '       snapshot-next.mjs guard [--pack-dir DIR] [--json-out FILE]\n' +
      '       snapshot-next.mjs verify --record FILE --version V\n' +
      '       snapshot-next.mjs dry-run [--main-ref REF] [--keep]\n' +
      '       snapshot-next.mjs supersede --workflow release.yml [--dry-run]\n' +
      '       snapshot-next.mjs --self-test',
  );
  return 1;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(await main());
}
