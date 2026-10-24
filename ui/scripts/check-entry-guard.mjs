#!/usr/bin/env node

/**
 * check-entry-guard -- every `scripts/**` entry guard goes through ONE predicate.
 *
 *   node scripts/check-entry-guard.mjs              # scan the tree
 *   node scripts/check-entry-guard.mjs --list       # every exporting file, and what runs on import
 *   node scripts/check-entry-guard.mjs --self-test  # verify the checker itself
 *
 * Ported from objectstack's gate of the same name (objectstack#10784 and the
 * cards above it), NOT copied: objectstack swept its tree BEFORE landing the
 * gate, so its spelling rule admits no exceptions at all. This repository was
 * swept the other way round -- gate first, then the sweep -- so the port landed
 * carrying a baseline of 29 owed files that objectstack has no need for. That
 * baseline is now EMPTY: objectui#6092's second half converted all 29 and
 * deleted every line. The design question the shape answers -- how a baseline
 * is kept from becoming an allowlist -- is what got it to empty, and is still
 * what keeps a new line from being added. See "The baseline" below.
 *
 * Two rules live here. The first is about the SPELLING of a guard that exists;
 * the second, further down, is about a guard that is MISSING from a file that
 * exports. They are separate because the second one is meaningless for the
 * files here that export nothing.
 *
 * ## What this gate is for
 *
 * A CLI script has to answer "did node run me, or did something import me?"
 * before it does anything. Hand-typed answers to that question HAD drifted
 * into NINE distinct spellings across 28 `.mjs` files in `scripts/` here --
 * measured on `133e2ea1e`, not estimated -- and every one of them was wrong in
 * the same way. All 29 sites (those 28 plus `shadcn-sync.js`) now go through
 * the predicate; what this gate is for is the TENTH spelling, which nothing
 * else in CI can see. The dominant failure:
 *
 *   node resolves symlinks for the module graph but leaves `process.argv[1]`
 *   as the caller typed it
 *
 * so a script reached through a symlink compares two different paths, answers
 * `false`, and does nothing -- **exit 0, no output**. The CI wrappers spawn
 * these tools and hold `result.status` only, so an inert child is a green gate.
 *
 * That was measured in THIS tree, on a real blocking gate (objectui#6078),
 * against the spelling `check-skills-paths.mjs` carried before the sweep:
 *
 *   node scripts/check-skills-paths.mjs              direct  : exit=1, 696 bytes
 *   node /…/link/check-skills-paths.mjs  (symlink)   symlink : exit=0, 0 bytes
 *
 * Same tree, same defect, same gate. A second spelling went inert with no
 * symlink at all: `check-node-esm-load.mjs` wrote
 * ``import.meta.url === `file://${process.argv[1]}` ``, which percent-encodes
 * apart from `argv[1]` in any directory whose name needs encoding (measured in
 * a directory named `a#b c`). Both files now use the predicate; the two
 * measurements are kept because they are why the rule exists, not a to-do.
 *
 * `scripts/invoked-as.mjs` is the only place allowed to read `process.argv[1]`;
 * everywhere else spells the guard
 *
 *   if (isEntrypoint(import.meta.url)) { ... }
 *
 * which has no comparison in it to get wrong.
 *
 * ## Why the gate landed BEFORE the sweep
 *
 * The sweep on its own is worth little: nothing would stop a TENTH spelling
 * from being typed the next time someone adds a script, and the next one would
 * be just as invisible. That is not hypothetical here -- objectui#6092 measured
 * the worklist growing while the card sat open: `check-designer-field-key-parity.mjs`
 * added a guard between `a1c41c516` and `7c96c9420`. A sweep with no gate under
 * it can be silently undone by the next pull request. So the gate landed first
 * and named its own worklist, and the conversion of those 29 call sites landed
 * against it -- each conversion had to lower or delete its own baseline line or
 * this gate failed STALE and named the file, which is what made the sweep
 * self-checking rather than a claim.
 *
 * ## The baseline, and why it is not an allowlist
 *
 * ⛔ SHRINK-ONLY, and shaped so the difference is mechanical rather than a
 * promise. `KNOWN_HAND_TYPED_GUARDS` maps a file to the NUMBER of masked
 * `process.argv[1]` occurrences it carried when this gate landed. It is EMPTY
 * now; the shape is what emptied it, in three consequences:
 *
 *   • a file NOT in the map that carries a guard fails -- with the map empty
 *     that is every file, so this is the whole live rule today and a 30th
 *     spelling cannot land;
 *   • a file IN the map that carries MORE than its number failed -- a second
 *     guard could not be smuggled into an already-owed file, which a
 *     path-only baseline would have accepted silently;
 *   • a file that carried FEWER failed as STALE and named itself, with the
 *     remedy being to lower or delete the line. There was no supported route
 *     that raised a number, and there is none that adds one back.
 *
 * The last two are unreachable while the map is empty, and they stay in
 * `reconcileGuards` (and pinned by the self-test) precisely because that is the
 * state a re-added line would have to pass through: a baseline that only ever
 * shrank cannot be re-opened as an allowlist.
 *
 * Every entry had the same one-line remedy -- `isEntrypoint(import.meta.url)`
 * -- so no entry recorded a judgement anyone had to re-make. That is the
 * property that made the debt list safe, and it is the only reason one was here.
 *
 * ONE of the 29 was different in kind: `scripts/shadcn-sync.js` hand-typed the
 * CORRECT two-leg shape (`realpathSync(resolved) === __filename`), so this gate
 * never reported it as a defect. It was in the map because the rule is "one
 * predicate", not "one predicate or a second correct implementation" -- its
 * conversion was a simplification, not a fix, and that distinction is now
 * recorded at the call site in `shadcn-sync.js` rather than here.
 *
 * ## Why a spelling gate rather than a behavioural sweep
 *
 * The tempting alternative is to RUN every `scripts/**` entry point and assert
 * it produced something. That was rejected upstream on measurement, and the
 * same reasoning holds here:
 *
 *   • many of these scripts have real side effects (`shadcn-sync`,
 *     `sync-quick-reference-release`, `regenerate-known-schema-types`), so a
 *     gate that spawns all of them is a gate nobody can run locally;
 *   • "produced output" is not a decidable property of an arbitrary tool -- a
 *     quiet-on-success script is legitimate, so the assertion would have to be
 *     per-script, which is the same per-file hand-wiring this gate replaces.
 *
 * The behavioural evidence lives once, at the predicate: `invoked-as.mjs`'s
 * self-test drives a real probe through a real symlink, a differently-named
 * symlink, a path needing percent-encoding, and both import directions.
 *
 * ## What it reads
 *
 * Comments AND string/template/regex literals are masked before the scan
 * (`js-comment-mask.mjs`), because a `process.argv[1]` inside a string payload
 * for a spawned child is not an entry guard, and neither is one inside a
 * docblock. That masking is load-bearing, not defensive: after the sweep the
 * only `scripts/` files that still contain the string at all are this gate
 * (skipped -- it quotes the idioms it bans), `invoked-as.mjs` (the one module
 * allowed to read it), and `js-comment-mask.mjs`, whose own corpus carries 8
 * occurrences in literals. Unmasked, that last file would read as a 30th
 * hand-typed guard, and an allowlist to excuse it would be a hole the next such
 * file falls through silently.
 *
 * ## What was deliberately NOT ported
 *
 * objectstack's copy carries a `ROOT_DIR_WATCH_HINTS` declaration read by its
 * `scripts/pm/dispatch-gates.mjs`. There is no such tool in this repository, so
 * the declaration would be a literal nothing reads, and its self-test cases
 * would assert a contract with an absent consumer. It is left out rather than
 * carried as decoration -- a ported claim about a file that does not exist here
 * is the exact defect objectui#6078 recorded against `invoked-as.mjs`'s header.
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
 * so none of them is a permitted second spelling. None is written in this tree
 * today (measured), and they are listed so that the first one cannot arrive
 * quietly as "not the shape the gate looks for".
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

/**
 * Code only: comments, strings, templates and regex literals blanked — MINUS
 * the bytes a `${...}` interpolation contributes, which the language runs.
 *
 * That subtraction is not a refinement, it is the difference between this gate
 * seeing this tree's worst guard and not seeing it. `comment || literal` is
 * `js-comment-mask.mjs`'s documented answer and is right for its other callers,
 * but under it the line
 *
 *   import.meta.url === `file://${process.argv[1]}`
 *
 * at `scripts/check-node-esm-load.mjs:847` is prose. Measured: the first cut of
 * this gate, using the plain view, listed 28 of this tree's 29 hand-typed
 * guards and omitted exactly that one — the spelling objectui#6092 singles out
 * as the one that goes inert with no symlink at all. `interpolation` is the
 * third array added for this; `js-comment-mask.mjs` states what it excludes and
 * pins it.
 */
