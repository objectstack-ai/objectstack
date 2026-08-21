#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-entry-guard -- every `scripts/**` entry guard goes through ONE predicate.
 *
 *   node scripts/check-entry-guard.mjs              # scan the tree
 *   node scripts/check-entry-guard.mjs --list       # every exporting file, and what runs on import
 *   node scripts/check-entry-guard.mjs --self-test  # verify the checker itself
 *
 * Two rules live here. The first is about the SPELLING of a guard that exists;
 * the second, further down, is about a guard that is MISSING from a file that
 * exports. They are separate because the second one is meaningless for the 42
 * files here that export nothing, and the first one is what the 2026-08 sweep
 * of eleven spellings was about.
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

/** This file, which quotes the idioms it bans. */
const SELF = resolve(fileURLToPath(import.meta.url));

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

/**
 * ## The second finding kind: an EXPORTING file whose top level runs on import
 *
 * The spelling half above says nothing about a file with NO guard, and that is
 * correct for the 42 pure CLIs in this tree that export nothing: nobody can
 * import them, so nothing can be hurt by what their top level does. It is
 * exactly wrong for a file that DOES export, because `import { helper } from
 * './check-thing.mjs'` then runs the tool.
 *
 * Measured on this tree (2026-08-21), by importing every exporting scripts/ file
 * in a child process for its exports alone and asking whether the importer
 * survived and stayed quiet:
 *
 *   population                         importer dies   tool runs, loud   silent
 *   --------------------------------   -------------   ---------------   ------
 *   42 exporters WITH the guard                    0                 0       33
 *   39 exporters WITHOUT the guard                 8                14        7
 *
 * (9 and 10 of those two rows respectively could not be loaded without
 * node_modules and are not in the columns.)
 *
 * Five of the eight deaths exit **0** — `check-nul-bytes.mjs`,
 * `check-changeset-no-major.mjs`, `check-test-completeness.mjs`,
 * `pm/check-governed-prose.mjs` and `check-empty-changeset.mjs` reach
 * `process.exit(0)` while the importer is still mid-import, so the importer's
 * own code after the `import` never runs and its caller reads success. That is
 * the same silent-exit-0 shape the spelling half of this gate exists for,
 * arriving through a different door.
 *
 * The class has been fixed one file at a time three times (#9757, #10610, and
 * the hand-copied `globToRegExp` in check-examples-live-imports.mjs that #10610
 * found, which named the load-time dispatch as its reason for copying rather
 * than importing). Nothing gated the next one.
 *
 * ## What the rule asserts, and why it needs no exception list
 *
 * A `scripts/**` file that exports a binding must have every top-level statement
 * that RUNS something inside the guard. Declarations are not statements that run
 * — `const HERE = resolve(...)` is how every file in here computes its own
 * paths, and flagging those would flag the whole tree.
 *
 * The seven silent unguarded exporters in the table above are pure library
 * modules (`adr-anchors`, `cli-build-prerequisite`, `console-spec-probes`,
 * `eslint-fatal-guard`, `eslint-stack-headroom`, `i18n-bundle-surface`,
 * `regen-artifacts`): constants and pure functions, no CLI, no top-level
 * statement that runs. The rule does not reach them, so they need no entry
 * anywhere — which is the whole point of shaping it this way. An exception list
 * would have been seven judgements nobody re-checks, i.e. the same drift one
 * level up. The static rule and the behavioural probe agree on all 29 files that
 * could be loaded: 7 silent, 22 not, no disagreement in either direction.
 */

/** A statement head that opens a block, so its `}` ends the statement. */
const BLOCK_HEAD = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class|if|for|while|do|try|switch)\b/;

/** A statement head that continues the statement before it. */
const CONTINUATION = /^(?:else|catch|finally)\b/;

/** A head that declares rather than runs. */
const DECLARATION_HEAD = /^(?:import|export|const|let|var|function|class|async\s+function)\b/;

