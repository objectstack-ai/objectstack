#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-workflow-context-availability -- an expression may name only the
// contexts (and special functions) GitHub makes available at the workflow key
// it sits in.
//
//   node scripts/check-workflow-context-availability.mjs
//   node scripts/check-workflow-context-availability.mjs --self-test  # the checker itself
//
// Wired into the SAME `check:workflow-status-functions` script line in
// package.json as its sibling, so the existing `Lint & Repo Gates` step runs it
// with no workflow edit.
//
// ## Why a context in the wrong key is worse than a red check
//
// GitHub validates a workflow file before it creates a run. An expression that
// names a context the key cannot see -- `${{ runner.temp }}` in a JOB-level
// `env:`, say, where `runner` does not exist yet because no runner has been
// picked -- makes the whole file invalid. GitHub then creates NO run for that
// workflow on a pull_request: the required contexts it would have reported never
// appear, every OTHER workflow on the head is green, and the PR's check list
// reads green while the workflow that carries the gates never ran. The only
// trace is a push run named by its file path with 0 jobs. PR #27212 at head
// 191e9d5e is the recorded specimen (`LIVE_BACKEND_DIR: ${{ runner.temp }}/...`
// in job-level `env:`). This gate refuses that shape before push.
//
// ## The table is GitHub's, transcribed -- not remembered
//
// `CONTEXT_AVAILABILITY` below is the "Context availability" table of GitHub's
// Contexts reference (docs.github.com, Actions -> Contexts reference -> Context
// availability), transcribed row for row from the docs source
// `content/actions/reference/workflows-and-actions/contexts.md` in github/docs,
// read 2026-10-28. Each row: a workflow key, the contexts available there, the
// special functions available there. Two consequences of reading it rather than
// recalling it:
//
//   - `matrix` IS listed for job-level `runs-on`, `env`, `timeout-minutes`,
//     `continue-on-error` (and `name`, `container`, `services`, ...). The table
//     states no `strategy.matrix` condition, so this gate imposes none -- a job
//     without a matrix that reads `matrix.*` there gets an empty value from
//     GitHub, not a rejected file, and is not this gate's business.
//   - `matrix` is NOT listed for job-level `if:` or `strategy`, and `runner`,
//     `steps`, `job`, `env` and `secrets` are not listed for job-level `if:`,
//     `runs-on`, `timeout-minutes`, `name`, `concurrency`, ... -- those refuse.
//
// "Unless listed below, a function can be used anywhere": the special functions
// (`always`, `cancelled`, `success`, `failure`, `hashFiles`) are the ones the
// table restricts, so naming one where its row does not list it refuses too.
//
// When GitHub changes the table, change the rows here and the self-test cases
// that pin them, in the same edit. ⛔ Never widen a row to green a workflow:
// GitHub, not this gate, is what rejects the file.
//
// ## What is judged, and what deliberately is not
//
//   - Every string scalar under a key the table names, at any depth below it
//     (`jobs.<id>.env.FOO`, `jobs.<id>.steps[*].with.bar`, a `runs-on` list
//     item). The MOST SPECIFIC row wins: `jobs.<id>.container.env.<id>` beats
//     `jobs.<id>.container`.
//   - In an `if:` (job or step) the whole value is an expression even without
//     `${{ }}`, as GitHub reads it; everywhere else only `${{ ... }}` spans are.
//   - Keys the table does not name (`permissions`, `uses`, `id`, `shell`, `needs`,
//     ...) are not judged: the table is the authority and it is silent there.
//     The count of judged expressions is printed so "nothing judged" is visible.
//   - A named value is an identifier that starts an expression term: not after a
//     `.`, not followed by `(` (a function), not inside a '...' string literal,
//     not one of the literals true/false/null/NaN/Infinity. Case-insensitive, as
//     the expression language is. An identifier that is no context at all is
//     refused too -- GitHub rejects an unrecognized named-value the same way.
//
// ## Missing input is a failure, never a pass
//
// `.github/workflows/` absent, zero workflow files, a file that does not parse,
// a workflow with no `jobs:` map, an unterminated `${{` -- each exits non-zero.
// A checker that could not read its input has verified nothing (the sibling
// gate's header carries the history).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { requireDependency } from './import-prerequisite.mjs';
const { LineCounter, isMap, isScalar, isSeq, parseDocument } = await requireDependency('yaml', () => import('yaml'), import.meta.url);
import { isEntrypoint } from './invoked-as.mjs';

