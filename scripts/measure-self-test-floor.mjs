#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * measure-self-test-floor -- can each `scripts/**` self-test prove it ran? (#13489)
 *
 *   node scripts/measure-self-test-floor.mjs           # static census (fast)
 *   node scripts/measure-self-test-floor.mjs --probe   # + the dynamic probe (minutes)
 *   node scripts/measure-self-test-floor.mjs --json    # machine-readable
 *
 * ## The two holes, which are ORTHOGONAL
 *
 * A gate can be clean on one and defeated by the other, so they are counted
 * separately and never summed into one "problem gates" total.
 *
 *   1. NO ASSERTION FLOOR. Success decided by `failures.length === 0` alone,
 *      so "every case held" and "the cases never ran" print the same line.
 *   2. NO VERDICT HANDSHAKE. The dispatch discards the self-test's completion
 *      (`return selfTest()`, `selfTest();`, `process.exit(selfTest())`), so a
 *      `return` anywhere above the verdict prints NOTHING and still exits 0.
 *      A gate with a perfect floor is still defeated this way: the floor never
 *      runs either.
 *
 * ⚠️ A verdict line that already prints a case count is EVIDENCE, NOT PROOF. A
 * battery dropping from 40 cases to 3 still prints a non-zero count and passes,
 * and pinning a TOTAL rots the moment a sibling battery grows. Two gates in
 * this tree derive and print a `SELF_TEST_CASE_COUNT` that nothing ever
 * compares; both classify NONE here, correctly.
 *
 * ## Boundary: this is NOT the empty-scan class
 *
 * "A sweep that read zero must refuse" is a different property. `check-adr-links`
 * and `check-doc-anchors` both carry that refusal AND are defeated by hole 2 --
 * measured, in this tree. Neither class covers for the other.
 *
 * ## Why hole 2 is MEASURED and hole 1 is READ
 *
 * The grep the triage ruling supplies (`failures.length === 0`, `return
 * selfTest()`) is an ENTRY POINT, not a criterion: a gate reaches the same
 * effect through `process.exit(selfTest())` (an early bare `return` yields
 * `undefined`, and `process.exit(undefined)` is exit 0), through
 * `selfTest(); main();`, or through a top-level block with no callee at all.
 * So hole 2 is decided by BEHAVIOUR: inject `return;` as the first statement of
 * the function the dispatch calls, run it, and read what it SAYS as well as what
 * it exits. Exit 0 is the defect. Hole 1 has no equally generic mutation --
 * a battery is not a mechanically identifiable unit across 158 differently shaped
 * self-tests -- so it is decided by a published static criterion instead, stated
 * below.
 *
 * ## A non-zero exit is NOT a handshake: DEFEATED / HELD / ACCIDENT
 *
 * A handshake is a gate NOTICING that its self-test left early and SAYING so. An
 * exit code alone cannot tell that apart from an accident: a dispatch spelled
 * `process.exit(runSelfTest() === 0 ? 0 : 1)` turns the early return's `undefined`
 * into `undefined === 0` -> false -> exit 1, having printed ZERO BYTES. Nothing
 * detected anything; the arithmetic of a comparison against a missing return value
 * did it. Scoring that HELD is the same accident-versus-handshake mistake this
 * instrument exists to expose, made by the instrument itself -- and it inflates
 * exactly the completion picture a green `--probe` sweep is quoted for.
 *
 * So the mutated run must also SPEAK, and the verdict is three-valued:
 *
 *   DEFEATED  exit 0            -- the early return went unnoticed.
 *   HELD      exit != 0 AND the mutated run printed a non-blank line.
 *   ACCIDENT  exit != 0 AND it printed nothing -- a non-zero exit with no
 *             refusal behind it. NOT counted among HELD, ever.
 *
 * A FOURTH reading sits UNDER all three, and it is a PRECONDITION rather than a
 * verdict: if the UNMUTATED file already exits non-zero, this tree cannot run
 * it at all, so the mutation had nothing to defeat and NOTHING WAS MEASURED.
 * That case does not look like an absence -- both runs exit non-zero and both
 * print a module-resolution stack, so the mutated run "speaks" and the verdict
 * above reads HELD. A checkout that has not been `pnpm install`ed therefore
 * reports the FLATTERING answer for every file it cannot load, and the same row
 * reads ACCIDENT once the tree is installed (#15391).
 *
 * The `mutatedBytes` / `mutatedHead` fields the row already carried are what this
 * reads; `mutatedSpoke` publishes the reading. Deliberately the verdict does NOT
 * match the refusal WORDING: the repair landed in three spellings and teaching
 * this verdict any of them is the coupling #14968 is filed to remove. Reporting
 * WHICH handshake a file carries is that card's column, not this verdict's job.
 *
 * ## The controls, which run on EVERY invocation
 *
 * This tool's whole subject is "a green that asserted nothing". A survey that
 * silently misses a class of files and reports zero commits exactly that
 * defect. So both instruments are driven against KNOWN-HOLED and KNOWN-SOUND
 * fixtures before any number is printed, and a control failure refuses -- it
 * does not degrade to a smaller number. They are placed here, unconditionally,
 * rather than behind a `--self-test` flag, precisely so they cannot become
 * unrun; that is the `inline` route `check-self-test-wired.mjs` records.
 *
 * The POPULATION CRITERION is controlled here too, and for the sharper version
 * of the same reason: a dispatch spelling it cannot see does not produce a
 * generous classification, it produces an ABSENCE -- and an absent row is
 * indistinguishable from a file that was never in scope.
 *
 * The controls have already earned their place once: an earlier revision of
 * `classifyFloor` keyed on the NAME `SELF_TEST_BATTERIES` rather than on a
 * comparison that produces a failure, and called a fixture floored after the
 * roster had been removed. The control caught it; nothing else would have.
 */

import { readFileSync, writeFileSync, rmSync, readdirSync, existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { blank, maskComments, scanSource } from './js-comment-mask.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * A `--self-test` DISPATCH: argv examined, not a literal passed to a child.
 *
 * Published in two halves so a control can test each on its own, the same way
 * the failure-producer criterion below is:
 *
 *   MEMBERSHIP  argv membership tested -- `argv.includes('--self-test')`, and
 *               the `Set` spelling `has('--self-test')`.
 *   EQUALITY    a flag ALREADY EXTRACTED into a variable, compared against the
 *               literal -- `flag === '--self-test'`. `==` and `===`, all three
 *               quote styles, the literal on either side.
 *
 * The membership half alone left SIX tracked files outside the census, five of
 * them gates lint.yml already invokes with `--self-test`, so no batch of #13799
 * could be dispatched against them and nothing recorded that they were never
 * floored. Absence from a census is not a clearance -- it is the one reading
 * that looks like a clean bill of health while saying nothing at all (#15421).
 *
 * BOUNDARY -- the compared operand must be a BARE IDENTIFIER. A property or a
 * call result (`renderedArgv(' --self-test').args === '--self-test'`, live in
 * `scripts/pm/dispatch-gates.mjs`'s own self-test) is a tool EXAMINING the flag
 * as data, not a script dispatching on it, and those comparisons cluster in
 * exactly the tools that reason about self-tests -- so admitting them would
 * seed this census with its own instruments. The `.` in front of the operand is
 * what excludes them.
 *
 * WARNING: like the floor criterion below, this reads SPELLINGS. Its error runs
 * in one direction, and that direction is INVISIBILITY rather than a NONE: a
 * dispatch spelled some way neither half knows is not classified generously, it
 * is not in the population at all. Two further spellings have no tracked
 * carrier in this tree today and are deliberately left unadmitted rather than
 * written blind -- an inequality guard (`arg !== '--self-test'`) and a `switch`
 * case label. Widen the same way this half was: a control in both directions,
 * and the delta in the census measured and published.
 */
const DISPATCH_MEMBERSHIP = /(?:includes|has)\(\s*['"`]--self-test['"`]\s*\)/;
const DISPATCH_EQUALITY =
  /(?:^|[^\w$.])[A-Za-z_$][\w$]*\s*={2,3}\s*['"`]--self-test['"`]|['"`]--self-test['"`]\s*={2,3}\s*[A-Za-z_$][\w$]*/;
const DISPATCH = new RegExp(`${DISPATCH_MEMBERSHIP.source}|${DISPATCH_EQUALITY.source}`);

/** Marker injected by the probe. Its presence on disk is the mutation's proof. */
const PROBE_MARKER = 'OS_SELF_TEST_FLOOR_PROBE';

/** "Did this run SAY anything": its first non-blank line, or '' if it said nothing. */
const firstNonBlankLine = (out) => out.split('\n').find((l) => l.trim()) ?? '';

/**
 * Was this run killed by THIS TOOL'S OWN BUDGET? Published as `timedOut` so the
 * shrink the budget causes is a NUMBER the sweep can report rather than a
 * silence (#15573).
 *
 * ⛔ Read from `error.code`, NOT from the signal. `spawnSync` reports its own
 * timeout as `{ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } }`
 * -- measured -- and the SIGNAL half of that is not exclusive to it: a SIGTERM
 * can arrive from anywhere, and a foreground wall-clock cap kills children in
 * exactly this shape. Reading every SIGTERM as this budget would book rows
 * against a number nobody set, in the direction that OVERSTATES how much of the
 * survey this tool is responsible for shrinking.
 */
const budgetExpired = (run) => (run.error?.code === 'ETIMEDOUT' ? { timedOut: true } : {});

// ---------------------------------------------------------------------------
// Instrument 1 -- the static assertion-floor criterion
// ---------------------------------------------------------------------------

/**
 * A FLOOR must PRODUCE A FAILURE, not merely be named. Keying on a name is the
 * mistake this card is about one level up, and the control below proves it.
 *
 * The criterion is published in two halves so a control can test each on its own:
 *
 *   NAMED    the failure is produced by a spelling that names itself --
 *            `failures.push`, a literal `process.exit(1)`, `throw new Error`,
 *            `exitCode = 1`, `ok(false`.
 *   TERNARY  the EXIT CODE is the verdict: `process.exit(<cond> ? 0 : 1)`, the
 *            same with any non-zero failing arm (`? 0 : N`), and the inverted
 *            `process.exit(<cond> ? 1 : 0)`. A failing arm that is a non-zero
 *            LITERAL produces a failure exactly as `process.exit(1)` does; it is
 *            an ordinary spelling, and reading only the literal form called a
 *            complete, working roster floor NONE (#15339) -- the roster half
 *            matched, the file carried no other recognised spelling, and the
 *            failure half missed.
 *
 * BOUNDARY -- a bare `process.exit(<expr>)` is deliberately NOT a failure
 * producer, however likely the expression is to be non-zero. That is the
 * accident shape this file's header is about: over a self-test that returned
 * early, `process.exit(runSelfTest())` is `process.exit(undefined)` -- exit 0,
 * nothing produced, nothing noticed. Source text cannot tell what an opaque
 * expression yields; a non-zero literal in the failing arm it can.
 */
const PRODUCES_FAILURE_NAMED = /failures\.push|process\.exit\(1\)|throw new Error|exitCode = 1|ok\(false/;
const PRODUCES_FAILURE_TERNARY_EXIT =
  /process\.exit\(\s*[^;]{0,200}?\?\s*(?:0\s*:\s*[1-9]\d*|[1-9]\d*\s*:\s*0)\s*\)/;
const PRODUCES_FAILURE = new RegExp(`${PRODUCES_FAILURE_NAMED.source}|${PRODUCES_FAILURE_TERNARY_EXIT.source}`);
const ROSTER_COMPARISON =
  /(?:declaredBatteries|SELF_TEST_BATTERIES|BATTERY_FLOOR)[^;]{0,400}?(?:\.length|\.size|includes\(|has\(|!==|===|<)/s;
const COUNT_COMPARISON = [
  new RegExp(
    String.raw`\b(?:checked|cases|caseCount|ran|seen|asserted|assertions|count|total|CASES|CHECKED)\w*` +
      String.raw`(?:\.(?:length|size))?\s*(?:<|!==|!=|<=)\s*(?:\d+|[A-Z][A-Z0-9_]{3,})`,
  ),
  new RegExp(
    String.raw`(?:\d+|[A-Z][A-Z0-9_]{3,})\s*(?:>|!==|!=|>=)\s*` +
      String.raw`\b(?:checked|cases|caseCount|ran|seen|asserted|assertions|count|total)\w*(?:\.(?:length|size))?`,
  ),
];

/**
 * ROSTER -- declared battery NAMES compared as a set (the #13487 shape).
 * COUNT  -- a registered count compared against a declared constant.
 * NONE   -- success decided by "no failure was recorded", and nothing else.
 *
 * ⚠️ The criterion reads NAMES (`SELF_TEST_BATTERIES`, `declaredBatteries`, a
 * counter called `checked`/`cases`/...). A floor spelled with names it does not
 * know reads as NONE, so its error runs in ONE direction: it can call a floored
 * self-test unfloored, never the reverse. A NONE is therefore a candidate to
 * read, and the population it reports is an UPPER bound on the hole. On
 * 597020aa5 the tree was also hand-swept for zero-case refusals independently
 * of these names; every hit was a production-scan refusal (the adjacent
 * empty-scan class), not a self-test floor.
 *
 * Deliberately high-recall: COUNT hits are candidates to READ, not verdicts.
 * Both COUNT hits in this tree on 597020aa5 were hand-checked and are false
 * positives (`count < 100` in a production probe; a `total < 0` sign test).
 */
export function classifyFloor(code) {
  if (ROSTER_COMPARISON.test(code) && PRODUCES_FAILURE.test(code)) return 'ROSTER';
  if (COUNT_COMPARISON.some((re) => re.test(code)) && PRODUCES_FAILURE.test(code)) return 'COUNT';
  return 'NONE';
}

// ---------------------------------------------------------------------------
// Instrument 2 -- the dynamic verdict-handshake probe
// ---------------------------------------------------------------------------

/**
 * The source a DEFINITION may be anchored in: comments AND the content of every
 * string, template and regex literal blanked, every other byte -- and every
 * offset and line number -- left exactly where it was, so a match found here
 * slices the ORIGINAL text.
 *
 * BOTH halves of "where is the definition" read it: `selfTestDefs` below, which
 * says WHICH definitions a file holds, and `injectEarlyReturn`, which says where
 * ONE of them begins. They are one question asked twice, and asking them of two
 * different texts is the drift #14963's repair exists to end (#15574).
 *
 * ⛔ NOT for the population criterion above, which must keep reading
 * `maskComments`. Every `--self-test` dispatch names the flag with a string
 * literal, so this mask blanks the dispatch out of every file in the tree; a
 * control below pins the two masks to their opposite answers.
 */
export function maskCommentsAndLiterals(source) {
  const { comment, literal } = scanSource(source);
  const both = new Uint8Array(source.length);
  for (let i = 0; i < both.length; i++) both[i] = comment[i] | literal[i];
  return blank(source, both);
}

/**
 * Every `/self.?test/i`-named function DEFINED in this source, read from the
 * masked text above -- the same text the injection anchor reads.
 *
 * Read RAW, a name written inside a fixture STRING counts as a definition of the
 * file that quotes it: `scripts/pm/dispatch-gates.mjs` reported a
 * `fixtureSelfTest` that nothing can call, from a name in a fixture array
 * (#15574). The error direction is a phantom EXTRA name, which is why it never
 * produced a wrong measurement -- an extra name only pushes a row from a
 * mechanical entry into `ambiguous entry (...)`, i.e. NOT MEASURED. What it did
 * do is put a name that CANNOT BE CALLED into a diagnostic whose whole
 * instruction to the reader is "read the dispatch site".
 *
 * ⚠️ `defs` is PUBLISHED in `--json`, so this reading changes that payload, and
 * that change IS the repair rather than a side effect of it. Measured over the
 * census on 2026-09-05: exactly ONE row's `defs` differ (the row above, losing
 * `fixtureSelfTest`) and NO row's ambiguity changes -- so no entry, no verdict
 * and no row moves. That row was hand-read before and stays hand-read, for the
 * three real definitions that remain.
 *
 * ⛔ NOT line-anchored, unlike the anchor. The anchor needs the ONE definition a
 * dispatch calls, so a mid-line named function expression is not its answer;
 * this half answers "how many self-test-shaped definitions does this file hold",
 * where that expression is a real definition and dropping it would UNDERCOUNT --
 * the direction that turns an ambiguous file into a confidently wrong entry.
 */
export function selfTestDefs(src) {
  const code = maskCommentsAndLiterals(src);
  const names = new Set();
  for (const m of code.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (/self.?test/i.test(m[1])) names.add(m[1]);
  }
  for (const m of code.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)) {
    if (/self.?test/i.test(m[1])) names.add(m[1]);
  }
  return [...names];
}

/**
 * Insert `return;` as the first statement of `name`. Returns null when absent.
 *
 * TWO rules make the anchor the DEFINITION rather than the first text that reads
 * like one, and NEITHER is redundant -- the control fixture below carries one
 * decoy of each kind, in this order, ahead of its real definition:
 *
 *   MASKED     the match is taken over `maskCommentsAndLiterals(src)`. Read raw,
 *              the first `function selfTest() {` in `scripts/pm/dispatch-gates.mjs`
 *              is a sentence in a docblock and the next is a FIXTURE STRING.
 *   LINE-START the match must BEGIN a line, `export` / `async` being the only
 *              prefixes a definition in this tree carries. Masking alone still
 *              prefers a mid-line named function expression -- a value in an
 *              object literal is not the function the dispatch calls.
 *
 * What the first rule costs when it is missing is not an absence: injecting into
 * a template literal makes the copy a SyntaxError, and a copy that dies in the
 * parser exits non-zero and prints a stack, so `mutatedSpoke` is true and the
 * verdict above reads HELD -- a hold awarded to a gate for the probe having
 * broken its own copy of it. `scripts/pm/dispatch-gates.mjs` carried an
 * `ENTRY_BY_HAND` null for months over exactly this, a limit of the INSTRUMENT
 * recorded as a property of the FILE (#14963). Anchored on the definition its
 * copy parses and runs -- measured by hand, exit 1 and `selfTest() returned
 * without reaching its verdict`. The row it leaves is still NOT MEASURED, but
 * for a reason the probe now states itself: see that row.
 */
export function injectEarlyReturn(src, name) {
  const code = maskCommentsAndLiterals(src);
  const pats = [
    new RegExp(
      `^[ \\t]*(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)` +
        `\\s*(?::\\s*[A-Za-z_$][\\w$<>\\[\\]|. ]*\\s*)?\\{`,
      'm',
    ),
    new RegExp(`^[ \\t]*(?:export\\s+)?const\\s+${name}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*(?::[^=]*)?=>\\s*\\{`, 'm'),
  ];
  for (const re of pats) {
    const m = code.match(re);
    if (!m) continue;
    const at = m.index + m[0].length;
    return `${src.slice(0, at)}\n  return; /*${PROBE_MARKER}*/\n${src.slice(at)}`;
  }
  return null;
}

/**
 * Where the mutated copy is written, and what its placement has to answer.
 *
 * The copy used to be written BESIDE the original, which answered "do relative
 * imports and repo-root resolution still resolve?" by construction -- and broke
 * a different question nobody had asked it: a near-duplicate of a gate, sitting
 * under `scripts/`, is a FINDING for any gate whose own work is to walk that
 * tree. That gate's BASELINE then exits non-zero, the precondition ends the
 * probe, and the row reads NOT MEASURED `baseline run failed (exit 1)` -- a
 * limit of the INSTRUMENT recorded as a property of the FILE, which is the
 * mistake this whole file exists to stop making. Measured on
 * `check-pnpm-filter-targets.mjs`: `--self-test` exits 0 alone and exits 1 with
 * a copy of itself beside it, over its own "the checked-in tree is clean" sweep
 * (#15515). Naming the copy so the walking gates skip it is the same mistake
 * from the other side -- it weakens the gates to suit the instrument.
 *
 * So the copy goes OUTSIDE every walked tree, into a fresh temp directory, and
 * the three things the old placement answered implicitly are answered here
 * explicitly. Every rewrite below is applied ONLY where `scanSource` says the
 * text is real CODE: several gates in this tree feed themselves fixture STRINGS
 * containing import statements and the word `import.meta.url`, and rewriting one
 * of those would change what the gate scans rather than where the copy resolves.
 *
 *   1. RELATIVE SPECIFIERS -- `from './x.mjs'`, `import('../y.mjs')` and the
 *      bare `import './z.mjs'` -- become absolute `file://` URLs of the
 *      ORIGINAL's neighbours, so the copy imports the very modules the original
 *      imports (measured over the census: 320 `from` and 5 dynamic).
 *   2. `import.meta.url` becomes a literal naming the ORIGINAL (and
 *      `import.meta.dirname` / `.filename` likewise), so `new URL('..',
 *      import.meta.url)` ROOT resolution, `createRequire`, and the `importerUrl`
 *      that `requireDependency` turns into its `fromDir` all answer as they did.
 *      The ONE exception is the argument of `isEntrypoint(...)`, which asks "was
 *      THIS file run?" -- 145 of the census's dispatches sit behind that call,
 *      and answering it about the original would leave every one of those copies
 *      parsing, running NOTHING, printing nothing and exiting 0: a whole-census
 *      false DEFEATED, the loudest wrong answer available here.
 *   3. BARE specifiers resolve by walking up from the file, so the temp
 *      directory is given a `node_modules` symlink to the nearest one above the
 *      ORIGINAL. Without it `import 'typescript'` (4 members) and the dynamic
 *      `import('yaml')` inside `requireDependency` (51 call sites) die in module
 *      resolution -- non-zero AND speaking, which this file scores HELD. That is
 *      the FLATTERING direction, so it is closed rather than accepted.
 *
 * `cwd` stays `ROOT`, so nothing resolved from `process.cwd()` moves at all.
 *
 * A member this cannot serve keeps the OLD placement, per row and never
 * silently -- the row publishes `placement: 'beside'` and the reason.
 */
const RELATIVE_SPECIFIER = /^\.\.?\//;

/** `from '<spec>'` -- the static import and re-export form. */
const SPEC_FROM = /(?<![.\w$])from(\s*)(['"])([^'"\n]*)\2/g;
/** `import('<spec>')` -- the dynamic form. */
const SPEC_DYNAMIC = /(?<![.\w$])import(\s*\(\s*)(['"])([^'"\n]*)\2/g;
/** `import '<spec>'` -- the side-effect-only form. */
const SPEC_BARE = /(?<![.\w$])import(\s+)(['"])([^'"\n]*)\2/g;
/**
 * A specifier written as a TEMPLATE literal. Not rewritable to a literal URL --
 * it is an expression -- so a member carrying one keeps the old placement rather
 * than being relocated with a specifier that would resolve against the temp dir.
 */
const SPEC_TEMPLATE = /(?<![.\w$])(?:from|import)\s*\(?\s*`\.\.?\//g;

/** A match is CODE only where it is neither comment nor string/template content. */
const isCode = (flags, at) => flags.comment[at] === 0 && flags.literal[at] === 0;

/** The nearest existing `node_modules` at or above `fromDir`, or `null`. */
export function nearestNodeModules(fromDir) {
  for (let dir = fromDir; ; ) {
    const candidate = join(dir, 'node_modules');
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Rewrite `source` so that, run from anywhere, it resolves what `absFile` would.
 *
 * @returns `{ source, blocked }` -- `blocked` non-empty means DO NOT relocate
 * this file, and each entry is the reason, published on the row.
 */
export function relocateSource(source, absFile) {
  const flags = scanSource(source);
  const selfUrl = pathToFileURL(absFile).href;
  const edits = [];
  const blocked = [];

  for (const m of source.matchAll(/import\.meta\.(\w+)/g)) {
    if (!isCode(flags, m.index)) continue;
    const span = { at: m.index, end: m.index + m[0].length };
    if (m[1] === 'url') {
      // The entry guard must keep asking about the RUNNING file -- see rule 2.
      if (/isEntrypoint\(\s*$/.test(source.slice(Math.max(0, span.at - 40), span.at))) continue;
      edits.push({ ...span, text: JSON.stringify(selfUrl) });
    } else if (m[1] === 'dirname') {
      edits.push({ ...span, text: JSON.stringify(dirname(absFile)) });
    } else if (m[1] === 'filename') {
      edits.push({ ...span, text: JSON.stringify(absFile) });
    } else {
      blocked.push(`import.meta.${m[1]} resolves from the running file's own url, which is not a literal to rewrite`);
    }
  }

  for (const re of [SPEC_FROM, SPEC_DYNAMIC, SPEC_BARE]) {
    for (const m of source.matchAll(re)) {
      if (!isCode(flags, m.index)) continue;
      if (!RELATIVE_SPECIFIER.test(m[3])) continue;
      const end = m.index + m[0].length;
      edits.push({ at: end - (m[3].length + 2), end, text: JSON.stringify(new URL(m[3], selfUrl).href) });
    }
  }
  for (const m of source.matchAll(SPEC_TEMPLATE)) {
    if (!isCode(flags, m.index)) continue;
    blocked.push('a relative import specifier written as a template literal is an expression, not a literal to rewrite');
  }

  if (blocked.length > 0) return { source, blocked };
  let out = source;
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return { source: out, blocked };
}

/**
 * Run one gate's `--self-test` with an early `return` at the top of `entry`.
 *
 * The copy is written OUTSIDE every walked tree and rewritten to resolve what
 * the original resolves -- see the placement docblock above -- and the marker is
 * re-read FROM DISK before the run: an editor step that matched nothing exits 0
 * just as happily as one that landed, and an unmutated file would report "held"
 * for no reason at all.
 *
 * `placement: 'beside'` forces the OLD placement, next to the original. It is
 * the control's way of reproducing the defect above on a fixture; nothing in the
 * census passes it.
 *
 * THE BASELINE IS A PRECONDITION, NOT A DATA POINT. It is read BEFORE any
 * reading of the mutated run, and a non-zero one ends the probe as NOT MEASURED
 * with the reason -- see the fourth reading in this file's header. The mutated
 * run is then not spawned AT ALL: in the shape that motivates this (a checkout
 * whose dependencies are absent) every row is baseline-red, so running each
 * doomed mutation would double a whole sweep of spawns to learn nothing. The
 * row still publishes what the baseline said, because `baselineHead` is usually
 * the whole diagnosis (`Cannot find package ...` reads as "run pnpm install").
 *
 * THE BUDGET IS THE INSTRUMENT'S, AND IT IS PER MEMBER. `timeout` is what
 * `spawnSync` is given for EACH run, and a run that outlasts it is killed with
 * `SIGTERM` and read -- correctly -- as NOT MEASURED. That is the safe
 * direction, never a false HELD, and the row names its own reason. But the
 * reason it names is a fact about THIS TOOL'S BUDGET, and it lands on the
 * SLOWEST self-tests, which are the ones with the most cases to lose: the
 * default 120 s is ~3.3x under `scripts/pm/dispatch-gates.mjs`'s own
 * `--self-test`, the richest in the tree at 1,415 cases (#15573).
 *
 * ⛔ The repair is NOT a bigger default -- 180 of the 181 rows fit 120 s, and
 * raising it for all of them makes every sweep slower to serve one member. The
 * default stays, and a member measured to need more carries its own
 * `timeoutMs` in `ENTRY_BY_HAND`, with the reading it came from. `main()`
 * passes that through; nothing else may.
 */
export function probeEarlyReturn(absFile, entry, { timeout = 120000, placement = 'relocated' } = {}) {
  const src = readFileSync(absFile, 'utf8');
  const mutated = injectEarlyReturn(src, entry);
  if (mutated === null) return { verdict: 'NOT MEASURED', why: `no injectable definition of ${entry}` };
  if (src.includes(PROBE_MARKER)) return { verdict: 'NOT MEASURED', why: 'marker already present in source' };

  const relocation = placement === 'beside' ? { source: mutated, blocked: [] } : relocateSource(mutated, absFile);
  const probeName = `.self-test-floor-probe-${basename(absFile)}`;
  let probeDir = null;
  let probePath = join(dirname(absFile), probeName);
  let text = mutated;
  let besideWhy = relocation.blocked.length > 0 ? relocation.blocked.join('; ') : null;
  if (placement !== 'beside' && relocation.blocked.length === 0) {
    try {
      probeDir = mkdtempSync(join(tmpdir(), 'self-test-floor-probe-'));
      const modules = nearestNodeModules(dirname(absFile));
      if (modules) symlinkSync(modules, join(probeDir, 'node_modules'));
      probePath = join(probeDir, probeName);
      text = relocation.source;
    } catch (err) {
      // Relocation is the better placement, not a required one: a temp dir that
      // cannot be made or linked falls back to the original placement, saying so.
      if (probeDir) rmSync(probeDir, { recursive: true, force: true });
      probeDir = null;
      probePath = join(dirname(absFile), probeName);
      text = mutated;
      besideWhy = `relocation failed (${err?.code ?? err?.message ?? 'unknown'})`;
    }
  }
  const beside = probeDir === null && placement !== 'beside' ? { placement: 'beside', placementWhy: besideWhy } : {};

  const isTs = /\.(mts|ts)$/.test(absFile);
  const cmd = isTs ? join(ROOT, 'node_modules/.bin/tsx') : process.execPath;
  try {
    writeFileSync(probePath, text);
    const onDisk = (readFileSync(probePath, 'utf8').match(new RegExp(PROBE_MARKER, 'g')) ?? []).length;
    if (onDisk !== 1) return { verdict: 'NOT MEASURED', why: `mutation not on disk (marker x${onDisk})`, ...beside };

    const base = spawnSync(cmd, [absFile, '--self-test'], { cwd: ROOT, timeout, encoding: 'utf8' });
    const baseOut = (base.stdout ?? '') + (base.stderr ?? '');
    if (base.signal) return { verdict: 'NOT MEASURED', why: `killed by ${base.signal}`, ...budgetExpired(base), ...beside };
    // PRECONDITION. A file the tree cannot run offered the mutation nothing to
    // defeat, so no verdict below is available -- however loudly the mutated run
    // would have exited and spoken. Read before the mutated run is spawned.
    if (base.status !== 0) {
      return {
        verdict: 'NOT MEASURED',
        why:
          base.status === null
            ? `baseline run could not start (${base.error?.code ?? 'no exit status'})`
            : `baseline run failed (exit ${base.status})`,
        entry,
        baselineExit: base.status,
        baselineBytes: baseOut.length,
        baselineHead: firstNonBlankLine(baseOut),
        ...beside,
      };
    }

    const mut = spawnSync(cmd, [probePath, '--self-test'], { cwd: ROOT, timeout, encoding: 'utf8' });
    const mutOut = (mut.stdout ?? '') + (mut.stderr ?? '');
    if (mut.signal) return { verdict: 'NOT MEASURED', why: `killed by ${mut.signal}`, ...budgetExpired(mut), ...beside };
    // A mutation that changed nothing observable did not reach the executed
    // path, whatever its exit code says.
    if (baseOut === mutOut && base.status === mut.status) {
      return { verdict: 'NOT MEASURED', why: 'mutation had no observable effect', ...beside };
    }
    // Did the mutated run SAY anything? Read as "printed a non-blank line", the
    // same reading `mutatedHead` already publishes and quotes -- a run whose whole
    // output is a newline has non-zero bytes and still refused nothing.
    const mutatedHead = firstNonBlankLine(mutOut);
    const mutatedSpoke = mutatedHead !== '';
    return {
      // Exit code alone cannot tell a refusal from an accident -- see the header.
      verdict: mut.status === 0 ? 'DEFEATED' : mutatedSpoke ? 'HELD' : 'ACCIDENT',
      entry,
      baselineExit: base.status,
      mutatedExit: mut.status,
      mutatedBytes: mutOut.length,
      mutatedHead,
      mutatedSpoke,
      ...beside,
    };
  } finally {
    rmSync(probePath, { force: true });
    if (probeDir) rmSync(probeDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The controls -- run on EVERY invocation, before any number is printed
// ---------------------------------------------------------------------------

const HOLED_GATE = [
  '#!/usr/bin/env node',
  'function selfTest() {',
  '  const failures = [];',
  "  if (1 !== 1) failures.push('x');",
  "  if (failures.length) { console.error('nope'); process.exit(1); }",
  "  console.log('fixture self-test: 1 case passes');",
  '}',
  "if (process.argv.includes('--self-test')) selfTest();",
  '',
].join('\n');

const SOUND_GATE = [
  '#!/usr/bin/env node',
  "const VERDICT = 'reached';",
  "const SELF_TEST_BATTERIES = Object.freeze({ only: 1 });",
  'const SELF_TEST_BATTERY_FLOOR = 1;',
  'function selfTest() {',
  '  const failures = [];',
  '  const seen = new Map();',
  "  let open = null;",
  '  const battery = (n) => { open = n; };',
  "  const ok = (c, l) => { seen.set(open, (seen.get(open) ?? 0) + 1); if (!c) failures.push(l); };",
  "  battery('only');",
  "  ok(1 === 1, 'x');",
  '  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);',
  "  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) failures.push('registry shrank');",
  "  for (const n of declaredBatteries) if ((seen.get(n) ?? 0) < SELF_TEST_BATTERIES[n]) failures.push('battery ' + n + ' did not run');",
  '  if (failures.length) { console.error(failures.join(String.fromCharCode(10))); process.exit(1); }',
  "  console.log('fixture self-test: floor held');",
  '  return VERDICT;',
  '}',
  "if (process.argv.includes('--self-test')) {",
  '  if (selfTest() !== VERDICT) {',
  "    console.error('fixture: selfTest returned without reaching its verdict');",
  '    process.exit(1);',
  '  }',
  '}',
  '',
].join('\n');

/**
 * The measured ACCIDENT shape, reduced: a dispatch that compares the self-test's
 * return value against a number. An early return makes that comparison false and
 * the process exits 1 having printed NOTHING -- a non-zero exit with no refusal
 * behind it. This is the shape `scripts/audits/14744-before-update-per-row-value-
 * census.mjs` carries and that an exit-code-only verdict scored HELD (#15324).
 */
const ACCIDENT_GATE = [
  '#!/usr/bin/env node',
  'function runSelfTest() {',
  '  const failures = [];',
  "  if (1 !== 1) failures.push('x');",
  "  console.log('fixture self-test: 1 case passes');",
  '  return failures.length;',
  '}',
  "if (process.argv.includes('--self-test')) {",
  '  process.exit(runSelfTest() === 0 ? 0 : 1);',
  '}',
  '',
].join('\n');

/**
 * The measured BASELINE-RED shape, reduced: a file this tree cannot run at all,
 * because one of its imports does not resolve. Its self-test is otherwise
 * perfectly ordinary and injectable -- the point is that neither run ever
 * reaches it. Both runs die in module resolution, both exit non-zero, and both
 * PRINT a stack trace, so `mutatedSpoke` is true and an exit-code-and-speech
 * verdict scores it HELD: a hold awarded for the tree being broken. This is the
 * shape `scripts/audits/14744-before-update-per-row-value-census.mjs` takes in a
 * checkout whose `node_modules` lacks its `typescript` dependency, where it read
 * HELD while reading ACCIDENT in an installed one (#15391).
 *
 * The unresolvable import is a name no registry can supply, and it is the
 * FIRST statement, so the failure is the module loader's and cannot be confused
 * with anything the self-test did.
 */
const UNRUNNABLE_GATE = [
  '#!/usr/bin/env node',
  "import 'os-self-test-floor-control-no-such-package';",
  'function selfTest() {',
  '  const failures = [];',
  "  if (1 !== 1) failures.push('x');",
  "  if (failures.length) { console.error('nope'); process.exit(1); }",
  "  console.log('fixture self-test: 1 case passes');",
  '}',
  "if (process.argv.includes('--self-test')) selfTest();",
  '',
].join('\n');

/**
 * The HELPER handshake spelling, reduced: the third of the three landed
 * handshake shapes, and the one the probe had never read in either direction.
 * Its only carrier under `scripts/` is `check-platform-checklist.mjs`, whose
 * `ENTRY_BY_HAND` row is a deliberate `null` (its dispatch calls six self-test
 * functions and combines their statuses), so every probe run recorded NOT
 * MEASURED for it and the sweep said nothing at all about this shape -- not
 * held, not defeated (#15371). The other two spellings each have dozens of live
 * carriers AND, for the sentinel, the `SOUND_GATE` control above.
 *
 * The shape mirrored here is the real one: a module-level `...ReachedVerdict`
 * flag set as the self-test's last act, and a `requireReachedVerdict(name,
 * reached)` helper the DISPATCH calls afterwards, which refuses out loud and
 * exits 1. The refusal wording is printed after a leading blank line, as the
 * real helper prints it, so the control also exercises `firstNonBlankLine`
 * reading past that blank -- `mutatedSpoke` on a run whose first line is empty.
 *
 * ⛔ The verdict is still not taught this (or any) wording: the fixture's own
 * message is asserted below only so that the HELD it earns is the HELPER's
 * refusal and not some other printer's. Recognising WHICH handshake a file
 * carries remains #14968's column, not this verdict's job.
 */
const HELPER_HANDSHAKE_GATE = [
  '#!/usr/bin/env node',
  'let selfTestReachedVerdict = false;',
  'function requireReachedVerdict(name, reached) {',
  '  if (reached) return;',
  "  console.error(String.fromCharCode(10) + 'fixture self-test: ' + name + '() returned without reaching its verdict,');",
  "  console.error('so its assertions did not all run and no failure of theirs could be reported.');",
  '  process.exit(1);',
  '}',
  'function selfTest() {',
  '  const failures = [];',
  "  if (1 !== 1) failures.push('x');",
  "  if (failures.length) { console.error(failures.join(String.fromCharCode(10))); process.exit(1); }",
  "  console.log('fixture self-test: 1 case passes');",
  '  selfTestReachedVerdict = true;',
  '}',
  "if (process.argv.includes('--self-test')) {",
  '  selfTest();',
  "  requireReachedVerdict('selfTest', selfTestReachedVerdict);",
  '}',
  '',
].join('\n');

/**
 * The one dispatch line that IS the helper handshake. Deleting it leaves a file
 * identical in every other byte -- same helper defined, same flag, same
 * self-test -- whose early return therefore exits 0 in silence. The pair is the
 * both-directions control: with the line, the probe must read HELD; without it,
 * DEFEATED. Anything else means the verdict is keying on something other than
 * the handshake actually being asked for.
 */
const HELPER_HANDSHAKE_CALL = "  requireReachedVerdict('selfTest', selfTestReachedVerdict);\n";

/** The same fixture with the handshake call, and only that, removed. */
const HELPER_HANDSHAKE_GATE_HOLED = HELPER_HANDSHAKE_GATE.replace(HELPER_HANDSHAKE_CALL, '');

/**
 * The ternary exit, reduced: a roster floor whose ONLY failure production is
 * `process.exit(<cond> ? 0 : 1)`. It carries none of the NAMED spellings -- no
 * `failures.push`, no literal `process.exit(1)`, no `throw`, no `exitCode = 1`,
 * no `ok(false` -- and a control asserts that, so reading it ROSTER can only be
 * the ternary being recognised and never some other half of the criterion
 * sneaking in. This is the shape `scripts/check-regen-pending.mjs` carried while
 * its floor was sound, its ablations all fired, and this instrument still said
 * NONE (#15339).
 *
 * The classifier is a pure function of source text, so unlike the three fixtures
 * above this one is never spawned -- it is read, not run.
 */
const TERNARY_EXIT_GATE = [
  '#!/usr/bin/env node',
  'const SELF_TEST_BATTERIES = Object.freeze({ only: 1 });',
  'function runSelfTest() {',
  '  const seen = new Map();',
  '  const battery = (n) => seen.set(n, (seen.get(n) ?? 0) + 1);',
  "  battery('only');",
  '  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);',
  '  let held = declaredBatteries.length >= 1;',
  '  for (const n of declaredBatteries) if ((seen.get(n) ?? 0) < SELF_TEST_BATTERIES[n]) held = false;',
  "  console.log('fixture self-test: floor ' + (held ? 'held' : 'shrank'));",
  '  return held;',
  '}',
  "if (process.argv.includes('--self-test')) {",
  '  process.exit(runSelfTest() ? 0 : 1);',
  '}',
  '',
].join('\n');

/** The one dispatch line of `TERNARY_EXIT_GATE`, the anchor the variants replace. */
const TERNARY_EXIT_DISPATCH = 'runSelfTest() ? 0 : 1';

/**
 * The EQUALITY dispatch, reduced: the flag pulled out of argv into a variable
 * and compared against the literal. This is the shape all six files the
 * membership half could not see carry -- among them `scripts/pnpm-filter-
 * targets.mjs`, whose `--self-test` `check:pnpm-filter-targets` runs in lint.yml
 * (#15421). Like the ternary fixture above it is READ, never spawned: the
 * population criterion is a pure function of source text.
 */
const EQUALITY_DISPATCH_GATE = [
  '#!/usr/bin/env node',
  'function selfTest() {',
  '  const failures = [];',
  "  if (1 !== 1) failures.push('x');",
  "  console.log('fixture self-test: 1 case passes');",
  '  return failures.length;',
  '}',
  'const flag = process.argv[2];',
  "if (flag === '--self-test') process.exit(selfTest());",
  '',
].join('\n');

/** The one comparison that IS the dispatch, the anchor the spellings replace. */
const EQUALITY_DISPATCH = "flag === '--self-test'";

/**
 * The shapes that MENTION the flag without dispatching on it, in one file:
 * prose describing a dispatch, a comparison against a CALL RESULT (the
 * `scripts/pm/dispatch-gates.mjs` shape, where the flag is the data a gate is
 * examining), and the literal handed to a child process -- the boundary this
 * criterion has drawn since it was one line long. None of them may put a file
 * in the population, and the comment is written so that it WOULD match unmasked,
 * so the control below reads the masking rather than assuming it.
 */
const NON_DISPATCH_MENTION_GATE = [
  '#!/usr/bin/env node',
  "// Gates are dispatched with `if (arg === '--self-test') selfTest();` -- prose, not code.",
  'const rendered = (argv) => ({ args: argv.trim() });',
  "if (rendered(' --self-test').args === '--self-test') console.log('the renderer kept the flag');",
  "spawnSync(process.execPath, [target, '--self-test']);",
  '',
].join('\n');

/**
 * The DECOY shape, reduced: three texts that read like `function selfTest() {`
 * standing AHEAD of the real definition, one for each way the anchor could take
 * the wrong one, in the order they occur in `scripts/pm/dispatch-gates.mjs`.
 *
 *   1. a docblock sentence naming the convention -- a COMMENT;
 *   2. a fixture the gate feeds its own scanner -- a TEMPLATE LITERAL;
 *   3. a named function expression held as a value -- real CODE, MID-LINE.
 *
 * Each defeats a different half of the rule, and each fails DIFFERENTLY, which
 * is why one fixture carries all three rather than three carrying one:
 *
 *   into (1) the `return;` lands in a comment, the copy behaves exactly as the
 *     original, and the probe reads `mutation had no observable effect`;
 *   into (2) it lands inside a template literal, so the copy is a SyntaxError --
 *     which exits non-zero AND prints a stack, and is therefore scored HELD. The
 *     flattering direction: a hold awarded to a gate for the probe breaking its
 *     own copy of it (#14963);
 *   into (3) it lands in a function nothing calls, and the probe again reads no
 *     observable effect.
 *
 * The real definition below them is HOLED -- its dispatch discards the result --
 * so the one reading that can only come from anchoring on it is DEFEATED with
 * ZERO bytes printed. The fixture is spawned, so that verdict also says the
 * mutated copy PARSED and RAN.
 */
const DECOY_ANCHOR_GATE = [
  '#!/usr/bin/env node',
  '// The convention this tree writes: `function selfTest() {` at column 0.',
  'const FIXTURE = `',
  'function selfTest() {',
  "  console.log('a fixture the gate scans, not a definition');",
  '}',
  '`;',
  'const holder = { run: function selfTest() { return FIXTURE.length; } };',
  'function selfTest() {',
  '  const failures = [];',
  "  if (holder.run() < 1) failures.push('the fixture text went missing');",
  "  if (failures.length) { console.error(failures.join(String.fromCharCode(10))); process.exit(1); }",
  "  console.log('fixture self-test: 1 case passes');",
  '}',
  "if (process.argv.includes('--self-test')) selfTest();",
  '',
].join('\n');

/** The definition-shaped text the three decoys and the real definition share. */
const DECOY_ANCHOR_TEXT = 'function selfTest() {';

/**
 * The MASKED-DEFINITIONS fixture: definition-shaped text that is not a
 * definition, in BOTH shapes `selfTestDefs` collects and BOTH texts the mask
 * blanks -- a `function` and an arrow inside a fixture STRING, and a `function`
 * inside a COMMENT -- standing beside one real example of each.
 *
 * The decoy names differ from the real ones ON PURPOSE. The anchor fixture above
 * spells every decoy `selfTest`, which is right for it (an anchor takes ONE
 * match and the question is WHICH), but it cannot pin a collector: a `Set` of
 * names collapses the decoys into the real name and the wrong answer and the
 * right answer are the same list. Only a decoy with its OWN name can be seen to
 * be absent -- which is the reading the census took on
 * `scripts/pm/dispatch-gates.mjs`, where `fixtureSelfTest` is a name in a
 * fixture array and nothing can call it (#15574).
 *
 * The fixture is READ, never spawned; `selfTestDefs` is a pure function of text.
 */
const MASKED_DEFS_GATE = [
  '#!/usr/bin/env node',
  '// The convention this tree writes: function commentSelfTest() { at column 0.',
  'const FIXTURE = `',
  'function fixtureSelfTest() {',
  "  console.log('a fixture this gate scans, not a definition');",
  '}',
  'const fixtureSelfTestLater = () => {};',
  '`;',
  'function selfTest() {',
  "  if (FIXTURE.length < 1) { console.error('the fixture text went missing'); process.exit(1); }",
  "  console.log('fixture self-test: 1 case passes');",
  '}',
  'const runSelfTestTwice = () => { selfTest(); selfTest(); };',
  "if (process.argv.includes('--self-test')) selfTest();",
  '',
].join('\n');

/** What `selfTestDefs` must collect from the fixture above, and in this order. */
const MASKED_DEFS_EXPECTED = ['selfTest', 'runSelfTestTwice'];

/**
 * The SLOW gate, reduced: a self-test that outlasts the budget it is probed
 * under. It sleeps rather than spins -- a control that runs on EVERY invocation
 * of this tool may not take a core with it on a shared box.
 *
 * The pair below probes THIS ONE FIXTURE under two budgets and nothing else
 * differs: same file, same entry, same mutation. Under the smaller one the
 * baseline is killed and no verdict is available; under a budget that fits, the
 * same gate is read DEFEATED. That is the whole of #15573 in two spawns -- the
 * row that reads `killed by SIGTERM` is reporting the INSTRUMENT'S budget, and
 * a budget is a thing a ledger row can carry.
 */
const SLOW_GATE = [
  '#!/usr/bin/env node',
  'function selfTest() {',
  '  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900);',
  "  console.log('fixture self-test: 1 case passes');",
  '}',
  "if (process.argv.includes('--self-test')) selfTest();",
  '',
].join('\n');

/** A budget the fixture above cannot finish inside, and one it can. */
const SLOW_GATE_BUDGET_TOO_SMALL = 250;
const SLOW_GATE_BUDGET_THAT_FITS = 20_000;

/**
 * The WALKING gate, reduced: a gate whose own self-test sweeps the directory it
 * lives in and refuses anything it did not expect to find there. That is not a
 * defect -- `check-pnpm-filter-targets` does exactly this over `scripts/` and is
 * right to -- but under the OLD placement the probe's own copy was the stray, so
 * the gate's BASELINE exited non-zero and the row read NOT MEASURED for a reason
 * belonging entirely to the instrument (#15515).
 *
 * The fixture is deliberately the WHOLE relocation contract in one spawn. Its
 * module-level line prints three readings, all of which the mutated copy must
 * still answer the way the original does:
 *
 *   dir=   `basename(dirname(fileURLToPath(import.meta.url)))` -- the
 *          `import.meta.url` rewrite. Unrewritten, the copy names its temp dir.
 *   help=  a value imported RELATIVELY from `./helper.mjs` -- the specifier
 *          rewrite. Unrewritten, the copy dies in module resolution.
 *   dep=   a value imported by BARE specifier from a `node_modules` beside the
 *          original -- the `node_modules` link. Unlinked, likewise.
 *
 * ...and it dispatches behind `isEntrypoint(import.meta.url)`, the one
 * `import.meta.url` the relocation must NOT rewrite: answered about the
 * original, the copy would run nothing, print nothing and exit 0 -- DEFEATED
 * rather than the HELD its handshake earns. So the verdict reads that exception
 * and the printed line reads the three rewrites, in the same run.
 */
const WALKING_GATE_DIR = 'walked';
const WALKING_GATE_DEP = 'os-probe-fixture-dep';

const WALKING_GATE_HELPER = [
  '// `isEntrypoint` is RE-EXPORTED from the tree\'s one entry predicate rather',
  '// than respelled here -- a twelfth spelling is the defect check-entry-guard',
  '// exists to stop. By absolute URL, which the relocation leaves alone.',
  `export { isEntrypoint } from ${JSON.stringify(new URL('./invoked-as.mjs', import.meta.url).href)};`,
  "export const HELP = 'helped';",
  '',
].join('\n');

const WALKING_GATE = [
  '#!/usr/bin/env node',
  "import { readdirSync } from 'node:fs';",
  "import { basename, dirname } from 'node:path';",
  "import { fileURLToPath } from 'node:url';",
  `import { DEP } from '${WALKING_GATE_DEP}';`,
  "import { HELP, isEntrypoint } from './helper.mjs';",
  'const HERE = dirname(fileURLToPath(import.meta.url));',
  "const EXPECTED = ['gate.mjs', 'helper.mjs', 'node_modules'];",
  'let selfTestReachedVerdict = false;',
  "console.log('fixture: dir=' + basename(HERE) + ' help=' + HELP + ' dep=' + DEP);",
  'function selfTest() {',
  '  const failures = [];',
  '  const strays = readdirSync(HERE).filter((n) => !EXPECTED.includes(n));',
  "  if (strays.length) failures.push('the walked tree is not clean: ' + strays.join(','));",
  "  if (failures.length) { console.error(failures.join(String.fromCharCode(10))); process.exit(1); }",
  "  console.log('fixture self-test: 1 case passes');",
  '  selfTestReachedVerdict = true;',
  '}',
  'if (isEntrypoint(import.meta.url)) {',
  "  if (process.argv.includes('--self-test')) {",
  '    selfTest();',
  '    if (!selfTestReachedVerdict) {',
  "      console.error('fixture self-test: selfTest() returned without reaching its verdict');",
  '      process.exit(1);',
  '    }',
  '  }',
  '}',
  '',
].join('\n');

/** What the walking fixture prints before it dispatches, when ALL THREE rewrites landed. */
const WALKING_GATE_LINE = `fixture: dir=${WALKING_GATE_DIR} help=helped dep=linked`;

/**
 * The rewrite specimen, READ rather than run: every shape `relocateSource`
 * touches and every shape it must leave alone, in one text. The last two lines
 * are the ones that make this a control rather than a demonstration -- a fixture
 * STRING carrying an import statement, and prose naming `import.meta.url`. Both
 * are what several gates in this tree feed their own scanners, and rewriting
 * either would change what the gate SCANS instead of where the copy resolves.
 */
const RELOCATION_SPECIMEN = [
  "import { a } from './sib.mjs';",
  "import { b } from '../up.mjs';",
  "import './side-effect.mjs';",
  "import { c } from 'node:path';",
  'const HERE = fileURLToPath(import.meta.url);',
  "const ROOT_URL = new URL('..', import.meta.url);",
  'if (isEntrypoint(import.meta.url)) {}',
  "const load = () => import('./dyn.mjs');",
  "const FIXTURE = `import { z } from './fixture-only.mjs';`;",
  "const PROSE = 'import.meta.url';",
  '',
].join('\n');

/**
 * The anchor an UNMASKED, UNANCHORED first match takes -- the pre-#14963 rule,
 * kept here as the thing the controls below measure against rather than as a
 * second implementation of anything: `injectEarlyReturn` never uses it.
 */
const NAIVE_ANCHOR = /(?:async\s+)?function\s+selfTest\s*\([^)]*\)\s*\{/;

/**
 * Both instruments, against both directions. Returns the failures; the caller
 * refuses on any. Nothing here reads the repo, so a control failure is always
 * the instrument and never the tree.
 */
export function runControls() {
  const failures = [];
  const say = (cond, label) => { if (!cond) failures.push(label); };

  // The POPULATION criterion, both halves and both directions. What is at stake
  // here is not a classification but a ROW: a spelling this criterion cannot see
  // removes its file from the census silently (#15421).
  say(DISPATCH.test(maskComments(HOLED_GATE)),
    'POPULATION CONTROL FAILED: a gate dispatching by argv membership was not admitted to the population');
  say(DISPATCH.test(maskComments(EQUALITY_DISPATCH_GATE)),
    "POPULATION CONTROL FAILED: a gate dispatching by equality on an extracted flag (`flag === '--self-test'`) was not admitted to the population");
  say(!DISPATCH_MEMBERSHIP.test(maskComments(EQUALITY_DISPATCH_GATE)),
    'CONTROL FIXTURE INVALID: the equality fixture also carries a membership dispatch, so the verdict above would pass without the equality half being read at all');
  say(EQUALITY_DISPATCH_GATE.includes(EQUALITY_DISPATCH),
    'CONTROL FIXTURE INVALID: the equality fixture no longer carries the dispatch line the spellings below replace, so every variant is the SAME file');
  const equalityDispatch = (spelling) => maskComments(EQUALITY_DISPATCH_GATE.replace(EQUALITY_DISPATCH, spelling));
  say(DISPATCH.test(equalityDispatch('flag == "--self-test"')),
    'POPULATION CONTROL FAILED: loose equality against a double-quoted literal was not admitted');
  say(DISPATCH.test(equalityDispatch("'--self-test' === flag")),
    'POPULATION CONTROL FAILED: the literal on the LEFT of the comparison was not admitted');
  say(DISPATCH.test(equalityDispatch('flag === `--self-test`')),
    'POPULATION CONTROL FAILED: a template-literal spelling of the flag was not admitted');
  say(!DISPATCH.test(maskComments(NON_DISPATCH_MENTION_GATE)),
    'POSITIVE CONTROL FAILED: a file that only MENTIONS the flag -- in prose, in a comparison against a call result, and as a literal handed to a child -- entered the population; the census would then be seeded with the very tools that reason about self-tests');
  say(DISPATCH.test(NON_DISPATCH_MENTION_GATE),
    'CONTROL FIXTURE INVALID: the mention fixture does not match even UNMASKED, so the verdict above says nothing about comments being masked away');

  // ⛔ ... and the population criterion must keep reading COMMENT-masked source.
  // The mask the injection ANCHOR needs blanks literals too, and every dispatch
  // in this tree names the flag with a string literal -- so reading the census
  // through that one would not classify a single file generously, it would empty
  // the population, taking this instrument's own control fixtures (deliberately
  // strings) with it. The two masks are required to answer this OPPOSITELY.
  say(!DISPATCH.test(maskCommentsAndLiterals(HOLED_GATE)),
    'CONTROL FAILED: the code-only mask that the injection anchor reads still admits a dispatch to the population; the two masks no longer answer differently, and whichever of them the census ends up reading, one of the two questions is being answered with the wrong text');

  // The ANCHOR, against every text that reads like a definition without being
  // one. What is at stake is not a classification but a WRONG READING: an
  // injection into a fixture string makes the copy a SyntaxError, whose non-zero
  // exit and stack trace this file's verdict scores HELD (#14963).
  const decoyFlags = scanSource(DECOY_ANCHOR_GATE);
  const commentDecoy = DECOY_ANCHOR_GATE.indexOf(DECOY_ANCHOR_TEXT);
  const literalDecoy = DECOY_ANCHOR_GATE.indexOf(DECOY_ANCHOR_TEXT, commentDecoy + 1);
  const midLineDecoy = DECOY_ANCHOR_GATE.indexOf('function selfTest() { return FIXTURE.length');
  const realDef = DECOY_ANCHOR_GATE.indexOf('\nfunction selfTest() {\n  const failures') + 1;
  say(commentDecoy >= 0 && literalDecoy > commentDecoy && midLineDecoy > literalDecoy && realDef > midLineDecoy,
    'CONTROL FIXTURE INVALID: the three decoys no longer all stand AHEAD of the real definition, so a first-match anchor would reach the definition however it was spelled and every verdict below passes for the wrong reason');
  say(decoyFlags.comment[commentDecoy] === 1,
    'CONTROL FIXTURE INVALID: the first decoy is not comment content, so it no longer tests the comment half of the mask');
  say(decoyFlags.literal[literalDecoy] === 1,
    'CONTROL FIXTURE INVALID: the second decoy is not literal content, so it no longer tests the string/template half of the mask -- the half whose failure produces a SyntaxError and a false HELD');
  say(decoyFlags.comment[midLineDecoy] === 0 && decoyFlags.literal[midLineDecoy] === 0,
    'CONTROL FIXTURE INVALID: the third decoy is masked away as comment or literal, so it tests the mask a second time instead of the LINE-START rule it is there for');
  say(DECOY_ANCHOR_GATE.search(NAIVE_ANCHOR) === commentDecoy,
    'CONTROL FIXTURE INVALID: an unmasked first-match anchor no longer lands on a decoy, so the MASK is not what the anchor verdict below is reading');
  say(maskCommentsAndLiterals(DECOY_ANCHOR_GATE).search(NAIVE_ANCHOR) === midLineDecoy,
    'CONTROL FIXTURE INVALID: masking alone no longer lands on the mid-line decoy, so the LINE-START rule is not what the anchor verdict below is reading -- masking would be carrying it on its own');
  const decoyInjected = injectEarlyReturn(DECOY_ANCHOR_GATE, 'selfTest');
  say(decoyInjected !== null
    && decoyInjected.includes(`function selfTest() {\n  return; /*${PROBE_MARKER}*/\n\n  const failures = [];`),
    'ANCHOR CONTROL FAILED: the early return was not injected at the REAL definition; a text that merely READS like one -- in a comment, in a fixture string, or mid-line in code -- was preferred over the function the dispatch calls');

  // The DEFINITION LIST, over the same masked text the anchor reads. A phantom
  // name here is not a wrong verdict -- an extra name only makes a row ambiguous,
  // which is NOT MEASURED -- but it is a name that cannot be called, published in
  // `--json` and named in a diagnostic that tells the reader to go read it
  // (#15574).
  const maskedDefsFlags = scanSource(MASKED_DEFS_GATE);
  const commentDef = MASKED_DEFS_GATE.indexOf('function commentSelfTest() {');
  const literalDef = MASKED_DEFS_GATE.indexOf('function fixtureSelfTest() {');
  const literalArrowDef = MASKED_DEFS_GATE.indexOf('const fixtureSelfTestLater =');
  const realFunctionDef = MASKED_DEFS_GATE.indexOf('\nfunction selfTest() {') + 1;
  say(commentDef >= 0 && maskedDefsFlags.comment[commentDef] === 1,
    'CONTROL FIXTURE INVALID: the comment decoy is not comment content, so the verdict below says nothing about comments being masked away');
  say(literalDef >= 0 && maskedDefsFlags.literal[literalDef] === 1,
    'CONTROL FIXTURE INVALID: the `function` decoy is not literal content, so the verdict below says nothing about fixture STRINGS being masked away -- the half the census actually tripped over');
  say(literalArrowDef >= 0 && maskedDefsFlags.literal[literalArrowDef] === 1,
    'CONTROL FIXTURE INVALID: the ARROW decoy is not literal content; `selfTestDefs` collects two shapes and only one of them would be under test');
  say(realFunctionDef > 0 && maskedDefsFlags.comment[realFunctionDef] === 0 && maskedDefsFlags.literal[realFunctionDef] === 0,
    'CONTROL FIXTURE INVALID: the real definition is itself masked away, so the fixture cannot show a definition SURVIVING beside the decoys');
  say(JSON.stringify(selfTestDefs(MASKED_DEFS_GATE)) === JSON.stringify(MASKED_DEFS_EXPECTED),
    `DEFINITION CONTROL FAILED: definition-shaped text inside a fixture string or a comment was collected as a definition of the file quoting it -- got ${JSON.stringify(selfTestDefs(MASKED_DEFS_GATE))}, expected ${JSON.stringify(MASKED_DEFS_EXPECTED)}`);
  // ... and the other direction, which is what makes the verdict above a reading
  // of the MASK rather than of a fixture whose decoys were never collectable:
  // the SAME text with its literal delimiters removed puts both decoys in code,
  // and the same collector must then collect them.
  const unquotedDefs = selfTestDefs(MASKED_DEFS_GATE.replaceAll('`', ''));
  say(unquotedDefs.includes('fixtureSelfTest') && unquotedDefs.includes('fixtureSelfTestLater'),
    'CONTROL FIXTURE INVALID: with the fixture STRING delimiters removed the two decoys are still not collected, so they were never definition-shaped and the verdict above passes for the wrong reason');
  say(selfTestDefs(MASKED_DEFS_GATE.replace('// ', '')).includes('commentSelfTest'),
    'CONTROL FIXTURE INVALID: with the comment marker removed the comment decoy is still not collected, so it was never definition-shaped and the verdict above passes for the wrong reason');

  // The LEDGER's two row spellings, and the reading `main()` takes from them.
  // What is at stake is a NOT MEASURED whose stated reason is false: a record
  // passed through as if it were an entry name asks for a definition of
  // `[object Object]` and reports "no injectable definition of" it.
  const rowOf = (defs) => ({ file: 'scripts/fixture-gate.mjs', defs });
  const ledgerOf = (row) => ({ 'scripts/fixture-gate.mjs': row });
  say(probePlan(rowOf(['selfTest']), {}).entry === 'selfTest' && probePlan(rowOf(['selfTest']), {}).timeoutMs === undefined,
    'PLAN CONTROL FAILED: a file with exactly ONE self-test definition and no ledger row did not resolve mechanically to that definition at the default budget');
  say(probePlan(rowOf(['selfTest', 'runSelfTest']), {}).entry === undefined
    && /^ambiguous entry \(selfTest, runSelfTest\)/.test(probePlan(rowOf(['selfTest', 'runSelfTest']), {}).why ?? ''),
    'PLAN CONTROL FAILED: two definitions and no ledger row is an ambiguous entry, which is NOT MEASURED with that reason -- never a guess at one of them');
  say(/inline top-level block/.test(probePlan(rowOf([]), {}).why ?? ''),
    'PLAN CONTROL FAILED: a file with no self-test definition at all lost its own NOT MEASURED reason');
  say(probePlan(rowOf(['selfTest', 'runSelfTest']), ledgerOf('runSelfTest')).entry === 'runSelfTest',
    'PLAN CONTROL FAILED: a hand-read ledger row did not override the mechanical reading; the ledger exists precisely for the files the mechanical path cannot resolve');
  say(probePlan(rowOf(['selfTest']), ledgerOf(null)).entry === undefined
    && /not probeable/.test(probePlan(rowOf(['selfTest']), ledgerOf(null)).why ?? ''),
    'PLAN CONTROL FAILED: a `null` ledger row was probed anyway; a hand-read "there is no single entry" must stay NOT MEASURED');
  const recordPlan = probePlan(rowOf(['selfTest']), ledgerOf({ entry: 'runSelfTest', timeoutMs: 5000 }));
  say(recordPlan.entry === 'runSelfTest' && recordPlan.timeoutMs === 5000,
    `PLAN CONTROL FAILED: the record row spelling did not yield its entry and budget (got ${JSON.stringify(recordPlan)})`);
  say(typeof recordPlan.entry === 'string',
    'PLAN CONTROL FAILED: the record row itself was passed through as the ENTRY; the probe would then report `no injectable definition of [object Object]` -- a NOT MEASURED whose stated reason is false');
  // The SHIPPED ledger, read the way `main()` reads it. A row edited into a
  // shape this reader does not understand is silently no budget at all.
  for (const [file, row] of Object.entries(ENTRY_BY_HAND)) {
    const { entry, timeoutMs } = readLedgerRow(row);
    const fields = typeof row === 'object' && row !== null ? Object.keys(row) : [];
    say(entry === null || (typeof entry === 'string' && entry.length > 0),
      `LEDGER ROW INVALID: ${file} names no entry this reader can use (${JSON.stringify(row)})`);
    say(timeoutMs === undefined || (Number.isInteger(timeoutMs) && timeoutMs > 0),
      `LEDGER ROW INVALID: ${file} carries a budget that is not a positive whole number of milliseconds (${JSON.stringify(timeoutMs)})`);
    say(fields.every((k) => k === 'entry' || k === 'timeoutMs'),
      `LEDGER ROW INVALID: ${file} carries a field this reader does not read (${fields.join(', ')}); a misspelled \`timeoutMs\` is not a smaller budget, it is NO budget -- the default, and the SIGTERM this field exists to end`);
  }

  // Instrument 1, both directions.
  say(classifyFloor(maskComments(HOLED_GATE)) === 'NONE',
    'POSITIVE CONTROL FAILED: a self-test deciding success by failures.length alone was not classified NONE');
  say(classifyFloor(maskComments(SOUND_GATE)) === 'ROSTER',
    'NEGATIVE CONTROL FAILED: a roster-floored self-test was not classified ROSTER');

  // The ternary exit, both directions. The failing arm being a NON-ZERO LITERAL
  // is what produces the failure; the roster half still has to match on its own,
  // and an opaque expression still has to produce nothing.
  const ternaryExit = (dispatchArgs) =>
    maskComments(TERNARY_EXIT_GATE.replace(TERNARY_EXIT_DISPATCH, dispatchArgs));
  say(!PRODUCES_FAILURE_NAMED.test(maskComments(TERNARY_EXIT_GATE)),
    'CONTROL FIXTURE INVALID: the ternary fixture picked up one of the NAMED failure spellings; every verdict below it would then be passing for the wrong reason');
  say(classifyFloor(maskComments(TERNARY_EXIT_GATE)) === 'ROSTER',
    'NEGATIVE CONTROL FAILED: a roster floor whose only failure production is `process.exit(<cond> ? 0 : 1)` was not classified ROSTER');
  say(classifyFloor(ternaryExit('runSelfTest() ? 0 : 2')) === 'ROSTER',
    'NEGATIVE CONTROL FAILED: a ternary exit whose failing arm is a non-zero literal other than 1 was not classified ROSTER');
  say(classifyFloor(ternaryExit('!runSelfTest() ? 1 : 0')) === 'ROSTER',
    'NEGATIVE CONTROL FAILED: the inverted ternary exit (`? 1 : 0`, the failing arm first) was not classified ROSTER');
  say(classifyFloor(ternaryExit('runSelfTest()')) === 'NONE',
    'POSITIVE CONTROL FAILED: a bare `process.exit(<expr>)` was read as producing a failure -- an opaque expression is the accident shape (it is `process.exit(undefined)` after an early return), not a floor');
  say(classifyFloor(maskComments(TERNARY_EXIT_GATE
    .replaceAll('SELF_TEST_BATTERIES', 'FIXTURE_BATTERIES_BY_NAME')
    .replaceAll('declaredBatteries', 'declaredNames'))) === 'NONE',
    'POSITIVE CONTROL FAILED: the ternary exit alone was classified ROSTER -- producing a failure is HALF the criterion; a roster this criterion can NAME is the other half');
  // Reuse rather than invention: the shape now recognised is the one the ACCIDENT
  // fixture above actually dispatches with (and the audit file it is reduced
  // from), so the criterion stays pinned to a spelling measured in this tree.
  say(PRODUCES_FAILURE_TERNARY_EXIT.test(ACCIDENT_GATE.split('\n').find((l) => l.includes('process.exit(')) ?? ''),
    'CONTROL FAILED: the accident fixture no longer dispatches with the ternary exit this criterion was extended to read; the two have drifted apart');

  // The RELOCATION rewrite, read as a pure function: every shape it touches and
  // every shape it must leave alone. What is at stake in the last two is not a
  // classification but WHAT THE COPY SCANS -- rewriting a fixture string would
  // change the gate's own input (#15515).
  const specimenFile = join(ROOT, 'scripts', 'not-on-disk-relocation-specimen.mjs');
  const specimenUrl = pathToFileURL(specimenFile).href;
  const relocated = relocateSource(RELOCATION_SPECIMEN, specimenFile);
  const sibling = (rel) => JSON.stringify(new URL(rel, specimenUrl).href);
  say(relocated.blocked.length === 0,
    `RELOCATION CONTROL FAILED: the specimen carries only rewritable shapes but was refused (${relocated.blocked.join('; ')})`);
  say(relocated.source.includes(`import { a } from ${sibling('./sib.mjs')};`),
    'RELOCATION CONTROL FAILED: a `./` static specifier was not rewritten to the ORIGINAL neighbour it names');
  say(relocated.source.includes(`import { b } from ${sibling('../up.mjs')};`),
    'RELOCATION CONTROL FAILED: a `../` static specifier was not rewritten to the ORIGINAL neighbour it names');
  say(relocated.source.includes(`import ${sibling('./side-effect.mjs')};`),
    'RELOCATION CONTROL FAILED: the side-effect-only `import <spec>` form was not rewritten');
  say(relocated.source.includes(`import(${sibling('./dyn.mjs')})`),
    'RELOCATION CONTROL FAILED: a DYNAMIC relative specifier was not rewritten; `requireDependency` loads its optional deps through exactly that form');
  say(relocated.source.includes("import { c } from 'node:path';"),
    'CONTROL FIXTURE INVALID: a `node:` builtin specifier was rewritten; only RELATIVE specifiers name a neighbour to follow');
  say(relocated.source.includes(`fileURLToPath(${JSON.stringify(specimenUrl)})`)
    && relocated.source.includes(`new URL('..', ${JSON.stringify(specimenUrl)})`),
    "RELOCATION CONTROL FAILED: `import.meta.url` in a PATH-deriving position was not rewritten to the original's url; ROOT would then resolve to the temp directory");
  // ⛔ ... and the one that must NOT be rewritten. 145 of the census's dispatches
  // sit behind this call; answered about the original, every one of those copies
  // runs nothing, prints nothing and exits 0 -- a whole-census false DEFEATED.
  say(relocated.source.includes('if (isEntrypoint(import.meta.url)) {}'),
    'RELOCATION CONTROL FAILED: the `isEntrypoint(import.meta.url)` argument was rewritten; the copy would then ask whether the ORIGINAL was run, dispatch nothing, and be scored DEFEATED');
  say(relocated.source.includes("const FIXTURE = `import { z } from './fixture-only.mjs';`;")
    && relocated.source.includes("const PROSE = 'import.meta.url';"),
    'RELOCATION CONTROL FAILED: an import statement inside a fixture STRING, or the word `import.meta.url` inside prose, was rewritten -- that changes what the gate SCANS, not where the copy resolves');
  say(relocateSource("const t = import.meta.resolve('x');", specimenFile).blocked.length === 1,
    'RELOCATION CONTROL FAILED: a shape that resolves from the running file\'s OWN url was not refused; a member it cannot serve must keep the old placement and SAY so, never be relocated with resolution it cannot honour');
  say(relocateSource('const m = await import(`./x-${n}.mjs`);', specimenFile).blocked.length === 1,
    'RELOCATION CONTROL FAILED: a relative specifier written as a TEMPLATE literal was not refused; it is an expression, so no literal rewrite can follow it to the original');

  // Instrument 2, both directions, against real processes on disk.
  const dir = mkdtempSync(join(tmpdir(), 'self-test-floor-control-'));
  try {
    const holed = join(dir, 'holed-gate.mjs');
    const sound = join(dir, 'sound-gate.mjs');
    const accident = join(dir, 'accident-gate.mjs');
    const unrunnable = join(dir, 'unrunnable-gate.mjs');
    const decoy = join(dir, 'decoy-anchor-gate.mjs');
    const helper = join(dir, 'helper-handshake-gate.mjs');
    const helperHoled = join(dir, 'helper-handshake-gate-holed.mjs');
    writeFileSync(holed, HOLED_GATE);
    writeFileSync(sound, SOUND_GATE);
    writeFileSync(accident, ACCIDENT_GATE);
    writeFileSync(unrunnable, UNRUNNABLE_GATE);
    writeFileSync(decoy, DECOY_ANCHOR_GATE);
    writeFileSync(helper, HELPER_HANDSHAKE_GATE);
    writeFileSync(helperHoled, HELPER_HANDSHAKE_GATE_HOLED);
    const h = probeEarlyReturn(holed, 'selfTest');
    const s = probeEarlyReturn(sound, 'selfTest');
    const a = probeEarlyReturn(accident, 'runSelfTest');
    const u = probeEarlyReturn(unrunnable, 'selfTest');
    const dc = probeEarlyReturn(decoy, 'selfTest');
    const hh = probeEarlyReturn(helper, 'selfTest');
    const hhHoled = probeEarlyReturn(helperHoled, 'selfTest');
    say(h.verdict === 'DEFEATED',
      `POSITIVE CONTROL FAILED: the probe read a known-holed gate as ${h.verdict} (${h.why ?? ''})`);
    say(h.mutatedBytes === 0,
      'POSITIVE CONTROL FAILED: the known-holed gate printed something; the measured shape prints NOTHING');
    say(s.verdict === 'HELD',
      `NEGATIVE CONTROL FAILED: the probe read a handshake-protected gate as ${s.verdict} (${s.why ?? ''})`);
    // The discriminator, in both directions. A gate that HOLDS must be one that
    // SPOKE; a non-zero exit that printed nothing is an ACCIDENT and must never
    // be counted among the holds (#15324).
    say(s.mutatedSpoke === true && s.mutatedBytes > 0,
      'NEGATIVE CONTROL FAILED: the handshake-protected gate printed nothing when defeated; HELD is supposed to mean it REFUSED out loud');
    say(a.verdict === 'ACCIDENT',
      `POSITIVE CONTROL FAILED: the probe read a silent non-zero exit as ${a.verdict} (${a.why ?? ''}) -- an exit code is not a handshake`);
    say(a.mutatedExit !== 0 && a.mutatedBytes === 0 && a.mutatedSpoke === false,
      `POSITIVE CONTROL FAILED: the accident fixture no longer produces the measured shape (exit ${a.mutatedExit}, ${a.mutatedBytes} byte(s)); the ACCIDENT verdict above would then be passing for the wrong reason`);
    // The precondition, in the direction that matters: a baseline that already
    // failed ends the probe, and it must end it as NOT MEASURED -- never as the
    // HELD an exit-code-and-speech reading would award it (#15391).
    say(u.verdict === 'NOT MEASURED' && /^baseline run failed \(exit /.test(u.why ?? ''),
      `POSITIVE CONTROL FAILED: a file whose BASELINE run already exits non-zero was read as ${u.verdict} (${u.why ?? ''}); the mutation had nothing to defeat, so nothing was measured`);
    // ... and for the RIGHT reason: this fixture has to be the flattering shape,
    // a red baseline that SPEAKS. A fixture that fell silent, or that stopped
    // being red, would satisfy the verdict above while testing nothing.
    say(u.baselineExit !== 0 && u.baselineBytes > 0 && u.baselineHead !== '',
      `POSITIVE CONTROL FAILED: the unrunnable fixture no longer produces the measured shape (baseline exit ${u.baselineExit}, ${u.baselineBytes} byte(s)); the NOT MEASURED verdict above would then be passing for the wrong reason`);
    // The anchor, ON DISK. The static assertions above read WHERE the injection
    // went; this one reads what the copy then DID -- so it also says the copy
    // parsed and ran. Anchored on the fixture string instead, the copy dies in
    // the parser: non-zero exit, a stack trace on stderr, verdict HELD.
    say(dc.verdict === 'DEFEATED',
      `POSITIVE CONTROL FAILED: a known-holed gate whose real definition is preceded by three definition-shaped decoys was read as ${dc.verdict} (${dc.why ?? ''}); anchored on the fixture string this reads HELD, a hold awarded for the probe breaking its own copy`);
    say(dc.mutatedBytes === 0,
      `POSITIVE CONTROL FAILED: the decoy gate printed ${dc.mutatedBytes} byte(s) when defeated; the copy anchored on the real definition returns before its verdict line and says NOTHING, so anything printed here is the copy failing rather than the gate being silent`);
    // The HELPER handshake spelling, both directions, differing by ONE line: the
    // dispatch asking `requireReachedVerdict`. Until this fixture the probe had
    // read that shape in NEITHER direction -- its single carrier in the tree is
    // an ENTRY_BY_HAND `null`, so a green sweep was evidence for the sentinel and
    // flag spellings only (#15371).
    say(HELPER_HANDSHAKE_GATE_HOLED !== HELPER_HANDSHAKE_GATE,
      'CONTROL FIXTURE INVALID: the helper-handshake dispatch line was not found in the fixture, so the two directions below are the SAME file and one of the verdicts is passing for the wrong reason');
    say(hh.verdict === 'HELD',
      `NEGATIVE CONTROL FAILED: the probe read a helper-handshake gate (\`requireReachedVerdict\`) as ${hh.verdict} (${hh.why ?? ''})`);
    say(hh.mutatedSpoke === true && hh.mutatedBytes > 0,
      'NEGATIVE CONTROL FAILED: the helper-handshake gate printed nothing when defeated; HELD is supposed to mean it REFUSED out loud');
    // ... and the refusal has to be the HELPER's, read past the blank line it
    // prints first. A HELD earned by some other printer would test nothing about
    // this spelling.
    say((hh.mutatedHead ?? '').includes('returned without reaching its verdict'),
      `CONTROL FIXTURE INVALID: the helper-handshake gate's refusal is no longer the helper's (first non-blank line: ${JSON.stringify((hh.mutatedHead ?? '').slice(0, 80))})`);
    say(hhHoled.verdict === 'DEFEATED',
      `POSITIVE CONTROL FAILED: the SAME fixture with only the \`requireReachedVerdict\` call deleted was read as ${hhHoled.verdict} (${hhHoled.why ?? ''}); the handshake call is the whole difference`);
    say(hhHoled.mutatedBytes === 0,
      'POSITIVE CONTROL FAILED: the helper-handshake gate with its handshake deleted printed something; without the call there is nothing left to notice the early return, so the run says NOTHING and exits 0');

    // The BUDGET, in both directions: ONE fixture, two budgets, nothing else
    // different -- same file, same entry, same mutation. Under a budget it
    // cannot finish inside, the baseline is killed and NO verdict is available;
    // under one that fits, the same gate is read DEFEATED. This is the pair that
    // pins #15573: a row reading `killed by SIGTERM` reports the INSTRUMENT'S
    // budget, and a budget is a thing a ledger row can carry.
    const slow = join(dir, 'slow-gate.mjs');
    writeFileSync(slow, SLOW_GATE);
    const slowKilled = probeEarlyReturn(slow, 'selfTest', { timeout: SLOW_GATE_BUDGET_TOO_SMALL });
    const slowFits = probeEarlyReturn(slow, 'selfTest', { timeout: SLOW_GATE_BUDGET_THAT_FITS });
    say(slowKilled.verdict === 'NOT MEASURED' && /^killed by /.test(slowKilled.why ?? ''),
      `BUDGET CONTROL FAILED: a self-test that outlasts its budget read ${slowKilled.verdict} (${slowKilled.why ?? ''}); a run that never produced an exit code measured nothing, and the safe direction is to say so`);
    // ⛔ ... and it must be readable as THIS TOOL'S doing. Without that field the
    // shrink is a silence: the sweep can count the NOT MEASURED rows but cannot
    // say how many of them were killed by a number it chose itself.
    say(slowKilled.timedOut === true,
      'BUDGET CONTROL FAILED: a row killed by the probe\'s own timeout does not publish `timedOut`, so the population this instrument silences cannot be counted');
    say(slowFits.verdict === 'DEFEATED',
      `BUDGET CONTROL FAILED: the SAME fixture under a budget that fits read ${slowFits.verdict} (${slowFits.why ?? ''}); with both budgets alike the verdict above says nothing about the BUDGET being what ended the other run`);
    say(slowFits.timedOut === undefined,
      'BUDGET CONTROL FAILED: a run that finished inside its budget still published `timedOut`; the count of silenced rows would then include rows that were measured');

    // The WALKING gate, in both PLACEMENTS. This is the pair that pins the
    // repair: the same fixture, the same mutation, differing only in where the
    // copy was written. Its own directory is separate from the fixtures above,
    // because what it asserts is that NOTHING it did not expect is in there.
    const walkedDir = join(dir, WALKING_GATE_DIR);
    const depDir = join(walkedDir, 'node_modules', WALKING_GATE_DEP);
    mkdirSync(depDir, { recursive: true });
    writeFileSync(join(depDir, 'package.json'), '{"name":"' + WALKING_GATE_DEP + '","type":"module","main":"index.mjs"}\n');
    writeFileSync(join(depDir, 'index.mjs'), "export const DEP = 'linked';\n");
    writeFileSync(join(walkedDir, 'helper.mjs'), WALKING_GATE_HELPER);
    const walkingGate = join(walkedDir, 'gate.mjs');
    writeFileSync(walkingGate, WALKING_GATE);
    const wk = probeEarlyReturn(walkingGate, 'selfTest');
    const wkBeside = probeEarlyReturn(walkingGate, 'selfTest', { placement: 'beside' });
    say(wk.verdict === 'HELD',
      `RELOCATION CONTROL FAILED: a gate whose self-test walks its own directory read ${wk.verdict} (${wk.why ?? ''}); with the copy written outside that tree its baseline is clean, so a verdict is available at all`);
    // One line, three rewrites: see the fixture's docblock. A copy that resolved
    // any of them against the temp directory cannot print it.
    say(wk.mutatedHead === WALKING_GATE_LINE,
      `RELOCATION CONTROL FAILED: the relocated copy did not resolve what the original resolves -- it printed ${JSON.stringify(wk.mutatedHead ?? '')}, not ${JSON.stringify(WALKING_GATE_LINE)}`);
    // ... and the direction. The SAME fixture, the copy beside the original: the
    // gate finds the stray, refuses, and its own baseline ends the probe.
    say(wkBeside.verdict === 'NOT MEASURED' && /^baseline run failed \(exit /.test(wkBeside.why ?? ''),
      `DIRECTION CONTROL FAILED: with the copy written BESIDE the original the walking gate read ${wkBeside.verdict} (${wkBeside.why ?? ''}); that placement is what made this class of row NOT MEASURED, so the verdict above would be passing for no reason`);
    // ... and it is the PLACEMENT that reds it, not the fixture. Same file, same
    // mutation, same spawn: the relocated leg's baseline exits 0 (its HELD above
    // is only reachable through a green baseline) and this one exits 1.
    say(wk.baselineExit === 0 && wkBeside.baselineExit === 1,
      `CONTROL FIXTURE INVALID: the two placements did not separate the fixture's own baseline (relocated exit ${wk.baselineExit}, beside exit ${wkBeside.baselineExit}); with both alike, the verdicts above say nothing about WHERE the copy was written`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return failures;
}

// ---------------------------------------------------------------------------
// The census
// ---------------------------------------------------------------------------

/**
 * ⛔ SHRINK-ONLY. The ten files whose entry cannot be resolved mechanically,
 * resolved by READING the dispatch site (the ruling's A2.1: the grep is an
 * entry point, not the criterion). A `null` entry is NOT MEASURED with the
 * stated reason -- never a quiet pass, and never a guess.
 *
 * A row whose file no longer holds more than one `/self.?test/i` definition is
 * dead and should be deleted; the mechanical path then covers it.
 *
 * ## Two row spellings, and why the second one exists
 *
 *   'scripts/x.mjs': 'selfTest'                        the entry NAME alone.
 *   'scripts/x.mjs': { entry: 'selfTest', timeoutMs }  the name, plus what THIS
 *                                                      member needs from the
 *                                                      probe to reach a verdict.
 *
 * `timeoutMs` is a per-member BUDGET, measured and recorded with the reading it
 * came from -- never estimated, and never applied to a member nobody measured.
 * It is here rather than in `probeEarlyReturn`'s default because a budget that
 * one member needs is a cost every other member would pay: this ledger is the
 * one place that already says "this file, for this stated reason" (#15573).
 *
 * ⛔ It is a BUDGET, not a deadline the probe aims for: a run that finishes
 * sooner is not waited on, and a member that outgrows its recorded budget goes
 * back to NOT MEASURED rather than being quietly given more.
 */
export const ENTRY_BY_HAND = Object.freeze({
  'scripts/check-comment-mask-corpus.mjs': 'selfTest',
  'scripts/check-doc-authoring.mjs': 'selfTest',
  'scripts/check-durability-degradation-log-level.mjs': 'selfTest',
  'scripts/check-self-test-wired.mjs': 'selfTest',
  'scripts/check-self-test-workflow-commands.mjs': 'selfTest',
  'scripts/check-turbo-task-graph.mjs': 'runSelfTest',
  // Two self-test-shaped functions: `selfTest()` returns a failure list and
  // `runSelfTest()` is what the dispatch calls. Probing the inner one records a
  // TypeError as a handshake; probing `runSelfTest` reads the real one (#14842).
  'scripts/check-workspace-manifest-cycles.mjs': 'runSelfTest',
  // The dispatch calls SIX self-test functions and combines their statuses;
  // there is no single entry an early return leaves, so a one-function probe
  // measures a sub-battery and reads a downstream crash as a handshake.
  'scripts/check-platform-checklist.mjs': null,
  // The self-test is an inline top-level block calling several helpers.
  'scripts/check-regen-pending.mjs': null,
  // Four self-test-shaped definitions in this file -- `selfTest`,
  // `selfTestOnlyCallables`, `maskSelfTests`, `selfTestCaseLines` -- so the
  // entry is hand-read, and stays hand-read: they are all real, and reading
  // which one the DISPATCH calls is not something a count can do. (A fifth,
  // `fixtureSelfTest`, was collected here until #15574 from a name inside a
  // fixture array; `selfTestDefs` reads masked source now and it is gone. The
  // row is unaffected either way -- four names are as ambiguous as five.)
  //
  // The row was a `null` until #14963, on the claim that injecting here
  // can only produce a SyntaxError: the anchor read raw source, where a docblock
  // sentence and then a FIXTURE STRING stand ahead of the real definition. That
  // was the INSTRUMENT's limit recorded as this file's property. Anchored on the
  // definition the copy parses and runs (measured: exit 1, `selfTest() returned
  // without reaching its verdict`). It then read NOT MEASURED `baseline run
  // failed (exit 1)` for as long as the copy was written under `scripts/`, where
  // this gate's own single-site sweep found the near-duplicate and refused: the
  // copy now lands outside that tree and this gate's baseline is clean (#15515).
  // What was left was the BUDGET, and this row now carries it (#15573). At the
  // default 120 s the self-test does not finish, the baseline is killed and the
  // row reads `killed by SIGTERM` -- a limit of the INSTRUMENT recorded as a
  // property of the FILE for the third time on this one row.
  //
  // THE READING THE BUDGET COMES FROM, and it is one measurement, not a margin:
  //   `time node scripts/pm/dispatch-gates.mjs --self-test` -> real 6m39.690s,
  //   exit 0, `✓ dispatch-gates self-test: 1415 cases pass.` (cf6b67164, an
  //   installed worktree, one process at a time).
  //   Probed ONCE at 900 000 ms on a shared box: verdict HELD, baselineExit=0
  //   mutatedExit=1 mutatedBytes=200, head `✗ dispatch-gates self-test:
  //   selfTest() returned without reaching its verdict,`; 425 s wall clock.
  // 900 s is ~2.25x the measured wall clock, which is headroom for a SHARED box
  // rather than for growth: a self-test that outgrows this budget must come back
  // here and be measured again, not be topped up.
  'scripts/pm/dispatch-gates.mjs': { entry: 'selfTest', timeoutMs: 900_000 },
});

/**
 * One ledger row, in either spelling, read into the one shape the probe takes.
 *
 * A row is `null` (not probeable), an entry NAME, or a record carrying that name
 * and this member's options -- see the ledger's own docblock. The union is read
 * HERE and nowhere else: a caller that passed a record straight through as the
 * entry would ask for a definition named `[object Object]`, get `no injectable
 * definition of ...` back, and publish a NOT MEASURED whose stated reason is
 * false. The controls drive both spellings.
 */
export function readLedgerRow(row) {
  if (row === null || typeof row === 'string') return { entry: row, timeoutMs: undefined };
  return { entry: row.entry, timeoutMs: row.timeoutMs };
}

/**
 * What the probe should do with one census row: which definition to enter and
 * under what budget, or WHY there is nothing to enter.
 *
 * `{ why }` is the NOT MEASURED reason, verbatim as the row publishes it;
 * `{ entry, timeoutMs }` is a probe to run, `timeoutMs` undefined meaning "the
 * default budget". Lifted out of `main()` so the ledger's two spellings and the
 * mechanical fallback are decided by something the controls can drive: the
 * decision is where a wrong entry becomes a wrong REASON, and `main()` cannot be
 * called with a fixture ledger.
 */
export function probePlan(row, ledger = ENTRY_BY_HAND) {
  const listed = Object.hasOwn(ledger, row.file) ? readLedgerRow(ledger[row.file]) : null;
  if (listed !== null && listed.entry === null) {
    return { why: 'entry read by hand as not probeable -- see ENTRY_BY_HAND' };
  }
  const entry = listed?.entry ?? (row.defs.length === 1 ? row.defs[0] : undefined);
  if (entry === undefined) {
    return {
      why:
        row.defs.length === 0
          ? 'self-test is an inline top-level block; no callee to leave early'
          : `ambiguous entry (${row.defs.join(', ')}) and no ENTRY_BY_HAND row -- read the dispatch site`,
    };
  }
  return { entry, timeoutMs: listed?.timeoutMs };
}

/**
 * This file is not itself a member: the `--self-test` literals below live in
 * CONTROL FIXTURE strings, which are data, not a dispatch. It deliberately
 * ships no `--self-test` mode -- its controls run inline on every invocation,
 * so they cannot become unrun.
 */
const CENSUS_SELF = 'scripts/measure-self-test-floor.mjs';

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(mjs|mts|js|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every `scripts/**` file that DISPATCHES on `--self-test`, read from CODE. */
export function population() {
  const scripts = join(ROOT, 'scripts');
  if (!existsSync(scripts)) throw new Error('scripts/ does not resolve -- the census would report zero for the wrong reason');
  const rows = [];
  for (const abs of walk(scripts).sort()) {
    const src = readFileSync(abs, 'utf8');
    const code = maskComments(src);
    if (!DISPATCH.test(code)) continue;
    const file = abs.slice(ROOT.length + 1).split(sep).join('/');
    if (file === CENSUS_SELF) continue;
    rows.push({ file, abs, floor: classifyFloor(code), defs: selfTestDefs(src) });
  }
  if (rows.length === 0) throw new Error('the census found no self-test dispatch at all -- refusing rather than reporting zero');
  return rows;
}

function main() {
  const controlFailures = runControls();
  if (controlFailures.length > 0) {
    console.error('measure-self-test-floor: ITS OWN CONTROLS FAILED -- no census printed.\n');
    for (const f of controlFailures) console.error(`  - ${f}`);
    console.error('\nA survey whose instrument cannot see a known hole reports zero for the same reason');
    console.error('this measurement exists. Fix the instrument; a smaller number is not the fallback.\n');
    process.exit(1);
  }

  const rows = population();
  const wantProbe = process.argv.includes('--probe');
  if (wantProbe) {
    for (const r of rows) {
      const plan = probePlan(r);
      if (plan.entry === undefined) { r.probe = { verdict: 'NOT MEASURED', why: plan.why }; continue; }
      // `timeout: undefined` is the DEFAULT budget, not "no budget" -- the
      // destructured default in `probeEarlyReturn` is what supplies 120 s.
      r.probe = probeEarlyReturn(r.abs, plan.entry, { timeout: plan.timeoutMs });
    }
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows.map(({ abs, ...rest }) => rest), null, 2));
    return;
  }

  const byFloor = { ROSTER: [], COUNT: [], NONE: [] };
  for (const r of rows) byFloor[r.floor].push(r.file);
  console.log(`measure-self-test-floor: ${rows.length} file(s) under scripts/ dispatch on \`--self-test\`.\n`);
  console.log('Hole 1 -- no assertion floor (success decided by "no failure was recorded"):');
  console.log(`  ${byFloor.NONE.length} of ${rows.length}. Floored: ${byFloor.ROSTER.length} roster, ${byFloor.COUNT.length} count-candidate(s) to read.`);
  if (byFloor.ROSTER.length) console.log(`    roster: ${byFloor.ROSTER.join(', ')}`);
  if (byFloor.COUNT.length) console.log(`    count candidates: ${byFloor.COUNT.join(', ')}`);

  if (!wantProbe) {
    console.log('\nHole 2 -- no verdict handshake: NOT MEASURED (pass --probe; it runs every self-test twice).');
    return;
  }
  const defeated = rows.filter((r) => r.probe.verdict === 'DEFEATED');
  const held = rows.filter((r) => r.probe.verdict === 'HELD');
  const accidents = rows.filter((r) => r.probe.verdict === 'ACCIDENT');
  const unmeasured = rows.filter((r) => r.probe.verdict === 'NOT MEASURED');
  // The shrink this INSTRUMENT is responsible for, reported as a number rather
  // than left as a silence -- printed even when it is zero, because a zero that
  // is printed is a reading and a line that appears only when non-zero is not
  // (#15573).
  const timedOut = unmeasured.filter((r) => r.probe.timedOut === true);
  console.log('\nHole 2 -- silently defeated by an early `return` in the self-test (MEASURED):');
  console.log(`  ${defeated.length} DEFEATED, ${held.length} HELD, ${accidents.length} ACCIDENT, ${unmeasured.length} NOT MEASURED.`);
  console.log(`  of the defeated, ${defeated.filter((r) => r.probe.mutatedBytes === 0).length} printed NOTHING at all and still exited 0.`);
  console.log(`  of the NOT MEASURED, ${timedOut.length} outlasted the probe's own budget and was killed --`);
  console.log('   a shrink of this survey by a number THIS TOOL chose, not a property of those files.');
  for (const r of held) console.log(`    HELD  ${r.file} -- ${r.probe.mutatedHead.slice(0, 96)}`);
  for (const r of accidents) console.log(`    ACC   ${r.file} -- exited ${r.probe.mutatedExit} printing ${r.probe.mutatedBytes} byte(s); no refusal, so NOT a hold`);
  for (const r of unmeasured) console.log(`    n/m   ${r.file} -- ${r.probe.why}`);
  if (accidents.length) {
    console.log(`\n⚠ ACCIDENT is not a hold. Those ${accidents.length} file(s) exit non-zero because a comparison`);
    console.log('   against a missing return value happened to be false, not because anything noticed.');
  }
  console.log('\n⛔ The two numbers are ORTHOGONAL and are never summed: a gate with a perfect');
  console.log('   floor is still defeated by hole 2, because the floor never runs either.');
}

if (isEntrypoint(import.meta.url)) {
  main();
}
