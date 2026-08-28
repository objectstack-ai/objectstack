#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-watch-hint-literal -- every ROOT_DIR_WATCH_HINTS declaration in this
 * repo is spelled as a LITERAL array, inside the declaration statement itself.
 *
 *   node scripts/check-watch-hint-literal.mjs              # scan the tree
 *   node scripts/check-watch-hint-literal.mjs --list       # every declarer and what it declares
 *   node scripts/check-watch-hint-literal.mjs --self-test  # verify the checker itself
 *
 * ## The mechanism this closes
 *
 * `extractWatchHints` in `scripts/pm/dispatch-gates.mjs` reads SOURCE TEXT. A
 * declaration written as a literal contributes its hints; the same declaration
 * computed from the gate's population constant contributes NOTHING -- the
 * runtime value is identical, every local assertion about that value stays
 * green, and the gate silently drops out of every dispatch brief. Measured
 * against the extractor, one declaration, two spellings:
 *
 *     literal                                   -> ["scripts/**"]
 *     computed from the population constant     -> []
 *
 * A gate that loses its hint is unnameable by the dispatch tool and scores a
 * quiet green for every card in the tree it walks. Rewriting the declaration
 * that way is a natural-looking tidy-up: in most cases the hint is literally
 * the population root plus a subtree glob, so `ROOTS.map((r) => `${r}/**`)`
 * reads like an improvement.
 *
 * ## Why a shared gate rather than a per-file pin
 *
 * The idiom had one own-source pin holding a declaration to a literal spelling
 * (`scripts/check-cli-command-ids.mjs`, statement-scoped since #12759). Every
 * other declaration in the tree had nothing local that would redden. Eleven
 * copies of a per-file pin is eleven chances to write the SEARCH wrong, and the
 * measured way to write it wrong is documented below.
 *
 * ## The scoping detail that is the whole difficulty
 *
 * Searching the WHOLE FILE for the hint is not sufficient, and that is measured
 * twice on this tree:
 *
 *   - a gate may spell its own hint again in a neighbouring RUNTIME assertion,
 *     so a whole-file `includes` finds THAT copy and stays green on the
 *     computed declaration (the defect #12472 was filed for);
 *   - a gate may spell it a third time in a COMMENT, which the same whole-file
 *     search also accepts -- the assembled-needle remedy in
 *     `scripts/check-objectql-double-limit.mjs` was measured green against
 *     exactly that mutation.
 *
 * So the search here is scoped to the declaration STATEMENT, and comments are
 * masked before the statement is located, through the repo's one comment
 * scanner (`scripts/js-comment-mask.mjs`).
 *
 * ## What is asserted, and what is deliberately NOT
 *
 * Asserted: the right-hand side of the declaration is an ARRAY OF QUOTED STRING
 * LITERALS and nothing else. That is stronger than "each declared hint appears
 * quoted inside the statement", and it needs no runtime value, so this gate
 * never imports the files it judges -- a gate that imported 14 modules to read
 * one constant would run their module bodies to do it.
 *
 * NOT asserted: that a declaration is CORRECT -- that it names the roots the
 * gate really walks, and only those. That claim is local to each gate and each
 * one already pins it from its own side, where the walked root is in scope.
 * This gate holds the one property none of them can hold about itself: that the
 * declaration is still READABLE BY A TEXT SCANNER.
 *
 * An empty population is REFUSED rather than passed. "Every declaration is a
 * literal" is vacuously true over zero declarations, so a sweep that breaks --
 * a renamed constant, a walk that stops descending -- would otherwise report
 * the healthiest green this gate can print.
 *
 * ## A note for whoever adds a fixture here
 *
 * The scan masks comments but NOT string literals, so a fixture in the
 * self-test below that spelled the declaration verbatim would be found as a
 * second declaration site in this very file and refused. Fixtures therefore
 * assemble the constant name from `DECL_NAME`, and a self-test case pins that
 * this file still holds exactly one site.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { maskComments } from './js-comment-mask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/** The constant this gate is about, spelled ONCE. */
const DECL_NAME = 'ROOT_DIR_WATCH_HINTS';

/**
 * This gate's own declaration, and the reason it is narrower than the
 * population it walks.
 *
 * The population is every tracked source file that declares the constant --
 * repo-wide, because the idiom is not confined to `scripts/` (
 * `packages/spec/scripts/build-skill-references.ts` carries one). But the
 * spellable claim for a repo-wide walk would be a wholesale `packages/**`,
 * which is the costlier error: declaring a root a gate does not read wholesale
 * pastes it into every card under that root. So the declaration names the
 * subtree where the declarations actually live -- 13 of the 14 on this tree --
 * and the sweep stays repo-wide so nothing outside it is missed SILENTLY: a
 * declarer that appears elsewhere is judged like any other, it just does not
 * put this gate on that card's brief.
 */
