#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-entry-guard -- every `scripts/**` entry guard goes through ONE predicate.
 *
 *   node scripts/check-entry-guard.mjs              # scan the tree
 *   node scripts/check-entry-guard.mjs --self-test  # verify the checker itself
 *
 * ## What this gate is for
 *
 * A CLI script has to answer "did node run me, or did something import me?"
 * before it does anything. Hand-typed answers to that question had drifted into
 * ELEVEN distinct spellings across 33 files in `scripts/` -- measured, not
 * estimated -- and NINE of them were wrong. The dominant failure:
 *
 *   node resolves symlinks for the module graph but leaves `process.argv[1]`
 *   as the caller typed it
 *
 * so a script reached through a symlink compared two different paths, answered
 * `false`, and did nothing -- **exit 0, no output**. The CI wrappers spawn these
 * tools and hold `result.status` only, so an inert child is a green gate.
 *
 * The sweep that fixed those 33 files is worth little on its own: nothing stopped
 * a TWELFTH spelling from being typed the next time someone added a script, and
 * the next one would be just as invisible. This gate is the part that closes the
 * class. `scripts/invoked-as.mjs` is the only place allowed to read
 * `process.argv[1]`; everywhere else spells the guard
 *
 *   if (isEntrypoint(import.meta.url)) { ... }
 *
 * which has no comparison in it to get wrong.
 *
 * ## Why a spelling gate rather than a behavioural sweep
 *
 * The tempting alternative is to RUN every `scripts/**` entry point and assert
 * it produced something. That was rejected on measurement:
 *
 *   • many of these scripts have real side effects (`release-github-releases`,
 *     the `sync-*` pair, `objectui-changeset-digest`), so a gate that spawns all
 *     of them is a gate nobody can run locally;
 *   • "produced output" is not a decidable property of an arbitrary tool -- a
 *     quiet-on-success script is legitimate, so the assertion would have to be
 *     per-script, which is the same per-file hand-wiring this gate replaces.
 *
 * The behavioural evidence lives once, at the predicate: `invoked-as.mjs`'s
 * self-test drives a real probe through a real symlink, a differently-named
 * symlink, a path needing percent-encoding, and both import directions. Pinning
 * the predicate once and enforcing that everyone uses it covers the same ground
 * for 33 callers, and keeps covering it for the 34th.
 *
 * ## What it reads
 *
 * Comments AND string/template/regex literals are masked before the scan
 * (`js-comment-mask.mjs`), because a `process.argv[1]` inside a string payload
 * for a spawned child is not an entry guard -- `run-with-stall-guard.mjs` really
 * does carry one, and an allowlist to excuse it would be a hole the next such
 * file falls through silently.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { blank, scanSource } from './js-comment-mask.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(HERE, '..');
const SCRIPTS = HERE;

/** The one module allowed to read `process.argv[1]`. */
const PREDICATE_HOME = join(SCRIPTS, 'invoked-as.mjs');

/** The canonical guard, and the only accepted call shape. */
export const CANONICAL = 'isEntrypoint(import.meta.url)';

/**
 * Entry-guard idioms other than `process.argv[1]`. Each one answers the same
 * question and each has its own way of being wrong under a symlink or a bundler,
 * so none of them is a permitted second spelling.
 */
const OTHER_IDIOMS = [
  ['require.main', /\brequire\.main\b/g],
  ['import.meta.main', /\bimport\.meta\.main\b/g],
  ['process.mainModule', /\bprocess\.mainModule\b/g],
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.mjs') || name.endsWith('.js') || name.endsWith('.cjs')) out.push(p);
  }
  return out;
}

/** Code only: comments, strings, templates and regex literals all blanked. */
export function codeOnly(source) {
  const { comment, literal } = scanSource(source);
  const both = new Uint8Array(comment.length);
  for (let i = 0; i < both.length; i++) both[i] = comment[i] || literal[i];
  return blank(source, both);
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/**
 * Findings for one file's source. Exported so the self-test drives the real
 * scanner over fixture sources rather than over this tree, which would only
 * prove what today's tree happens to contain.
 */
export function scanFile(rel, source, { isPredicateHome = false } = {}) {
  const findings = [];
  const code = codeOnly(source);

  if (!isPredicateHome) {
    const re = /process\.argv\[1\]/g;
    let m;
    while ((m = re.exec(code))) {
      findings.push({
        rel,
        line: lineOf(source, m.index),
        what: 'process.argv[1]',
        why: 'a hand-typed entry guard',
      });
    }
    for (const [name, pattern] of OTHER_IDIOMS) {
      pattern.lastIndex = 0;
      let n;
      while ((n = pattern.exec(code))) {
        findings.push({ rel, line: lineOf(source, n.index), what: name, why: 'a second entry-guard idiom' });
      }
    }
  }

  // `isEntrypoint` takes the caller's own `import.meta.url`. Any other argument
  // is a guard asking about somebody else, which is the same class of wrong.
  // `(?<!function\s+)` so the DECLARATION of the predicate is not read as a
  // call on somebody else's url — `export function isEntrypoint(importMetaUrl)`
  // is what defines the shape, not a violation of it.
  const call = /(?<!function\s{1,4})\bisEntrypoint\s*\(([^)]*)\)/g;
  let c;
  while ((c = call.exec(code))) {
    const arg = c[1].trim();
    if (arg && arg !== 'import.meta.url') {
      findings.push({
        rel,
        line: lineOf(source, c.index),
        what: `isEntrypoint(${arg})`,
        why: 'the guard must ask about the caller itself',
      });
    }
  }
  return findings;
}

