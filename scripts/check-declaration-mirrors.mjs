#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-declaration-mirrors -- keeps a hand-written `.d.mts` in step with the
// `.mjs` module it declares, for the root scripts that publish types by hand.
//
// ── The defect this exists to make impossible (#10549) ───────────────────────
//
// `scripts/js-comment-mask.mjs` and `scripts/check-regen-pending.mjs` are
// untyped `.mjs`, and each ships a hand-written `scripts/<name>.d.mts` beside
// it. That was a deliberate trade (#5475, #10398): the modules stay `.mjs`
// because `pre-commit` and the gates invoke them with bare `node`, while
// `packages/spec/scripts/` imports them from inside a tsc program where an
// untyped `.mjs` import is TS7016. Both declaration files say so, and both say
// the same thing about maintenance -- "Keep this file in step with the module
// by hand".
//
// Nothing checked that they were. Not a test, not a gate, not a build step. A
// TypeScript consumer sees ONLY the declaration, so on drift every consumer
// type-checks GREEN against a signature the module does not implement, and the
// first symptom is a runtime failure somewhere downstream.
//
// That is worse than the three sibling shapes this tree hit the same week
// (#9901's options type, #10078's `/meta` scope maps, #10063's `publishMetaItem`
// declared type), and worse in a specific way: in each of those the declaration
// and the value disagreed, but something EXECUTED the value and went red. A
// `.d.mts` has no runtime existence at all. Nothing executes it, so nothing can
// notice on its own.
//
// ── Why the cost is measured rather than hypothetical ───────────────────────
//
// PR #10513 demonstrated that one of these files silently decides a typecheck
// result across trees. The branch forked at `5c3faa70d`; `js-comment-mask.d.mts`
// landed on `main` in `0681a76b8` after that. On the branch's tree the import
// had no types, so an `@ts-expect-error` on it was load-bearing and `tsc` was
// clean; on CI's merged tree the import resolved WITH types, the directive was
// unused, `TS2578`, two typecheck lanes red -- and `@objectstack/cli`'s ledger
// entry has `surplus: none`, so `typecheck-debt` went red with them. That was
// base drift rather than signature drift, but it is the same file deciding a
// typecheck outcome, and it cost PR #10450 two merge-queue evictions.
//
// A signature drift is strictly worse than that episode, because it fails
// GREEN.
//
// ── What this asserts, and what it deliberately does not ────────────────────
//
// The corpus is DISCOVERED, never listed: every `scripts/**/*.d.mts` is checked
// against its sibling module. A third mirror added tomorrow is covered by
// existing here, which is the property a hand-kept list would not have.
//
// For each pair, per declared export:
//
//   NAME   -- a declared value export the module does not export at all. This
//             is the fail-green direction above, and the reason this gate
//             exists: a rename on the module side leaves every consumer
//             type-checking clean against a symbol that resolves to
//             `undefined` at runtime.
//   KIND   -- `export function` must BE a function at runtime.
//   ARITY  -- the declared REQUIRED parameter count must equal the module's
//             `Function.length`, which is exactly "parameters before the first
//             one with a default or a rest". So `distIsStale(specDir?: string)`
//             agrees with `distIsStale(specDir = SPEC_DIR)` -- 0 required on
//             both sides -- and a newly REQUIRED parameter on either side is a
//             disagreement.
//
// ⛔ What it does NOT assert: parameter and return TYPES. `maskComments`
// returning `string[]` where the declaration says `string` is invisible to any
// runtime check, and a gate that overstates its coverage is worse than one that
// states its limit -- so the limit is stated here rather than discovered later.
// Those stay hand-maintained, and stay cheap because both mirrors are small by
// design.
//
// ⛔ One direction is deliberately NOT fatal: a module export that the
// declaration omits. `check-regen-pending.mjs` exports eight functions and
// declares three, on purpose -- its declaration says "The surface is three
// functions". That partial mirror cannot fail green: a consumer importing an
// undeclared name gets `TS2305`, which is loud, red and immediate. Failing on
// it here would turn a safe, deliberate design into a red gate, and would grow
// the hand-maintained surface this gate exists to shrink.
//
// An export spelling this parser cannot classify is an ERROR, never a silent
// skip -- the same rule the cross-package gate publishes for its own scan. A
// declaration that yields NO exports is an error too: absence must be loud
// (AGENTS.md, Route & surface ownership §3), or a masking bug would read as a
// clean pass over a file nothing checked.
//
// ── One self-reference, measured and accepted rather than discovered ────────
//
// This gate imports `maskComments` from `./js-comment-mask.mjs`, which is one
// of the two modules in its own corpus. So a drift in THAT module's masking
// export is the one case this gate cannot report on: measured by ablation, a
// `maskComments` turned into a non-function makes this file die with
// `TypeError: maskComments is not a function` at `parseDeclaration` instead of
// printing a verdict.
//
// Accepted, for a reason that has to be checked rather than assumed: the crash
// is LOUD. It exits non-zero, so CI is red either way, and this family's whole
// danger is the failure that goes green. What is lost is the message quality,
// not the signal. The alternative -- a second copy of the comment masker living
// here -- would add an untested duplicate of the exact thing five gates were
// consolidated onto, to improve an error string in a case that already fails.
// The other mirror (`check-regen-pending`) is not a dependency of this file, so
// all three rules stay demonstrable on a module this gate does not import.
//
// Usage:
//   node scripts/check-declaration-mirrors.mjs
//   node scripts/check-declaration-mirrors.mjs --self-test

