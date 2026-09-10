#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Closing-keyword parser parity guard (#9755).
 *
 *   node scripts/check-closing-keyword-parity.mjs             # judge the shipped parsers
 *   node scripts/check-closing-keyword-parity.mjs --self-test # prove the battery can go red
 *   node scripts/check-closing-keyword-parity.mjs --list      # the registry
 *   node scripts/check-closing-keyword-parity.mjs --body FILE # what binds in ONE body ("-" reads stdin)
 *
 * ## The seam
 *
 * THREE places in this repository parse GitHub's closing-keyword grammar out of
 * user-authored markdown, and each one decides something a human would rather
 * not have decided wrongly:
 *
 *   - `.github/workflows/cross-repo-issue-closer.yml` decides whether an issue
 *     in ANOTHER repository gets closed;
 *   - `.github/workflows/duplicate-fix-guard.yml` decides whether a PR goes RED
 *     for claiming an issue another open PR already claimed;
 *   - `closingKeywordRe()` in `scripts/pm/check-half-states.mjs` (H7, the
 *     blocking gate behind `.github/workflows/partof-closing-keyword-guard.yml`)
 *     decides whether a `Part of #N` PR is about to close the card it is only
 *     part of.
 *
 * They are three spellings of one judgement, and they HAVE drifted. Measured on
 * 2026-08-20, `Fixes: objectstack-ai/objectui#456` matched the duplicate-fix
 * guard and did NOT match the cross-repo closer, so a merged PR written with the
 * colon took the closer's exit path 1 -- `No cross-repository closing keywords
 * in this PR body.` -- the same quiet green a body with no cross-repo reference
 * at all produces. The foreign issue stays open and nothing distinguishes the
 * run from the ~2300 that genuinely had nothing to do.
 *
 * ## Why a gate and not a shared module
 *
 * A shared module is the right shape and is NOT AVAILABLE here. Both parsers
 * that diverged live inside `actions/github-script` blocks, and neither workflow
 * checks this repository out: the closer deliberately never does (it runs on
 * `pull_request_target`, and its header makes the no-checkout posture an
 * invariant rather than an accident), and the duplicate-fix guard has no
 * checkout step at all -- its whole job is one github-script step. `require()`
 * of a repo file therefore resolves to nothing in either. Giving both a checkout
 * to share ten characters of regex would buy the import by spending the closer's
 * stated security posture, which is the worse trade.
 *
 * So the text stays spelled three times and this gate makes the JUDGEMENT one:
 * it extracts all three parsers from the shipped bytes and asserts they agree
 * BEHAVIOURALLY -- same keyword set, same separator -- rather than asserting the
 * three regexes are the same string, which they legitimately are not. The three
 * differ on purpose in REFERENCE SCOPE (qualified-only / same-repo / bare-only),
 * and those differences are asserted too, so that a widening of the separator
 * cannot quietly widen the scope with it.
 *
 * ## The body mode -- the same three parsers, one body
 *
 * `--body FILE` (or `-` for stdin) asks a different question of the SAME
 * parsers: not "do the three agree" but "which of them binds what in THIS
 * text". It is a pre-flight instrument for a PR body, runnable BEFORE the PR
 * exists -- otherwise the only enforcement that reads a body is the blocking
 * gate behind partof-closing-keyword-guard.yml, which fires after the body is
 * already written.
 *
 * It adds NO grammar. It calls `loadParsers()` and runs whatever that returns,
 * because a fourth spelling transcribed into a body checker is precisely the
 * defect the sweep below exists to catch. Nor does it collapse the answer: the
 * three differ on purpose in REFERENCE SCOPE, so a bare reference binding in
 * two of them and not the third IS the answer, per parser, not noise.
 *
 * The case it exists for is prose written to PREVENT a close that arms one.
 * A sentence of the shape `Merging this must not <verb> #N` binds in every
 * parser scoped to the bare form, because none of them reads negation -- and
 * neither does GitHub's own parser (the #10241 specimen below was closed out of
 * a sentence saying it was not). The safe spelling is zero verbs beside the
 * number. This mode makes that visible; it decides nothing and blocks nothing.
 *
 * Exit register -- three answers, deliberately distinct:
 *
 *   0  No registered parser binds anything in the body.
 *   2  At least one parser binds. NOT a failure: it is the report, and the
 *      caller decides. It is 2 and not 1 because 1 already means this gate
 *      could not do its job, and "your body declares a close" must never read
 *      as "the instrument broke".
 *   1  The instrument did not run: no path given, an unreadable file, or a
 *      parser that could not be extracted -- #4690 again, a harness that could
 *      not find its subject has verified nothing. Never a quiet zero-hit
 *      answer.
 *
 * ## What is asserted
 *
 *   1. EXTRACTION. Every registered parser is found in the shipped bytes. A
 *      parser that cannot be extracted is a FAILURE, never a skip (#4690): a
 *      harness that could not find its subject has verified nothing.
 *   2. KEYWORD PARITY. All nine of GitHub's keywords -- close/closes/closed,
 *      fix/fixes/fixed, resolve/resolves/resolved -- qualify in every parser.
 *   3. SEPARATOR PARITY. Every parser accepts BOTH measured spellings of the
 *      separator: `KEYWORD <ref>` and `KEYWORD: <ref>`.
 *   4. SCOPE INVARIANTS. Each parser still refuses what it is supposed to refuse
 *      -- including with the colon present, so widening the separator cannot
 *      widen the scope as a side effect.
 *   5. THE SWEEP. No FOURTH parser of this grammar exists unregistered. This
 *      card came out of a sweep for other consumers; a later one is exactly what
 *      a "fix these two" change would miss, so the sweep is mechanical now.
 *
 * ## The colon is measured, not inherited
 *
 * The duplicate-fix guard's comment asserted that the optional colon is part of
 * GitHub's accepted syntax. A comment is not evidence, and the whole direction
 * of the #9755 fix rested on it -- if GitHub did NOT accept the colon then the
 * GUARD was over-matching and the edit pointed the other way. It does accept it,
 * and the reference is in this repository:
 *
 *   PR #10241 merged 2026-08-20T15:10:06Z with the sentence
 *   `Filed, not fixed: #10240` in its body. Issue #10240 closed as `completed`
 *   at 15:10:08Z -- two seconds later -- and its `closed_by_pull_requests`
 *   names #10241 and nothing else.
 *
 * That specimen settles two things at once: the colon binds (GitHub parsed
 * `fixed: #10240` as a closing declaration), and the surrounding prose does not
 * (the sentence said the issue was NOT fixed and it was closed anyway, which is
 * the property partof-closing-keyword-guard.yml is built on).
 *
 * ## Deliberately NOT asserted
 *
 * The zero-space spelling `Fixes:#123`, on which the three parsers still
 * disagree (H7 accepts it; the two workflows require whitespace after the
 * colon), and the newline separator, which the workflows' `\s+` crosses and
 * H7's `[ \t]` deliberately does not. Neither is MEASURED against GitHub's real
 * parser, and this gate pins only what has been. Filed rather than guessed --
 * pinning an unmeasured spelling here would launder a guess into a contract.
 */

// dispatch-gates: whole-tree-population -- the sweep reads every tracked file (node_modules and dist aside) hunting the closing-keyword grammar, so a card adding prose or a workflow anywhere implicates it; the literals below are the parsers it grades.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireDependency } from './import-prerequisite.mjs';
const { parseDocument } = await requireDependency('yaml', () => import('yaml'), import.meta.url);
import { isEntrypoint } from './invoked-as.mjs';

const SELF = 'scripts/check-closing-keyword-parity.mjs';

/** GitHub's closing keywords, all nine. */
const KEYWORDS = ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved'];

/**
 * A reference of each kind, and which parsers are supposed to bind to it.
 *
 * `same-repo` names the guard's regex scope, not its final verdict: the regex
 * binds any `owner/repo#N` and the guard drops foreign owners in JS afterwards.
 * Scope here is a property of the REGEX, which is what can drift.
 */
const REFS = {
  bare: '#22',
  qualified: 'my-org/some.repo#22',
};

const SCOPES = {
  // The closer acts only on the qualified form; the bare form is GitHub's own
  // job and closing it here would comment on every merge.
  qualified: { binds: ['qualified'], refuses: ['bare'] },
  // The guard's regex takes both; ownership is filtered after the match.
  'same-repo': { binds: ['bare', 'qualified'], refuses: [] },
  // H7 asks only "is this card being closed", which is always same-repo bare.
  bare: { binds: ['bare'], refuses: ['qualified'] },
};

// ── The registry ─────────────────────────────────────────────────────────────

const PARSERS = [
  {
    id: 'cross-repo-issue-closer',
    file: '.github/workflows/cross-repo-issue-closer.yml',
    job: 'close-foreign-issues',
    kind: 'workflow',
    scope: 'qualified',
  },
  {
    id: 'duplicate-fix-guard',
    file: '.github/workflows/duplicate-fix-guard.yml',
    job: 'duplicate-fix-guard',
    kind: 'workflow',
    scope: 'same-repo',
  },
  {
    id: 'h7-partof-closing-keyword',
    file: 'scripts/pm/check-half-states.mjs',
    kind: 'module',
    scope: 'bare',
  },
];

/**
 * Files that carry the grammar's signature but are NOT parsers, with the reason.
 *
 * Kept as a named list rather than a pattern so that adding one is a decision
 * somebody wrote down. The sweep fails on anything here that no longer matches,
 * for the same reason a mutation with a dead anchor fails: an exemption for a
 * file that stopped matching is an exemption nobody is checking.
 */
const NON_PARSERS = [
  {
    file: 'scripts/check-cross-repo-closer-outcome.mjs',
    why: 'the closer\'s outcome harness -- it carries the keyword set as MUTATION ANCHORS (M5, M15), not as a parser of its own',
  },
  {
    file: SELF,
    why: 'this gate -- it carries the keyword set as its own MUTATION ANCHORS (X4) and as the specimen the sweep self-test plants',
  },
];

// ── Extraction ───────────────────────────────────────────────────────────────

export function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

/** The inline github-script body of a named job, or a problem string. */
function workflowScript(text, jobId, file) {
  const doc = parseDocument(text);
  const steps = doc.getIn(['jobs', jobId, 'steps'], true);
  if (!steps || typeof steps.items === 'undefined') {
    return { problem: `${file}: no job \`${jobId}\` with steps -- renamed? The parser cannot be located.` };
  }
  for (const step of steps.items) {
    const uses = String(step.getIn?.(['uses']) ?? '');
    if (!uses.startsWith('actions/github-script')) continue;
    const script = step.getIn?.(['with', 'script']);
    if (typeof script === 'string' && script.trim() !== '') return { source: script };
  }
  return { problem: `${file}: job \`${jobId}\` has no github-script step with a non-empty \`script:\`.` };
}

/**
 * Build the real RegExp a parser ships, from the shipped text.
 *
 * The workflow patterns are TEMPLATE LITERALS interpolating `KEYWORDS`, so the
 * literal is evaluated the way the script evaluates it rather than string-
 * matched: a `\\b` in the file is a `\b` in the pattern, and only evaluation
 * gets that right.
 */
function parserFrom(entry, text) {
  if (entry.kind === 'workflow') {
    const got = workflowScript(text, entry.job, entry.file);
    if (got.problem) return { problem: got.problem };
    const src = got.source;
    const kw = /const KEYWORDS = '([^']+)';/.exec(src);
    if (!kw) return { problem: `${entry.file}: no \`const KEYWORDS = '...';\` in the inline script.` };
    const tpl = /const pattern = new RegExp\(\s*(`(?:[^`\\]|\\.)*`)\s*,\s*'gi'\s*,?\s*\)/.exec(src);
    if (!tpl) return { problem: `${entry.file}: no \`const pattern = new RegExp(\`...\`, 'gi')\` in the inline script.` };
    let source;
    try {
      source = new Function('KEYWORDS', `return ${tpl[1]};`)(kw[1]);
    } catch (err) {
      return { problem: `${entry.file}: the pattern template did not evaluate -- ${err.message}` };
    }
    return { keywords: kw[1].split('|'), source, make: () => new RegExp(source, 'gi') };
  }

  const lit = /function closingKeywordRe\(\)\s*\{[\s\S]*?return\s+(\/(?:[^/\\\n]|\\.)*\/[gimsuy]*)\s*;/.exec(text);
  if (!lit) return { problem: `${entry.file}: no \`function closingKeywordRe()\` returning a regex literal.` };
  let re;
  try {
    re = new Function(`return ${lit[1]};`)();
  } catch (err) {
    return { problem: `${entry.file}: the regex literal did not evaluate -- ${err.message}` };
  }
  return { keywords: null, source: re.source, make: () => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`) };
}

export function loadParsers(root, overrides = {}) {
  return PARSERS.map((entry) => {
    const text = overrides[entry.file] ?? readFileSync(join(root, entry.file), 'utf8');
    return { ...entry, ...parserFrom(entry, text) };
  });
}

// ── The sweep ────────────────────────────────────────────────────────────────

/** The two shapes this grammar is spelled in across the repo. */
const SIGNATURES = [
  /close\|closes\|closed\|fix\|fixes\|fixed\|resolve\|resolves\|resolved/,
  /clos\(\?:e\|es\|ed\)|resolv\(\?:e\|es\|ed\)|fix\(\?:es\|ed\)\?/,
];

export function sweep(root, extraFiles = {}) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean)
    .filter((f) => !/(^|\/)(node_modules|dist)\//.test(f));

  const hits = [];
  for (const f of tracked) {
    let text = extraFiles[f];
    if (text === undefined) {
      try {
        if (statSync(join(root, f)).size > 2 * 1024 * 1024) continue;
        text = readFileSync(join(root, f), 'utf8');
      } catch {
        continue;
      }
    }
    if (SIGNATURES.some((re) => re.test(text))) hits.push(f);
  }
  for (const [f, text] of Object.entries(extraFiles)) {
    if (!hits.includes(f) && SIGNATURES.some((re) => re.test(text))) hits.push(f);
  }
  return { scanned: tracked.length, hits };
}

// ── Judgement ────────────────────────────────────────────────────────────────

const matches = (parser, body) => [...body.matchAll(parser.make())].length > 0;

export function judge(parsers, swept) {
  const failures = [];
  const fail = (id, message) => failures.push({ id, message });

  for (const p of parsers) {
    // 1. Extraction.
    if (p.problem) {
      fail(p.id, p.problem);
      continue;
    }

    const scope = SCOPES[p.scope];
    const binds = scope.binds.map((k) => REFS[k]);
    const refuses = scope.refuses.map((k) => REFS[k]);

    for (const kw of KEYWORDS) {
      for (const ref of binds) {
        // 2 + 3. Every keyword, both measured separators.
        if (!matches(p, `${kw} ${ref}`)) fail(p.id, `does not accept the plain spelling \`${kw} ${ref}\``);
        if (!matches(p, `${kw}: ${ref}`)) {
          fail(p.id, `does not accept the OPTIONAL-COLON spelling \`${kw}: ${ref}\` -- GitHub does (PR #10241 closed #10240 through it), so the parsers must agree on it`);
        }
      }
      // 4. Scope invariants, asserted with the colon present as well as without,
      //    so a widened separator cannot widen the reference scope with it.
      for (const ref of refuses) {
        if (matches(p, `${kw} ${ref}`)) fail(p.id, `binds \`${kw} ${ref}\`, which is outside its declared \`${p.scope}\` scope`);
        if (matches(p, `${kw}: ${ref}`)) fail(p.id, `binds \`${kw}: ${ref}\` -- the colon widened its \`${p.scope}\` reference scope, not just the separator`);
      }
    }

    // 4b. Shared refusals. `closing`/`fixing` are NOT closing keywords and both
    //     occur constantly in exactly the prose these parsers read; `Part of` is
    //     a reference and not a close.
    for (const ref of binds) {
      for (const near of ['closing', 'fixing', 'Part of']) {
        if (matches(p, `${near} ${ref}`)) fail(p.id, `treats \`${near} ${ref}\` as a closing declaration`);
      }
    }
  }

  // 5. The sweep.
  const registered = new Set([...PARSERS.map((p) => p.file), ...NON_PARSERS.map((n) => n.file)]);
  for (const f of swept.hits) {
    if (!registered.has(f)) {
      fail('sweep', `${f} parses the closing-keyword grammar and is not in ${SELF}'s registry. A fourth parser is the finding this gate exists to surface: register it (and give it a scope), or explain it in NON_PARSERS.`);
    }
  }
  for (const f of registered) {
    if (!swept.hits.includes(f)) {
      fail('sweep', `${f} is registered as carrying the closing-keyword grammar but no longer matches the sweep. Stale registry entries verify nothing -- remove it, or fix the signature.`);
    }
  }

  return failures;
}

