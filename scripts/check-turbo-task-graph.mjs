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
 * ## What this gate deliberately does NOT judge, stated rather than discovered
 *
 * GENERIC task keys -- the ones with no `#`, like `build` or `test:e2e` -- are
 * out of population. The invariant is the same shape ("a task nothing can run
 * is inert"), and on the tree this landed against it has a live violation:
 * `test:e2e` is defined here with `outputs: ["playwright-report/**", ...]` and
 * is held by ZERO of the 78 workspace packages -- the real Playwright script in
 * `examples/app-showcase` is spelled `test:smoke`, which turbo.json does not
 * configure at all. Closing that needs an edit to `turbo.json`, which is not
 * this card's file surface, and a gate that ships red is worse than no gate.
 * Filed as #12373; widen this gate's population to generic keys in the same
 * change that fixes that entry, not before.
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
 * The repo-root file this gate opens, in the SUBTREE spelling the dispatch
 * derivation can match. See the header for why the bare filename cannot be a
 * watch hint and why this is the escape rather than a fabricated declaration.
 * `--self-test` pins the exact string: a reword back to `'turbo.json'` would
 * cost the derivation silently, and this gate's whole second purpose with it.
 */
export const ROOT_FILE_WATCH_HINTS = ['turbo.json/**'];

/** The file this gate judges, as the reader spells it on disk. */
const TURBO_CONFIG_FILE = 'turbo.json';

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
 * The rule, as a pure function over already-parsed inputs, so `--self-test` can
 * drive it with the adversarial task tables a clean tree does not contain.
 *
 * @param {Record<string, unknown>} tasks turbo.json's `tasks` table
 * @param {Map<string, Set<string>>} scriptsByPackage package name -> script names
 * @returns {{ problems: string[], judged: number }}
 */
export function verdict(tasks, scriptsByPackage) {
  const problems = [];
  let judged = 0;
  for (const key of Object.keys(tasks)) {
    const split = splitTaskKey(key);
    if (!split) continue;
    judged += 1;
    const { pkg, task } = split;
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
  return { problems, judged };
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
  try {
    tasks = readTasks(ROOT);
    scriptsByPackage = readWorkspaceScripts(ROOT);
  } catch (err) {
    if (err instanceof TaskGraphReadError) {
      console.error(`FAIL: check-turbo-task-graph could not read its input.\n  ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const { problems, judged } = verdict(tasks, scriptsByPackage);

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
    console.error(`FAIL: ${TURBO_CONFIG_FILE} carries ${problems.length} inert task override(s).\n`);
    for (const p of problems) console.error(`  - ${p}\n`);
    console.error(
      'Why this gate exists: turbo does NOT refuse either of these. A task key naming a\n' +
        'package that does not exist, or a task the package has no script for, exits 0 with\n' +
        'no diagnostic and configures nothing — so the edit that was meant to change what CI\n' +
        'builds, orders or caches reads as landed while doing nothing at all (#12046).\n' +
        '\n' +
        '⛔ `dependsOn` is deliberately NOT checked here: turbo already refuses an\n' +
        'unresolvable one, loudly, with exit 1. Re-checking it would be this gate claiming a\n' +
        'population it does not police better than the tool that owns it.',
    );
    process.exit(1);
  }

  console.log(
    `OK: ${judged} package-scoped turbo task(s) judged against ${scriptsByPackage.size} workspace ` +
      `package(s) — every one names a package that exists and a script it declares.`,
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

  // ── Direction 1: the rule must go RED on each silent shape turbo accepts ──
  const unknownPkg = verdict({ '@objectstack/plugins-auth#typecheck': {} }, workspace);
  t('an unknown package in a task key is a finding', unknownPkg.problems.length === 1);
  t('the unknown-package finding is counted as judged', unknownPkg.judged === 1);
  t(
    'the unknown-package finding suggests the near miss',
    unknownPkg.problems[0]?.includes('@objectstack/plugin-auth'),
  );

  const missingScript = verdict({ '@objectstack/spec#typecheck': {} }, workspace);
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

  // ── Direction 2: the rule must stay GREEN on every legitimate shape ──
  const clean = verdict(
    {
      build: {},
      'test:e2e': {},
      '@objectstack/plugin-auth#typecheck': {},
      '@objectstack/spec#gen:schema': {},
      'create-objectstack#test': {},
    },
    workspace,
  );
  t('legitimate package tasks are green', clean.problems.length === 0);
  t('generic keys are out of population and not judged', clean.judged === 3);

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
  t('the root file is declared in the SUBTREE spelling', ROOT_FILE_WATCH_HINTS.join(',') === 'turbo.json/**');

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

  // ── Non-vacuity, on the LIVE tree ──
  // The cases above are all synthetic; this is the one that fails when the gate
  // is wired to a file or a workspace it cannot actually reach.
  try {
    const live = verdict(readTasks(ROOT), readWorkspaceScripts(ROOT));
    t('the live turbo.json presents package tasks to judge', live.judged > 0);
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
