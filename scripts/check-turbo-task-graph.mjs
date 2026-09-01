#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-turbo-task-graph -- a per-package task override in `turbo.json` must
 * name a package the workspace HAS and a script that package RUNS.
 *
 *   node scripts/check-turbo-task-graph.mjs              # judge the checked-in turbo.json
 *   node scripts/check-turbo-task-graph.mjs --self-test  # prove the rule can go red
 *
 * ## The defect this exists for (#12046)
 *
 * `turbo.json` is the build-and-test task graph for the whole monorepo, and
 * before this gate NOTHING in the repo judged it structurally except one narrow
 * limb: `check:cross-package-test-inputs`' Layer B, which asks only whether
 * `<pkg>#test` exists and carries the globs for the packages listed in
 * `scripts/cross-package-test-inputs.mjs`. Any other task -- `#typecheck`,
 * `#build`, a package the table does not name -- was read by no gate at all.
 *
 * That would be tolerable if turbo refused a wrong entry. It does not. Measured
 * on turbo 2.10.10, on a three-file fixture workspace, each case run to a real
 * `turbo run <task> --dry=json`:
 *
 *   task key names a package that does not exist
 *       `@fx/nope#build` beside a real `@fx/a`
 *       -> EXIT 0, no error, no warning, key absent from the graph entirely.
 *
 *   task key names a real package with no such script
 *       `@fx/a#typecheck` where `@fx/a` declares only `build`
 *       -> EXIT 0, task appears in the dry-run graph, and nothing ever runs it.
 *
 *   `dependsOn` names a task that resolves nowhere
 *       `"dependsOn": ["^build", "prebuildxyz"]`
 *       -> EXIT 1, `x Could not find "@fx/a#prebuildxyz" in root turbo.json or
 *          "prebuildxyz"`.
 *
 * So the first two are SILENT and the third is LOUD, which is exactly the split
 * this gate is drawn along: it judges the two turbo will not, and does not
 * restate the one turbo already refuses. A gate that re-checked `dependsOn`
 * would be claiming a population turbo polices better, which is the failure
 * #12046 is filed against, one level up.
 *
 * What a silent entry costs is intent, not a red build. An author adds
 * `@objectstack/plugin-auth#typecheck` to give one package's typecheck a
 * self-`build` dependency; misspell the package or the script and the override
 * is not applied, the task silently falls back to the generic definition, and
 * every signal an author has -- exit code, dry-run output, CI -- says the edit
 * worked. The same silence covers the stale direction: rename a package or drop
 * a script and the entry that used to configure it configures nothing, forever.
 *
 * ## Why this gate declares `turbo.json/**` (#12046's other half)
 *
 * The card is a coverage finding in TWO directions, and the substantive one
 * above closes only the first. The second: `scripts/pm/dispatch-gates.mjs`
 * derives a card's gate list from the path literals each gate's own source
 * names, and `extractWatchHints` refuses a literal with no path separator as
 * too generic. Measured: `extractWatchHints("const X = 'turbo.json';")` is `[]`
 * and so is `'./turbo.json'`, while `'turbo.json/**'` yields that hint and
 * `hintCovers('turbo.json/**', 'turbo.json')` is true.
 *
 * `check-cross-package-test-inputs.mjs` reaches this file as
 * `join(REPO_ROOT, 'turbo.json')` -- a bare filename -- so it reads turbo.json
 * while naming nothing that can match it, and a card whose surface is
 * `turbo.json` derived ZERO families on 1f6b8bb193, verbatim: "No check family
 * names the given paths in its own source, and no workflow's path filter
 * schedules one for them."
 *
 * So the declaration below is not decoration and it is not a "watched path"
 * bolted onto a gate that does not read the file (the shape #12046 pre-rejects,
 * and the bare-root ratchet exists to prevent). It is the subtree spelling of a
 * repo-root file this gate opens wholesale, which is the escape
 * `check:pm-governed-prose`, `check:required-contexts` and five others already
 * take for `AGENTS.md/**`. After it, a turbo.json edit derives this family.
 *
 * ## GENERIC task keys, and the near miss that reads as a refutation (#12373)
 *
 * GENERIC keys -- the ones with no `#`, like `build` or `test:smoke` -- are in
 * population as of #12373, under the same invariant one level up: a generic key
 * no workspace package declares a script for configures a task that can never
 * run. Turbo is silent about it in the same way, and the silence is worse here
 * because it reaches a human directly: the root `package.json` wraps these keys
 * as `turbo run <task>`, so an inert one is a command that exits 0 having run
 * nothing, handed around as evidence a suite passed (#4690's family).
 *
 * That is not hypothetical, it is the entry this limb was written for. Measured
 * from git: `test:e2e` entered turbo.json on 2026-05-21 (7972e7b829) when
 * `examples/app-crm` declared `"test:e2e": "playwright test"` beside an `e2e/`
 * directory and a `playwright.config.ts`. On 2026-05-24, `e737fbce39`
 * ("simplify app-crm to minimal metadata smoke-test") deleted that script. The
 * turbo entry stayed, and for the three months to 2026-08-26 it configured a
 * task no package could run, while `pnpm test:e2e` kept exiting 0.
 *
 * ⚠️ The ROOT manifest is not a workspace member and does not make a generic key
 * live -- and counting it is the mistake that reads as a refutation of the
 * finding rather than as a different measurement. `test:e2e` was held by ONE
 * file (the root `package.json`) and by ZERO of the 78 members, and only the
 * second number decides whether `turbo run test:e2e` matches anything. The
 * failure text below says so where it will be read.
 *
 * A generic key that exists only as a `dependsOn` target is judged the same, on
 * purpose. Measured on the tree this limb landed against: the only `dependsOn`
 * targets in the whole file are `build` and `^build`, and `build` is declared by
 * 72 of the 78 members -- so no such key exists here to exempt. Nor should one
 * be exempt if it appears: turbo resolves `dependsOn` against the DEFINITION, so
 * a dependency on a generic task no package declares still runs nothing, and the
 * exemption would be a hole shaped exactly like the entry above.
 *
 * ## `//#<task>` -- turbo's ROOT-manifest spelling, which is NOT a missing package
 *
 * `//` is turbo's reserved token for the repo root, so `//#<task>` binds the
 * ROOT package.json's own script. It is a working spelling, and before this arm
 * existed the gate refused it as an unknown package -- telling the author to
 * "delete the entry" about configuration that was doing its job.
 *
 * Measured on turbo 2.10.12 (what `^2.10.10` resolves to), on the same kind of
 * fixture workspace as above, each case driven as a real run as well as a
 * `--dry=json`:
 *
 *   `//#lint` where the ROOT manifest declares `lint`
 *       -> EXIT 0, `//#lint` IS in the graph, `package: "//"`, carrying the root
 *          script as its real command with the turbo.json override resolved onto
 *          it (`cache: false`). A real `turbo run lint` prints that script's own
 *          output and reports `1 successful, 1 total`.
 *
 *   `//#nope` where the ROOT manifest declares no `nope`
 *       -> EXIT 0, `//#nope` IS in the graph, and a real `turbo run nope` reports
 *          `No tasks were executed as part of this run`, `0 total`.
 *
 * So the root token needs BOTH directions, and it is judged against the root
 * manifest's scripts exactly as a member key is judged against its own: a script
 * that exists makes the entry legitimate, and one that does not leaves the same
 * inert entry the second arm above is written for.
 *
 * The two defects are one defect. The unknown-package arm's sentence "the
 * override never reaches the task graph" is measured TRUE for a package that
 * does not exist (`@fx/nope#build`: absent from the graph entirely) and measured
 * FALSE only for `//` -- so the false sentence is reachable through no input but
 * this one, and correcting it and correcting the verdict are the same edit. That
 * is also why the shared sentence is left alone: hedging it would trade an
 * accurate diagnosis on every member key for a vaguer one, in order to describe
 * a case that no longer reaches that arm.
 *
 * WARNING: this does NOT make the root manifest a workspace member. `holdersOf`
 * and the generic limb still enumerate members only -- a generic key held solely
 * by the root package.json is still inert and still a finding, which is the whole
 * of #12373's measurement. `--self-test` drives that case with `test:e2e` present
 * in the root script set, so folding the root into `holdersOf` fails it. The root
 * manifest is addressable ONLY under the explicit `//` token, which the
 * enumerator can never produce.
 *
 * ## Refusals, never quiet passes (#4690)
 *
 * An unreadable or non-JSON turbo.json, a missing `tasks` table, a workspace
 * that enumerates to zero packages, and a `tasks` table with zero package-scoped
 * keys are all exit 1 naming what could not be read. The last one is the
 * non-vacuity floor and it is safe to assert: Layer B of
 * `check:cross-package-test-inputs` REQUIRES one `<pkg>#test` key per declared
 * cross-package package, so a turbo.json with no package-scoped key at all means
 * this gate read nothing -- never that it found nothing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { workspacePackages, WorkspaceEnumerationError } from './workspace-enumerator.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * The repo-root files this gate opens, in the SUBTREE spelling the dispatch
 * derivation can match. See the header for why a bare filename cannot be a
 * watch hint and why this is the escape rather than a fabricated declaration.
 * `--self-test` pins the exact strings: a reword back to `'turbo.json'` would
 * cost the derivation silently, and this gate's whole second purpose with it.
 *
 * `package.json/**` names the ROOT manifest and only it -- measured:
 * `hintCovers('package.json/**', 'packages/spec/package.json')` is false. The
 * MEMBER manifests are declared separately, in `DECLARED_WATCH_HINTS` below;
 * this hint is here because the `//#` arm opens the root manifest DIRECTLY,
 * from this file, and a bare `'package.json'` literal builds no hint at all --
 * the same trap documented above for turbo.json.
 */
export const ROOT_FILE_WATCH_HINTS = ['turbo.json/**', 'package.json/**'];

/**
 * The MEMBER manifests this gate opens, one per workspace package, as patterns.
 *
 * ## Why they used to be undeclared, and why that reading was wrong
 *
 * This block used to say the member manifests "stay undeclared on purpose (the
 * enumerator owns them and declares none)". The enumerator really does declare
 * none -- but its header states WHY, and the reason is the opposite of a
 * licence for its callers to declare nothing:
 *
 *   "each gate keeps declaring its OWN population in its OWN module body [...]
 *    What is consolidated here is the PARSE, never the DECLARATION."
 *
 * The refusal there is priced against the SUBTREE claim: a `'packages/*'`-shaped
 * literal in the enumerator would hand the whole workspace population -- ~5400
 * files -- to all nine callers at once, measured at +41725 (gate, file) pairs.
 * That argument is about the enumerator and about subtrees. It says nothing
 * against the narrow claim this gate can make from its own side, which is the
 * manifests and only the manifests: 79 files on this tree, every one of which
 * `readWorkspaceScripts` really opens and reads a `scripts` table out of.
 *
 * The cost of leaving them undeclared was the ordinary one: a card adding or
 * renaming a script in `packages/<pkg>/package.json` -- the change that makes a
 * `<package>#<task>` key inert, which is precisely what this gate judges --
 * derived no lead to this gate at all.
 *
 * ## Why three patterns and not eleven
 *
 * `pnpm-workspace.yaml` lists eleven member globs, nine of them under
 * `packages/`. `packages/**` + one glob for each of the two roots outside it
 * covers every member manifest and nothing else; `--self-test` holds that
 * against the enumerator's live answer in BOTH directions, so a twelfth glob in
 * the workspace file reds here rather than going quiet.
 */
export const DECLARED_WATCH_HINTS = [
  'packages/**/package.json',
  'apps/*/package.json',
  'examples/*/package.json',
];

/** The file this gate judges, as the reader spells it on disk. */
const TURBO_CONFIG_FILE = 'turbo.json';

/** The root manifest, whose scripts a `//#<task>` key is judged against. */
const ROOT_MANIFEST_FILE = 'package.json';

/**
 * Turbo's reserved token for the repo root inside a package-task key. It is not
 * a package name and the workspace enumerator can never produce it, which is
 * exactly why a plain membership lookup reports it as a missing package instead
 * of as the root.
 */
export const ROOT_PACKAGE_TOKEN = '//';

/** Thrown for conditions that must fail the gate rather than shrink its coverage. */
export class TaskGraphReadError extends Error {}

/**
 * Split a `tasks` key into `{ pkg, task }`, or `null` for a generic key.
 *
 * Turbo's package-task spelling is `<package>#<task>`. A package name may carry
 * a `/` (every scoped one does) and a task name may carry a `:` (`gen:schema`),
 * so neither separator can be used to find the boundary -- only `#` can, and it
 * is taken at its FIRST occurrence because a package name cannot contain one.
 * A second `#` therefore lands inside the task name, where it simply fails to
 * match any script and is reported by the ordinary rule rather than by a
 * special case this gate would then have to keep true.
 *
 * @param {string} key
 * @returns {{ pkg: string, task: string } | null}
 */
export function splitTaskKey(key) {
  const hash = key.indexOf('#');
  if (hash < 0) return null;
  return { pkg: key.slice(0, hash), task: key.slice(hash + 1) };
}

/**
 * Names close enough to `name` to be worth printing beside a miss, by edit
 * distance over the WHOLE name -- scope half included, because that is where
 * this repo's plausible misspellings live (`@objectstack/plugins-auth` for
 * `@objectstack/plugin-auth`) just as often as the tail is.
 *
 * The distance is capped at 2 and the matrix is bounded by the shorter name, so
 * this stays cheap over the ~80 names it is asked about at most a few times per
 * run. A suggestion is a courtesy, never part of the verdict: a miss with no
 * near name is still the same finding.
 *
 * @param {string} name
 * @param {Iterable<string>} known
 * @returns {string[]}
 */
export function nearestNames(name, known) {
  const hits = [];
  for (const candidate of known) {
    if (candidate === name) continue;
    if (editDistanceWithin(name, candidate, 2)) hits.push(candidate);
  }
  return hits.sort().slice(0, 3);
}

/**
 * `true` when `a` and `b` are at most `max` single-character edits apart.
 * Lengths differing by more than `max` are refused before any work.
 *
 * @param {string} a
 * @param {string} b
 * @param {number} max
 * @returns {boolean}
 */
export function editDistanceWithin(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return false;
    prev = row;
  }
  return prev[b.length] <= max;
}

