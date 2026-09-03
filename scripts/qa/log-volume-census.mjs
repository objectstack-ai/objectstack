#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * log-volume-census -- how many lines does each package's test suite write, and
 * WHICH WRITER wrote them?
 *
 *   node scripts/qa/log-volume-census.mjs --list
 *   node scripts/qa/log-volume-census.mjs --run --budget 300
 *   node scripts/qa/log-volume-census.mjs --run --only @objectstack/rest
 *   node scripts/qa/log-volume-census.mjs --report
 *   node scripts/qa/log-volume-census.mjs --report --json
 *   node scripts/qa/log-volume-census.mjs --classify <captured.log>
 *
 * ## The population, and why counting it needed an instrument
 *
 * A test run's stdout carries at least three writers, and they are NOT
 * distinguishable by file descriptor:
 *
 *   1. the engine's STRUCTURED LOGGER -- `ObjectLogger.write()` in
 *      `packages/core/src/logger.ts`, which composes `<ISO ts> <LEVEL> …` and
 *      calls `process.stdout.write` (`process.stderr` for error/fatal) DIRECTLY;
 *   2. `console.*` from application, plugin and test code;
 *   3. vitest's own reporter, plus the `pnpm`/script banner around it.
 *
 * ⚠️ The obvious discriminator -- "was it forwarded through vitest's console
 * RPC?" -- does not exist in this repo. All 72 vitest configs set
 * `disableConsoleIntercept: true`, enforced by
 * `scripts/check-console-intercept-disarm.mjs`, so console output is NOT
 * intercepted and carries no `stdout | <file> > <test>` header. Both (1) and
 * (2) land on the same two file descriptors, unlabelled. Capture-time
 * separation would mean changing how a package runs its tests, which would
 * measure a different thing than the suite anyone actually runs.
 *
 * So the discriminator is LINE SHAPE, anchored on the one writer whose output
 * format is fixed in source: the structured logger. Everything the logger did
 * not write is then split into the reporter's own bounded, enumerable
 * vocabulary and the remainder. The remainder is reported as `console` -- and
 * is a COMPLEMENT, not a positive identification. Anything that writes to
 * stdout without the logger's head and without a reporter shape (a bare
 * `process.stdout.write` from build or seed code, for instance) lands in it.
 * That is stated at every output site rather than left for a reader to
 * discover.
 *
 * ## Why the complement is the right shape anyway
 *
 * It is also the definition the measurement this extends used: in that table
 * `console + structured == total` in all five rows, exactly. Keeping the same
 * definition is what makes the two tables comparable. This one additionally
 * breaks out the reporter bucket, which that table folded into `console`, so
 * both numbers can be read from one run.
 *
 * ## What a reading is NOT
 *
 * - NOT a wall-clock claim. Suites here run under a shared verify lock on a
 *   box with other agents on it; durations are recorded for triage, never as
 *   performance figures.
 * - NOT invariant across worker counts in ORDER, only in COUNT. Interleaving
 *   changes with `VITEST_MAX_WORKERS`; which lines get emitted does not.
 * - NOT meaningful for a RED suite without saying so. A failing suite prints
 *   stack traces the green one does not, so every record carries its exit code
 *   and the report flags non-zero rows.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_STATE_DIR = process.env.OS_LOG_CENSUS_DIR || '/tmp/os-log-volume-census';

/** SGR escape sequences. The logger colors its head when the stream is a TTY. */
const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * `ObjectLogger.write()`, formats `pretty` (the default) and `text`, compose
 * `${new Date().toISOString()} ${level.toUpperCase()}` as the head of every
 * line. `pretty` follows it with a space, `text` with ` | `. Anchored on the
 * timestamp so no other writer can collide by accident.
 */
const STRUCTURED_PRETTY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z (?:\| )?(DEBUG|INFO|WARN|ERROR|FATAL)\b/;

