#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// prune-turbo-cache -- cuts the local `.turbo/cache` down to the tasks THIS
// run used, so the Actions cache seed a main push saves carries this run and
// nothing older, and says whether there is a seed worth saving at all.
//
//   node scripts/ci/prune-turbo-cache.mjs --site NAME --cache DIR --run-summaries DIR [--extra-summaries DIR]...
//   node scripts/ci/prune-turbo-cache.mjs --self-test   # offline, temp-dir fixtures only
//
// ## What this is for
//
// Test Core restores its seed by key PREFIX -- the newest
// `<os>-turbo-test-<shard>-main-*`, then any `<os>-turbo-test-*` -- adds the
// entries its own run writes, and saves the whole directory under a new
// per-sha key. turbo never evicts its local cache, so each saved seed was the
// restored seed plus one more run: the seed only ever grew, and the bare-prefix
// fallback carried that one lineage from shard to shard. Measured on push run
// 39982654692 (main at 05cc3ee953): all six Test Core seeds 2.41-2.44 GB, while
// Build Core's seed of the full 76-task workspace build was 0.048 GB. Six seeds
// per merge, ~14.6 GB, against the repository's 10 GB Actions cache pool, so
// every merge evicted most of the previous one (#25452).
//
// The cure is in the run summary turbo writes for `--summarize`: it lists the
// hash of every task the run scheduled, cache hits included. Keeping only the
// entries named there keeps everything this run read or wrote -- the shard's
// build closure and its test results -- and drops everything it inherited.
//
// ## Inputs
//
//   --site NAME              the carrier, as the log lines name it.
//   --cache DIR              turbo's local cache directory (`.turbo/cache`).
//   --run-summaries DIR      the run summaries of the run the seed is FOR (Test
//                            Core: the test step's `.turbo/runs/`). REQUIRED to
//                            hold at least one summary: a run that never wrote
//                            one -- the test step was cancelled or the shard was
//                            empty -- has nothing worth seeding, and saving its
//                            closure builds alone would replace the previous
//                            seed's test results with none.
//   --extra-summaries DIR    further summaries whose tasks are kept too (Test
//                            Core: the closure build's, which the remote-cache
//                            assertion moves out of `.turbo/runs/`). Optional,
//                            repeatable; a missing directory is skipped.
//   GITHUB_OUTPUT            `save=true|false` is appended; the save step reads it.
//
// ## Cache entries
//
// turbo 2.11.5 writes three files per task hash into the cache directory:
// `<hash>.tar.zst`, `<hash>-meta.json` and `<hash>-manifest.json`. An entry
// whose hash no summary names is deleted. A file of any other shape is KEPT and
// counted in the output, so a turbo upgrade that changes the layout shows up as
// an unrecognised count instead of a cache this script empties.
//
// ## Exit codes
//
//   0  pruned (`save=true`), or nothing to seed (`save=false`, with the reason).
//      A run-time condition never fails the step: Test Core's attestation needs
//      every step green, and a seed is not a verdict on the shard.
//   3  PREREQUISITE NOT MET: the arguments are malformed.

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { EXIT_FINDINGS, EXIT_PREREQUISITE_NOT_MET } from '../import-prerequisite.mjs';
import { isEntrypoint } from '../invoked-as.mjs';

const SCRIPT = 'prune-turbo-cache';

// The three per-task files of turbo 2.11.5's local cache, keyed by task hash.
const ENTRY = /^([0-9a-f]+)(\.tar\.zst|-meta\.json|-manifest\.json)$/;

/**
 * The task hashes named by every `*.json` run summary in `dirs`.
 * `{ hashes, summaries, unreadable }` -- a summary that does not parse, or has
 * no `tasks` array, is counted as unreadable and contributes nothing.
 */
export function readSummaryHashes(dirs) {
  const hashes = new Set();
  const summaries = [];
  const unreadable = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.json')) continue;
      const path = join(dir, name);
      let summary;
      try {
        summary = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        unreadable.push(path);
        continue;
      }
      if (!Array.isArray(summary?.tasks)) {
        unreadable.push(path);
        continue;
      }
      summaries.push(path);
      for (const task of summary.tasks) {
        if (typeof task?.hash === 'string' && /^[0-9a-f]+$/.test(task.hash)) hashes.add(task.hash);
      }
    }
  }
  return { hashes, summaries, unreadable };
}

