#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * spec-shape-gate -- compile the downstream consumer (objectui at `main`)
 * against `@objectstack/spec` built from THIS commit, name the objectui file
 * and the objectstack commit when it does not compile, tell a REGISTERED
 * retirement apart from a new break, and attribute a new break to the
 * objectstack commit range since the last green run and the lane that owns it.
 *
 *   node scripts/ci/spec-shape-gate.mjs inject --tarball <f.tgz> --sha <sha> --upstream-checkout <dir> --downstream <dir>
 *   node scripts/ci/spec-shape-gate.mjs report --log <f> --sha <sha> --status <n> --downstream <dir> [--downstream-sha <sha>] [--event <name>] [--registry <file>]
 *   node scripts/ci/spec-shape-gate.mjs --self-test      # offline, no install, no network
 *
 * Exit: 0 = the step did what it says -- in `report`, a green compile, or a
 *           compile whose every diagnostic is a REGISTERED retirement (`known`)
 *       1 = the compile failed with at least one diagnostic no registration
 *           covers -- a NEW shape break, attributed below
 *       2 = the step COULD NOT BE PERFORMED (nothing to inject, a staged
 *           package that is not the spec, a failure no diagnostic names a file
 *           for, a registry this reader refuses). ⛔ Never a pass. A gate that
 *           cannot take its reading says so.
 *
 * ## The ruling this executes
 *
 * Ruling B on the decision card for the spec shape gate (comment 6145029395,
 * batch 336 item 3, 2026-10-13): the gate MOVES to objectstack -- hourly on
 * `main` with the two-speed full battery, read by the release gate, a red
 * attributed to the lane that moved the shape; objectui drops its copy once two
 * consecutive hourly runs here agree with objectui's. The MECHANISM of ruling C
 * on #19011 is kept unchanged: consumer compilation is the ONE shape gate for
 * the spec's public surface; what moved is where it runs and who owns a red.
 * objectui deleted its copy in objectstack-ai/objectui PR #12596 (card
 * objectstack-ai/objectui#12352), so this gate is the only one.
 *
 * This file is the objectstack port of objectui's `scripts/spec-main-shape-gate.mjs`,
 * which that PR deleted. Its header carries the measurements behind the
 * virtual-store injection, the hardlink trap, the dependency re-pointing and
 * the turbo-cache false green; they are not restated here, and the mechanism is
 * unchanged. Read them at objectui commit `7d0c174ba8383d08b8dd1d4f7d7845009f1bf2fd`,
 * the first parent of that PR's merge commit `c6a42be392` and the last objectui
 * `main` commit that has the file (`git show <commit>:scripts/spec-main-shape-gate.mjs`
 * in an objectui clone). Three things are different, each because the
 * direction reversed:
 *
 *   1. THE SUBJECT IS THIS COMMIT. objectui built the spec from objectstack
 *      `main` and compiled itself; here the spec is built and packed from the
 *      objectstack checkout the workflow runs in, and the CLONE is the
 *      downstream. There is no artifact reuse: the spec is always built from
 *      the tree under test, which is the one thing this gate must never
 *      substitute.
 *   2. A RETIREMENT IS REGISTERED, NOT RED. An intentional retirement (a key or
 *      value the spec withdrew under enforce-or-remove) breaks the downstream
 *      until its consumer card lands; before this card that red stood for
 *      days and hid the next accidental break behind it. The accepting seat
 *      registers the retirement in `scripts/ci/spec-shape-retirements.json`
 *      when it files the downstream card (cross-repo rule 3), and `report`
 *      then reads the matching diagnostics as `known (registered: <card>)` and
 *      does not red. An UNREGISTERED break stays red. See THE REGISTRY below.
 *   3. A RED IS ATTRIBUTED. `report` names the objectstack commits since this
 *      workflow's last green run on `main`, the pull request each landed in,
 *      and the `domain:*` lane of the card that pull request fixes -- the lane
 *      whose first work the red is under the two-speed rule 3 of #22998. A
 *      lane it cannot read is written `unattributed`, never guessed.
 *
 * ⭐ WHAT A RED MUST SAY is still the acceptance criterion: which objectui file
 * fails against which objectstack commit. A red saying only "typecheck failed"
 * does not satisfy the ruling, and a failure no diagnostic attributes to a file
 * is exit 2, never a shape break and never a pass.
 *
 * ## THE REGISTRY -- `scripts/ci/spec-shape-retirements.json`
 *
 * One entry per retirement, written by the accepting seat when the downstream
 * card is filed, deleted when that card closes (objectui caught up):
 *
 *   {
 *     "retirements": [
 *       {
 *         "retired": "view-level data source provider 'api'",
 *         "objectstack_pr": 23160,
 *         "objectstack_commit": "1912af47ba6e3b250f7c717fea0d56e181029b9c",
 *         "downstream_card": "objectstack-ai/objectui#N",
 *         "registered_at": "2026-10-13",
 *         "matches": [
 *           { "file": "packages/react/src/hooks/useViewData.ts", "code": "TS2367", "message": "'\"api\"'" }
 *         ]
 *       }
 *     ]
 *   }
 *
 * A diagnostic is `known` when SOME entry has SOME pattern whose every declared
 * field holds: `file` equals the diagnostic's repo-relative objectui path (or
 * is a glob over it: `*` within a segment, `**` across segments), `code` equals
 * its TS code, `message` is a substring of its message. Every pattern MUST
 * name a `file` AND at least one of `code` / `message`: a file alone would
 * register "anything in this file", which is the ignore-all switch this
 * registry must never become, and no pattern may be empty. Every entry MUST
 * carry all six keys above and nothing else; an entry this reader cannot read
 * is exit 2 for the whole run -- a registry that cannot be read is not an
 * empty one, and compiling on without it would report a registered retirement
 * as a new break or, worse, read a malformed ignore as nothing to ignore.
 *
 * An entry that matched NOTHING in a run is listed in the summary as such: it
 * is either a retirement objectui has already caught up with (prune the entry
 * when its card closes) or a registration whose pattern never matched (fix it
 * on the registration's own pull request, which this workflow runs on).
 *
 * ## THE ATTRIBUTION -- commit range and lane
 *
 * On a `schedule`, `workflow_dispatch` or `push` run of this workflow on `main`
 * (`ATTRIBUTED_EVENTS`), a red reads this workflow's own completed runs on
 * `main`, picks the newest `success` whose head is not this run's, and asks the
 * compare API for the commits between that head and this one. For each commit
 * it reads the pull request its title names (`(#N)`, the squash suffix), that
 * pull's own `domain:*` labels, the cards its body closes (`Fixes #M` and the
 * other closing keywords), and those cards' `domain:*` labels. The union is the
 * commit's lane set; an empty union is `unattributed`.
 *
 * Failure modes, each printed in the summary rather than guessed around: no
 * previous green run of this workflow on `main` (the first runs, or a red
 * standing since the first run) -- no range can be named, and the summary says
 * so and says why; a compare the API truncates (it stops at 250 commits) -- the
 * range is marked truncated; a pull or a card the token cannot read -- that
 * commit is `unattributed` with the HTTP status beside it. ⛔ None of these
 * moves the verdict: the verdict is the compile, the attribution is the
 * address a red is delivered to. A `pull_request` run has no range to name --
 * its subject is one merge commit -- and says so.
 *
 * The lookups are capped (`ATTRIBUTION_MAX_COMMITS`) because a red that stands
 * for a day makes the range a day long; the cap is printed when reached.
 *
 * ## The marker name is objectui's, on purpose
 *
 * `inject` writes `MARKER_FILE` into every replaced copy, and objectui's
 * `turbo.json` names that exact file in `globalDependencies` so an injected
 * tree never shares a turbo hash with an installed one. The spelling therefore
 * stays objectui's (`.spec-main-shape-gate.json`) for as long as objectui's
 * turbo config names it; the workflow bypasses the cache with `TURBO_FORCE`
 * regardless, so the marker is belt to that brace, not a dependency.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { isEntrypoint } from '../invoked-as.mjs';

export const SPEC_PACKAGE_NAME = '@objectstack/spec';

/** The repository whose commit is under test; the one this file lives in. */
export const UPSTREAM_REPO = 'objectstack-ai/objectstack';

/** The downstream consumer the workflow clones at `main`. */
export const DOWNSTREAM_REPO = 'objectstack-ai/objectui';

/** The workflow that runs this gate, as a quoted repo-relative literal: a card touching it schedules this family. */
export const WORKFLOW_FILE = '.github/workflows/spec-shape-gate.yml';

/** The registry of intentional retirements, likewise a quoted literal. */
export const REGISTRY_FILE = 'scripts/ci/spec-shape-retirements.json';

/** The marker `inject` leaves inside every replaced copy (see the header for why the name is objectui's). */
export const MARKER_FILE = '.spec-main-shape-gate.json';

/** The events on `main` whose red is attributed to a commit range. */
export const ATTRIBUTED_EVENTS = Object.freeze(['schedule', 'workflow_dispatch', 'push']);

/** The cap on commits the attribution reads pull requests for. */
export const ATTRIBUTION_MAX_COMMITS = 40;

/** GitHub records at most this many error annotations per step; the summary carries the rest. */
export const ANNOTATION_CAP = 10;

/* ── failure ─────────────────────────────────────────────────────────────── */

function fail(message) {
  process.stderr.write(`spec-shape-gate: ${message}\n`);
  process.exit(2);
}

/* ── the downstream workspace, read from the file pnpm reads ─────────────── */

/**
 * The `packages:` globs of a `pnpm-workspace.yaml`, read narrowly: `- 'dir/*'`
 * and `- 'dir'` entries only. Anything else -- a negation, a `**`, a glob inside
 * a segment -- THROWS, because an importer the reader silently drops is one
 * whose copy is never re-pointed, whose consumer link is never verified, and
 * whose diagnostics are never attributed to a directory.
 */
export function parseWorkspaceGlobs(text) {
  const globs = [];
  let inPackages = false;
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/\s+$/, '');
    if (line.length === 0 || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) {
      inPackages = /^packages:\s*$/.test(line);
      continue;
    }
    if (!inPackages) continue;
    const entry = /^\s+-\s+(['"]?)([^'"]+)\1$/.exec(line);
    if (!entry || !/^[\w.@-]+(?:\/[\w.@-]+)*(?:\/\*)?$/.test(entry[2])) {
      throw new Error(`pnpm-workspace.yaml line "${raw.trim()}" is not a \`- 'dir'\` or \`- 'dir/*'\` entry`);
    }
    globs.push(entry[2]);
  }
  if (globs.length === 0) throw new Error('pnpm-workspace.yaml declares no `packages:` entries');
  return globs;
}