/** Format `json`: `JSON.stringify({ time, level, … })` -- key order is fixed by the literal. */
const STRUCTURED_JSON = /^\{"time":"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z","level":"(debug|info|warn|error|fatal)"/;

/**
 * vitest's reporter vocabulary plus the pnpm/script banner. Deliberately a
 * closed list: a shape that is not here is counted as `console`, so the
 * failure direction is over-counting console, never over-counting structured.
 */
const REPORTER = [
  /^\s*$/, // blank separator lines the reporter emits between blocks
  /^> /, // npm/pnpm script echo: `> @objectstack/rest@17.2.0 test …`
  /^\s*RUN\s+v\d/, // ` RUN  v4.1.10 /path`
  /^\s*(?:✓|×|❯|·|↓)\s/, // per-file / per-test result lines
  /^\s*Test Files\s+/,
  /^\s*Tests\s+\d/,
  /^\s*Start at\s+/,
  /^\s*Duration\s+/,
  /^\s*Errors\s+\d/,
  /^\s*Snapshots\s+/,
  /^\s*Coverage /,
  /^\s*(?:stdout|stderr) \| /, // present only if some config ever re-arms interception
  /^\s*[-─═]{10,}\s*$/, // rules the reporter draws
  /^\s*(?:Failed Tests|Unhandled Errors)\s+\d/,
  /^\s*(?:FAIL|PASS)\s+/,
  /^\s*⎯{3,}/, // vitest failure block separators
];

function isReporter(line) {
  return REPORTER.some((re) => re.test(line));
}

/**
 * Classify one captured combined-stdout+stderr log.
 * Returns counts plus the level histogram of the structured population.
 */
export function classify(text) {
  const counts = { total: 0, structured: 0, reporter: 0, console: 0 };
  const levels = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, FATAL: 0 };
  // A trailing newline must not manufacture an empty final line.
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (body.length === 0) return { ...counts, levels };
  for (const raw of body.split('\n')) {
    const line = raw.replace(ANSI, '');
    counts.total += 1;
    const m = STRUCTURED_PRETTY.exec(line);
    if (m) {
      counts.structured += 1;
      levels[m[1]] += 1;
      continue;
    }
    const j = STRUCTURED_JSON.exec(line);
    if (j) {
      counts.structured += 1;
      levels[j[1].toUpperCase()] += 1;
      continue;
    }
    if (isReporter(line)) counts.reporter += 1;
    else counts.console += 1;
  }
  return { ...counts, levels };
}

/** Every workspace package that declares a `test` script, minus the root. */
export function listPackages(repoRoot = REPO_ROOT) {
  const out = execFileSync('pnpm', ['-r', 'list', '--depth', '-1', '--json'], {
    cwd: repoRoot,
    maxBuffer: 1 << 28,
    encoding: 'utf8',
  });
  const rows = [];
  for (const entry of JSON.parse(out)) {
    if (!entry.path || path.resolve(entry.path) === path.resolve(repoRoot)) continue;
    const manifest = path.join(entry.path, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (!pkg.scripts || !pkg.scripts.test) continue;
    rows.push({
      name: pkg.name,
      dir: path.relative(repoRoot, entry.path),
      script: pkg.scripts.test,
    });
  }
  rows.sort((a, b) => a.dir.localeCompare(b.dir));
  return rows;
}

function ledgerPath(stateDir) {
  return path.join(stateDir, 'ledger.json');
}

function readLedger(stateDir) {
  const file = ledgerPath(stateDir);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeLedger(stateDir, ledger) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(ledgerPath(stateDir), JSON.stringify(ledger, null, 1) + '\n');
}

/**
 * Run ONE package's own `test` script, unchanged, capturing combined
 * stdout+stderr. Nothing about how the package runs its tests is altered: the
 * only environment this adds is a memory ceiling and a worker cap, both of
 * which bound resource use on a shared box without changing which lines are
 * emitted.
 */
export function runPackage(pkg, stateDir, repoRoot = REPO_ROOT) {
  const logFile = path.join(stateDir, 'logs', `${pkg.name.replace(/[^\w.-]/g, '_')}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const started = Date.now();
  const res = spawnSync('pnpm', ['--filter', pkg.name, 'run', 'test'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=4096`.trim(),
      VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS || '2',
      CI: process.env.CI || '1',
    },
  });
  const text = (res.stdout || '') + (res.stderr || '');
  fs.writeFileSync(logFile, text);
  return {
    ...classify(text),
    exitCode: res.status === null ? -1 : res.status,
    signal: res.signal || null,
    seconds: Math.round((Date.now() - started) / 1000),
    logFile,
    measuredAt: new Date().toISOString(),
  };
}

