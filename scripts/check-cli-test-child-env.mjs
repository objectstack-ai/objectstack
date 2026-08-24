#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-cli-test-child-env (#11341) -- a `packages/cli/test` file that SPAWNS a
 * child may not build that child's environment from `process.env` as a whole.
 *
 *   node scripts/check-cli-test-child-env.mjs              # audit the population
 *   node scripts/check-cli-test-child-env.mjs --list       # print the census
 *   node scripts/check-cli-test-child-env.mjs --self-test  # verify the checker
 *
 * ## The defect, measured twice
 *
 * A child built with `{ ...process.env, ... }` inherits the VITEST WORKER's
 * environment. Vitest sets `TEST=true`, `VITEST=true` and the `VITEST_*` family
 * on that worker unconditionally, and this repo has now paid for that twice, in
 * two different subsystems, one week apart:
 *
 *   - better-auth 1.7.1 reads `TEST` directly (`isTest()`), and
 *     `create-context.mjs` defaults `skipOriginCheck` from it. An inherited
 *     `TEST=true` therefore switched a spawned `os serve`'s origin/CSRF
 *     validation OFF entirely. #11267 measured it: the same probe answers
 *     `401 INVALID_EMAIL_OR_PASSWORD` (origin ACCEPTED, validation never ran)
 *     with the leak and `403 INVALID_ORIGIN` without it.
 *   - `local-crypto-provider.ts` read `VITEST` to pick its crypto posture, so an
 *     inherited one put every spawned child's crypto layer in `test` mode --
 *     ephemeral key, never refuses. That is #11352, and
 *     `check:runner-env-posture` is the half of it that keeps PRODUCT source
 *     clear of the class.
 *
 * The dangerous direction in both is not a red test. It is a security-posture
 * assertion that can never go red for the reason it exists, which reads as
 * coverage. `packages/cli/test/helpers/serve-process.ts` answered it with a
 * choke point -- `childEnv()`, which copies the environment minus the runner
 * family -- and swept the `os serve` spawners onto it.
 *
 * ## Why a gate and not the sweep
 *
 * `childEnv()` is a CONVENTION. The next author writing an e2e test in this
 * directory reaches for `{ ...process.env, ... }` because that is what every
 * neighbouring file still looks like, and nothing fails when they do. Sweeping
 * the remaining files would restate the convention without enforcing it; the
 * gate is what makes a sweep stay true. So this ships FIRST, with today's
 * violations baselined, and the sweep follows one neighbourhood at a time.
 *
 * ## What counts as a finding: a BULK reference in a SPAWNER file
 *
 * Two conditions, and both are load-bearing.
 *
 * **(1) The file is a spawner.** It imports a process-creating API from
 * `node:child_process` (`spawn`, `spawnSync`, `exec`, `execSync`, `execFile`,
 * `execFileSync`, `fork` -- named, namespace or default), or `Worker` from
 * `node:worker_threads`. Files that do not spawn are not scanned at all, and
 * that is the precision half: copying the whole environment inside an
 * in-process unit test (the ordinary save/restore around a mutation) is not
 * this defect and must not be made to look like it. Measured on the tree this
 * gate landed against: 82 sources in the population, 28 of them spawners, and
 * ZERO bulk references outside a spawner file -- so the filter costs no recall
 * today and its precision claim is a measurement rather than a hope.
 *
 * `Worker` is on the roster with no instance in the population, deliberately:
 * a worker takes the same inherited `env`, and the class has to be closed for
 * the NEXT spelling, not for the last one.
 *
 * **(2) The reference is BULK.** `process.env` used as a whole value -- spread
 * (`{ ...process.env }`), handed to a copier (`Object.assign({}, process.env)`,
 * `Object.entries(process.env)`), passed as an argument, assigned to a binding.
 * Reading ONE variable off it is not bulk and is never flagged:
 * `process.env.HOME`, `process.env['HOME']`, `process.env?.HOME`. That
 * distinction is the whole rule -- `childEnv({ HOME: process.env.HOME })` is
 * exactly right and stays green.
 *
 * The rule is deliberately NEGATIVE ("no bulk copy reaches a child") rather
 * than positive ("every spawn must call `childEnv()`"). A positive rule would
 * force every unit test that spawns `tsx` on a probe script through a helper it
 * has no need for, and would go stale the moment the choke point is renamed.
 *
 * ## Why the site is not anchored to the spawn CALL
 *
 * The obvious sharper rule -- find the `env:` option of a spawn call and look
 * inside it -- was written, measured against this population, and rejected. It
 * cannot see the one site in the directory that matters most:
 * `serve-process-child-env.e2e.test.ts` builds its leaked environment in
 * `leakedEnv()`, hands it to `probeOrigin(env)`, and the spawn's `env` is a
 * function PARAMETER. Chasing that needs same-file interprocedural data flow,
 * and every hop it cannot follow is a silent zero. The file-anchored rule has
 * no such hop: the bulk copy is in the file, and the file spawns.
 *
 * ## False positives and false negatives, both named
 *
 * FALSE POSITIVE, by construction: a spawner file that copies the whole
 * environment for a reason that is NOT a child -- a save/restore around an
 * in-process mutation, or the choke point itself, which must read the whole
 * environment in order to filter it. Zero instances in the population today
 * beyond the two in {@link DELIBERATE}. A new one is a `DELIBERATE` entry
 * carrying its reason, reviewed as part of the PR that needs it.
 *
 * FALSE NEGATIVE, three of them, each measured rather than supposed:
 *
 *   1. **A spawn with NO `env` option at all** inherits `process.env` verbatim
 *      -- the same leak, in a purer form, and this gate is silent on it.
 *      8 such call sites exist in the population today. It is out of scope
 *      deliberately: whether a `tsx`-on-a-probe-script unit test owes the
 *      `childEnv()` convention at all is a question about the CONVENTION's
 *      reach, not about this defect, and widening a gate past its convention is
 *      how a gate gets carved out. Filed separately.
 *   2. **A bulk copy built in a non-spawner file** and handed to a spawner
 *      (`runServe(cwd, args, { env })` re-adds whatever it is given AFTER the
 *      strip). Contrived rather than accidental -- nobody writes it by reaching
 *      for the neighbouring file's shape -- but it is a hole and it is named.
 *   3. **A bulk copy laundered through something this scan cannot see as
 *      `process.env`** -- read out of a module that re-exports it, or rebuilt
 *      key by key. Any text scan or AST scan has this edge.
 *
 * ## The two registries, and why they are different KINDS
 *
 * {@link DELIBERATE} is a DECLARATION registry: the sites that copy the whole
 * environment ON PURPOSE. It is not a ratchet and it is not shrink-only -- an
 * entry is the correct outcome for a site whose bulk copy is the point. It is
 * pinned in BOTH directions: an entry that stops matching FAILS. That is not
 * bookkeeping. `serve-process-child-env.e2e.test.ts`'s header says
 * "⛔ Do not clean it up ... that would delete the only evidence in the repo
 * that the leak does anything, and leave a green suite behind" -- and a header
 * is a request. A stale-entry failure is what turns it into a refusal, which is
 * the carve-out discipline that choke point documents, expressed where a
 * machine can hold it.
 *
 * `cli-test-child-env.baseline.json` is a RATCHET: the latent violations that
 * predate this gate, as per-file counts. Counts rather than a bare path list
 * for the #4251 reason the slot-lookup ratchet paid for -- a path list lets a
 * NEW violation ride an existing entry in total silence. It only ever shrinks,
 * in both dimensions: the key set only loses files, and a count that FALLS must
 * be lowered in the same PR. A ceiling left above reality silently licenses
 * that many new leaks.
 *
 * ⛔ The baseline is closed to new entries -- see the failure text. Its repair
 * is one card per neighbourhood, tracked on #11596, and the reason those
 * repairs are not in the PR that landed this gate is that two of the baselined
 * files were held by another card in flight at the time.
 *
 * The sibling gap this gate does NOT cover -- a spawn passing no `env` option
 * at all, which inherits the whole environment in a purer form -- is #11595.
 *
 * ## Why every unreadable state is a REFUSAL, not a quiet pass
 *
 * This gate computes its own population, so it is exactly the kind that can
 * pass while reading nothing: a population that resolves to zero files, or to
 * zero spawner files, produces an empty finding list, and an empty finding list
 * has no violations in it. Each exits non-zero naming what could not be read,
 * as does a source that cannot be READ. A source that cannot be PARSED is
 * refused one level down by `scripts/ts-parse.mjs`, which names the file and
 * exits `EXIT_UNPARSEABLE` -- a different non-zero code, deliberately. The
 * self-test pairs every refusal with a readable tree that still returns a
 * verdict, so "refuses unconditionally" cannot satisfy the battery.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);

