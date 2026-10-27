#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// plan-test-core-shards -- which `Test Core (N/8)` shards this run starts,
// decided ONCE, before any shard runner exists (#26084).
//
//   node scripts/ci/plan-test-core-shards.mjs <turbo-ls.json> --exclude <pkg>... --github-output <file>
//   node scripts/ci/plan-test-core-shards.mjs --verify <turbo-ls.json> --exclude <pkg>... --shard <k> --digest <hex>
//   node scripts/ci/plan-test-core-shards.mjs --self-test
//
// ## The waste this removes
//
// The `test` job's matrix was the literal list 1..8, so every run that
// started Test Core started eight runners, and each one paid checkout,
// install and its package-set selection before it could learn that its bin
// was empty ("No packages on this shard"). Measured over the 25 most recent
// completed `pull_request` CI runs on 2026-10-27 (runs 40415024961 to
// 40426272873): 21 started Test Core, 13 of those had at least one empty
// shard, and 72 of the 168 shard jobs were empty (43%), 7020 runner-seconds,
// 97.5 s each. A diff that reaches no package (a root script, a doc, a
// workflow) partitions one to three packages over eight bins, so five to
// seven of its shards are always empty.
//
// ## What the plan is
//
// The `test-plan` job runs the SAME selection a shard runs
// (`scripts/ci/select-shard-packages.sh`, same event fields) and the SAME
// partition (`planRun()` from partition-test-shards.mjs at SHARD_COUNT, same
// exclusions), and publishes two outputs:
//
//   shards   the 1-based indices of the bins holding at least one item, as a
//            JSON array -- the `test` job's `strategy.matrix.shard`, through
//            `fromJSON`. `[]` means nothing to test: the job's `if:` skips it.
//   digest   a sha256 of the whole plan (every bin's items, in order).
//
// The shard count stays SHARD_COUNT: a planned shard runs `--shard k/8`
// exactly as before, keeps its name `Test Core (k/8)`, its cache key and its
// attestation `test-k-of-8`. Only the shards whose bin is empty are not
// started, so no package moves to another shard and no shard carries more
// than it did. This is deliberately NOT a re-sizing to fewer, fuller bins:
// every package diff on main reaches @objectstack/cli, spec, core, objectql
// and runtime through the dependency graph and the cross-package union (10 of
// 10 single-package probes on 6390fe52 filled all eight bins, ~5600 s of
// predicted test window at the smallest), so packing such a run into two
// bins would roughly double its Test Core wall. The plan drops runners that
// have nothing to do, never wall-clock.
//
// ## Why each shard checks the digest (`--verify`)
//
// A shard still computes its own package set, so the plan and the shard are
// two computations of one answer. If they ever disagreed, a package on a bin
// the plan called empty would be tested by NO shard, and every started
// shard would still be green. So "Compute this shard's package set" ends
// with `--verify`: the shard recomputes the plan from its own list and reds,
// naming both digests, when it differs from the one the matrix was built
// from. Equal digests mean equal bins, so the shards that were not started
// were empty by the shard's own computation as well.
//
// An empty `--digest` is the FILTER CONTRACT's fail-open half: the plan job
// died or never wrote its outputs, the matrix fell back to its literal
// 1..8 (`|| '[1, ..., 8]'` in ci.yml), every bin runs, and there is no
// unstarted shard to vouch for. `--verify` says so and passes.
//
// ## The gate's half
//
// `test-gate` counts attestations against the PLANNED roster, not 1..8:
// `check-shard-attestation.mjs --verify --planned "test=<the same expression
// the matrix reads>"`. That script's static guard holds the matrix
// expression and the gate's to the same bytes.

import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { SHARD_COUNT, planRun } from '../partition-test-shards.mjs';

const SCRIPT = 'plan-test-core-shards';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The plan for one package list: the bins `planRun()` cuts at SHARD_COUNT,
 * which of them hold work, and the digest of the whole partition.
 *
 * @param {unknown} parsed the `turbo ls --output=json` document
 * @param {string} listPath named in planRun's refusals
 * @param {{ excluded?: Set<string>, timings?: unknown }} [options]
 * @returns {{ shards: number[], digest: string, bins: string[][] }}
 */
