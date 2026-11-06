#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// snapshot-next -- the guard and the debut rule of release.yml's `next`
// snapshot lane (ADR-0125, amendment of 2026-11-05; ruling record 6663894403).
//
//   node scripts/ci/snapshot-next.mjs preflight [--record FILE]
//       before any deployment is queued, and again after the approval: refuses
//       while `.changeset/pre.json` says `mode: pre`, when the publishable set
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
//   node scripts/ci/snapshot-next.mjs dry-run [--keep]
//       the rehearsal: the registry reading of `preflight` (reported, not
//       stopped on), then the bare `changeset version --snapshot next`, then
//       `guard` with the pack, then the tree put back. Publishes nothing and
//       needs no npm token. Run locally or by the lane before the approval.
//       It refuses a dirty tree and owns the tree while it runs: the restore
//       puts every tracked path back to HEAD, so an edit made meanwhile is lost.
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
//      would fail after the click).
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
// ⛔ Nothing here publishes, tags, pushes or writes a dist-tag. `dry-run` runs the
// version step and `changeset pack` in the working tree and puts the tree back.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { EXIT_FINDINGS, EXIT_PREREQUISITE_NOT_MET } from '../import-prerequisite.mjs';
import { isEntrypoint } from '../invoked-as.mjs';
import { listWorkspacePackages } from '../release-github-releases.mjs';
import { PUBLISH_JOB_NAME } from '../release-pending-publish.mjs';

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
export const VERSION_COMMAND = 'changeset version --snapshot next';

// The version `changeset version --snapshot next` writes with this repository's
// `.changeset/config.json` (no `snapshot` block): `0.0.0-<tag>-<UTC datetime>`,
// the template-less default of @changesets/assemble-release-plan. `0.0.0` puts a
// snapshot below every stable version, which is what lets the stable lane's
// dist-tag step move `next` up to each new stable (ADR-0125 amendment, line 7).
export const SNAPSHOT_VERSION = /^0\.0\.0-next-\d{14}$/;

// The @changesets/cli major whose publish rule (point 1 of the header) was read.
export const CHANGESETS_CLI_MAJOR = 3;

