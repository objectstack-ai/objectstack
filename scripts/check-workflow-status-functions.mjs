#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-workflow-status-functions -- a JOB-LEVEL `if:` that reads
// `needs.<job>.outputs.<key>` must name a status function.
//
//   node scripts/check-workflow-status-functions.mjs
//   node scripts/check-workflow-status-functions.mjs --self-test  # the checker itself
//   node scripts/check-workflow-status-functions.mjs --list       # the full audit table
//
// ## The rule (#5343, distilled from #4900 and #4928)
//
// Any job-level `if:` that reads `needs.SOMEJOB.outputs.SOMEKEY` must name one
// of `always()`, `!cancelled()`, `success()` or `failure()`.
//
// GitHub wraps every `if:` that contains no status function in an IMPLICIT
// `success()`. So a condition written to read an upstream job's OUTPUT VALUE --
// a data-driven decision -- silently also carries a status decision the author
// never wrote. The two completely different facts
//
//     the upstream job DIED                (status)
//     the upstream job said "do not run"   (data)
//
// are then compressed into the same `skipped`, and a skipped job reads as green
// in every checks list. That is how #4900 shipped a release-integrity guard that
// stopped guarding whenever the job before it failed, and how #4928 found seven
// `needs.filter.outputs.*` gates in ci.yml that turned themselves off exactly
// when something upstream broke.
//
// Wanting `success()` semantics is perfectly legitimate -- pack-smoke in
// publish-smoke.yml genuinely wants them. The rule is that you WRITE IT:
// `success() && needs.x.outputs.y == 'true'`. Declared beats remembered; the
// next reader must not have to carry GitHub's implicit wrapper in their head.
//
// ## Scope, and why it is drawn here
//
// JOB level only, and only `needs.*.outputs.*`. Both halves are deliberate.
//
//   - A STEP-level `if:` reading `steps.*.outputs.*` is out. There the implicit
//     `success()` means "an earlier step of THIS job failed, so stop", which is
//     almost always exactly what the author wants. Scanning those would produce
//     a batch of false positives on day one, and a gate born with a long
//     exemption list is one step from the #4690 anti-pattern it exists to
//     prevent.
//   - A STEP-level `if:` reading `needs.*.outputs.*` is out for the same reason:
//     the implicit `success()` there is still about the steps of its own job,
//     and the job it sits in already had to pass this rule at job level.
//     publish-smoke.yml's two `needs.resolve.outputs.report-sha` steps are the
//     live specimens -- both correct, neither this gate's business.
//   - `needs.*.result` / `needs.*.conclusion` are out. Those ARE status reads;
//     an author writing one is already reasoning about upstream status rather
//     than being handed a wrapper they did not write. This gate is about the
//     silent compression of status into data, not about status expressions.
//
// The scope is what makes the rule statically decidable with no intent-guessing
// and no exemption hatch. There is intentionally NO skip-list: if a job-level
// `if:` ever genuinely needs one, that is a decision to take in the open.
//
// ## Missing input is a failure, never a pass (#4690)
//
// `.github/workflows/` absent, zero workflow files, a file that does not parse,
// a workflow with no `jobs:` map, an `if:` that is not a scalar -- every one of
// them exits non-zero. A checker that cannot read its input has not verified
// anything, and reporting OK for that is the exact defect #4690 recorded: a gate
// that skipped silently and exited 0 read as "no violations" for months.
//
// This is also why the parse is a real YAML parse rather than a grep over `if:`
// lines. A grep cannot tell a malformed workflow from a clean one -- it just
// finds nothing, which is indistinguishable from "no violations" -- and it
// cannot see a folded expression at all. Two workflows in this repo already
// write `if: >-` across several lines (merge-queue-triage.yml, pr-automation.yml);
// the hand-run grep audit in #5343 could not have seen a violation there.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LineCounter, isMap, isScalar, parseDocument } from 'yaml';
import { isEntrypoint } from './invoked-as.mjs';