/**
 * Every workspace package declaring a script called `task`, sorted.
 *
 * This is the whole of what a GENERIC key is judged against, and the membership
 * it reads is the enumerator's -- so the root manifest, which is not a member,
 * cannot make a key look held. See the header for why that distinction is the
 * one this limb is most likely to be argued out of.
 *
 * @param {string} task
 * @param {Map<string, Set<string>>} scriptsByPackage
 * @returns {string[]}
 */
export function holdersOf(task, scriptsByPackage) {
  const holders = [];
  for (const [pkg, scripts] of scriptsByPackage) if (scripts.has(task)) holders.push(pkg);
  return holders.sort();
}

/**
 * The rule, as a pure function over already-parsed inputs, so `--self-test` can
 * drive it with the adversarial task tables a clean tree does not contain.
 *
 * The populations are counted separately and ALL are returned: a limb that
 * quietly stops matching reports zero findings exactly like a limb that found
 * nothing wrong, so `main()` needs each count to assert it read something.
 *
 * WARNING: `rootJudged` is the exception and is returned for `--self-test` to
 * read, NOT for a non-vacuity refusal in `main()`. A clean tree carries no `//#`
 * key at all, so zero root tasks is the NORMAL state here rather than evidence
 * of a limb that stopped matching -- completing the symmetry with the two counts
 * above would fail this repo's turbo.json today, on every PR.
 *
 * @param {Record<string, unknown>} tasks turbo.json's `tasks` table
 * @param {Map<string, Set<string>>} scriptsByPackage package name -> script names
 * @param {Set<string>} rootScripts the ROOT manifest's script names, for `//#<task>`
 * @returns {{ problems: string[], judged: number, genericJudged: number, rootJudged: number }}
 */