/**
 * Every hit the registered parsers bind in ONE body, in registry order.
 *
 * The answer stays per parser and is never collapsed: the three differ on
 * purpose in REFERENCE SCOPE, so WHICH one binds is the whole point -- a bare
 * reference is invisible to the cross-repo closer and decisive to H7, and an
 * author needs to know which of those two facts they are looking at.
 *
 * Parsers carrying a `problem` are skipped here and reported by the caller: an
 * extraction failure is exit 1, never a zero-hit answer (#4690).
 */
export function judgeBody(parsers, body) {
  const hits = [];
  for (const p of parsers) {
    if (p.problem) continue;
    for (const m of body.matchAll(p.make())) hits.push({ id: p.id, scope: p.scope, text: m[0] });
  }
  return hits;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function list() {
  for (const p of PARSERS) console.log(`${p.id.padEnd(28)} ${p.scope.padEnd(11)} ${p.file}`);
  for (const n of NON_PARSERS) console.log(`${'(not a parser)'.padEnd(28)} ${''.padEnd(11)} ${n.file}`);
  console.log(`\n${PARSERS.length} parsers + ${NON_PARSERS.length} known non-parser(s)`);
}

/** `--body <FILE|->`: run the loaded parsers over one body. See the header. */
function bodyMode(pathOrDash) {
  if (!pathOrDash) {
    console.error(`usage: node ${SELF} --body <FILE>   ("-" reads the body from stdin)`);
    console.error('No body was read, so nothing was verified.');
    return 1;
  }
  const where = pathOrDash === '-' ? 'stdin' : pathOrDash;
  let body;
  try {
    body = readFileSync(pathOrDash === '-' ? 0 : pathOrDash, 'utf8');
  } catch (err) {
    console.error(`check-closing-keyword-parity --body: cannot read ${where} -- ${err.message}`);
    return 1;
  }

  const parsers = loadParsers(repoRoot());
  const hits = judgeBody(parsers, body);
  for (const h of hits) console.log(`${h.id.padEnd(28)} ${`(${h.scope})`.padEnd(13)} ${h.text}`);

  const broken = parsers.filter((p) => p.problem);
  if (broken.length > 0) {
    console.error(`\ncheck-closing-keyword-parity --body: ${broken.length} of ${parsers.length} parser(s) could not be extracted, so ${where} was NOT fully read:\n`);
    for (const p of broken) console.error(`  • [${p.id}] ${p.problem}`);
    console.error(`\nRegistry: node ${SELF} --list`);
    return 1;
  }

  if (hits.length === 0) {
    console.log(`check-closing-keyword-parity --body: OK (no registered parser binds a closing declaration in ${where}; ${parsers.length} parsers consulted).`);
    return 0;
  }
  const ids = new Set(hits.map((h) => h.id));
  console.log(
    `\ncheck-closing-keyword-parity --body: ${hits.length} closing declaration(s) in ${where}, `
    + `bound by ${ids.size} of ${parsers.length} registered parser(s). Merging a PR with this body acts on them; `
    + 'the safe spelling for a reference you do NOT want acted on is zero verbs beside the number.',
  );
  return 2;
}

function run() {
  const root = repoRoot();
  const parsers = loadParsers(root);
  const swept = sweep(root);
  const failures = judge(parsers, swept);

  if (failures.length === 0) {
    const assertions = parsers.filter((p) => !p.problem).length;
    console.log(
      `check-closing-keyword-parity: OK (${assertions} parsers agree on all ${KEYWORDS.length} keywords and both measured separators; `
      + `sweep found ${swept.hits.length} file(s) carrying the grammar across ${swept.scanned} tracked file(s), all registered).`,
    );
    return 0;
  }

  console.error(`check-closing-keyword-parity: ${failures.length} failure(s)\n`);
  for (const f of failures) console.error(`  • [${f.id}] ${f.message}`);
  console.error(`\nRegistry: node ${SELF} --list`);
  return 1;
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// Each mutation states the anchor it needs. An anchor that is absent is a
// FAILURE, not a skip: the substitution would be a no-op and the battery would
// report a detector it never exercised.

const MUTATIONS = [
  {
    id: 'X1',
    what: 'the cross-repo closer drops the optional colon again (the #9755 defect, restored)',
    file: '.github/workflows/cross-repo-issue-closer.yml',
    from: '}):?\\\\s+([\\\\w.-]+)',
    to: '})\\\\s+([\\\\w.-]+)',
    expect: 'cross-repo-issue-closer',
  },
  {
    id: 'X2',
    what: 'the duplicate-fix guard drops the optional colon',
    file: '.github/workflows/duplicate-fix-guard.yml',
    from: '}):?\\\\s+(?:',
    to: '})\\\\s+(?:',
    expect: 'duplicate-fix-guard',
  },
  {
    id: 'X3',
    what: 'H7 drops the optional colon',
    file: 'scripts/pm/check-half-states.mjs',
    from: '\\b[ \\t]*:?[ \\t]*#(\\d+)\\b',
    to: '\\b[ \\t]*#(\\d+)\\b',
    expect: 'h7-partof-closing-keyword',
  },
  {
    id: 'X4',
    what: 'the closer narrows its keyword set, so `fixes` and `resolved` stop qualifying',
    file: '.github/workflows/cross-repo-issue-closer.yml',
    from: "const KEYWORDS = 'close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved';",
    to: "const KEYWORDS = 'close';",
    expect: 'cross-repo-issue-closer',
  },
  {
    id: 'X5',
    what: 'the closer widens to the bare form, so it would close what GitHub already closes',
    file: '.github/workflows/cross-repo-issue-closer.yml',
    from: ':?\\\\s+([\\\\w.-]+)\\\\/([\\\\w.-]+)#',
    to: ':?\\\\s+(?:([\\\\w.-]+)\\\\/([\\\\w.-]+))?#',
    expect: 'cross-repo-issue-closer',
  },
];

// Set by `selfTest()` only after a verdict is printed -- either verdict -- and
// read at the dispatch below: a `return` that leaves the function above those
// lines prints nothing and still exits 0, so a self-test that never finished
// reports as one that passed. The self-test's own exit code stays load-bearing,
// so the handshake is a flag rather than a returned sentinel. The failure path
// sets it too: the refusal below must fire only when NEITHER verdict was
// printed, never on a genuine red that already said what failed.
let selfTestReachedVerdict = false;

function selfTest() {
  const root = repoRoot();
  const failures = [];
  let checked = 0;
  const assert = (cond, msg) => {
    checked++;
    if (!cond) failures.push(msg);
  };

  // 1. Clean must be green, or every red below proves nothing.
  const cleanSweep = sweep(root);
  assert(
    judge(loadParsers(root), cleanSweep).length === 0,
    `the shipped parsers are green before any mutation, got: ${judge(loadParsers(root), cleanSweep).map((f) => `[${f.id}] ${f.message}`).join(' | ')}`,
  );

  // 2. Every mutation must be REACHED and must turn the battery red, on the
  //    parser it names.
  for (const m of MUTATIONS) {
    const text = readFileSync(join(root, m.file), 'utf8');
    assert(text.includes(m.from), `${m.id}: its anchor is present in ${m.file} (a no-op mutation proves nothing)`);
    if (!text.includes(m.from)) continue;
    const mutated = text.replace(m.from, m.to);
    assert(mutated !== text, `${m.id}: the substitution changed ${m.file}`);
    const reds = judge(loadParsers(root, { [m.file]: mutated }), cleanSweep);
    assert(reds.length > 0, `${m.id}: turns the battery RED (${m.what})`);
    assert(
      reds.some((f) => f.id === m.expect),
      `${m.id}: the red names \`${m.expect}\`, got: ${reds.map((f) => f.id).join(', ') || 'nothing'}`,
    );
  }

  // 3. The sweep must catch a FOURTH parser that nobody registered.
  const planted = { 'packages/somewhere/src/invented-parser.ts': "const KEYWORDS = 'close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved';" };
  const plantedSweep = sweep(root, planted);
  const plantedReds = judge(loadParsers(root), plantedSweep);
  assert(
    plantedReds.some((f) => f.id === 'sweep' && f.message.includes('invented-parser')),
    'X6: an unregistered fourth parser is caught by the sweep',
  );
  checked++;

  // 4. A registry entry that stops matching must fail too -- a stale exemption
  //    verifies nothing.
  const stale = judge(loadParsers(root), { scanned: plantedSweep.scanned, hits: plantedSweep.hits.filter((f) => f !== NON_PARSERS[0].file) });
  assert(
    stale.some((f) => f.id === 'sweep' && f.message.includes('no longer matches the sweep')),
    'X7: a registered file that stopped carrying the grammar is caught',
  );

  // 5. The BODY MODE, on the fixtures sections 2-4 already grade. The
  //    references come from `REFS` and the refusals from `SCOPES`, so a case
  //    here cannot drift away from what this file asserts about the same three
  //    parsers -- and each expectation is the parser SET, because the per-parser
  //    scope split is the answer the mode exists to show.
  const loaded = loadParsers(root);
  const bound = (text) => [...new Set(judgeBody(loaded, text).map((h) => h.id))].sort().join(',');

  //    The negation trap, the case the mode exists for: prose written to PREVENT
  //    a close still binds, in every parser scoped to the bare form.
  const negation = `Merging this must not close ${REFS.bare}`;
  assert(
    bound(negation) === 'duplicate-fix-guard,h7-partof-closing-keyword',
    `X8: the negation body binds in both bare-scoped parsers and not the qualified one, got: ${bound(negation) || 'nothing'}`,
  );
  //    `Part of` is a reference, not a close -- 4b above asserts the same thing
  //    about the same string, from the parser side.
  assert(bound(`Part of ${REFS.bare}`) === '', `X9: a \`Part of\` body binds nothing, got: ${bound(`Part of ${REFS.bare}`)}`);
  //    The colon spelling, on the qualified reference: the two parsers that take
  //    a qualified ref bind it, H7 does not.
  const colon = `${KEYWORDS[4]}: ${REFS.qualified}`;
  assert(
    bound(colon) === 'cross-repo-issue-closer,duplicate-fix-guard',
    `X10: the colon spelling on a qualified ref binds in the two qualified-capable parsers, got: ${bound(colon) || 'nothing'}`,
  );

  // 6. The mode END TO END -- argv switch, input read, exit register. The
  //    assertions above drive `judgeBody` directly and would stay green if
  //    `bodyMode` handed it the wrong text (an empty string, say), so this leg
  //    runs a real process over a real input and grades the exit code. Both
  //    input spellings and both non-error exits are covered.
  const dir = mkdtempSync(join(tmpdir(), 'closing-keyword-body-'));
  try {
    const drive = (args, input) => {
      try {
        return { status: 0, out: execFileSync(process.execPath, [join(root, SELF), ...args], { cwd: root, encoding: 'utf8', input: input ?? '', stdio: ['pipe', 'pipe', 'pipe'] }) };
      } catch (err) {
        return { status: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
      }
    };

    const file = join(dir, 'negation.md');
    writeFileSync(file, negation);
    const hit = drive(['--body', file]);
    assert(hit.status === 2, `X11: \`--body FILE\` exits 2 on the negation body, got ${hit.status}`);
    assert(hit.out.includes('h7-partof-closing-keyword'), `X11: the exit-2 report names the parser that binds, got: ${hit.out.trim() || 'nothing'}`);

    const clean = drive(['--body', '-'], `Part of ${REFS.bare}`);
    assert(clean.status === 0, `X12: \`--body -\` exits 0 on a body that declares no close, got ${clean.status}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log(`✓ check-closing-keyword-parity --self-test: ${checked} assertions, ${MUTATIONS.length} mutations of the shipped parsers each driven to red.`);
    selfTestReachedVerdict = true;
    return 0;
  }
  console.error(`✗ check-closing-keyword-parity --self-test -- ${failures.length} failure(s)\n`);
  for (const f of failures) console.error(`  • ${f}`);
  selfTestReachedVerdict = true;
  return 1;
}

if (isEntrypoint(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === '--list') list();
  else if (arg === '--body') process.exit(bodyMode(process.argv[3]));
  else if (arg === '--self-test') {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-closing-keyword-parity self-test: selfTest() returned without reaching its verdict,\n'
        + 'so no success line was printed. Exiting 0 here would report a self-test\n'
        + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  } else process.exit(run());
}