const ROOT_DIR_WATCH_HINTS = ['scripts/**'];

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.turbo', '.next', '.cache', '.git', 'out',
]);

/** Anything the repo authors in JS or TS. `.d.ts` is generated. */
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;

/** Every authored JS/TS file under `dir`, dot-directories included. */
export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (SOURCE_EXT.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/**
 * The right-hand side of every declaration statement, comments masked.
 *
 * `[^;]*` is the statement terminator and also the guard: a right-hand side
 * carrying a `;` of its own (a block-bodied arrow, say) truncates here and
 * fails the literal test below, which is the safe direction to fail in.
 */
export function declarationSites(source) {
  const code = maskComments(source);
  const re = new RegExp(
    String.raw`\b(?:export\s+)?(?:const|let|var)\s+${DECL_NAME}\s*(?::[^=;]*)?=\s*([^;]*);`,
    'g',
  );
  return [...code.matchAll(re)].map((m) => m[1]);
}

/**
 * The hints a right-hand side spells as quoted literals, or `null` when the
 * right-hand side is anything other than an array of quoted string literals.
 *
 * Backticks are refused with the rest: a template is the computed spelling this
 * gate exists to catch, and `extractWatchHints` cannot read a value out of one.
 */
export function literalHints(rhs) {
  const s = rhs.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return null;
  let rest = s.slice(1, -1);
  const hints = [];
  const element = /^\s*(?:'([^'\\\n]*)'|"([^"\\\n]*)")\s*(,?)/;
  while (rest.trim() !== '') {
    const m = element.exec(rest);
    if (!m) return null;
    hints.push(m[1] ?? m[2]);
    rest = rest.slice(m[0].length);
    if (m[3] !== ',') break;
  }
  return rest.trim() === '' ? hints : null;
}

/**
 * One file's verdict. `null` means the file is not a declarer at all -- it
 * mentions the constant in prose, or reads someone else's.
 */
export function auditSource(rel, source) {
  if (!source.includes(DECL_NAME)) return null;
  const sites = declarationSites(source);
  if (sites.length === 0) return null;
  if (sites.length > 1) {
    return {
      rel,
      ok: false,
      why: `${sites.length} declaration sites -- this gate cannot judge a declaration it cannot locate`,
    };
  }
  const hints = literalHints(sites[0]);
  if (hints === null) {
    return {
      rel,
      ok: false,
      why: 'the declaration is COMPUTED, not a literal array -- the hint extractor reads source '
        + 'text, so a computed declaration builds no hint at all and the gate leaves every '
        + `dispatch brief: ${sites[0].trim().replace(/\s+/g, ' ').slice(0, 120)}`,
    };
  }
  if (hints.length === 0) {
    return { rel, ok: false, why: 'the declaration is EMPTY -- it names no subtree at all' };
  }
  return { rel, ok: true, hints };
}

/** Every declarer under `files`, judged. */
export function audit(files, read = (abs) => readFileSync(abs, 'utf8')) {
  const rows = [];
  for (const abs of files) {
    const rel = relative(REPO_ROOT, abs).split('\\').join('/');
    const row = auditSource(rel, read(abs));
    if (row) rows.push(row);
  }
  rows.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  return rows;
}

function list() {
  for (const r of audit(walk(REPO_ROOT))) {
    console.log(`${r.ok ? '  ' : '✗ '}${r.rel}  ${r.ok ? JSON.stringify(r.hints) : r.why}`);
  }
  return 0;
}