/** Keyword parens, which are not calls. Stripped before looking for a call. */
const KEYWORD_PAREN = /\b(?:if|for|while|switch|catch|function|do|else|return|typeof|await|new|delete|void|in|of|yield)\s*\(/g;

/** What a call looks like once the keyword parens are gone. */
const CALL_SHAPE = /(?:[A-Za-z_$][\w$]*|\])\s*\(/;

/**
 * The top-level statements of already-masked code, as
 * `{ head, start, end }` — `head` with every nested `()`/`[]`/`{}` body elided
 * so it can be classified by its first token, and `[start, end)` indexing the
 * masked source so the body can still be read.
 *
 * Depth counting is enough here, and a parser is not needed, BECAUSE the input
 * is already masked: comments, strings, templates and regex literals are blank,
 * so the only brackets left are real ones and valid JS balances them. Exported
 * so the self-test drives the real slicer over fixture sources.
 */
export function topLevelStatements(code) {
  const out = [];
  let depth = 0;
  let head = '';
  let start = 0;
  const put = (ch, i) => {
    if (head.trim() === '' && !/\s/.test(ch)) start = i;
    head += ch;
  };
  const flush = (endIdx) => {
    const text = head.trim();
    if (text) out.push({ head: text, start, end: endIdx + 1 });
    head = '';
  };
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      if (depth === 0) put(ch, i);
      depth++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        put(ch, i);
        if (ch === '}' && BLOCK_HEAD.test(head.trim())) flush(i);
      }
      continue;
    }
    if (depth !== 0) continue;
    if (ch === ';') {
      flush(i);
      continue;
    }
    put(ch, i);
  }
  if (head.trim()) out.push({ head: head.trim(), start, end: code.length });

  // `else` / `catch` / `finally` continue the statement before them, so a guard
  // written `if (isEntrypoint(import.meta.url)) { … } else { … }` is ONE
  // statement and the `else` half is inside the guard, not beside it.
  const merged = [];
  for (const s of out) {
    const prev = merged[merged.length - 1];
    if (prev && CONTINUATION.test(s.head)) {
      prev.head += ` ${s.head}`;
      prev.end = s.end;
    } else merged.push({ ...s });
  }
  return merged;
}

/**
 * Top-level bindings whose value IS the guard. `const isMain =
 * isEntrypoint(import.meta.url); … if (isMain) { … }` is the same guard stored
 * once, and 11 files in this tree spell it that way — a rule that only looked
 * for the call inside the `if` would have called every one of them a violation.
 */
export function guardAliases(code) {
  const names = [];
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*isEntrypoint\s*\(\s*import\.meta\.url\s*\)\s*;/g;
  let m;
  while ((m = re.exec(code))) names.push(m[1]);
  return names;
}

/** A condition that opens with the guard, `!` and all. */
function guardConditionRe(aliases) {
  const terms = ['isEntrypoint\\s*\\(\\s*import\\.meta\\.url\\s*\\)'];
  if (aliases.length) terms.push(`(?:${aliases.map((a) => a.replace(/\$/g, '\\$')).join('|')})\\b`);
  return new RegExp(`^\\s*(!\\s*)?(?:${terms.join('|')})`);
}

/** The parenthesised condition of a statement, `''` when there is none. */
function conditionOf(raw) {
  const open = raw.indexOf('(');
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < raw.length; i++) {
    if (raw[i] === '(') depth++;
    else if (raw[i] === ')' && --depth === 0) return raw.slice(open + 1, i);
  }
  return '';
}

/**
 * An `if` split into the branch that runs when the condition is FALSE-on-import
 * and the branch that runs when it is true: `{ body, rest }` where `body` is the
 * first branch and `rest` is every `else` after it.
 */
function firstBranch(raw) {
  const open = raw.indexOf('(');
  if (open < 0) return null;
  let d = 0;
  let condEnd = -1;
  for (let i = open; i < raw.length; i++) {
    if (raw[i] === '(') d++;
    else if (raw[i] === ')' && --d === 0) {
      condEnd = i;
      break;
    }
  }
  if (condEnd < 0) return null;
  const brace = raw.indexOf('{', condEnd);
  const semi = raw.indexOf(';', condEnd);
  // A braceless `if (g) f();` ends at its semicolon; a braced one at its `}`.
  if (brace >= 0 && (semi < 0 || brace < semi)) {
    let b = 0;
    for (let i = brace; i < raw.length; i++) {
      if (raw[i] === '{') b++;
      else if (raw[i] === '}' && --b === 0) return { body: raw.slice(brace + 1, i), rest: raw.slice(i + 1) };
    }
    return { body: raw.slice(brace + 1), rest: '' };
  }
  if (semi < 0) return { body: raw.slice(condEnd + 1), rest: '' };
  return { body: raw.slice(condEnd + 1, semi), rest: raw.slice(semi + 1) };
}

