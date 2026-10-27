#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ci-shard-matrix -- the ONE reader of ci.yml's shard-matrix sizes.
 *
 *   node scripts/ci-shard-matrix.mjs              # every sharded job in ci.yml, with its size
 *   node scripts/ci-shard-matrix.mjs --job test   # one job's size, alone on stdout
 *   node scripts/ci-shard-matrix.mjs --self-test
 *
 * ## Why this exists
 *
 * A shard count is a number the workflow owns: `strategy.matrix.shard` in
 * `.github/workflows/ci.yml` decides how many runners start, and the `/N` in a
 * job's `name:` is how the jobs API lists them. The scripts that partition,
 * attest and pin those jobs used to spell N again as a literal of their own
 * (`SHARD_COUNT = 8`, `'Test Core (${{ matrix.shard }}/8)'` in two
 * self-tests), so resizing a matrix meant finding every copy, and none of the
 * copies was the authority. They now ask this module, and the literal lives in
 * the workflow only.
 *
 * ## What it reads, and what it refuses
 *
 * The workflow is read as TEXT, never through the `yaml` package: callers
 * include `check-shard-attestation.mjs`, which runs in jobs that never install
 * dependencies, and `partition-test-shards.mjs`, which needs the count
 * synchronously at module load. Two spellings of a job's `shard:` matrix key
 * are understood, the two ci.yml uses:
 *
 *   shard: [1, 2, 3]                                               literal list
 *   shard: ${{ fromJSON(needs.P.outputs.S || '[1, 2, ..., 8]') }}  planned matrix
 *
 * A planned matrix starts only the shards its plan names, so its SIZE is the
 * full-roster fallback after `||`, the list it runs when no plan exists.
 *
 * Every other shape is REFUSED with an error naming the job and what was
 * missing: no such job, no `matrix:`, no `shard:` under it, two `matrix:`
 * blocks, a planned matrix with no fallback literal, a block-sequence or
 * quoted spelling, or a list that is not exactly 1..N. ⛔ There is no default:
 * a reader that fell back to a remembered N when the matrix moved out of its
 * reach would hand every caller the old number, which is the drift this file
 * exists to remove (AGENTS.md, "Absence must be loud").
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The workflow whose matrices this module reads, repo-relative. */
export const CI_WORKFLOW = '.github/workflows/ci.yml';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const indentOf = (line) => /^ */.exec(line)[0].length;
const isBlankOrComment = (line) => /^\s*(#.*)?$/.test(line);
const stripComment = (value) => value.replace(/\s+#.*$/, '').trim();

/**
 * The lines of one job's block under `jobs:`, header excluded. A job ends at
 * the next line indented two spaces or less that is not blank or a comment;
 * ci.yml writes two-space comments between jobs, so a comment never ends one.
 */
function jobBlock(lines, job) {
  const jobsAt = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (jobsAt === -1) return { error: 'the workflow has no top-level `jobs:` key' };
  const header = new RegExp(`^  ${escapeRegExp(job)}:\\s*(#.*)?$`);
  const at = lines.findIndex((l, i) => i > jobsAt && header.test(l));
  if (at === -1) return { error: `no job '${job}' under \`jobs:\`` };
  let end = at + 1;
  while (end < lines.length && (isBlankOrComment(lines[end]) || indentOf(lines[end]) > 2)) end += 1;
  return { lines: lines.slice(at + 1, end) };
}

/** The `[a, b, ...]` text as a 1..N roster, or the reason it is not one. */
function rosterOf(listText) {
  const inner = /^\[([^\]]*)\]$/.exec(listText.trim());
  if (!inner) return { error: `\`${listText}\` is not a flow list` };
  const items = inner[1].split(',').map((s) => s.trim());
  if (items.length === 1 && items[0] === '') return { error: 'the list is empty' };
  if (!items.every((s) => /^[1-9]\d*$/.test(s))) return { error: `\`${listText}\` holds an item that is not a positive integer` };
  const values = items.map(Number);
  if (!values.every((v, i) => v === i + 1)) return { error: `\`${listText}\` is not exactly 1..${values.length}` };
  return { values };
}

/**
 * One job's shard matrix, read from workflow text.
 *
 * @param {string} workflowText the workflow file's contents
 * @param {string} job the job id under `jobs:`
 * @param {{ source?: string }} [options] the file name errors cite
 * @returns {{ job: string, total: number, form: 'literal' | 'planned', values: number[] }}
 * @throws {Error} whenever the matrix cannot be read; there is no fallback
 */
export function readShardMatrix(workflowText, job, { source = CI_WORKFLOW } = {}) {
  const refuse = (why) => {
    throw new Error(`ci-shard-matrix: cannot read the shard matrix of job '${job}' in ${source}: ${why}`);
  };
  if (typeof workflowText !== 'string' || workflowText.trim() === '') refuse('the workflow text is empty');
  const block = jobBlock(workflowText.split(/\r?\n/), job);
  if (block.error) refuse(block.error);

  const matrixAt = block.lines.map((l, i) => (/^\s+matrix:\s*(#.*)?$/.test(l) ? i : -1)).filter((i) => i !== -1);
  if (matrixAt.length === 0) refuse('the job declares no block-style `matrix:`');
  if (matrixAt.length > 1) refuse(`the job declares \`matrix:\` ${matrixAt.length} times`);
  const matrixIndent = indentOf(block.lines[matrixAt[0]]);
  const children = [];
  for (const line of block.lines.slice(matrixAt[0] + 1)) {
    if (isBlankOrComment(line)) continue;
    if (indentOf(line) <= matrixIndent) break;
    children.push(line);
  }
  if (children.length === 0) refuse('its `matrix:` is empty');
  const childIndent = indentOf(children[0]);
  const shardLines = children.filter((l) => indentOf(l) === childIndent && /^\s+shard:/.test(l));
  if (shardLines.length !== 1) refuse(shardLines.length === 0 ? 'its `matrix:` has no `shard:` key' : 'its `matrix:` declares `shard:` twice');
  const value = stripComment(shardLines[0].replace(/^\s+shard:/, ''));
  if (value === '') refuse('`shard:` has no inline value (a block sequence is not a spelling this reader understands)');

  let form;
  let roster;
  if (value.startsWith('[')) {
    form = 'literal';
    roster = rosterOf(value);
  } else if (value.startsWith('${{')) {
    form = 'planned';
    const planned = /^\$\{\{\s*fromJSON\(\s*.+?\s*\|\|\s*'(\[[^\]']*\])'\s*\)\s*\}\}$/.exec(value);
    if (!planned) refuse(`\`shard: ${value}\` is an expression with no \`|| '[1, ...]'\` full-roster fallback, so its size is not in the text`);
    roster = rosterOf(planned[1]);
  } else {
    refuse(`\`shard: ${value}\` is neither a flow list nor a fromJSON(... || '[...]') expression`);
  }
  if (roster.error) refuse(roster.error);
  return { job, total: roster.values.length, form, values: roster.values };
}

/** One job's shard count from workflow text: `readShardMatrix(...).total`. */
export function shardTotal(workflowText, job, options) {
  return readShardMatrix(workflowText, job, options).total;
}

/**
 * One job's shard count from the checked-in ci.yml.
 *
 * @param {string} job
 * @param {{ root?: string }} [options] the repository root (default: this checkout)
 */
export function liveShardTotal(job, { root = REPO_ROOT } = {}) {
  const path = join(root, CI_WORKFLOW);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`ci-shard-matrix: cannot read ${path} to size job '${job}' (${error.code ?? error.message})`);
  }
  return shardTotal(text, job, { source: CI_WORKFLOW });
}

/** Every job in the workflow text that declares a `shard:` matrix key. */
export function shardedJobs(workflowText, options) {
  const lines = workflowText.split(/\r?\n/);
  const jobsAt = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  const ids = jobsAt === -1 ? [] : lines.slice(jobsAt + 1).map((l) => /^  ([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(l)?.[1]).filter(Boolean);
  return ids
    .filter((id) => jobBlock(lines, id).lines.some((l) => /^\s+shard:/.test(l)))
    .map((id) => readShardMatrix(workflowText, id, options));
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// Battery names are pinned with a per-battery floor, and the dispatch refuses
// a self-test that returned without reaching its verdict (AGENTS.md, "Writing
// a --self-test"; copied from scripts/check-agent-model-declared.mjs).

let selfTestReachedVerdict = false;

const SELF_TEST_BATTERIES = Object.freeze({
  'the live ci.yml': 4,
  'the literal list': 3,
  'the planned matrix': 3,
  'job boundaries': 3,
  'refusals, never a default': 14,
});

const SELF_TEST_BATTERY_FLOOR = 5;

function selfTest() {
  const batterySeen = new Map();
  let current = null;
  let cases = 0;
  let failed = 0;
  const battery = (name) => {
    current = name;
  };
  const check = (label, ok) => {
    cases += 1;
    batterySeen.set(current, (batterySeen.get(current) ?? 0) + 1);
    if (!ok) {
      failed += 1;
      console.error(`✗ [${current}] ${label}`);
    }
  };
  const refusal = (fn) => {
    try {
      fn();
      return null;
    } catch (error) {
      return error.message;
    }
  };
  const refuses = (label, text, job, needle) => {
    const message = refusal(() => readShardMatrix(text, job, { source: 'fixture.yml' }));
    check(`${label} ⇒ refused naming '${needle}' (got ${JSON.stringify(message)})`, message !== null && message.includes(needle) && message.includes(`job '${job}'`));
  };
  const workflow = (body) => `on: push\njobs:\n${body}`;
  const matrixJob = (id, shardLine, extra = '') => `  ${id}:\n    runs-on: ubuntu-latest\n${extra}    strategy:\n      fail-fast: false\n      matrix:\n        ${shardLine}\n    steps:\n      - run: echo\n`;

  battery('the live ci.yml');
  const live = readFileSync(join(REPO_ROOT, CI_WORKFLOW), 'utf8');
  const jobs = refusal(() => shardedJobs(live)) === null ? shardedJobs(live) : [];
  check(`ci.yml declares sharded jobs (read ${jobs.map((j) => `${j.job}=${j.total}`).join(', ') || 'none'})`, jobs.length > 0);
  for (const id of ['test', 'dogfood', 'test-ui']) {
    const total = refusal(() => liveShardTotal(id)) === null ? liveShardTotal(id) : null;
    check(`liveShardTotal('${id}') reads a size of at least 2 (read ${total})`, Number.isInteger(total) && total >= 2);
  }

  battery('the literal list');
  check('`[1, 2, 3]` reads as 3', shardTotal(workflow(matrixJob('a', 'shard: [1, 2, 3]')), 'a') === 3);
  check('a compact `[1,2]` with a trailing comment reads as 2', shardTotal(workflow(matrixJob('a', 'shard: [1,2]   # two legs')), 'a') === 2);
  check('the form is reported as literal', readShardMatrix(workflow(matrixJob('a', 'shard: [1]')), 'a').form === 'literal');

  battery('the planned matrix');
  const planned = readShardMatrix(workflow(matrixJob('t', "shard: ${{ fromJSON(needs.plan.outputs.shards || '[1, 2, 3, 4, 5]') }}")), 't');
  check('the size is the full-roster fallback after `||`', planned.total === 5 && planned.form === 'planned');
  check('tight spacing inside the expression reads the same', shardTotal(workflow(matrixJob('t', "shard: ${{fromJSON(needs.p.outputs.s||'[1,2]')}}")), 't') === 2);
  check('the values are the fallback roster', JSON.stringify(planned.values) === '[1,2,3,4,5]');

  battery('job boundaries');
  const two = workflow(`  first:\n    runs-on: x\n    steps:\n      - run: echo\n  # a two-space comment between jobs\n${matrixJob('second', 'shard: [1, 2, 3, 4]')}`);
  refuses("the next job's matrix is not credited to a job with none", two, 'first', 'no block-style `matrix:`');
  check('the job after a two-space comment still reads', shardTotal(two, 'second') === 4);
  check('a two-space comment inside a job does not end it', shardTotal(workflow(`  c:\n    runs-on: x\n  # not the end\n    strategy:\n      matrix:\n        shard: [1, 2]\n`), 'c') === 2);

  battery('refusals, never a default');
  refuses('empty text', '', 'a', 'empty');
  refuses('no `jobs:`', 'on: push\n', 'a', 'no top-level `jobs:`');
  refuses('an unknown job', workflow(matrixJob('a', 'shard: [1]')), 'b', "no job 'b'");
  refuses('a matrix with no shard key', workflow(matrixJob('a', 'os: [linux]')), 'a', 'no `shard:` key');
  refuses('a planned matrix with no fallback', workflow(matrixJob('a', 'shard: ${{ fromJSON(needs.p.outputs.s) }}')), 'a', 'full-roster fallback');
  refuses('a list that skips a shard', workflow(matrixJob('a', 'shard: [1, 3]')), 'a', 'not exactly 1..2');
  refuses('a list starting at 0', workflow(matrixJob('a', 'shard: [0, 1]')), 'a', 'not a positive integer');
  refuses('a list out of order', workflow(matrixJob('a', 'shard: [2, 1]')), 'a', 'not exactly 1..2');
  refuses('an empty list', workflow(matrixJob('a', 'shard: []')), 'a', 'empty');
  refuses('quoted items', workflow(matrixJob('a', "shard: ['1', '2']")), 'a', 'not a positive integer');
  refuses('a block sequence', workflow(`  a:\n    strategy:\n      matrix:\n        shard:\n          - 1\n          - 2\n`), 'a', 'no inline value');
  refuses('two matrix blocks', workflow(`  a:\n    strategy:\n      matrix:\n        shard: [1]\n    other:\n      matrix:\n        shard: [1, 2]\n`), 'a', 'declares `matrix:` 2 times');
  refuses('a scalar shard value', workflow(matrixJob('a', 'shard: 8')), 'a', 'neither a flow list');
  const missingRoot = refusal(() => liveShardTotal('test', { root: join(REPO_ROOT, 'no-such-checkout') }));
  check(`a checkout with no ci.yml is refused, not defaulted (got ${JSON.stringify(missingRoot)})`, missingRoot !== null && missingRoot.includes('cannot read') && missingRoot.includes('ENOENT'));

  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floorFailure = (message) => {
    failed += 1;
    console.error(`✗ self-test floor: ${message}`);
  };
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  }
  for (const [name, count] of batterySeen) {
    if (!declared.includes(name)) floorFailure(`battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      floorFailure(
        count === 0
          ? `battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned.`
          : `battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]}.`,
      );
    }
  }

  if (failed > 0) {
    console.error(`\n✗ ci-shard-matrix self-test: ${failed} failure(s) over ${cases} case(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`✓ ci-shard-matrix self-test: ${cases} cases pass across ${declared.length} batteries (live: ${jobs.map((j) => `${j.job}=${j.total}`).join(', ')}).`);
  selfTestReachedVerdict = true;
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error('\n✗ ci-shard-matrix self-test: selfTest() returned without reaching its verdict, so no success line was printed.');
      process.exit(1);
    }
    return;
  }
  const jobAt = argv.indexOf('--job');
  try {
    if (jobAt !== -1) {
      const job = argv[jobAt + 1];
      if (!job) throw new Error('ci-shard-matrix: --job needs a job id');
      console.log(String(liveShardTotal(job)));
      return;
    }
    const jobs = shardedJobs(readFileSync(join(REPO_ROOT, CI_WORKFLOW), 'utf8'));
    if (jobs.length === 0) throw new Error(`ci-shard-matrix: ${CI_WORKFLOW} declares no shard matrix at all`);
    for (const j of jobs) console.log(`${j.job}\t${j.total}\t${j.form}`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}

if (isEntrypoint(import.meta.url)) {
  main();
}