function main() {
  const rows = audit(walk(REPO_ROOT));
  if (rows.length === 0) {
    console.error(
      `✗ check-watch-hint-literal: NO ${DECL_NAME} declaration found anywhere in this tree. `
      + 'Refused rather than passed -- "every declaration is a literal" is vacuously true over '
      + 'an empty population, so a broken sweep would print this gate\'s healthiest green.',
    );
    return 1;
  }
  const bad = rows.filter((r) => !r.ok);
  for (const r of bad) console.error(`  ✗ ${r.rel} -- ${r.why}`);
  if (bad.length) {
    console.error(
      `✗ check-watch-hint-literal: ${bad.length} of ${rows.length} ${DECL_NAME} declaration(s) `
      + 'are not readable as literals. Spell the hints inside the declaration statement.',
    );
    return 1;
  }
  console.log(
    `✓ check-watch-hint-literal: ${rows.length} ${DECL_NAME} declaration(s), every one an array `
    + 'of quoted literals inside its own statement.',
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test -- fixture sources, plus the live tree
// ---------------------------------------------------------------------------

export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });
  /** A fixture that never spells the declaration verbatim in THIS file's text. */
  const decl = (rhs, extra = '') => `${extra}const ${DECL_NAME} = ${rhs};\n`;
  const verdict = (src) => auditSource('f.mjs', src);
  const rejected = (src) => verdict(src) !== null && verdict(src).ok === false;
  const accepted = (src) => verdict(src) !== null && verdict(src).ok === true;

  // -- the computed spellings this gate exists to reject ---------------------
  const COMPUTED = [
    'ROOTS.map((r) => `${r}/**`)',
    '[`${SCAN_ROOT}/**`]',
    "[SCAN_ROOT + '/**']",
    "['scripts' + '/' + '*'.repeat(2)]",
    '[...OTHER_HINTS]',
    "['scripts/**'].map((h) => h)",
    'ROOTS.filter((r) => !r.includes(SEP)).map((r) => r + SUFFIX)',
    "[join('scripts', '**')]",
  ];
  COMPUTED.forEach((rhs, i) => t(
    `computed spelling ${i + 1} of ${COMPUTED.length} is rejected`,
    rejected(decl(rhs)),
    rhs,
  ));

  // ⭐ The case the whole gate turns on, and the one both earlier remedies got
  // wrong: the literal is still in the file -- in a neighbouring RUNTIME
  // assertion and again in a COMMENT -- and the declaration is still computed.
  // A whole-file search finds those copies and stays green. This must not.
  const scoped = decl('[`${SCAN_ROOT}/**`]', `// the declared subtree is 'packages/**'\n`)
    + `assert(${DECL_NAME}.includes('packages/**'));\n`;
  t('a computed declaration is rejected THROUGH a runtime copy of the literal beside it',
    rejected(scoped), 'whole-file `includes` is what this replaces');
  t('...and through a COMMENT copy of the literal beside it',
    rejected(decl('[`${SCAN_ROOT}/**`]', `// hint: 'packages/**'\n`)));

  // -- shapes that are not a literal ARRAY -----------------------------------
  t('an empty declaration is rejected -- it names no subtree', rejected(decl('[]')));
  t('a bare string declaration is rejected', rejected(decl("'scripts/**'")));
  t('two declaration sites are refused rather than judged',
    rejected(decl("['a/**']") + decl("['b/**']")));

  // -- the literal spellings that must stay accepted -------------------------
  t('the canonical spelling is accepted', accepted(decl("['scripts/**']")));
  t('an exported declaration is accepted', accepted(decl("['a/**', \"b/**\"]", 'export ')));
  t('a multi-line array with a trailing comma is accepted',
    accepted(decl("[\n  'packages/*',\n  'apps/*',\n]")));
  t('an array carrying an inline comment is accepted',
    accepted(decl("[\n  'packages/*', // the workspace roots\n  'apps/*',\n]")));
  t('a TypeScript type annotation does not hide the declaration',
    accepted(`const ${DECL_NAME}: string[] = ['skills/**'];\n`));
  t('the hints are read back out of the statement',
    JSON.stringify(verdict(decl("['a/**', 'b/**']")).hints) === '["a/**","b/**"]');

  // -- comments and prose are not declarations -------------------------------
  t('a COMMENTED-OUT computed declaration does not shadow the real one',
    accepted(`// ${decl('ROOTS.map((r) => r)')}${decl("['skills/**']")}`));
  t('a file that only MENTIONS the constant is not a declarer',
    verdict(`// the ${DECL_NAME} idiom can only name a whole subtree\n`) === null);
  t('a file that reads someone else\'s declaration is not a declarer',
    verdict(`const spelled = mod.${DECL_NAME}.slice();\n`) === null);

  // -- the empty population is refused, not passed ---------------------------
  t('an empty population produces no rows, which main() refuses', audit([]).length === 0);

  // -- the live tree ---------------------------------------------------------
  const live = audit(walk(REPO_ROOT));
  t('the live sweep finds a real population, not a broken one', live.length >= 10,
    `${live.length} declarer(s)`);
  t('every live declaration is a literal', live.every((r) => r.ok),
    live.filter((r) => !r.ok).map((r) => r.rel).join(' · '));
  t('this gate judges ITSELF -- its own declaration is in the population',
    live.some((r) => r.rel === 'scripts/check-watch-hint-literal.mjs'));
  t('and this file holds exactly ONE declaration site, so its fixtures stay out of the scan',
    declarationSites(readFileSync(fileURLToPath(import.meta.url), 'utf8')).length === 1);
  t('the population reaches OUTSIDE scripts/, which is why the sweep is repo-wide',
    live.some((r) => !r.rel.startsWith('scripts/')));
  t('the declared subtree is where most declarations live',
    ROOT_DIR_WATCH_HINTS.includes('scripts/**')
    && live.filter((r) => r.rel.startsWith('scripts/')).length >= 10);

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-watch-hint-literal self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-watch-hint-literal self-test: ${cases.length} cases pass -- ${COMPUTED.length} computed `
    + 'spellings rejected, the statement-scoped search proved against runtime and comment copies of '
    + 'the literal beside it, literal spellings accepted, and the live repo-wide population judged.',
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv;
  process.exit(argv.includes('--self-test') ? selfTest() : argv.includes('--list') ? list() : main());
}