/**
 * Is this whole top-level `if` behind the guard? Both spellings count, and they
 * put the import-time branch in opposite places:
 *
 *   if (isMain) { run(); }                     → nothing runs on import
 *   if (!isMain) { } else if (…) { run(); }    → the FIRST branch runs on import
 *
 * so the second form is accepted only when that first branch is empty, which is
 * exactly what its authors wrote (`// imported as a module — do nothing else`).
 */
export function isGuardedStatement(head, raw, guardRe) {
  if (!/^if\b/.test(head)) return false;
  const m = guardRe.exec(conditionOf(raw));
  if (!m) return false;
  const split = firstBranch(raw);
  if (!split) return false;
  return !runsOnImport(m[1] ? split.body : split.rest);
}

/**
 * Does this statement RUN something, as opposed to declaring something? A call
 * anywhere in it — including inside the body of a top-level `if`/`for`/`try` —
 * counts; a bare assignment of a literal (`TABLE[0x00] = 1`, which is how
 * check-nul-bytes builds its lookup) does not.
 */
export function runsOnImport(raw) {
  return CALL_SHAPE.test(raw.replace(KEYWORD_PAREN, ' ('));
}

/**
 * Does this masked source export anything? ONE definition, because the census
 * below needs the same answer and two spellings of it is how a rule ends up
 * enforced in one path and not the other — found by ablation: an earlier cut
 * repeated the test here and in the census, and blinding this copy left the
 * gate green.
 */
export function exportsBindings(code) {
  return /^export\b/m.test(code);
}

/**
 * The top-level statements of `source` that would run on `import`, or `[]` when
 * the file exports nothing (nobody can import it) or is already inert.
 */
export function importUnsafeStatements(source) {
  const code = codeOnly(source);
  if (!exportsBindings(code)) return [];
  const guardRe = guardConditionRe(guardAliases(code));
  const found = [];
  for (const s of topLevelStatements(code)) {
    if (DECLARATION_HEAD.test(s.head)) continue;
    const raw = code.slice(s.start, s.end);
    if (isGuardedStatement(s.head, raw, guardRe)) continue;
    if (!runsOnImport(raw)) continue;
    found.push({ line: lineOf(source, s.start), head: s.head.replace(/\s+/g, ' ').slice(0, 68) });
  }
  return found;
}

/**
 * ⛔ SHRINK-ONLY. The exporting `scripts/` files whose top level still runs on
 * import, as measured when this rule landed. It is a DEBT list, not an exception
 * list, and the difference is the whole reason it is safe to have one: every
 * entry has the same one-line remedy, and none of them records a judgement that
 * anyone has to re-make later. There is no supported route in the other
 * direction — a file this rule newly reaches is a failure with one remedy, never
 * a line in here. An entry whose file has since been fixed fails as STALE and
 * names itself, which is what stops this from rotting into an allowlist.
 */
const KNOWN_IMPORT_UNSAFE = new Set([
  'scripts/ablation-dist-preflight.mjs',
  'scripts/check-changeset-no-major.mjs',
  'scripts/check-dispatcher-error-vocabulary.mjs',
  'scripts/check-driver-memory-census.mjs',
  'scripts/check-empty-changeset.mjs',
  'scripts/check-engine-split-ratio.mjs',
  'scripts/check-error-code-casing.mjs',
  'scripts/check-error-status-conformance.mjs',
  'scripts/check-examples-live-imports.mjs',
  'scripts/check-filter-alias-parity.mjs',
  'scripts/check-nul-bytes.mjs',
  'scripts/check-org-identifier.mjs',
  'scripts/check-query-options-erasure-ratchet.mjs',
  'scripts/check-quick-reference-counts.mjs',
  'scripts/check-ratchet-remedy-authority.mjs',
  'scripts/check-release-page-status.mjs',
  'scripts/check-required-contexts.mjs',
  'scripts/check-route-envelope.mjs',
  'scripts/check-runtime-services-index.mjs',
  'scripts/check-shard-attestation.mjs',
  'scripts/check-spec-parsed-alias.mjs',
  'scripts/check-startup-registry-verdict.mjs',
  'scripts/check-tenant-chokepoint.mjs',
  'scripts/check-test-completeness.mjs',
  'scripts/check-workflow-status-functions.mjs',
  'scripts/checklist-select.mjs',
  'scripts/docs-audit/check-audit-scope.mjs',
  'scripts/measure-test-shard-timings.mjs',
  'scripts/objectui-range.mjs',
  'scripts/pm/check-governed-prose.mjs',
  'scripts/pm/check-label-desc-cap.mjs',
  'scripts/pm/check-skill-line-ratchet.mjs',
  'scripts/qa/qa-rollup.mjs',
  'scripts/ts-parse.mjs',
]);

