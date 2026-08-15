#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-cross-package-test-inputs -- keeps CI's idea of a test's inputs equal
// to the test's REAL inputs, for the tests that read outside their own package.
//
// ── The defect this exists to make impossible (#7802) ────────────────────────
//
// `packages/spec/src/data/api-methods-batch-conformance.test.ts` resolves the
// repo root and walks every `*.object.ts` in the monorepo. Its home package is
// `spec`; its input set is the whole repo. #7769 changed ONE object under
// `packages/platform-objects`, the scan's verdict flipped to red -- and the
// change reached `main` anyway, because BOTH of CI's scoping layers judge the
// scan by where it LIVES:
//
//   Layer A -- `turbo ls --affected` in ci.yml's `test` job (the PR path).
//     Affected packages come from the dependency GRAPH. `packages/spec` declares
//     no dependency on `packages/platform-objects` (and should not -- the scan
//     reads source text precisely to avoid inverting the spec -> * direction),
//     so a platform-objects-only diff can never reach spec. Measured on
//     turbo 2.10.7: 51 packages affected, `@objectstack/spec` not among them.
//
//   Layer B -- turbo's task cache. `test` declares `inputs: ["$TURBO_DEFAULT$",
//     ...]`, which is PACKAGE-LOCAL. `@objectstack/spec#test` therefore hashes
//     the same before and after any change outside `packages/spec`, so even the
//     merge-queue and push builds -- which deliberately partition the FULL
//     package list, not the affected subset -- replay a cached green.
//     Measured: `turbo run test --filter=@objectstack/spec` after the
//     platform-objects edit printed `>>> FULL TURBO`, 42ms, replaying the
//     previous run's log, while `--force` on the same tree failed the scan.
//
// Layer B is why the merge queue did not catch it. The `filter` job's
// `dorny/paths-filter` gate -- which DOES open up on `merge_group` -- was never
// the leak: `core` matches `packages/**`, so it was `true` throughout.
//
// ── The mechanism ───────────────────────────────────────────────────────────
//
// A package whose tests read outside itself declares that radius ONCE, in
// CROSS_PACKAGE_TEST_INPUTS below, and both layers are driven from it:
//
//   Layer A: `--union-into <turbo-ls.json>` adds the declaring package to the
//            shard's package set when the diff touches its declared globs.
//   Layer B: `--verify` requires turbo.json to carry a matching
//            `<pkg>#test` task whose `inputs` include the same globs as
//            `$TURBO_ROOT$/...` entries, so the cache hash moves with them.
//
// ── Why this is not just another hand-maintained list ───────────────────────
//
// It IS a list, and a list you must remember to update is exactly the failure
// mode that produced #7802. So the list does not depend on anyone remembering:
// `--verify` finds the escaping tests ITSELF, statically, and fails naming any
// package that has one and no declaration. Add a new cross-package scan and the
// gate goes red with the package name and what to write; the default for an
// undeclared scan is a RED GATE, never a silent skip. The reverse rots too, so
// it is checked in the same pass: a declaration whose package no longer has an
// escaping test fails as stale.
//
// What the list buys over "just always run those packages" is the radius. A
// declared glob of `packages/**/*.object.ts` keeps spec's 5-minute suite off
// every PR that does not touch an object; `always-run` would put it on all of
// them, which is the affected-subset optimisation the 3-way shard exists for
// (ci.yml `test`) traded away to fix eight packages.
//
// Usage:
//   node scripts/check-cross-package-test-inputs.mjs --verify
//   node scripts/check-cross-package-test-inputs.mjs --union-into <turbo-ls.json> --changed <file>
//   node scripts/check-cross-package-test-inputs.mjs --list-escapes
//   node scripts/check-cross-package-test-inputs.mjs --self-test

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/**
 * Packages whose test suites read files outside their own directory, with the
 * repo-relative globs they really read. Keep a glob as NARROW as the evidence
 * allows and no narrower: too wide only costs cache invalidation, too narrow
 * silently restores the #7802 blind spot for that package.
 *
 * Every entry names the test that justifies it, so the next person can check
 * the radius against the code rather than trusting the glob.
 */