/** The root and every workspace directory the downstream's `pnpm-workspace.yaml` names that holds a manifest. */
export function workspaceImporterDirs(repoRoot) {
  const globs = parseWorkspaceGlobs(fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'));
  const dirs = new Set(['.']);
  for (const glob of globs) {
    if (glob.endsWith('/*')) {
      const parent = glob.slice(0, -2);
      const parentDir = path.join(repoRoot, parent);
      if (!fs.existsSync(parentDir)) continue;
      for (const child of fs.readdirSync(parentDir)) dirs.add(path.posix.join(parent, child));
    } else {
      dirs.add(glob);
    }
  }
  return [...dirs].filter((dir) => fs.existsSync(path.join(repoRoot, dir, 'package.json'))).sort();
}

function importerDirsOrFail(repoRoot) {
  try {
    return workspaceImporterDirs(repoRoot);
  } catch (error) {
    return fail(
      `cannot enumerate the downstream's workspace importers under ${repoRoot}: ${error.message}. Refused ` +
        `rather than guessed -- an importer left out keeps its own copy of a re-pointed dependency, and ` +
        `the compile reads two copies without a word.`,
    );
  }
}

/**
 * Map a turbo package name to its directory, by reading the workspace
 * manifests. Derived, never tabulated: a hand-kept table is one package rename
 * away from attributing a failure to the wrong file, which is worse than not
 * attributing it at all.
 */
export function workspaceDirsByName(repoRoot) {
  const byName = new Map([['//', '.']]);
  for (const dir of workspaceImporterDirs(repoRoot)) {
    if (dir === '.') continue;
    try {
      const { name } = JSON.parse(fs.readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8'));
      if (name) byName.set(name, dir);
    } catch {
      // A manifest that does not parse is not this gate's subject; the file it
      // would have named simply stays unmapped and is reported unmapped.
    }
  }
  return byName;
}

/* ── the installed spec, and who links to it ─────────────────────────────── */

/**
 * The virtual-store directories holding an installed `@objectstack/spec`.
 * Enumerated by PREFIX: pnpm encodes the peer resolution into the name
 * (`@objectstack+spec@17.4.0_ai@...._zod@....`) and one install can hold more
 * than one, so a computed name would move the consumers whose peer set
 * happened to match a guess and leave the rest on the published spec.
 */
export function findInstalledSpecDirs(repoRoot) {
  const virtualStore = path.join(repoRoot, 'node_modules', '.pnpm');
  if (!fs.existsSync(virtualStore)) return [];
  return fs
    .readdirSync(virtualStore)
    .filter((entry) => entry.startsWith('@objectstack+spec@'))
    .map((entry) => path.join(virtualStore, entry, 'node_modules', ...SPEC_PACKAGE_NAME.split('/')))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
    .sort();
}

/**
 * Every workspace importer whose own `node_modules` links to the spec, with
 * the directory that link resolves to. This is the VERIFICATION population,
 * taken from the consumers rather than from the injection: "every consumer
 * that can see the spec now sees the injected one" is the property the
 * typecheck depends on.
 */
export function findSpecConsumers(repoRoot) {
  const consumers = [];
  for (const dir of importerDirsOrFail(repoRoot)) {
    const link = path.join(repoRoot, dir, 'node_modules', ...SPEC_PACKAGE_NAME.split('/'));
    if (!fs.existsSync(link)) continue;
    consumers.push({ workspace: dir, resolved: fs.realpathSync(link) });
  }
  return consumers.sort((a, b) => a.workspace.localeCompare(b.workspace));
}

/**
 * Every file an `exports` map names under a `types` condition. `tsc` reads
 * exactly these, so they must exist in the staged package for a typecheck
 * against it to mean anything: a spec built with declarations skipped still
 * packs and still installs, and fails every consumer with TS2307.
 */
export function declaredTypesTargets(exportsMap) {
  const targets = new Set();
  const walk = (node) => {
    if (typeof node === 'string') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [condition, value] of Object.entries(node)) {
      if (condition === 'types' && typeof value === 'string') targets.add(value);
      else walk(value);
    }
  };
  walk(exportsMap ?? {});
  return [...targets].sort();
}

function extractTarball(tarball, intoDir) {
  fs.mkdirSync(intoDir, { recursive: true });
  execFileSync('tar', ['-xzf', path.resolve(tarball), '-C', intoDir], { stdio: 'pipe' });
  const staged = path.join(intoDir, 'package');
  if (!fs.existsSync(staged)) {
    fail(
      `the tarball ${tarball} did not extract a \`package/\` directory. npm and pnpm both pack into one; ` +
        `a tarball shaped otherwise is not a packed npm package.`,
    );
  }
  return staged;
}

/* ── dependency ranges, deliberately narrow ──────────────────────────────── */

function parseRelease(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!match) throw new Error(`"${version}" is not a plain X.Y.Z release, and this gate orders nothing else`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareReleases(left, right) {
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

const RANGE_COMPARATOR = /^(\^|~|>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/;

function comparatorHolds(version, operator, bound) {
  const order = compareReleases(version, bound);
  if (operator === '=') return order === 0;
  if (operator === '>') return order > 0;
  if (operator === '>=') return order >= 0;
  if (operator === '<') return order < 0;
  if (operator === '<=') return order <= 0;
  const ceiling =
    operator === '~'
      ? [bound[0], bound[1] + 1, 0]
      : bound[0] > 0
        ? [bound[0] + 1, 0, 0]
        : bound[1] > 0
          ? [0, bound[1] + 1, 0]
          : [0, 0, bound[2] + 1];
  return order >= 0 && compareReleases(version, ceiling) < 0;
}

/**
 * Does the plain release `version` satisfy the dependency range `range`?
 * Reads `X.Y.Z`, `=`, `^`, `~`, `>`, `>=`, `<`, `<=` on full bounds,
 * space-separated comparator sets and `||` unions. Everything else THROWS,
 * and the caller turns that into exit 2 naming the dependency: an unreadable
 * range read as satisfied would leave this gate compiling against the wrong
 * dependency without a word. Not the `semver` package, on purpose: it is not
 * a dependency of this repository's root, and a hoisted transitive copy is a
 * phantom dependency.
 */
export function satisfiesRange(version, range) {
  const release = parseRelease(version);
  const text = String(range ?? '').trim();
  if (text.length === 0) throw new Error('an empty range names nothing this gate can judge');
  const alternatives = text.split('||').map((alternative) => {
    const comparators = alternative.trim().split(/\s+/).filter(Boolean);
    if (comparators.length === 0) throw new Error(`range "${text}" has an empty alternative`);
    return comparators.map((comparator) => {
      const match = RANGE_COMPARATOR.exec(comparator);
      if (!match) throw new Error(`range "${text}" contains "${comparator}", which this gate does not read`);
      return { operator: match[1] ?? '=', bound: parseRelease(match[2]) };
    });
  });
  return alternatives.some((comparators) =>
    comparators.every(({ operator, bound }) => comparatorHolds(release, operator, bound)),
  );
}

/* ── the spec's declared dependencies, re-pointed where the store's do not satisfy them ── */

function installedPackageAt(dir) {
  if (!fs.existsSync(path.join(dir, 'package.json'))) return null;
  const realpath = fs.realpathSync(dir);
  const { name, version } = JSON.parse(fs.readFileSync(path.join(realpath, 'package.json'), 'utf8'));
  return { name, version, realpath };
}

function storeSiblingPath(target, name) {
  const entryModules = path.resolve(target, ...SPEC_PACKAGE_NAME.split('/').map(() => '..'));
  return path.join(entryModules, ...name.split('/'));
}

function storeEntryName(target) {
  return path.basename(path.resolve(target, ...SPEC_PACKAGE_NAME.split('/').map(() => '..'), '..'));
}

function judged(name, range, version, whose) {
  try {
    return satisfiesRange(version, range);
  } catch (error) {
    return fail(
      `cannot judge ${whose} \`${name}@${version}\` against the injected ${SPEC_PACKAGE_NAME}'s declared ` +
        `\`${name}: ${range}\`: ${error.message}. Refused rather than guessed -- a range read wrongly here ` +
        `decides which dependency the whole compile runs against.`,
    );
  }
}

function planDependencySubstitutions({ dependencies, targets, upstreamCheckout }) {
  const plan = [];
  for (const [name, range] of Object.entries(dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    for (const target of targets) {
      const sibling = storeSiblingPath(target, name);
      const held = installedPackageAt(sibling);
      if (held && judged(name, range, held.version, 'the store sibling')) continue;

      const upstreamDir = path.join(upstreamCheckout, 'packages', 'spec', 'node_modules', ...name.split('/'));
      const upstream = installedPackageAt(upstreamDir);
      const heldText = held ? `\`${name}@${held.version}\`` : 'no copy at all';
      if (!upstream || upstream.name !== name || !judged(name, range, upstream.version, 'the objectstack checkout')) {
        fail(
          `the injected ${SPEC_PACKAGE_NAME} declares \`${name}: ${range}\`. The store entry ${storeEntryName(target)} ` +
            `holds ${heldText}, which does not satisfy it, and the objectstack checkout has ` +
            (upstream ? `\`${upstream.name}@${upstream.version}\`` : 'no copy') +
            ` at ${upstreamDir}. No copy satisfying the range is available, so nothing was injected: a compile now ` +
            `would read the spec's declarations against a dependency they were not built against, and report this ` +
            `gate's own injection as a shape break.`,
        );
      }
      let linkedFrom = null;
      try {
        linkedFrom = fs.readlinkSync(sibling);
      } catch {
        // Absent, or a directory rather than a link: nothing to print as its target.
      }
      plan.push({ name, range, target, sibling, held, linkedFrom, upstream });
    }
  }
  return plan;
}

/** REMOVE, then link. ⛔ Never write into what is there: the files are hardlinks into the global store. */
function relinkSibling({ sibling, upstream }) {
  const stat = fs.lstatSync(sibling, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink()) fs.unlinkSync(sibling);
  else if (stat) fs.rmSync(sibling, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(sibling), { recursive: true });
  fs.symlinkSync(upstream.realpath, sibling, 'dir');
}

function describeSubstitution({ name, range, target, held, linkedFrom, upstream }) {
  const entry = storeEntryName(target);
  const was = held ? `${name}@${held.version} (-> ${linkedFrom ?? held.realpath})` : 'absent';
  return (
    `substituted ${name} for ${SPEC_PACKAGE_NAME} in ${entry}: declared ${range}, the store held ${was}, which does ` +
    `not satisfy it; now -> ${upstream.realpath} (${name}@${upstream.version}, the copy the objectstack checkout's ` +
    `spec build resolved)`
  );
}

const IMPORTER_DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function importerAdmits(name, range, version, importer) {
  try {
    return satisfiesRange(version, range);
  } catch (error) {
    return fail(
      `cannot judge whether downstream importer ${importer}'s declared \`${name}: ${range}\` admits ${name}@${version}, ` +
        `the copy the injected ${SPEC_PACKAGE_NAME} was re-pointed to: ${error.message}. Refused rather than ` +
        `guessed -- the answer decides whether this compile reads one copy or two.`,
    );
  }
}

function planImporterRepoints({ repoRoot, plan }) {
  const repointed = new Map();
  for (const step of plan) repointed.set(step.name, step.upstream);
  if (repointed.size === 0) return { relink: [], twoCopies: [], importers: new Map() };

  const relink = [];
  const twoCopies = [];
  const importers = new Map();
  const dirs = importerDirsOrFail(repoRoot);
  for (const [name, upstream] of [...repointed].sort(([a], [b]) => a.localeCompare(b))) {
    const declaring = [];
    for (const dir of dirs) {
      const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8'));
      const ranges = [
        ...new Set(
          IMPORTER_DEPENDENCY_FIELDS.map((field) => manifest[field]?.[name]).filter((range) => typeof range === 'string'),
        ),
      ];
      if (ranges.length === 0) continue;
      const refusing = ranges.filter((range) => !importerAdmits(name, range, upstream.version, dir));
      const link = path.join(repoRoot, dir, 'node_modules', ...name.split('/'));
      let linkedFrom = null;
      try {
        linkedFrom = fs.readlinkSync(link);
      } catch {
        // Absent, or a directory rather than a link: nothing to print as its target.
      }
      const entry = { name, importer: dir, ranges, refusing, link, linkedFrom, held: installedPackageAt(link), upstream };
      declaring.push(entry);
      (refusing.length === 0 ? relink : twoCopies).push(entry);
    }
    importers.set(name, declaring);
  }
  return { relink, twoCopies, importers };
}

function describeImporterRepoint({ name, importer, ranges, held, linkedFrom, upstream }) {
  const was = held ? `${name}@${held.version} (-> ${linkedFrom ?? held.realpath})` : 'absent';
  return (
    `re-pointed ${name} for downstream importer ${importer}: declares ${ranges.join(' and ')}, which admits ` +
    `${upstream.version}; was ${was}, now -> ${upstream.realpath} (${name}@${upstream.version}, the copy the spec ` +
    `substitution linked)`
  );
}

function describeTwoCopies({ name, importer, refusing, upstream }) {
  return `two copies of ${name} stay: ${importer} declares ${refusing.join(' and ')}, which does not admit ${upstream.version}`;
}

function resolvedDependency(fromDir, name) {
  const lookup = createRequire(path.join(fromDir, 'package.json')).resolve.paths(name) ?? [];
  for (const modulesDir of lookup) {
    const found = installedPackageAt(path.join(modulesDir, ...name.split('/')));
    if (found) return found;
  }
  return null;
}

/* ── inject ──────────────────────────────────────────────────────────────── */

/**
 * Replace every installed copy of the spec in the DOWNSTREAM's virtual store
 * with the staged one, re-point its store siblings at the dependencies it was
 * built against where the installed ones do not satisfy its manifest, and PROVE
 * both took by asking the consumers. `upstreamCheckout` is the objectstack
 * checkout the tarball was built and packed in: the spec build's own dependency
 * resolution lives under its `packages/spec/node_modules`.
 */
export function inject({ tarball, sha, upstreamCheckout, downstream, log = () => {} }) {
  const repoRoot = downstream;
  if (!repoRoot || !fs.existsSync(path.join(repoRoot, 'pnpm-workspace.yaml'))) {
    fail(
      `--downstream must be the ${DOWNSTREAM_REPO} checkout to inject into, and ${repoRoot ?? '(none given)'} ` +
        `holds no pnpm-workspace.yaml. Without it there is no install to replace and no consumer to verify.`,
    );
  }
  const upstreamSpecManifest = upstreamCheckout ? path.join(upstreamCheckout, 'packages', 'spec', 'package.json') : null;
  let upstreamSpecName = null;
  try {
    upstreamSpecName = JSON.parse(fs.readFileSync(upstreamSpecManifest, 'utf8')).name;
  } catch {
    // Reported below with the path that was tried.
  }
  if (upstreamSpecName !== SPEC_PACKAGE_NAME) {
    fail(
      `--upstream-checkout must be the objectstack checkout the spec was built in, and ` +
        `${upstreamSpecManifest ?? '(none given)'} is not \`${SPEC_PACKAGE_NAME}\`'s manifest. Without it there is ` +
        `no source for the dependencies the spec's declarations were emitted against.`,
    );
  }

  const targets = findInstalledSpecDirs(repoRoot);
  if (targets.length === 0) {
    fail(
      `no installed \`${SPEC_PACKAGE_NAME}\` found under ${path.join(repoRoot, 'node_modules/.pnpm')}. Nothing was ` +
        `injected, so a typecheck run after this point would compile against whatever is installed and report a ` +
        `verdict about the PUBLISHED spec under this gate's name. Run \`pnpm install --frozen-lockfile\` in the ` +
        `downstream first, or fix the store layout this reader assumes.`,
    );
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-shape-gate-'));
  const staged = extractTarball(tarball, staging);

  const manifest = JSON.parse(fs.readFileSync(path.join(staged, 'package.json'), 'utf8'));
  if (manifest.name !== SPEC_PACKAGE_NAME) {
    fail(
      `the staged package is \`${manifest.name}\`, not \`${SPEC_PACKAGE_NAME}\`. Refusing to write it over the ` +
        `installed spec -- a mis-aimed tarball would produce a typecheck whose subject is not the one this gate reports on.`,
    );
  }

  const missingTypes = declaredTypesTargets(manifest.exports).filter((target) => !fs.existsSync(path.join(staged, target)));
  if (missingTypes.length > 0) {
    fail(
      `the staged \`${SPEC_PACKAGE_NAME}\` declares ${missingTypes.length} \`types\` target(s) its tarball does not contain:\n` +
        missingTypes.map((t) => `  - ${t}`).join('\n') +
        `\n\nThis is what a spec built with its declaration pass skipped looks like. Injecting it would fail every ` +
        `consumer with TS2307 and this gate would report that as a shape break at ${sha}. Build the spec with ` +
        `declarations and pack it again.`,
    );
  }

  const plan = planDependencySubstitutions({ dependencies: manifest.dependencies, targets, upstreamCheckout });
  const importerPlan = planImporterRepoints({ repoRoot, plan });

  for (const target of targets) {
    // REMOVE, then copy. ⛔ Never copy over: the files below are hardlinks into
    // pnpm's global store, and writing through one corrupts the store for every
    // other checkout on this machine.
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(staged, target, { recursive: true, dereference: true });
    fs.writeFileSync(
      path.join(target, MARKER_FILE),
      `${JSON.stringify({ upstream: UPSTREAM_REPO, sha, version: manifest.version, injectedAt: new Date().toISOString() }, null, 2)}\n`,
    );
  }
  fs.rmSync(staging, { recursive: true, force: true });

  const substitutions = plan.map((step) => {
    relinkSibling(step);
    return describeSubstitution(step);
  });
  for (const entry of importerPlan.relink) {
    relinkSibling({ sibling: entry.link, upstream: entry.upstream });
    substitutions.push(describeImporterRepoint(entry));
  }
  for (const entry of importerPlan.twoCopies) substitutions.push(describeTwoCopies(entry));

  const consumers = findSpecConsumers(repoRoot);
  if (consumers.length === 0) {
    fail(
      `the injection wrote ${targets.length} director(ies), and then no workspace package was found linking to ` +
        `\`${SPEC_PACKAGE_NAME}\`. A reading of zero consumers is a broken reader or an install that never happened ` +
        `-- not evidence that the injection reached everyone.`,
    );
  }
  const stranded = consumers.filter((consumer) => !fs.existsSync(path.join(consumer.resolved, MARKER_FILE)));
  if (stranded.length > 0) {
    fail(
      `these ${stranded.length} consumer(s) still resolve \`${SPEC_PACKAGE_NAME}\` to a copy this run did not inject:\n` +
        stranded.map((c) => `  - ${c.workspace} -> ${c.resolved}`).join('\n') +
        `\n\nA typecheck now would mix the built-from-source spec with the published one, and the green half would be ` +
        `indistinguishable from a real pass.`,
    );
  }

  const resolutions = [];
  for (const consumer of consumers) {
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      const found = resolvedDependency(consumer.resolved, name);
      resolutions.push({
        workspace: consumer.workspace,
        name,
        range,
        version: found?.version ?? null,
        resolved: found?.realpath ?? null,
        satisfied: found !== null && judged(name, range, found.version, 'the resolved'),
      });
    }
  }
  const unsatisfied = resolutions.filter((resolution) => !resolution.satisfied);
  if (unsatisfied.length > 0) {
    fail(
      `the injected \`${SPEC_PACKAGE_NAME}\` resolves ${unsatisfied.length} declared dependency reading(s) outside the ` +
        `range its manifest declares:\n` +
        unsatisfied
          .map((r) => `  - ${r.workspace}: ${r.name} ${r.range} -> ` + (r.version ? `${r.name}@${r.version} (${r.resolved})` : 'nothing'))
          .join('\n') +
        `\n\nA compile now would read the spec's declarations against a dependency they were not built against, and ` +
        `report this gate's own injection as a shape break.`,
    );
  }

  const oneCopy = [];
  for (const [name, declaring] of importerPlan.importers) {
    const expected = plan.find((step) => step.name === name).upstream.realpath;
    const readers = [
      ...resolutions.filter((r) => r.name === name).map((r) => ({ who: `spec consumer ${r.workspace}`, resolved: r.resolved, version: r.version })),
      ...declaring
        .filter((entry) => entry.refusing.length === 0)
        .map((entry) => {
          const found = resolvedDependency(path.join(repoRoot, entry.importer), name);
          return { who: `downstream importer ${entry.importer}`, resolved: found?.realpath ?? null, version: found?.version ?? null };
        }),
    ];
    const elsewhere = readers.filter((reader) => reader.resolved !== expected);
    if (elsewhere.length > 0) {
      fail(
        `${elsewhere.length} reader(s) of the re-pointed \`${name}\` do not resolve the one copy at ${expected}:\n` +
          elsewhere.map((r) => `  - ${r.who} -> ` + (r.version ? `${name}@${r.version} (${r.resolved})` : 'nothing')).join('\n') +
          `\n\nA compile now would read two copies of \`${name}\` in one program, and report the artifacts of that as ` +
          `shape breaks.`,
      );
    }
    const specReaders = readers.filter((r) => r.who.startsWith('spec consumer')).length;
    oneCopy.push({
      name,
      version: readers[0]?.version ?? null,
      resolved: expected,
      consumers: specReaders,
      importers: readers.length - specReaders,
      twoCopies: declaring.filter((entry) => entry.refusing.length > 0).map((entry) => entry.importer),
    });
  }

  log(
    `spec-shape-gate: injected ${SPEC_PACKAGE_NAME}@${manifest.version} built from ${UPSTREAM_REPO}@${sha} into ` +
      `${targets.length} store copy/copies of the ${DOWNSTREAM_REPO} checkout; ${consumers.length} workspace consumer(s) verified on it.`,
  );
  for (const target of targets) log(`  store    ${path.relative(repoRoot, target)}`);
  for (const consumer of consumers) log(`  consumer ${consumer.workspace}`);
  for (const line of substitutions) log(`spec-shape-gate: ${line}`);
  if (plan.length === 0) {
    log(`spec-shape-gate: no dependency substitution -- every declared dependency's store sibling satisfies its range.`);
  }
  const distinct = new Map();
  for (const r of resolutions) {
    const key = JSON.stringify([r.name, r.resolved]);
    distinct.set(key, { ...r, consumers: (distinct.get(key)?.consumers ?? 0) + 1 });
  }
  for (const r of distinct.values()) {
    log(`  resolves ${r.name}@${r.version} (declared ${r.range}) for ${r.consumers} consumer(s) -> ${r.resolved}`);
  }
  for (const c of oneCopy) {
    log(
      `  one copy of ${c.name}@${c.version} for ${c.consumers} spec consumer(s) and ${c.importers} downstream importer(s) -> ${c.resolved}` +
        (c.twoCopies.length > 0 ? `; a second copy stays for ${c.twoCopies.join(', ')}` : ''),
    );
  }
  return { targets, consumers, version: manifest.version, sha, substitutions, resolutions, oneCopy };
}

/* ── the typecheck log, parsed into attributed diagnostics ───────────────── */

// turbo prefixes every line of a task's output with `<package>:<task>: ` when
// it STREAMS (locally), and on a GitHub Actions runner it GROUPS instead: a
// `##[group]<package>:<task>` header per task, output emitted BARE under it,
// the failing task announced by a colourised header with no group at all. So
// the workspace is tracked from BOTH carriers: the prefix when it is there, and
// otherwise the header of the task whose output is currently streaming.
const TURBO_PREFIX = /^(?:\x1b\[[0-9;]*m)*([^\s:]+):([^\s:]+(?::[^\s:]+)*):\s?/;
const TURBO_GROUP_HEADER = /^(?:##\[group\])?([^\s:]+):([^\s:]+(?::[^\s:]+)*)$/;
const GROUP_END = /^##\[endgroup\]\s*$/;
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;
const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * Parse a captured `pnpm type-check` log into attributed diagnostics. Every row
 * carries the downstream file as a REPO-RELATIVE path, because that is what a
 * reader can open and what the registry's `file` patterns are written against.
 */
export function parseDiagnostics(logText, repoRoot) {
  const dirs = workspaceDirsByName(repoRoot);
  const rows = [];
  const unmappedPackages = new Set();
  let streaming = null;

  for (const rawLine of logText.split('\n')) {
    const line = rawLine.replace(ANSI, '');
    if (GROUP_END.test(line)) {
      streaming = null;
      continue;
    }
    const header = line.match(TURBO_GROUP_HEADER);
    if (header) {
      // Only a name this workspace actually has may become the attribution
      // target; anything else clears it.
      streaming = dirs.has(header[1]) ? header[1] : null;
      continue;
    }
    const prefixed = line.match(TURBO_PREFIX);
    const workspaceName = prefixed ? prefixed[1] : streaming;
    const body = prefixed ? line.slice(prefixed[0].length) : line;
    const diagnostic = body.match(DIAGNOSTIC);
    if (!diagnostic) continue;

    const [, rawFile, lineNo, column, severity, code, message] = diagnostic;
    let file = rawFile.trim();
    if (path.isAbsolute(file)) {
      file = path.relative(repoRoot, file);
    } else if (workspaceName) {
      const dir = dirs.get(workspaceName);
      if (dir) file = dir === '.' ? file : path.posix.join(dir, file);
      else unmappedPackages.add(workspaceName);
    }
    rows.push({
      workspace: workspaceName ?? '(unprefixed)',
      file: file.split(path.sep).join('/'),
      line: Number(lineNo),
      column: Number(column),
      severity,
      code,
      message,
    });
  }
  return { rows, unmappedPackages: [...unmappedPackages].sort() };
}

/** One row per distinct (file, line, column, code, message), with how often the log repeated it. */
export function distinctRows(rows) {
  const seen = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.file, row.line, row.column, row.code, row.message]);
    const hit = seen.get(key);
    if (hit) hit.occurrences += 1;
    else seen.set(key, { ...row, occurrences: 1 });
  }
  return [...seen.values()];
}

/* ── THE REGISTRY ────────────────────────────────────────────────────────── */

const ENTRY_KEYS = Object.freeze(['retired', 'objectstack_pr', 'objectstack_commit', 'downstream_card', 'registered_at', 'matches']);
const PATTERN_KEYS = Object.freeze(['file', 'code', 'message']);
const CARD_REF = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/;
const REPO_RELATIVE_FILE = /^(?!\/)(?!\.\.?\/)(?:[^\0/]+\/)*[^\0/]+$/;

/** A `file` pattern as a RegExp: `**` spans segments, `*` stays inside one, everything else is literal. */
export function fileGlobToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        source += '.*';
        i += 1;
        if (glob[i + 1] === '/') i += 1; // `**/` also matches zero directories
      } else {
        source += '[^/]*';
      }
    } else {
      source += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Parse the retirement registry. Returns `{ retirements }` or THROWS one error
 * naming every problem found -- the caller turns that into exit 2, because a
 * registry this reader cannot read is not an empty one.
 */
export function parseRegistry(text, file = REGISTRY_FILE) {
  const problems = [];
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not JSON: ${error.message}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.retirements)) {
    throw new Error(`${file} must be an object with a \`retirements\` array`);
  }
  for (const key of Object.keys(doc)) {
    if (key !== 'retirements' && key !== '$comment') problems.push(`top-level key "${key}" is not \`retirements\` or \`$comment\``);
  }
  const retirements = [];
  doc.retirements.forEach((entry, index) => {
    const where = `retirements[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${where} is not an object`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.includes(key)) problems.push(`${where} carries an unknown key "${key}" (the keys are ${ENTRY_KEYS.join(', ')})`);
    }
    for (const key of ENTRY_KEYS) {
      if (!(key in entry)) problems.push(`${where} lacks "${key}"`);
    }
    if (typeof entry.retired !== 'string' || entry.retired.trim() === '') problems.push(`${where}.retired must say what was retired`);
    if (!Number.isInteger(entry.objectstack_pr) || entry.objectstack_pr <= 0) problems.push(`${where}.objectstack_pr must be a positive integer`);
    if (typeof entry.objectstack_commit !== 'string' || !/^[0-9a-f]{40}$/.test(entry.objectstack_commit)) {
      problems.push(`${where}.objectstack_commit must be the 40-hex merge commit of that pull request`);
    }
    if (typeof entry.downstream_card !== 'string' || !CARD_REF.test(entry.downstream_card)) {
      problems.push(`${where}.downstream_card must read owner/repo#N (the consumer card that lands the catch-up)`);
    }
    if (typeof entry.registered_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.registered_at)) {
      problems.push(`${where}.registered_at must be a YYYY-MM-DD date`);
    }
    if (!Array.isArray(entry.matches) || entry.matches.length === 0) {
      problems.push(`${where}.matches must be a non-empty array -- a registration that matches nothing registers nothing`);
    } else {
      entry.matches.forEach((pattern, p) => {
        const at = `${where}.matches[${p}]`;
        if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) {
          problems.push(`${at} is not an object`);
          return;
        }
        for (const key of Object.keys(pattern)) {
          if (!PATTERN_KEYS.includes(key)) problems.push(`${at} carries an unknown key "${key}" (the keys are ${PATTERN_KEYS.join(', ')})`);
        }
        if (typeof pattern.file !== 'string' || !REPO_RELATIVE_FILE.test(pattern.file)) {
          problems.push(`${at}.file must be a repo-relative downstream path or glob (no leading slash or dot segment)`);
        }
        const hasCode = 'code' in pattern;
        const hasMessage = 'message' in pattern;
        if (hasCode && (typeof pattern.code !== 'string' || !/^TS\d+$/.test(pattern.code))) problems.push(`${at}.code must read TS<digits>`);
        if (hasMessage && (typeof pattern.message !== 'string' || pattern.message.trim() === '')) problems.push(`${at}.message must be a non-empty substring of the diagnostic`);
        if (!hasCode && !hasMessage) {
          problems.push(`${at} names a file and nothing else -- a file alone registers "anything in this file", which is the ignore-all switch this registry must never become; add \`code\` or \`message\``);
        }
      });
    }
    retirements.push(entry);
  });
  if (problems.length > 0) {
    throw new Error(`${file} has ${problems.length} problem(s):\n` + problems.map((p) => `  - ${p}`).join('\n'));
  }
  return { retirements };
}

