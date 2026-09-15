#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * merged-result probe (#16287) — run a tree-reading gate against the MERGED
 * result of a branch and its base, instead of against either side.
 *
 *   node scripts/check-merged-result.mjs --base origin/main -- node scripts/pm/check-skill-line-ratchet.mjs
 *   node scripts/check-merged-result.mjs --base origin/main --path AGENTS.md --path scripts -- <gate argv...>
 *   node scripts/check-merged-result.mjs --self-test
 *
 * Exit codes — three, never two:
 *
 *   0  WITHIN BUDGET   the gate is green on the merged tree
 *   1  FINDING         the gate is red on the merged tree
 *   3  NOT MEASURED    the probe could not reach a reading (loud, never a pass)
 *
 * ## The defect: a budget is not in the definition domain of a textual merge
 *
 * A PR that adds one line to a file under a shrink-only ceiling can be
 * textually clean and still over budget, whenever a sibling PR compresses that
 * file and re-anchors its ceiling in between. Measured on PR #15427: the branch
 * added ONE line to `AGENTS.md` when the file stood at 1161 against a ceiling of
 * 1162; while it waited two days for review the #15379 compression took the file
 * to 1058 and, by its own shrink-only discipline, re-locked the ceiling to 1058
 * — correct behaviour, and it took back the single line of headroom the open
 * branch had been paid from. The merged tree measured 1059 against 1058.
 *
 * Three signals read clean, and all three were RIGHT:
 *
 *   the PR's own CI    green   ran days earlier, against the OLD file and the
 *                              OLD ceiling
 *   `mergeable_state`  clean   answers "do the texts conflict", nothing else
 *   `git merge-tree`   clean   same question, same blind spot
 *
 * There is no textual conflict here at all — one side deletes lines elsewhere,
 * the other adds one, and git composes them perfectly. What broke is a BUDGET,
 * and no textual check has a concept of one. So the repair is not a better
 * textual check: it is to hand an existing budget gate a different TREE.
 *
 * ⛔ Not a merge-queue failure. The queue is the thing that WOULD have caught
 * it, which is why it exists. What this probe buys is the same answer before a
 * full CI cycle and a queue drop whose reason is visible only in the queue's own
 * logs.
 *
 * ## Why the mode lives HERE and not as a `--base` flag inside each gate
 *
 * Three reasons, and the second is a correctness argument rather than a
 * convenience one.
 *
 *   1. **The gates are deliberately hermetic.** `check-skill-line-ratchet`'s own
 *      header refuses an in-gate baseline mode in writing: it "would read a ref
 *      that a shallow clone need not have and that a sibling's fetch moves under
 *      the run". That objection is right and it still holds. Keeping the ref
 *      reading in ONE component outside the gates preserves it — a gate still
 *      reads a working tree and its own map, and this probe is the single place
 *      allowed to need refs.
 *
 *   2. **The CEILING is part of the merged tree too.** A `--base` flag inside a
 *      gate would compare the merged FILE against the ceiling in the RUNNING
 *      copy of the script — the branch's copy. In the #15427 shape the ceiling
 *      moved on the base side, so the branch's copy still said 1162 and the flag
 *      would have measured 1059 against 1162 and gone green. This probe runs the
 *      MERGED TREE'S OWN COPY of the gate, so the measured file and the number it
 *      is measured against come from the same tree. The self-test pins exactly
 *      this: its fixture's branch copy carries a stale, roomier ceiling, and the
 *      probe still reds.
 *
 *   3. **The class is wider than one gate.** The same shape applies to every
 *      budget in this repo that is PINNED rather than derived — the max
 *      table-row bytes map in that same script, `check:skills-token-ratchet`,
 *      `check:type-check-debt`, and the source-token ratchets in the app repos.
 *      One runner covers every tree-reading gate with no gate edited, against N
 *      edits across N owners.
 *
 * ## The placement NOT taken, and what it cost when measured
 *
 * The alternative on the card is an OUTBOUND check on the compressing PR: when a
 * PR lowers a ceiling, enumerate the open PRs touching that file and report which
 * would now exceed it. It names the right owner — the change that removes the
 * budget rather than the one that had already paid from it — and that instinct is
 * the repo's usual one.
 *
 * It was refused on two measured grounds, not on taste:
 *
 *   - **It cannot see half the class.** It keys on "a PR LOWERS a ceiling", while
 *     the class is "the merged result exceeds the budget". With headroom h, a
 *     sibling that merely ADDS h lines and touches no ceiling blows the same
 *     budget for the same open branch, and nothing about that PR fires an
 *     outbound check. The self-test carries that case (`no ceiling moved`)
 *     precisely because it is the one the outbound placement is structurally
 *     blind to.
 *   - **Its failure mode is under-reporting.** It needs a live GitHub read at
 *     gate time. Re-measured on this board the day this landed: 1 list call plus
 *     one file-listing call per open PR — 14 calls for 13 open PRs, 6.6 s wall,
 *     4 of those 13 touching a ratcheted path — against a gate population that is
 *     deliberately hermetic and token-free. A read that fails answers "no
 *     affected PRs", which is the very reading — clean because it was never
 *     looking — this card is about.
 *
 * Both are recorded rather than argued: the probe below needs no network, no
 * credentials and no token. Measured here against `origin/main` with the line
 * ratchet as the gate: 0.9 s end to end scoped with `--path` (both trees
 * materialised, both gate runs included), 3.7 s materialising the whole tree.
 *
 * ## Where it runs
 *
 * On demand, before a branch is enqueued — the moment the incident's cost is
 * still avoidable. It is deliberately NOT a `pull_request` CI step: a
 * `pull_request` checkout already builds a merge commit, and it is already
 * stale for the same reason the PR's own CI was; and the merge queue already
 * runs the real thing at the one moment it is authoritative. This probe is the
 * cheap early reading between those two, which is exactly what was missing.
 *
 * `pnpm check:merged-result` is therefore this file's `--self-test` and nothing
 * else — it grades the instrument, ⛔ never a tree. Wiring that self-test into CI
 * is one workflow step and is NOT done here: this card's claim did not extend to
 * `.github/workflows/**`, so until a maintainer adds it, the instrument is
 * protected by whoever runs it.
 *
 * ## The reading discipline this probe holds itself to
 *
 * Every child is spawned with `spawnSync` and its status read from the result
 * object — never through a shell pipe, where `| head` closes the read end and
 * the producer exits 0 on SIGPIPE, and never from a bare `$?` after a pipeline.
 * `status === null` (killed by a signal, or never spawned) is NOT MEASURED, not
 * a pass.
 *
 * Bytes are counted with `Buffer.byteLength`, which is unconditional. ⚠️ The
 * shell skeleton on the card reaches for `LC_ALL=C awk '{print length}'`, and
 * the `LC_ALL=C` there is a PORTABILITY GUARD whose absence is invisible on most
 * machines: under `mawk` — Debian's and this image's `/usr/bin/awk` — `length`
 * is byte-based in EVERY locale, so dropping `LC_ALL=C` changes nothing and the
 * bug ships to whoever runs `gawk`, where a UTF-8 locale counts CHARACTERS and a
 * 3-byte-per-character corpus under-reports threefold. Measured on this image,
 * both halves separately: `mawk` and `/usr/bin/nawk` each answer 9 for three Han
 * characters with `LC_ALL` unset and with `LC_ALL=C` — so the guard is a no-op
 * HERE and its absence is unfalsifiable HERE; no `gawk` is installed, so the
 * divergent half is documented behaviour rather than a local reading, which is
 * exactly why it must not be left to `awk` at all. A byte budget measured by
 * `awk` is therefore a budget whose meaning depends on the operator's `awk`; the
 * self-test's Chinese positive control pins the byte reading through a fixture
 * line that is legal by characters and illegal by bytes.
 *
 * ## What it does not do
 *
 * The merged tree is materialised from `git archive` alone — there is no install
 * step, so a gate that needs installed dependencies is out of reach unless the
 * caller's own `node_modules` happens to satisfy it (the probe symlinks the
 * repo-root one when it exists, and says so). A gate that fails for that reason
 * fails loudly with its own output attached; it is not silently a budget
 * finding.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { isEntrypoint } from './invoked-as.mjs';