import { isEntrypoint } from './invoked-as.mjs';
import { parseSourceFile } from './ts-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/**
 * The declared population.
 *
 * Spelled as a real subtree glob rather than a bare segment because
 * `scripts/pm/dispatch-gates.mjs` builds each dispatch's gate list by scanning
 * a gate's own source for the path literals it operates on, and it refuses a
 * bare single-segment hint as too generic. A gate that declares its population
 * some other way lands already invisible to every dispatch -- the #9700/#9626
 * lesson, which cost real CI rounds on cards that could not have known to run
 * the gate they broke.
 */
const POPULATION = 'packages/cli/test/**';

/** The population's root directory, derived from the declaration above. */
const POPULATION_ROOT = POPULATION.replace(/\/\*+$/, '');

/** Where the ratchet lives, repo-relative. */
const BASELINE = 'scripts/cli-test-child-env.baseline.json';

/** Directories with no first-party source in them. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo', '.cache', '.next', '.git']);

/**
 * The process-creating APIs. `node:child_process`'s whole surface plus
 * `node:worker_threads`' `Worker`, which takes the same inherited `env`.
 */
export const SPAWN_MODULES = {
  child_process: ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'],
  worker_threads: ['Worker'],
};

/**
 * The sites that copy the whole environment ON PURPOSE, keyed
 * `<repo-relative path>::<enclosing function>`.
 *
 * A DECLARATION registry, not a ratchet: an entry is the right answer for a
 * site whose bulk copy is the point, and adding one needs no maintainer's
 * leave -- it needs a reason, in the PR that adds it. It is pinned in both
 * directions and a stale entry FAILS, which is the half that matters: the pin
 * leg below exists to prove the leak does something, its own header forbids
 * "cleaning it up", and until now nothing enforced that.
 */
export const DELIBERATE = {
  'packages/cli/test/helpers/serve-process.ts::childEnv': {
    why: 'The choke point itself. childEnv() reads the whole environment in order to STRIP the vitest worker family from it, so a bulk read here is the repair, not the defect.',
  },
  'packages/cli/test/serve-process-child-env.e2e.test.ts::leakedEnv': {
    why: 'The #11267 pin leg. leakedEnv() is the PRE-fix recipe kept executable, so the repair stays distinguishable from a no-op; its file header marks it do-not-clean-up and this entry is what enforces that.',
  },
};

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/** Every TypeScript source under `dir`, recursively, skipping build output. */
export function walkSources(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walkSources(abs, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !/\.d\.(ts|mts|cts)$/.test(entry.name)) out.push(abs);
  }
  return out;
}