import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { maskComments } from './js-comment-mask.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');

/**
 * POPULATION DECLARATION -- the corpus this gate's verdict is ABOUT, in the
 * subtree spelling `scripts/pm/dispatch-gates.mjs` compares in.
 *
 * Nothing here reads it; `mirrorFiles()` and `checkPair()` do. It is declared
 * anyway, because the dispatch derivation reads SOURCE TEXT and this gate's
 * population is discovered by EXTENSION with no path literal anywhere: the walk
 * is rooted at `SCRIPTS_DIR`, whose only spelled component is the bare
 * single-segment word `scripts` -- no separator, so `extractWatchHints`
 * recovers nothing from it, and `hintCovers` would refuse a bare word anyway.
 *
 * Measured on `ca46f8f12` before this constant existed, on the exact change set
 * the defect was filed from:
 *
 *   dispatch-gates --commands -- scripts/js-comment-mask.d.mts \
 *                                scripts/js-comment-mask.mjs
 *     -> 31 commands, ZERO of them this gate
 *
 * So the one class of change this gate exists for -- a hand-written `.d.mts`
 * moving out of step with the module it mirrors -- was the class the derivation
 * never sent here, and the red arrived in CI a cycle late (#15553; the specimen
 * is PR #15532, whose 32 derived commands were all green while this gate went
 * red on an arity mismatch).
 *
 * BOTH SIDES are declared, because either side moving breaks the mirror: the
 * declaration side is what `mirrorFiles()` walks, and the module side is what
 * `checkPair()` imports to read `Function.length` off. A change set naming only
 * `js-comment-mask.mjs` can turn this gate red without touching a `.d.mts` at
 * all.
 *
 * ⛔ NOT a hand list of the four mirror pairs: the corpus is DISCOVERED on
 * purpose (see this file's header), and a hint list that enumerated today's
 * pairs would go quiet on the fifth exactly as the walk would not.
 *
 * ## The precision this costs, measured rather than asserted
 *
 * `scripts/**\/*.d.mts` reaches 4 tracked files and this gate reads all 4 --
 * 100% precise. `scripts/**\/*.mjs` reaches 214 and this gate reads 4 of them
 * -- 1.9%. That second hint is the price of keeping the module side declared
 * without a hand list, and it is small in the only currency that matters here:
 * the pair of commands `lint.yml` runs costs ~0.18 s of wall clock, and over
 * the 36 open PRs on the day this landed it newly named this gate on 10 of them
 * (1 through the `.d.mts` hint, 9 through the `.mjs` one). ~1.6 s of fleet
 * compute per 36 cards, against a defect class whose alternative is a CI red a
 * cycle late. Under `hintCovers`' recorded ruling -- over-naming is loud and
 * self-limiting, under-naming is silent -- that trade runs the right way.
 *
 * Spelled as a LITERAL array, never computed from the walk's extension test:
 * the extractor reads SOURCE TEXT, so a built spelling keeps this value
 * identical at runtime, keeps every assertion about it green, and contributes
 * ZERO hints. `check-watch-hint-literal.mjs` holds that rule fleet-wide; the
 * self-test below holds the own-source half.
 */