export function verdict(tasks, scriptsByPackage, rootScripts) {
  const problems = [];
  let judged = 0;
  let genericJudged = 0;
  let rootJudged = 0;
  for (const key of Object.keys(tasks)) {
    const split = splitTaskKey(key);
    if (!split) {
      genericJudged += 1;
      if (holdersOf(key, scriptsByPackage).length === 0) {
        const declaredAnywhere = new Set();
        for (const scripts of scriptsByPackage.values()) for (const name of scripts) declaredAnywhere.add(name);
        const near = nearestNames(key, declaredAnywhere);
        problems.push(
          `"${key}" is a generic task that NO workspace package declares a script for.\n` +
            `    Turbo is silent about this too: a run matches nothing and exits 0, so the root\n` +
            `    script that wraps it ("turbo run ${key}") is a command handed around as evidence\n` +
            `    a suite passed while running nothing at all.\n` +
            `    ⚠️ The ROOT package.json does NOT count and is the near miss that reads as a\n` +
            `    refutation: it is not one of the ${scriptsByPackage.size} workspace members this gate\n` +
            `    enumerates, so a script there leaves the key held by zero of them and just as inert.\n` +
            (near.length ? `    Did you mean: ${near.join(', ')}?\n` : '') +
            `    Rename the key to the script the workspace declares, add that script to the\n` +
            `    package that should run it, or delete the entry.`,
        );
      }
      continue;
    }
    judged += 1;
    const { pkg, task } = split;
    // The ROOT token, before any membership lookup: `//` is not a package name,
    // so `scriptsByPackage.get('//')` is always a miss and the arm below would
    // report turbo's own root spelling as a package that does not exist. Ablating
    // this block restores exactly that — a named self-test failure, not a crash.
    if (pkg === ROOT_PACKAGE_TOKEN) {
      rootJudged += 1;
      if (!rootScripts.has(task)) {
        const near = nearestNames(task, rootScripts);
        problems.push(
          `"${key}" configures the task "${task}" on the repo ROOT manifest, which declares\n` +
            `    no script by that name.\n` +
            `    Turbo accepts this SILENTLY — measured on 2.10.12: exit 0, the task IS placed in\n` +
            `    the graph as "${key}", and a real run reports "No tasks were executed as part of\n` +
            `    this run". The entry is inert.\n` +
            `    ⚠️ "${ROOT_PACKAGE_TOKEN}" is turbo's reserved token for the root ${ROOT_MANIFEST_FILE} — NOT a missing\n` +
            `    package, and NOT a workspace member. It is judged against the root manifest's\n` +
            `    own scripts, and a root script that DOES exist makes "${ROOT_PACKAGE_TOKEN}#<task>" a legitimate\n` +
            `    entry that turbo puts in the graph and runs for real.\n` +
            (near.length ? `    Did you mean: ${near.join(', ')}?\n` : '') +
            `    Fix the task name, add the script to the root ${ROOT_MANIFEST_FILE}, or delete the entry.`,
        );
      }
      continue;
    }
    const scripts = scriptsByPackage.get(pkg);
    if (!scripts) {
      const near = nearestNames(pkg, scriptsByPackage.keys());
      problems.push(
        `"${key}" names the package "${pkg}", which is not in this pnpm workspace.\n` +
          `    Turbo accepts the key SILENTLY — measured on 2.10.10: exit 0, no diagnostic,\n` +
          `    and the override never reaches the task graph. Everything this entry was\n` +
          `    written to configure is unconfigured.\n` +
          (near.length
            ? `    Did you mean: ${near.join(', ')}?\n`
            : '') +
          `    Fix the name, or delete the entry if the package is gone.`,
      );
      continue;
    }
    // `scripts &&` keeps the two arms INDEPENDENT rather than relying on the
    // `continue` above. With the coupling, ablating the first arm makes this one
    // read `undefined.has(...)` and the self-test dies with a TypeError instead of
    // reporting a named failing case — the #12273 shape, where a mutation aborts the
    // suite and the instrument stops being readable exactly when it is being read.
    if (scripts && !scripts.has(task)) {
      const alternatives = [...scripts].sort();
      problems.push(
        `"${key}" configures the task "${task}", which "${pkg}" declares no script for.\n` +
          `    Turbo accepts this SILENTLY too — measured on 2.10.10: exit 0, the task is\n` +
          `    placed in the dry-run graph, and nothing ever runs it. The entry is inert.\n` +
          `    "${pkg}" declares: ${alternatives.length ? alternatives.join(', ') : '(no scripts at all)'}\n` +
          `    Fix the task name, add the script, or delete the entry.`,
      );
    }
  }
  return { problems, judged, genericJudged, rootJudged };
}