const CROSS_PACKAGE_TEST_INPUTS = {
  '@objectstack/spec': {
    globs: [
      // api-methods-batch-conformance.test.ts + system/constants/platform-object-names.test.ts
      'packages/**/*.object.ts',
      // src/identity/position-delegatable-enforcer.pin.test.ts reads the lint rule sources
      'packages/lint/src/**',
      // scripts/root-index.test.ts
      'content/docs/references/index.mdx',
      // scripts/dist-freshness.test.ts stages a fixture around the root scripts dir
      'scripts/**',
      // scripts/liveness/evidence.test.ts resolves the evidence paths the
      // liveness ledgers cite, so those files' existence is a spec input.
      'packages/runtime/src/**',
      'packages/objectql/src/validation/**',
      'packages/metadata-protocol/src/**',
      'packages/plugins/plugin-audit/src/**',
    ],
  },
  '@objectstack/core': {
    // src/security/operation-private-keys.pin.test.ts walks `git ls-files` over
    // the whole repo and reads every matching source file.
    globs: ['packages/**/*.ts'],
  },
  '@objectstack/cli': {
    // src/commands/serve-verify-security-parity.contract.test.ts diffs
    // cli's serve.ts against verify's harness.ts.
    // It also pins plugin-security's permission-set test as a third witness.
    //
    // src/commands/serve-multi-node-cap-advisory.pin.test.ts reads the
    // multi-node gate's own `ResolvedMultiNodeVerdict` declaration: serve.ts
    // mirrors that shape by hand (the CLI has no static dependency on the
    // cluster package), and the pin exists to fail when the two drift. It only
    // does that if a producer-only change re-runs cli's tests, which is exactly
    // what this declaration buys.
    globs: [
      'packages/verify/src/**',
      'packages/plugins/plugin-security/src/**',
      'packages/services/service-cluster/src/**',
    ],
  },
  '@objectstack/lint': {
    // authoring-rule-wiring / validate-rule-compilability /
    // lint-startup-registry-verdict.corpus read each authoring rule's source
    // by repo-relative path, plus the CLI commands dir and the runtime gate.
    globs: [
      'packages/cli/src/commands/**',
      'packages/metadata-protocol/src/**',
      'packages/objectql/src/validation/**',
      'packages/services/service-automation/src/**',
    ],
  },
  '@objectstack/platform-objects': {
    // src/managed-api-method-affordance-sweep.test.ts (#7934) imports every
    // `*.object.ts` in the monorepo and runs `validateManagedApiMethods` over
    // it — the population `os lint` never walks, because these objects ship as
    // code rather than in an authored stack.
    globs: ['packages/**/*.object.ts'],
  },
  '@objectstack/plugin-auth': {
    // src/managed-extension-fields.test.ts walks every `*.object.ts`, and pins
    // core's api-key source alongside it.
    globs: ['packages/**/*.object.ts', 'packages/core/src/security/**'],
  },
  '@objectstack/plugin-security': {
    // src/audience-anchor-set-claims.pin.test.ts pins against spec's
    // high-privilege table, and cross-checks spec's own delegatable pin.
    globs: ['packages/spec/src/security/**', 'packages/spec/src/identity/**'],
  },
  '@objectstack/dogfood': {
    // test/*-conformance.test.ts read a fixed roster of probe files across
    // runtime, rest, plugins and services by repo-relative path. Narrow to the
    // roster rather than `packages/**/src/**`: the literal-coverage check below
    // fails the moment a probe is added outside these, so narrowing here cannot
    // quietly reopen the blind spot.
    globs: [
      'packages/client/src/**',
      'packages/mcp/src/**',
      'packages/plugins/plugin-hono-server/src/**',
      'packages/rest/src/**',
      'packages/runtime/src/**',
      'packages/services/service-realtime/src/**',
      // flow-trigger / validation conformance pin spec's zod schemas.
      'packages/spec/src/automation/**',
      'packages/spec/src/data/**',
    ],
  },
  'create-objectstack': {
    // src/template-consistency.test.ts reads doc frontmatter by repo-relative
    // path to decide which templates are internal.
    globs: ['content/**'],
  },
};