const ROOT_DIR_WATCH_HINTS = ['scripts/**/*.d.mts', 'scripts/**/*.mjs'];

/**
 * The export spellings this parser recognises, in the words a declaration
 * author would write them. Published for the same reason the cross-package
 * gate publishes its path spellings: an unrecognised spelling must be a red
 * gate naming itself, not a silent skip, and the author needs to know what the
 * parser reads before it tells them it could not read something.
 */
export const RECOGNISED_DECLARATION_SPELLINGS = [
  'export function name(a: T, b?: U): R;   // and `export declare function`',
  'export const name: T;                   // and `export declare const`',
  'export class Name { … }',
  'export interface Name { … }             // type-only: no runtime existence',
  'export type Name = …;                   // likewise',
];

/** Every `scripts/**\/*.d.mts`, repo-relative, sorted. Discovered, never listed. */
export function mirrorFiles(dir = SCRIPTS_DIR) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.d.mts')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Scan from `open` (an index of `(`) to its matching `)`. Returns the inside,
 * or null.
 *
 * ⚠️ Only `()`, `[]` and `{}` move the depth here — deliberately NOT `<>`. An
 * angle bracket is not a bracket: `>` is also the tail of `=>`, and a callback
 * parameter is the ordinary way to spell one. Counting it closed this scan at
 * the arrow, so `f(cb: (x: number) => void, y: string)` handed back the inside
 * as `cb: (x: number) =` and the arity came out 0 instead of 2 — silently, with
 * nothing in `unrecognised` to say so. That is this gate's own failure mode
 * turned on itself: a wrong number believed, rather than a spelling refused.
 * Generic arguments inside a parameter list keep their parens balanced, so
 * ignoring `<>` costs this scan nothing.
 */
function balanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Split a parameter list on its TOP-LEVEL commas — a param type may hold its
 * own (`m: Map<string, number>` is ONE parameter).
 *
 * So `<>` DOES count here, unlike in `balanced` above, and for the same reason
 * it must not there: a `>` preceded by `=` is an arrow, never a closing angle.
 * Without that exception `cb: (x: number) => void, y: string` splits into one
 * parameter instead of two.
 */