export function codeOnly(source) {
  const { comment, literal, interpolation } = scanSource(source);
  const both = new Uint8Array(comment.length);
  for (let i = 0; i < both.length; i++) both[i] = comment[i] || (literal[i] && !interpolation[i]);
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
 * ⛔ SHRINK-ONLY, and now EMPTY. This carried the 29 hand-typed entry guards
 * the tree had when the gate landed, as `path -> number of masked
 * process.argv[1] occurrences`; objectui#6092's second half converted all 29
 * and deleted every line. The rationale, and why a COUNT rather than a bare
 * path, is in the header.
 *
 * It stays here, empty, because the reconciliation it feeds is the live rule:
 * a `scripts/` file that hand-types a guard is now a file the map does not
 * carry, so it fails as FRESH and names itself. There is no supported route
 * that adds a line back — the remedy for a new hand-typed guard is the same
 * one-liner every deleted line had:
 *
 *   import { isEntrypoint } from './invoked-as.mjs';
 *   if (isEntrypoint(import.meta.url)) { … }
 */
const KNOWN_HAND_TYPED_GUARDS = new Map([]);

/**
 * Reconcile what the tree carries against the shrink-only baseline. Pure, and
 * exported, because "the gate reddens on a 30th" is the entire justification
 * for landing it before the sweep — and a run over today's tree can only ever
 * show that today's tree is green. Recognition has to be pinned here, or it is
 * not pinned anywhere.
 *
 * `observed` is `rel -> count`; `baseline` is the map above.
 */
export function reconcileGuards(observed, baseline) {
  const fresh = [];
  const stale = [];
  for (const [rel, count] of observed) {
    const owed = baseline.get(rel);
    if (owed === undefined) fresh.push({ rel, count, owed: 0 });
    else if (count > owed) fresh.push({ rel, count, owed });
  }
  for (const [rel, owed] of baseline) {
    const count = observed.get(rel) ?? 0;
    if (count < owed) stale.push({ rel, count, owed });
  }
  fresh.sort((a, b) => a.rel.localeCompare(b.rel));
  stale.sort((a, b) => a.rel.localeCompare(b.rel));
  return { fresh, stale };
}

/**
 * ## The second finding kind: an EXPORTING file whose top level runs on import
 *
 * The spelling half above says nothing about a file with NO guard, and that is
 * correct for the pure CLIs in this tree that export nothing: nobody can import
 * them, so nothing can be hurt by what their top level does. It is exactly
 * wrong for a file that DOES export, because `import { helper } from
 * './check-thing.mjs'` then runs the tool — and several of these reach
 * `process.exit(0)` while the importer is still mid-import, so the importer's
 * own code after the `import` never runs and its caller reads success. That is
 * the same silent-exit-0 shape the spelling half of this gate exists for,
 * arriving through a different door.
 *
 * ## What the rule asserts, and why it needs no exception list
 *
 * A `scripts/**` file that exports a binding must have every top-level statement
 * that RUNS something inside the guard. Declarations are not statements that run
 * — `const HERE = resolve(...)` is how every file in here computes its own
 * paths, and flagging those would flag the whole tree. A file that exports
 * nothing is never reached, and neither is a module of declarations only, so
 * pure library modules need no entry anywhere — which is the point of shaping
 * it this way. An exception list would have been judgements nobody re-checks,
 * i.e. the same drift one level up.
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

/** A hand-typed entry guard, whatever its nine spellings. */
const HAND_TYPED = /process\.argv\[1\]/;

/**
 * Top-level bindings whose value IS the guard. `const isMain =
 * isEntrypoint(import.meta.url); … if (isMain) { … }` is the same guard stored
 * once, and a rule that only looked for the call inside the `if` would call
 * every file that spells it that way a violation.
 *
 * ## Why a HAND-TYPED initializer counts here too
 *
 * This is the port's one substantive divergence from objectstack's copy, and
 * it exists because objectstack swept before landing the gate and this tree has
 * not. `const invokedDirectly = process.argv[1] && resolve(…) === …;` is a
 * BADLY SPELLED guard — rule 1 above says so, by name, on its own line — but it
 * is still a guard: on an `import` the comparison is false and the dispatch
 * does not run. Refusing to recognise it would make rule 2 report all 29 of
 * those files as "runs on import", which is FALSE, and the baseline of 34 that
 * produced would have been a list of 29 untruths plus 5 real entries.
 *
 * A debt list is only safe while every line is true and has one remedy. So the
 * two rules divide the tree honestly: rule 1 owns the SPELLING complaint about
 * these files, rule 2 owns files with no guard at all. Converting a file clears
 * it from rule 1's map and never touches rule 2's.
 */
export function guardAliases(code) {
  const names = [];
  const canonical = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*isEntrypoint\s*\(\s*import\.meta\.url\s*\)\s*;/g;
  let m;
  while ((m = canonical.exec(code))) names.push(m[1]);
  const hand = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*);/g;
  let h;
  while ((h = hand.exec(code))) if (HAND_TYPED.test(h[2])) names.push(h[1]);
  return names;
}