export function planShards(parsed, listPath, { excluded = new Set(), timings = null } = {}) {
  const { bins } = planRun(parsed, listPath, SHARD_COUNT, { excluded, timings });
  if (bins.length !== SHARD_COUNT) {
    throw new Error(`${SCRIPT}: planRun cut ${bins.length} bins, not ${SHARD_COUNT}`);
  }
  const names = bins.map((bin) => [...bin.names]);
  const shards = names.flatMap((items, i) => (items.length > 0 ? [i + 1] : []));
  return { shards, digest: planDigest(names), bins: names };
}

/**
 * The digest of a partition: every bin's items in order, and the bin count.
 * Two plans digest equal only when every package sits on the same shard.
 *
 * @param {string[][]} bins
 */
export function planDigest(bins) {
  return createHash('sha256').update(JSON.stringify({ shardCount: bins.length, bins })).digest('hex');
}

/**
 * The step outputs, as the runner reads `$GITHUB_OUTPUT`: one `key=value`
 * line each, written in ONE append so a step can never publish one without
 * the other. The array is compact JSON, which `fromJSON` reads as is.
 *
 * @param {{ shards: number[], digest: string }} plan
 */
export function renderOutputs({ shards, digest }) {
  return `shards=${JSON.stringify(shards)}\ndigest=${digest}\n`;
}