function splitParams(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{' || c === '<') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === '>' && text[i - 1] !== '=') depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out.filter(Boolean);
}

/**
 * The count of LEADING required parameters — the same thing `Function.length`
 * reports at runtime, which is why the two are comparable at all. A parameter
 * is not required once it is optional (`name?`), has a default (`= x`), or is a
 * rest (`...rest`), and TypeScript forbids a required one after an optional, so
 * counting leading ones loses nothing.
 *
 * ⚠️ The default-value test excludes `=>` for the third time in this file's
 * bracket handling: an arrow inside a parameter TYPE is not a default value on
 * the parameter. Miss it and `cb: (x: number) => void` reads as defaulted, the
 * loop breaks at the first parameter, and the arity is silently 0.
 */
export function requiredArity(paramText) {
  let n = 0;
  for (const p of splitParams(paramText)) {
    if (p.startsWith('...')) break;
    const name = p.split(':')[0].trim();
    if (name.endsWith('?')) break;
    if (/(^|[^=!<>])=([^=>]|$)/.test(p)) break;
    n += 1;
  }
  return n;
}

/**
 * Parse one declaration source into its exports.
 *
 * Comments are masked first (`js-comment-mask`, the repo's one code/prose
 * separator): these files are mostly prose, and their prose says things like
 * "the two flag arrays are the load-bearing part of the surface" — an
 * `export`-shaped word in a docblock must not read as a declaration. The
 * zero-export check in `checkPair()` is what keeps that masking honest: if it
 * ever erased too much, the result is a loud error, not a clean pass.
 *
 * @returns {{ exports: Array<{name: string, kind: string, arity: number|null, line: number}>,
 *             unrecognised: Array<{text: string, line: number}> }}
 */
export function parseDeclaration(src) {
  const masked = maskComments(src);
  const lineOf = (i) => masked.slice(0, i).split('\n').length;
  const exports = [];
  const unrecognised = [];

  for (const m of masked.matchAll(/\bexport\b/g)) {
    const at = m.index;
    const rest = masked.slice(at);
    // `export declare function f(…)` / `export function f(…)`
    const fn = rest.match(/^export\s+(?:declare\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^(]*>)?\s*\(/);
    if (fn) {
      const open = at + rest.indexOf('(', fn[0].length - 1);
      const params = balanced(masked, open);
      exports.push({ name: fn[1], kind: 'function', arity: params === null ? null : requiredArity(params), line: lineOf(at) });
      continue;
    }
    const cls = rest.match(/^export\s+(?:declare\s+)?class\s+([A-Za-z_$][\w$]*)/);
    if (cls) {
      exports.push({ name: cls[1], kind: 'function', arity: null, line: lineOf(at) });
      continue;
    }
    const cnst = rest.match(/^export\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
    if (cnst) {
      exports.push({ name: cnst[1], kind: 'value', arity: null, line: lineOf(at) });
      continue;
    }
    const typeOnly = rest.match(/^export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/);
    if (typeOnly) {
      exports.push({ name: typeOnly[1], kind: 'type', arity: null, line: lineOf(at) });
      continue;
    }
    unrecognised.push({ text: rest.slice(0, rest.search(/[\n;{]/) + 1).trim() || 'export', line: lineOf(at) });
  }
  return { exports, unrecognised };
}

/** Compare one `.d.mts` against the module it mirrors. @returns {string[]} problems */
export async function checkPair(declPath, moduleFor = (p) => p.replace(/\.d\.mts$/, '.mjs')) {
  const problems = [];
  const declRel = relative(REPO_ROOT, declPath).split(sep).join('/');
  const modPath = moduleFor(declPath);
  const modRel = relative(REPO_ROOT, modPath).split(sep).join('/');

  if (!existsSync(modPath)) {
    problems.push(
      `${declRel} declares a module that does not exist (${modRel}).\n` +
        `    A declaration mirroring nothing is drift by itself: it keeps type-checking\n` +
        `    consumers green over an import that cannot resolve at runtime.`,
    );
    return problems;
  }

  const { exports: declared, unrecognised } = parseDeclaration(readFileSync(declPath, 'utf8'));

  for (const u of unrecognised) {
    problems.push(
      `${declRel}:${u.line} uses an export spelling this gate cannot read: \`${u.text}\`\n` +
        `    An unread declaration is an UNCHECKED declaration, so this is an error rather\n` +
        `    than a skip. Teach the parser the spelling (with a --self-test case), or write\n` +
        `    one of:\n` +
        RECOGNISED_DECLARATION_SPELLINGS.map((s) => `      ${s}`).join('\n'),
    );
  }

  if (declared.length === 0) {
    problems.push(
      `${declRel} declares nothing this gate could find.\n` +
        `    Absence must be loud: an empty parse is indistinguishable from a clean pass,\n` +
        `    and that is the failure mode this gate exists to not have.`,
    );
    return problems;
  }

  let mod;
  try {
    mod = await import(pathToFileURL(modPath).href);
  } catch (e) {
    problems.push(`${modRel} could not be imported, so its declaration cannot be checked: ${e.message}`);
    return problems;
  }

  for (const d of declared) {
    // A type-only export has no runtime existence — which is precisely why this
    // family goes unnoticed, and precisely why there is nothing to assert here.
    if (d.kind === 'type') continue;

    if (!(d.name in mod)) {
      problems.push(
        `${declRel}:${d.line} declares \`${d.name}\`, but ${modRel} does not export it.\n` +
          `    This is the direction that fails GREEN: every TypeScript consumer sees the\n` +
          `    declaration and only the declaration, so it type-checks clean and calls a\n` +
          `    symbol that is \`undefined\` at runtime. Rename it here, or export it there.`,
      );
      continue;
    }
    if (d.kind === 'function' && typeof mod[d.name] !== 'function') {
      problems.push(
        `${declRel}:${d.line} declares \`${d.name}\` as a function, but ${modRel} exports ` +
          `\`${typeof mod[d.name]}\`.\n` +
          `    A consumer calling it type-checks clean and throws at runtime.`,
      );
      continue;
    }
    if (d.arity !== null && typeof mod[d.name] === 'function' && mod[d.name].length !== d.arity) {
      problems.push(
        `${declRel}:${d.line} declares \`${d.name}\` with ${d.arity} required parameter(s), but ` +
          `${modRel} implements ${mod[d.name].length}.\n` +
          `    \`Function.length\` counts parameters before the first default or rest, so an\n` +
          `    optional declared parameter (\`x?: T\`) agrees with a defaulted one (\`x = v\`).\n` +
          `    A disagreement here means a caller the declaration admits is one the module\n` +
          `    cannot serve.`,
      );
    }
  }
  return problems;
}

async function main() {
  const files = mirrorFiles();
  if (files.length === 0) {
    console.error(
      'FAIL: no `scripts/**/*.d.mts` found at all.\n' +
        '  This gate discovers its corpus rather than listing it, so an empty corpus is\n' +
        '  either a moved directory or a broken walk — never a pass.',
    );
    process.exit(1);
  }

  const problems = [];
  for (const f of files) problems.push(...(await checkPair(f)));

  if (problems.length) {
    console.error('FAIL: a hand-written declaration disagrees with the module it mirrors.\n');
    for (const p of problems) console.error(`  - ${p}\n`);
    console.error(
      'Why this gate exists: a `.d.mts` has no runtime existence, so nothing executes it\n' +
        'and nothing notices when it drifts. TypeScript consumers see only the declaration,\n' +
        'which means drift type-checks GREEN against a signature the module does not\n' +
        'implement, and the first symptom is a runtime failure downstream (#10549).\n',
    );
    process.exit(1);
  }

  const pairs = files.map((f) => relative(REPO_ROOT, f).split(sep).join('/'));
  console.log(
    `OK: ${files.length} hand-written declaration(s) agree with their modules on name, kind ` +
      `and required arity.\n  ${pairs.join('\n  ')}\n` +
      `  (Parameter and return TYPES are not asserted — see this file's header.)`,
  );
}

// ── self-test ───────────────────────────────────────────────────────────────

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-declaration-mirrors self-test reached its verdict';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `cases.filter((c) => !c.cond)` used to be this self-test's ONLY success
// condition, so "every case
// held" and "the cases never ran" printed the same line. Closed the way
// PR #13487 validated on check-doc-authoring: what is pinned is the registered
// NAMES, not a number. The floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count.
//
// This file declares ONE battery, opened at the top of the self-test body. Its
// blocks are headed by unmarked prose comments, so it carries fewer than the two
// named section banners the sectioning criterion needs, and ⛔ a comment is NOT
// promoted to a section head — that is a judgement per comment this transplant
// does not make. The hoisted single battery is the shape PR #14896, PR #15003
// and PR #15217 landed for exactly this case.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The count is a FLOOR, not an equality — adding cases is ordinary work and must
// not red. A battery BELOW its floor means cases stopped running; the remedy is
// to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'check-declaration-mirrors self-test': 29,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 1;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

async function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  battery('check-declaration-mirrors self-test');
  const cases = [];
  // The concise arrow gains a BLOCK body so the case can be registered before
  // it is recorded; `cases.push` is unchanged, so no assertion is rewritten.
  const ok = (label, cond) => {
    registerCase();
    cases.push({ label, cond });
  };
  const dir = mkdtempSync(join(tmpdir(), 'os-decl-mirror-'));
  let seq = 0;

  /** Write a `.d.mts`/`.mjs` pair and return the problems `checkPair` reports. */
  const pair = async (decl, mod) => {
    const base = join(dir, `case${(seq += 1)}`);
    writeFileSync(`${base}.d.mts`, decl);
    if (mod !== null) writeFileSync(`${base}.mjs`, mod);
    return checkPair(`${base}.d.mts`);
  };

  // The agreeing shape, which every rejection below is measured against.
  ok(
    'an agreeing pair reports nothing',
    (await pair('export function mask(source: string): string;\n', 'export function mask(source) { return source; }\n')).length === 0,
  );

  // ── the fail-GREEN direction, the whole point of the gate ──
  ok(
    'a declared export the module does not export is a problem',
    (await pair('export function maskComments(source: string): string;\n', 'export function mask(source) { return source; }\n')).some((p) =>
      p.includes('does not export it'),
    ),
  );
  ok(
    'and the message names the fail-green mechanism rather than only the symbol',
    (await pair('export function gone(a: string): string;\n', 'export function here(a) { return a; }\n')).some((p) =>
      p.includes('fails GREEN'),
    ),
  );

  // ── arity, in both directions ──
  ok(
    'a newly required parameter on the module side is a problem',
    (await pair('export function f(a: string): string;\n', 'export function f(a, b) { return a + b; }\n')).some((p) =>
      p.includes('required parameter'),
    ),
  );
  ok(
    'a newly required parameter on the DECLARATION side is a problem',
    (await pair('export function f(a: string, b: string): string;\n', 'export function f(a) { return a; }\n')).some((p) =>
      p.includes('required parameter'),
    ),
  );
  // The `check-regen-pending` shape: `specDir?: string` against `specDir = SPEC_DIR`.
  // Both are 0 required, so this must NOT fire — the case that would make the
  // gate unusable on the very corpus it ships for.
  ok(
    'an optional declared parameter agrees with a defaulted implementation',
    (await pair('export function distIsStale(specDir?: string): boolean;\n', 'export function distIsStale(specDir = "x") { return !specDir; }\n')).length === 0,
  );
  ok(
    'a rest parameter is not counted as required',
    (await pair('export function f(...args: string[]): string;\n', 'export function f(...args) { return args[0]; }\n')).length === 0,
  );
  ok(
    'a parameter whose TYPE holds a comma is still one parameter',
    (await pair('export function f(a: Record<string, number>): void;\n', 'export function f(a) { return a; }\n')).length === 0,
  );
  // ⚠️ The ARROW cases. `>` is the tail of `=>` as well as a closing angle, and
  // reading it as a bracket made this parser hand back a truncated parameter
  // list and report arity 0 — quietly, with nothing in `unrecognised`. That is
  // a wrong number BELIEVED, which is the shape this gate exists to refuse, so
  // both halves are pinned: the count must be right, and a genuinely
  // disagreeing module must still be caught through the same spelling. Neither
  // mirror uses a callback parameter today; the day one does, this holds.
  ok(
    'a callback parameter does not collapse the arity (the `=>` is not a bracket)',
    (await pair('export function f(cb: (x: number) => void, y: string): void;\n', 'export function f(cb, y) { return cb(y); }\n')).length === 0,
  );
  ok(
    'and a real disagreement behind a callback parameter is still caught',
    (await pair('export function f(cb: (x: number) => void, y: string): void;\n', 'export function f(cb) { return cb; }\n')).some((p) =>
      p.includes('required parameter'),
    ),
  );
  ok(
    'an arrow return type is not read as a default value',
    (await pair('export function f(cb: (m: Map<string, number>) => void): void;\n', 'export function f(cb) { return cb; }\n')).length === 0,
  );

  // ── kind ──
  ok(
    'a declared function that is a value at runtime is a problem',
    (await pair('export function f(a: string): string;\n', 'export const f = "not a function";\n')).some((p) => p.includes('exports `string`')),
  );
  ok(
    'a declared const need only exist',
    (await pair('export const FLAGS: number;\n', 'export const FLAGS = 3;\n')).length === 0,
  );

  // ── the type-only exports, which have no runtime existence to check ──
  ok(
    'an exported interface is not required at runtime',
    (await pair('export interface SourceFlags { comment: Uint8Array; }\nexport function f(a: string): string;\n', 'export function f(a) { return a; }\n')).length === 0,
  );
  ok(
    'an exported type alias is not required at runtime',
    (await pair('export type Flags = number;\nexport function f(a: string): string;\n', 'export function f(a) { return a; }\n')).length === 0,
  );

  // ── the direction that is deliberately NOT fatal ──
  ok(
    'a module export the declaration omits is NOT a problem (it fails red at the consumer)',
    (await pair('export function f(a: string): string;\n', 'export function f(a) { return a; }\nexport function extra() { return 1; }\n')).length === 0,
  );

  // ── loud on anything unread ──
  ok(
    'an unrecognised export spelling is an error, not a skip',
    (await pair('export default function f(a: string): string;\n', 'export default function f(a) { return a; }\n')).some((p) =>
      p.includes('cannot read'),
    ),
  );
  ok(
    'a declaration that declares nothing is an error',
    (await pair('// only prose, no declarations at all\n', 'export function f(a) { return a; }\n')).some((p) => p.includes('declares nothing')),
  );
  ok(
    'a declaration with no module beside it is an error',
    (await pair('export function f(a: string): string;\n', null)).some((p) => p.includes('does not exist')),
  );

  // ── comment masking: prose must not read as a declaration ──
  ok(
    'an `export` word inside a comment is not parsed as a declaration',
    parseDeclaration('// this module exports things; export function ghost(): void; is prose\nexport function real(a: string): string;\n').exports.length === 1,
  );
  ok(
    'and the one real declaration is the one found',
    parseDeclaration('// export function ghost(): void;\nexport function real(a: string): string;\n').exports[0].name === 'real',
  );

  // ── the corpus is discovered, and it is not empty on this tree ──
  ok('the corpus walk finds this repo\'s mirrors', mirrorFiles().length >= 2);
  ok(
    'and it finds them under scripts/ by extension, not by a hand-kept list',
    mirrorFiles().every((f) => f.endsWith('.d.mts')),
  );

  // ── the population this gate DECLARES to the dispatch derivation (#15553) ──
  //
  // The walk above is discovered by EXTENSION and spells no path, so before the
  // declaration beside `SCRIPTS_DIR` existed a change set naming a mirror --
  // either half of one -- derived every other `scripts/` family and not this
  // one. Nothing in THIS file can ENFORCE the declaration: `extractWatchHints`
  // and `hintCovers` live in another tool entirely, so a wrong or missing one
  // runs green here forever. What CAN be held here are the properties a wrong
  // one breaks -- it is a live literal the extractor can read, it is not the
  // bare root the consumer refuses or over-names on, and its extensions still
  // admit every file the walk really opens, on BOTH sides of a mirror.
  const declaredRoots = ROOT_DIR_WATCH_HINTS.map((h) => h.split('/')[0]);
  const declaredSuffixes = ROOT_DIR_WATCH_HINTS.map((h) => h.slice(h.lastIndexOf('*') + 1));
  const admits = (repoRelative) =>
    ROOT_DIR_WATCH_HINTS.some((h, i) =>
      repoRelative.split('/')[0] === declaredRoots[i] && repoRelative.endsWith(declaredSuffixes[i]));
  ok(
    'the gate declares a population at all',
    Array.isArray(ROOT_DIR_WATCH_HINTS) && ROOT_DIR_WATCH_HINTS.length > 0,
  );
  ok(
    'every declared hint is multi-segment, so the consumer does not refuse it as a bare word',
    ROOT_DIR_WATCH_HINTS.every((h) => h.split('/').filter(Boolean).length > 1),
  );
  ok(
    'and none of them is the bare subtree or the repo root, which would name this gate for every '
      + 'JSON, Markdown and text file the walk never opens',
    ROOT_DIR_WATCH_HINTS.every((h) => !h.endsWith('/**') && h !== '.' && h !== '**'),
  );
  // The card's own point, held against the LIVE walk rather than a fixture: the
  // declaration side of every mirror this tree really has is admitted by the
  // extensions declared. A fifth pair added tomorrow is walked by `mirrorFiles`
  // and covered by the same hint, which is the property a hand list would lose.
  ok(
    'every declaration the walk discovers is admitted by a declared hint',
    mirrorFiles().length > 0
      && mirrorFiles().every((f) => admits(relative(REPO_ROOT, f).split(sep).join('/'))),
  );
  // And the MODULE side, which `checkPair` imports to read `Function.length`
  // off: an arity change there reds this gate with no `.d.mts` edited at all,
  // so a declaration naming only the declarations would miss half the class.
  ok(
    'and so is the module each declaration mirrors, whose arity the gate reads',
    mirrorFiles().length > 0
      && mirrorFiles().every((f) =>
        admits(relative(REPO_ROOT, f.replace(/\.d\.mts$/, '.mjs')).split(sep).join('/'))),
  );
  // Read from THIS file's own source, comment-masked and scoped to the
  // declaration STATEMENT: a whole-file search finds the spellings the docblock
  // above writes and passes on a computed declaration, which is the one
  // spelling that keeps every case above green while contributing ZERO hints.
  const ownDeclaration = (() => {
    const code = maskComments(readFileSync(fileURLToPath(import.meta.url), 'utf8'));
    const sites = [...code.matchAll(/\bconst\s+ROOT_DIR_WATCH_HINTS\s*=\s*([^;]*);/g)];
    return sites.length === 1 ? sites[0][1] : null;
  })();
  ok(
    'the declaration is ONE literal array of quoted strings — a computed spelling keeps this value '
      + 'identical at runtime and contributes ZERO hints to the derivation',
    ownDeclaration !== null
      && ROOT_DIR_WATCH_HINTS.every((h) => ownDeclaration.includes(`'${h}'`))
      && /^\s*\[\s*(?:'[^'\\]*'\s*,\s*)*'[^'\\]*'\s*,?\s*\]\s*$/.test(ownDeclaration),
  );

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  // This file's sink IS the `cases` ledger, so the floor speaks its idiom: a
  // breach is recorded as a failing case and reds through the existing verdict
  // below. It bypasses `ok()` deliberately — a floor message is not a case.
  const floorFailure = (message) => { cases.push({ label: message, cond: false }); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }

  const failed = cases.filter((c) => !c.cond);
  for (const c of cases) console.log(`${c.cond ? 'ok  ' : 'FAIL'} ${c.label}`);
  if (failed.length) {
    console.error(`\n${failed.length}/${cases.length} self-test case(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} self-test cases passed.`);

  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    if ((await selfTest()) !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-declaration-mirrors self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  }
  else await main();
}