/**
 * Sorts the cache directory's files into kept / dropped / unrecognised against
 * the hashes to keep. Pure: the caller deletes.
 */
export function planPrune(fileNames, keep) {
  const kept = [];
  const dropped = [];
  const unrecognised = [];
  for (const name of fileNames) {
    const m = ENTRY.exec(name);
    if (!m) unrecognised.push(name);
    else if (keep.has(m[1])) kept.push(name);
    else dropped.push(name);
  }
  return { kept, dropped, unrecognised };
}

/** Bytes of the regular files named, read from `dir`. */
function sizeOf(dir, names) {
  let bytes = 0;
  for (const name of names) {
    const st = statSync(join(dir, name));
    if (st.isFile()) bytes += st.size;
  }
  return bytes;
}

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

/**
 * The whole decision, on the filesystem. Returns `{ save, lines }`; deletes
 * the dropped entries when `save` is true and touches nothing otherwise.
 */
export function prune({ site, cache, runSummaries, extraSummaries }) {
  const lines = [];
  const say = (s) => lines.push(`${SCRIPT}: ${site}: ${s}`);
  const run = readSummaryHashes([runSummaries]);
  for (const path of run.unreadable) say(`run summary ${path} does not parse or has no tasks; ignored.`);
  if (run.summaries.length === 0) {
    say(
      `NOT SAVED -- no readable run summary in ${runSummaries}: the run this seed is for did not finish ` +
        '(cancelled) or scheduled nothing (an empty shard), so it has no test results to seed and the previous seed stays the newest.',
    );
    return { save: false, lines };
  }
  if (!existsSync(cache)) {
    say(`NOT SAVED -- no cache directory at ${cache}; turbo wrote nothing to seed.`);
    return { save: false, lines };
  }
  const extra = readSummaryHashes(extraSummaries);
  for (const path of extra.unreadable) say(`extra summary ${path} does not parse or has no tasks; ignored.`);
  const keep = new Set([...run.hashes, ...extra.hashes]);

  const names = readdirSync(cache).sort();
  const plan = planPrune(names, keep);
  const before = sizeOf(cache, names);
  const droppedBytes = sizeOf(cache, plan.dropped);
  for (const name of plan.dropped) unlinkSync(join(cache, name));

  const keptHashes = new Set(plan.kept.map((n) => ENTRY.exec(n)[1]));
  say(
    `kept ${keptHashes.size} task entr${keptHashes.size === 1 ? 'y' : 'ies'} named by ${run.summaries.length + extra.summaries.length} ` +
      `run summar${run.summaries.length + extra.summaries.length === 1 ? 'y' : 'ies'} (${keep.size} task hash(es); ` +
      `${keep.size - keptHashes.size} have no entry -- a failed task, or one turbo does not cache).`,
  );
  say(`dropped ${plan.dropped.length} file(s) the run did not use: ${mb(before)} -> ${mb(before - droppedBytes)} on disk.`);
  if (plan.unrecognised.length > 0) {
    say(
      `kept ${plan.unrecognised.length} file(s) of no known turbo cache shape (${plan.unrecognised.slice(0, 3).join(', ')}` +
        `${plan.unrecognised.length > 3 ? ', ...' : ''}) -- if turbo changed its cache layout, update ENTRY in this script.`,
    );
  }
  return { save: true, lines };
}

function parseArgs(argv) {
  const args = { site: null, cache: null, runSummaries: null, extraSummaries: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = argv[i + 1];
    if (['--site', '--cache', '--run-summaries', '--extra-summaries'].includes(a) && (value === undefined || value.startsWith('--'))) {
      return { error: `${a} needs a value` };
    }
    if (a === '--site') args.site = argv[++i];
    else if (a === '--cache') args.cache = argv[++i];
    else if (a === '--run-summaries') args.runSummaries = argv[++i];
    else if (a === '--extra-summaries') args.extraSummaries.push(argv[++i]);
    else return { error: `unknown argument '${a}'` };
  }
  if (!args.site || !args.cache || !args.runSummaries) return { error: '--site, --cache and --run-summaries are all required' };
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.log(`${SCRIPT}: PREREQUISITE NOT MET -- ${args.error}`);
    process.exit(EXIT_PREREQUISITE_NOT_MET);
  }
  const { save, lines } = prune(args);
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `save=${save}\n`);
}