// ── glob matching ────────────────────────────────────────────────────────────
// Deliberately dependency-free: this gate runs in CI before anything is built,
// and a `scripts/` gate that can fail on a resolution problem is a gate that
// gets muted. Supports the three constructs the declarations above use:
// `**` (any number of path segments), `*` (within one segment), and literals.
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` consumes zero or more whole segments; a trailing `**` consumes the rest.
        if (glob[i + 2] === '/') {
          re += '(?:[^/]+/)*';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\/'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path));
}

// ── the escape detector ──────────────────────────────────────────────────────
const FS_READ = /\b(readFileSync|readdirSync|statSync|existsSync|globSync|opendirSync|execFileSync)\b/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.next', '.git']);

/**
 * Reads whose FIRST argument is a path, for the argument-position scan below.
 * `execFileSync` is deliberately absent from this list though it is in FS_READ:
 * its first argument is a binary to run, not a file to read.
 */
const PATH_ARG_READS = ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync', 'globSync', 'opendirSync'];

/**
 * The path spellings this gate can SEE, in the words an author would write them.
 * Printed in the failure text and mirrored in AGENTS.md, because the detector is
 * a source scan: a spelling that is not on this list yields no flag, so a read
 * written that way goes undeclared silently. Anything added here needs a
 * `--self-test` case in the same edit, or the next refactor drops it unnoticed.
 */
export const RECOGNISED_PATH_SPELLINGS = [
  "const HERE = dirname(fileURLToPath(import.meta.url));   // seed (ESM)",
  'const HERE = __dirname;                                  // seed (CJS)',
  "const P = resolve(HERE, '<rel>');       // join() and the path.* forms too",
  "const P = fileURLToPath(new URL('<rel>', import.meta.url));",
  "const P = new URL('<rel>', import.meta.url);",
  "readFileSync(resolve(HERE, '<rel>'))    // the same expressions in argument",
  "readFileSync(new URL('<rel>', import.meta.url))              // position",
];

function walkTests(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTests(p, out);
    else if (/\.test\.[cm]?[jt]sx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function packageRootOf(file) {
  let d = dirname(file);
  while (d.startsWith(REPO_ROOT) && d !== REPO_ROOT) {
    if (existsSync(join(d, 'package.json'))) return d;
    d = dirname(d);
  }
  return null;
}

/**
 * Walk a relative path literal from `base` (a depth below the package root),
 * reporting where it ENDS, the SHALLOWEST point it passes through, and whether
 * it steps into an installed dependency.
 *
 * `min` is the load-bearing number, and `end` alone is a trap: a literal that
 * climbs past the package root and then descends into a SIBLING package ends at
 * a perfectly positive depth while addressing another package entirely.
 * `join(HERE, '..', '..', 'spec', 'src', 'rls.zod.ts')` from `<pkg>/src` ends at
 * +4 and reads `packages/spec` — the exact #7802 shape, invisible to a test on
 * the final depth. Final depth is only sound for a binding that STOPS at the top
 * of its ascent, which is what a `REPO_ROOT` const happens to be and what the
 * other spellings are not.
 */
function walkLiteral(base, literal) {
  let end = base;
  let min = base;
  let vendored = false;
  for (const seg of literal.split('/').filter(Boolean)) {
    if (seg === '..') end -= 1;
    else if (seg !== '.') {
      end += 1;
      // An installed dependency is not a repo source input: turbo cannot hash
      // `node_modules/**` as a source glob, and the walk above skips it anyway.
      // A read that lands there escapes the package but declares nothing.
      if (seg === 'node_modules') vendored = true;
    }
    if (end < min) min = end;
  }
  return { end, min, vendored };
}

/** Split an argument list on its TOP-LEVEL commas — `new URL(x, import.meta.url)` has one of its own. */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out;
}