/**
 * package name -> its declared script names, from the workspace's own
 * declaration of what it contains.
 *
 * Membership comes from `scripts/workspace-enumerator.mjs` (#11510), this
 * repo's one parse of `pnpm-workspace.yaml`. Importing it gives this gate NO
 * path population — the enumerator declares none, deliberately — so the single
 * hint above stays the whole of what this file names.
 *
 * @param {string} root
 * @returns {Map<string, Set<string>>}
 */
export function readWorkspaceScripts(root) {
  let members;
  try {
    members = workspacePackages(root);
  } catch (err) {
    if (err instanceof WorkspaceEnumerationError) throw new TaskGraphReadError(err.message);
    throw err;
  }
  const byName = new Map();
  for (const { manifest } of members) {
    if (typeof manifest.name !== 'string' || !manifest.name) continue;
    const scripts = manifest.scripts && typeof manifest.scripts === 'object' ? Object.keys(manifest.scripts) : [];
    byName.set(manifest.name, new Set(scripts));
  }
  if (byName.size === 0) {
    throw new TaskGraphReadError(
      `${root}: the workspace enumerated to zero named packages — nothing to judge task keys against.`,
    );
  }
  return byName;
}

/**
 * The ROOT manifest's declared script names.
 *
 * Read directly rather than through the enumerator, because the root is NOT a
 * workspace member -- that non-membership is load-bearing for the generic limb
 * (#12373) and must not be softened by folding the root into the member map.
 * Keeping it a separate value is precisely what lets `//#<task>` be judged while
 * `holdersOf` stays members-only.
 *
 * A root manifest that reads as zero scripts refuses, on the same ground as the
 * zero-members refusal above: this repo's root declares well over a hundred, so
 * zero means the file was not read, never that it was read and found empty --
 * and a silently empty set would flag every legitimate `//#` key at once.
 *
 * @param {string} root
 * @returns {Set<string>}
 */