/** TSX only for `.tsx` -- forcing TSX on a `.ts` makes every generic wreckage. */
function scriptKindFor(fileName) {
  return fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** `node:child_process` and `child_process` name the same module. */
function bareModuleName(specifier) {
  return specifier.replace(/^node:/, '');
}

/**
 * Does this source import a process-creating API?
 *
 * A namespace or default import of the whole module counts: `cp.spawn(...)` is
 * a spawn, and requiring the member to be named would miss it.
 */
export function isSpawnerSource(sourceFile) {
  let spawner = false;
  const visit = (node) => {
    if (spawner) return;
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const roster = SPAWN_MODULES[bareModuleName(node.moduleSpecifier.text)];
      if (roster) {
        const clause = node.importClause;
        if (!clause) return;
        if (clause.name) spawner = true;
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) spawner = true;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (element.isTypeOnly) continue;
            if (roster.includes((element.propertyName ?? element.name).text)) spawner = true;
          }
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return spawner;
}

/** Is `node` the expression `process.env` (dotted, indexed, or off globalThis)? */
function isProcessEnvExpression(node, sourceFile) {
  if (ts.isPropertyAccessExpression(node)) {
    if (node.name.text !== 'env') return false;
    return /(^|\.)process$/.test(node.expression.getText(sourceFile));
  }
  if (ts.isElementAccessExpression(node)) {
    const arg = node.argumentExpression;
    if (!arg || !ts.isStringLiteralLike(arg) || arg.text !== 'env') return false;
    return /(^|\.)process$/.test(node.expression.getText(sourceFile));
  }
  return false;
}

/**
 * Is this `process.env` node used as a WHOLE VALUE?
 *
 * Bulk is the default: a spread, an argument, an initialiser, a return. Two
 * positions are excluded, and both are excluded because they are not COPIES:
 *
 *   - a member read, `process.env.HOME`, where the node is the object of a
 *     property or element access. Taking one variable is exactly what the
 *     repair looks like -- `childEnv({ HOME: process.env.HOME })`.
 *   - the TARGET of an assignment, `process.env = saved`. That writes to this
 *     process's own environment; nothing is copied and no child can receive it.
 *     It is the second half of the ordinary save/restore, and flagging it would
 *     report a copy where the author made none.
 */
function isBulkUse(node) {
  const parent = node.parent;
  if (!parent) return true;
  if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node) {
    return false;
  }
  if (ts.isBinaryExpression(parent) && parent.left === node
    && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return false;
  }
  // `(process.env)` and `process.env!` are the same value wearing punctuation.
  if (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent)) return isBulkUse(parent);
  return true;
}

/**
 * The nearest enclosing named function, which is the stable half of a site key.
 *
 * A line number is not: any edit above a site moves it, so a registry keyed by
 * line would go stale on unrelated changes and teach its readers to re-run
 * `--update` without looking.
 */
export function enclosingFunctionName(node, sourceFile) {
  let cursor = node.parent;
  while (cursor) {
    if (ts.isFunctionDeclaration(cursor) && cursor.name) return cursor.name.text;
    if (ts.isMethodDeclaration(cursor) && cursor.name) return cursor.name.getText(sourceFile);
    if (ts.isArrowFunction(cursor) || ts.isFunctionExpression(cursor)) {
      const owner = cursor.parent;
      if (owner && ts.isVariableDeclaration(owner) && owner.name) return owner.name.getText(sourceFile);
      if (owner && ts.isPropertyAssignment(owner) && owner.name) return owner.name.getText(sourceFile);
      if (cursor.name) return cursor.name.text;
    }
    cursor = cursor.parent;
  }
  return '(top-level)';
}

/**
 * Every bulk `process.env` reference in one source.
 *
 * @returns {Array<{line: number, fn: string, text: string}>}
 */
