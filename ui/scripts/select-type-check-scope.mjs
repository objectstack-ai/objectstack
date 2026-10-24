#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * select-type-check-scope -- how much of the workspace a pull-request or
 * merge-queue run of `Type Check` owes, under the two-speed doctrine
 * (objectui#12222, objectstack#22998).
 *
 *   node scripts/select-type-check-scope.mjs --base <sha>
 *   node scripts/select-type-check-scope.mjs --base <sha> --head <ref>
 *   node scripts/select-type-check-scope.mjs --root-builds
 *
 * The LAST line on stdout is the verdict, one of:
 *
 *   scope=workspace   type-check every package (`pnpm type-check`)
 *   scope=affected    type-check the packages the change sits in and every
 *                     package that depends on them
 *                     (`pnpm type-check --filter=...[<base>]`)
 *
 * Exit 0 means a verdict was reached -- either one. Any other exit means the
 * question could not be answered, and ci.yml type-checks the whole workspace:
 * a selector that cannot tell must RUN, never skip (the fail-open rule
 * `merge-queue-reporting.test.ts` holds every in-job gate of that workflow to).
 *
 * ## The two speeds
 *
 * `push` to `main` and the hourly `schedule` run carry the FULL battery: every
 * package type-checked with nothing replayed from the cache (`TURBO_FORCE`).
 * Nothing reads this script there. A `pull_request` or `merge_group` run
 * carries the FAST set: the packages this script's verdict names, and, of
 * those, every package whose turbo hash did not move is replayed from the
 * restored `.turbo/cache`. Whatever the fast set misses, the full battery on
 * `main` runs within the hour -- the doctrine's trade, stated so nobody reads
 * the fast set as the whole gate.
 *
 * ## The affected set, and why it needs a root rule
 *
 * The affected set is turbo's own answer, `--filter=...[<base>]`: every
 * package a changed file sits in, plus every package that depends on one of
 * them. That answer is drawn from the PACKAGE graph, and a file outside every
 * package belongs to none -- measured on this tree for objectui#12222: a change
 * to the root `tsconfig.json`, the root `package.json`, `scripts/vite-*.ts`
 * or a file under `e2e/` selects ZERO packages, while every package's
 * type-check reads the first three and the e2e program is a dependency of
 * every one. So a change to any of these means EVERY package is affected:
 *
 *   1. the files that configure every install or every task --
 *      `pnpm-lock.yaml`, `pnpm-workspace.yaml`, the root `package.json`,
 *      `turbo.json`, `.npmrc`, any root `tsconfig*.json`, anything under
 *      `patches/`;
 *   2. every `$TURBO_ROOT$` input of turbo's `type-check` task and of its
 *      `build` task (`type-check` dependsOn `^build`): the files a package's
 *      program, or a dependency's build, reads from outside its own package;
 *   3. every `globalDependencies` entry;
 *   4. the inputs of every ROOT task `type-check` depends on (the e2e
 *      program): a root task runs only as a dependency of a selected package,
 *      so a change to its own program alone would select nothing at all.
 *
 * Items 2-4 are read out of turbo.json on every run, never copied here, so
 * the rule follows the file turbo itself hashes from. A root task with no
 * `inputs` reads every file in the repository, and then EVERY change is a
 * root change -- the rule degrades to the whole workspace, never to a skip.
 *
 * ## The repo-root programs need their packages BUILT, whatever the set
 *
 * The job also compiles programs that sit in no package, after the turbo
 * run: `pnpm type-check:vitest-setup` (`tsconfig.vitest-setup.json`) resolves
 * the workspace packages the root `vitest.setup.*` files import through
 * each package's built declarations. The full battery builds those as the
 * `^build` of the packages that depend on them; the affected set need not
 * contain them, or anything at all -- a change outside every package
 * selects zero packages, so nothing builds and that program fails to
 * resolve them (objectui#12272, measured on PR #12262: four TS2882 and one
 * TS2307). So on the affected speed ci.yml builds them in a step of its
 * own, and `--root-builds` prints which: one package name per line, read
 * on every run out of the `paths` of each tsconfig in
 * ROOT_PROGRAMS_AFTER_BUILD, never copied (the root package.json declares
 * no `@object-ui/*` dependency, so a workspace import from the repo root
 * resolves through those `paths` or not at all). The other root programs
 * the job compiles import no workspace package: `tsconfig.scripts.json`
 * and the root Vitest config each pin that premise in their own test, and
 * the e2e program's `@object-ui/*` strings are stub-map keys, not imports.
 *
 * ## What it does not see -- stated, not hidden
 *
 * An edge that is in neither the package graph nor a turbo input: a file a
 * package's program reaches through an import, outside the package and
 * outside its dependency closure. The `type-check` inputs list the ones a
 * `tsc --listFilesOnly` sweep found (`turbo-type-check-inputs.test.ts`,
 * INPUTS_NOT_DERIVABLE, says why they are listed rather than derived); one
 * added later and not listed is caught by the full battery on `main`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Item 1 of the root rule: files that configure every install or every task. */
export const FIXED_ROOT_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json',
  'turbo.json',
  '.npmrc',
  'tsconfig*.json',
  'patches/**',
]);