export function readRootScripts(root) {
  const path = join(root, ROOT_MANIFEST_FILE);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new TaskGraphReadError(`cannot read the root ${ROOT_MANIFEST_FILE}: ${err.message}`);
  }
  return rootScriptNames(parsed);
}

/**
 * The script names of an already-parsed root manifest, or a refusal.
 *
 * Split from the read for the same reason `verdict` is a pure function: the
 * refusal below is a branch a clean tree can never reach, so `--self-test` has
 * to be able to drive it without a filesystem fixture whose own contents would
 * then decide whether the pin holds.
 *
 * @param {unknown} manifest
 * @returns {Set<string>}
 */
export function rootScriptNames(manifest) {
  const table = manifest?.scripts;
  const scripts = table && typeof table === 'object' && !Array.isArray(table) ? Object.keys(table) : [];
  if (scripts.length === 0) {
    throw new TaskGraphReadError(
      `the root ${ROOT_MANIFEST_FILE} declares no scripts — a "${ROOT_PACKAGE_TOKEN}#<task>" key is judged against\n` +
        `exactly that table, so an empty one is a file this gate could not read, never a root\n` +
        `manifest with nothing to run. Every such key would otherwise be reported inert at once.`,
    );
  }
  return new Set(scripts);
}

/**
 * turbo.json's `tasks` table.
 *
 * @param {string} root
 * @returns {Record<string, unknown>}
 */
export function readTasks(root) {
  const path = join(root, TURBO_CONFIG_FILE);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new TaskGraphReadError(`cannot read ${TURBO_CONFIG_FILE}: ${err.message}`);
  }
  const tasks = parsed?.tasks;
  if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) {
    throw new TaskGraphReadError(
      `${TURBO_CONFIG_FILE} has no \`tasks\` object — this gate's whole population is that table, so an\n` +
        `absent one is a file this gate could not read, never a file with nothing wrong in it.`,
    );
  }
  return tasks;
}