const PATH_LITERAL = /^(['"`])([^'"`]*)\1$/;
const NEW_URL_LITERAL = /^new\s+URL\(\s*(['"`])([^'"`]*)\1\s*,\s*import\.meta\.url\s*\)$/;

/**
 * Resolve one path expression to `{ end, min, vendored }`, or `undefined` when
 * the spelling is not one of RECOGNISED_PATH_SPELLINGS. Recursive so that every
 * recognised form composes with every other: a `new URL` seed may sit under a
 * `fileURLToPath`, inside a `resolve()`, in a read's argument — each layer is
 * peeled by the same function rather than by a separate special case.
 */
function pathExpression(expr, hereDepth, known) {
  expr = expr.trim();

  // `fileURLToPath(x)` does not move the path, only its spelling.
  const unwrapped = expr.match(/^(?:url\.)?fileURLToPath\(([\s\S]*)\)$/);
  if (unwrapped) return pathExpression(unwrapped[1], hereDepth, known);

  if (/^(?:path\.)?dirname\(\s*(?:url\.)?fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)$/.test(expr)) {
    return { end: hereDepth, min: hereDepth, vendored: false };
  }
  if (expr === '__dirname') return { end: hereDepth, min: hereDepth, vendored: false };

  // A `new URL(rel, import.meta.url)` resolves against the importing FILE, so
  // its base is the file's directory — the same base as the two seeds above.
  const url = expr.match(NEW_URL_LITERAL);
  if (url) return walkLiteral(hereDepth, url[2]);

  if (/^[A-Za-z_$][\w$]*$/.test(expr)) return known.get(expr);

  const call = expr.match(/^(?:path\.)?(?:resolve|join)\(([\s\S]*)\)$/);
  if (!call) return undefined;
  const args = splitTopLevel(call[1]);
  const base = pathExpression(args[0], hereDepth, known);
  if (!base) return undefined;
  let { end, min, vendored } = base;
  for (const a of args.slice(1)) {
    const lit = a.match(PATH_LITERAL);
    if (!lit) continue;
    const step = walkLiteral(end, lit[2]);
    end = step.end;
    min = Math.min(min, step.min);
    vendored = vendored || step.vendored;
  }
  return { end, min, vendored };
}

/** The argument list of every fs read whose first argument is a path, paren-balanced. */
function* readArgumentLists(src) {
  const re = new RegExp(String.raw`\b(?:${PATH_ARG_READS.join('|')})\s*\(`, 'g');
  for (const m of src.matchAll(re)) {
    const from = m.index + m[0].length;
    let depth = 1;
    let quote = null;
    let i = from;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === '\\') i += 1;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(') depth += 1;
      else if (c === ')' && --depth === 0) break;
    }
    if (depth === 0) yield src.slice(from, i);
  }
}

/**
 * Every path in `src` that addresses something outside the package — which, in a
 * file that also reads the filesystem, is precisely the #7802 shape.
 *
 * Deliberately a source scan and not a real parse: a detector with no
 * dependencies cannot itself fail to resolve in CI, which is what keeps this
 * gate un-mutable. The price is that it only sees the spellings it knows, so the
 * list it knows is published (RECOGNISED_PATH_SPELLINGS, printed in the failure
 * text and mirrored in AGENTS.md) instead of being an implementation detail an
 * author has to reverse-engineer from a silent pass.
 *
 * Two positions are scanned, because a path is as often nested straight into the
 * read as it is bound to a name first:
 *   const SRC = readFileSync(resolve(HERE, '../../other/src/x.ts'), 'utf8');
 * binds `SRC` to file CONTENTS, never to a path, so a declaration-only scan sees
 * no path at all in the line that does the escaping.
 *
 * `--self-test` pins the shapes that must keep flagging AND the shapes that must
 * not; an added spelling without an added case is the next silent regression.
 */
export function escapingBindings(src, hereDepth) {
  const known = new Map();
  const found = [];
  const report = (name, info) => {
    // `vendored`: the read escapes the package but lands in an installed
    // dependency, which no declaration can name. Not a cross-package input.
    if (!info || info.vendored || info.min >= 0) return;
    found.push({ name, depth: info.min });
  };

  const DECL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+(?:\n\s*[^;\n]*)??)\s*;/g;
  for (const m of src.matchAll(DECL)) {
    const info = pathExpression(m[2].trim(), hereDepth, known);
    if (!info) continue;
    known.set(m[1], info);
    report(m[1], info);
  }

  let n = 0;
  for (const args of readArgumentLists(src)) {
    n += 1;
    const first = splitTopLevel(args)[0];
    // A bare binding here was already judged at its declaration; reporting it a
    // second time would only duplicate the finding under a less useful name.
    if (known.has(first)) continue;
    report(`read #${n} argument`, pathExpression(first, hereDepth, known));
  }
  return found;
}

/**
 * Repo-relative path literals a test names in its own source — the roster a
 * probe-style scan reads. Extracting them is what lets a declaration be NARROW
 * safely: a glob is only allowed to be narrow while it still covers every path
 * the tests actually name, and the moment someone adds a probe outside the
 * declared radius the gate fails naming the file. Over-collection (a path in a
 * comment or an assertion message) is harmless — it can only force a WIDER
 * declaration, never a narrower one.
 */
export function repoRelativeLiterals(src) {
  const out = new Set();
  for (const m of src.matchAll(/(['"`])((?:packages|apps|examples|content|scripts)\/[A-Za-z0-9._/-]+)\1/g)) {
    out.add(m[2]);
  }
  return out;
}

function packageNameOf(pkgRoot) {
  try {
    return JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).name ?? null;
  } catch {
    return null;
  }
}

/** Every package with at least one test that reads outside its own directory. */
export function findEscapingPackages() {
  const found = new Map();
  for (const top of ['packages', 'apps', 'examples']) {
    const dir = join(REPO_ROOT, top);
    if (!existsSync(dir)) continue;
    for (const file of walkTests(dir)) {
      const src = readFileSync(file, 'utf8');
      if (!FS_READ.test(src)) continue;
      const pkgRoot = packageRootOf(file);
      if (!pkgRoot) continue;
      const hereDepth = relative(pkgRoot, dirname(file)).split(sep).filter(Boolean).length;
      if (!escapingBindings(src, hereDepth).length) continue;
      const name = packageNameOf(pkgRoot);
      if (!name) continue;
      if (!found.has(name)) found.set(name, { dir: relative(REPO_ROOT, pkgRoot), tests: [], literals: new Map() });
      const entry = found.get(name);
      const rel = relative(REPO_ROOT, file);
      entry.tests.push(rel);
      const own = relative(REPO_ROOT, pkgRoot);
      for (const lit of repoRelativeLiterals(src)) {
        // Paths inside the package's own directory are already covered by
        // `$TURBO_DEFAULT$` and by the package's own affected-set membership.
        if (lit === own || lit.startsWith(`${own}/`)) continue;
        // Only literals naming a real FILE count. Test sources are full of
        // synthetic fixture paths (`packages/a/src/x.ts`) and of directory
        // prefixes used to build a path or phrase a message; neither is an
        // input, and requiring a glob to cover them would force declarations
        // wider than the truth.
        let isFile = false;
        try {
          isFile = statSync(join(REPO_ROOT, lit)).isFile();
        } catch {
          isFile = false;
        }
        if (!isFile) continue;
        if (!entry.literals.has(lit)) entry.literals.set(lit, rel);
      }
    }
  }
  return found;
}

// ── modes ────────────────────────────────────────────────────────────────────

function verify() {
  const escaping = findEscapingPackages();
  const declared = new Set(Object.keys(CROSS_PACKAGE_TEST_INPUTS));
  const problems = [];

  for (const [name, info] of [...escaping].sort()) {
    if (declared.has(name)) continue;
    problems.push(
      `${name} has test(s) that read outside the package but declares no input radius.\n` +
        info.tests.map((t) => `      ${t}`).join('\n') +
        `\n    Add an entry to CROSS_PACKAGE_TEST_INPUTS in ${relative(REPO_ROOT, fileURLToPath(import.meta.url))}\n` +
        `    with the repo-relative globs those tests read, then run this gate again\n` +
        `    for the turbo.json inputs it requires.`,
    );
  }
  for (const name of [...declared].sort()) {
    if (escaping.has(name)) continue;
    problems.push(
      `${name} declares a cross-package input radius, but no test in it reads outside\n` +
        `    the package any more. Delete the entry (and its turbo.json inputs) — a stale\n` +
        `    declaration invalidates that package's test cache for nothing.`,
    );
  }

  // A declaration may be narrower than "the whole repo" only while it still
  // covers every repo-relative path its tests name. This is what keeps
  // narrowing honest: extending a probe roster past the declared radius fails
  // here, by file name, instead of silently going ungated again.
  for (const [name, { globs }] of Object.entries(CROSS_PACKAGE_TEST_INPUTS)) {
    const info = escaping.get(name);
    if (!info) continue;
    const uncovered = [...info.literals].filter(([lit]) => !matchesAny(lit, globs));
    if (uncovered.length) {
      problems.push(
        `${name} names path(s) no declared glob covers, so a change to them would not\n` +
          `    re-run its tests:\n` +
          uncovered.map(([lit, test]) => `      ${lit}   (named in ${test})`).join('\n') +
          `\n    Widen the package's globs to cover them.`,
      );
    }
  }

  // Layer B: turbo.json must hash the declared globs, or the merge queue
  // replays a cached green over a scan it never ran (the #7802 escape itself).
  let turbo;
  try {
    turbo = JSON.parse(readFileSync(join(REPO_ROOT, 'turbo.json'), 'utf8'));
  } catch (e) {
    console.error(`FAIL: cannot read turbo.json: ${e.message}`);
    process.exit(1);
  }
  for (const [name, { globs }] of Object.entries(CROSS_PACKAGE_TEST_INPUTS)) {
    const task = turbo.tasks?.[`${name}#test`];
    if (!task) {
      problems.push(
        `turbo.json has no "${name}#test" task. Without it the package's test cache is\n` +
          `    keyed on package-local files only, so a change to its declared globs replays\n` +
          `    a stale green instead of re-running. Add it with inputs:\n` +
          `      ${JSON.stringify(expectedInputs(globs))}`,
      );
      continue;
    }
    const missing = globs.filter((g) => !(task.inputs ?? []).includes(`$TURBO_ROOT$/${g}`));
    if (missing.length) {
      problems.push(
        `turbo.json "${name}#test" inputs are missing the declared glob(s):\n` +
          missing.map((g) => `      $TURBO_ROOT$/${g}`).join('\n'),
      );
    }
  }

  if (problems.length) {
    console.error('FAIL: cross-package test inputs are not declared consistently.\n');
    for (const p of problems) console.error(`  - ${p}\n`);
    console.error(
      'Why this gate exists: a test whose real inputs are wider than its package is\n' +
        'invisible to BOTH the affected-subset filter and the turbo cache, so it can go\n' +
        'red on `main` while every PR reports green (#7802).\n',
    );
    console.error(
      'How this gate SEES a read, and its limit: it is a source scan, so it recognises\n' +
        'these spellings and only these. A path written any other way yields no flag —\n' +
        'which means no declaration, silently. Write escaping reads as:\n' +
        RECOGNISED_PATH_SPELLINGS.map((s) => `      ${s}`).join('\n') +
        '\n    Reaching for a spelling that is not here? Add it to the detector (with a\n' +
        '    --self-test case) rather than working around it — an unseen read is the\n' +
        '    defect above, not a style question.',
    );
    process.exit(1);
  }
  console.log(
    `OK: ${escaping.size} package(s) read outside themselves, all declared, ` +
      `and turbo.json hashes every declared glob.`,
  );
}

function expectedInputs(globs) {
  return ['$TURBO_DEFAULT$', '!dist/**', '!coverage/**', '!.turbo/**', ...globs.map((g) => `$TURBO_ROOT$/${g}`)];
}

/**
 * Layer A. Adds any declaring package whose globs the diff touches to the
 * package list ci.yml is about to shard, so the scan runs on the PR that
 * actually changed its inputs.
 */
function unionInto(listPath, changedPath) {
  const parsed = JSON.parse(readFileSync(listPath, 'utf8'));
  const items = parsed?.packages?.items;
  if (!Array.isArray(items)) {
    console.error(`FAIL: ${listPath} is not a \`turbo ls --output=json\` payload ({packages:{items:[...]}}).`);
    process.exit(1);
  }
  const changed = readFileSync(changedPath, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const present = new Set(items.map((i) => i.name));
  const added = [];
  for (const [name, { globs }] of Object.entries(CROSS_PACKAGE_TEST_INPUTS)) {
    if (present.has(name)) continue;
    const hit = changed.find((f) => matchesAny(f, globs));
    if (!hit) continue;
    const dir = [...findEscapingPackages()].find(([n]) => n === name)?.[1]?.dir;
    if (!dir) continue;
    items.push({ name, path: join(REPO_ROOT, dir) });
    added.push(`${name}  (declared glob matched ${hit})`);
  }
  writeFileSync(listPath, JSON.stringify(parsed));
  if (added.length) {
    console.log('Cross-package scans pulled into this run because the diff touched their declared inputs:');
    for (const a of added) console.log(`  + ${a}`);
  } else {
    console.log('No cross-package scan declares inputs touched by this diff.');
  }
}

function selfTest() {
  const cases = [];
  const ok = (label, cond) => cases.push({ label, cond });

  // glob semantics
  ok('** spans segments', matchesAny('packages/platform-objects/src/identity/x.object.ts', ['packages/**/*.object.ts']));
  ok('** matches a direct child', matchesAny('packages/a.object.ts', ['packages/**/*.object.ts']));
  ok('* does not span segments', !matchesAny('packages/a/b.object.ts', ['packages/*.object.ts']));
  ok('non-matching extension rejected', !matchesAny('packages/x/src/a.ts', ['packages/**/*.object.ts']));
  ok('trailing ** matches subtree', matchesAny('packages/lint/src/rules/a.ts', ['packages/lint/src/**']));
  ok('literal file glob', matchesAny('content/docs/references/index.mdx', ['content/docs/references/index.mdx']));
  ok('dot is literal', !matchesAny('contentXdocs/references/index.mdx', ['content/docs/references/index.mdx']));

  // detector shapes -- one per spelling that appears in the repo today
  const at = (src, depth) => escapingBindings(src, depth).length > 0;
  ok(
    'flags resolve() off a fileURLToPath seed (api-methods-batch-conformance)',
    at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst REPO_ROOT = resolve(HERE, '../../../..');", 2),
  );
  ok(
    'flags join() with a multi-segment literal (dogfood)',
    at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst REPO_ROOT = join(HERE, '../../../..');", 2),
  );
  ok(
    'flags a two-step chain (create-objectstack)',
    at(
      "const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');\n" +
        "const repoRoot = path.resolve(pkgRoot, '..', '..');",
      1,
    ),
  );
  ok(
    'does NOT flag a within-package resolve',
    !at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst FIX = resolve(HERE, '../fixtures');", 2),
  );
  ok(
    'does NOT flag a descent back below the package root',
    !at(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const ROOT = resolve(HERE, '../..');\n" +
        "const SRC = join(ROOT, 'src', 'data');",
      2,
    ),
  );

  // The ascent-then-descent shape. Every case below ends at a NON-NEGATIVE
  // depth while addressing a sibling package, so each one passes a test on the
  // final depth and is caught only by the shallowest point reached.
  ok(
    'flags a one-literal climb into a sibling package (formula -> spec)',
    at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst Z = join(HERE, '..', '..', 'spec', 'src', 'rls.zod.ts');", 1),
  );
  ok(
    'flags a fileURLToPath(new URL()) seed naming a sibling package',
    at("const SRC = fileURLToPath(new URL('../../../other-pkg/src/x.ts', import.meta.url));", 2),
  );
  ok(
    'flags a new URL() seed with no fileURLToPath around it',
    at("const SRC = new URL('../../../other-pkg/src/x.ts', import.meta.url);", 2),
  );
  ok(
    'flags a new URL() nested straight into a read (no path binding exists)',
    at("const SRC = readFileSync(new URL('../../../scripts/gate.mjs', import.meta.url), 'utf8');", 1),
  );
  ok(
    'flags a read whose argument is a multi-line new URL()',
    at("const c = readFileSync(\n  new URL('../../../scripts/gate.mjs', import.meta.url),\n  'utf8',\n);", 1),
  );
  ok(
    'flags a resolve() nested straight into a read',
    at(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const SRC = readFileSync(resolve(HERE, '../../../other-pkg/src/x.ts'), 'utf8');",
      2,
    ),
  );
  ok(
    'flags a fileURLToPath(new URL()) chained through resolve()',
    at("const P = resolve(fileURLToPath(new URL('..', import.meta.url)), '../../other-pkg/src');", 2),
  );
  ok(
    'does NOT flag a new URL() that stays inside the package',
    !at("const SRC = readFileSync(new URL('../sibling-dir/x.ts', import.meta.url), 'utf8');", 2),
  );
  ok(
    'does NOT flag a new URL() naming the package root itself',
    !at("const PKG = fileURLToPath(new URL('../../package.json', import.meta.url));", 2),
  );
  ok(
    'does NOT flag a climb into node_modules (no glob can declare an installed dep)',
    !at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst L = resolve(HERE, '../../../node_modules/tsx/dist/loader.mjs');", 1),
  );
  ok(
    'does NOT flag a read argument that is an unrecognised expression',
    !at('const SRC = readFileSync(somewhereElse(x), \'utf8\');', 2),
  );

  const failed = cases.filter((c) => !c.cond);
  for (const c of cases) console.log(`${c.cond ? 'ok  ' : 'FAIL'} ${c.label}`);
  if (failed.length) {
    console.error(`\n${failed.length}/${cases.length} self-test case(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} self-test cases passed.`);
}

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) selfTest();
else if (argv.includes('--list-escapes')) {
  for (const [name, info] of [...findEscapingPackages()].sort()) {
    console.log(`${name}  (${info.dir})`);
    for (const t of info.tests) console.log(`    ${t}`);
  }
} else if (argv.includes('--union-into')) {
  const listPath = argv[argv.indexOf('--union-into') + 1];
  const changedPath = argv[argv.indexOf('--changed') + 1];
  if (!listPath || !changedPath) {
    console.error('usage: check-cross-package-test-inputs.mjs --union-into <turbo-ls.json> --changed <file>');
    process.exit(2);
  }
  unionInto(listPath, changedPath);
} else verify();