const WORKFLOW_DIR = '.github/workflows';

/**
 * Reads an upstream job's OUTPUT value: `needs.<job>.outputs.<key>` in either
 * the dot or the index spelling, with GitHub's tolerated whitespace.
 * Deliberately stops at `outputs` + accessor, so `needs.build.result` and a bare
 * `toJSON(needs)` do not match -- see the scope note in the header.
 */
const READS_NEEDS_OUTPUTS = /\bneeds\s*(?:\.\s*[A-Za-z_][A-Za-z0-9_-]*|\[[^\]]*\])\s*\.\s*outputs\s*(?:\.|\[)/i;

/** GitHub's four status check functions. Case-insensitive, as the expression language is. */
const NAMES_STATUS_FUNCTION = /\b(?:always|cancelled|success|failure)\s*\(\s*\)/i;

/** The four status functions, for the failure prescription. */
const STATUS_FUNCTIONS = ['success()', '!cancelled()', 'always()', 'failure()'];

// ── Scanning ────────────────────────────────────────────────────────────────

/**
 * Every job-level `if:` in the workflow directory, judged.
 *
 * @param {string} root repository root (or, in --self-test, a fixture root)
 * @returns {{
 *   violations: { file: string, line: number, job: string, expression: string }[],
 *   compliant: { file: string, line: number, job: string, expression: string }[],
 *   problems: string[],
 *   files: number,
 *   jobs: number,
 *   jobIfs: number,
 * }}
 */
export function scan(root) {
  const violations = [];
  const compliant = [];
  const problems = [];
  let jobs = 0;
  let jobIfs = 0;

  const dir = join(root, WORKFLOW_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    problems.push(`${WORKFLOW_DIR}/ does not exist -- nothing was scanned, so nothing was verified.`);
    return { violations, compliant, problems, files: 0, jobs, jobIfs };
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
  if (files.length === 0) {
    problems.push(`${WORKFLOW_DIR}/ holds no .yml/.yaml file -- nothing was scanned, so nothing was verified.`);
    return { violations, compliant, problems, files: 0, jobs, jobIfs };
  }

  for (const name of files) {
    const rel = `${WORKFLOW_DIR}/${name}`;
    const source = readFileSync(join(dir, name), 'utf8');
    const lineCounter = new LineCounter();
    let doc;
    try {
      doc = parseDocument(source, { lineCounter });
    } catch (err) {
      problems.push(`${rel}: YAML parse threw -- ${err.message}`);
      continue;
    }
    if (doc.errors.length > 0) {
      problems.push(`${rel}: YAML parse error -- ${doc.errors[0].message}`);
      continue;
    }

    const jobsNode = doc.get('jobs');
    if (!isMap(jobsNode)) {
      problems.push(`${rel}: no \`jobs:\` mapping -- a workflow this gate cannot read is a workflow it cannot clear.`);
      continue;
    }

    for (const pair of jobsNode.items) {
      const job = String(pair.key?.value ?? pair.key);
      jobs++;
      const body = pair.value;
      if (!isMap(body)) {
        problems.push(`${rel}: job \`${job}\` is not a mapping -- cannot read its \`if:\`.`);
        continue;
      }
      const ifPair = body.items.find((p) => String(p.key?.value) === 'if');
      if (!ifPair) continue;

      const line = lineCounter.linePos(ifPair.key.range[0]).line;
      if (!isScalar(ifPair.value) || ifPair.value.value === null || ifPair.value.value === undefined) {
        problems.push(`${rel}:${line}: job \`${job}\` has an \`if:\` that is not a scalar expression.`);
        continue;
      }
      jobIfs++;

      const expression = String(ifPair.value.value).replace(/\s+/g, ' ').trim();
      if (!READS_NEEDS_OUTPUTS.test(expression)) continue;

      const entry = { file: rel, line, job, expression };
      if (NAMES_STATUS_FUNCTION.test(expression)) compliant.push(entry);
      else violations.push(entry);
    }
  }

  return { violations, compliant, problems, files: files.length, jobs, jobIfs };
}

// ── Reporting ───────────────────────────────────────────────────────────────

/** GitHub workflow-command escaping for a message body. */
function escapeData(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** GitHub workflow-command escaping for an annotation property value. */
function escapeProperty(value) {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function annotate({ file, line, job, expression }) {
  const message = escapeData(
    `Job \`${job}\` reads needs.*.outputs.* in its job-level if: without naming a status function, ` +
      `so GitHub wraps it in an implicit success() and an upstream FAILURE becomes indistinguishable ` +
      `from an upstream "do not run". Write the status function you mean, e.g. \`success() && ${expression}\`.`,
  );
  const title = escapeProperty('Job-level if: reads needs.*.outputs.* without a status function');
  return `::error file=${escapeProperty(file)},line=${line},title=${title}::${message}`;
}

const PRESCRIPTION = `
Pick the status function you actually mean and write it:

${STATUS_FUNCTIONS.map((fn) => `    if: \${{ ${fn} && <your expression> }}`).join('\n')}

  • success()     keeps today's behaviour, written down instead of implied.
  • !cancelled()  runs unless the whole run was cancelled -- the #4928 shape for
                  a filter job whose outputs default to "run it" (\`|| 'true'\`).
  • always()      runs even when the run is being cancelled.
  • failure()     runs only on upstream failure (a guard/reporter job).

!cancelled() is NOT automatically the right answer. It is only correct when the
upstream outputs still carry a usable value after a failure. publish-smoke.yml's
resolve job is the counter-example #5343 worked through: its \`run\` output has no
\`|| 'true'\` default AND it also computes the \`ref\` to check out, so "when in
doubt run everything" would start a 45-minute job against an empty ref -- smoking
the wrong thing, then reporting green about it. That workflow instead states the
failure explicitly (a guard job that goes red), which is the third option this
rule exists to make visible.

Scope: job-level \`if:\` only, and only \`needs.*.outputs.*\`. Step-level \`if:\` and
\`needs.*.result\` are deliberately out -- see the header of
scripts/check-workflow-status-functions.mjs.`;

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function summarise({ files, jobs, jobIfs, compliant, violations }) {
  const reads = compliant.length + violations.length;
  return `scanned ${files} workflow file(s), ${jobs} job(s), ${jobIfs} job-level if: expression(s); ${reads} read needs.*.outputs.*`;
}

function reportProblems(problems) {
  console.error(`check-workflow-status-functions: ${problems.length} input problem(s) -- the scan is NOT a pass\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error(`
A gate that could not read its input has verified nothing. Reporting OK here is
the #4690 anti-pattern (a check that silently skipped and exited 0), so this
exits non-zero instead. Fix the input, or fix the checker -- never both quietly.`);
}

function main() {
  const result = scan(repoRoot());
  const { violations, problems } = result;

  if (problems.length > 0) {
    reportProblems(problems);
    process.exit(1);
  }

  if (violations.length === 0) {
    console.log(`check-workflow-status-functions: OK (${summarise(result)}, all naming a status function).`);
    process.exit(0);
  }

  const plural = violations.length === 1 ? 'job-level if:' : 'job-level if: expressions';
  console.error(
    `check-workflow-status-functions: ${violations.length} ${plural} read needs.*.outputs.* without naming a status function\n`,
  );
  for (const v of violations) {
    console.error(`  • ${v.file}:${v.line}  job \`${v.job}\``);
    console.error(`      if: ${v.expression}`);
    console.log(annotate(v));
  }
  console.error(PRESCRIPTION);
  process.exit(1);
}

function list() {
  const result = scan(repoRoot());
  if (result.problems.length > 0) {
    reportProblems(result.problems);
    process.exit(1);
  }
  const rows = [...result.violations.map((e) => ({ ...e, verdict: 'VIOLATION' })), ...result.compliant.map((e) => ({ ...e, verdict: 'ok' }))].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  );
  for (const r of rows) console.log(`${r.verdict.padEnd(9)} ${r.file}:${r.line}  ${r.job}\n              if: ${r.expression}`);
  console.log(`\n${summarise(result)}`);
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// Fixture workflows in a temp dir, run through the SAME scan() main() calls --
// the check-nul-bytes.mjs convention. scan() reads the directory rather than the
// git index, so a temp dir (no `git init`) is the faithful analogue of that
// script's temp repo: it exercises the real discovery path, not an imitation.

function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (cond, msg) => {
    checked++;
    if (!cond) failures.push(msg);
  };

  const roots = [];
  const makeRoot = (files) => {
    const dir = mkdtempSync(join(tmpdir(), 'check-workflow-status-fn-'));
    roots.push(dir);
    for (const [rel, contents] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
    return dir;
  };

  try {
    // ── 1. A violating sample must go red ────────────────────────────────────
    //
    // Verbatim shape of publish-smoke.yml:98 as #5343 found it.
    const violating = makeRoot({
      '.github/workflows/publish-smoke.yml': `name: Publish Smoke
on:
  workflow_run:
    workflows: [Release]
    types: [completed]
jobs:
  resolve:
    runs-on: ubuntu-latest
    outputs:
      run: \${{ steps.target.outputs.run }}
    steps:
      - id: target
        run: echo "run=true" >> "$GITHUB_OUTPUT"
  pack-smoke:
    needs: resolve
    if: needs.resolve.outputs.run == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo smoke
`,
    });
    const red = scan(violating);
    assert(red.problems.length === 0, `a well-formed fixture reports no input problems, got ${red.problems[0]}`);
    assert(red.violations.length === 1, `the violating sample is flagged once, got ${red.violations.length}`);
    assert(red.violations[0]?.job === 'pack-smoke', `the violating JOB is named, got ${red.violations[0]?.job}`);
    assert(red.violations[0]?.line === 16, `the reported line points at the if:, got ${red.violations[0]?.line}`);
    assert(
      red.violations[0]?.file === '.github/workflows/publish-smoke.yml',
      `the file is reported repo-relative, got ${red.violations[0]?.file}`,
    );
    // The annotation is the acceptance criterion's own wording -- pin its shape.
    const line = annotate(red.violations[0]);
    assert(
      line.startsWith('::error file=.github/workflows/publish-smoke.yml,line=16,title='),
      `the annotation carries file= and line=, got ${line.slice(0, 80)}`,
    );
    assert(!/[\r\n]/.test(line.slice(2)), 'the annotation is a single line (raw newlines are escaped)');

    // ── 2. Compliant samples must stay green ─────────────────────────────────
    //
    // All four status functions, the #4928 shape, and the negated form -- a rule
    // that only recognised `success()` would pass this fixture for the wrong
    // reason, so each spelling is asserted separately below.
    const green = makeRoot({
      '.github/workflows/ci.yml': `name: CI
on: [push]
jobs:
  filter:
    runs-on: ubuntu-latest
    outputs:
      core: \${{ steps.f.outputs.core || 'true' }}
    steps:
      - id: f
        run: echo "core=true" >> "$GITHUB_OUTPUT"
  build:
    needs: filter
    if: \${{ !cancelled() && needs.filter.outputs.core != 'false' }}
    runs-on: ubuntu-latest
    steps:
      - run: echo build
  pack:
    needs: filter
    if: success() && needs.filter.outputs.core == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo pack
  report:
    needs: filter
    if: always() && needs.filter.outputs.core == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo report
  oncall:
    needs: filter
    if: failure() && needs.filter.outputs.core == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo page
`,
    });
    const ok = scan(green);
    assert(ok.problems.length === 0, `the compliant fixture reports no input problems, got ${ok.problems[0]}`);
    assert(ok.violations.length === 0, `the compliant sample is green, got ${ok.violations.length} violation(s)`);
    assert(ok.compliant.length === 4, `all four status-function spellings are recognised, got ${ok.compliant.length}`);
    for (const fn of ['!cancelled()', 'success()', 'always()', 'failure()']) {
      assert(
        ok.compliant.some((c) => c.expression.includes(fn)),
        `${fn} is recognised as naming a status function`,
      );
    }

    // ── 3. Missing input must go red, in all four shapes (#4690) ─────────────
    const noDir = makeRoot({ 'README.md': '# no workflows here\n' });
    const missing = scan(noDir);
    assert(missing.problems.length === 1, `a missing ${WORKFLOW_DIR}/ is an input problem, got ${missing.problems.length}`);
    assert(missing.files === 0 && missing.violations.length === 0, 'a missing directory scans nothing (and says so)');

    const emptyDir = makeRoot({ '.github/workflows/.gitkeep': '' });
    const empty = scan(emptyDir);
    assert(empty.problems.length === 1, `an empty ${WORKFLOW_DIR}/ is an input problem, got ${empty.problems.length}`);

    const malformed = makeRoot({
      '.github/workflows/broken.yml': 'name: Broken\non: [push]\njobs:\n  a:\n   - this is not\n  a mapping: [\n',
    });
    const parseFail = scan(malformed);
    assert(parseFail.problems.length >= 1, 'a YAML parse failure is an input problem, not a pass');
    assert(
      parseFail.problems[0].includes('broken.yml'),
      `the unparseable file is named, got ${parseFail.problems[0]}`,
    );

    const jobless = makeRoot({ '.github/workflows/jobless.yml': 'name: Jobless\non: [push]\n' });
    const noJobs = scan(jobless);
    assert(noJobs.problems.length === 1, 'a workflow with no jobs: mapping is an input problem');

    // ── 4. Scope: step level is out, in BOTH spellings ───────────────────────
    //
    // This is the boundary the rule was narrowed to on purpose (#5343). Pinning
    // it here means a later widening has to be deliberate rather than accidental
    // -- and the `needs.*` step case is the one a careless regex would sweep in.
    const steps = makeRoot({
      '.github/workflows/steps.yml': `name: Steps
on: [push]
jobs:
  resolve:
    runs-on: ubuntu-latest
    outputs:
      report-sha: \${{ steps.t.outputs.sha }}
    steps:
      - id: t
        run: echo "sha=deadbeef" >> "$GITHUB_OUTPUT"
  smoke:
    needs: resolve
    if: success() && needs.resolve.outputs.report-sha != ''
    runs-on: ubuntu-latest
    steps:
      - id: cache
        run: echo "cache-hit=true" >> "$GITHUB_OUTPUT"
      - name: step reading its own job's step outputs
        if: steps.cache.outputs.cache-hit != 'true'
        run: echo build
      - name: step reading an upstream job's outputs
        if: needs.resolve.outputs.report-sha != ''
        run: echo report
`,
    });
    const stepScope = scan(steps);
    assert(stepScope.problems.length === 0, `the step-scope fixture is well-formed, got ${stepScope.problems[0]}`);
    assert(stepScope.violations.length === 0, `step-level if: is out of scope, got ${stepScope.violations.length}`);
    assert(stepScope.jobIfs === 1, `only the job-level if: is counted, got ${stepScope.jobIfs}`);

    // ── 5. Scope: needs.*.result is a status read, not a data read ───────────
    const resultRead = makeRoot({
      '.github/workflows/guard.yml': `name: Guard
on: [push]
jobs:
  resolve:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
  guard:
    needs: resolve
    if: needs.resolve.result == 'failure'
    runs-on: ubuntu-latest
    steps:
      - run: exit 1
`,
    });
    assert(scan(resultRead).violations.length === 0, 'needs.*.result is outside the rule');

    // ── 6. A folded expression is read as one expression ─────────────────────
    //
    // The reason this gate parses YAML instead of grepping `if:` lines: the
    // #5343 audit table was built by grep, and a grep over lines cannot see the
    // violation below at all -- the `needs.` read and the (absent) status
    // function sit on different source lines. Two workflows in this repo
    // already write `if: >-`.
    const folded = makeRoot({
      '.github/workflows/folded.yml': `name: Folded
on: [push]
jobs:
  a:
    runs-on: ubuntu-latest
    outputs:
      go: \${{ steps.s.outputs.go }}
    steps:
      - id: s
        run: echo "go=true" >> "$GITHUB_OUTPUT"
  b:
    needs: a
    if: >-
      github.event_name == 'push' &&
      needs.a.outputs.go == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo b
`,
    });
    const foldedResult = scan(folded);
    assert(foldedResult.violations.length === 1, `a folded violating if: is flagged, got ${foldedResult.violations.length}`);
    assert(foldedResult.violations[0]?.line === 13, `the folded if: is located at its key, got ${foldedResult.violations[0]?.line}`);
    assert(
      !/\n/.test(foldedResult.violations[0]?.expression ?? '\n'),
      'a folded expression is normalised to one line for the report',
    );
    // ...and the same expression WITH a status function is green, so the fixture
    // proves the parser, not merely that folded scalars are always flagged.
    const foldedOk = makeRoot({
      '.github/workflows/folded-ok.yml': readFileSync(join(folded, '.github/workflows/folded.yml'), 'utf8').replace(
        "      github.event_name == 'push' &&",
        "      !cancelled() && github.event_name == 'push' &&",
      ),
    });
    assert(scan(foldedOk).violations.length === 0, 'the same folded expression with !cancelled() is green');

    // ── 7. Spelling variants the expression language accepts ─────────────────
    const variants = makeRoot({
      '.github/workflows/variants.yml': `name: Variants
on: [push]
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
  index-form:
    needs: a
    if: \${{ needs['a'].outputs['go'] == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - run: echo b
  mixed-case-status:
    needs: a
    if: \${{ Always() && needs.a.outputs.go == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - run: echo c
  wrapped-in-fromjson:
    needs: a
    if: \${{ contains(fromJSON(needs.a.outputs.list), 'x') }}
    runs-on: ubuntu-latest
    steps:
      - run: echo d
`,
    });
    const variantResult = scan(variants);
    assert(
      variantResult.violations.some((v) => v.job === 'index-form'),
      'the needs[...] index spelling is read as an outputs read',
    );
    assert(
      variantResult.violations.some((v) => v.job === 'wrapped-in-fromjson'),
      'an outputs read wrapped in fromJSON() is still an outputs read',
    );
    assert(
      !variantResult.violations.some((v) => v.job === 'mixed-case-status'),
      'the expression language is case-insensitive, so Always() counts',
    );

    // ── 8. The real repository is what this gate actually guards ─────────────
    //
    // Running scan() over the checkout itself is the reverse direction of the
    // fixtures above: fixtures prove the detector can go red, this proves the
    // tree it ships with is green. It also fails loudly if the repo's workflow
    // directory ever moves out from under the gate.
    const real = scan(repoRoot());
    assert(real.problems.length === 0, `the repo's own workflows parse cleanly, got ${real.problems[0]}`);
    assert(real.files > 0 && real.jobs > 0, 'the repo scan actually reads workflows');
    assert(
      real.compliant.length > 0,
      'the repo has at least one job-level needs.*.outputs.* read -- if this ever hits 0, the gate is guarding nothing',
    );
  } finally {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`✗ check-workflow-status-functions --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(`✓ check-workflow-status-functions --self-test: ${checked} assertions over temp fixture roots (real scan() path)`);
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) {
  selfTest();
} else if (process.argv.includes('--list')) {
  list();
} else {
  main();
}