/** Every exporting file, with the statements that would run on import. */
function importSafetyCensus(files) {
  const rows = [];
  for (const abs of files) {
    const rel = relative(REPO_ROOT, abs);
    const source = readFileSync(abs, 'utf8');
    if (!exportsBindings(codeOnly(source))) continue;
    rows.push({ rel, unsafe: importUnsafeStatements(source) });
  }
  return rows;
}

function main() {
  const files = walk(SCRIPTS).sort();
  const findings = [];
  for (const abs of files) {
    if (abs === SELF) continue; // this file quotes the idioms it bans
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

  // ── second kind: an exporting file whose top level runs on import ─────────
  const census = importSafetyCensus(files);
  const unsafe = census.filter((r) => r.unsafe.length);
  const fresh = unsafe.filter((r) => !KNOWN_IMPORT_UNSAFE.has(r.rel));
  const reached = new Set(unsafe.map((r) => r.rel));
  const stale = [...KNOWN_IMPORT_UNSAFE].filter((rel) => !reached.has(rel)).sort();

  if (fresh.length) {
    console.error(`❌  check:entry-guard — ${fresh.length} scripts/ file(s) export bindings AND run on import:\n`);
    for (const r of fresh) {
      for (const s of r.unsafe) console.error(`  ${r.rel}:${s.line}  ${s.head}`);
    }
    console.error(
      `\n    A scripts/** file that exports a binding can be imported FOR those` +
        `\n    exports. Whatever its top level runs then runs inside the importer:` +
        `\n    measured on this tree, 8 of the 39 unguarded exporters ended the` +
        `\n    importer mid-import and FIVE of those exit 0, so the caller reads` +
        `\n    success. One of them had already cost a hand-copied helper, because` +
        `\n    importing the real one ran the tool.` +
        `\n` +
        `\n    Put the top-level dispatch behind the guard:` +
        `\n` +
        `\n      import { isEntrypoint } from './invoked-as.mjs';   // '../invoked-as.mjs' from a subdir` +
        `\n      if (${CANONICAL}) { ... }` +
        `\n` +
        `\n    A file that exports nothing is never reached by this rule, and neither` +
        `\n    is one whose top level only declares. Nothing else is a way out.`,
    );
    return 1;
  }

  if (stale.length) {
    console.error(`❌  check:entry-guard — ${stale.length} stale KNOWN_IMPORT_UNSAFE entry/entries:\n`);
    for (const rel of stale) console.error(`  ${rel}  — no longer runs on import`);
    console.error(
      `\n    Good news, and the list must say so: delete each line above from` +
        `\n    KNOWN_IMPORT_UNSAFE in scripts/check-entry-guard.mjs. The list only` +
        `\n    ever shrinks, and a stale line is how it would have started drifting` +
        `\n    into an allowlist nobody re-reads.`,
    );
    return 1;
  }

  const inert = census.length - unsafe.length;
  console.log(
    `✓ check:entry-guard: ${files.length} scripts/ file(s) — every entry guard goes through invoked-as.mjs; ` +
      `${census.length} export bindings, ${inert} of them inert on import (${unsafe.length} known-unsafe, ⛔ SHRINK-ONLY).`,
  );
  return 0;
}

/** `--list`: what the import-safety rule sees, for burning the list down. */
function list() {
  const census = importSafetyCensus(walk(SCRIPTS).sort());
  for (const r of census.sort((a, b) => a.rel.localeCompare(b.rel))) {
    const known = KNOWN_IMPORT_UNSAFE.has(r.rel) ? ' [known]' : '';
    console.log(`${r.unsafe.length ? 'RUNS ' : 'inert'}  ${r.rel}${known}`);
    for (const s of r.unsafe) console.log(`         :${s.line}  ${s.head}`);
  }
  console.log(`\n${census.length} exporting file(s); ${census.filter((r) => r.unsafe.length).length} run on import.`);
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

  // ── the second kind: an EXPORTING file whose top level runs on import ────
  //
  // Asserted POSITIVELY in both directions. This gate prints files SCANNED, not
  // files recognised, so "the count moved" is not evidence available to a reader
  // — recognition has to be pinned here or it is not pinned anywhere.
  const u = (src) => importUnsafeStatements(src).length;
  const first = (src) => importUnsafeStatements(src)[0];

  // reject side
  t('an exporting file whose top level dispatches is REJECTED', u('export function f() {}\nmain();\n') === 1);
  t('...and the finding names the statement', first('export function f() {}\nmain();\n')?.head === 'main()');
  t('...and reports the line the statement is ON', first('export const a = 1;\n\nmain();\n')?.line === 3);
  t('a top-level process.exit() in an exporting file is rejected', u('export const a = 1;\nprocess.exit(main());\n') === 1);
  t(
    'a top-level argv branch in an exporting file is rejected',
    u("export const a = 1;\nif (process.argv.includes('--self-test')) { selfTest(); }\n") === 1,
  );
  t('a top-level try/catch that runs is rejected', u('export const a = 1;\ntry { main(); } catch (e) { report(e); }\n') === 1);
  t(
    'a guard on someone else’s url does not make a dispatch inert',
    u('export const a = 1;\nif (isEntrypoint(other.url)) { main(); }\n') === 1,
  );

  // accept side — every one of these is a real shape in scripts/, and none of
  // them costs an allowlist entry.
  t('a file that exports NOTHING is not reached', u('main();\nprocess.exit(0);\n') === 0);
  t('a module of declarations only is not reached', u("export const A = new Set(['x']);\nexport function f(x) { return g(x); }\n") === 0);
  t(
    'a const initializer that calls is a declaration, not a dispatch',
    u("export const HERE = resolve(fileURLToPath(import.meta.url), '..');\n") === 0,
  );
  t('a top-level literal assignment is not a dispatch', u("export const T = [];\nT[0] = 1;\nfor (const c of 'ab') T[c] = 0;\n") === 0);
  t('the canonical guard makes the dispatch inert', u(`export const a = 1;\nif (${CANONICAL}) { process.exit(main()); }\n`) === 0);
  t('a braceless guarded dispatch is accepted', u(`export const a = 1;\nif (${CANONICAL}) main();\n`) === 0);
  t('a guard stored in a const is the same guard', u(`export const a = 1;\nconst isMain = ${CANONICAL};\nif (isMain) { main(); }\n`) === 0);
  t(
    '...including with a further conjunct',
    u(`export const a = 1;\nconst isMain = ${CANONICAL};\nif (isMain && !process.argv.includes('--x')) { main(); }\n`) === 0,
  );
  t(
    'the INVERTED guard with an empty import branch is accepted',
    u(`export const a = 1;\nconst m = ${CANONICAL};\nif (!m) {\n  // imported — do nothing\n} else if (process.argv.includes('--x')) {\n  selfTest();\n} else {\n  main();\n}\n`) === 0,
  );
  t(
    '...and REJECTED when that import branch runs after all',
    u(`export const a = 1;\nconst m = ${CANONICAL};\nif (!m) {\n  warmCache();\n} else {\n  main();\n}\n`) === 1,
  );

  // ── the slicer, driven directly ──────────────────────────────────────────
  t('an import declaration is ONE top-level statement', topLevelStatements(codeOnly("import { a, b } from 'x';\n")).length === 1);
  t('a destructuring declaration is ONE top-level statement', topLevelStatements(codeOnly('const { a } = f();\n')).length === 1);
  t('else continues the statement before it', topLevelStatements(codeOnly('if (a) { x(); } else { y(); }\n')).length === 1);
  t('catch continues the statement before it', topLevelStatements(codeOnly('try { x(); } catch (e) { y(); }\n')).length === 1);

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-entry-guard self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-entry-guard self-test: ${cases.length} cases pass — all 11 measured spellings rejected, canonical form and masked prose/payloads accepted, ` +
      `and the import-safety rule recognised on both sides (dispatch/exit/argv-branch/try rejected; declarations, non-exporters and all three guard spellings accepted).`,
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv;
  process.exit(argv.includes('--self-test') ? selfTest() : argv.includes('--list') ? list() : main());
}