// release.yml's names for this lane: the dispatch input and the two job ids.
export const SNAPSHOT_INPUT = 'snapshot_next';
export const PREFLIGHT_JOB = 'snapshot-next-preflight';
export const SNAPSHOT_JOB = 'snapshot-next';
// The stable lane's jobs that a snapshot dispatch must not start.
export const STABLE_JOBS = Object.freeze(['release-integrity', 'full-battery', 'publish', 'docker']);

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
export async function preflight({ root = REPO_ROOT, read = readRegistryState } = {}) {
  const refusals = [];
  const pre = preModeRefusal(readOptional(join(root, '.changeset/pre.json')));
  if (pre) refusals.push(pre);
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

async function dryRun({ root = REPO_ROOT, keep = false, read = readRegistryState } = {}) {
  console.log(`snapshot-next dry-run: nothing is published, tagged or pushed; no npm token is read.`);
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
  console.log(`tree: ${root} at ${head}`);
  const pre = await preflight({ root, read });
  console.log(`preflight: ${pre.members} fixed-group member(s) read on npm; ${pre.refusals.length} refusal(s), ${pre.unread.length} unread.`);
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
  if (publishLines.length !== 1 || publishLines[0].trim() !== PUBLISH_COMMAND) {
    findings.push(`the publish script must run exactly one publish, \`${PUBLISH_COMMAND}\` (found ${publishLines.length}: ${publishLines.map((l) => l.trim()).join(' | ') || 'none'})`);
  }
  for (const [re, what] of FORBIDDEN_IN_SNAPSHOT) {
    if (script.some((line) => re.test(line))) findings.push(`the publish script carries ${what}: the snapshot lane pushes no tag, cuts no Release, moves no dist-tag and builds no image`);
  }
  const at = (lines, re) => lines.findIndex((line) => re.test(line));
  const guardAt = at(snap, /node scripts\/ci\/snapshot-next\.mjs guard\b/);
  const publishAt = at(snap, /bash scripts\/release-snapshot-publish\.sh\b/);
  const versionAt = at(snap, /\bchangeset version --snapshot next\s*$/);
  if (versionAt === -1) findings.push(`\`${SNAPSHOT_JOB}\` never runs the bare \`${VERSION_COMMAND}\``);
  if (guardAt === -1 || publishAt === -1 || guardAt > publishAt || versionAt > guardAt) findings.push(`\`${SNAPSHOT_JOB}\` must run the version step, then \`snapshot-next.mjs guard\`, then the publish`);
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
  return findings;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the RC cycle: pre mode refuses, exit and absence pass, the unreadable refuses': 5,
  'the fixed group: one group, equal to the publishable set': 5,
  'the debut rule: never published or no latest refuses': 4,
  'the versions: one 0.0.0-next snapshot of the whole group': 5,
  'the tag overrides: publishConfig, .npmrc and the environment': 6,
  'the plan: exactly the group at the snapshot, no git tag': 5,
  'the packed manifests: no workspace range, every intra-group range satisfied': 7,
  'the registry read: 404 is never published, anything unread is never guessed': 5,
  'verify: next names the snapshot, latest never moves to it': 4,
  'release.yml: the snapshot wiring': 15,
  'release.yml: exclusivity, evaluated job by job': 7,
});
const SELF_TEST_BATTERY_FLOOR = 11;

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
  const PUBLISH_LINE = /\nchangeset publish --tag next --no-git-tag\n/;
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
  await t('a publish with another tag is refused', () => firesSh(sh.replace(PUBLISH_LINE, '\nchangeset publish --tag latest --no-git-tag\n'), 'exactly one publish'));
  await t('a publish that keeps git tags is refused', () => firesSh(sh.replace(PUBLISH_LINE, '\nchangeset publish --tag next\n'), 'exactly one publish'));
  await t('a git push in the publish script, or in the job, is refused', () => firesSh(sh.replace(PUBLISH_LINE, `\n${PUBLISH_COMMAND}\ngit push origin --tags\n`), 'git push') && fires(yml.replace(`          ${PUBLISH_SCRIPT_CALL}\n`, `          ${PUBLISH_SCRIPT_CALL}\n          git push origin --tags\n`), 'git push'));
  await t('a publish run inline in the job is refused', () => fires(yml.replace(`          ${PUBLISH_SCRIPT_CALL}\n`, `          ${PUBLISH_SCRIPT_CALL}\n          changeset publish --tag next --no-git-tag\n`), 'runs `changeset publish` itself'));
  await t('a guard after the publish is refused', () => fires(yml.replace(/node scripts\/ci\/snapshot-next\.mjs guard\b/, 'node scripts/ci/snapshot-next.mjs gaurd'), 'then the publish'));
  await t('a preflight without the distance-zero gate is refused', () => fires(yml.replace(/(--release-commit "\$commit") --require-distance-zero/, '$1'), '--require-distance-zero'));
  await t('a snapshot job reading inputs.force is refused', () => fires(yml.replace(/(\n {2}snapshot-next:[\s\S]*?\n {4}if: >-\n[^\n]*\n)/, '$1      !inputs.force &&\n'), 'inputs.force'));
  await t('pnpm run version in the lane is refused', () => fires(yml.replace(/changeset version --snapshot next\s*\n/, 'changeset version --snapshot next\n          pnpm run version\n'), 'pnpm run version'));

  battery('release.yml: exclusivity, evaluated job by job');
  // fleet-write's evaluator reads every job's `if:` the way GitHub does; imported
  // here only, so the lane's own path loads none of it.
  const { jobsStartedBy, declaredDispatchInputs, dispatchRunInputs } = await import('../pm/fleet-write/validate.mjs');
  const declared = declaredDispatchInputs(yml);
  const started = (text, event, sent) => jobsStartedBy(text, { event, inputs: dispatchRunInputs(declaredDispatchInputs(text), sent) });
  const touchesSnapshot = (r) => [...r.runs, ...r.mayRun].filter((j) => j === PREFLIGHT_JOB || j === SNAPSHOT_JOB);
  await t('the input is declared, boolean, default false', () => declared?.[SNAPSHOT_INPUT]?.type === 'boolean' && declared[SNAPSHOT_INPUT].default === 'false');
  await t('push and schedule never reach the snapshot jobs', () => touchesSnapshot(started(yml, 'push', {})).length === 0 && touchesSnapshot(started(yml, 'schedule', {})).length === 0);
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
      report = await preflight();
    } catch (err) {
      console.error(`::error::snapshot preflight NOT MEASURED -- ${err.message}`);
      return EXIT_PREREQUISITE_NOT_MET;
    }
    const record = argValue(argv, '--record');
    if (record) writeFileSync(record, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`snapshot-next preflight: ${report.members} fixed-group member(s), ${report.refusals.length} refusal(s), ${report.unread.length} unread.`);
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
      return await dryRun({ keep: argv.includes('--keep') });
    } catch (err) {
      console.error(`::error::snapshot dry run failed -- ${err.message}`);
      return EXIT_PREREQUISITE_NOT_MET;
    }
  }
  console.error(
    'usage: snapshot-next.mjs preflight [--record FILE]\n' +
      '       snapshot-next.mjs guard [--pack-dir DIR] [--json-out FILE]\n' +
      '       snapshot-next.mjs verify --record FILE --version V\n' +
      '       snapshot-next.mjs dry-run [--keep]\n' +
      '       snapshot-next.mjs --self-test',
  );
  return 1;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(await main());
}