// ---------------------------------------------------------------------------
// Self-test -- the summary read, the plan and the whole prune, on temp dirs.
// ---------------------------------------------------------------------------

// Set only after the verdict line prints; the dispatch refuses when it is unset
// (AGENTS.md, "Writing a --self-test": the handshake).
let selfTestReachedVerdict = false;

// Battery name -> minimum case count. A literal, so a deleted battery names
// itself in the refusal instead of taking its own floor with it.
const SELF_TEST_BATTERIES = Object.freeze({
  'summary hashes': 5,
  'prune plan': 5,
  'prune on disk': 7,
  'nothing to seed': 4,
  'arguments': 4,
});
const SELF_TEST_BATTERY_FLOOR = 5;

function selfTest() {
  const seen = new Map();
  let current = null;
  let failed = 0;
  const battery = (name) => {
    current = name;
  };
  const t = (label, cond) => {
    seen.set(current, (seen.get(current) ?? 0) + 1);
    if (cond) {
      console.log(`  ok    [${current}] ${label}`);
    } else {
      failed += 1;
      console.log(`  FAIL  [${current}] ${label}`);
    }
  };

  const root = mkdtempSync(join(tmpdir(), `${SCRIPT}-`));
  const dir = (name) => {
    const path = join(root, name);
    mkdirSync(path, { recursive: true });
    return path;
  };
  const summary = (d, name, hashes) =>
    writeFileSync(join(d, name), JSON.stringify({ id: name, tasks: hashes.map((hash, i) => ({ taskId: `p${i}#build`, hash })) }));
  // One turbo 2.11.5 entry: the three files, the archive `bytes` long.
  const entry = (d, hash, bytes = 10) => {
    writeFileSync(join(d, `${hash}.tar.zst`), 'x'.repeat(bytes));
    writeFileSync(join(d, `${hash}-meta.json`), '{}');
    writeFileSync(join(d, `${hash}-manifest.json`), '{}');
  };

  try {
    battery('summary hashes');
    {
      const d = dir('hashes');
      summary(d, 'a.json', ['aa11', 'bb22']);
      summary(d, 'b.json', ['bb22', 'cc33']);
      writeFileSync(join(d, 'broken.json'), '{"tasks": [');
      writeFileSync(join(d, 'shape.json'), '{"id": "no tasks"}');
      writeFileSync(join(d, 'notes.txt'), 'not a summary');
      const r = readSummaryHashes([d, join(root, 'absent')]);
      t('every task hash across summaries, deduplicated', r.hashes.size === 3 && r.hashes.has('aa11') && r.hashes.has('cc33'));
      t('two readable summaries counted', r.summaries.length === 2);
      t('a summary that does not parse is unreadable, not fatal', r.unreadable.some((p) => p.endsWith('broken.json')));
      t('a JSON file with no tasks array is unreadable', r.unreadable.some((p) => p.endsWith('shape.json')));
      t('a missing directory reads as no summaries', readSummaryHashes([join(root, 'absent')]).summaries.length === 0);
    }

    battery('prune plan');
    {
      const p = planPrune(
        ['aa11.tar.zst', 'aa11-meta.json', 'aa11-manifest.json', 'dd44.tar.zst', 'dd44-meta.json', 'README', 'aa11.tar.gz'],
        new Set(['aa11']),
      );
      t('all three files of a kept hash are kept', p.kept.length === 3);
      t('every file of an unnamed hash is dropped', p.dropped.length === 2 && p.dropped.includes('dd44-meta.json'));
      t('a file of no known shape is unrecognised, never dropped', p.unrecognised.includes('README'));
      t('an archive of another format is unrecognised, never dropped', p.unrecognised.includes('aa11.tar.gz'));
      t('an empty keep set drops every entry', planPrune(['aa11.tar.zst'], new Set()).dropped.length === 1);
    }

    battery('prune on disk');
    {
      const cache = dir('disk/cache');
      const runs = dir('disk/runs');
      const extra = dir('disk/extra');
      entry(cache, 'aa11', 100);
      entry(cache, 'bb22', 100);
      entry(cache, 'ee55', 5000);
      entry(cache, 'ff66', 5000);
      writeFileSync(join(cache, 'unknown.bin'), 'keep me');
      summary(runs, 'test.json', ['aa11', '9999']);
      summary(extra, 'closure.json', ['bb22']);
      const r = prune({ site: 'fixture', cache, runSummaries: runs, extraSummaries: [extra, join(root, 'absent')] });
      const left = readdirSync(cache).sort();
      t('says to save', r.save === true);
      t('the run summary\'s entry survives', left.includes('aa11.tar.zst') && left.includes('aa11-manifest.json'));
      t('an extra summary\'s entry survives', left.includes('bb22.tar.zst'));
      t('an inherited entry no summary names is deleted, all three files', !left.some((n) => n.startsWith('ee55') || n.startsWith('ff66')));
      t('an unrecognised file is kept and reported', left.includes('unknown.bin') && r.lines.some((l) => l.includes('no known turbo cache shape')));
      t('a named hash with no entry is counted, not fatal', r.lines.some((l) => l.includes('1 have no entry')));
      t('reports the bytes before and after', r.lines.some((l) => /dropped 6 file\(s\).*-> /.test(l)));
    }

    battery('nothing to seed');
    {
      const cache = dir('none/cache');
      entry(cache, 'aa11');
      const extra = dir('none/extra');
      summary(extra, 'closure.json', ['aa11']);
      const noRun = prune({ site: 'fixture', cache, runSummaries: dir('none/runs'), extraSummaries: [extra] });
      t('no run summary: do not save, even with an extra summary present', noRun.save === false);
      t('no run summary: the cache is left untouched', readdirSync(cache).length === 3);
      const brokenRuns = dir('none/broken-runs');
      writeFileSync(join(brokenRuns, 'cut.json'), '{"tasks":');
      t('only an unreadable run summary: do not save', prune({ site: 'fixture', cache, runSummaries: brokenRuns, extraSummaries: [] }).save === false);
      const runs = dir('none/runs-ok');
      summary(runs, 'test.json', ['aa11']);
      t('no cache directory: do not save', prune({ site: 'fixture', cache: join(root, 'no-cache'), runSummaries: runs, extraSummaries: [] }).save === false);
    }

    battery('arguments');
    t('all three required are accepted', !parseArgs(['--site', 's', '--cache', 'c', '--run-summaries', 'r']).error);
    t('--extra-summaries repeats', parseArgs(['--site', 's', '--cache', 'c', '--run-summaries', 'r', '--extra-summaries', 'a', '--extra-summaries', 'b']).extraSummaries.length === 2);
    t('a missing required argument is refused', Boolean(parseArgs(['--site', 's', '--cache', 'c']).error));
    t('a flag swallowing the next flag is refused', Boolean(parseArgs(['--site', '--cache', 'c', '--run-summaries', 'r']).error));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floor = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floor.push(`only ${declared.length} batteries declared, below the pinned ${SELF_TEST_BATTERY_FLOOR}`);
  }
  for (const name of seen.keys()) {
    if (!declared.includes(name)) floor.push(`battery "${name}" registered cases but is not declared`);
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      floor.push(`battery "${name}" registered ${count} case(s), below its pinned ${SELF_TEST_BATTERIES[name]}`);
    }
  }
  for (const line of floor) console.log(`  FAIL  [floor] ${line}`);
  failed += floor.length;

  const cases = [...seen.values()].reduce((a, b) => a + b, 0);
  if (failed > 0) {
    console.log(`\n${SCRIPT} self-test: FAILED (${failed} of ${cases} case(s) and floor checks).`);
    process.exit(EXIT_FINDINGS);
  }
  console.log(`\n${SCRIPT} self-test: OK (${cases} case(s) across ${declared.length} batteries).`);
  selfTestReachedVerdict = true;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        `\n${SCRIPT} self-test: selfTest() returned without reaching its verdict, so no success line was\n` +
          'printed. Exiting 0 here would report a self-test that never finished as one that passed.',
      );
      process.exit(EXIT_FINDINGS);
    }
  } else {
    main();
  }
}