/**
 * Named functions whose BODY is an entry-guard test, so `if (invokedAsCli())`
 * is the same guard behind one more indirection. `scripts/shadcn-sync.js`
 * writes exactly that, and it is the file objectui#6092 singles out as already
 * CORRECT — reporting it as running on import would have been the one entry in
 * a debt list that was both false and pointed at the best-behaved file in the
 * tree.
 */
export function guardPredicates(code) {
  const names = [];
  const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(code))) {
    const open = code.indexOf('{', m.index + m[0].length - 1);
    if (open < 0) continue;
    let d = 0;
    let end = -1;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') d++;
      else if (code[i] === '}' && --d === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) continue;
    const body = code.slice(open, end);
    if (HAND_TYPED.test(body) || /isEntrypoint\s*\(\s*import\.meta\.url\s*\)/.test(body)) names.push(m[1]);
  }
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
 * so the second form is accepted only when that first branch is empty.
 */
export function isGuardedStatement(head, raw, guardRe) {
  if (!/^if\b/.test(head)) return false;
  const condition = conditionOf(raw);
  const m = guardRe.exec(condition);
  // A condition that IS a hand-typed guard, written inline rather than stored
  // in a binding — `if (process.argv[1] && resolve(…) === …) { main(); }`, the
  // shape 12 of this tree's files write. See `guardAliases` for why rule 2
  // recognises it while rule 1 still fails it.
  const negated = m ? Boolean(m[1]) : /^\s*!/.test(condition);
  if (!m && !HAND_TYPED.test(condition)) return false;
  const split = firstBranch(raw);
  if (!split) return false;
  return !runsOnImport(negated ? split.body : split.rest);
}