function main() {
  let tasks;
  let scriptsByPackage;
  let rootScripts;
  try {
    tasks = readTasks(ROOT);
    scriptsByPackage = readWorkspaceScripts(ROOT);
    rootScripts = readRootScripts(ROOT);
  } catch (err) {
    if (err instanceof TaskGraphReadError) {
      console.error(`FAIL: check-turbo-task-graph could not read its input.\n  ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const { problems, judged, genericJudged, rootJudged } = verdict(tasks, scriptsByPackage, rootScripts);

  if (genericJudged === 0) {
    console.error(
      `FAIL: ${TURBO_CONFIG_FILE} declares no generic (\`#\`-less) task key at all, so half of\n` +
        `  this gate's population is empty. That is not a clean tree: the root package.json\n` +
        `  wraps \`build\`, \`test\` and \`typecheck\` as \`turbo run <task>\`, and each of those is a\n` +
        `  generic key in this table. Zero of them means this gate read the wrong file, or\n` +
        `  splitTaskKey stopped classifying a \`#\`-less key as generic — never that a table\n` +
        `  with nothing generic in it was found.`,
    );
    process.exit(1);
  }

  if (judged === 0) {
    console.error(
      `FAIL: ${TURBO_CONFIG_FILE} declares no \`<pkg>#<task>\` key at all, so this gate judged nothing.\n` +
        `  That is not a clean tree. Layer B of check:cross-package-test-inputs REQUIRES one\n` +
        `  \`<pkg>#test\` key per package declared in scripts/cross-package-test-inputs.mjs, so\n` +
        `  zero package-scoped keys means this gate read the wrong file or the table changed shape.`,
    );
    process.exit(1);
  }

  if (problems.length) {
    console.error(
      `FAIL: ${TURBO_CONFIG_FILE} carries ${problems.length} inert task entr${problems.length === 1 ? 'y' : 'ies'}.\n`,
    );
    for (const p of problems) console.error(`  - ${p}\n`);
    console.error(
      'Why this gate exists: turbo does NOT refuse any of these. A task key naming a\n' +
        'package that does not exist, a task the package has no script for, or a generic key\n' +
        'no package declares at all, exits 0 with no diagnostic and configures nothing — so\n' +
        'the edit that was meant to change what CI builds, orders or caches reads as landed\n' +
        'while doing nothing at all (#12046), and a root script wrapping the generic key\n' +
        'reads as a suite that passed (#12373).\n' +
        '\n' +
        '⛔ `dependsOn` is deliberately NOT checked here: turbo already refuses an\n' +
        'unresolvable one, loudly, with exit 1. Re-checking it would be this gate claiming a\n' +
        'population it does not police better than the tool that owns it.',
    );
    process.exit(1);
  }

  console.log(
    `OK: ${judged} package-scoped and ${genericJudged} generic turbo task(s) judged against ` +
      `${scriptsByPackage.size} workspace package(s)` +
      (rootJudged
        ? `, ${rootJudged} of them on the root manifest's ${rootScripts.size} script(s)`
        : '') +
      ` — every package-scoped one names a package that exists (or the root token ` +
      `"${ROOT_PACKAGE_TOKEN}") and a script it declares, and every generic one is declared by at ` +
      `least one member.`,
  );
}

/**
 * The instrument for a gate whose defect class is its MATCHING RULE: a clean
 * tree cannot tell a working rule from one that stopped matching, because both
 * print zero findings (#11150). These cases supply the inputs the tree does not
 * contain, in both directions.
 *
 * @returns {string[]} failure descriptions; empty means OK
 */
export function selfTest() {
  const failures = [];
  const t = (label, ok) => {
    if (!ok) failures.push(label);
  };

  const workspace = new Map([
    ['@objectstack/plugin-auth', new Set(['build', 'test', 'typecheck'])],
    ['@objectstack/spec', new Set(['build', 'test', 'gen:schema'])],
    ['create-objectstack', new Set(['build', 'test'])],
  ]);

  // The ROOT manifest's scripts, which are NOT the workspace's. `test:e2e` is in
  // here deliberately: it is the exact entry #12373 was written for — held by the
  // root package.json and by ZERO members — so the generic case below fails the
  // moment anyone folds these into `holdersOf`.
  const rootScripts = new Set(['lint', 'test:e2e', 'dev']);

  // ── Direction 1: the rule must go RED on each silent shape turbo accepts ──
  const unknownPkg = verdict({ '@objectstack/plugins-auth#typecheck': {} }, workspace, rootScripts);
  t('an unknown package in a task key is a finding', unknownPkg.problems.length === 1);
  t('the unknown-package finding is counted as judged', unknownPkg.judged === 1);
  t(
    'the unknown-package finding suggests the near miss',
    unknownPkg.problems[0]?.includes('@objectstack/plugin-auth'),
  );

  const missingScript = verdict({ '@objectstack/spec#typecheck': {} }, workspace, rootScripts);
  t('a task the package has no script for is a finding', missingScript.problems.length === 1);
  t(
    'the missing-script finding prints what the package DOES declare',
    missingScript.problems[0]?.includes('gen:schema'),
  );

  // The suggestion arm, both directions: it must reach a near name and must
  // NOT invent one for a name that is nothing like any package here.
  t('a one-edit distance is within 2', editDistanceWithin('@objectstack/plugin-auth', '@objectstack/plugins-auth', 2));
  t('a far name is refused', !editDistanceWithin('@objectstack/spec', '@objectstack/plugin-auth', 2));
  t('a length gap wider than the cap is refused before any work', !editDistanceWithin('a', 'abcd', 2));
  t('no near name yields no suggestion', nearestNames('@acme/nothing-like-it', workspace.keys()).length === 0);

  // ── The generic limb (#12373), both directions ──
  // The red case is the entry this limb was written for, spelled as it stood on
  // 2026-08-26: a key every signal calls fine, held by nobody who could run it.
  const inertGeneric = verdict({ 'test:e2e': {} }, workspace, rootScripts);
  t('a generic task no package declares is a finding', inertGeneric.problems.length === 1);
  t('the inert generic key is counted in the generic population', inertGeneric.genericJudged === 1);
  t('the inert generic key is NOT counted as a package task', inertGeneric.judged === 0);
  // The root manifest DECLARES `test:e2e` in the fixture above, and the key is
  // still a finding — the members are the whole population of the generic limb.
  t('a generic key held ONLY by the root manifest is still a finding', inertGeneric.problems.length === 1);
  t('a generic key is never counted in the root population', inertGeneric.rootJudged === 0);
  // Pinned as text because this sentence is the whole defence of the measurement:
  // the root manifest holds `test:e2e` and is not a member, and a reader who
  // counts files instead of members reads the finding as already refuted.
  t(
    'the inert generic finding rules out the root manifest by name',
    inertGeneric.problems[0]?.includes('ROOT package.json does NOT count'),
  );
  const nearGeneric = verdict({ typechek: {} }, workspace, rootScripts);
  t('a misspelled generic key is a finding', nearGeneric.problems.length === 1);
  t('a misspelled generic key suggests the script that exists', nearGeneric.problems[0]?.includes('typecheck'));

  t(
    'holdersOf names every package declaring the script',
    holdersOf('build', workspace).join(',') === '@objectstack/plugin-auth,@objectstack/spec,create-objectstack',
  );
  t('holdersOf is empty for a script no package declares', holdersOf('test:e2e', workspace).length === 0);

  // ── The ROOT token `//` (#12465), both directions ──
  // Measured on turbo 2.10.12: `//#lint` lands in the graph bound to the ROOT
  // manifest's script and RUNS (1 successful), while `//#nope` lands in the graph
  // and runs nothing. Before this arm both were reported as a package that does
  // not exist, over a sentence a dry run contradicts.
  const rootLive = verdict({ '//#lint': {} }, workspace, rootScripts);
  t('a root task whose script the root manifest declares is GREEN', rootLive.problems.length === 0);
  t('a root task counts as a package-scoped key', rootLive.judged === 1);
  t('a root task is NOT counted as a generic key', rootLive.genericJudged === 0);
  t('a root task is counted in the root population', rootLive.rootJudged === 1);

  const rootInert = verdict({ '//#nope': {} }, workspace, rootScripts);
  t('a root task the root manifest declares no script for is a finding', rootInert.problems.length === 1);
  t('the inert root task is counted in the root population', rootInert.rootJudged === 1);
  // The DIAGNOSIS is pinned as text, not just the count: this input was already
  // reported before the fix, and a pin on `problems.length` alone passes just as
  // well with the false sentence put back.
  t(
    'the inert root finding names the root manifest',
    rootInert.problems[0]?.includes('repo ROOT manifest'),
  );
  t(
    'the inert root finding does NOT call the root token a missing package',
    !rootInert.problems[0]?.includes('is not in this pnpm workspace'),
  );
  t(
    'the inert root finding drops the sentence a dry run contradicts',
    !rootInert.problems[0]?.includes('never reaches the task graph'),
  );
  t(
    'the inert root finding states what a real run DOES report',
    rootInert.problems[0]?.includes('No tasks were executed'),
  );
  t(
    'the inert root finding suggests a near ROOT script',
    verdict({ '//#lnt': {} }, workspace, rootScripts).problems[0]?.includes('Did you mean: lint?'),
  );
  // The member arms must not have been widened to accept `//`-ish names: only the
  // exact token is the root, and anything else is still an unknown package.
  const notRoot = verdict({ '///#build': {} }, workspace, rootScripts);
  t('a near-miss of the root token is still an unknown package', notRoot.problems.length === 1);
  t('a near-miss of the root token is not in the root population', notRoot.rootJudged === 0);

  // ── Direction 2: the rule must stay GREEN on every legitimate shape ──
  // `gen:schema` stands where `test:e2e` used to: a generic key held by exactly
  // ONE package is legitimate, and this case is what keeps the limb above from
  // being satisfiable by "generic keys must be held by many".
  const clean = verdict(
    {
      build: {},
      'gen:schema': {},
      '@objectstack/plugin-auth#typecheck': {},
      '@objectstack/spec#gen:schema': {},
      'create-objectstack#test': {},
    },
    workspace,
    rootScripts,
  );
  t('legitimate package tasks are green', clean.problems.length === 0);
  t('package-scoped keys are counted separately', clean.judged === 3);
  t('generic keys are in population and counted', clean.genericJudged === 2);

  // Parsing, pinned directly: every real key in this repo's turbo.json is one
  // of these three shapes, and a boundary taken anywhere but the FIRST `#`
  // breaks a different one of them.
  t('a scoped name keeps its slash', splitTaskKey('@objectstack/spec#test')?.pkg === '@objectstack/spec');
  t('a colon in the task name survives', splitTaskKey('@objectstack/spec#gen:schema')?.task === 'gen:schema');
  t('an unscoped name parses', splitTaskKey('create-objectstack#test')?.pkg === 'create-objectstack');
  t('a generic key is not a package task', splitTaskKey('test:e2e') === null);

  // ── The derivation half of #12046, pinned as bytes ──
  // A reword of the hint back to a bare filename is invisible in every other
  // signal this gate emits: production stays green, CI stays green, and the
  // only thing lost is that a turbo.json card can name this gate at all.
  t(
    'the root files are declared in the SUBTREE spelling',
    ROOT_FILE_WATCH_HINTS.join(',') === 'turbo.json/**,package.json/**',
  );
  t(
    'the declaration names exactly the two root files this gate opens',
    ROOT_FILE_WATCH_HINTS.map((h) => h.replace(/\/\*+$/, '')).join(',') ===
      `${TURBO_CONFIG_FILE},${ROOT_MANIFEST_FILE}`,
  );

  // ── The MEMBER manifests, held against the enumerator's live answer ──
  //
  // Both directions, because either alone is satisfied by the defect this
  // declaration repairs. A pattern that covers nothing is a fabricated lead
  // pasted into every card it happens to brush; a member manifest no pattern
  // covers is the undeclared read the gate shipped with. Stated over
  // `workspacePackages(ROOT)` -- the same call `readWorkspaceScripts` makes --
  // so a twelfth glob in `pnpm-workspace.yaml` reds HERE, in the gate that
  // opens the file, rather than going quiet in a dispatch brief.
  //
  // The matcher is local and deliberately narrower than `hintCovers`: `*` stops
  // at a separator, `**` crosses them, and nothing else is special. It can only
  // refuse MORE than the real covering rule, so it fails loudly for a pattern
  // the derivation would have accepted and never passes one it would refuse.
  const patternMatches = (pattern, path) => {
    const rx = pattern
      .split('/')
      .map((seg) => (seg === '**' ? ' ' : seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')))
      .join('/')
      .replace(/ \//g, '(?:[^/]+/)*')
      .replace(/\/? /g, '(?:/.*)?');
    return new RegExp(`^${rx}$`).test(path);
  };
  const memberManifests = workspacePackages(ROOT).map((p) => `${p.dir}/${ROOT_MANIFEST_FILE}`);
  t(
    `the enumerator finds member manifests to declare (${memberManifests.length})`,
    memberManifests.length > 0,
  );
  const undeclaredManifests = memberManifests.filter(
    (m) => !DECLARED_WATCH_HINTS.some((h) => patternMatches(h, m)),
  );
  t(
    `every member manifest this gate opens is covered by a declared pattern (uncovered: ${undeclaredManifests.join(', ') || 'none'})`,
    undeclaredManifests.length === 0,
  );
  const emptyPatterns = DECLARED_WATCH_HINTS.filter(
    (h) => !memberManifests.some((m) => patternMatches(h, m)),
  );
  t(
    `and no declared pattern covers zero of them (empty: ${emptyPatterns.join(', ') || 'none'})`,
    emptyPatterns.length === 0,
  );
  // The matcher itself, pinned in both directions on this tree's own shapes --
  // a nested member, a top-level one, and the ROOT manifest, which must NOT be
  // swept up by the member patterns (it is `ROOT_FILE_WATCH_HINTS`' claim, and
  // a member pattern that also matched it would make the two declarations
  // disagree about who owns it).
  t(
    'the pattern matcher crosses separators for `**` and stops at them for `*`',
    patternMatches('packages/**/package.json', 'packages/plugins/knowledge-memory/package.json') &&
      patternMatches('packages/**/package.json', 'packages/spec/package.json') &&
      patternMatches('apps/*/package.json', 'apps/docs/package.json') &&
      !patternMatches('apps/*/package.json', 'apps/docs/nested/package.json'),
  );
  t(
    'and the member patterns do not claim the ROOT manifest',
    !DECLARED_WATCH_HINTS.some((h) => patternMatches(h, ROOT_MANIFEST_FILE)),
  );

  // ── Refusals must refuse (#4690) ──
  const refuses = (label, fn) => {
    try {
      fn();
      failures.push(`${label} — did not throw`);
    } catch (err) {
      if (!(err instanceof TaskGraphReadError)) failures.push(`${label} — threw ${err?.constructor?.name}`);
    }
  };
  refuses('a turbo.json that cannot be read refuses', () => readTasks(join(ROOT, 'scripts', 'no-such-dir-12046')));
  refuses('a root package.json that cannot be read refuses', () =>
    readRootScripts(join(ROOT, 'scripts', 'no-such-dir-12465')),
  );
  // The zero-scripts refusal, driven directly: a clean tree cannot reach it, and
  // a silently empty set would report every legitimate `//#` key inert at once.
  refuses('a root manifest with no scripts table refuses', () => rootScriptNames({}));
  refuses('a root manifest with an empty scripts table refuses', () => rootScriptNames({ scripts: {} }));
  refuses('a root manifest whose scripts table is an array refuses', () => rootScriptNames({ scripts: ['lint'] }));
  t('a root manifest with scripts yields exactly its script names',
    [...rootScriptNames({ scripts: { lint: 'eslint .', dev: 'node x' } })].sort().join(',') === 'dev,lint');

  // ── Non-vacuity, on the LIVE tree ──
  // The cases above are all synthetic; this is the one that fails when the gate
  // is wired to a file or a workspace it cannot actually reach.
  try {
    const live = verdict(readTasks(ROOT), readWorkspaceScripts(ROOT), readRootScripts(ROOT));
    t('the live turbo.json presents package tasks to judge', live.judged > 0);
    t('the live turbo.json presents generic tasks to judge', live.genericJudged > 0);
  } catch (err) {
    failures.push(`the live tree could not be read: ${err.message}`);
  }

  return failures;
}

function runSelfTest() {
  const failures = selfTest();
  if (failures.length) {
    console.error(`FAIL: check-turbo-task-graph --self-test — ${failures.length} case(s) failed.`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('OK: check-turbo-task-graph --self-test — all cases passed.');
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) runSelfTest();
  else main();
}