export function bulkEnvReferences(fileName, source) {
  const sourceFile = parseSourceFile(fileName, source, scriptKindFor(fileName));
  const found = [];
  const visit = (node) => {
    if (isProcessEnvExpression(node, sourceFile) && isBulkUse(node)) {
      found.push({
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        fn: enclosingFunctionName(node, sourceFile),
        text: (node.parent ?? node).getText(sourceFile).replace(/\s+/g, ' ').slice(0, 72),
      });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** The site key a registry entry is written against. */
export const siteKey = (row) => `${row.file}::${row.fn}`;

/**
 * Audit one tree. Returns the census and either the findings or a refusal --
 * never an empty finding list standing in for a population it could not read.
 *
 * @param {string} root  A directory containing the population root.
 */
export function audit(root) {
  const populationDir = join(root, POPULATION_ROOT);
  let exists = false;
  try {
    exists = statSync(populationDir).isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) {
    return { files: 0, spawners: 0, findings: [], deliberate: [], refusal: `the population root ${POPULATION} does not resolve to a directory under ${root}` };
  }

  const files = walkSources(populationDir);
  if (files.length === 0) {
    return { files: 0, spawners: 0, findings: [], deliberate: [], refusal: `${POPULATION} resolved to a directory containing no TypeScript source` };
  }

  const findings = [];
  const deliberate = [];
  let spawners = 0;
  for (const abs of files) {
    const rel = relative(root, abs).split(sep).join('/');
    let source;
    try {
      source = readFileSync(abs, 'utf8');
    } catch (error) {
      return {
        files: files.length,
        spawners,
        findings: [],
        deliberate: [],
        refusal: `${rel} could not be read (${error.code ?? error.message}) -- a source this gate cannot read is not a source with nothing to report`,
      };
    }
    // A sound pre-filter, not merely a fast one: an import declaration is
    // required SYNTAX for reaching a spawn API, and its absence is a property
    // of the source TEXT that no parse state can hide.
    if (!/child_process|worker_threads/.test(source)) continue;
    if (!isSpawnerSource(parseSourceFile(abs, source, scriptKindFor(abs)))) continue;
    spawners += 1;
    for (const hit of bulkEnvReferences(abs, source)) {
      const row = { file: rel, ...hit };
      (Object.hasOwn(DELIBERATE, siteKey(row)) ? deliberate : findings).push(row);
    }
  }

  if (spawners === 0) {
    return {
      files: files.length,
      spawners: 0,
      findings: [],
      deliberate: [],
      refusal: `${files.length} source(s) under ${POPULATION} and not one of them spawns a child -- the population is unresolvable, which is not the same as clean`,
    };
  }

  return { files: files.length, spawners, findings, deliberate, refusal: null };
}

/** Per-file counts, the shape the ratchet holds. */
export function countByFile(findings) {
  const counts = {};
  for (const row of findings) counts[row.file] = (counts[row.file] ?? 0) + 1;
  return counts;
}

/**
 * Compare observed counts against the ratchet, in both directions, and the
 * declaration registry against what is still on disk.
 */
export function judge(findings, deliberate, baseline) {
  const observed = countByFile(findings);
  const over = [];
  const under = [];
  for (const [file, count] of Object.entries(observed)) {
    const ceiling = baseline[file] ?? 0;
    if (count > ceiling) over.push({ file, count, ceiling });
  }
  for (const [file, ceiling] of Object.entries(baseline)) {
    const count = observed[file] ?? 0;
    if (count < ceiling) under.push({ file, count, ceiling });
  }
  const seen = new Set(deliberate.map(siteKey));
  const missing = Object.keys(DELIBERATE).filter((key) => !seen.has(key));
  return { over, under, missing, held: deliberate.length };
}

function readBaseline(root = REPO_ROOT) {
  const raw = JSON.parse(readFileSync(join(root, BASELINE), 'utf8'));
  const counts = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('$')) continue;
    counts[key] = value;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const { files, spawners, findings, deliberate, refusal } = audit(REPO_ROOT);
  if (refusal) {
    console.error(`❌  check:cli-test-child-env -- REFUSING to report a verdict: ${refusal}.`);
    console.error(
      '\n    A gate that computes its own population can pass while reading nothing,'
      + '\n    and an empty finding list is indistinguishable from a clean one. This'
      + '\n    exits non-zero instead. Restore the population or fix the tool.',
    );
    return 1;
  }

  const baseline = readBaseline();
  const { over, under, missing, held } = judge(findings, deliberate, baseline);

  if (over.length) {
    console.error(`❌  check:cli-test-child-env -- ${over.length} file(s) build a spawned child's environment from the whole of process.env:\n`);
    for (const row of over) {
      for (const f of findings.filter((x) => x.file === row.file)) {
        console.error(`  ${f.file}:${f.line}  [${f.fn}]  ${f.text}`);
      }
      console.error(`    ${row.file}: ${row.count} bulk reference(s), ceiling ${row.ceiling}\n`);
    }
    console.error(
      '    A child built from the whole of process.env inherits the VITEST WORKER\'s'
      + '\n    environment -- TEST=true, VITEST=true and the VITEST_* family. better-auth'
      + '\n    reads TEST and switches its origin/CSRF validation OFF; the settings crypto'
      + '\n    provider read VITEST and took its never-refuses posture. Both were measured,'
      + '\n    in the same week, and neither showed up as a red test: the failure mode is a'
      + '\n    security assertion that cannot go red for the reason it exists.'
      + '\n'
      + '\n    The repair is the choke point that already exists:'
      + '\n'
      + '\n      import { childEnv } from \'./helpers/serve-process.js\';'
      + '\n      spawn(CLI, args, { cwd, env: childEnv({ NO_COLOR: \'1\' }) });'
      + '\n'
      + '\n    childEnv() copies the environment minus the runner family, then applies the'
      + '\n    overrides you pass -- so a test that genuinely wants one of those variables'
      + '\n    set in its child can still say so, explicitly. Reading ONE variable off'
      + '\n    process.env is not this defect and is never flagged: childEnv({ HOME:'
      + '\n    process.env.HOME }) is exactly right.'
      + `\n\n    ⛔ Do not raise a count in ${BASELINE} to get past this, and do not add a`
      + '\n    file to it. That ratchet is ⛔ SHRINK-ONLY and closed to new entries: it'
      + '\n    holds the leaks that predate this gate, whose repair is a card per'
      + '\n    neighbourhood. Widening it is not a fix -- it reopens the class this gate'
      + '\n    exists to close.'
      + '\n'
      + '\n    A site that copies the whole environment ON PURPOSE is a DELIBERATE entry in'
      + '\n    scripts/check-cli-test-child-env.mjs carrying its reason, not a baseline row.',
    );
    return 1;
  }

  if (under.length) {
    console.error(`❌  check:cli-test-child-env -- ${under.length} stale ${BASELINE} entry/entries:\n`);
    for (const row of under) {
      console.error(`  ${row.file}  now ${row.count}, ceiling still ${row.ceiling}`);
    }
    console.error(
      '\n    Good news, and the ratchet must say so: lower each count above to what the'
      + `\n    tree now holds, and DELETE the key when it reaches 0. ${BASELINE} only ever`
      + '\n    shrinks, and a ceiling left above reality silently licenses that many new'
      + '\n    leaks -- which is how a ratchet drifts into an allowlist nobody re-reads.',
    );
    return 1;
  }

  if (missing.length) {
    console.error(`❌  check:cli-test-child-env -- ${missing.length} DELIBERATE site(s) no longer present:\n`);
    for (const key of missing) console.error(`  ${key}\n    was: ${DELIBERATE[key].why}`);
    console.error(
      '\n    These are the sites that copy the whole environment ON PURPOSE, and each is'
      + '\n    pinned because losing it is silent. The pin leg in particular is the only'
      + '\n    evidence in this repo that the leak does anything: cleaning it up leaves a'
      + '\n    green suite behind and nothing to say the repair still repairs something.'
      + '\n'
      + '\n    If the site really is gone on purpose, delete its DELIBERATE entry in the'
      + '\n    same commit and say in the PR body what replaced the evidence.',
    );
    return 1;
  }

  const remaining = Object.values(baseline).reduce((a, b) => a + b, 0);
  console.log(
    `✓ check:cli-test-child-env: ${spawners} spawner source(s) among ${files} under ${POPULATION}; `
    + `no new bulk process.env copy reaches a spawned child `
    + `(${remaining} baselined in ${Object.keys(baseline).length} file(s), ⛔ SHRINK-ONLY; ${held} deliberate site(s) still pinned).`,
  );
  return 0;
}

/** `--list`: the whole census, for burning the ratchet down. */
function list() {
  const { files, spawners, findings, deliberate, refusal } = audit(REPO_ROOT);
  if (refusal) {
    console.error(`REFUSED: ${refusal}`);
    return 1;
  }
  for (const row of deliberate.sort((a, b) => siteKey(a).localeCompare(siteKey(b)))) {
    console.log(`deliberate  ${row.file}:${row.line}  [${row.fn}]`);
  }
  for (const row of findings.sort((a, b) => siteKey(a).localeCompare(siteKey(b)))) {
    console.log(`baselined   ${row.file}:${row.line}  [${row.fn}]  ${row.text}`);
  }
  console.log(`\n${spawners} spawner source(s) in ${files}; ${findings.length} bulk copy/copies, ${deliberate.length} deliberate.`);
  console.log(JSON.stringify(countByFile(findings), null, 2));
  return 0;
}

/**
 * `--audit-root <dir>`: audit an arbitrary tree and print the finding count.
 *
 * The self-test's out-of-process leg, and its only caller. It exists because
 * `ts-parse.mjs` refuses an unparseable source by ending the PROCESS, which is
 * the behaviour being asserted and cannot be observed from inside it.
 */
function auditRoot(root) {
  const { files, spawners, findings, deliberate, refusal } = audit(root);
  if (refusal) {
    console.error(`REFUSED: ${refusal}`);
    return 1;
  }
  if (findings.length) {
    for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.fn}]  ${f.text}`);
    console.error(`FOUND files=${files} spawners=${spawners} findings=${findings.length}`);
    return 1;
  }
  console.log(`OK files=${files} spawners=${spawners} findings=0 deliberate=${deliberate.length}`);
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test -- the shapes, the carve-out, the refusals, and one out-of-process
// leg that proves this gate can actually FAIL
// ---------------------------------------------------------------------------

/**
 * The battery.
 *
 * The corpus is deliberately NOT the only evidence here. A gate whose self-test
 * only asserts "today's tree is clean" measures nothing the day the scan stops
 * matching -- it prints the same green line over a tree it never read. So the
 * shapes are pinned against SYNTHESISED fixtures, which cannot be edited into
 * passing by a sweep, and the live tree is one further case on top.
 *
 * The positive control runs OUT OF PROCESS, through the real CLI entry point,
 * because "exits non-zero" is the property being claimed and it is not
 * observable from inside the process making the claim.
 */
export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });

  const SELF = fileURLToPath(import.meta.url);
  const dir = mkdtempSync(join(tmpdir(), 'cli-test-child-env-'));

  /** Build a fixture tree: `{ 'a.ts': source }` under `<tmp>/<name>/packages/cli/test`. */
  const tree = (name, sources) => {
    const root = join(dir, name);
    for (const [rel, source] of Object.entries(sources)) {
      const abs = join(root, POPULATION_ROOT, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, source);
    }
    return root;
  };

  /** A spawner file whose body is `body`. */
  const spawner = (body) => `import { execFile } from 'node:child_process';\n\nexport function runCli(cwd: string) {\n${body}\n}\n`;
  /** The same body in a file that imports nothing that spawns. */
  const plain = (body) => `export function helper(cwd: string) {\n  void cwd;\n${body}\n}\n`;

  /** Findings from a one-file spawner tree. */
  const scan = (name, sources) => {
    const result = audit(tree(name, sources));
    return result.refusal ? { refusal: result.refusal } : { findings: result.findings, deliberate: result.deliberate };
  };
  const count = (name, sources) => scan(name, sources).findings?.length;

  /** A tree that must always produce a verdict -- the paired control for every refusal. */
  const READABLE = { 'ok.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: childEnv({}) });') };

  /**
   * A clean spawner, added to any fixture whose SUBJECT is a non-spawner file.
   *
   * Zero spawners in a population is a REFUSAL rather than a clean verdict, so a
   * one-file non-spawner tree would answer `undefined` instead of `0` and the
   * case would pass for the wrong reason. The companion makes the population
   * resolvable, which is what lets "the subject contributed nothing" be read as
   * a measurement. (It also spawns with NO `env` option at all -- the leak this
   * gate deliberately does not cover, and it stays green here too.)
   */
  const COMPANION = { 'companion.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd });') };

  try {
    // -- (1) the positive control: a bare spread in a spawner REDS ----------
    t('a bare process.env spread in a spawner file REDS',
      count('pos-spread', { 'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: { ...process.env, NO_COLOR: \'1\' } });') }) === 1);

    // -- (2) the childEnv() form is green -----------------------------------
    t('the childEnv() form stays GREEN',
      count('neg-childenv', { 'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: childEnv({ NO_COLOR: \'1\' }) });') }) === 0);

    // -- (3) the negative control the whole precision claim rests on --------
    //    A legitimate non-spawner bulk copy -- the ordinary save/restore around
    //    an in-process mutation. This is the shape a package-wide scan would
    //    flag, and flagging it is how a gate gets carved out into uselessness.
    t('a save/restore bulk copy in a NON-spawner file stays GREEN (the negative control)',
      count('neg-nonspawner', {
        ...COMPANION,
        'a.test.ts': plain('  const saved = { ...process.env };\n  process.env.OS_X = \'1\';\n  process.env = saved;'),
      }) === 0);
    t('...and the SAME body in a spawner file reds, so the FILTER is what made it green',
      count('neg-nonspawner-mirror', {
        'a.test.ts': spawner('  const saved = { ...process.env };\n  process.env.OS_X = \'1\';\n  process.env = saved;'),
      }) === 1);
    t('restoring the environment (process.env = saved) is a write, not a copy',
      count('restore-only', { 'a.e2e.test.ts': spawner('  process.env = build();') }) === 0);

    // -- (4) reading ONE variable off the environment is never a finding ----
    t('process.env.HOME is a member read, not a bulk copy',
      count('read-dot', { 'a.e2e.test.ts': spawner('  const h = process.env.HOME;\n  void h;') }) === 0);
    t("process.env['HOME'] is a member read too",
      count('read-index', { 'a.e2e.test.ts': spawner('  const h = process.env[\'HOME\'];\n  void h;') }) === 0);
    t('process.env?.HOME is a member read too',
      count('read-optional', { 'a.e2e.test.ts': spawner('  const h = process.env?.HOME;\n  void h;') }) === 0);
    t('childEnv({ HOME: process.env.HOME }) -- the correct shape -- stays GREEN',
      count('read-in-override', {
        'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: childEnv({ HOME: process.env.HOME }) });'),
      }) === 0);

    // -- (5) the other bulk spellings, so the rule is not spread-shaped -----
    t('Object.assign({}, process.env) is a bulk copy',
      count('bulk-assign', { 'a.e2e.test.ts': spawner('  const e = Object.assign({}, process.env, { NO_COLOR: \'1\' });\n  void e;') }) === 1);
    t('Object.entries(process.env) is a bulk copy',
      count('bulk-entries', { 'a.e2e.test.ts': spawner('  const e = Object.entries(process.env);\n  void e;') }) === 1);
    t('handing process.env to a call is a bulk copy',
      count('bulk-arg', { 'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: build(process.env) });') }) === 1);
    t('aliasing process.env to a binding is a bulk copy',
      count('bulk-alias', { 'a.e2e.test.ts': spawner('  const e = process.env;\n  void e;') }) === 1);
    t('a parenthesised spread is still a bulk copy',
      count('bulk-paren', { 'a.e2e.test.ts': spawner('  const e = { ...(process.env) };\n  void e;') }) === 1);
    t('two bulk copies in one file count TWO',
      count('bulk-two', { 'a.e2e.test.ts': spawner('  const a = { ...process.env };\n  const b = { ...process.env };\n  void a; void b;') }) === 2);

    // -- (6) prose is not code, which is what an AST buys over a text scan --
    t('a docblock quoting the banned shape is not a finding',
      count('prose-block', { 'a.e2e.test.ts': spawner('  /** never write { ...process.env } here */\n  void cwd;') }) === 0);
    t('a line comment quoting it is not a finding',
      count('prose-line', { 'a.e2e.test.ts': spawner('  // never write { ...process.env } here\n  void cwd;') }) === 0);
    t('a string payload naming it is not a finding',
      count('prose-string', { 'a.e2e.test.ts': spawner('  const s = \'{ ...process.env }\';\n  void s;') }) === 0);

    // -- (7) the spawner roster, every import spelling ----------------------
    for (const [mod, roster] of Object.entries(SPAWN_MODULES)) {
      for (const api of roster) {
        const src = `import { ${api} } from 'node:${mod}';\nvoid ${api};\nexport const e = { ...process.env };\n`;
        t(`a named import of ${mod}.${api} makes the file a spawner`, count(`roster-${mod}-${api}`, { 'a.ts': src }) === 1);
      }
    }
    t('a namespace import of child_process makes the file a spawner',
      count('roster-namespace', { 'a.ts': 'import * as cp from \'node:child_process\';\nvoid cp;\nexport const e = { ...process.env };\n' }) === 1);
    t('a default import of child_process makes the file a spawner',
      count('roster-default', { 'a.ts': 'import cp from \'node:child_process\';\nvoid cp;\nexport const e = { ...process.env };\n' }) === 1);
    t('the un-prefixed \'child_process\' specifier is the same module',
      count('roster-bare', { 'a.ts': 'import { spawn } from \'child_process\';\nvoid spawn;\nexport const e = { ...process.env };\n' }) === 1);
    t('a TYPE-only import does not make the file a spawner',
      count('roster-type-only', { ...COMPANION, 'a.ts': 'import type { ChildProcess } from \'node:child_process\';\nexport type C = ChildProcess;\nexport const e = { ...process.env };\n' }) === 0);
    t('importing a non-spawning member of child_process does not make the file a spawner',
      count('roster-non-spawn-member', { ...COMPANION, 'a.ts': 'import { ChildProcess } from \'node:child_process\';\nvoid ChildProcess;\nexport const e = { ...process.env };\n' }) === 0);

    // -- (8) the carve-out, and that it is SITE-scoped rather than file-scoped
    const chokePath = 'helpers/serve-process.ts';
    const carved = scan('carve-hit', {
      [chokePath]: 'import { spawn } from \'node:child_process\';\nvoid spawn;\nexport function childEnv() {\n  return { ...process.env };\n}\n',
    });
    t('a DELIBERATE site is recorded as deliberate, not as a finding',
      carved.findings?.length === 0 && carved.deliberate?.length === 1
        && siteKey(carved.deliberate[0]) === 'packages/cli/test/helpers/serve-process.ts::childEnv',
      JSON.stringify(carved));

    const carvedNeighbour = scan('carve-miss', {
      [chokePath]: 'import { spawn } from \'node:child_process\';\nvoid spawn;\nexport function childEnv() {\n  return { ...process.env };\n}\nexport function somethingElse() {\n  return { ...process.env };\n}\n',
    });
    t('the SAME file reds for a bulk copy in a different function -- the carve-out is a SITE, not a file',
      carvedNeighbour.findings?.length === 1 && carvedNeighbour.findings[0].fn === 'somethingElse',
      JSON.stringify(carvedNeighbour.findings));

    // -- (9) the ratchet, in every direction it must move ------------------
    const one = [{ file: 'packages/cli/test/a.ts', fn: 'runCli', line: 1, text: 'x' }];
    const two = [...one, { file: 'packages/cli/test/a.ts', fn: 'runOther', line: 2, text: 'x' }];
    const allDeliberate = Object.keys(DELIBERATE).map((key) => {
      const [file, fn] = key.split('::');
      return { file, fn, line: 1, text: 'x' };
    });
    t('a file at its ceiling is neither over nor under',
      judge(one, allDeliberate, { 'packages/cli/test/a.ts': 1 }).over.length === 0
        && judge(one, allDeliberate, { 'packages/cli/test/a.ts': 1 }).under.length === 0);
    t('a count ABOVE its ceiling fails (a new leak riding an old entry)',
      judge(two, allDeliberate, { 'packages/cli/test/a.ts': 1 }).over.length === 1);
    t('a count BELOW its ceiling fails, so a repair must lower the ratchet',
      judge(one, allDeliberate, { 'packages/cli/test/a.ts': 2 }).under.length === 1);
    t('a file absent from the ratchet fails at count 1',
      judge(one, allDeliberate, {}).over.length === 1);
    t('a ceiling for a file that is now clean fails as stale',
      judge([], allDeliberate, { 'packages/cli/test/a.ts': 1 }).under.length === 1);
    t('a DELIBERATE site that is gone fails as stale -- the do-not-clean-up pin',
      judge([], [], {}).missing.length === Object.keys(DELIBERATE).length
        && judge([], allDeliberate, {}).missing.length === 0);

    // -- (10) every refusal, each PAIRED with a tree that still answers -----
    const emptyRoot = tree('refuse-empty', { 'README.md': 'not a source\n' });
    t('a population with no TypeScript source REFUSES, while a readable tree still answers',
      audit(emptyRoot).refusal !== null && audit(tree('refuse-empty-pair', READABLE)).refusal === null,
      JSON.stringify(audit(emptyRoot).refusal));

    t('a missing population root REFUSES, while a readable tree still reds',
      audit(join(dir, 'refuse-missing')).refusal !== null
        && audit(tree('refuse-missing-pair', { 'a.ts': spawner('  const e = { ...process.env };\n  void e;') })).findings.length === 1);

    const noSpawners = audit(tree('refuse-no-spawners', { 'a.test.ts': plain('  void 0;') }));
    t('a population with sources but ZERO spawners REFUSES rather than reporting clean',
      noSpawners.refusal !== null, JSON.stringify(noSpawners.refusal));

    // A DANGLING SYMLINK named like a source: a directory entry the walk must
    // collect (right extension, not a directory) whose read then throws -- and
    // it fails that way for every uid, where `chmod 000` would not stop root.
    const unreadableRoot = tree('refuse-unreadable', READABLE);
    symlinkSync('./nowhere-at-all.ts', join(unreadableRoot, POPULATION_ROOT, 'gone.ts'));
    const unreadable = audit(unreadableRoot);
    t('a source that cannot be READ refuses, naming it, and the same tree is otherwise readable',
      unreadable.refusal !== null && unreadable.refusal.includes('gone.ts')
        && audit(tree('refuse-unreadable-pair', READABLE)).refusal === null,
      JSON.stringify(unreadable.refusal));

    // -- (11) THE anti-vacuity leg: the real entry point, out of process ----
    //    "exits non-zero on a violation" is the claim, and a process cannot
    //    observe its own exit status. These two run the real CLI.
    const redRoot = tree('oop-red', {
      'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: { ...process.env, NO_COLOR: \'1\' } });'),
    });
    const red = spawnSync(process.execPath, [SELF, '--audit-root', redRoot], { encoding: 'utf8' });
    t('OUT OF PROCESS: a spawner with a bare spread exits NON-ZERO and names the site',
      red.status === 1 && /a\.e2e\.test\.ts:\d+/.test(`${red.stderr}${red.stdout}`),
      JSON.stringify({ status: red.status, err: (red.stderr || '').slice(0, 200) }));

    const greenRoot = tree('oop-green', {
      'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: childEnv({ NO_COLOR: \'1\' }) });'),
    });
    const green = spawnSync(process.execPath, [SELF, '--audit-root', greenRoot], { encoding: 'utf8' });
    t('OUT OF PROCESS: ...while the childEnv() form through the same entry point exits ZERO',
      green.status === 0 && /findings=0/.test(green.stdout),
      JSON.stringify({ status: green.status, out: (green.stdout || '').trim() }));

    // -- (12) the unparseable leg: ts-parse ends the PROCESS ----------------
    const wreckRoot = tree('oop-wreck', {
      ...READABLE,
      'wreck.ts': 'import { spawn } from \'node:child_process\';\n<<<<<<< HEAD\nvoid spawn;\n=======\nvoid 0;\n>>>>>>> other\n',
    });
    const wreck = spawnSync(process.execPath, [SELF, '--audit-root', wreckRoot], { encoding: 'utf8' });
    t('OUT OF PROCESS: an UNPARSEABLE source refuses, naming the file, with its own exit code',
      wreck.status !== 0 && wreck.status !== null && wreck.status !== 1
        && /wreck\.ts/.test(`${wreck.stderr}${wreck.stdout}`),
      JSON.stringify({ status: wreck.status, err: (wreck.stderr || '').slice(0, 200) }));

    // -- (13) wiring. Unwiring the gate must redden HERE, not go quiet. -----
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    const alias = pkg.scripts?.['check:cli-test-child-env'] ?? '';
    t('a package.json alias invokes this script', /check-cli-test-child-env\.mjs/.test(alias), alias);
    t('...and runs the self-test with it', /--self-test/.test(alias), alias);
    const lintYml = readFileSync(join(REPO_ROOT, '.github/workflows/lint.yml'), 'utf8');
    t('a lint job runs the alias', lintYml.includes('pnpm check:cli-test-child-env'));

    // -- (14) the live tree, as a case rather than as the run's only evidence
    const live = audit(REPO_ROOT);
    t('the live tree resolves a real population (not zero, not a refusal)',
      live.refusal === null && live.files > 0 && live.spawners > 0,
      JSON.stringify({ refusal: live.refusal, files: live.files, spawners: live.spawners }));

    const liveJudgement = live.refusal ? null : judge(live.findings, live.deliberate, readBaseline());
    t('the checked-in ratchet is neither short nor stale against the live tree',
      liveJudgement !== null && liveJudgement.over.length === 0 && liveJudgement.under.length === 0,
      JSON.stringify(liveJudgement && { over: liveJudgement.over, under: liveJudgement.under }));
    t('every DELIBERATE site is still on disk',
      liveJudgement !== null && liveJudgement.missing.length === 0,
      JSON.stringify(liveJudgement && liveJudgement.missing));

    // The two sources #11441 reported missing from the hand-built worklist that
    // preceded this gate. A gate has no worklist, so they are members of the
    // population rather than extra scope -- pinned here because "the derivation
    // covers them" is exactly the kind of claim that rots silently.
    //
    // ⚠️ Pinned as membership of the SCANNED population -- walked, and classified
    // as a spawner, so `bulkEnvReferences` really runs over them. It is NOT
    // pinned as membership of `findings`, which is what the first revision of
    // these two cases asserted. That spelling reads identically on the day it is
    // written and means the opposite: it holds only while the two files still
    // LEAK, so it turned red the moment #11596's burn-down repaired them --
    // an anti-shrink pin sitting on a shrink-only ratchet, and one that reports
    // "the derivation lost this file" when the file is merely clean. A repaired
    // source is still derived and still scanned; that is the claim #11441
    // measured, and it is the one that has to survive the repair.
    const scanned = walkSources(join(REPO_ROOT, POPULATION_ROOT))
      .filter((abs) => {
        const text = readFileSync(abs, 'utf8');
        return /child_process|worker_threads/.test(text)
          && isSpawnerSource(parseSourceFile(abs, text, scriptKindFor(abs)));
      })
      .map((abs) => relative(REPO_ROOT, abs).split(sep).join('/'));
    for (const named of [
      'packages/cli/test/serve-app-anchored-optional-import.e2e.test.ts',
      'packages/cli/test/serve-host-fallback-base.e2e.test.ts',
    ]) {
      t(`the enumerated population contains ${named.split('/').pop()}`,
        live.refusal === null && scanned.includes(named));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-cli-test-child-env self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-cli-test-child-env self-test: ${cases.length} cases pass `
    + '(a bare spread in a spawner reds OUT OF PROCESS and the childEnv() form exits zero through the same entry point; '
    + 'a legitimate non-spawner bulk copy stays green and the same body reds once the file spawns; '
    + 'every member read stays green; the carve-out is site-scoped; the ratchet fails in both directions; '
    + 'and all four refusals are paired with a tree that still returns a verdict).',
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  else if (argv.includes('--list')) process.exit(list());
  else if (argv.includes('--audit-root')) process.exit(auditRoot(argv[argv.indexOf('--audit-root') + 1]));
  else process.exit(main());
}