/**
 * A shard's cross-check of its own plan against the one its matrix was built
 * from. Pure.
 *
 * @param {{ shards: number[], digest: string }} mine the shard's recomputed plan
 * @param {{ shard: number, expected: string }} input
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function judgeVerify(mine, { shard, expected }) {
  if (!expected) {
    return {
      ok: true,
      lines: [
        `${SCRIPT}: no plan digest reached this shard -- the test-plan job did not publish its outputs, so the matrix is ` +
          `its full fallback roster (1..${SHARD_COUNT}) and every bin runs; there is no unstarted shard to vouch for.`,
      ],
    };
  }
  if (mine.digest !== expected) {
    return {
      ok: false,
      lines: [
        `::error::${SCRIPT}: this shard's partition digests to ${mine.digest}, the plan the matrix was built from to ${expected}. ` +
          `The two computations of the package set disagree, so a bin the plan called empty may hold a package no shard tests. ` +
          `This shard's own plan starts shards ${JSON.stringify(mine.shards)}; compare its "Compute this shard's package set" ` +
          `log with the test-plan job's.`,
      ],
    };
  }
  if (!mine.shards.includes(shard)) {
    return {
      ok: false,
      lines: [
        `::error::${SCRIPT}: shard ${shard}/${SHARD_COUNT} is running, but the plan it matches (${expected}) starts only ` +
          `${JSON.stringify(mine.shards)} -- the matrix was not built from this plan.`,
      ],
    };
  }
  return {
    ok: true,
    lines: [`${SCRIPT}: shard ${shard}/${SHARD_COUNT} matches the plan (${expected}); planned shards ${JSON.stringify(mine.shards)}.`],
  };
}

function parseArgs(argv) {
  const out = { list: null, excluded: new Set(), githubOutput: null, verify: false, shard: null, digest: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--exclude') out.excluded.add(argv[++i]);
    else if (arg === '--github-output') out.githubOutput = argv[++i];
    else if (arg === '--verify') out.verify = true;
    else if (arg === '--shard') out.shard = Number(argv[++i]);
    else if (arg === '--digest') out.digest = argv[++i] ?? '';
    else if (!arg.startsWith('--') && out.list === null) out.list = arg;
    else throw new Error(`${SCRIPT}: unrecognized argument: ${arg}`);
  }
  return out;
}

function main(argv) {
  if (argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        `\n✗ ${SCRIPT} self-test: selfTest() returned without reaching its verdict,\n` +
          'so no success line was printed. Exiting 0 here would report a self-test\n' +
          'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    return;
  }
  const args = parseArgs(argv);
  if (!args.list) {
    console.error(`usage: ${SCRIPT}.mjs <turbo-ls.json> --exclude <pkg> (--github-output <file> | --verify --shard <k> --digest <hex>)`);
    process.exit(1);
  }
  const plan = planShards(JSON.parse(readFileSync(args.list, 'utf8')), args.list, { excluded: args.excluded });
  if (args.verify) {
    if (!Number.isInteger(args.shard) || args.shard < 1 || args.shard > SHARD_COUNT || args.digest === null) {
      console.error(`${SCRIPT} --verify needs --shard <1..${SHARD_COUNT}> and --digest <hex> (an empty value is the fallback roster)`);
      process.exit(1);
    }
    const verdict = judgeVerify(plan, { shard: args.shard, expected: args.digest });
    for (const line of verdict.lines) console.log(line);
    if (!verdict.ok) process.exit(1);
    return;
  }
  if (!args.githubOutput) {
    console.error(`${SCRIPT}: a plan run needs --github-output <file>`);
    process.exit(1);
  }
  plan.bins.forEach((items, i) => {
    console.log(`  Test Core (${i + 1}/${SHARD_COUNT}): ${items.length === 0 ? 'empty -- not started' : items.join(', ')}`);
  });
  console.log(
    plan.shards.length === 0
      ? `Plan: no package to test -- no Test Core shard starts (digest ${plan.digest}).`
      : `Plan: ${plan.shards.length} of ${SHARD_COUNT} Test Core shard(s) start, ${JSON.stringify(plan.shards)} (digest ${plan.digest}).`,
  );
  appendFileSync(args.githubOutput, renderOutputs(plan));
}

// -- Self-test ----------------------------------------------------------------
//
// Battery names pinned with a floor each, the roster size pinned too, and a
// verdict handshake (AGENTS.md, "Writing a `--self-test`"; the shape is
// check-agent-model-declared.mjs's, copied, never imported).

const SELF_TEST_BATTERIES = Object.freeze({
  'the plan starts exactly the bins that hold work': 5,
  'the digest moves with any item and only then': 3,
  'a shard vouches for the plan, or reds naming both digests': 5,
  'the step outputs: both keys in one write, fromJSON-readable': 3,
  'ci.yml carries the plan, the fromJSON matrix with its full fallback, and the shard-side check': 7,
});
const SELF_TEST_BATTERY_FLOOR = 5;
const UNATTRIBUTED_BATTERY = '(no battery open)';
const SELF_TEST_VERDICT = `${SCRIPT} self-test reached its verdict`;

function selfTest() {
  const seen = new Map();
  let open = null;
  const failures = [];
  const battery = (name) => {
    open = name;
  };
  const check = (condition, label) => {
    const b = open ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
    if (!condition) failures.push(`[${b}] ${label}`);
  };

  // Fixture weights, so the partition is a pure function of this file. Real
  // package names and paths: planRun weighs an unmeasured package by its
  // test files on disk, and these are all measured here.
  const timings = { secondsPerTestFileFallback: 2, packages: { '@objectstack/spec': 900, '@objectstack/formula': 40, '@objectstack/rest': 300 } };
  const doc = (names) => ({
    packages: {
      count: names.length,
      items: names.map((name) => ({ name, path: `packages/${name.replace('@objectstack/', '')}` })),
    },
  });
  const plan = (names) => planShards(doc(names), 'fixture.json', { timings });

  battery('the plan starts exactly the bins that hold work');
  const none = plan([]);
  check(JSON.stringify(none.shards) === '[]', `an empty package list starts no shard (got ${JSON.stringify(none.shards)})`);
  const one = plan(['@objectstack/formula']);
  check(one.shards.length === 1, `one package starts one shard (got ${JSON.stringify(one.shards)})`);
  const three = plan(['@objectstack/spec', '@objectstack/formula', '@objectstack/rest']);
  check(three.shards.length === 3, `three packages over eight bins start three shards (got ${JSON.stringify(three.shards)})`);
  check(
    three.shards.every((k) => three.bins[k - 1].length > 0) &&
      three.bins.every((items, i) => items.length > 0 === three.shards.includes(i + 1)),
    'a shard is started if and only if its bin holds an item',
  );
  check(three.bins.length === SHARD_COUNT, `the bins are cut at SHARD_COUNT (${SHARD_COUNT}), never at the planned count`);

  battery('the digest moves with any item and only then');
  check(plan(['@objectstack/formula']).digest === one.digest, 'the same list digests the same twice');
  check(three.digest !== one.digest, 'a different list digests differently');
  const moved = three.bins.map((items) => [...items]);
  const [from, to] = [three.shards[0] - 1, three.shards[1] - 1];
  moved[to].push(moved[from].pop());
  check(planDigest(moved) !== three.digest, 'one item moved to another bin digests differently');

  battery('a shard vouches for the plan, or reds naming both digests');
  const k = three.shards[0];
  check(judgeVerify(three, { shard: k, expected: three.digest }).ok, 'a planned shard whose own plan matches passes');
  const drift = judgeVerify(three, { shard: k, expected: one.digest });
  check(!drift.ok && drift.lines.some((l) => l.includes(three.digest) && l.includes(one.digest)), 'a drifted plan reds, naming both digests');
  const unplanned = three.bins.findIndex((items) => items.length === 0) + 1;
  check(!judgeVerify(three, { shard: unplanned, expected: three.digest }).ok, 'a running shard the matching plan did not start reds');
  const fallback = judgeVerify(three, { shard: unplanned, expected: '' });
  check(fallback.ok && fallback.lines.some((l) => l.includes('fallback')), 'an empty digest is the full fallback roster: passes, and says so');
  check(!judgeVerify(none, { shard: 1, expected: none.digest }).ok, 'no shard can vouch for an empty plan: any running shard reds');

  battery('the step outputs: both keys in one write, fromJSON-readable');
  const rendered = renderOutputs(three);
  const lines = rendered.trimEnd().split('\n');
  check(lines.length === 2 && lines[0].startsWith('shards=') && lines[1] === `digest=${three.digest}`, 'two lines, shards then digest');
  check(JSON.stringify(JSON.parse(lines[0].slice('shards='.length))) === JSON.stringify(three.shards), 'the shards value parses back to the plan');
  check(renderOutputs(none).startsWith('shards=[]\n'), "an empty plan publishes the literal `[]` the test job's `if:` compares with");

  battery('ci.yml carries the plan, the fromJSON matrix with its full fallback, and the shard-side check');
  const ci = readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const fullRoster = `'${JSON.stringify(Array.from({ length: SHARD_COUNT }, (_, i) => i + 1)).replaceAll(',', ', ')}'`;
  const matrixExpr = `\${{ fromJSON(needs.test-plan.outputs.shards || ${fullRoster}) }}`;
  check(ci.includes(`        shard: ${matrixExpr}\n`), `the test job's matrix is ${matrixExpr}`);
  check(ci.includes("needs.test-plan.outputs.shards != '[]'"), "the test job skips on an empty plan (`!= '[]'`)");
  check(ci.includes(`OS_TEST_PLAN: \${{ needs.test-plan.outputs.shards || ${fullRoster} }}`), "the gate reads the matrix's own expression");
  check(/--github-output "\$GITHUB_OUTPUT"/.test(ci) && ci.includes('node scripts/ci/plan-test-core-shards.mjs "$RUNNER_TEMP/turbo-ls.json"'), 'the test-plan job runs this script');
  check(ci.includes('node scripts/ci/plan-test-core-shards.mjs --verify "$RUNNER_TEMP/turbo-ls.json"'), 'every shard runs --verify');
  check(ci.includes('OS_SHARD_PLAN_DIGEST: ${{ needs.test-plan.outputs.digest }}'), 'the shard receives the digest with no fallback (empty = fallback roster)');
  check(/test-plan:\n(?:.*\n)*?\s+digest: \$\{\{ steps\.plan\.outputs\.digest \}\}/.test(ci), 'the test-plan job publishes the digest output');

  // The floor (#13489): every declared battery ran its cases.
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) failures.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}`);
  for (const [name, count] of seen) {
    if (!declared.includes(name)) failures.push(`battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES`);
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      failures.push(
        count === 0
          ? `battery "${name}" DID NOT RUN -- 0 cases, ${SELF_TEST_BATTERIES[name]} pinned`
          : `battery "${name}" registered ${count} case(s), below its floor of ${SELF_TEST_BATTERIES[name]}`,
      );
    }
  }
  if (failures.length > 0) {
    for (const f of failures) console.error(`✗ ${f}`);
    console.error(`\n✗ ${SCRIPT} self-test: ${failures.length} failure(s).`);
    process.exit(1);
  }
  const cases = [...seen.values()].reduce((a, b) => a + b, 0);
  console.log(`✓ ${SCRIPT} self-test: ${cases} case(s) across ${declared.length} batteries.`);
  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2));
}