/**
 * Does this statement RUN something, as opposed to declaring something? A call
 * anywhere in it — including inside the body of a top-level `if`/`for`/`try` —
 * counts; a bare assignment of a literal (`TABLE[0x00] = 1`, which is how a
 * lookup table is built) does not.
 */
export function runsOnImport(raw) {
  return CALL_SHAPE.test(raw.replace(KEYWORD_PAREN, ' ('));
}

/**
 * Does this masked source export anything? ONE definition, because the census
 * below needs the same answer and two spellings of it is how a rule ends up
 * enforced in one path and not the other.
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
  const guardRe = guardConditionRe([...guardAliases(code), ...guardPredicates(code)]);
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
 * import, as measured when this rule landed. A DEBT list, not an exception
 * list: every entry has the same one-line remedy and none records a judgement
 * anyone re-makes. A file this rule newly reaches is a failure with one remedy,
 * never a line in here. An entry whose file has since been fixed fails as STALE
 * and names itself, which is what stops this from rotting into an allowlist.
 *
 * EMPTY, and that is now the point. It stays as an empty set rather than being
 * deleted: an empty debt list is the state this rule exists to reach, and the
 * set still has to be here for a re-added line to be reconciled — FRESH and
 * STALE are both pinned by the self-test in exactly that state. Nothing appears
 * here because this rule recognises a hand-typed guard AS a guard (see
 * `guardAliases`), so a badly-spelled guard is rule 1's business, not this
 * list's.
 *
 * Its one entry was `check-lucide-icon-record-names.mjs`, whose two lookup maps
 * ran in top-level `for` loops. They are now built LAZILY on first read inside
 * `liveSpellingFor`, memoised (objectui#6147), so the line is gone.
 *
 * ⚠️ WHICH remedy emptied it is the load-bearing part, and it is why that line
 * owed a card instead of a one-liner. Moving those loops behind that file's
 * ENTRY GUARD empties this list too. Measured on objectui#6092's branch rather
 * than reasoned: rule 2 goes green and reports the entry as STALE, and
 * `scripts/__tests__/check-lucide-icon-record-names.test.ts` fails 5 of 25 —
 * and the failure is not merely a red test. With the maps empty for importers,
 * `describeName('BarChart3')` stops saying "write `chart-column`" and says "no
 * live key names the same glyph" instead: a WRONG diagnosis for a real
 * violation, printed by a gate that still exits 1, which is a worse outcome
 * than the unguarded loops. So an empty list is not by itself evidence that
 * anything improved — the remedy has to preserve what every importer already
 * got. That file's own comment carries the measurement.
 *
 * @type {Set<string>}
 */