const WORKFLOW_DIR = '.github/workflows';

/** Every context GitHub's expression language knows. */
export const KNOWN_CONTEXTS = Object.freeze([
  'github', 'env', 'vars', 'job', 'jobs', 'steps', 'runner', 'secrets', 'strategy', 'matrix', 'needs', 'inputs',
]);

/** The functions the table restricts; any other function may be used anywhere. */
export const SPECIAL_FUNCTIONS = Object.freeze(['always', 'cancelled', 'success', 'failure', 'hashfiles']);

const LITERALS = new Set(['true', 'false', 'null', 'nan', 'infinity']);

const STATUS = ['always', 'cancelled', 'success', 'failure'];
const STEP_CONTEXTS = 'github, needs, strategy, matrix, job, runner, env, vars, secrets, steps, inputs';

/**
 * GitHub's Context availability table, row for row (see header). `key` uses
 * `*` for an id segment; sequence indices never appear in a path.
 */
export const CONTEXT_AVAILABILITY = Object.freeze(
  [
    ['run-name', 'github, inputs, vars', []],
    ['concurrency', 'github, inputs, vars', []],
    ['env', 'github, secrets, inputs, vars', []],
    ['jobs.*.concurrency', 'github, needs, strategy, matrix, inputs, vars', []],
    ['jobs.*.container', 'github, needs, strategy, matrix, vars, inputs', []],
    ['jobs.*.container.credentials', 'github, needs, strategy, matrix, env, vars, secrets, inputs', []],
    ['jobs.*.container.env.*', 'github, needs, strategy, matrix, job, runner, env, vars, secrets, inputs', []],
    ['jobs.*.container.image', 'github, needs, strategy, matrix, vars, inputs', []],
    ['jobs.*.continue-on-error', 'github, needs, strategy, vars, matrix, inputs', []],
    ['jobs.*.defaults.run', 'github, needs, strategy, matrix, env, vars, inputs', []],
    ['jobs.*.env', 'github, needs, strategy, matrix, vars, secrets, inputs', []],
    ['jobs.*.environment', 'github, needs, strategy, matrix, vars, inputs', []],
    ['jobs.*.environment.url', 'github, needs, strategy, matrix, job, runner, env, vars, steps, inputs', []],
    ['jobs.*.if', 'github, needs, vars, inputs', STATUS],
    ['jobs.*.name', 'github, needs, strategy, matrix, vars, inputs', []],
    ['jobs.*.outputs.*', 'github, needs, strategy, matrix, job, runner, env, vars, secrets, steps, inputs', []],
    ['jobs.*.runs-on', 'github, needs, strategy, matrix, vars, inputs', []],
    ['jobs.*.secrets.*', 'github, needs, strategy, matrix, secrets, inputs, vars', []],
    ['jobs.*.services', 'github, needs, strategy, matrix, vars, inputs', []],
    ['jobs.*.services.*.credentials', 'github, needs, strategy, matrix, env, vars, secrets, inputs', []],
    ['jobs.*.services.*.env.*', 'github, needs, strategy, matrix, job, runner, env, vars, secrets, inputs', []],
    ['jobs.*.steps.continue-on-error', STEP_CONTEXTS, ['hashFiles']],
    ['jobs.*.steps.env', STEP_CONTEXTS, ['hashFiles']],
    ['jobs.*.steps.if', 'github, needs, strategy, matrix, job, runner, env, vars, steps, inputs', [...STATUS, 'hashFiles']],
    ['jobs.*.steps.name', STEP_CONTEXTS, ['hashFiles']],
    ['jobs.*.steps.run', STEP_CONTEXTS, ['hashFiles']],
    ['jobs.*.steps.timeout-minutes', STEP_CONTEXTS, ['hashFiles']],
    ['jobs.*.steps.with', STEP_CONTEXTS, ['hashFiles']],
    ['jobs.*.steps.working-directory', STEP_CONTEXTS, ['hashFiles']],
    ['jobs.*.strategy', 'github, needs, vars, inputs', []],
    ['jobs.*.timeout-minutes', 'github, needs, strategy, matrix, vars, inputs', []],
    ['jobs.*.with.*', 'github, needs, strategy, matrix, inputs, vars', []],
    ['on.workflow_call.inputs.*.default', 'github, inputs, vars', []],
    ['on.workflow_call.outputs.*.value', 'github, jobs, vars, inputs', []],
  ].map(([key, contexts, functions]) =>
    Object.freeze({
      key,
      segments: key.split('.'),
      contexts: Object.freeze(contexts.split(',').map((c) => c.trim())),
      functions: Object.freeze(functions.map((f) => f.toLowerCase())),
    }),
  ),
);