function fmt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function report(stateDir, asJson) {
  const ledger = readLedger(stateDir);
  const all = listPackages();
  if (asJson) {
    process.stdout.write(JSON.stringify({ ledger, packages: all.map((p) => p.name) }, null, 1) + '\n');
    return 0;
  }
  const rows = all.map((p) => ({ pkg: p, rec: ledger[p.name] }));
  const measured = rows.filter((r) => r.rec);
  const missing = rows.filter((r) => !r.rec);
  const tot = { total: 0, structured: 0, reporter: 0, console: 0 };
  console.log('| package | console | structured | reporter | total | exit |');
  console.log('|---|---:|---:|---:|---:|---|');
  for (const { pkg, rec } of measured) {
    for (const k of Object.keys(tot)) tot[k] += rec[k];
    console.log(
      `| \`${pkg.dir}\` | ${fmt(rec.console)} | ${fmt(rec.structured)} | ${fmt(rec.reporter)} | ${fmt(rec.total)} | ${rec.exitCode === 0 ? 'ok' : '⚠ ' + rec.exitCode} |`,
    );
  }
  console.log(
    `| **total, ${measured.length} suites** | **${fmt(tot.console)}** | **${fmt(tot.structured)}** | **${fmt(tot.reporter)}** | **${fmt(tot.total)}** | |`,
  );
  console.log('');
  console.log(`structured share of total: ${((tot.structured / tot.total) * 100).toFixed(1)}%`);
  console.log(`NOT MEASURED: ${missing.length}${missing.length ? ' — ' + missing.map((m) => m.pkg.dir).join(', ') : ''}`);
  console.log('');
  console.log('`console` is a COMPLEMENT (total - structured - reporter), not a positive identification.');
  return 0;
}

function main(argv) {
  const stateDir = DEFAULT_STATE_DIR;
  if (argv.includes('--list')) {
    for (const p of listPackages()) console.log(`${p.name}\t${p.dir}\t${p.script}`);
    return 0;
  }
  const classifyAt = argv.indexOf('--classify');
  if (classifyAt !== -1) {
    const file = argv[classifyAt + 1];
    if (!file) {
      console.error('--classify needs a file');
      return 2;
    }
    console.log(JSON.stringify(classify(fs.readFileSync(file, 'utf8')), null, 1));
    return 0;
  }
  if (argv.includes('--report')) return report(stateDir, argv.includes('--json'));
  if (argv.includes('--run')) {
    const budgetAt = argv.indexOf('--budget');
    const budget = budgetAt === -1 ? Infinity : Number(argv[budgetAt + 1]) * 1000;
    const onlyAt = argv.indexOf('--only');
    const only = onlyAt === -1 ? null : argv[onlyAt + 1];
    const ledger = readLedger(stateDir);
    const deadline = Date.now() + budget;
    let ran = 0;
    for (const pkg of listPackages()) {
      if (only && pkg.name !== only) continue;
      if (!only && ledger[pkg.name]) continue;
      if (!only && Date.now() >= deadline) break;
      process.stderr.write(`census: running ${pkg.name} …\n`);
      const rec = runPackage(pkg, stateDir);
      ledger[pkg.name] = rec;
      writeLedger(stateDir, ledger);
      ran += 1;
      process.stderr.write(
        `census: ${pkg.name} exit=${rec.exitCode} total=${rec.total} structured=${rec.structured} console=${rec.console} reporter=${rec.reporter} ${rec.seconds}s\n`,
      );
    }
    const remaining = listPackages().filter((p) => !ledger[p.name]).length;
    console.log(`census: ran ${ran} this pass · ${remaining} still unmeasured · ledger ${ledgerPath(stateDir)}`);
    return 0;
  }
  console.error('usage: --list | --run [--budget S] [--only PKG] | --report [--json] | --classify FILE');
  return 2;
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
