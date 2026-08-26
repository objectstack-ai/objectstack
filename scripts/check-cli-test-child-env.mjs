#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-cli-test-child-env (#11341, #11595, #11464) -- a `packages/cli/test`
 * file that SPAWNS a child may not build that child's environment from
 * `process.env` as a whole (#11341), may not leave that environment UNDECLARED
 * (#11595), and -- when the child is the BUILT CLI -- may not hand it a
 * `NODE_ENV` that sends oclif's command lookup back to `src/` (#11464).
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
 * Both rules here are deliberately NEGATIVE -- "no bulk copy reaches a child",
 * "no spawn leaves its child's environment undeclared" -- rather than positive
 * ("every spawn must call `childEnv()`"). The distinction is not cosmetic: a
 * positive rule names the choke point, so it goes stale the moment the choke
 * point is renamed, and it says nothing at all about a call that reaches for
 * some OTHER helper. The negative pair reaches the same place from the other
 * side. Rule 2 demands an `env` option; rule 1 refuses the one spelling of that
 * option which copies the environment wholesale. What is left is an environment
 * the reader can see, whatever it is built by.
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
 * FALSE NEGATIVE, two of them, each measured rather than supposed. (A third --
 * a spawn with NO `env` option at all -- was named here and is now CLOSED by
 * rule 2 above; the eight call sites it covered were repaired in the change
 * that closed it.)
 *
 *   1. **A bulk copy built in a non-spawner file** and handed to a spawner
 *      (`runServe(cwd, args, { env })` re-adds whatever it is given AFTER the
 *      strip). Contrived rather than accidental -- nobody writes it by reaching
 *      for the neighbouring file's shape -- but it is a hole and it is named.
 *   2. **A bulk copy laundered through something this scan cannot see as
 *      `process.env`** -- read out of a module that re-exports it, or rebuilt
 *      key by key. Any text scan or AST scan has this edge.
 *
 * ## What counts as a finding, second rule: a spawn CALL with no `env` (#11595)
 *
 * A spawn that passes no `env` option hands the child `process.env` VERBATIM --
 * `TEST=true`, `VITEST=true`, `VITEST_WORKER_ID`, the lot. That is the same
 * leak as rule 1 in a purer form: `{ ...process.env, NO_COLOR: '1' }` at least
 * lets the author SEE the inheritance they are asking for, while an omitted
 * `env` inherits everything with nothing on the page to read.
 *
 * This rule was this gate's FIRST named false negative and shipped as one,
 * because closing it is a decision about the CONVENTION's reach rather than
 * about the defect: it asserts that every child spawned under
 * `packages/cli/test/**` owes a declared environment, including a `tsx`-on-a-
 * probe-script unit test whose child reads nothing from it. That decision was
 * made, on the record, and it is ⛔ not a per-call judgement any more: the
 * convention's product is not a stripped variable, it is that a child's
 * environment is LEGIBLE AT THE CALL SITE, and that value does not depend on
 * whether this particular child happens to read `VITEST`. Exempting "probes
 * that read nothing from the environment" would put the gate's population back
 * in the hands of whoever writes the next spawn, which is the shape both cards
 * were filed about.
 *
 * So there is ⛔ NO registry for this rule and ⛔ no baseline: the eight sites
 * that predated it were repaired in the SAME change that landed it, precisely
 * so no baseline had to exist. The eight were latent rather than live -- every
 * one spawns `tsx` on a probe or a non-`serve` command, so nothing in those
 * children read `TEST` or `VITEST` -- and that is why they could be repaired
 * outright instead of ratcheted.
 *
 * The site is anchored to the CALL here, which rule 1 deliberately is not (see
 * above). The two anchors are answering different questions and neither
 * substitutes for the other: rule 1 asks "does a bulk copy exist in a file that
 * spawns", which survives the copy being built three functions away; rule 2
 * asks "does THIS call declare an env", which is a property of the call and of
 * nothing else. Rule 2's interprocedural blind spot is therefore not a silent
 * zero -- an options object it cannot read is a FINDING, not a pass:
 *
 *   - `spawn(cmd, args)`                   -- no options object at all
 *   - `spawn(cmd, args, { cwd })`          -- options, no `env` key
 *   - `spawn(cmd, args, { env: undefined })` -- an `env` key that still means
 *     "inherit everything": Node omits `undefined`-valued entries, so this is
 *     the omission wearing the repair's clothes. Zero instances today, flagged
 *     so the class is closed for the NEXT spelling rather than the last one.
 *   - `spawn(cmd, args, opts)` / `{ ...opts }` -- an options object this scan
 *     cannot read. Reported rather than skipped, and the repair is the same
 *     one the convention already asks for: say what the child's environment is
 *     WHERE THE CHILD IS SPAWNED.
 *
 * The options object is located as the last OBJECT LITERAL among the call's
 * arguments rather than by position, because every API on the roster takes a
 * string or path first, an argv array second and a callback last -- so the only
 * object literal is the options -- while a positional table would need one
 * entry per API and would rot the day the roster grows.
 *
 * `promisify(execFile)` wrappers are resolved one level, which is every
 * spelling in the population (`const execFileP = promisify(execFile)`). A
 * wrapper of a wrapper is not followed, and that limit is named here rather
 * than discovered: it would read as a green call site.
 *
 * ## What counts as a finding, third rule: a built-entrypoint spawn whose
 * child resolves from src/ (#11464)
 *
 * A test that spawns `packages/cli/bin/run.js` is asking for the BUILT CLI --
 * the shipped entrypoint, whose commands are declared in `dist/`. A child whose
 * `NODE_ENV` is `development` or `test` is asking `@oclif/core` to resolve those
 * commands from `src/` instead and transpile them on the way. Asking for both
 * is a no-op with a false comment attached: `dist/` is never executed, the
 * suite stays green, and the comment claiming the built entry stays plausible.
 *
 * `@oclif/core@4.13.3` skips its TypeScript path lookup only when `isProd()`,
 * which `lib/util/util.js:66` defines as a NEGATED membership test -- a leading
 * logical-NOT over `['development', 'test'].includes(process.env.NODE_ENV ?? '')`.
 * Measured directly against `Config.load()` on `packages/cli`, with
 * `packages/cli/dist` present, reading back the root plugin's `commandsDir`:
 *
 *   | child NODE_ENV | resolved commandsDir        |
 *   |----------------|-----------------------------|
 *   | unset          | packages/cli/dist/commands  |
 *   | production     | packages/cli/dist/commands  |
 *   | development    | packages/cli/src/commands   |
 *   | test           | packages/cli/src/commands   |
 *
 * ⭐ **Silence is the dangerous half, not the explicit value.** vitest exports
 * `NODE_ENV=test` on its worker, and `childEnv()` deliberately does not strip it
 * (its own header says why). So a spawner that names `bin/run.js` and simply
 * says NOTHING about `NODE_ENV` lands in the rerouted leg by inheritance. The
 * failure does not require anyone to set the variable on purpose, which is why
 * an undeclared `NODE_ENV` at a built-entrypoint spawn is a finding here even
 * though rule 2 is already satisfied by a declared `env`.
 *
 * Negative, like the two above: the rule states that a built-entrypoint spawn's
 * child must be READABLY outside `development`/`test`. It ⛔ names no helper, and
 * ⛔ demands no particular spelling -- `NODE_ENV: undefined` is what the
 * population happens to write, `production` is equally green, and a call that
 * builds its environment some other readable way is green too. A rule saying
 * "must call `childEnv({ NODE_ENV: undefined })`" would stop meaning anything
 * the day the choke point is wrapped.
 *
 * ## Membership is anchored to the CALL, and that is the expensive half
 *
 * Naming `bin/run.js` and SPAWNING it are different acts, and conflating them
 * is not hypothetical: this rule was dispatched with a census listing six
 * spawners, two of which spawn the tsx shim and merely mention the built path.
 * `invocation-loudness.e2e.test.ts` resolves it in order to assert it appears in
 * a diagnostic; `helpers/serve-process.ts` and `login-json-noninteractive` name
 * it in prose while spawning `bin/run-dev.js`. A file-anchored membership test
 * would pull all three into a population they do not belong to and then measure
 * the wrong thing loudly. So membership asks whether the built path is reachable
 * from THIS call's argv -- a literal, or a same-file binding holding one.
 *
 * `bin/run-dev.js` cannot collide with the `bin/run.js` suffix, which matters:
 * the shim is the entrypoint that is SUPPOSED to reach `src/`, and it sets
 * `NODE_ENV=development` itself, before argv is parsed. Spawning it is the
 * repair for a test that wants source, not a violation.
 *
 * ## Why this rule follows one hop when rule 1 refuses to
 *
 * Rule 1 is file-anchored because it cannot chase a value built three functions
 * away, and its header says so. Rule 3 cannot make that trade. Every one of the
 * four built-entrypoint spawns in the population is written
 * `childEnv({ ..., NODE_ENV: undefined, ...env })`, where `env` is the enclosing
 * helper's PARAMETER. Without following that spread, all four are unreadable and
 * the rule reports four findings that say only "this scan gave up" -- a gate
 * that resolves to zero readable sites inside its own population, which is the
 * vacuity this file refuses everywhere else. So the spread is resolved ONE hop,
 * same file, to the arguments its enclosing function is called with, and the
 * finding is reported at the CALLER -- where the value was actually chosen.
 *
 * ⚠️ ONE hop, and the limits are named here rather than discovered: a caller
 * that forwards its own parameter, a caller argument that is not an object
 * literal, a caller literal carrying its own spread, and a helper with no
 * same-file call sites are each reported as UNREADABLE. Never as green.
 *
 * ⛔ There is NO baseline for this rule and there is not going to be one. A site
 * whose ts-path-enabling `NODE_ENV` is the POINT is a {@link DELIBERATE_REROUTE}
 * entry carrying its reason, reviewed by the PR that needs it.
 *
 * ## The registries, and why they are different KINDS
 *
 * {@link DELIBERATE} and {@link DELIBERATE_REROUTE} are DECLARATION registries: the sites that copy the whole
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
 * ⛔ Neither registry has anything to say about rule 2. The baseline holds
 * per-file counts of BULK references and nothing else, and adding an env-less
 * call to it would not silence rule 2 -- which is the point: the sibling gap
 * this gate once named as out of scope (#11595) is closed above, with its eight
 * sites repaired rather than baselined.
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

/**
 * The built-entrypoint spawns whose ts-path-enabling `NODE_ENV` is the POINT,
 * keyed `<repo-relative path>::<enclosing function>` like {@link DELIBERATE},
 * and a DECLARATION registry for the same reason: an entry is the right answer
 * for a site the rule cannot be satisfied at, not a ceiling to be burned down.
 *
 * ⭐ Both entries below are IRREDUCIBLE, and that is the whole justification.
 * `serve-node-env-production-default.e2e.test.ts` varies the child's `NODE_ENV`
 * as its INDEPENDENT VARIABLE -- unset, `development`, `test` -- and asserts
 * what `serve`'s trusted-origin gate does under each. The two set legs cannot
 * be written any other way:
 *
 *   - keeping `bin/run.js` means oclif reroutes to `src/`, by the mechanism
 *     this rule exists to refuse;
 *   - switching those legs to `bin/run-dev.js` pins `NODE_ENV=development`
 *     before argv is parsed, which makes the `test` leg unreachable and the
 *     file's own header ⛔ forbids the switch for the unset leg;
 *   - setting `NODE_ENV` after oclif has resolved the command is not reachable
 *     from outside the child at all.
 *
 * So the pair is not an accident there and there is no spelling that avoids it.
 * ⚠️ What these entries do NOT license is the file's SILENCE about it: its
 * header argues at length that only the shipped, built entrypoint reaches the
 * gate, and never says that two of its three legs therefore execute
 * `src/commands`. That is a comment-truthfulness finding, reported separately;
 * it is ⛔ not something a registry entry can fix.
 *
 * Pinned in BOTH directions by {@link judge}: an entry that stops matching
 * FAILS, so if those legs are ever rewritten the gate says so rather than
 * carrying a carve-out nobody re-reads.
 */
export const DELIBERATE_REROUTE = {
  'packages/cli/test/serve-node-env-production-default.e2e.test.ts::it("NODE_ENV=development (explicit): the gate stays OPEN \u2014 unaffected by the production default")': {
    why: 'NODE_ENV is this file\'s independent variable, not an accident: the leg asserts the trusted-origin gate under an explicit development. bin/run-dev.js cannot express it (it pins development before argv, killing the sibling test leg) and no spelling keeps dist/ while setting the variable.',
  },
  'packages/cli/test/serve-node-env-production-default.e2e.test.ts::it("NODE_ENV=test (explicit): the gate stays OPEN \u2014 unaffected by the production default")': {
    why: 'The sibling leg, same argument, one value over. Keyed separately on purpose -- one entry may silence one site, which is what #12531 made possible.',
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
 * The name a call-argument arrow takes from the call it is passed to:
 * `it("boots the child")`, or `beforeAll` when the call carries no title.
 *
 * DOUBLE quotes around the title, deliberately: the product is a
 * {@link DELIBERATE} key, and this file's string literals are single-quoted, so
 * a key pasted into that registry needs no escaping.
 */
function callbackSiteName(owner) {
  if (!owner || !ts.isCallExpression(owner) || !ts.isIdentifier(owner.expression)) return null;
  const callee = owner.expression.text;
  const title = owner.arguments.find((arg) => ts.isStringLiteralLike(arg));
  return title ? `${callee}("${title.text.replace(/\s+/g, ' ').trim()}")` : callee;
}

/**
 * The nearest enclosing named function, which is the stable half of a site key.
 *
 * A line number is not: any edit above a site moves it, so a registry keyed by
 * line would go stale on unrelated changes and teach its readers to re-run
 * `--update` without looking.
 *
 * ## Why a call-argument arrow is named after its CALL (#12531)
 *
 * The four shapes below -- a function declaration, a method, and an
 * arrow/function expression bound to a variable or to a property -- miss the
 * one that dominates a TEST directory: an arrow passed DIRECTLY as a call
 * argument. `it('boots the child', async () => { ... })`, `beforeAll(async () =>
 * { ... })` and `describe(...)` match none of them, so the walk ran straight
 * past the callback to the source file and attributed the site to
 * `(top-level)`.
 *
 * That was never merely an ugly label. {@link siteKey} is `file::fn` and
 * {@link DELIBERATE} is keyed by it, so two deliberate bulk copies in two
 * `it()` blocks of ONE file both keyed to `<file>::(top-level)` -- and a single
 * registry entry would have silenced BOTH, leaving the second unreviewed by the
 * PR that needed it. That is exactly the carve-out-by-accident shape this
 * file's header says the registry exists to prevent. ⚠️ It was LATENT and not
 * live when it was found: both entries in the registry name real functions
 * (`childEnv`, `leakedEnv`), so nothing was ever mis-keyed. What is closed here
 * is the NEXT entry's problem.
 *
 * So an arrow whose parent is a call with an IDENTIFIER callee is named after
 * that callee plus its first string-literal argument, falling back to the
 * callee alone when there is no literal. Sibling blocks in one file therefore
 * key differently, which is the whole repair -- and rule 2, which has no
 * registry to mis-key, gets the same site in its MESSAGES for free.
 *
 * ⚠️ Three limits, named here so they are pinned rather than discovered:
 *
 *   1. The callee must be an IDENTIFIER. `it.skip('...')` and
 *      `it.each(table)('...')` call through a property access or through
 *      another call, and still walk past to `(top-level)`. That is a choice:
 *      widening to a property-access callee would also capture
 *      `promise.then(() => ...)` and `rows.map(() => ...)`, whose callee is a
 *      WORSE site name than the enclosing test block the walk reaches today.
 *   2. The title's whitespace is collapsed so the name stays one line, but it
 *      is ⛔ never truncated -- two long titles sharing a prefix would collide
 *      again, which is the defect being closed.
 *   3. The nearest NAMED binding still wins, unchanged: a helper declared
 *      inside an `it()` block is named after the helper, not after the block.
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
      const called = callbackSiteName(owner);
      if (called) return called;
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

// ---------------------------------------------------------------------------
// Rule 2 (#11595): the CALL-anchored scan -- every spawn declares its env
// ---------------------------------------------------------------------------

/** Every process-creating API on the roster, flattened. */
const SPAWN_APIS = new Set(Object.values(SPAWN_MODULES).flat());

/** Why a call was reported. Exported so the self-test names them, not strings. */
export const ENVLESS = {
  MISSING: 'no options object at all -- the child inherits process.env verbatim',
  NO_ENV: 'an options object with no `env` key -- the child inherits process.env verbatim',
  UNDEFINED: '`env: undefined`, which Node OMITS -- the child still inherits process.env verbatim',
  OPAQUE: 'an options object this scan cannot read (not a literal, or an unresolvable spread)',
};

/** The same value wearing punctuation or a type assertion. */
function unwrapValue(node) {
  let cursor = node;
  while (cursor && (ts.isParenthesizedExpression(cursor) || ts.isAsExpression(cursor) || ts.isNonNullExpression(cursor))) {
    cursor = cursor.expression;
  }
  return cursor;
}

/** A property's static name, or `null` when it is computed from something dynamic. */
function propertyKey(prop) {
  if (ts.isShorthandPropertyAssignment(prop)) return prop.name.text;
  const name = prop.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return null;
}

/** `promisify(execFile)` -- resolved ONE level, which is every spelling in the population. */
function promisifiedApi(initializer, ctx) {
  const call = unwrapValue(initializer);
  if (!call || !ts.isCallExpression(call) || call.arguments.length !== 1) return null;
  const callee = unwrapValue(call.expression);
  const isPromisify = (ts.isIdentifier(callee) && ctx.promisifiers.has(callee.text))
    || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
      && ctx.utilNamespaces.has(callee.expression.text) && callee.name.text === 'promisify');
  if (!isPromisify) return null;
  const arg = unwrapValue(call.arguments[0]);
  if (ts.isIdentifier(arg)) return ctx.direct.get(arg.text) ?? null;
  if (ts.isPropertyAccessExpression(arg) && ts.isIdentifier(arg.expression)
    && ctx.namespaces.has(arg.expression.text) && SPAWN_APIS.has(arg.name.text)) {
    return arg.name.text;
  }
  return null;
}

/**
 * Every local name in one source that reaches a process-creating API.
 *
 * `direct` maps a callable identifier to the roster API behind it -- a named
 * import, an aliased one (`execFile as ef`), or a `promisify()` wrapper of
 * either. `namespaces` holds the bindings that stand for a whole spawn module,
 * so `cp.spawn(...)` resolves too.
 */
export function spawnBindings(sourceFile) {
  const direct = new Map();
  const namespaces = new Set();
  const promisifiers = new Set();
  const utilNamespaces = new Set();

  const visitImports = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (!clause) return;
      const mod = bareModuleName(node.moduleSpecifier.text);
      const roster = SPAWN_MODULES[mod];
      const named = clause.namedBindings;
      if (roster) {
        if (clause.name) namespaces.add(clause.name.text);
        if (named && ts.isNamespaceImport(named)) namespaces.add(named.name.text);
        if (named && ts.isNamedImports(named)) {
          for (const el of named.elements) {
            if (el.isTypeOnly) continue;
            const original = (el.propertyName ?? el.name).text;
            if (roster.includes(original)) direct.set(el.name.text, original);
          }
        }
      }
      if (mod === 'util') {
        if (clause.name) utilNamespaces.add(clause.name.text);
        if (named && ts.isNamespaceImport(named)) utilNamespaces.add(named.name.text);
        if (named && ts.isNamedImports(named)) {
          for (const el of named.elements) {
            if (el.isTypeOnly) continue;
            if ((el.propertyName ?? el.name).text === 'promisify') promisifiers.add(el.name.text);
          }
        }
      }
      return;
    }
    ts.forEachChild(node, visitImports);
  };
  visitImports(sourceFile);

  const ctx = { direct, namespaces, promisifiers, utilNamespaces };
  const visitWrappers = (node) => {
    if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.initializer) {
      const api = promisifiedApi(node.initializer, ctx);
      if (api) direct.set(node.name.text, api);
    }
    ts.forEachChild(node, visitWrappers);
  };
  visitWrappers(sourceFile);

  return { direct, namespaces };
}

/** Which roster API does this call or `new` reach, if any? */
function spawnApiOf(node, bindings) {
  const callee = unwrapValue(node.expression);
  if (!callee) return null;
  if (ts.isIdentifier(callee)) return bindings.direct.get(callee.text) ?? null;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
    && bindings.namespaces.has(callee.expression.text) && SPAWN_APIS.has(callee.name.text)) {
    return callee.name.text;
  }
  if (ts.isElementAccessExpression(callee) && ts.isIdentifier(callee.expression)
    && bindings.namespaces.has(callee.expression.text)
    && callee.argumentExpression && ts.isStringLiteralLike(callee.argumentExpression)
    && SPAWN_APIS.has(callee.argumentExpression.text)) {
    return callee.argumentExpression.text;
  }
  return null;
}

/** An argument whose SHAPE rules it out as the options object. */
function cannotBeOptions(arg) {
  const node = unwrapValue(arg);
  if (!node) return false;
  return ts.isStringLiteralLike(node) || ts.isTemplateExpression(node) || ts.isArrayLiteralExpression(node)
    || ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

/**
 * Does this spawn call declare its child's environment? `null` when it does.
 *
 * The options object is the LAST object literal among the arguments -- see the
 * header for why that beats a positional table.
 */
export function undeclaredEnvReason(node) {
  const args = node.arguments ?? [];
  const literals = args.filter((arg) => {
    const value = unwrapValue(arg);
    return value && ts.isObjectLiteralExpression(value);
  });
  if (literals.length === 0) {
    const couldBeOptions = args.some((arg, index) => index > 0 && !cannotBeOptions(arg));
    return couldBeOptions ? ENVLESS.OPAQUE : ENVLESS.MISSING;
  }
  const options = unwrapValue(literals[literals.length - 1]);
  let spread = false;
  for (const prop of options.properties) {
    if (ts.isSpreadAssignment(prop)) {
      spread = true;
      continue;
    }
    if (propertyKey(prop) !== 'env') continue;
    if (!ts.isPropertyAssignment(prop)) return null;
    const value = unwrapValue(prop.initializer);
    if (value && ((ts.isIdentifier(value) && value.text === 'undefined') || ts.isVoidExpression(value))) {
      return ENVLESS.UNDEFINED;
    }
    return null;
  }
  return spread ? ENVLESS.OPAQUE : ENVLESS.NO_ENV;
}

/**
 * The spawn CALLS in one source, and which of them leave the child's
 * environment undeclared.
 *
 * `calls` is returned alongside `undeclared` because an empty `undeclared` on
 * its own is indistinguishable from a scan that resolved no calls at all --
 * the same vacuity this gate refuses everywhere else. It is not a REFUSAL here
 * (a file that imports `execFile` and never calls it is an ordinary, legal
 * state) but it IS reported, counted across the tree, and pinned against the
 * live population by the self-test.
 *
 * @returns {{calls: number, undeclared: Array<{line: number, fn: string, api: string, reason: string, text: string}>}}
 */
export function envlessSpawnCalls(fileName, source) {
  const sourceFile = parseSourceFile(fileName, source, scriptKindFor(fileName));
  const bindings = spawnBindings(sourceFile);
  const found = [];
  let calls = 0;
  const visit = (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const api = spawnApiOf(node, bindings);
      if (api) {
        calls += 1;
        const reason = undeclaredEnvReason(node);
        if (reason) {
          found.push({
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            fn: enclosingFunctionName(node, sourceFile),
            api,
            reason,
            text: node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 72),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { calls, undeclared: found };
}

// ---------------------------------------------------------------------------
// Rule 3 (#11464): the built entrypoint and a ts-path-enabling NODE_ENV
// ---------------------------------------------------------------------------

/** `bin/run.js` -- the SHIPPED entrypoint, whose commands live in `dist/`. */
const BUILT_ENTRYPOINT = 'bin/run.js';

/**
 * The `NODE_ENV` values that send `@oclif/core`'s command lookup to `src/`.
 *
 * `@oclif/core@4.13.3` skips its TypeScript path lookup only when `isProd()`,
 * which `lib/util/util.js:66` defines as a NEGATED membership test:
 * `!['development', 'test'].includes(process.env.NODE_ENV ?? '')`. So these two
 * values -- and only these two -- turn the reroute ON. `production` and unset
 * both leave it off, which is why the rule below refuses a SET of values rather
 * than demanding one particular spelling.
 */
export const TS_PATH_NODE_ENV = new Set(['development', 'test']);

/** Why a built-entrypoint spawn was reported. Exported so the self-test names them. */
export const REROUTE = {
  INHERITED: 'the child\'s NODE_ENV is not declared at this call, so the vitest worker\'s NODE_ENV=test reaches it and oclif resolves commands from src/',
  REROUTED: 'the child is handed a NODE_ENV of development or test, so oclif resolves commands from src/ -- which cancels the bin/run.js spawn',
  OPAQUE: 'the child\'s NODE_ENV cannot be read here (an env this scan cannot resolve, or an override it cannot follow)',
};

/** Does this expression hold a string literal naming the built entrypoint? */
function namesBuiltEntrypoint(node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isStringLiteralLike(n) && n.text.endsWith(BUILT_ENTRYPOINT)) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * Every local binding in one source that stands for the built entrypoint.
 *
 * `const CLI = resolve(HERE, '../bin/run.js')` is the only spelling in the
 * population, but the test is on the LITERAL rather than on the call around it,
 * so `join(...)`, a template or a bare string all resolve the same way.
 *
 * ⚠️ `bin/run-dev.js` does not end with `bin/run.js`, so the tsx shim -- which
 * is the OTHER entrypoint and the one that is SUPPOSED to reach `src/` -- can
 * never be caught by this suffix.
 */
export function builtEntrypointBindings(sourceFile) {
  const names = new Set();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name)
      && node.initializer && namesBuiltEntrypoint(node.initializer)) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/**
 * Does this spawn call's ARGV reach the built entrypoint?
 *
 * Anchored to the call rather than to the file, because naming `bin/run.js` and
 * SPAWNING it are different acts: `invocation-loudness.e2e.test.ts` resolves the
 * path in order to assert it appears in a diagnostic, and spawns the tsx shim.
 * A file-anchored membership test would put that file in the population and the
 * rule would be measuring the wrong thing.
 *
 * Object literals are skipped: the options object is not argv, and the `env` it
 * carries is what the rule reads NEXT rather than part of what is being run.
 */
function spawnsBuiltEntrypoint(node, entryBindings) {
  let found = false;
  const visit = (n) => {
    if (found || ts.isObjectLiteralExpression(n)) return;
    if (ts.isStringLiteralLike(n) && n.text.endsWith(BUILT_ENTRYPOINT)) found = true;
    else if (ts.isIdentifier(n) && entryBindings.has(n.text)) found = true;
    else ts.forEachChild(n, visit);
  };
  for (const arg of node.arguments ?? []) visit(arg);
  return found;
}

/**
 * The object literal a spawn call's child environment is built from.
 *
 * `env: { ... }` is read directly; `env: childEnv({ ... })` is read through one
 * call, taking its last object-literal argument -- which is where every
 * override in this population lives. ⛔ The helper is NOT named or required:
 * the rule stays negative, so a call that builds its environment some other
 * READABLE way is green, and one this scan cannot follow is a finding.
 *
 * @returns {{state: 'literal', node: ts.ObjectLiteralExpression}
 *   | {state: 'unreadable'} | {state: 'absent'}}
 */
function childEnvLiteral(node) {
  const args = node.arguments ?? [];
  const literals = args.filter((arg) => {
    const value = unwrapValue(arg);
    return value && ts.isObjectLiteralExpression(value);
  });
  if (literals.length === 0) return { state: 'absent' };
  const options = unwrapValue(literals[literals.length - 1]);
  for (const prop of options.properties) {
    if (ts.isSpreadAssignment(prop)) continue;
    if (propertyKey(prop) !== 'env') continue;
    if (!ts.isPropertyAssignment(prop)) return { state: 'unreadable' };
    const value = unwrapValue(prop.initializer);
    if (!value) return { state: 'unreadable' };
    if (ts.isObjectLiteralExpression(value)) return { state: 'literal', node: value };
    if (ts.isCallExpression(value)) {
      const objects = value.arguments.filter((arg) => {
        const inner = unwrapValue(arg);
        return inner && ts.isObjectLiteralExpression(inner);
      });
      // ⛔ A call with no readable overrides is UNREADABLE, not "inherits".
      // Reading it as inheritance would mean assuming the callee behaves like
      // childEnv() -- knowledge of a helper this rule deliberately does not
      // name. Both are findings; only an unreadable one says the honest thing
      // about what was measured.
      if (objects.length === 0) return { state: 'unreadable' };
      return { state: 'literal', node: unwrapValue(objects[objects.length - 1]) };
    }
    return { state: 'unreadable' };
  }
  return { state: 'absent' };
}

/** What one object literal says about `NODE_ENV`, ignoring spreads. */
function declaredNodeEnv(literal) {
  let verdict = { kind: 'silent' };
  for (const prop of literal.properties) {
    if (ts.isSpreadAssignment(prop)) continue;
    if (propertyKey(prop) !== 'NODE_ENV') continue;
    if (!ts.isPropertyAssignment(prop)) {
      verdict = { kind: 'unreadable' };
      continue;
    }
    const value = unwrapValue(prop.initializer);
    if (value && ts.isStringLiteralLike(value)) verdict = { kind: 'value', value: value.text };
    else if (value && ((ts.isIdentifier(value) && value.text === 'undefined') || ts.isVoidExpression(value))) {
      verdict = { kind: 'unset' };
    } else verdict = { kind: 'unreadable' };
  }
  return verdict;
}

/** The spreads that appear AFTER the last `NODE_ENV` entry -- the only ones that can override it. */
function overridingSpreads(literal) {
  const props = literal.properties;
  let lastNodeEnv = -1;
  for (let i = 0; i < props.length; i += 1) {
    if (!ts.isSpreadAssignment(props[i]) && propertyKey(props[i]) === 'NODE_ENV') lastNodeEnv = i;
  }
  return props.filter((prop, i) => ts.isSpreadAssignment(prop) && i > lastNodeEnv);
}

/**
 * The nearest enclosing function whose PARAMETERS can be resolved, with the
 * name its same-file callers use.
 */
function enclosingResolvableFunction(node) {
  let cursor = node.parent;
  while (cursor) {
    if (ts.isFunctionDeclaration(cursor) && cursor.name) return { fn: cursor, name: cursor.name.text };
    if ((ts.isArrowFunction(cursor) || ts.isFunctionExpression(cursor)) && cursor.parent
      && ts.isVariableDeclaration(cursor.parent) && ts.isIdentifier(cursor.parent.name)) {
      return { fn: cursor, name: cursor.parent.name.text };
    }
    cursor = cursor.parent;
  }
  return null;
}

/** Every same-file call of `name`, paired with its argument at `index`. */
function callSiteArguments(sourceFile, name, index) {
  const sites = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      sites.push({ call: node, arg: node.arguments[index] ?? null });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

/**
 * Resolve one spread ONE HOP, to the arguments its enclosing function is called
 * with in the same file.
 *
 * ## Why this hop is not optional
 *
 * Rule 1 is file-anchored precisely BECAUSE it cannot follow a hop of this
 * shape, and its header says so. Rule 3 cannot make the same trade: every one
 * of the four built-entrypoint spawns in the population is written
 * `childEnv({ ..., NODE_ENV: undefined, ...env })`, where `env` is the enclosing
 * helper's parameter. Without the hop, ALL FOUR are unreadable and the rule
 * reports four findings that say only "this scan gave up" -- a gate that
 * resolves to zero readable sites in its own population, which is the vacuity
 * this file refuses everywhere else. With the hop, the same four are decided
 * from what their callers actually pass.
 *
 * ⚠️ ONE hop, same file, and the limit is named here rather than discovered:
 * a caller that forwards ITS own parameter is not followed and is reported as
 * unreadable, never as green.
 *
 * @returns {Array<{node: ts.Node, verdict: {kind: string, value?: string}}>}
 */
function resolveSpread(spread, sourceFile) {
  const source = unwrapValue(spread.expression);
  if (!source || !ts.isIdentifier(source)) return [{ node: spread, verdict: { kind: 'unreadable' } }];
  const enclosing = enclosingResolvableFunction(spread);
  if (!enclosing) return [{ node: spread, verdict: { kind: 'unreadable' } }];
  const index = enclosing.fn.parameters.findIndex(
    (param) => ts.isIdentifier(param.name) && param.name.text === source.text,
  );
  if (index < 0) return [{ node: spread, verdict: { kind: 'unreadable' } }];

  const sites = callSiteArguments(sourceFile, enclosing.name, index);
  if (sites.length === 0) return [{ node: spread, verdict: { kind: 'unreadable' } }];

  return sites.map((site) => {
    if (!site.arg) return { node: site.call, verdict: { kind: 'silent' } };
    const value = unwrapValue(site.arg);
    if (!value || !ts.isObjectLiteralExpression(value)) {
      return { node: site.call, verdict: { kind: 'unreadable' } };
    }
    // A nested spread inside the caller's own literal is a second hop.
    if (overridingSpreads(value).length > 0) return { node: site.call, verdict: { kind: 'unreadable' } };
    return { node: site.call, verdict: declaredNodeEnv(value) };
  });
}

/** A verdict about one child's NODE_ENV, turned into a reason or into nothing. */
function reasonFor(verdict, base) {
  const effective = verdict.kind === 'silent' ? base : verdict;
  if (effective.kind === 'unreadable') return REROUTE.OPAQUE;
  if (effective.kind === 'silent') return REROUTE.INHERITED;
  if (effective.kind === 'value' && TS_PATH_NODE_ENV.has(effective.value)) return REROUTE.REROUTED;
  return null;
}

/**
 * The built-entrypoint spawns in one source, and which of them let their child
 * resolve commands from `src/`.
 *
 * `spawns` is returned alongside `findings` for the reason rule 2 returns its
 * call count: an empty finding list reads identically whether every spawn is
 * sound or the entrypoint resolution stopped resolving anything.
 *
 * @returns {{spawns: number, findings: Array<{line: number, fn: string, api: string, reason: string, text: string}>}}
 */
export function builtEntrypointSpawns(fileName, source) {
  const sourceFile = parseSourceFile(fileName, source, scriptKindFor(fileName));
  const bindings = spawnBindings(sourceFile);
  const entryBindings = builtEntrypointBindings(sourceFile);
  const findings = [];
  let spawns = 0;

  const report = (node, api, reason) => {
    findings.push({
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      fn: enclosingFunctionName(node, sourceFile),
      api,
      reason,
      text: node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 72),
    });
  };

  const visit = (node) => {
    if ((ts.isCallExpression(node) || ts.isNewExpression(node))) {
      const api = spawnApiOf(node, bindings);
      if (api && spawnsBuiltEntrypoint(node, entryBindings)) {
        spawns += 1;
        const env = childEnvLiteral(node);
        if (env.state === 'unreadable') report(node, api, REROUTE.OPAQUE);
        else if (env.state === 'absent') report(node, api, REROUTE.INHERITED);
        else {
          const base = declaredNodeEnv(env.node);
          const spreads = overridingSpreads(env.node);
          if (spreads.length === 0) {
            const reason = reasonFor(base, base);
            if (reason) report(node, api, reason);
          } else {
            for (const spread of spreads) {
              for (const resolved of resolveSpread(spread, sourceFile)) {
                const reason = reasonFor(resolved.verdict, base);
                // The override's own site is where the value was CHOSEN, so
                // that is what the message and the registry key name.
                if (reason) report(resolved.node, api, reason);
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { spawns, findings };
}

/** The site key a registry entry is written against. */
export const siteKey = (row) => `${row.file}::${row.fn}`;

/**
 * Audit one tree. Returns the census and either the findings or a refusal --
 * never an empty finding list standing in for a population it could not read.
 *
 * @param {string} root  A directory containing the population root.
 * @param {Record<string, {why: string}>} registry  The declaration registry to
 *   classify against. Defaults to {@link DELIBERATE}, which is what every
 *   caller but the self-test uses. The parameter exists because the property
 *   the site key has to hold -- that ONE entry silences ONE site -- cannot be
 *   asserted against the live registry, whose two entries sit in two different
 *   files and name real functions. A synthesised registry is what lets the
 *   #12531 collision be shown GONE through the real classification path,
 *   rather than read off a key string.
 * @param {Record<string, {why: string}>} rerouteRegistry  The same, for rule 3.
 */
export function audit(root, registry = DELIBERATE, rerouteRegistry = DELIBERATE_REROUTE) {
  const populationDir = join(root, POPULATION_ROOT);
  let exists = false;
  try {
    exists = statSync(populationDir).isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) {
    return { files: 0, spawners: 0, spawnCalls: 0, findings: [], deliberate: [], envless: [], rerouted: [], deliberateReroute: [], builtSpawns: 0, refusal: `the population root ${POPULATION} does not resolve to a directory under ${root}` };
  }

  const files = walkSources(populationDir);
  if (files.length === 0) {
    return { files: 0, spawners: 0, spawnCalls: 0, findings: [], deliberate: [], envless: [], rerouted: [], deliberateReroute: [], builtSpawns: 0, refusal: `${POPULATION} resolved to a directory containing no TypeScript source` };
  }

  const findings = [];
  const deliberate = [];
  const envless = [];
  const rerouted = [];
  const deliberateReroute = [];
  let spawners = 0;
  let spawnCalls = 0;
  let builtSpawns = 0;
  for (const abs of files) {
    const rel = relative(root, abs).split(sep).join('/');
    let source;
    try {
      source = readFileSync(abs, 'utf8');
    } catch (error) {
      return {
        files: files.length,
        spawners,
        spawnCalls,
        findings: [],
        deliberate: [],
        envless: [],
        rerouted: [],
        deliberateReroute: [],
        builtSpawns: 0,
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
      (Object.hasOwn(registry, siteKey(row)) ? deliberate : findings).push(row);
    }
    const calls = envlessSpawnCalls(abs, source);
    spawnCalls += calls.calls;
    for (const hit of calls.undeclared) envless.push({ file: rel, ...hit });

    const built = builtEntrypointSpawns(abs, source);
    builtSpawns += built.spawns;
    for (const hit of built.findings) {
      const row = { file: rel, ...hit };
      (Object.hasOwn(rerouteRegistry, siteKey(row)) ? deliberateReroute : rerouted).push(row);
    }
  }

  if (spawners === 0) {
    return {
      files: files.length,
      spawners: 0,
      spawnCalls: 0,
      findings: [],
      deliberate: [],
      envless: [],
      rerouted: [],
      deliberateReroute: [],
      builtSpawns: 0,
      refusal: `${files.length} source(s) under ${POPULATION} and not one of them spawns a child -- the population is unresolvable, which is not the same as clean`,
    };
  }

  return { files: files.length, spawners, spawnCalls, builtSpawns, findings, deliberate, envless, rerouted, deliberateReroute, refusal: null };
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
export function judge(findings, deliberate, baseline, deliberateReroute = []) {
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
  const seenReroute = new Set(deliberateReroute.map(siteKey));
  const missingReroute = Object.keys(DELIBERATE_REROUTE).filter((key) => !seenReroute.has(key));
  return {
    over,
    under,
    missing,
    missingReroute,
    held: deliberate.length,
    heldReroute: deliberateReroute.length,
  };
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
  const { files, spawners, spawnCalls, builtSpawns, findings, deliberate, envless, rerouted, deliberateReroute, refusal } = audit(REPO_ROOT);
  if (refusal) {
    console.error(`❌  check:cli-test-child-env -- REFUSING to report a verdict: ${refusal}.`);
    console.error(
      '\n    A gate that computes its own population can pass while reading nothing,'
      + '\n    and an empty finding list is indistinguishable from a clean one. This'
      + '\n    exits non-zero instead. Restore the population or fix the tool.',
    );
    return 1;
  }

  if (envless.length) {
    console.error(`❌  check:cli-test-child-env -- ${envless.length} spawn call(s) leave the child's environment UNDECLARED:\n`);
    for (const row of envless) {
      console.error(`  ${row.file}:${row.line}  [${row.fn}]  ${row.api}  ${row.text}`);
      console.error(`    ${row.reason}`);
    }
    console.error(
      '\n    A spawn with no `env` option hands the child THIS process\'s environment'
      + '\n    verbatim -- under vitest that is the worker\'s: TEST=true, VITEST=true and'
      + '\n    the VITEST_* family. It is the same leak a bare { ...process.env } spread'
      + '\n    is, in a purer form: the spread at least lets the author SEE the'
      + '\n    inheritance they are asking for, while an omitted `env` inherits'
      + '\n    everything with nothing on the page to read.'
      + '\n'
      + '\n    The repair is the same choke point:'
      + '\n'
      + '\n      import { childEnv } from \'./helpers/serve-process.js\';'
      + '\n      execFileSync(TSX, [probe], { cwd, env: childEnv() });'
      + '\n'
      + '\n    ⛔ There is NO baseline and NO carve-out for this rule, and "this child'
      + '\n    reads nothing from the environment" is not one. Every spawned child under'
      + `\n    ${POPULATION} owes a DECLARED environment: the convention\'s product is that`
      + '\n    a child\'s environment is legible AT THE CALL SITE, which does not depend on'
      + '\n    what this particular child happens to read. Exempting the quiet ones puts'
      + '\n    the population back in the hands of whoever writes the next spawn.'
      + '\n'
      + '\n    This rule asks only that `env` be DECLARED -- it does not name childEnv(),'
      + '\n    so a child that genuinely needs something else can say so. What it may not'
      + '\n    be declared as is the whole of process.env: that is the rule above.',
    );
    return 1;
  }

  if (rerouted.length) {
    console.error(`❌  check:cli-test-child-env -- ${rerouted.length} spawn(s) of the BUILT CLI let the child resolve commands from src/:\n`);
    for (const row of rerouted) {
      console.error(`  ${row.file}:${row.line}  [${row.fn}]  ${row.api}  ${row.text}`);
      console.error(`    ${row.reason}`);
    }
    console.error(
      '\n    A test that spawns packages/cli/bin/run.js is asking for the BUILT CLI --'
      + '\n    the shipped entrypoint, whose commands live in dist/. A child whose NODE_ENV'
      + '\n    is `development` or `test` is asking @oclif/core to resolve those commands'
      + '\n    from src/ instead and transpile them on the fly. Asking for both cancels:'
      + '\n    dist/ is never executed, and the comment claiming the built entry stays'
      + '\n    plausible. Measured against @oclif/core@4.13.3\'s own Config.load(), reading'
      + '\n    back the root plugin\'s resolved commandsDir:'
      + '\n'
      + '\n      NODE_ENV unset        -> packages/cli/dist/commands'
      + '\n      NODE_ENV=production   -> packages/cli/dist/commands'
      + '\n      NODE_ENV=development  -> packages/cli/src/commands'
      + '\n      NODE_ENV=test         -> packages/cli/src/commands'
      + '\n'
      + '\n    lib/util/util.js:66 defines isProd() as a NEGATED membership test --'
      + '\n    !["development","test"].includes(process.env.NODE_ENV ?? "") -- and the'
      + '\n    TypeScript path lookup is skipped only when that is true.'
      + '\n'
      + '\n    ⚠️ SILENCE IS NOT SAFE, which is why an undeclared NODE_ENV reds here too.'
      + '\n    vitest exports NODE_ENV=test on its worker and childEnv() deliberately does'
      + '\n    NOT strip it (its header says why), so a spawn that names bin/run.js and'
      + '\n    simply says nothing about NODE_ENV lands in the rerouted leg BY INHERITANCE.'
      + '\n    The failure does not require anyone to set the variable on purpose.'
      + '\n'
      + '\n    This rule names no helper and demands no particular spelling. It asks only'
      + '\n    that the child of a built-entrypoint spawn be READABLY not in development or'
      + '\n    test. What the population does today is say so at the call:'
      + '\n'
      + '\n      spawn(process.execPath, [CLI, \'serve\'], { cwd, env: childEnv({ NODE_ENV: undefined }) });'
      + '\n'
      + '\n    If the CLI under test is meant to run from src/, spawn bin/run-dev.js --'
      + '\n    the tsx shim, which is the entrypoint that means that -- rather than'
      + '\n    disabling bin/run.js from the outside.'
      + '\n'
      + '\n    ⛔ There is NO baseline for this rule. A site whose ts-path-enabling NODE_ENV'
      + '\n    is the POINT -- one that varies NODE_ENV as its own independent variable --'
      + '\n    is a DELIBERATE_REROUTE entry in scripts/check-cli-test-child-env.mjs'
      + '\n    carrying its reason, reviewed by the PR that needs it, and pinned in both'
      + '\n    directions so it cannot outlive the site.',
    );
    return 1;
  }

  const baseline = readBaseline();
  const { over, under, missing, missingReroute, held, heldReroute } = judge(findings, deliberate, baseline, deliberateReroute);

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

  if (missingReroute.length) {
    console.error(`❌  check:cli-test-child-env -- ${missingReroute.length} DELIBERATE_REROUTE site(s) no longer present:\n`);
    for (const key of missingReroute) console.error(`  ${key}\n    was: ${DELIBERATE_REROUTE[key].why}`);
    console.error(
      '\n    These are the built-entrypoint spawns whose ts-path-enabling NODE_ENV is the'
      + '\n    POINT -- a leg that varies NODE_ENV as its own independent variable. Each is'
      + '\n    pinned in both directions so a carve-out cannot outlive the site it was'
      + '\n    written for and quietly cover the next one that keys the same way.'
      + '\n'
      + '\n    If the site really is gone, delete its DELIBERATE_REROUTE entry in the same'
      + '\n    commit. If it merely MOVED -- a renamed it() title re-keys it -- update the'
      + '\n    key and say so in the PR body.',
    );
    return 1;
  }

  const remaining = Object.values(baseline).reduce((a, b) => a + b, 0);
  console.log(
    `✓ check:cli-test-child-env: ${spawners} spawner source(s) among ${files} under ${POPULATION}; `
    + `no new bulk process.env copy reaches a spawned child, all ${spawnCalls} spawn call(s) declare their child's env, `
    + `and all ${builtSpawns} spawn(s) of the built CLI keep their child out of development/test `
    + `(${remaining} baselined in ${Object.keys(baseline).length} file(s), ⛔ SHRINK-ONLY; `
    + `${held} deliberate site(s) and ${heldReroute} deliberate reroute(s) still pinned).`,
  );
  return 0;
}

/** `--list`: the whole census, for burning the ratchet down. */
function list() {
  const { files, spawners, spawnCalls, builtSpawns, findings, deliberate, envless, rerouted, deliberateReroute, refusal } = audit(REPO_ROOT);
  if (refusal) {
    console.error(`REFUSED: ${refusal}`);
    return 1;
  }
  for (const row of envless.sort((a, b) => siteKey(a).localeCompare(siteKey(b)))) {
    console.log(`undeclared  ${row.file}:${row.line}  [${row.fn}]  ${row.api}  ${row.text}`);
  }
  for (const row of rerouted.sort((a, b) => siteKey(a).localeCompare(siteKey(b)))) {
    console.log(`rerouted    ${row.file}:${row.line}  [${row.fn}]  ${row.api}  ${row.text}`);
  }
  for (const row of deliberate.sort((a, b) => siteKey(a).localeCompare(siteKey(b)))) {
    console.log(`deliberate  ${row.file}:${row.line}  [${row.fn}]`);
  }
  for (const row of deliberateReroute.sort((a, b) => siteKey(a).localeCompare(siteKey(b)))) {
    console.log(`declared-reroute  ${row.file}:${row.line}  [${row.fn}]`);
  }
  for (const row of findings.sort((a, b) => siteKey(a).localeCompare(siteKey(b)))) {
    console.log(`baselined   ${row.file}:${row.line}  [${row.fn}]  ${row.text}`);
  }
  console.log(
    `\n${spawners} spawner source(s) in ${files}; ${spawnCalls} spawn call(s), ${envless.length} undeclared; `
    + `${builtSpawns} built-entrypoint spawn(s), ${rerouted.length} rerouted, ${deliberateReroute.length} declared; `
    + `${findings.length} bulk copy/copies, ${deliberate.length} deliberate.`,
  );
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
  const { files, spawners, spawnCalls, builtSpawns, findings, deliberate, envless, rerouted, refusal } = audit(root);
  if (refusal) {
    console.error(`REFUSED: ${refusal}`);
    return 1;
  }
  if (findings.length || envless.length || rerouted.length) {
    for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.fn}]  ${f.text}`);
    for (const f of envless) console.error(`  ${f.file}:${f.line}  [${f.fn}]  ${f.api}  ${f.reason}`);
    for (const f of rerouted) console.error(`  ${f.file}:${f.line}  [${f.fn}]  ${f.api}  ${f.reason}`);
    console.error(`FOUND files=${files} spawners=${spawners} calls=${spawnCalls} built=${builtSpawns} findings=${findings.length} envless=${envless.length} rerouted=${rerouted.length}`);
    return 1;
  }
  console.log(`OK files=${files} spawners=${spawners} calls=${spawnCalls} built=${builtSpawns} findings=0 envless=0 rerouted=0 deliberate=${deliberate.length}`);
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
  /**
   * A spawner file whose body sits at TOP LEVEL rather than inside a named
   * function -- the shape a real test file has, and the one the site-naming
   * cases below need: wrapping them in `runCli` would name every site `runCli`
   * and measure nothing about the walk.
   */
  const suite = (body) => `import { execFile } from 'node:child_process';\nvoid execFile;\n${body}\n`;

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
   * a measurement.
   *
   * ⚠️ It declares its child's `env`. The first revision of this companion
   * spawned with NO `env` option, carrying a comment that this was "the leak
   * this gate deliberately does not cover" -- true when it was written, and
   * false the moment rule 2 (#11595) landed. A companion that itself violates
   * the rule under test contributes a finding to every fixture it is added to,
   * which would make each of those cases fail for a reason that has nothing to
   * do with its subject.
   */
  const COMPANION = { 'companion.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: childEnv() });') };

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

    // -- (8b) SITE NAMING (#12531): a callback arrow is named after its CALL
    //    An arrow passed DIRECTLY as a call argument matches none of the four
    //    shapes the walk recognises, so before this it ran past `it(...)` and
    //    `beforeAll(...)` to the source file and reported `(top-level)`.

    /** The site names a one-file spawner tree attributes its bulk copies to. */
    const siteNames = (name, sources) => JSON.stringify(scan(name, sources).findings?.map((row) => row.fn));
    const names = (...expected) => JSON.stringify(expected);
    const BULK = '  const e = { ...process.env };\n  void e;';

    t('a bulk copy inside an it() block is named after the BLOCK, not (top-level)',
      siteNames('site-it', { 'a.e2e.test.ts': suite(`it('boots the child', () => {\n${BULK}\n});`) })
        === names('it("boots the child")'));
    t('a callback with no string-literal title falls back to the callee alone',
      siteNames('site-beforeall', { 'a.e2e.test.ts': suite(`beforeAll(async () => {\n${BULK}\n});`) })
        === names('beforeAll'));

    // ⭐ THE case. Two sibling blocks in ONE file must not share a key.
    t('two it() blocks in one file get TWO DISTINCT names -- the collision this closes',
      siteNames('site-siblings', {
        'a.e2e.test.ts': suite(`it('first', () => {\n${BULK}\n});\nit('second', () => {\n${BULK}\n});`),
      }) === names('it("first")', 'it("second")'));

    t('the NEAREST block wins inside a describe()',
      siteNames('site-nested', {
        'a.e2e.test.ts': suite(`describe('outer', () => {\n  it('inner', () => {\n${BULK}\n  });\n});`),
      }) === names('it("inner")'));
    t('a named helper declared inside an it() block still wins over the block',
      siteNames('site-helper', {
        'a.e2e.test.ts': suite(`it('x', () => {\n  function build() {\n    return { ...process.env };\n  }\n  void build;\n});`),
      }) === names('build'));
    t('a variable-bound arrow inside an it() block still wins too',
      siteNames('site-arrow-binding', {
        'a.e2e.test.ts': suite(`it('x', () => {\n  const build = () => ({ ...process.env });\n  void build;\n});`),
      }) === names('build'));
    t('a bulk copy at TOP LEVEL is still (top-level) -- the fallback survives',
      siteNames('site-top', { 'a.e2e.test.ts': suite('export const e = { ...process.env };') })
        === names('(top-level)'));

    t('a template-literal title is a string literal too',
      siteNames('site-template', { 'a.e2e.test.ts': suite(`it(\`boots\`, () => {\n${BULK}\n});`) })
        === names('it("boots")'));
    t('...but a title with SUBSTITUTIONS is not, so the callee alone names it',
      siteNames('site-template-sub', { 'a.e2e.test.ts': suite(`it(\`boots \${n}\`, () => {\n${BULK}\n});`) })
        === names('it'));
    t('a title spanning lines is collapsed to one line, and never truncated',
      siteNames('site-title-wrap', { 'a.e2e.test.ts': suite(`it(\`boots\nthe child\`, () => {\n${BULK}\n});`) })
        === names('it("boots the child")'));

    // The named limit, pinned rather than discovered: a property-access callee
    // is deliberately NOT captured, because `promise.then(...)` and `rows.map(
    // ...)` would be worse site names than the test block the walk reaches.
    t('an it.skip() callee is a property access, not an identifier, so it still reads (top-level)',
      siteNames('site-property-callee', { 'a.e2e.test.ts': suite(`it.skip('x', () => {\n${BULK}\n});`) })
        === names('(top-level)'));

    // ⭐ The collision END TO END, through the real classification path in
    //    audit(). One synthesised entry, two sibling blocks. Before this fix
    //    both rows keyed to `<file>::(top-level)`, so ONE entry classified BOTH
    //    as deliberate and the second was never reviewed by the PR that needed
    //    it -- the carve-out-by-accident this file's header names.
    const siblingRoot = tree('carve-siblings', {
      'a.e2e.test.ts': suite(`it('first', () => {\n${BULK}\n});\nit('second', () => {\n${BULK}\n});`),
    });
    const fnsOf = (result) => JSON.stringify({
      deliberate: result.deliberate.map((row) => row.fn),
      findings: result.findings.map((row) => row.fn),
    });

    const onlyFirst = audit(siblingRoot, { 'packages/cli/test/a.e2e.test.ts::it("first")': { why: 'synthetic' } });
    t('a registry entry for ONE it() block silences THAT block and leaves its sibling a finding',
      fnsOf(onlyFirst) === JSON.stringify({ deliberate: ['it("first")'], findings: ['it("second")'] }),
      fnsOf(onlyFirst));

    const topLevelEntry = audit(siblingRoot, { 'packages/cli/test/a.e2e.test.ts::(top-level)': { why: 'synthetic' } });
    t('...and a (top-level) entry silences NEITHER -- before this fix that ONE entry silenced BOTH',
      fnsOf(topLevelEntry) === JSON.stringify({ deliberate: [], findings: ['it("first")', 'it("second")'] }),
      fnsOf(topLevelEntry));

    // -- (9) RULE 2 (#11595): a spawn CALL that leaves its env undeclared ---
    //    The reds here are the whole point of the rule, so they are pinned by
    //    REASON as well as by count: "reds for some reason" would still pass if
    //    the classifier collapsed every shape into one.
    const undeclared = (name, sources) => audit(tree(name, sources)).envless ?? [];
    const reasons = (name, sources) => undeclared(name, sources).map((row) => row.reason);

    t('a spawn with an options object but NO env key REDS',
      JSON.stringify(reasons('envless-no-env', { 'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd });') }))
        === JSON.stringify([ENVLESS.NO_ENV]));
    t('a spawn with NO options object at all REDS',
      JSON.stringify(reasons('envless-no-options', { 'a.e2e.test.ts': spawner('  execFile(\'x\', []);') }))
        === JSON.stringify([ENVLESS.MISSING]));
    t('...and the childEnv() form stays GREEN under rule 2',
      undeclared('envless-declared', { 'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: childEnv() });') }).length === 0);
    t('a callback after the options object does not hide it',
      undeclared('envless-callback', {
        'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: childEnv() }, (e) => { void e; });'),
      }).length === 0);

    // `env: undefined` is the omission wearing the repair's clothes -- Node
    // omits undefined-valued entries, so the child inherits everything anyway.
    t('`env: undefined` REDS -- Node omits it and the child inherits anyway',
      JSON.stringify(reasons('envless-undefined', { 'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: undefined });') }))
        === JSON.stringify([ENVLESS.UNDEFINED]));
    t('`env: void 0` is the same value with different punctuation',
      JSON.stringify(reasons('envless-void', { 'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: void 0 });') }))
        === JSON.stringify([ENVLESS.UNDEFINED]));

    // An options object this scan cannot read is a FINDING, never a quiet pass
    // -- rule 2's blind spot is the one place a call-anchored rule could go
    // silent, which is the defect this rule exists to close.
    t('an options object passed as an identifier REDS as unreadable, not green',
      JSON.stringify(reasons('envless-opaque-ident', { 'a.e2e.test.ts': spawner('  execFile(\'x\', [], opts);') }))
        === JSON.stringify([ENVLESS.OPAQUE]));
    t('an options literal whose env might come from a SPREAD REDS as unreadable',
      JSON.stringify(reasons('envless-opaque-spread', { 'a.e2e.test.ts': spawner('  execFile(\'x\', [], { ...opts, cwd });') }))
        === JSON.stringify([ENVLESS.OPAQUE]));
    t('...but a spread ALONGSIDE an explicit env is declared, so it stays GREEN',
      undeclared('envless-spread-with-env', {
        'a.e2e.test.ts': spawner('  execFile(\'x\', [], { ...opts, env: childEnv() });'),
      }).length === 0);

    t('a shorthand `{ env }` is a declaration',
      undeclared('envless-shorthand', { 'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env });') }).length === 0);
    t("a computed `{ ['env']: e }` is a declaration too",
      undeclared('envless-computed', { 'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, [\'env\']: e });') }).length === 0);

    // The two rules are INDEPENDENT, in both directions. Neither substitutes
    // for the other, and a fix for one must not read as a fix for the other.
    const bothRules = scan('envless-vs-bulk', {
      'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: { ...process.env } });'),
    });
    t('a bulk spread DECLARES an env, so rule 2 is green on it while rule 1 reds',
      bothRules.findings?.length === 1 && audit(tree('envless-vs-bulk-2', {
        'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: { ...process.env } });'),
      })).envless.length === 0);
    t('...and an env-less spawn holds no bulk reference, so rule 1 is green while rule 2 reds',
      count('bulk-vs-envless', { 'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd });') }) === 0);

    // Every spelling that reaches a spawn API has to reach rule 2 as well.
    t('an ALIASED import is resolved (execFile as ef)',
      undeclared('envless-alias', {
        'a.e2e.test.ts': 'import { execFile as ef } from \'node:child_process\';\nexport function runCli(cwd: string) {\n  ef(\'x\', [], { cwd });\n}\n',
      }).length === 1);
    t('a NAMESPACE call is resolved (cp.execFile)',
      undeclared('envless-namespace', {
        'a.e2e.test.ts': 'import * as cp from \'node:child_process\';\nexport function runCli(cwd: string) {\n  cp.execFile(\'x\', [], { cwd });\n}\n',
      }).length === 1);
    t('a promisify() WRAPPER is resolved one level (const execFileP = promisify(execFile))',
      undeclared('envless-promisify', {
        'a.e2e.test.ts': 'import { execFile } from \'node:child_process\';\nimport { promisify } from \'node:util\';\n'
          + 'const execFileP = promisify(execFile);\nexport async function runCli(cwd: string) {\n  await execFileP(\'x\', [], { cwd });\n}\n',
      }).length === 1);
    t('...and the same wrapper with a declared env stays GREEN',
      undeclared('envless-promisify-ok', {
        'a.e2e.test.ts': 'import { execFile } from \'node:child_process\';\nimport { promisify } from \'node:util\';\n'
          + 'const execFileP = promisify(execFile);\nexport async function runCli(cwd: string) {\n  await execFileP(\'x\', [], { cwd, env: childEnv() });\n}\n',
      }).length === 0);
    t('a worker takes the same inherited env, so `new Worker(file)` REDS',
      undeclared('envless-worker', {
        'a.e2e.test.ts': 'import { Worker } from \'node:worker_threads\';\nexport function runCli(file: string) {\n  new Worker(file);\n}\n',
      }).length === 1);
    t('...and `new Worker(file, { env: childEnv() })` stays GREEN',
      undeclared('envless-worker-ok', {
        'a.e2e.test.ts': 'import { Worker } from \'node:worker_threads\';\nexport function runCli(file: string) {\n  new Worker(file, { env: childEnv() });\n}\n',
      }).length === 0);

    // A spawn API that is imported but never CALLED is not a call site, and an
    // AST is what keeps prose out of the population.
    t('importing a spawn API without calling it is not a call site',
      undeclared('envless-uncalled', { ...COMPANION, 'a.e2e.test.ts': spawner('  void cwd;') }).length === 0);
    t('a commented-out env-less spawn is not a call site',
      undeclared('envless-prose', { ...COMPANION, 'a.e2e.test.ts': spawner('  // execFile(\'x\', []);\n  void cwd;') }).length === 0);

    // Rule 2 has no registry, so it cannot MIS-KEY -- but it names sites in its
    // messages, and `(top-level)` was as unhelpful there. Both rules read the
    // same walk, so this is ONE change and not two (#12531).
    t('rule 2 names the it() block too, so an undeclared env is not reported at (top-level)',
      JSON.stringify(undeclared('envless-in-it', {
        'a.e2e.test.ts': suite('it(\'spawns a probe\', () => {\n  execFile(\'x\', []);\n});'),
      }).map((row) => row.fn)) === names('it("spawns a probe")'));

    // -- (10) the ratchet, in every direction it must move -----------------
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

    // -- (11) every refusal, each PAIRED with a tree that still answers ----
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

    // -- (12) THE anti-vacuity leg: the real entry point, out of process ---
    //    "exits non-zero on a violation" is the claim, and a process cannot
    //    observe its own exit status. These two run the real CLI.
    const redRoot = tree('oop-red', {
      'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: { ...process.env, NO_COLOR: \'1\' } });'),
    });
    const red = spawnSync(process.execPath, [SELF, '--audit-root', redRoot], { encoding: 'utf8' });
    t('OUT OF PROCESS: a spawner with a bare spread exits NON-ZERO and names the site',
      red.status === 1 && /a\.e2e\.test\.ts:\d+/.test(`${red.stderr}${red.stdout}`),
      JSON.stringify({ status: red.status, err: (red.stderr || '').slice(0, 200) }));

    const envlessRoot = tree('oop-envless', {
      'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd });'),
    });
    const envlessRun = spawnSync(process.execPath, [SELF, '--audit-root', envlessRoot], { encoding: 'utf8' });
    t('OUT OF PROCESS: a spawn with NO env option exits NON-ZERO and names the site',
      envlessRun.status === 1 && /a\.e2e\.test\.ts:\d+/.test(`${envlessRun.stderr}${envlessRun.stdout}`)
        && /envless=1/.test(`${envlessRun.stderr}${envlessRun.stdout}`),
      JSON.stringify({ status: envlessRun.status, err: (envlessRun.stderr || '').slice(0, 200) }));

    const greenRoot = tree('oop-green', {
      'a.e2e.test.ts': spawner('  execFile(\'x\', [], { cwd, env: childEnv({ NO_COLOR: \'1\' }) });'),
    });
    const green = spawnSync(process.execPath, [SELF, '--audit-root', greenRoot], { encoding: 'utf8' });
    t('OUT OF PROCESS: ...while the childEnv() form through the same entry point exits ZERO',
      green.status === 0 && /findings=0/.test(green.stdout) && /envless=0/.test(green.stdout),
      JSON.stringify({ status: green.status, out: (green.stdout || '').trim() }));

    // -- (13) the unparseable leg: ts-parse ends the PROCESS ---------------
    const wreckRoot = tree('oop-wreck', {
      ...READABLE,
      'wreck.ts': 'import { spawn } from \'node:child_process\';\n<<<<<<< HEAD\nvoid spawn;\n=======\nvoid 0;\n>>>>>>> other\n',
    });
    const wreck = spawnSync(process.execPath, [SELF, '--audit-root', wreckRoot], { encoding: 'utf8' });
    t('OUT OF PROCESS: an UNPARSEABLE source refuses, naming the file, with its own exit code',
      wreck.status !== 0 && wreck.status !== null && wreck.status !== 1
        && /wreck\.ts/.test(`${wreck.stderr}${wreck.stdout}`),
      JSON.stringify({ status: wreck.status, err: (wreck.stderr || '').slice(0, 200) }));

    // -- (16) RULE 3 (#11464): the built entrypoint and a rerouting NODE_ENV --
    //    Two halves, pinned apart: MEMBERSHIP (does this call spawn the built
    //    entrypoint at all) and the RULE over the members. Getting membership
    //    wrong is the more expensive error -- it is what puts a file that only
    //    NAMES bin/run.js into a population it does not belong to, which is the
    //    census error this card was dispatched with.

    /**
     * A file that binds the BUILT entrypoint and spawns it -- the population's
     * real shape, down to the `resolve(HERE, '../bin/run.js')` spelling.
     */
    const built = (envExpr, tail = '') =>
      'import { spawn } from \'node:child_process\';\n'
      + 'import { resolve } from \'node:path\';\n'
      + 'const CLI = resolve(HERE, \'../bin/run.js\');\n'
      + 'export function boot(env: Record<string, string | undefined>) {\n'
      + `  return spawn(process.execPath, [CLI, 'serve'], { cwd: '.', env: ${envExpr} });\n`
      + '}\n' + tail;

    /** The rule-3 findings of a one-file tree in the population's shape. */
    const reroutes = (name, envExpr, tail = '') =>
      audit(tree(name, { 'a.e2e.test.ts': built(envExpr, tail) }), DELIBERATE, {}).rerouted ?? [];
    const rerouteReasons = (name, envExpr, tail = '') => reroutes(name, envExpr, tail).map((row) => row.reason);
    /** The whole population count, which is what membership cases are about. */
    const memberCount = (name, sources) => audit(tree(name, sources), DELIBERATE, {}).builtSpawns;

    // -- membership --------------------------------------------------------
    t('a spawn through a const bound to bin/run.js is in the population',
      memberCount('member-binding', { 'a.e2e.test.ts': built('childEnv({ NODE_ENV: undefined })') }) === 1);
    t('a spawn naming bin/run.js as a bare literal in argv is in the population too',
      memberCount('member-literal', {
        'a.e2e.test.ts': 'import { spawn } from \'node:child_process\';\nexport function boot() {\n'
          + '  return spawn(process.execPath, [\'../bin/run.js\', \'serve\'], { env: childEnv({ NODE_ENV: undefined }) });\n}\n',
      }) === 1);

    // ⭐ THE membership case, and the one the card's own census got wrong:
    //    resolving the path in order to ASSERT on it is not spawning it.
    t('a file that resolves bin/run.js but only ASSERTS on it is NOT in the population',
      memberCount('member-string-only', {
        ...COMPANION,
        'a.e2e.test.ts': 'import { execFile } from \'node:child_process\';\nimport { resolve } from \'node:path\';\n'
          + 'const BIN = resolve(HERE, \'../bin/run.js\');\nconst CLI = resolve(HERE, \'../bin/run-dev.js\');\n'
          + 'export function boot() {\n  expect(out).toContain(BIN);\n'
          + '  return execFile(TSX, [CLI], { env: childEnv() });\n}\n',
      }) === 0);
    t('bin/run-dev.js is the OTHER entrypoint and never matches the built one',
      memberCount('member-dev-shim', {
        ...COMPANION,
        'a.e2e.test.ts': 'import { spawn } from \'node:child_process\';\nimport { resolve } from \'node:path\';\n'
          + 'const CLI = resolve(HERE, \'../bin/run-dev.js\');\nexport function boot() {\n'
          + '  return spawn(TSX, [CLI, \'serve\'], { env: childEnv() });\n}\n',
      }) === 0);
    t('a bin/run.js named only in a COMMENT is not a spawn of it',
      memberCount('member-prose', {
        ...COMPANION,
        'a.e2e.test.ts': 'import { spawn } from \'node:child_process\';\n// the bin/run.js spawners pass it in env\n'
          + 'export function boot() {\n  return spawn(TSX, [CLI], { env: childEnv() });\n}\n',
      }) === 0);

    // -- the rule over the members -----------------------------------------
    t('NODE_ENV: undefined -- what the population says today -- stays GREEN',
      reroutes('rule-unset', 'childEnv({ NO_COLOR: \'1\', NODE_ENV: undefined })').length === 0);
    t('NODE_ENV: void 0 is the same value with different punctuation',
      reroutes('rule-void', 'childEnv({ NODE_ENV: void 0 })').length === 0);
    t('NODE_ENV: \'production\' stays GREEN -- isProd() is true, so the reroute is off',
      reroutes('rule-production', 'childEnv({ NODE_ENV: \'production\' })').length === 0);

    t('NODE_ENV: \'development\' REDS',
      JSON.stringify(rerouteReasons('rule-development', 'childEnv({ NODE_ENV: \'development\' })'))
        === JSON.stringify([REROUTE.REROUTED]));
    t('NODE_ENV: \'test\' REDS -- the value vitest exports, and the one inheritance supplies',
      JSON.stringify(rerouteReasons('rule-test', 'childEnv({ NODE_ENV: \'test\' })'))
        === JSON.stringify([REROUTE.REROUTED]));

    // ⭐ SILENCE. The card's headline: the failure does not require anyone to
    //    set the variable on purpose, because childEnv() passes the vitest
    //    worker's NODE_ENV=test straight through.
    t('saying NOTHING about NODE_ENV REDS -- the vitest worker\'s NODE_ENV=test reaches the child',
      JSON.stringify(rerouteReasons('rule-silent', 'childEnv({ NO_COLOR: \'1\' })'))
        === JSON.stringify([REROUTE.INHERITED]));
    // A helper call with no readable overrides REDS as OPAQUE rather than as
    // inherited: calling it inheritance would assume the callee behaves like
    // childEnv(), and this rule ⛔ does not know that helper's name.
    t('a helper call with no readable overrides REDS as opaque, not as inherited',
      JSON.stringify(rerouteReasons('rule-bare-helper', 'childEnv()'))
        === JSON.stringify([REROUTE.OPAQUE]));
    t('a built-entrypoint spawn with NO options object REDS as inherited',
      JSON.stringify(audit(tree('rule-no-options', {
        'a.e2e.test.ts': 'import { spawn } from \'node:child_process\';\nimport { resolve } from \'node:path\';\n'
          + 'const CLI = resolve(HERE, \'../bin/run.js\');\nexport function boot() {\n'
          + '  return spawn(process.execPath, [CLI, \'serve\']);\n}\n',
      }), DELIBERATE, {}).rerouted.map((row) => row.reason)) === JSON.stringify([REROUTE.INHERITED]));

    // The rule names no helper: a plain object literal is just as readable.
    t('a plain env object literal is read directly -- the rule does not name childEnv()',
      reroutes('rule-plain-literal', '{ NODE_ENV: undefined }').length === 0);
    t('...and the same plain literal with development REDS',
      JSON.stringify(rerouteReasons('rule-plain-red', '{ NODE_ENV: \'development\' }'))
        === JSON.stringify([REROUTE.REROUTED]));

    t('an env this scan cannot read REDS as opaque, never as green',
      JSON.stringify(rerouteReasons('rule-opaque-env', 'buildEnv()'))
        === JSON.stringify([REROUTE.OPAQUE]));
    t('a NODE_ENV whose VALUE is not a literal REDS as opaque too',
      JSON.stringify(rerouteReasons('rule-opaque-value', 'childEnv({ NODE_ENV: mode })'))
        === JSON.stringify([REROUTE.OPAQUE]));

    // -- the one-hop spread resolution -------------------------------------
    //    Every real site in the population is `childEnv({ ..., NODE_ENV:
    //    undefined, ...env })`, so without this hop the rule reads NOTHING it
    //    is meant to read and reports four "gave up" findings instead.
    const SPREAD = 'childEnv({ NODE_ENV: undefined, ...env })';

    t('a trailing spread resolved to a caller that overrides NOTHING stays GREEN',
      reroutes('hop-clean', SPREAD, 'export const a = boot({ OS_DATABASE_URL: \':memory:\' });').length === 0);
    t('a trailing spread resolved to a caller passing {} stays GREEN',
      reroutes('hop-empty', SPREAD, 'export const a = boot({});').length === 0);

    // ⭐ THE case: the live shape, and the two sites it finds on this tree.
    t('a caller that overrides NODE_ENV with development REDS through the hop',
      JSON.stringify(rerouteReasons('hop-red', SPREAD, 'export const a = boot({ NODE_ENV: \'development\' });'))
        === JSON.stringify([REROUTE.REROUTED]));

    t('the finding is reported at the CALLER site, where the value was chosen',
      JSON.stringify(reroutes('hop-site', SPREAD,
        'it(\'explicit development\', () => {\n  boot({ NODE_ENV: \'development\' });\n});\n')
        .map((row) => row.fn)) === names('it("explicit development")'));

    t('two callers, one dirty, produce exactly ONE finding named after the dirty block',
      JSON.stringify(reroutes('hop-siblings', SPREAD,
        'it(\'unset\', () => {\n  boot({});\n});\nit(\'development\', () => {\n  boot({ NODE_ENV: \'development\' });\n});\n')
        .map((row) => row.fn)) === names('it("development")'));

    t('a spread BEFORE the NODE_ENV entry cannot override it, so it stays GREEN',
      reroutes('hop-leading-spread', 'childEnv({ ...env, NODE_ENV: undefined })',
        'export const a = boot({ NODE_ENV: \'development\' });').length === 0);

    t('a spread of something that is not a parameter REDS as opaque',
      reroutes('hop-not-param', 'childEnv({ NODE_ENV: undefined, ...extras })').map((r) => r.reason)[0]
        === REROUTE.OPAQUE);
    t('a helper with NO call sites in the file REDS as opaque -- the hop resolved nothing',
      reroutes('hop-uncalled', SPREAD).map((r) => r.reason)[0] === REROUTE.OPAQUE);
    t('a caller passing an identifier rather than a literal REDS as opaque',
      reroutes('hop-opaque-arg', SPREAD, 'export const a = boot(overrides);').map((r) => r.reason)[0]
        === REROUTE.OPAQUE);
    t('a SECOND hop is not followed -- a caller literal with its own spread REDS as opaque',
      reroutes('hop-second', SPREAD, 'export const a = boot({ ...more });').map((r) => r.reason)[0]
        === REROUTE.OPAQUE);
    t('a base that says nothing and a caller that says nothing REDS as inherited, not opaque',
      reroutes('hop-both-silent', 'childEnv({ NO_COLOR: \'1\', ...env })', 'export const a = boot({});')
        .map((r) => r.reason)[0] === REROUTE.INHERITED);
    t('...and a caller that supplies a SAFE value satisfies a silent base',
      reroutes('hop-caller-fixes', 'childEnv({ NO_COLOR: \'1\', ...env })',
        'export const a = boot({ NODE_ENV: \'production\' });').length === 0);

    // -- the declaration registry, site-scoped like DELIBERATE -------------
    const rerouteTree = tree('reroute-registry', {
      'a.e2e.test.ts': built(SPREAD,
        'it(\'first\', () => {\n  boot({ NODE_ENV: \'development\' });\n});\n'
        + 'it(\'second\', () => {\n  boot({ NODE_ENV: \'test\' });\n});\n'),
    });
    const declaredOne = audit(rerouteTree, DELIBERATE, {
      'packages/cli/test/a.e2e.test.ts::it("first")': { why: 'synthetic' },
    });
    t('a DELIBERATE_REROUTE entry for ONE block silences THAT block and leaves its sibling a finding',
      JSON.stringify({
        declared: declaredOne.deliberateReroute.map((row) => row.fn),
        rerouted: declaredOne.rerouted.map((row) => row.fn),
      }) === JSON.stringify({ declared: ['it("first")'], rerouted: ['it("second")'] }),
      JSON.stringify(declaredOne.rerouted.map((row) => row.fn)));

    t('a DELIBERATE_REROUTE entry that no longer matches FAILS as stale',
      judge([], allDeliberate, {}, []).missingReroute.length === Object.keys(DELIBERATE_REROUTE).length
        && judge([], allDeliberate, {}, Object.keys(DELIBERATE_REROUTE).map((key) => {
          const [file, fn] = key.split('::');
          return { file, fn, line: 1, text: 'x' };
        })).missingReroute.length === 0);

    // -- the three rules are INDEPENDENT ------------------------------------
    const onlyRule3 = audit(tree('independent-3', {
      'a.e2e.test.ts': built('childEnv({ NODE_ENV: \'development\' })'),
    }), DELIBERATE, {});
    t('rule 3 reds while rules 1 and 2 stay green on the same call',
      onlyRule3.rerouted.length === 1 && onlyRule3.findings.length === 0 && onlyRule3.envless.length === 0,
      JSON.stringify({ r3: onlyRule3.rerouted.length, r1: onlyRule3.findings.length, r2: onlyRule3.envless.length }));

    const bulkAtBuilt = audit(tree('independent-1', {
      'a.e2e.test.ts': built('{ ...process.env, NODE_ENV: undefined }'),
    }), DELIBERATE, {});
    t('...and a bulk copy at a built-entrypoint spawn reds rule 1 while rule 3 stays green',
      bulkAtBuilt.findings.length === 1 && bulkAtBuilt.rerouted.length === 0,
      JSON.stringify({ r1: bulkAtBuilt.findings.length, r3: bulkAtBuilt.rerouted.length }));

    // An env-less built-entrypoint spawn reds BOTH, which is correct rather
    // than duplicated: rule 2 says the environment is illegible, rule 3 says
    // what that illegibility DOES to this particular child.
    const bothTwoThree = audit(tree('independent-23', {
      'a.e2e.test.ts': 'import { spawn } from \'node:child_process\';\nimport { resolve } from \'node:path\';\n'
        + 'const CLI = resolve(HERE, \'../bin/run.js\');\nexport function boot() {\n'
        + '  return spawn(process.execPath, [CLI, \'serve\'], { cwd: \'.\' });\n}\n',
    }), DELIBERATE, {});
    t('an env-less BUILT-entrypoint spawn reds rule 2 AND rule 3, each for its own reason',
      bothTwoThree.envless.length === 1 && bothTwoThree.rerouted.length === 1
        && bothTwoThree.rerouted[0].reason === REROUTE.INHERITED);

    // -- OUT OF PROCESS: rule 3 can actually fail a run --------------------
    const rerouteRoot = tree('oop-reroute', {
      'a.e2e.test.ts': built('childEnv({ NODE_ENV: \'development\' })'),
    });
    const rerouteRun = spawnSync(process.execPath, [SELF, '--audit-root', rerouteRoot], { encoding: 'utf8' });
    t('OUT OF PROCESS: a built-entrypoint spawn with NODE_ENV=development exits NON-ZERO and names the site',
      rerouteRun.status === 1 && /a\.e2e\.test\.ts:\d+/.test(`${rerouteRun.stderr}${rerouteRun.stdout}`)
        && /rerouted=1/.test(`${rerouteRun.stderr}${rerouteRun.stdout}`),
      JSON.stringify({ status: rerouteRun.status, err: (rerouteRun.stderr || '').slice(0, 200) }));

    const rerouteGreenRoot = tree('oop-reroute-green', {
      'a.e2e.test.ts': built('childEnv({ NODE_ENV: undefined })'),
    });
    const rerouteGreen = spawnSync(process.execPath, [SELF, '--audit-root', rerouteGreenRoot], { encoding: 'utf8' });
    t('OUT OF PROCESS: ...while NODE_ENV: undefined through the same entry point exits ZERO',
      rerouteGreen.status === 0 && /built=1/.test(rerouteGreen.stdout) && /rerouted=0/.test(rerouteGreen.stdout),
      JSON.stringify({ status: rerouteGreen.status, out: (rerouteGreen.stdout || '').trim() }));

    // -- (14) wiring. Unwiring the gate must redden HERE, not go quiet. ----
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    const alias = pkg.scripts?.['check:cli-test-child-env'] ?? '';
    t('a package.json alias invokes this script', /check-cli-test-child-env\.mjs/.test(alias), alias);
    t('...and runs the self-test with it', /--self-test/.test(alias), alias);
    const lintYml = readFileSync(join(REPO_ROOT, '.github/workflows/lint.yml'), 'utf8');
    t('a lint job runs the alias', lintYml.includes('pnpm check:cli-test-child-env'));

    // -- (15) the live tree, as a case rather than as the run's only evidence
    const live = audit(REPO_ROOT);
    t('the live tree resolves a real population (not zero, not a refusal)',
      live.refusal === null && live.files > 0 && live.spawners > 0,
      JSON.stringify({ refusal: live.refusal, files: live.files, spawners: live.spawners }));

    // Rule 2's anti-vacuity pin. An empty `envless` proves nothing on its own:
    // it reads identically whether every call declares an env or the call
    // resolution stopped resolving calls. The call COUNT is what separates
    // those two, so it is asserted here rather than merely printed.
    t('the live tree resolves real spawn CALLS, so rule 2 is measuring something',
      live.refusal === null && live.spawnCalls > 0, JSON.stringify({ spawnCalls: live.spawnCalls }));
    t('...and every one of them declares its child\'s env',
      live.refusal === null && live.envless.length === 0,
      JSON.stringify(live.envless?.map((row) => `${row.file}:${row.line} ${row.reason}`)));

    // Rule 3's anti-vacuity pin, the same shape as rule 2's: an empty `rerouted`
    // reads identically whether every built-entrypoint spawn is sound or the
    // ENTRYPOINT resolution stopped resolving anything. The population count is
    // what separates those, so it is asserted rather than merely printed.
    t('the live tree resolves real BUILT-entrypoint spawns, so rule 3 is measuring something',
      live.refusal === null && live.builtSpawns > 0, JSON.stringify({ builtSpawns: live.builtSpawns }));
    t('...and every one of them keeps its child out of development/test',
      live.refusal === null && live.rerouted.length === 0,
      JSON.stringify(live.rerouted?.map((row) => `${row.file}:${row.line} ${row.reason}`)));

    // ⭐ The census, pinned. This card was dispatched with a table naming SIX
    // spawners of bin/run.js, of which two spawn the tsx shim instead -- the
    // exact shape of number that still reads as measured after it has stopped
    // being true. Pinned as the SET of files holding a built-entrypoint spawn,
    // so a file joining or leaving the population has to be seen by a PR.
    const builtFiles = walkSources(join(REPO_ROOT, POPULATION_ROOT))
      .filter((abs) => /child_process|worker_threads/.test(readFileSync(abs, 'utf8')))
      .filter((abs) => builtEntrypointSpawns(abs, readFileSync(abs, 'utf8')).spawns > 0)
      .map((abs) => relative(REPO_ROOT, abs).split(sep).join('/'))
      .sort();
    t('the built-entrypoint population is exactly the four files that spawn bin/run.js',
      JSON.stringify(builtFiles) === JSON.stringify([
        'packages/cli/test/serve-mcp-capability-collision.e2e.test.ts',
        'packages/cli/test/serve-mcp-stdio-answers.e2e.test.ts',
        'packages/cli/test/serve-node-env-production-default.e2e.test.ts',
        'packages/cli/test/serve-stdio-stdout-purity.e2e.test.ts',
      ]), JSON.stringify(builtFiles));

    const liveJudgement = live.refusal ? null : judge(live.findings, live.deliberate, readBaseline(), live.deliberateReroute);
    t('the checked-in ratchet is neither short nor stale against the live tree',
      liveJudgement !== null && liveJudgement.over.length === 0 && liveJudgement.under.length === 0,
      JSON.stringify(liveJudgement && { over: liveJudgement.over, under: liveJudgement.under }));
    t('every DELIBERATE site is still on disk',
      liveJudgement !== null && liveJudgement.missing.length === 0,
      JSON.stringify(liveJudgement && liveJudgement.missing));
    t('every DELIBERATE_REROUTE site is still on disk',
      liveJudgement !== null && liveJudgement.missingReroute.length === 0,
      JSON.stringify(liveJudgement && liveJudgement.missingReroute));

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
    + 'an env-less spawn reds out of process too, by reason, through every spelling that reaches a spawn API; '
    + 'a legitimate non-spawner bulk copy stays green and the same body reds once the file spawns; '
    + 'every member read stays green; the two rules red independently of each other; the carve-out is site-scoped, '
    + 'and a callback arrow is named after its CALL so two it() blocks in one file cannot share a registry key; '
    + 'a built-entrypoint spawn reds out of process when its child lands in development/test -- whether the value is '
    + 'set at the call, arrives through a resolved one-hop override, or is merely INHERITED from the vitest worker -- '
    + 'while the tsx shim and a file that only NAMES bin/run.js stay out of that population; '
    + 'the ratchet fails in both directions; and all four refusals are paired with a tree that still returns a verdict).',
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