const KNOWN_IMPORT_UNSAFE = new Set();

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

const REMEDY =
  `\n    Replace the guard with:` +
  `\n` +
  `\n      import { isEntrypoint } from './invoked-as.mjs';   // '../invoked-as.mjs' from a subdir` +
  `\n      if (${CANONICAL}) { ... }` +
  `\n` +
  `\n    scripts/invoked-as.mjs carries the rationale and the symlink fixture.`;

function main() {
  const files = walk(SCRIPTS).sort();
  const observed = new Map();
  const sites = new Map();
  for (const abs of files) {
    if (abs === SELF) continue; // this file quotes the idioms it bans
    const rel = relative(REPO_ROOT, abs);
    const found = scanFile(rel, readFileSync(abs, 'utf8'), { isPredicateHome: abs === PREDICATE_HOME });
    if (found.length) {
      observed.set(rel, found.length);
      sites.set(rel, found);
    }
  }

  const { fresh, stale } = reconcileGuards(observed, KNOWN_HAND_TYPED_GUARDS);

  if (fresh.length) {
    const total = fresh.reduce((n, f) => n + (f.count - f.owed), 0);
    console.error(`❌  check:entry-guard — ${total} hand-typed entry guard(s) in scripts/ beyond the baseline:\n`);
    for (const f of fresh) {
      for (const s of sites.get(f.rel) ?? []) console.error(`  ${s.rel}:${s.line}  ${s.what}  — ${s.why}`);
      if (f.owed) console.error(`    (${f.rel} is baselined at ${f.owed}; it now carries ${f.count}. The baseline only shrinks.)`);
    }
    console.error(
      `\n    Every scripts/** entry guard goes through ONE predicate, because the` +
        `\n    hand-typed forms are silently WRONG: node leaves process.argv[1] as the` +
        `\n    caller typed it, so a script reached through a symlink compares two` +
        `\n    different paths, answers false, and does nothing — exit 0, no output.` +
        `\n` +
        REMEDY +
        `\n` +
        `\n    KNOWN_HAND_TYPED_GUARDS is SHRINK-ONLY: adding a line, or raising a` +
        `\n    number, is not a supported way to make this pass.`,
    );
    return 1;
  }

  if (stale.length) {
    console.error(`❌  check:entry-guard — ${stale.length} stale KNOWN_HAND_TYPED_GUARDS entry/entries:\n`);
    for (const s of stale) {
      console.error(`  ${s.rel}  — baselined at ${s.owed}, now carries ${s.count}`);
    }
    console.error(
      `\n    Good news, and the list must say so: ${stale.some((s) => s.count === 0) ? 'delete the zero lines' : 'lower the numbers'} in` +
        `\n    KNOWN_HAND_TYPED_GUARDS in scripts/check-entry-guard.mjs (delete the entry` +
        `\n    when it reaches 0). The list only ever shrinks, and a stale line is how it` +
        `\n    would have started drifting into an allowlist nobody re-reads.`,
    );
    return 1;
  }

  // ── second kind: an exporting file whose top level runs on import ─────────
  const census = importSafetyCensus(files);
  const unsafe = census.filter((r) => r.unsafe.length);
  const freshUnsafe = unsafe.filter((r) => !KNOWN_IMPORT_UNSAFE.has(r.rel));
  const reached = new Set(unsafe.map((r) => r.rel));
  const staleUnsafe = [...KNOWN_IMPORT_UNSAFE].filter((rel) => !reached.has(rel)).sort();

  if (freshUnsafe.length) {
    console.error(`❌  check:entry-guard — ${freshUnsafe.length} scripts/ file(s) export bindings AND run on import:\n`);
    for (const r of freshUnsafe) {
      for (const s of r.unsafe) console.error(`  ${r.rel}:${s.line}  ${s.head}`);
    }
    console.error(
      `\n    A scripts/** file that exports a binding can be imported FOR those` +
        `\n    exports. Whatever its top level runs then runs inside the importer —` +
        `\n    and a top-level process.exit(0) ends the importer mid-import, so its` +
        `\n    caller reads success.` +
        `\n` +
        REMEDY +
        `\n` +
        `\n    A file that exports nothing is never reached by this rule, and neither` +
        `\n    is one whose top level only declares. Nothing else is a way out.`,
    );
    return 1;
  }

  if (staleUnsafe.length) {
    console.error(`❌  check:entry-guard — ${staleUnsafe.length} stale KNOWN_IMPORT_UNSAFE entry/entries:\n`);
    for (const rel of staleUnsafe) console.error(`  ${rel}  — no longer runs on import`);
    console.error(
      `\n    Good news, and the list must say so: delete each line above from` +
        `\n    KNOWN_IMPORT_UNSAFE in scripts/check-entry-guard.mjs. The list only` +
        `\n    ever shrinks, and a stale line is how it would have started drifting` +
        `\n    into an allowlist nobody re-reads.`,
    );
    return 1;
  }

  const owedGuards = [...KNOWN_HAND_TYPED_GUARDS.values()].reduce((a, b) => a + b, 0);
  const inert = census.length - unsafe.length;
  console.log(
    `✓ check:entry-guard: ${files.length} scripts/ file(s) — no entry guard outside the baseline; ` +
      `${KNOWN_HAND_TYPED_GUARDS.size} file(s) still hand-type one (${owedGuards} occurrence(s), ⛔ SHRINK-ONLY, objectui#6092); ` +
      `${census.length} export bindings, ${inert} of them inert on import (${unsafe.length} known-unsafe, ⛔ SHRINK-ONLY).`,
  );
  return 0;
}