/** Does one registry pattern cover one diagnostic row? Every declared field must hold. */
export function patternCovers(pattern, row) {
  if (!fileGlobToRegExp(pattern.file).test(row.file)) return false;
  if ('code' in pattern && pattern.code !== row.code) return false;
  if ('message' in pattern && !String(row.message).includes(pattern.message)) return false;
  return true;
}

/**
 * Split the rows into `known` (a registered retirement covers the row, and
 * which entry) and `unknown` (a new break), and name the entries that covered
 * nothing this run.
 */
export function classifyRows(rows, registry) {
  const known = [];
  const unknown = [];
  const matchedEntries = new Set();
  for (const row of rows) {
    const entry = (registry?.retirements ?? []).find((candidate) => candidate.matches.some((pattern) => patternCovers(pattern, row)));
    if (entry) {
      known.push({ row, entry });
      matchedEntries.add(entry);
    } else {
      unknown.push(row);
    }
  }
  const unmatchedEntries = (registry?.retirements ?? []).filter((entry) => !matchedEntries.has(entry));
  return { known, unknown, unmatchedEntries };
}

/** The exit code `report` ends with. See the header's exit table. */
export function verdict({ status, rows, unknown }) {
  if (status === 0 && rows.length === 0) return 0;
  if (rows.length === 0) return 2;
  if (unknown.length > 0) return 1;
  return 0;
}