/**
 * The repo-root tsconfigs ci.yml compiles AFTER the turbo run, because their
 * programs resolve workspace packages through those packages' built
 * declarations. See "The repo-root programs need their packages BUILT".
 */
export const ROOT_PROGRAMS_AFTER_BUILD = Object.freeze(['tsconfig.vitest-setup.json']);

/** The turbo tasks whose `$TURBO_ROOT$` inputs decide a type-check verdict. */
export const HASHED_TASKS = Object.freeze(['type-check', 'build']);

const TURBO_ROOT = '$TURBO_ROOT$/';

/**
 * A turbo input glob as a whole-path RegExp: `**` spans directories, `*` and
 * `?` stop at `/`. Braces, classes, extglobs and negations are refused
 * rather than guessed, the same doctrine as the inputs guards' matcher:
 * approximating toward a match here would read as a root change that is not
 * one, or the reverse.
 */
export function globToRegExp(glob) {
  if (/[{}[\]()]/.test(glob) || glob.startsWith('!')) {
    throw new Error(`turbo glob ${JSON.stringify(glob)} uses syntax this selector does not implement`);
  }
  let pattern = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          pattern += '(?:[^/]+/)*';
          i += 2;
        } else {
          pattern += '.*';
          i += 1;
        }
      } else {
        pattern += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      pattern += '[^/]';
      continue;
    }
    pattern += char.replace(/[.^$|\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * Every root-relative glob whose change means every package is affected,
 * each with the item of the rule it comes from.
 *
 * @param {{ globalDependencies?: string[], tasks: Record<string, { inputs?: string[], dependsOn?: string[] }> }} turbo
 * @returns {Array<{ glob: string, why: string }>}
 */
export function rootRule(turbo) {
  const rule = FIXED_ROOT_FILES.map((glob) => ({ glob, why: 'configures every install or task' }));
  for (const task of HASHED_TASKS) {
    const def = turbo.tasks?.[task];
    if (!def) throw new Error(`turbo.json declares no \`${task}\` task`);
    for (const input of def.inputs ?? []) {
      // `$TURBO_DEFAULT$` and package-relative entries are the package's own
      // files: the package graph already sees a change to them.
      if (input.startsWith(TURBO_ROOT)) rule.push({ glob: input.slice(TURBO_ROOT.length), why: `a $TURBO_ROOT$ input of \`${task}\`` });
    }
  }
  for (const glob of turbo.globalDependencies ?? []) rule.push({ glob, why: 'a turbo globalDependencies entry' });
  for (const dep of turbo.tasks['type-check'].dependsOn ?? []) {
    if (!dep.startsWith('//#')) continue;
    const inputs = turbo.tasks[dep]?.inputs ?? [];
    // No inputs: turbo hashes every tracked file for a root task, so every
    // file is that task's input and every change is a root change.
    if (inputs.length === 0 || inputs.includes('$TURBO_DEFAULT$')) {
      rule.push({ glob: '**', why: `\`${dep}\` declares no inputs, so it reads the whole repository` });
      continue;
    }
    for (const glob of inputs) rule.push({ glob, why: `an input of the root task \`${dep}\`` });
  }
  return rule;
}

/**
 * The changed files the root rule catches, each with the first rule entry
 * that caught it.
 *
 * @param {string[]} changed repository-relative paths
 * @param {Array<{ glob: string, why: string }>} rule
 */
export function rootChanges(changed, rule) {
  const matchers = rule.map((r) => ({ ...r, re: globToRegExp(r.glob) }));
  const hits = [];
  for (const file of changed) {
    const m = matchers.find(({ re }) => re.test(file));
    if (m) hits.push({ file, glob: m.glob, why: m.why });
  }
  return hits;
}

/**
 * The workspace packages a repo-root program resolves through its `paths`:
 * each `paths` target, read with TypeScript's own config parser, walked up to
 * the nearest directory below the repository root that holds a package.json
 * (`./packages/i18n/dist/*` is `@object-ui/i18n`). A target that reaches no
 * package throws: a mapping this cannot place is not one it may drop.
 *
 * @param {string} root
 * @param {readonly string[]} [tsconfigs]
 * @returns {string[]} package names, sorted, each once
 */
export function rootProgramPackages(root, tsconfigs = ROOT_PROGRAMS_AFTER_BUILD) {
  const ts = createRequire(import.meta.url)('typescript');
  const names = new Set();
  for (const tsconfig of tsconfigs) {
    const file = path.join(root, tsconfig);
    const read = ts.readConfigFile(file, ts.sys.readFile);
    if (read.error) throw new Error(`${tsconfig}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);
    const { options } = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file), undefined, file);
    const base = options.pathsBasePath ?? path.dirname(file);
    for (const targets of Object.values(options.paths ?? {})) {
      for (const target of targets) {
        let dir = path.resolve(base, target.split('*')[0]);
        while (dir.startsWith(root + path.sep) && !fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
        if (!dir.startsWith(root + path.sep)) {
          throw new Error(`${tsconfig}: the paths target ${JSON.stringify(target)} sits in no workspace package`);
        }
        names.add(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name);
      }
    }
  }
  return [...names].sort();
}

/** `git diff --name-only <base> <head>`, or a thrown error the caller turns into "no verdict". */
export function changedFiles(root, base, head) {
  execFileSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { cwd: root, stdio: 'ignore' });
  const out = execFileSync('git', ['diff', '--name-only', base, head], { cwd: root, encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * The packages turbo would type-check for `--filter=...[<base>]`, read off a
 * dry run so the verdict line is preceded by what it means. A dry run that
 * fails (an SCM error, a base turbo cannot resolve) throws: no verdict.
 */
export function affectedPackages(root, base) {
  const out = execFileSync('pnpm', ['exec', 'turbo', 'run', 'type-check', `--filter=...[${base}]`, '--dry=json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1 << 28,
  });
  const dry = JSON.parse(out.slice(out.indexOf('{')));
  return dry.tasks.filter((t) => t.task === 'type-check').map((t) => t.package).sort();
}

function parseArgs(argv) {
  const out = { base: null, head: 'HEAD', rootBuilds: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root-builds') out.rootBuilds = true;
    else if (arg === '--base' && argv[i + 1]) out.base = argv[++i];
    else if (arg === '--head' && argv[i + 1]) out.head = argv[++i];
    else return { error: `unknown or incomplete argument: ${arg}` };
  }
  if (out.rootBuilds) return out.base ? { error: '--root-builds takes no --base' } : out;
  if (!out.base) return { error: '--base <sha> is required' };
  return out;
}

/**
 * @param {string[]} argv
 * @param {{ root?: string, log?: (line: string) => void, changed?: string[], affected?: (root: string, base: string) => string[] }} [deps]
 */
export function main(argv, deps = {}) {
  const { root = REPO_ROOT, log = console.log } = deps;
  const args = parseArgs(argv);
  if ('error' in args) {
    console.error(`select-type-check-scope: ${args.error}`);
    return 2;
  }
  if (args.rootBuilds) {
    for (const name of rootProgramPackages(root)) log(name);
    return 0;
  }
  const turbo = JSON.parse(fs.readFileSync(path.join(root, 'turbo.json'), 'utf8'));
  const rule = rootRule(turbo);
  const changed = deps.changed ?? changedFiles(root, args.base, args.head);
  log(`${changed.length} file(s) changed against ${args.base}.`);

  const hits = rootChanges(changed, rule);
  if (hits.length > 0) {
    log('A root-level input changed, so every package is affected:');
    for (const h of hits) log(`  ${h.file}  (${h.glob}: ${h.why})`);
    log('scope=workspace');
    return 0;
  }

  const packages = (deps.affected ?? affectedPackages)(root, args.base);
  if (packages.length === 0) {
    log('No changed file sits in a workspace package or reaches one through a turbo input: nothing to type-check.');
  } else {
    log(`${packages.length} package(s) affected -- changed, or depending on one that changed:`);
    for (const p of packages) log(`  ${p}`);
  }
  // Whatever that set is -- empty included -- the repo-root programs still
  // need theirs built; ci.yml builds them from `--root-builds` (objectui#12272).
  const rootBuilds = rootProgramPackages(root);
  log(`The repo-root programs resolve ${rootBuilds.length} package(s) through their builds, which ci.yml builds on this speed whatever the set above:`);
  for (const p of rootBuilds) log(`  ${p}`);
  log('scope=affected');
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::select-type-check-scope could not decide: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