/** `--list`: what both rules see, for burning the lists down. */
function list() {
  const files = walk(SCRIPTS).sort();
  console.log('── hand-typed entry guards ─────────────────────────────────');
  for (const abs of files) {
    if (abs === SELF) continue;
    const rel = relative(REPO_ROOT, abs);
    const found = scanFile(rel, readFileSync(abs, 'utf8'), { isPredicateHome: abs === PREDICATE_HOME });
    if (!found.length) continue;
    console.log(`  ${String(found.length).padStart(2)}  ${rel}${note}`);
    for (const f of found) console.log(`         :${f.line}  ${f.what}`);
  }
  console.log('\n── exporting files, and what runs on import ────────────────');
  const census = importSafetyCensus(files);
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

  // ── the nine spellings measured in THIS tree on 133e2ea1e ─────────────────
  const SPELLINGS = [
    'const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));',
    'const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);',
    'const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);',
    'const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;',
    'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {}',
    'if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {}',
    'if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {}',
    "if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {}",
    'if (import.meta.url === `file://${process.argv[1]}`) {}',
  ];
  SPELLINGS.forEach((src, i) => t(`spelling ${i + 1} of ${SPELLINGS.length} is rejected`, n(src) > 0, src));

  // The percent-encoding spelling lives inside a TEMPLATE, so it is only
  // visible through the interpolation-aware view above. Pinned here because
  // `codeOnly` reverting to `comment || literal` is a one-character change that
  // makes this gate blind to the worst guard in the tree while staying green.
  t(
    'the percent-encoding guard is seen THROUGH the template it is written in',
    n('if (import.meta.url === `file://${process.argv[1]}`) {}') > 0,
  );
  t(
    '...while a process.argv[1] in the template BODY, outside any interpolation, is not a guard',
    n('const s = `node x.mjs process.argv[1]`;\n') === 0,
  );

  // The shape `shadcn-sync.js` writes — CORRECT, and still not the predicate.
  // Pinned so nobody later decides the gate should "know" a correct two-leg
  // hand-roll and stop seeing it: it is baselined, not invisible.
  t(
    "shadcn-sync.js's correct two-leg shape is still a hand-typed guard",
    n('const entry = process.argv[1];\nreturn realpathSync(path.resolve(entry)) === __filename;') > 0,
  );

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
  const multi = 'line one\nline two\nconst g = process.argv[1] === x;\n';
  t('a finding reports the line the guard is ON', scanFile('f.mjs', multi)[0]?.line === 3, JSON.stringify(scanFile('f.mjs', multi)));

  // ── the baseline, driven directly ─────────────────────────────────────────
  //
  // THE NON-VACUITY CONTROL. This gate lands on a tree it does not enforce yet:
  // 29 hand-typed guards are baselined as owed. A baseline that accepted its
  // own contents AND everything after them would be worth nothing, and a run
  // over today's green tree cannot tell the two apart. So recognition is pinned
  // here, positively, in every direction the baseline can move.
  const base = new Map([['scripts/a.mjs', 2]]);
  const r = (obs) => reconcileGuards(new Map(obs), base);
  t('the baseline accepts exactly what it owes', r([['scripts/a.mjs', 2]]).fresh.length === 0 && r([['scripts/a.mjs', 2]]).stale.length === 0);
  t('a THIRTIETH guard, in a file the baseline never named, is FRESH', r([['scripts/a.mjs', 2], ['scripts/new.mjs', 1]]).fresh.some((f) => f.rel === 'scripts/new.mjs'));
  t(
    '...and the finding says it owed nothing',
    r([['scripts/a.mjs', 2], ['scripts/new.mjs', 1]]).fresh.find((f) => f.rel === 'scripts/new.mjs')?.owed === 0,
  );
  t('a SECOND guard smuggled into an already-owed file is FRESH', r([['scripts/a.mjs', 3]]).fresh.length === 1);
  t('...which a path-only baseline could not have seen', r([['scripts/a.mjs', 3]]).fresh[0]?.owed === 2);
  t('a file that lost one guard is STALE, not silently accepted', r([['scripts/a.mjs', 1]]).stale.length === 1);
  t('a file that lost them all is STALE', r([]).stale[0]?.count === 0);
  t('...and STALE is never also FRESH', r([]).fresh.length === 0);

  // ── the second kind: an EXPORTING file whose top level runs on import ────
  //
  // Asserted POSITIVELY in both directions. This gate prints files SCANNED, not
  // files recognised, so "the count moved" is not evidence available to a reader.
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

  // ── rule 2 recognises a hand-typed guard AS a guard (the port's divergence)
  //
  // Pinned in both directions. Recognition here is what keeps rule 2's debt
  // list TRUE while the tree is unswept; rule 1 is where these files are still
  // failed, and its own cases above assert that.
  t(
    'an INLINE hand-typed guard makes a dispatch inert for rule 2',
    u('export const a = 1;\nif (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); }\n') === 0,
  );
  t(
    'a hand-typed guard STORED in a const is the same guard for rule 2',
    u('export const a = 1;\nconst invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);\nif (invokedDirectly) { main(); }\n') === 0,
  );
  t(
    'a hand-typed guard behind a named PREDICATE is the same guard for rule 2',
    u('export const a = 1;\nfunction invokedAsCli() {\n  const e = process.argv[1];\n  return realpathSync(e) === __filename;\n}\nif (invokedAsCli()) { main(); }\n') === 0,
  );
  t(
    '...and rule 1 still FAILS every one of those spellings',
    n('if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); }') > 0 &&
      n('function invokedAsCli() { return process.argv[1] === __filename; }') > 0,
  );
  t(
    'a predicate that does NOT test entry is not a guard',
    u('export const a = 1;\nfunction ready() { return true; }\nif (ready()) { main(); }\n') === 1,
  );
  t(
    'an INVERTED hand-typed guard whose import branch runs is still rejected',
    u('export const a = 1;\nconst m = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);\nif (!m) {\n  warmCache();\n} else {\n  main();\n}\n') === 1,
  );

  // ── the slicer, driven directly ──────────────────────────────────────────
  t('an import declaration is ONE top-level statement', topLevelStatements(codeOnly("import { a, b } from 'x';\n")).length === 1);
  t('a destructuring declaration is ONE top-level statement', topLevelStatements(codeOnly('const { a } = f();\n')).length === 1);
  t('else continues the statement before it', topLevelStatements(codeOnly('if (a) { x(); } else { y(); }\n')).length === 1);
  t('catch continues the statement before it', topLevelStatements(codeOnly('try { x(); } catch (e) { y(); }\n')).length === 1);

  // ── the baseline is empty, and that is an assertion, not a description ──
  // With no lines left, the ONLY thing the map can still do is redden on a file
  // that hand-types a guard. A test that read the map's size would pass on an
  // empty map that had also stopped being consulted, so this asserts the
  // reconciliation instead: an empty baseline must call a real guard FRESH.
  t(
    'an EMPTY baseline still reddens on a hand-typed guard',
    reconcileGuards(new Map([['scripts/anything.mjs', 1]]), new Map([])).fresh.length === 1,
  );

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-entry-guard self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-entry-guard self-test: ${cases.length} cases pass — all ${SPELLINGS.length} spellings measured in this tree rejected, ` +
      `canonical form and masked prose/payloads accepted, the shrink-only baseline pinned in every direction it can move ` +
      `(a thirtieth guard is FRESH, a second guard in an owed file is FRESH, a removed one is STALE), ` +
      `and the import-safety rule recognised on both sides.`,
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv;
  process.exit(argv.includes('--self-test') ? selfTest() : argv.includes('--list') ? list() : main());
}