function main() {
  const files = walk(SCRIPTS).sort();
  const findings = [];
  for (const abs of files) {
    if (abs === resolve(fileURLToPath(import.meta.url))) continue; // this file quotes the idioms it bans
    const rel = relative(REPO_ROOT, abs);
    findings.push(...scanFile(rel, readFileSync(abs, 'utf8'), { isPredicateHome: abs === PREDICATE_HOME }));
  }

  if (findings.length) {
    console.error(`❌  check:entry-guard — ${findings.length} hand-typed entry guard(s) in scripts/:\n`);
    for (const f of findings) {
      console.error(`  ${f.rel}:${f.line}  ${f.what}  — ${f.why}`);
    }
    console.error(
      `\n    Every scripts/** entry guard goes through ONE predicate, because the` +
        `\n    hand-typed forms are silently WRONG: node leaves process.argv[1] as the` +
        `\n    caller typed it, so a script reached through a symlink compares two` +
        `\n    different paths, answers false, and does nothing — exit 0, no output.` +
        `\n` +
        `\n    Replace the guard with:` +
        `\n` +
        `\n      import { isEntrypoint } from './invoked-as.mjs';   // '../invoked-as.mjs' from a subdir` +
        `\n      if (${CANONICAL}) { ... }` +
        `\n` +
        `\n    scripts/invoked-as.mjs carries the rationale and the symlink fixture.`,
    );
    return 1;
  }
  console.log(`✓ check:entry-guard: ${files.length} scripts/ file(s) — every entry guard goes through invoked-as.mjs.`);
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test -- fixture sources, not this tree
// ---------------------------------------------------------------------------

export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });
  const n = (src, opts) => scanFile('f.mjs', src, opts).length;

  // ── the eleven spellings this gate exists to reject ───────────────────────
  const SPELLINGS = [
    "const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));",
    "const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);",
    "if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {}",
    "if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {}",
    "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {}",
    "if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {}",
    "if (process.argv[1] && import.meta.url === new URL(`file://` + process.argv[1]).href) {}",
    "const invokedDirectly = existsSync(process.argv[1] || '') && new URL(import.meta.url).pathname === process.argv[1];",
    "const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());",
    "const m = process.argv[1] && process.argv[1].endsWith('qa-rollup.mjs');",
    "if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {}",
  ];
  SPELLINGS.forEach((src, i) => t(`spelling ${i + 1} of ${SPELLINGS.length} is rejected`, n(src) > 0, src));

  // ── the canonical form is accepted ────────────────────────────────────────
  t('the canonical guard is accepted', n(`if (${CANONICAL}) { main(); }`) === 0);
  t('a file with no guard at all is accepted', n("console.log('hello');\n") === 0);

  // ── the predicate's own home may read argv ────────────────────────────────
  t(
    'invoked-as.mjs itself may read process.argv[1]',
    n('return invokedAs(process.argv[1], fileURLToPath(u));', { isPredicateHome: true }) === 0,
  );
  t(
    '...and that exemption is NOT extended to any other file',
    n('return invokedAs(process.argv[1], fileURLToPath(u));') > 0,
  );

  // ── prose and payloads are not guards ─────────────────────────────────────
  t('a process.argv[1] in a LINE COMMENT is not a guard', n('// process.argv[1] is left as typed\n') === 0);
  t('a process.argv[1] in a BLOCK COMMENT is not a guard', n('/**\n * process.argv[1] as typed\n */\n') === 0);
  t(
    'a process.argv[1] inside a STRING payload for a child is not a guard',
    n(`const s = 'require("fs").writeFileSync(process.argv[1], x)';\n`) === 0,
  );
  t(
    'a process.argv[1] inside a TEMPLATE payload is not a guard',
    n('const s = `node -e "f(process.argv[1])"`;\n') === 0,
  );

  // ── the other idioms ──────────────────────────────────────────────────────
  t('require.main is rejected', n('if (require.main === module) {}') > 0);
  t('import.meta.main is rejected', n('if (import.meta.main) {}') > 0);
  t('process.mainModule is rejected', n('if (process.mainModule === module) {}') > 0);

  // ── the call shape ────────────────────────────────────────────────────────
  t('isEntrypoint on someone else’s url is rejected', n('if (isEntrypoint(other.url)) {}') > 0);
  t('isEntrypoint(import.meta.url) is accepted', n('if (isEntrypoint(import.meta.url)) {}') === 0);
  t(
    'the DECLARATION of the predicate is not read as a call on someone else',
    n('export function isEntrypoint(importMetaUrl) {\n  return invokedAs(process.argv[1], u);\n}', { isPredicateHome: true }) === 0,
  );

  // ── the line number is the one a reader can open ──────────────────────────
  const multi = "line one\nline two\nconst g = process.argv[1] === x;\n";
  t('a finding reports the line the guard is ON', scanFile('f.mjs', multi)[0]?.line === 3, JSON.stringify(scanFile('f.mjs', multi)));

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-entry-guard self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(`✓ check-entry-guard self-test: ${cases.length} cases pass (all 11 measured spellings rejected, canonical form and masked prose/payloads accepted).`);
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : main());
}