/** The most specific row whose key is a prefix of `path`, or null. */
export function rowFor(path) {
  let best = null;
  for (const row of CONTEXT_AVAILABILITY) {
    if (row.segments.length > path.length) continue;
    if (!row.segments.every((s, i) => s === '*' || s === path[i])) continue;
    if (!best || row.segments.length > best.segments.length) best = row;
  }
  return best;
}

// ── Expression reading ──────────────────────────────────────────────────────

/**
 * The `${{ ... }}` bodies in a string. Returns null when a `${{` is never
 * closed -- an input problem, not a pass. A `}}` inside a '...' literal does not
 * close the span.
 */
export function expressionSpans(text) {
  const spans = [];
  let i = 0;
  for (;;) {
    const open = text.indexOf('${{', i);
    if (open === -1) return spans;
    let j = open + 3;
    let inString = false;
    let closed = -1;
    while (j < text.length) {
      const ch = text[j];
      if (inString) {
        if (ch === "'") {
          if (text[j + 1] === "'") j++;
          else inString = false;
        }
      } else if (ch === "'") inString = true;
      else if (ch === '}' && text[j + 1] === '}') {
        closed = j;
        break;
      }
      j++;
    }
    if (closed === -1) return null;
    spans.push(text.slice(open + 3, closed));
    i = closed + 2;
  }
}

/**
 * The named values and function calls an expression body uses, lower-cased.
 * @returns {{ names: string[], functions: string[] }}
 */
export function referencedNames(expression) {
  const names = [];
  const functions = [];
  let i = 0;
  let prev = '';
  while (i < expression.length) {
    const ch = expression[i];
    if (ch === "'") {
      i++;
      while (i < expression.length) {
        if (expression[i] === "'" && expression[i + 1] === "'") i += 2;
        else if (expression[i] === "'") break;
        else i++;
      }
      i++;
      prev = "'";
      continue;
    }
    if (/[0-9]/.test(ch)) {
      while (i < expression.length && /[0-9A-Za-z_.]/.test(expression[i])) i++;
      prev = '0';
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < expression.length && /[A-Za-z0-9_-]/.test(expression[i])) i++;
      const word = expression.slice(start, i).toLowerCase();
      let k = i;
      while (k < expression.length && /\s/.test(expression[k])) k++;
      if (prev === '.') {
        // a property name, never a context
      } else if (expression[k] === '(') functions.push(word);
      else if (!LITERALS.has(word)) names.push(word);
      prev = 'w';
      continue;
    }
    if (!/\s/.test(ch)) prev = ch;
    i++;
  }
  return { names, functions };
}

// ── Scanning ────────────────────────────────────────────────────────────────

/**
 * Every expression under a table key in the workflow directory, judged.
 *
 * @param {string} root repository root (or, in --self-test, a fixture root)
 */