/* ── THE ATTRIBUTION ─────────────────────────────────────────────────────── */

/** The pull request a squash-merged commit title names: the trailing `(#N)`. */
export function pullNumberFromTitle(title) {
  const match = /\(#([1-9]\d*)\)\s*$/.exec(String(title ?? '').split('\n')[0].trim());
  return match ? Number(match[1]) : null;
}

/** The cards a pull request body closes, by GitHub's own closing keywords -- `Fixes #N`, `closes: #N`, and the rest. */
export function closingTargets(body) {
  const out = [];
  const re = /\b(?:fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)\b\s*:?\s+#([1-9]\d*)/gi;
  for (const match of String(body ?? '').matchAll(re)) {
    const n = Number(match[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** The `domain:*` labels among a label list (names or `{ name }` objects). */
export function laneLabels(labels) {
  return [...new Set((labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter((n) => typeof n === 'string' && n.startsWith('domain:')))].sort();
}

/**
 * The newest completed `success` run of this workflow on `main` that is not
 * this run and whose head is not this head -- the last green, whose head opens
 * the commit range. A `known`-only run concluded `success`, so it counts, which
 * is what resets the range after a registration.
 */
export function selectPreviousGreen(runs, { currentSha, currentRunId }) {
  const candidates = (runs ?? []).filter(
    (run) =>
      run?.status === 'completed' &&
      run?.conclusion === 'success' &&
      run?.head_branch === 'main' &&
      ATTRIBUTED_EVENTS.includes(run?.event) &&
      String(run?.id) !== String(currentRunId) &&
      run?.head_sha !== currentSha,
  );
  candidates.sort((a, b) => String(b.run_started_at ?? b.created_at ?? '').localeCompare(String(a.run_started_at ?? a.created_at ?? '')) || Number(b.id) - Number(a.id));
  return candidates[0] ?? null;
}

async function githubGet({ fetchJson, repo, token, route }) {
  const url = `https://api.github.com/repos/${repo}${route}`;
  return fetchJson(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
}

/**
 * The commit range since the last green, each commit's pull request and lane.
 * `fetchJson(url, init)` returns `{ ok, status, json }`; the self-test hands in
 * a fake, the live caller a thin wrapper over `fetch`. Nothing here throws into
 * the verdict: every failure becomes a `note` or an `unattributed` reason.
 */
export async function attributeRange({ repo, token, sha, runId, fetchJson, maxCommits = ATTRIBUTION_MAX_COMMITS }) {
  const result = { previousGreen: null, range: null, commits: [], truncated: false, capped: false, lanes: new Map(), notes: [] };
  const workflowFile = path.basename(WORKFLOW_FILE);
  const runsRes = await githubGet({ fetchJson, repo, token, route: `/actions/workflows/${workflowFile}/runs?branch=main&status=completed&per_page=100` });
  if (!runsRes.ok || !Array.isArray(runsRes.json?.workflow_runs)) {
    result.notes.push(`could not list this workflow's completed runs on main (HTTP ${runsRes.status}); no range can be named`);
    return result;
  }
  const previousGreen = selectPreviousGreen(runsRes.json.workflow_runs, { currentSha: sha, currentRunId: runId });
  if (!previousGreen) {
    result.notes.push(
      `no earlier green run of this workflow on main among the ${runsRes.json.workflow_runs.length} newest completed run(s) -- the first runs, or a red standing since the first run; no range can be named`,
    );
    return result;
  }
  result.previousGreen = { id: previousGreen.id, head_sha: previousGreen.head_sha, run_started_at: previousGreen.run_started_at, html_url: previousGreen.html_url };

  const compareRes = await githubGet({ fetchJson, repo, token, route: `/compare/${previousGreen.head_sha}...${sha}?per_page=250` });
  if (!compareRes.ok || !Array.isArray(compareRes.json?.commits)) {
    result.notes.push(`the compare ${String(previousGreen.head_sha).slice(0, 10)}...${String(sha).slice(0, 10)} could not be read (HTTP ${compareRes.status})`);
    return result;
  }
  result.range = { base: previousGreen.head_sha, head: sha, status: compareRes.json.status, total: compareRes.json.total_commits, html_url: compareRes.json.html_url };
  result.truncated = Number(compareRes.json.total_commits) > compareRes.json.commits.length;

  const listed = compareRes.json.commits.slice().reverse(); // newest first
  const toRead = listed.slice(0, maxCommits);
  result.capped = listed.length > toRead.length;
  for (const c of toRead) {
    const title = String(c?.commit?.message ?? '').split('\n')[0];
    const pull = pullNumberFromTitle(title);
    const commit = { sha: c.sha, title, pull, lanes: [], cards: [], reason: null };
    if (pull === null) {
      commit.reason = 'the title names no pull request';
    } else {
      const pullRes = await githubGet({ fetchJson, repo, token, route: `/pulls/${pull}` });
      if (!pullRes.ok) {
        commit.reason = `pull ${pull} could not be read (HTTP ${pullRes.status})`;
      } else {
        const lanes = new Set(laneLabels(pullRes.json?.labels));
        for (const card of closingTargets(pullRes.json?.body)) {
          const cardRes = await githubGet({ fetchJson, repo, token, route: `/issues/${card}` });
          if (!cardRes.ok) {
            commit.cards.push({ number: card, lanes: [], reason: `HTTP ${cardRes.status}` });
            continue;
          }
          const cardLanes = laneLabels(cardRes.json?.labels);
          commit.cards.push({ number: card, lanes: cardLanes, reason: null });
          for (const lane of cardLanes) lanes.add(lane);
        }
        commit.lanes = [...lanes].sort();
        if (commit.lanes.length === 0) commit.reason = commit.cards.length === 0 ? `pull ${pull} carries no domain label and closes no card` : `neither pull ${pull} nor its card(s) carry a domain label`;
      }
    }
    for (const lane of commit.lanes.length > 0 ? commit.lanes : ['unattributed']) {
      result.lanes.set(lane, (result.lanes.get(lane) ?? 0) + 1);
    }
    result.commits.push(commit);
  }
  return result;
}

/** The markdown block the attribution renders as, in the run summary. */
export function renderAttribution(attribution) {
  const out = ['### Attribution -- the objectstack commits since the last green run', ''];
  if (!attribution) return out.concat(['_Not attributed: this event has no range to name._']).join('\n');
  const short = (s) => String(s ?? '').slice(0, 10);
  if (!attribution.range) {
    out.push('⚠️ No commit range could be named for this red run.');
    for (const note of attribution.notes) out.push(`- ${note}`);
    out.push('', 'Read the run log directly. ⛔ The absence of a range is the absence of a READING, not evidence that nothing changed.');
    return out.join('\n');
  }
  const { range, previousGreen, commits } = attribution;
  out.push(
    `Range: \`${short(range.base)}\` (run ${previousGreen.id}, the last green run of this workflow on main) .. \`${short(range.head)}\`` +
      (range.html_url ? ` -- [compare](${range.html_url})` : '') +
      ` -- ${range.total} commit(s)` +
      (attribution.truncated ? ' (the compare API truncated the list; open the compare link for the rest)' : '') +
      (attribution.capped ? ` (pull requests read for the newest ${commits.length} only)` : ''),
    '',
  );
  if (commits.length === 0) {
    out.push('⚠️ Nothing landed in that range: the same tree was green last time and is red now, so this is a flake, an infrastructure fault, or the DOWNSTREAM moved (objectui `main` is cloned fresh each run). ⛔ Do not go looking for the objectstack commit that broke it.');
  } else {
    const lanes = [...attribution.lanes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    out.push(`**Lanes implicated:** ${lanes.map(([lane, n]) => `\`${lane}\` (${n})`).join(', ')}`, '');
    out.push('| commit | pull | card(s) | lane(s) |', '| --- | --- | --- | --- |');
    for (const c of commits) {
      const cards = c.cards.length > 0 ? c.cards.map((k) => `#${k.number}${k.reason ? ` (${k.reason})` : ''}`).join(', ') : '--';
      const lane = c.lanes.length > 0 ? c.lanes.map((l) => `\`${l}\``).join(', ') : `unattributed${c.reason ? ` -- ${c.reason}` : ''}`;
      out.push(`| \`${short(c.sha)}\` ${c.title.replace(/\|/g, '\\|')} | ${c.pull ? `#${c.pull}` : '--'} | ${cards} | ${lane} |`);
    }
  }
  for (const note of attribution.notes) out.push('', `⚠️ ${note}`);
  out.push('', 'Under the two-speed rule 3 of #22998 a new break is the implicated lane\'s FIRST work: its next pull request carries the fix, or -- for an intentional retirement -- the accepting seat files the downstream card and registers the retirement in `' + REGISTRY_FILE + '` in the same act, and the next hourly run reads it as `known`. A lane written `unattributed` is a reading this gate could not take, never a lane with no owner.');
  return out.join('\n');
}

/* ── the summary and the annotations ─────────────────────────────────────── */

function diagnosticsTable(rows, extra = () => '') {
  const out = ['| objectui file | line | code | message | |', '| --- | --- | --- | --- | --- |'];
  for (const row of rows.slice(0, 50)) {
    out.push(`| \`${row.file}\` | ${row.line} | ${row.code} | ${String(row.message).replace(/\|/g, '\\|')}${row.occurrences > 1 ? ` (x${row.occurrences})` : ''} | ${extra(row)} |`);
  }
  if (rows.length > 50) out.push(`| ... | | | ${rows.length - 50} more, in the job log | |`);
  return out;
}

/** The markdown this gate puts in front of a human. */
export function renderSummary({ sha, downstreamSha = null, commit = null, event = null, status, rows, known, unknown, unmatchedEntries, unmappedPackages, attribution = null }) {
  const short = String(sha).slice(0, 12);
  const link = `https://github.com/${UPSTREAM_REPO}/commit/${sha}`;
  const out = [];
  out.push(`### Spec Shape Gate -- \`${UPSTREAM_REPO}@${short}\` against \`${DOWNSTREAM_REPO}@${String(downstreamSha ?? 'main').slice(0, 12)}\``, '');
  out.push(`Compiled ${DOWNSTREAM_REPO} at \`main\`${downstreamSha ? ` (\`${String(downstreamSha).slice(0, 12)}\`)` : ''} against \`${SPEC_PACKAGE_NAME}\` and every other \`@objectstack/*\` package it installs, built and packed from [${short}](${link})${event ? ` (\`${event}\` run)` : ''}.`);
  if (commit) out.push('', `> ${commit}`);
  out.push('');

  if (status === 0 && rows.length === 0) {
    out.push(`✅ ${DOWNSTREAM_REPO} type-checks against \`@objectstack/*\` at that commit.`);
  } else if (rows.length === 0) {
    out.push(
      `⛔ The typecheck failed (exit ${status}) and **no diagnostic could be attributed to a file**.`,
      '',
      `That is not a shape break this gate can hand to anybody: the whole point of compiling a consumer is that the ` +
        `change in objectstack which moved the shape is identifiable from the objectui file that stopped compiling. Read ` +
        `the job log -- the failure is upstream of the compiler (an install, a build, the spec's own build) or the ` +
        `compiler's output shape moved. This run is exit 2: not a pass, not a shape break.`,
    );
  } else {
    const unknownRows = distinctRows(unknown);
    const knownRows = distinctRows(known.map((k) => k.row));
    const entryFor = (row) => known.find((k) => k.row.file === row.file && k.row.line === row.line && k.row.code === row.code && k.row.message === row.message)?.entry;
    if (unknownRows.length > 0) {
      const files = [...new Set(unknownRows.map((row) => row.file))].sort();
      out.push(
        `⛔ **${unknownRows.length} NEW diagnostic(s) in ${files.length} objectui file(s)** against \`${UPSTREAM_REPO}@${short}\` that no registered retirement covers.`,
        '',
        `Each row is an objectui file that compiles against the published spec objectui pins and does not compile against this commit. The objectstack pull request that moved the shape is the one that answers; the attribution below names the candidates.`,
        '',
        ...diagnosticsTable(unknownRows),
        '',
        `**Files:** ${files.map((file) => `\`${file}\``).join(', ')}`,
      );
    } else {
      out.push(`✅ No new shape break: every diagnostic below is a REGISTERED retirement.`);
    }
    if (knownRows.length > 0) {
      out.push(
        '',
        `#### known -- ${knownRows.length} diagnostic(s) covered by ${new Set(known.map((k) => k.entry)).size} registered retirement(s)`,
        '',
        ...diagnosticsTable(knownRows, (row) => {
          const entry = entryFor(row);
          return entry ? `known (registered: ${entry.downstream_card}, objectstack PR #${entry.objectstack_pr}: ${entry.retired})` : 'known';
        }),
      );
    }
    out.push('', `**Against:** \`${UPSTREAM_REPO}@${sha}\` -- ${link}`);
  }

  if (unmatchedEntries?.length > 0) {
    out.push('', `ℹ️ ${unmatchedEntries.length} registered retirement(s) matched nothing in this run -- objectui has caught up (prune the entry when its card closes) or the pattern never matched (fix it on the registration's own pull request):`);
    for (const entry of unmatchedEntries) out.push(`- ${entry.downstream_card} (objectstack PR #${entry.objectstack_pr}: ${entry.retired})`);
  }
  if (unmappedPackages?.length > 0) {
    out.push('', `⚠️ ${unmappedPackages.length} turbo package name(s) did not resolve to a directory (${unmappedPackages.join(', ')}), so the paths they contributed are package-relative. That is a reader problem in this gate, not a finding about the spec.`);
  }
  if (rows.length > 0 && unknown.length > 0) out.push('', renderAttribution(attribution));
  return out.join('\n');
}

/**
 * GitHub annotations, one per NEW diagnostic up to the platform's per-step cap.
 * The objectui path rides in the TITLE and the message, not in `file=`: a
 * `file=` naming a path this repository does not hold is re-homed by the
 * platform onto the workflow file, which is the one thing the annotation must
 * not say.
 */
export function annotationLines(unknownRows, sha) {
  const short = String(sha).slice(0, 12);
  const rows = distinctRows(unknownRows);
  const lines = rows.slice(0, ANNOTATION_CAP).map((row) => {
    const title = `spec shape break: objectui ${row.file}:${row.line} (objectstack ${short})`;
    const message = `${row.code}: ${row.message} -- ${DOWNSTREAM_REPO} ${row.file}:${row.line}:${row.column}, compiled against ${SPEC_PACKAGE_NAME} built from ${UPSTREAM_REPO}@${short}`;
    return `::error title=${title.replace(/[,:]/g, (c) => (c === ',' ? '%2C' : '%3A'))}::${message.replace(/\r?\n/g, ' ')}`;
  });
  if (rows.length > ANNOTATION_CAP) {
    lines.push(`::error title=spec shape break (objectstack ${short})::${rows.length - ANNOTATION_CAP} more new diagnostic(s) -- the run summary carries every row.`);
  }
  return lines;
}

async function liveFetchJson(url, init) {
  try {
    const res = await fetch(url, init);
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } catch (error) {
    return { ok: false, status: `network: ${error.message}`, json: null };
  }
}

async function report({ logPath, sha, downstreamSha, status, commit, event, downstream, registryPath }) {
  let registry;
  try {
    registry = parseRegistry(fs.readFileSync(registryPath, 'utf8'), registryPath);
  } catch (error) {
    fail(`${error.message}\n\nA registry this reader cannot read is not an empty one: nothing was judged, and this run is exit 2.`);
  }
  const logText = fs.readFileSync(logPath, 'utf8');
  const { rows, unmappedPackages } = parseDiagnostics(logText, downstream);
  const { known, unknown, unmatchedEntries } = classifyRows(rows, registry);

  let attribution = null;
  if (unknown.length > 0 && ATTRIBUTED_EVENTS.includes(event)) {
    const repo = process.env.GITHUB_REPOSITORY ?? UPSTREAM_REPO;
    const token = process.env.GITHUB_TOKEN ?? '';
    if (!token) {
      attribution = { previousGreen: null, range: null, commits: [], truncated: false, capped: false, lanes: new Map(), notes: ['GITHUB_TOKEN is not set, so neither this workflow\'s runs nor the compare could be read'] };
    } else {
      attribution = await attributeRange({ repo, token, sha, runId: process.env.GITHUB_RUN_ID ?? '', fetchJson: liveFetchJson });
    }
  }

  const summary = renderSummary({ sha, downstreamSha, commit, event, status, rows, known, unknown, unmatchedEntries, unmappedPackages, attribution });
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  process.stdout.write(`${summary}\n`);

  const code = verdict({ status, rows, unknown });
  if (code === 1) for (const line of annotationLines(unknown, sha)) process.stdout.write(`${line}\n`);
  if (code === 0 && rows.length > 0) {
    process.stdout.write(`spec-shape-gate: ${distinctRows(rows).length} diagnostic(s), all registered retirements -- known, not red.\n`);
  }
  return code;
}

/* ─────────────────────────── self-test ─────────────────────────────────────
 * Offline, no install, no network. It exercises BOTH directions of every
 * judgement that decides a verdict: a parser demonstrated only on input it
 * parses is not demonstrated, and a registry reader shown only a valid entry
 * has not been shown to refuse one.
 *
 * Floor: what is pinned is the registered battery NAMES and a minimum case
 * count per battery, never one total -- a battery falling 40 -> 3 still prints
 * a non-zero count. Handshake: the verdict sets `selfTestReachedVerdict` as its
 * LAST statement, and the dispatch refuses when it is unset, so a `return`
 * above the verdict cannot report as a pass. Copied from
 * `scripts/check-agent-model-declared.mjs`, never imported: every self-test
 * keeps running standalone.
 */
let selfTestReachedVerdict = false;

const SELF_TEST_BATTERIES = Object.freeze({
  'diagnostics: parse and attribute to a downstream file': 9,
  'summary: both directions': 5,
  'inject: staged package shape and store readers': 5,
  'ranges: satisfiesRange and workspace globs': 11,
  'registry: load, refuse, match': 13,
  'attribution: commit range and lanes': 11,
  'verdict: exit code mapping and annotations': 6,
});
const SELF_TEST_BATTERY_FLOOR = 7;
const UNATTRIBUTED_BATTERY = '(no battery open)';

/** A synthetic downstream: the workspace file pnpm reads, four manifests, no install. */
function syntheticDownstream() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-shape-gate-selftest-'));
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"object-ui-root"}');
  for (const [dir, name] of [
    ['packages/core', '@object-ui/core'],
    ['packages/plugin-grid', '@object-ui/plugin-grid'],
    ['packages/react', '@object-ui/react'],
    ['apps/console', '@object-ui/console'],
  ]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify({ name }));
  }
  return root;
}

/** The registry entry the positive control is registered with, as the self-test's fixture. */
const FIXTURE_ENTRY = Object.freeze({
  retired: "view-level data source provider 'api'",
  objectstack_pr: 23160,
  objectstack_commit: '1912af47ba6e3b250f7c717fea0d56e181029b9c',
  downstream_card: 'objectstack-ai/objectui#999999',
  registered_at: '2026-10-13',
  matches: [
    { file: 'packages/react/src/hooks/useViewData.ts', code: 'TS2367', message: '\'"api"\'' },
    { file: 'packages/core/src/adapters/resolveDataSource.ts', code: 'TS2678', message: '\'"api"\'' },
    { file: 'packages/core/src/adapters/resolveDataSource.ts', code: 'TS2339', message: "on type 'never'" },
  ],
});

async function selfTest() {
  const ESC = String.fromCharCode(27);
  const results = [];
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const check = (name, actual, expected) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ name, ok, actual, expected });
  };
  const threw = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  const thrownMessage = (fn) => {
    try {
      fn();
      return '';
    } catch (error) {
      return String(error.message);
    }
  };

  const downstream = syntheticDownstream();
  const sha = 'a'.repeat(40);

  battery('diagnostics: parse and attribute to a downstream file');
  const fixture = [
    '@object-ui/core:type-check: > tsc --noEmit',
    '@object-ui/core:type-check: src/registry.ts(12,5): error TS2339: Property nope does not exist.',
    `${ESC}[32m@object-ui/plugin-grid:type-check:${ESC}[0m src/grid.tsx(4,1): error TS2724: no export.`,
    '//:type-check:e2e: e2e/app.spec.ts(9,3): error TS2554: Expected 1 arguments.',
    '@object-ui/core:type-check: this line is prose about (1,2): error TS9999 inside a sentence',
  ].join('\n');
  const parsed = parseDiagnostics(fixture, downstream);
  check('attributes a package-relative path to its workspace directory', parsed.rows[0]?.file, 'packages/core/src/registry.ts');
  check('parses a colourised prefix', parsed.rows[1]?.file, 'packages/plugin-grid/src/grid.tsx');
  check('maps the root task to the repo root', parsed.rows[2]?.file, 'e2e/app.spec.ts');
  check('carries the code through', parsed.rows[1]?.code, 'TS2724');
  check('a green log yields zero rows', parseDiagnostics(['@object-ui/core:type-check: > tsc --noEmit', ' Tasks:    81 successful, 81 total'].join('\n'), downstream).rows.length, 0);
  const grouped = [
    '##[group]@object-ui/console:type-check',
    '> tsc --noEmit && tsc -p tsconfig.test.json',
    '##[endgroup]',
    `${ESC}[;31m@object-ui/react:type-check${ESC}[;0m`,
    '> tsc --noEmit && tsc -p tsconfig.test.json',
    "src/hooks/useNavigationOverlay.ts(76,3): error TS2322: Type 'string' is not assignable.",
  ].join('\n');
  check('attributes a BARE diagnostic to the task whose section it is streaming in', parseDiagnostics(grouped, downstream).rows[0]?.file, 'packages/react/src/hooks/useNavigationOverlay.ts');
  check(
    'a diagnostic in no task section is NOT charged to a package',
    parseDiagnostics(['##[endgroup]', "src/hooks/useNavigationOverlay.ts(76,3): error TS2322: Type 'string' is not assignable."].join('\n'), downstream).rows[0]?.file,
    'src/hooks/useNavigationOverlay.ts',
  );
  check(
    'a header-shaped line naming no workspace clears the attribution',
    parseDiagnostics(['##[group]@object-ui/react:type-check', 'totally:unrelated', "src/hooks/useNavigationOverlay.ts(76,3): error TS2322: Type 'string' is not assignable."].join('\n'), downstream).rows[0]?.file,
    'src/hooks/useNavigationOverlay.ts',
  );
  check(
    'distinctRows folds the two tsc programs of one task into one row with an occurrence count',
    distinctRows(parseDiagnostics([grouped, grouped].join('\n'), downstream).rows).map((r) => r.occurrences),
    [2],
  );

  battery('summary: both directions');
  const base = { sha, downstreamSha: 'b'.repeat(40), status: 0, rows: [], known: [], unknown: [], unmatchedEntries: [], unmappedPackages: [] };
  check('a green summary says so', renderSummary(base).includes('type-checks against'), true);
  check('an unattributable failure refuses to read as a shape break', renderSummary({ ...base, status: 1 }).includes('no diagnostic could be attributed to a file'), true);
  check(
    'a red summary names the file AND the commit',
    (() => {
      const text = renderSummary({ ...base, status: 1, rows: parsed.rows, unknown: parsed.rows });
      return text.includes('packages/core/src/registry.ts') && text.includes(sha) && text.includes('NEW diagnostic');
    })(),
    true,
  );
  const knownRow = { workspace: '@object-ui/react', file: 'packages/react/src/hooks/useViewData.ts', line: 124, column: 5, severity: 'error', code: 'TS2367', message: 'This comparison appears to be unintentional because the types \'"object" | "value" | "schema" | undefined\' and \'"api"\' have no overlap.' };
  check(
    'a known-only summary says no new break and names the registration',
    (() => {
      const text = renderSummary({ ...base, status: 1, rows: [knownRow], known: [{ row: knownRow, entry: FIXTURE_ENTRY }] });
      return text.includes('No new shape break') && text.includes('known (registered: objectstack-ai/objectui#999999') && !text.includes('NEW diagnostic');
    })(),
    true,
  );
  check('an entry that matched nothing is listed for pruning', renderSummary({ ...base, unmatchedEntries: [FIXTURE_ENTRY] }).includes('matched nothing in this run'), true);

  battery('inject: staged package shape and store readers');
  check(
    'reads every `types` target out of a conditional exports map',
    declaredTypesTargets({ '.': { import: { types: './dist/index.d.mts', default: './dist/index.mjs' } }, './ui': { require: { types: './dist/ui/index.d.ts', default: './dist/ui/index.js' } } }),
    ['./dist/index.d.mts', './dist/ui/index.d.ts'],
  );
  check('an exports map with no types target yields none', declaredTypesTargets({ '.': './x.js' }), []);
  const store = path.join(downstream, 'node_modules', '.pnpm');
  const one = path.join(store, '@objectstack+spec@17.4.0_ai@7.0.0_', 'node_modules', '@objectstack', 'spec');
  fs.mkdirSync(one, { recursive: true });
  fs.writeFileSync(path.join(one, 'package.json'), '{"name":"@objectstack/spec"}');
  fs.mkdirSync(path.join(store, '@objectstack+formula@17.4.0', 'node_modules', '@objectstack', 'formula'), { recursive: true });
  check('finds a peer-suffixed store copy', findInstalledSpecDirs(downstream).length, 1);
  check('does not claim a sibling @objectstack package', findInstalledSpecDirs(downstream)[0], one);
  check('an empty tree finds none', findInstalledSpecDirs(path.join(downstream, 'nowhere')).length, 0);

  battery('ranges: satisfiesRange and workspace globs');
  check('a caret range refuses an older minor', satisfiesRange('4.4.3', '^4.6.1'), false);
  check('a caret range admits its floor and a later minor', [satisfiesRange('4.6.1', '^4.6.1'), satisfiesRange('4.7.0', '^4.6.1')], [true, true]);
  check('a caret range refuses the next major', satisfiesRange('5.0.0', '^4.6.1'), false);
  check('a caret range on 0.x stops at the next minor', [satisfiesRange('0.3.9', '^0.3.1'), satisfiesRange('0.4.0', '^0.3.1')], [true, false]);
  check('a tilde range stops at the next minor', [satisfiesRange('2.14.9', '~2.14.0'), satisfiesRange('2.15.0', '~2.14.0')], [true, false]);
  check('an exact version admits only itself', [satisfiesRange('2.14.0', '2.14.0'), satisfiesRange('2.14.1', '2.14.0')], [true, false]);
  check(
    'a comparator set is an AND, a union an OR',
    [satisfiesRange('17.9.0', '>=17.1.0 <18.0.0'), satisfiesRange('18.0.0', '>=17.1.0 <18.0.0'), satisfiesRange('3.0.0', '^1.0.0 || ^3.0.0'), satisfiesRange('2.0.0', '^1.0.0 || ^3.0.0')],
    [true, false, true, false],
  );
  const refuses = (version, range) => threw(() => satisfiesRange(version, range));
  check(
    'an unreadable spelling throws rather than guessing',
    [refuses('4.6.1', 'workspace:*'), refuses('4.6.1', '4.x'), refuses('4.6.1', '^4.6'), refuses('4.7.0-beta.1', '^4.6.1'), refuses('4.6.1', '^4.6.1 || latest')],
    [true, true, true, true, true],
  );
  check(
    'reads the packages globs of a pnpm-workspace.yaml, and nothing after them',
    parseWorkspaceGlobs("# c\npackages:\n  - 'packages/*'\n  - \"docs\"  # tail\n  - apps/*\nonlyBuiltDependencies:\n  - esbuild\n"),
    ['packages/*', 'docs', 'apps/*'],
  );
  check(
    'a glob the reader does not know throws rather than dropping importers',
    [threw(() => parseWorkspaceGlobs("packages:\n  - 'packages/**'\n")), threw(() => parseWorkspaceGlobs("packages:\n  - '!packages/x'\n")), threw(() => parseWorkspaceGlobs('overrides: {}\n'))],
    [true, true, true],
  );
  check('workspaceDirsByName is derived from the workspace file, root included', [...workspaceDirsByName(downstream).entries()].sort(), [['//', '.'], ['@object-ui/console', 'apps/console'], ['@object-ui/core', 'packages/core'], ['@object-ui/plugin-grid', 'packages/plugin-grid'], ['@object-ui/react', 'packages/react']].sort());

  battery('registry: load, refuse, match');
  const registryText = (entries) => JSON.stringify({ retirements: entries });
  check('a well-formed entry loads', parseRegistry(registryText([FIXTURE_ENTRY])).retirements.length, 1);
  check('an empty registry loads as zero retirements', parseRegistry(registryText([])).retirements.length, 0);
  check('a registry that is not JSON is refused', thrownMessage(() => parseRegistry('{ nope', 'r.json')).includes('is not JSON'), true);
  check('a top-level array is refused', threw(() => parseRegistry('[]')), true);
  check('an entry without its downstream card is refused by name', thrownMessage(() => parseRegistry(registryText([{ ...FIXTURE_ENTRY, downstream_card: undefined }]))).includes('lacks "downstream_card"'), true);
  check('a file-only pattern is refused as the ignore-all switch', thrownMessage(() => parseRegistry(registryText([{ ...FIXTURE_ENTRY, matches: [{ file: 'packages/react/src/x.ts' }] }]))).includes('ignore-all switch'), true);
  check('an empty matches array is refused', thrownMessage(() => parseRegistry(registryText([{ ...FIXTURE_ENTRY, matches: [] }]))).includes('registers nothing'), true);
  check('an unknown entry key is refused', thrownMessage(() => parseRegistry(registryText([{ ...FIXTURE_ENTRY, ignore_all: true }]))).includes('unknown key "ignore_all"'), true);
  check('a short commit, a bad card ref and a bad date are each named', (() => {
    const msg = thrownMessage(() => parseRegistry(registryText([{ ...FIXTURE_ENTRY, objectstack_commit: '1912af47', downstream_card: 'objectui 999999', registered_at: 'yesterday' }])));
    return msg.includes('objectstack_commit') && msg.includes('downstream_card') && msg.includes('registered_at') && msg.includes('3 problem(s)');
  })(), true);
  check('a pattern covers a row only when every declared field holds', [
    patternCovers(FIXTURE_ENTRY.matches[0], knownRow),
    patternCovers({ ...FIXTURE_ENTRY.matches[0], code: 'TS2322' }, knownRow),
    patternCovers({ ...FIXTURE_ENTRY.matches[0], message: 'no overlap at all, really' }, knownRow),
    patternCovers({ file: 'packages/other/src/hooks/useViewData.ts', code: 'TS2367' }, knownRow),
  ], [true, false, false, false]);
  check('a file glob spans segments with ** and stays inside one with *', [
    patternCovers({ file: 'packages/**/useViewData.ts', code: 'TS2367' }, knownRow),
    patternCovers({ file: 'packages/*/src/hooks/*.ts', code: 'TS2367' }, knownRow),
    patternCovers({ file: 'packages/*/useViewData.ts', code: 'TS2367' }, knownRow),
    fileGlobToRegExp('a.b/*.ts').test('aXb/c.ts'),
  ], [true, true, false, false]);
  const newRow = { ...knownRow, file: 'packages/react/src/hooks/useViewData.ts', line: 200, code: 'TS2322', message: "Type 'string' is not assignable to type 'number'." };
  const classified = classifyRows([knownRow, newRow], parseRegistry(registryText([FIXTURE_ENTRY])));
  check('classifyRows splits a registered row from a new one in the same file', [classified.known.length, classified.unknown.length, classified.known[0]?.entry.downstream_card, classified.unmatchedEntries.length], [1, 1, 'objectstack-ai/objectui#999999', 0]);
  check('an entry that covers no row is reported as unmatched, and nothing is known', (() => {
    const c = classifyRows([newRow], parseRegistry(registryText([FIXTURE_ENTRY])));
    return [c.known.length, c.unknown.length, c.unmatchedEntries.length];
  })(), [0, 1, 1]);

  battery('attribution: commit range and lanes');
  check('the squash suffix names the pull request', [pullNumberFromTitle('feat(spec)!: retire the view-level api data source (#23160)'), pullNumberFromTitle('fix: no suffix'), pullNumberFromTitle('chore (#12) then more')], [23160, null, null]);
  check('closing keywords name cards; a negated spelling does not', closingTargets('Fixes #23082\nClause: no\n\n#23090 is not addressed here; closes: #7, resolved #7 again, and refs #9'), [23082, 7]);
  check('laneLabels keeps domain labels only, from names or objects', laneLabels([{ name: 'domain:spec' }, 'size/l', { name: 'domain:ui' }, 'domain:spec']), ['domain:spec', 'domain:ui']);
  const run = (id, head_sha, conclusion, extra = {}) => ({ id, head_sha, head_branch: 'main', event: 'schedule', status: 'completed', conclusion, run_started_at: `2026-10-13T${String(id).padStart(2, '0')}:00:00Z`, ...extra });
  const H = ['1'.repeat(40), '2'.repeat(40), '3'.repeat(40)];
  check('selectPreviousGreen takes the newest success that is not this run or this head', selectPreviousGreen([run(1, H[0], 'success'), run(2, H[1], 'success'), run(3, H[2], 'failure'), run(4, H[2], 'success')], { currentSha: H[2], currentRunId: 9 })?.id, 2);
  check('selectPreviousGreen ignores a pull_request run, a non-main run and this run id', selectPreviousGreen([run(5, H[1], 'success', { event: 'pull_request' }), run(6, H[1], 'success', { head_branch: 'feature' }), run(7, H[1], 'success')], { currentSha: H[2], currentRunId: 7 }), null);
  const board = {
    runs: [run(1, H[0], 'success'), run(2, H[1], 'success'), run(3, H[2], 'failure')],
    commits: [
      { sha: 'c1'.repeat(20), commit: { message: 'fix(core): first (#101)\n\nbody' } },
      { sha: 'c2'.repeat(20), commit: { message: 'docs: untracked change' } },
      { sha: 'c3'.repeat(20), commit: { message: 'feat(spec)!: retire x (#103)' } },
    ],
    pulls: {
      101: { labels: [{ name: 'size/s' }], body: 'Fixes #501\n' },
      103: { labels: [{ name: 'domain:ui' }], body: 'Part of #503 and closes #504' },
    },
    issues: { 501: { labels: [{ name: 'domain:spec' }] }, 504: { labels: [] } },
  };
  const fakeFetch = (overrides = {}) => async (url) => {
    const route = url.replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+/, '');
    if (route.startsWith('/actions/workflows/spec-shape-gate.yml/runs')) return overrides.runs ?? { ok: true, status: 200, json: { workflow_runs: board.runs } };
    if (route.startsWith('/compare/')) return overrides.compare ?? { ok: true, status: 200, json: { status: 'ahead', total_commits: board.commits.length, html_url: 'https://example.invalid/compare', commits: board.commits } };
    const pull = /^\/pulls\/(\d+)$/.exec(route);
    if (pull) return board.pulls[pull[1]] ? { ok: true, status: 200, json: board.pulls[pull[1]] } : { ok: false, status: 404, json: null };
    const issue = /^\/issues\/(\d+)$/.exec(route);
    if (issue) return board.issues[issue[1]] ? { ok: true, status: 200, json: board.issues[issue[1]] } : { ok: false, status: 404, json: null };
    return { ok: false, status: 500, json: null };
  };
  const attributed = await attributeRange({ repo: 'o/r', token: 't', sha: H[2], runId: 3, fetchJson: fakeFetch() });
  check('the range opens at the last green head and lists the commits newest first', [attributed.range?.base, attributed.commits.map((c) => c.sha.slice(0, 2))], [H[1], ['c3', 'c2', 'c1']]);
  check('a lane is read from the card the pull fixes, from the pull\'s own label, or written unattributed with the reason', attributed.commits.map((c) => [c.pull, c.lanes, c.reason]), [
    [103, ['domain:ui'], null],
    [null, [], 'the title names no pull request'],
    [101, ['domain:spec'], null],
  ]);
  check('the lane tally counts commits per lane, unattributed included', [...attributed.lanes.entries()].sort(), [['domain:spec', 1], ['domain:ui', 1], ['unattributed', 1]]);
  const capped = await attributeRange({ repo: 'o/r', token: 't', sha: H[2], runId: 3, fetchJson: fakeFetch(), maxCommits: 1 });
  check('a cap on the commits read is applied newest first and said', [capped.capped, capped.commits.length, capped.commits[0].pull], [true, 1, 103]);
  const noGreen = await attributeRange({ repo: 'o/r', token: 't', sha: H[0], runId: 1, fetchJson: fakeFetch({ runs: { ok: true, status: 200, json: { workflow_runs: [run(1, H[0], 'failure')] } } }) });
  const noCompare = await attributeRange({ repo: 'o/r', token: 't', sha: H[2], runId: 3, fetchJson: fakeFetch({ compare: { ok: false, status: 422, json: null } }) });
  check('no previous green and a failed compare each leave no range and say which', [noGreen.range, noGreen.notes[0]?.includes('no earlier green run'), noCompare.range, noCompare.notes[0]?.includes('HTTP 422')], [null, true, null, true]);
  check('renderAttribution: no range warns, an empty range names the flake reading, a table names the lane', [
    renderAttribution(noGreen).includes('No commit range could be named'),
    renderAttribution({ ...attributed, commits: [], lanes: new Map() }).includes('flake'),
    renderAttribution(attributed).includes('`domain:spec`') && renderAttribution(attributed).includes('unattributed -- the title names no pull request'),
    renderAttribution(null).includes('no range to name'),
  ], [true, true, true, true]);

  battery('verdict: exit code mapping and annotations');
  check('a green compile with no rows is 0', verdict({ status: 0, rows: [], unknown: [] }), 0);
  check('a failed compile with no attributable row is 2, never a pass', verdict({ status: 2, rows: [], unknown: [] }), 2);
  check('a new diagnostic is 1 whatever else is known', verdict({ status: 1, rows: [knownRow, newRow], unknown: [newRow] }), 1);
  check('rows that are all registered retirements are 0 -- known, not red', verdict({ status: 1, rows: [knownRow], unknown: [] }), 0);
  const many = Array.from({ length: 12 }, (_, i) => ({ ...newRow, line: 300 + i }));
  check('annotations carry the objectui path in the title, never a file= the platform would re-home', (() => {
    const lines = annotationLines([newRow], sha);
    return [lines.length, lines[0].startsWith('::error title='), lines[0].includes('objectui packages/react/src/hooks/useViewData.ts%3A200'), lines[0].includes('file=')];
  })(), [1, true, true, false]);
  check('annotations stop at the platform cap and say how many more the summary holds', (() => {
    const lines = annotationLines(many, sha);
    return [lines.length, lines[ANNOTATION_CAP].includes('2 more new diagnostic(s)')];
  })(), [ANNOTATION_CAP + 1, true]);

  fs.rmSync(downstream, { recursive: true, force: true });

  for (const result of results) {
    process.stdout.write(`${result.ok ? 'ok  ' : 'FAIL'} ${result.name}\n`);
    if (!result.ok) {
      process.stdout.write(`      expected ${JSON.stringify(result.expected)}\n`);
      process.stdout.write(`      actual   ${JSON.stringify(result.actual)}\n`);
    }
  }
  let failed = results.filter((result) => !result.ok).length;

  // -- The floor, evaluated before the verdict.
  const floorFailure = (message) => {
    process.stderr.write(`x self-test floor: ${message}\n`);
    failed += 1;
  };
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} -- a battery deleted from the roster takes its own floor with it.`);
  }
  for (const [name, count] of batterySeen) {
    if (declared.includes(name)) continue;
    floorFailure(`battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES -- a case attributed to no declared battery is one nothing floors.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorFailure(
      count === 0
        ? `battery "${name}" DID NOT RUN -- 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned.`
        : `battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} -- cases that used to run no longer do; the battery is the bug, not the number.`,
    );
  }

  if (failed > 0) {
    process.stderr.write(`\nx spec-shape-gate --self-test: ${failed} failure(s) (cases and floor).\n`);
    return 1;
  }
  for (const name of declared) process.stdout.write(`  battery ${name}: ${batterySeen.get(name) ?? 0} case(s), floor ${SELF_TEST_BATTERIES[name]}\n`);
  process.stdout.write(`spec-shape-gate --self-test: ${results.length}/${results.length} passed across ${declared.length} batteries\n`);
  selfTestReachedVerdict = true;
  return 0;
}