/** The gate is green on the merged tree. */
export const EXIT_OK = 0;
/** The gate is RED on the merged tree. */
export const EXIT_FINDING = 1;
/**
 * The probe could not reach a reading. Deliberately NOT 1: a wiring failure that
 * borrows the finding code is the defect #16329 recorded, and a wiring failure
 * that borrows 0 is the one this whole card is about.
 */
export const EXIT_NOT_MEASURED = 3;

const TAG = 'check-merged-result';

/** Spawn a child and hand back a status that can never be mistaken for 0. */
function spawn(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  return {
    status: r.status,
    signal: r.signal,
    error: r.error,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

function git(args, cwd) {
  return spawn('git', args, { cwd });
}

/**
 * Parse argv into a plan. Pure, so the refusals are pinned by cases.
 *
 * @param {string[]} argv  Arguments AFTER `node <script>`.
 */
export function parseArgv(argv) {
  const plan = { base: 'origin/main', head: 'HEAD', paths: [], gate: [], selfTest: false, error: null };
  const sep = argv.indexOf('--');
  const flags = sep === -1 ? argv : argv.slice(0, sep);
  plan.gate = sep === -1 ? [] : argv.slice(sep + 1);

  for (let i = 0; i < flags.length; i++) {
    const a = flags[i];
    if (a === '--self-test') { plan.selfTest = true; continue; }
    if (a === '--base' || a === '--head' || a === '--path') {
      const v = flags[i + 1];
      if (v === undefined) { plan.error = `${a} needs a value.`; return plan; }
      i++;
      if (a === '--base') plan.base = v;
      else if (a === '--head') plan.head = v;
      else plan.paths.push(v);
      continue;
    }
    plan.error = `unknown argument ${JSON.stringify(a)} — the gate to run goes after a bare \`--\`.`;
    return plan;
  }

  if (!plan.selfTest && plan.gate.length === 0) {
    // The firing control for zero: a probe with no gate to run measures nothing,
    // and "nothing was measured" must never print as "nothing was found".
    plan.error =
      'no gate to run — put it after a bare `--`, e.g. '
      + '`--base origin/main -- node scripts/pm/check-skill-line-ratchet.mjs`. '
      + 'A run with no gate measures nothing, and this probe refuses to report that as a pass.';
  }
  return plan;
}

/**
 * The merged tree of `base` and `head`, as `git merge-tree --write-tree` writes
 * it into the object database.
 *
 * @returns {{ ok: boolean, tree?: string, reason?: string }}
 */
export function mergedTree(repo, base, head) {
  const r = git(['merge-tree', '--write-tree', base, head], repo);
  if (r.status === 0) {
    const tree = r.stdout.split('\n')[0].trim();
    if (!/^[0-9a-f]{40}$/.test(tree)) {
      return { ok: false, reason: `git merge-tree exited 0 but printed no tree oid: ${JSON.stringify(r.stdout.slice(0, 200))}` };
    }
    return { ok: true, tree };
  }
  if (r.status === 1) {
    return {
      ok: false,
      reason:
        'the two sides CONFLICT textually, so there is no merged result to measure. '
        + 'This probe answers the budget question only once the texts compose; resolve the conflict first.',
    };
  }
  const detail = `${r.stderr}${r.stdout}`.trim().slice(0, 400);
  if (/unknown option|usage: git merge-tree/i.test(detail)) {
    return { ok: false, reason: `this git has no \`merge-tree --write-tree\` (needs git >= 2.38): ${detail}` };
  }
  return { ok: false, reason: `git merge-tree could not run (status ${r.status}, signal ${r.signal ?? 'none'}): ${detail}` };
}

/**
 * Write `treeish` into `dir`, optionally scoped to `paths`.
 *
 * `git archive` to a file, then `tar -x` — two spawns whose statuses are read
 * from the result objects. A pipeline between them would put the producer's exit
 * code behind the consumer's.
 */
export function materialize(repo, treeish, paths, dir) {
  mkdirSync(dir, { recursive: true });
  const tar = join(dir, '.merged-result.tar');
  const args = ['archive', '--format=tar', '-o', tar, treeish];
  if (paths.length) args.push('--', ...paths);
  const a = git(args, repo);
  if (a.status !== 0) {
    return { ok: false, reason: `git archive ${treeish} failed (status ${a.status}): ${`${a.stderr}${a.stdout}`.trim().slice(0, 400)}` };
  }
  const root = join(dir, 'tree');
  mkdirSync(root, { recursive: true });
  const x = spawn('tar', ['-xf', tar, '-C', root]);
  if (x.status !== 0) {
    return { ok: false, reason: `tar could not extract the merged tree (status ${x.status}): ${`${x.stderr}${x.stdout}`.trim().slice(0, 400)}` };
  }
  rmSync(tar, { force: true });
  const modules = join(repo, 'node_modules');
  let linked = false;
  if (existsSync(modules)) {
    try { symlinkSync(modules, join(root, 'node_modules'), 'dir'); linked = true; } catch { linked = false; }
  }
  return { ok: true, root, linked };
}

/**
 * Run `gate` with its cwd at `root`.
 *
 * A child that never started, or one a signal killed, is NOT MEASURED — the one
 * reading this probe must never launder into a green.
 */
export function runGate(gate, root) {
  const r = spawn(gate[0], gate.slice(1), { cwd: root });
  if (r.error || r.status === null) {
    return {
      measured: false,
      reason:
        `the gate ${JSON.stringify(gate.join(' '))} did not produce an exit status`
        + `${r.signal ? ` (killed by ${r.signal})` : ''}${r.error ? `: ${r.error.message}` : ''}.`,
      out: `${r.stdout}${r.stderr}`,
    };
  }
  return { measured: true, status: r.status, out: `${r.stdout}${r.stderr}` };
}

const tail = (text, n = 24) => text.split('\n').filter(Boolean).slice(-n).join('\n');

/**
 * The whole probe. Returns an exit code; prints its own reading.
 *
 * @param {string[]} argv  Arguments AFTER `node <script>`.
 * @param {{ repo?: string, log?: (s: string) => void, err?: (s: string) => void }} io
 */
export function probe(argv, io = {}) {
  const repo = io.repo ?? process.cwd();
  const log = io.log ?? ((s) => console.log(s));
  const err = io.err ?? ((s) => console.error(s));
  const notMeasured = (reason) => {
    err(`✗ ${TAG}: NOT MEASURED — ${reason}`);
    return EXIT_NOT_MEASURED;
  };

  const plan = parseArgv(argv);
  if (plan.error) return notMeasured(plan.error);

  const oid = (ref) => {
    const r = git(['rev-parse', '--verify', `${ref}^{commit}`], repo);
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const baseOid = oid(plan.base);
  if (!baseOid) return notMeasured(`\`${plan.base}\` does not resolve to a commit in ${repo} — fetch it rather than skipping the reading.`);
  const headOid = oid(plan.head);
  if (!headOid) return notMeasured(`\`${plan.head}\` does not resolve to a commit in ${repo}.`);

  const merged = mergedTree(repo, baseOid, headOid);
  if (!merged.ok) return notMeasured(merged.reason);

  const headTree = git(['rev-parse', `${headOid}^{tree}`], repo);
  if (headTree.status !== 0) return notMeasured(`cannot resolve the head tree of ${headOid}.`);
  const headTreeOid = headTree.stdout.trim();

  log(`ℹ️  ${TAG}: base ${plan.base} ${baseOid.slice(0, 9)} · head ${plan.head} ${headOid.slice(0, 9)} · merged tree ${merged.tree.slice(0, 9)}`);
  log(`ℹ️  ${TAG}: gate ${JSON.stringify(plan.gate.join(' '))}${plan.paths.length ? ` · materialising ${plan.paths.join(' ')}` : ' · materialising the whole tree'}`);

  const dir = mkdtempSync(join(tmpdir(), 'merged-result-'));
  try {
    const readings = {};
    for (const [label, treeish] of [['branch', headTreeOid], ['merged', merged.tree]]) {
      const m = materialize(repo, treeish, plan.paths, join(dir, label));
      if (!m.ok) return notMeasured(m.reason);
      if (label === 'branch' && m.linked) log(`ℹ️  ${TAG}: symlinked the repo-root node_modules into each materialised tree (no install step is run).`);
      const g = runGate(plan.gate, m.root);
      if (!g.measured) return notMeasured(`${g.reason}${g.out ? `\n${tail(g.out, 12)}` : ''}`);
      readings[label] = g;
      log(`ℹ️  ${TAG}: the ${label} tree — gate exit ${g.status}`);
    }

    const { branch, merged: mergedRun } = readings;
    if (mergedRun.status === 0) {
      if (merged.tree === headTreeOid) {
        log(`ℹ️  ${TAG}: the merged tree EQUALS the head tree — the base is already an ancestor, so this reading adds nothing over the branch's own run.`);
      }
      if (branch.status !== 0) {
        log(`⚠️  ${TAG}: the BRANCH is red on its own (exit ${branch.status}) and the merge repairs it — the branch's own CI is still red, and that is a separate thing to fix.`);
      }
      log(`✓ ${TAG}: WITHIN BUDGET — ${JSON.stringify(plan.gate.join(' '))} is green on the merged result of ${plan.base} and ${plan.head}.`);
      return EXIT_OK;
    }

    if (branch.status !== 0) {
      err(`✗ ${TAG}: the gate is red on the merged tree (exit ${mergedRun.status}) — but it is ALREADY red on the branch alone (exit ${branch.status}), so this is NOT a merged-result finding. Fix the branch first, then re-read.`);
      err(tail(mergedRun.out));
      return EXIT_FINDING;
    }

    err(
      `✗ ${TAG}: FINDING — the branch is GREEN on its own (gate exit 0) and RED on the merged result (exit ${mergedRun.status}). `
      + 'This is the class: no textual conflict, a budget blown by composition. The merged tree carries BOTH the measured '
      + 'file and the number it is measured against, so the branch\'s own CI cannot see this and neither can '
      + '`mergeable_state` or `git merge-tree` — all three answer a textual question. Pay the budget down on this branch, '
      + 'or take the ceiling question to whoever moved it.',
    );
    err(tail(mergedRun.out));
    return EXIT_FINDING;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── The self-test's own battery roster and floor ───────────────────────────
//
// Success here used to be expressible as "no failure was recorded", which reads
// the same whether every case held or no case ran. The roster is the repair:
// every section opens with `battery('<name>')`, every assertion is attributed to
// the battery most recently opened, and the floor requires the OPENED set to
// equal the DECLARED set with each battery at or above its own count.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running.
const SELF_TEST_BATTERIES = Object.freeze({
  'argv, and the refusals that are not passes': 7,
  'the card\'s shape: a ceiling re-anchored under an open branch': 4,
  'the shape the outbound placement cannot see: no ceiling moved': 2,
  'the green control, and zero that had to fire': 3,
  'bytes, not characters — the Chinese positive control': 3,
  'the readings that are NOT findings': 4,
});

// Deleting an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 6;

/** The key an assertion is filed under when no battery is open. */
const UNATTRIBUTED_BATTERY = '(no battery open)';

const batteryCases = new Map();
let openBattery = null;

/** Open a battery. Every assertion after this line is attributed to it. */
function battery(name) {
  openBattery = name;
}

/** Called by the self-test's own assertion sink, once per assertion. */
function registerCase() {
  const name = openBattery ?? UNATTRIBUTED_BATTERY;
  batteryCases.set(name, (batteryCases.get(name) ?? 0) + 1);
}

/** The floor: every declared battery RAN, and ran its cases. */
function batteryFloorFailures() {
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} `
        + '— a battery deleted from the roster takes its own floor with it.',
    );
  }
  for (const [name, count] of batteryCases) {
    if (declared.includes(name)) continue;
    problems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES `
        + '— an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} `
          + '— cases that used to run no longer do.',
    );
  }
  return problems;
}

// ── The fixture: a real git repository with a real in-tree gate ────────────
//
// A model of a merge would pass against an implementation that reads the branch
// copy of the gate — which is the exact defect the placement argument above
// turns on. So the fixture commits a GATE INTO THE TREE, whose ceiling therefore
// merges like any other content, and the probe is judged on what it reports.

const FIXTURE_GATE = (ceiling, maxLineBytes) => `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const CEILING = ${ceiling};
const MAX_LINE_BYTES = ${maxLineBytes};
const text = readFileSync(new URL('budget.md', import.meta.url), 'utf8');
const lines = text.split('\\n');
if (text.endsWith('\\n')) lines.pop();
let bad = 0;
if (lines.length > CEILING) {
  console.error(\`fixture-gate: budget.md is \${lines.length} lines; the ceiling is \${CEILING}.\`);
  bad++;
}
for (let i = 0; i < lines.length; i++) {
  const b = Buffer.byteLength(lines[i], 'utf8');
  if (b > MAX_LINE_BYTES) {
    console.error(\`fixture-gate: L\${i + 1} is \${b} bytes; the max-line-bytes pin is \${MAX_LINE_BYTES}.\`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log(\`fixture-gate: budget.md is \${lines.length} lines (ceiling \${CEILING}).\`);
`;

const GIT_ID = [
  '-c', 'user.name=merged-result self-test',
  '-c', 'user.email=merged-result@example.invalid',
  '-c', 'commit.gpgsign=false',
];

function fixtureRepo(dir) {
  const g = (...args) => {
    const r = git([...GIT_ID, ...args], dir);
    if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
    return r.stdout.trim();
  };
  const write = (rel, body) => writeFileSync(join(dir, rel), body);
  const commit = (msg) => { g('add', '-A'); g('commit', '-q', '-m', msg); return g('rev-parse', 'HEAD'); };
  const from = (start, branch) => g('checkout', '-q', '-B', branch, start);
  const rules = (n) => Array.from({ length: n }, (_, i) => `rule ${i + 1}`);
  const file = (lines) => `${lines.join('\n')}\n`;

  const init = git(['init', '-q', '-b', 'seed', dir]);
  if (init.status !== 0) throw new Error(`fixture git init failed: ${init.stderr || init.stdout}`);

  // seed — 10 lines, ceiling 12, so the branch below has real headroom.
  write('budget.md', file(rules(10)));
  write('gate.mjs', FIXTURE_GATE(12, 200));
  write('untouched.txt', 'not part of any gate\n');
  const seed = commit('seed');

  // The open branch: ONE line added at the END. Green on its own, and it never
  // touches the gate, so its copy of the ceiling stays the roomy 12.
  from(seed, 'branch');
  write('budget.md', file([...rules(10), 'rule 11 — the line the branch adds']));
  const branch = commit('the open branch adds one line');

  // mainA — the card's incident: the file is compressed at the TOP and the
  // ceiling is re-anchored to the new count. Green on its own.
  from(seed, 'mainA');
  write('budget.md', file(rules(10).slice(3)));
  write('gate.mjs', FIXTURE_GATE(7, 200));
  const mainA = commit('compress and re-anchor the ceiling');

  // mainB — NO ceiling moved at all: the base simply spends the headroom, in
  // the MIDDLE so the texts still compose with the branch's trailing line.
  from(seed, 'mainB');
  write('budget.md', file([...rules(3), 'extra a', 'extra b', ...rules(10).slice(3)]));
  const mainB = commit('spend the headroom, touch no ceiling');

  // mainG — mainA's compression with the ceiling left alone, so the merged
  // result fits. The green half of the firing control.
  from(seed, 'mainG');
  write('budget.md', file(rules(10).slice(3)));
  const mainG = commit('compress without re-anchoring');

  // mainC — the byte pin is tightened from 200 to 120.
  from(seed, 'mainC');
  write('gate.mjs', FIXTURE_GATE(12, 120));
  const mainC = commit('tighten the max-line-bytes pin');

  // branchCJK — a line of 41 Han characters: 41 by characters, 123 by bytes.
  // Green against the seed's 200-byte pin.
  const CJK_LINE = '中'.repeat(41);
  from(seed, 'branchCJK');
  write('budget.md', file([...rules(10), CJK_LINE]));
  const branchCJK = commit('a Chinese line, legal by characters');

  // branchRed — already over the ceiling on its own, before any merge.
  from(seed, 'branchRed');
  write('budget.md', file(rules(14)));
  const branchRed = commit('a branch that is red before any merge');

  // mainX — edits the same trailing line the branch does, so the texts conflict.
  from(seed, 'mainX');
  write('budget.md', file([...rules(10), 'rule 11 — but main said something else here']));
  const mainX = commit('a real textual conflict');

  g('checkout', '-q', 'branch');
  return { seed, branch, mainA, mainB, mainG, mainC, branchCJK, branchRed, mainX, CJK_LINE };
}

// Set only after the verdict is printed, and read at the dispatch: a `return`
// above that line prints nothing and still exits 0 — a self-test that never
// finished, reported as one that passed.
let selfTestReachedVerdict = false;

export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => {
    registerCase();
    return cases.push({ name, ok: Boolean(ok), detail });
  };

  const dir = mkdtempSync(join(tmpdir(), 'merged-result-selftest-'));
  try {
    const fx = fixtureRepo(dir);
    const sink = [];
    const io = { repo: dir, log: (s) => sink.push(s), err: (s) => sink.push(s) };
    const run = (argv) => { sink.length = 0; const code = probe(argv, io); return { code, out: sink.join('\n') }; };
    const GATE = ['--', process.execPath, 'gate.mjs'];

    // ── argv, and the refusals that are not passes ─────────────────────────
    battery('argv, and the refusals that are not passes');
    t('a bare `--` splits flags from the gate argv', JSON.stringify(parseArgv(['--base', 'x', '--', 'node', 'g.mjs'])).includes('"gate":["node","g.mjs"]'));
    t('no gate is an ERROR, not an empty run', Boolean(parseArgv(['--base', 'x']).error));
    t('an unknown flag is refused rather than ignored', Boolean(parseArgv(['--nope', '--', 'node', 'g.mjs']).error));
    t('a value-less --base is refused', Boolean(parseArgv(['--base']).error));
    const noGate = run(['--base', fx.mainA]);
    t('a run with no gate exits NOT MEASURED, never 0', noGate.code === EXIT_NOT_MEASURED && /NOT MEASURED/.test(noGate.out), `code=${noGate.code}`);
    const badRef = run(['--base', 'refs/heads/no-such-branch', ...GATE]);
    t('an unresolvable base is NOT MEASURED, never a skip', badRef.code === EXIT_NOT_MEASURED && /does not resolve/.test(badRef.out), `code=${badRef.code}`);
    const missing = run(['--base', fx.mainA, '--', process.execPath, 'no-such-gate-file.mjs']);
    t('a gate that cannot run is a FINDING or NOT MEASURED, never green', missing.code !== EXIT_OK, `code=${missing.code}`);

    // ── the card's shape ──────────────────────────────────────────────────
    battery('the card\'s shape: a ceiling re-anchored under an open branch');
    const branchAlone = run(['--base', fx.seed, ...GATE]);
    t('the branch is GREEN against the tree it was written on', branchAlone.code === EXIT_OK, `code=${branchAlone.code}\n${branchAlone.out}`);
    const mt = mergedTree(dir, fx.mainA, fx.branch);
    t('git merge-tree reports NO conflict — the texts compose perfectly', mt.ok, JSON.stringify(mt));
    const incident = run(['--base', fx.mainA, ...GATE]);
    t('the merged result is RED while the branch alone is green', incident.code === EXIT_FINDING && /FINDING/.test(incident.out), `code=${incident.code}\n${incident.out}`);
    // The correctness case for the placement: the BRANCH's copy of the gate
    // still says 12, so a `--base` flag inside the gate would have measured 8
    // against 12 and gone green. Only the merged tree's own copy says 7.
    t('the ceiling is read from the MERGED tree, not the branch\'s copy', /the ceiling is 7/.test(incident.out), incident.out);

    // ── the shape the outbound placement cannot see ───────────────────────
    battery('the shape the outbound placement cannot see: no ceiling moved');
    const noCeilingMove = run(['--base', fx.mainB, ...GATE]);
    t('a base that only SPENDS headroom blows the same budget', noCeilingMove.code === EXIT_FINDING, `code=${noCeilingMove.code}\n${noCeilingMove.out}`);
    t('...and it moved no ceiling, so nothing outbound would have fired', /is 13 lines; the ceiling is 12/.test(noCeilingMove.out), noCeilingMove.out);

    // ── the green control, and zero that had to fire ──────────────────────
    battery('the green control, and zero that had to fire');
    const green = run(['--base', fx.mainG, ...GATE]);
    t('the same branch against a base that kept its ceiling is GREEN', green.code === EXIT_OK && /WITHIN BUDGET/.test(green.out), `code=${green.code}\n${green.out}`);
    t('the green and red readings differ ONLY in the base', green.code === EXIT_OK && incident.code === EXIT_FINDING);
    const ff = run(['--base', fx.seed, ...GATE]);
    t('a base that is already an ancestor says so instead of claiming news', /adds nothing over the branch/.test(ff.out), ff.out);

    // ── bytes, not characters ─────────────────────────────────────────────
    battery('bytes, not characters — the Chinese positive control');
    t('the fixture line is UNDER the pin by characters', [...fx.CJK_LINE].length === 41 && 41 <= 120);
    t('...and OVER it by bytes', Buffer.byteLength(fx.CJK_LINE, 'utf8') === 123 && 123 > 120);
    const cjk = run(['--base', fx.mainC, '--head', fx.branchCJK, ...GATE]);
    t('so the merged result is RED — a character count would have passed it', cjk.code === EXIT_FINDING && /is 123 bytes/.test(cjk.out), `code=${cjk.code}\n${cjk.out}`);

    // ── the readings that are NOT findings ────────────────────────────────
    battery('the readings that are NOT findings');
    const conflict = run(['--base', fx.mainX, ...GATE]);
    t('a textual conflict is NOT MEASURED, not a finding', conflict.code === EXIT_NOT_MEASURED && /CONFLICT/.test(conflict.out), `code=${conflict.code}\n${conflict.out}`);
    const alreadyRed = run(['--base', fx.seed, '--head', fx.branchRed, ...GATE]);
    t('a branch that is already red is labelled as such', alreadyRed.code === EXIT_FINDING && /ALREADY red on the branch alone/.test(alreadyRed.out), `code=${alreadyRed.code}\n${alreadyRed.out}`);
    const scoped = run(['--base', fx.mainA, '--path', 'budget.md', '--path', 'gate.mjs', ...GATE]);
    t('--path scoping reaches the same verdict on a smaller tree', scoped.code === EXIT_FINDING, `code=${scoped.code}\n${scoped.out}`);
    t('the three exit codes are distinct', new Set([EXIT_OK, EXIT_FINDING, EXIT_NOT_MEASURED]).size === 3);
  } catch (e) {
    cases.push({ name: `the self-test threw: ${e.message}`, ok: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  for (const message of batteryFloorFailures()) cases.push({ name: message, ok: false });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ ${TAG} self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    // ⛔ Not `return 1`. The handshake at the dispatch fires whenever the flag is
    // unset, and a RED verdict is still a verdict: returning here prints "never
    // reached its verdict" on top of a self-test that finished and said so, which
    // teaches the reader to discount the one line that means the instrument broke.
    // Exiting from the failure branch is the landed shape — see
    // `scripts/check-agent-model-declared.mjs`, which every self-test here copies.
    process.exit(1);
  }
  console.log(
    `✓ ${TAG} self-test: ${cases.length} cases pass over a real git fixture `
    + '(a re-anchored ceiling, a base that only spends headroom, a green control on the same branch, '
    + 'a Chinese line legal by characters and illegal by bytes, a conflict, and an already-red branch).',
  );
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        `\n✗ ${TAG} self-test: selfTest() returned without reaching its verdict, so no success\n`
        + 'line was printed. Exiting 0 here would report a self-test that never finished as a\n'
        + 'self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  }
  process.exit(probe(process.argv.slice(2)));
}