export function scan(root) {
  const violations = [];
  const problems = [];
  let jobs = 0;
  let expressions = 0;

  const dir = join(root, WORKFLOW_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    problems.push(`${WORKFLOW_DIR}/ does not exist -- nothing was scanned, so nothing was verified.`);
    return { violations, problems, files: 0, jobs, expressions };
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
  if (files.length === 0) {
    problems.push(`${WORKFLOW_DIR}/ holds no .yml/.yaml file -- nothing was scanned, so nothing was verified.`);
    return { violations, problems, files: 0, jobs, expressions };
  }

  for (const name of files) {
    const rel = `${WORKFLOW_DIR}/${name}`;
    const lineCounter = new LineCounter();
    let doc;
    try {
      doc = parseDocument(readFileSync(join(dir, name), 'utf8'), { lineCounter });
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
    jobs += jobsNode.items.length;

    const judge = (path, node) => {
      const row = rowFor(path);
      if (!row) return;
      const line = lineCounter.linePos(node.range[0]).line;
      const text = String(node.value);
      const isIf = path.length === row.segments.length && row.segments[row.segments.length - 1] === 'if';
      let bodies = expressionSpans(text);
      if (bodies === null) {
        problems.push(`${rel}:${line}: \`${path.join('.')}\` opens a \${{ that is never closed.`);
        return;
      }
      if (isIf && bodies.length === 0 && text.trim() !== '') bodies = [text];
      for (const body of bodies) {
        expressions++;
        const { names, functions } = referencedNames(body);
        const refused = [
          ...new Set(names.filter((n) => !row.contexts.includes(n))),
        ].map((n) => ({ kind: KNOWN_CONTEXTS.includes(n) ? 'context' : 'unknown', name: n }));
        for (const fn of new Set(functions)) {
          if (SPECIAL_FUNCTIONS.includes(fn) && !row.functions.includes(fn)) refused.push({ kind: 'function', name: fn });
        }
        for (const r of refused) {
          violations.push({ file: rel, line, key: row.key, path: path.join('.'), ...r, expression: body.replace(/\s+/g, ' ').trim() });
        }
      }
    };

    const walk = (path, node) => {
      if (isMap(node)) {
        for (const pair of node.items) walk([...path, String(pair.key?.value ?? pair.key)], pair.value);
      } else if (isSeq(node)) {
        for (const item of node.items) walk(path, item);
      } else if (isScalar(node) && typeof node.value === 'string') {
        judge(path, node);
      }
    };
    walk([], doc.contents);
  }

  return { violations, problems, files: files.length, jobs, expressions };
}

// ── Reporting ───────────────────────────────────────────────────────────────

function escapeData(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(value) {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

export function describe(v) {
  const row = CONTEXT_AVAILABILITY.find((r) => r.key === v.key);
  const what =
    v.kind === 'function'
      ? `the special function \`${v.name}()\``
      : v.kind === 'unknown'
        ? `\`${v.name}\`, which is no context GitHub knows,`
        : `the \`${v.name}\` context`;
  return (
    `\`${v.path}\` uses ${what} -- GitHub's context-availability table allows only ` +
    `${row.contexts.join(', ')}${row.functions.length ? ` (functions: ${row.functions.join(', ')})` : ''} ` +
    `at \`${v.key}\`. GitHub rejects the whole file and creates no run for it.`
  );
}

export function annotate(v) {
  const title = escapeProperty(`Expression uses ${v.name} where GitHub does not make it available`);
  return `::error file=${escapeProperty(v.file)},line=${v.line},title=${title}::${escapeData(describe(v))}`;
}

const PRESCRIPTION = `
Move the value to a key whose row lists the context. The usual case: a job-level
\`env:\` value that reads \`runner\`, \`steps\` or \`job\` belongs in the \`env:\` of
the step that uses it (step-level keys see every context). Table and scope:
the header of scripts/check-workflow-context-availability.mjs.`;

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function summarise({ files, jobs, expressions }) {
  return `scanned ${files} workflow file(s), ${jobs} job(s); judged ${expressions} expression(s) under context-availability table keys`;
}

function main() {
  const result = scan(repoRoot());
  const { violations, problems } = result;
  if (problems.length > 0) {
    console.error(`check-workflow-context-availability: ${problems.length} input problem(s) -- the scan is NOT a pass\n`);
    for (const p of problems) console.error(`  • ${p}`);
    process.exit(1);
  }
  if (violations.length === 0) {
    console.log(`check-workflow-context-availability: OK (${summarise(result)}).`);
    process.exit(0);
  }
  console.error(`check-workflow-context-availability: ${violations.length} expression use(s) GitHub's context-availability table forbids\n`);
  for (const v of violations) {
    console.error(`  • ${v.file}:${v.line}  ${describe(v)}`);
    console.error(`      \${{ ${v.expression} }}`);
    console.log(annotate(v));
  }
  console.error(PRESCRIPTION);
  process.exit(1);
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// Fixture workflows in temp dirs, run through the SAME scan() main() calls.
// Roster, floor and handshake copied from check-workflow-status-functions.mjs
// (AGENTS.md, "Writing a --self-test").

const SELF_TEST_VERDICT = 'check-workflow-context-availability self-test reached its verdict';

// Battery name -> minimum case count. A FLOOR, not an equality.
const SELF_TEST_BATTERIES = Object.freeze({
  '1. The PR #27212 head 191e9d5e shape is refused': 6,
  '2. The same key at step level passes': 3,
  '3. runner/steps/job/matrix x job-level env/if/timeout-minutes/runs-on, judged by the table': 17,
  '4. The matrix rows GitHub allows pass, and job-level if: still refuses matrix': 4,
  '5. Expression reading: literals, properties, functions, case, implicit if': 8,
  '6. Special functions are held to their rows': 3,
  '7. Workflow-level and workflow_call rows': 4,
  '8. Missing input must go red': 5,
  '9. The real repository is what this gate actually guards': 3,
});

const SELF_TEST_BATTERY_FLOOR = 9;

const UNATTRIBUTED_BATTERY = '(no battery open)';

function selfTest() {
  const seen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const failures = [];
  let checked = 0;
  const assert = (cond, msg) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
    checked++;
    if (!cond) failures.push(msg);
  };

  const roots = [];
  const makeRoot = (files) => {
    const dir = mkdtempSync(join(tmpdir(), 'check-workflow-context-'));
    roots.push(dir);
    for (const [rel, contents] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
    return dir;
  };
  const workflow = (body) => makeRoot({ '.github/workflows/w.yml': `name: W\non: [push]\n${body}` });

  try {
    // ── 1. The recorded specimen ─────────────────────────────────────────────
    battery('1. The PR #27212 head 191e9d5e shape is refused');
    const specimen = workflow(`jobs:
  live-e2e-ui:
    runs-on: ubuntu-latest
    env:
      LIVE_BACKEND_DIR: \${{ runner.temp }}/live-backend
    steps:
      - run: echo "$LIVE_BACKEND_DIR"
`);
    const red = scan(specimen);
    assert(red.problems.length === 0, `the specimen is well-formed, got ${red.problems[0]}`);
    assert(red.violations.length === 1, `the specimen is flagged once, got ${red.violations.length}`);
    assert(red.violations[0]?.name === 'runner' && red.violations[0]?.kind === 'context', `runner is the refused context, got ${red.violations[0]?.name}`);
    assert(red.violations[0]?.key === 'jobs.*.env', `the governing row is jobs.*.env, got ${red.violations[0]?.key}`);
    assert(red.violations[0]?.line === 7, `the line points at the value, got ${red.violations[0]?.line}`);
    const line = red.violations[0] ? annotate(red.violations[0]) : '(no violation to annotate)';
    assert(
      line.startsWith('::error file=.github/workflows/w.yml,line=7,title=') && !/[\r\n]/.test(line),
      `the annotation is one line carrying file= and line=, got ${line.slice(0, 80)}`,
    );

    // ── 2. The same key one level down ───────────────────────────────────────
    battery('2. The same key at step level passes');
    const stepLevel = scan(workflow(`jobs:
  live-e2e-ui:
    runs-on: ubuntu-latest
    steps:
      - env:
          LIVE_BACKEND_DIR: \${{ runner.temp }}/live-backend
        run: echo "$LIVE_BACKEND_DIR"
`));
    assert(stepLevel.problems.length === 0, `the step-level fixture is well-formed, got ${stepLevel.problems[0]}`);
    assert(stepLevel.expressions === 1, `the step-level expression was judged, not skipped, got ${stepLevel.expressions}`);
    assert(stepLevel.violations.length === 0, `runner.temp in step-level env: passes, got ${stepLevel.violations.length}`);

    // ── 3. The issue's minimum grid, verdicts read off the table ─────────────
    battery('3. runner/steps/job/matrix x job-level env/if/timeout-minutes/runs-on, judged by the table');
    const grid = {
      env: (e) => `    env:\n      X: \${{ ${e} }}\n`,
      if: (e) => `    if: \${{ ${e} }}\n`,
      'timeout-minutes': (e) => `    timeout-minutes: \${{ ${e} }}\n`,
      'runs-on': (e) => `    runs-on: \${{ ${e} }}\n`,
    };
    const expected = {
      runner: { env: false, if: false, 'timeout-minutes': false, 'runs-on': false },
      steps: { env: false, if: false, 'timeout-minutes': false, 'runs-on': false },
      job: { env: false, if: false, 'timeout-minutes': false, 'runs-on': false },
      matrix: { env: true, if: false, 'timeout-minutes': true, 'runs-on': true },
    };
    let refusedCount = 0;
    for (const [ctx, perKey] of Object.entries(expected)) {
      for (const [key, allowed] of Object.entries(perKey)) {
        const body = `jobs:\n  j:\n    strategy:\n      matrix:\n        os: [ubuntu-latest]\n${grid[key](`${ctx}.x`)}${key === 'runs-on' ? '' : '    runs-on: ubuntu-latest\n'}    steps:\n      - run: echo\n`;
        const r = scan(workflow(body));
        const flagged = r.problems.length === 0 && r.violations.some((v) => v.name === ctx && v.key === `jobs.*.${key}`);
        if (!allowed) refusedCount++;
        assert(
          r.problems.length === 0 && flagged === !allowed,
          `${ctx}.x in job-level ${key}: expected ${allowed ? 'pass' : 'refuse'}, got ${flagged ? 'refuse' : 'pass'} (${r.problems[0] ?? 'no problems'})`,
        );
      }
    }
    assert(refusedCount === 13, `the table refuses 13 of the 16 cells, the grid encoded ${refusedCount}`);

    // ── 4. matrix where the table lists it ───────────────────────────────────
    battery('4. The matrix rows GitHub allows pass, and job-level if: still refuses matrix');
    const matrixOk = scan(workflow(`jobs:
  j:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        budget: [30]
    runs-on: \${{ matrix.os }}
    timeout-minutes: \${{ matrix.budget }}
    continue-on-error: \${{ matrix.os == 'macos-latest' }}
    env:
      TARGET: \${{ matrix.os }}
    steps:
      - run: echo "$TARGET"
`));
    assert(matrixOk.problems.length === 0, `the matrix fixture is well-formed, got ${matrixOk.problems[0]}`);
    assert(matrixOk.expressions === 4, `all four matrix reads were judged, got ${matrixOk.expressions}`);
    assert(matrixOk.violations.length === 0, `matrix in runs-on/timeout-minutes/continue-on-error/env passes, got ${matrixOk.violations.map((v) => v.path).join(', ')}`);
    const matrixIf = scan(workflow(`jobs:
  j:
    strategy:
      matrix:
        os: [ubuntu-latest]
    if: matrix.os == 'ubuntu-latest'
    runs-on: ubuntu-latest
    steps:
      - run: echo
`));
    assert(matrixIf.violations.length === 1 && matrixIf.violations[0].name === 'matrix', 'matrix in a job-level if: refuses even with a strategy.matrix');

    // ── 5. Reading expressions the way GitHub does ───────────────────────────
    battery('5. Expression reading: literals, properties, functions, case, implicit if');
    const read = (e) => referencedNames(e);
    assert(read("github.job == 'runner.temp'").names.join() === 'github', "a property named job and a 'string' literal are not contexts");
    assert(read("format('{0}}}', github.sha)").names.join() === 'github', "a '}}' inside a literal does not end the read");
    assert(read("contains(fromJSON('[1]'), 1) && true").names.length === 0, 'function names and literals are not contexts');
    assert(read("steps['build'].outputs.x").names.join() === 'steps', 'the index spelling still names its context');
    assert(read('Runner.OS').names.join() === 'runner', 'context names are case-insensitive');
    assert(expressionSpans("a ${{ x }} b ${{ format('}}', y) }} c").length === 2, 'two spans, the second carrying a }} literal');
    const implicit = scan(workflow(`jobs:
  j:
    if: runner.os == 'Linux'
    runs-on: ubuntu-latest
    steps:
      - if: runner.os == 'Linux'
        run: echo
`));
    assert(implicit.violations.length === 1 && implicit.violations[0].key === 'jobs.*.if', 'an if: without ${{ }} is read as an expression, and only the job-level one refuses');
    const unknown = scan(workflow(`jobs:
  j:
    runs-on: \${{ runners.label }}
    steps:
      - run: echo
`));
    assert(unknown.violations[0]?.kind === 'unknown', 'a name that is no context is refused as unknown');

    // ── 6. Special functions ─────────────────────────────────────────────────
    battery('6. Special functions are held to their rows');
    const fns = scan(workflow(`jobs:
  j:
    if: \${{ always() }}
    runs-on: ubuntu-latest
    env:
      KEY: \${{ hashFiles('**/lock') }}
    steps:
      - if: \${{ failure() && hashFiles('x') != '' }}
        env:
          KEY: \${{ hashFiles('**/lock') }}
        run: echo
`));
    assert(fns.violations.length === 1, `only the job-level hashFiles() refuses, got ${fns.violations.map((v) => `${v.path}:${v.name}`).join(', ')}`);
    assert(fns.violations[0]?.kind === 'function' && fns.violations[0]?.name === 'hashfiles', 'hashFiles() in job-level env: is refused as a function');
    const statusInEnv = scan(workflow(`jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - env:
          OK: \${{ success() }}
        run: echo
`));
    assert(statusInEnv.violations[0]?.name === 'success', 'a status function outside an if: refuses');

    // ── 7. Workflow-level rows ───────────────────────────────────────────────
    battery('7. Workflow-level and workflow_call rows');
    const top = scan(makeRoot({
      '.github/workflows/top.yml': `name: Top
run-name: \${{ secrets.X }}
on:
  workflow_call:
    inputs:
      dir:
        type: string
        default: \${{ github.workspace }}
    outputs:
      result:
        value: \${{ jobs.j.outputs.result }}
env:
  TMP: \${{ runner.temp }}
  OK: \${{ secrets.TOKEN }}
jobs:
  j:
    runs-on: ubuntu-latest
    outputs:
      result: \${{ steps.s.outputs.r }}
    steps:
      - id: s
        run: echo "r=1" >> "$GITHUB_OUTPUT"
`,
    }));
    const at = (p) => top.violations.filter((v) => v.path === p).map((v) => v.name).join();
    assert(at('run-name') === 'secrets', `secrets in run-name: refuses, got ${at('run-name')}`);
    assert(at('env.TMP') === 'runner', `runner in workflow-level env: refuses, got ${at('env.TMP')}`);
    assert(at('env.OK') === '' && at('on.workflow_call.outputs.result.value') === '', 'secrets in workflow env: and jobs in a workflow_call output pass');
    assert(top.violations.length === 2, `exactly the two refusals, got ${top.violations.length}`);

    // ── 8. Missing input ─────────────────────────────────────────────────────
    battery('8. Missing input must go red');
    assert(scan(makeRoot({ 'README.md': '#\n' })).problems.length === 1, `a missing ${WORKFLOW_DIR}/ is an input problem`);
    assert(scan(makeRoot({ '.github/workflows/.gitkeep': '' })).problems.length === 1, `an empty ${WORKFLOW_DIR}/ is an input problem`);
    const broken = scan(makeRoot({ '.github/workflows/broken.yml': 'name: B\non: [push]\njobs:\n  a:\n   - x\n  b: [\n' }));
    assert(broken.problems.some((p) => p.includes('broken.yml')), 'an unparseable file is an input problem that names the file');
    assert(scan(makeRoot({ '.github/workflows/j.yml': 'name: J\non: [push]\n' })).problems.length === 1, 'a workflow with no jobs: is an input problem');
    const unclosed = scan(workflow(`jobs:
  j:
    runs-on: \${{ matrix.os
    steps:
      - run: echo
`));
    assert(unclosed.problems.length === 1, 'an unterminated ${{ is an input problem, not a pass');

    // ── 9. The real tree ─────────────────────────────────────────────────────
    battery('9. The real repository is what this gate actually guards');
    const real = scan(repoRoot());
    assert(real.problems.length === 0, `the repo's own workflows parse cleanly, got ${real.problems[0]}`);
    assert(real.files > 0 && real.jobs > 0, 'the repo scan actually reads workflows');
    assert(real.expressions > 0, 'the repo scan judged at least one expression -- 0 means the gate guards nothing');
  } finally {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  }

  // ── The floor: every declared battery ran, and ran its cases ─────────────
  const declared = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    failures.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  }
  for (const [name, count] of seen) {
    if (declared.includes(name)) continue;
    floorBreached = true;
    failures.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    failures.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN -- 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]}.`,
    );
  }
  if (floorBreached) {
    failures.push('A battery below its floor means cases STOPPED RUNNING -- find what stopped registering and restore it.');
  }
  if (failures.length) {
    console.error(`✗ check-workflow-context-availability --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(`✓ check-workflow-context-availability --self-test: ${checked} assertions over temp fixture roots (real scan() path)`);

  return SELF_TEST_VERDICT;
}

const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) {
  if (selfTest() !== SELF_TEST_VERDICT) {
    console.error(
      '\n✗ check-workflow-context-availability self-test: selfTest() returned without reaching its verdict,\n' +
        'so no success line was printed. Exiting 0 here would report a self-test\n' +
        'that never finished as a self-test that passed.\n',
    );
    process.exit(1);
  }
} else {
  main();
}