/* ─────────────────────────── dispatch ─────────────────────────────────── */

function readFlag(argv, flag) {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

async function main(argv) {
  if (argv.includes('--self-test')) {
    const code = await selfTest();
    if (!selfTestReachedVerdict) {
      process.stderr.write(
        '\nx spec-shape-gate self-test: selfTest() returned without reaching its verdict, so no success line was printed. ' +
          'Exiting 0 here would report a self-test that never finished as a self-test that passed.\n',
      );
      return 1;
    }
    return code;
  }

  const mode = argv[0];
  const sha = readFlag(argv, '--sha');
  const downstream = readFlag(argv, '--downstream');

  if (mode === 'inject') {
    const tarball = readFlag(argv, '--tarball');
    const upstreamCheckout = readFlag(argv, '--upstream-checkout');
    if (!tarball || !sha || !upstreamCheckout || !downstream) {
      fail('usage: inject --tarball <f.tgz> --sha <sha> --upstream-checkout <objectstack checkout> --downstream <objectui checkout>');
    }
    const { substitutions } = inject({ tarball, sha, upstreamCheckout, downstream: path.resolve(downstream), log: (line) => process.stdout.write(`${line}\n`) });
    if (process.env.GITHUB_STEP_SUMMARY) {
      const lines = substitutions.length > 0 ? substitutions.map((line) => `- ${line}`) : ["- no dependency substitution: every declared dependency's store sibling satisfies its range."];
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Spec Shape Gate -- injection\n\n${lines.join('\n')}\n\n`);
    }
    return 0;
  }

  if (mode === 'report') {
    const logPath = readFlag(argv, '--log');
    const status = Number(readFlag(argv, '--status') ?? '2');
    if (!logPath || !sha || !downstream) fail('usage: report --log <f> --sha <sha> --status <n> --downstream <objectui checkout> [--downstream-sha <sha>] [--event <name>] [--registry <file>]');
    if (!fs.existsSync(logPath)) {
      fail(`the captured typecheck log ${logPath} does not exist. With no log there is no reading, and an absent reading is never a pass.`);
    }
    if (!fs.existsSync(path.join(downstream, 'pnpm-workspace.yaml'))) {
      fail(`--downstream ${downstream} holds no pnpm-workspace.yaml, so no diagnostic can be attributed to a workspace directory.`);
    }
    return report({
      logPath,
      sha,
      downstreamSha: readFlag(argv, '--downstream-sha') ?? null,
      status,
      commit: readFlag(argv, '--commit') ?? null,
      event: readFlag(argv, '--event') ?? process.env.GITHUB_EVENT_NAME ?? null,
      downstream: path.resolve(downstream),
      registryPath: readFlag(argv, '--registry') ?? REGISTRY_FILE,
    });
  }

  fail(`unknown mode ${JSON.stringify(mode ?? '')}. Modes: inject, report, --self-test.`);
  return 2;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
