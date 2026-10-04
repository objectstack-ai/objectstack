// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21113] Two writers, two PROCESSES, one database: every record number the
 * remote face issues is distinct.
 *
 * # Why real processes, and what they measure
 *
 * The hosted runtime runs several containers against one tenant database, so
 * the acceptance is cross-process atomicity — ⛔ never an in-process counter,
 * ⛔ never the engine's in-memory fallback. Every other remote autonumber pin
 * in this package runs on `libsql-sqlite-stub.testkit.ts`, a synchronous
 * better-sqlite3 behind the `@libsql/client` interface: it serialises every
 * statement by construction, so it cannot tell an atomic counter from a
 * read-then-write one. Neither can two `@libsql/client` instances in ONE
 * Node process, whose native calls run on the one JS thread.
 *
 * So this file spawns two child processes (through `tsx`, over the package's
 * SOURCE, the way `packages/spec`'s process-boundary pins do), each holding
 * its own `@libsql/client` connection — the native `file:` backend, which is
 * libSQL itself, the engine behind a Turso endpoint — to one database file,
 * each driving its own `TursoDriver` in REMOTE mode, writing through
 * `TursoDriver.create`. A file barrier releases both writers at once, so their
 * statements contend on the database's write lock rather than following each
 * other through process start-up.
 *
 * What is NOT measured here, said plainly: an HTTP `sqld` server. None runs in
 * this environment, and the transport's HTTP batching and retries are the
 * concern of the suites that mock `execute`. What a server adds is the network;
 * what decides atomicity is the statement, and the statement runs on the same
 * engine under the same lock here as there.
 *
 * # The pins
 *
 * - N writes from two processes give N distinct numbers — the counter moved
 *   in one atomic statement per reservation, so no two writers read the same
 *   `last_value`.
 * - Each writer's own sequence is strictly increasing: the counter is
 *   gap-tolerant-monotonic. With no statement failing, the union is exactly
 *   1..N, and the file says so when it is.
 * - The writers are different processes, and neither is this one.
 *
 * And the EVIDENCE that the pins above were not vacuous: in the global order
 * of the numbers, the writer changes at least twice — each wrote while the
 * other still had writes pending. (One change is a serial run, A then B; a
 * writer finishing a contiguous run INSIDE the other's run is still an
 * overlap, and is what the scheduler does under load, so contiguity is not
 * the criterion.) Whether two processes overlap is the box's decision, not
 * the code's: measured on a shared box under another seat's full-package run,
 * one process wrote all of its numbers before the other was scheduled past the
 * barrier (1 change). So the overlap is not asserted on a single round. Up to
 * MAX_ROUNDS rounds run, each on a fresh database with every hard pin above
 * asserted; the first round that overlapped ends the loop and prints its
 * measurement. If no round overlapped, the test is SKIPPED with a note that
 * says NOT MEASURED — visible in the run's skipped count, never read as green
 * — rather than failing on what the scheduler did or passing on a serial run.
 *
 * # Reverse verification — predicted BEFORE it was run, then measured
 *
 * Predicted: with the warm path split into two statements (read `last_value`,
 * then write `last_value + 1`), two processes releasing on the barrier read
 * the same value and write the same successor, so the distinct count drops
 * below N.
 *
 * Measured — a different red than predicted, kept rather than tidied: the
 * duplicate reservations never reached the distinct-count pin, because the
 * fixture's unique index (`uniq_crm_case_organization_id_case_number`, the
 * tenant-scoped unique every autonumber this repo declares `unique` carries)
 * refused the second row carrying the same number, and the #5495 re-seed —
 * forward-only, to the observed MAX — could not outrun a writer that kept
 * reading the same stale value, so after its retry budget the write FAILED.
 * The red is on the "no write failed" pin, with `SQLITE_CONSTRAINT: UNIQUE
 * constraint failed: index 'uniq_crm_case_organization_id_case_number'` in
 * the writer's error list: 2 of 3 runs with no gap between the two
 * statements, 3 of 3 with a 1 ms gap (the order of one HTTP round trip). So
 * what this pin distinguishes is a counter that can hand out one number
 * twice, and on a declared-unique column that surfaces as refused writes
 * before it surfaces as duplicate rows.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { TursoDriver } from './index.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PKG_ROOT = join(HERE, '..');
const DRIVER_ENTRY = new URL('./index.ts', import.meta.url).href;

const WRITES_PER_WORKER = 200;
/** Rounds a loaded box gets to let the two writers overlap before the overlap evidence is declared NOT MEASURED. */
const MAX_ROUNDS = 3;
const WORKERS = ['A', 'B'] as const;

const NUMBERED_OBJECT = {
  name: 'crm_case',
  fields: {
    organization_id: { type: 'string' },
    case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: true },
    title: { type: 'string' },
  },
};

const dirs: string[] = [];
afterAll(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

interface WorkerReport {
  tag: string;
  pid: number;
  numbers: string[];
  errors: string[];
}

/**
 * The writer. Runs under `tsx` so it imports the driver's SOURCE, like the
 * test itself does. It connects, registers the schema (the tables already
 * exist — the parent created them — so `initObjects` records metadata and
 * runs no DDL), announces readiness, waits for the parent's `go` file, then
 * writes as fast as the database lets it and reports on stdout.
 */
const WORKER_SOURCE = `
  import { createClient } from '@libsql/client';
  import { existsSync, writeFileSync } from 'node:fs';
  // tsx compiles this package's .ts to CJS (no "type": "module"), so the
  // class may arrive under \`default\` — the spelling packages/spec's
  // process-boundary pins use.
  const driverModule = await import(${JSON.stringify(DRIVER_ENTRY)});
  const TursoDriver = driverModule.TursoDriver ?? driverModule.default?.TursoDriver;
  const { OS_TEST_DB, OS_TEST_DIR, OS_TEST_TAG, OS_TEST_WRITES } = process.env;
  const client = createClient({ url: 'file:' + OS_TEST_DB, timeout: 20000 });
  const driver = new TursoDriver({ url: 'libsql://concurrency.probe', client });
  await driver.connect();
  await driver.initObjects([${JSON.stringify(NUMBERED_OBJECT)}]);
  writeFileSync(OS_TEST_DIR + '/ready-' + OS_TEST_TAG, String(process.pid));
  const go = OS_TEST_DIR + '/go';
  while (!existsSync(go)) await new Promise((r) => setTimeout(r, 2));
  const numbers = [];
  const errors = [];
  for (let i = 0; i < Number(OS_TEST_WRITES); i++) {
    try {
      const row = await driver.create('crm_case', { organization_id: 'orgA', title: OS_TEST_TAG + '-' + i });
      numbers.push(row.case_number);
    } catch (e) {
      errors.push(String(e && e.message || e));
    }
  }
  await driver.disconnect();
  process.stdout.write(JSON.stringify({ tag: OS_TEST_TAG, pid: process.pid, numbers, errors }));
`;

function runWorker(env: Record<string, string>): Promise<WorkerReport> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', WORKER_SOURCE],
      { cwd: PKG_ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`writer ${env.OS_TEST_TAG} exited ${code}\nstderr:\n${err}\nstdout:\n${out}`));
        return;
      }
      try {
        resolve(JSON.parse(out) as WorkerReport);
      } catch (e) {
        reject(new Error(`writer ${env.OS_TEST_TAG} wrote no report: ${String(e)}\nstderr:\n${err}\nstdout:\n${out}`));
      }
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One round: a fresh database, both writers, the barrier, every hard pin.
 * Answers how many times the writer changed in the global order.
 */
async function round(): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'turso-autonumber-concurrency-'));
  dirs.push(dir);
  const dbPath = join(dir, 'shared.db');

  // The parent creates the schema through its own remote-mode driver, so
  // both writers find the tables and the unique index already there.
  const parentClient = createClient({ url: `file:${dbPath}`, timeout: 20000 });
  const parent = new TursoDriver({ url: 'libsql://concurrency.probe', client: parentClient });
  await parent.connect();
  await parent.initObjects([NUMBERED_OBJECT as any]);

  // A writer that dies before the barrier surfaces as ITS error, not as a
  // readiness timeout.
  let died: Error | null = null;
  const runs = WORKERS.map((tag) =>
    runWorker({ OS_TEST_DB: dbPath, OS_TEST_DIR: dir, OS_TEST_TAG: tag, OS_TEST_WRITES: String(WRITES_PER_WORKER) })
      .catch((e: Error) => { died ??= e; throw e; }),
  );
  // Release both only once both are connected and registered, so the
  // writes contend rather than queue behind process start-up.
  const deadline = Date.now() + 60_000;
  while (!WORKERS.every((tag) => existsSync(join(dir, `ready-${tag}`)))) {
    if (died) throw died;
    if (Date.now() > deadline) throw new Error('writers did not become ready within 60s');
    await sleep(5);
  }
  writeFileSync(join(dir, 'go'), '1');
  const reports = await Promise.all(runs);

  // Different processes, and not this one.
  const pids = reports.map((r) => r.pid);
  expect(new Set(pids).size).toBe(WORKERS.length);
  expect(pids).not.toContain(process.pid);

  // No write failed — so the union below is the whole 1..N and nothing was
  // burned. (A failure would show here with its message, not as a gap.)
  for (const r of reports) expect(r.errors, `writer ${r.tag} errors`).toEqual([]);
  for (const r of reports) expect(r.numbers).toHaveLength(WRITES_PER_WORKER);

  // N distinct numbers across both writers.
  const all = reports.flatMap((r) => r.numbers);
  const total = WORKERS.length * WRITES_PER_WORKER;
  expect(new Set(all).size).toBe(total);
  expect(all.every((n) => /^CASE-\d{5}$/.test(n))).toBe(true);
  const expected = Array.from({ length: total }, (_, i) => `CASE-${String(i + 1).padStart(5, '0')}`);
  expect([...all].sort()).toEqual(expected);

  // Monotonic within each writer.
  const asInt = (n: string) => Number(n.slice('CASE-'.length));
  for (const r of reports) {
    const ints = r.numbers.map(asInt);
    for (let i = 1; i < ints.length; i++) expect(ints[i], `writer ${r.tag} at ${i}`).toBeGreaterThan(ints[i - 1]);
  }

  // And the database agrees: one row per number, one counter row at N.
  const byNumber: DriverQuery = { orderBy: [{ field: 'case_number', order: 'asc' }] };
  const rows = await parent.find('crm_case', byNumber);
  expect(rows.map((row) => row.case_number)).toEqual(expected);
  const counter = await parentClient.execute('select "last_value" from "_objectstack_sequences"');
  expect(counter.rows).toHaveLength(1);
  expect(Number(counter.rows[0].last_value)).toBe(total);
  await parent.disconnect();

  // The overlap evidence: walking the numbers in order, how often the writer
  // changed. A serial run (all of A, then all of B) changes once; a writer
  // whose contiguous run sits inside the other's changes twice, and that is
  // still both writers contending on one counter.
  const owner = new Map<number, string>();
  for (const r of reports) for (const n of r.numbers) owner.set(asInt(n), r.tag);
  const inOrder = [...owner.keys()].sort((a, b) => a - b).map((n) => owner.get(n)!);
  let switches = 0;
  for (let i = 1; i < inOrder.length; i++) if (inOrder[i] !== inOrder[i - 1]) switches++;
  process.stdout.write(`[turso-remote-autonumber-concurrency] pids ${pids.join('/')} · ${total} writes · ${new Set(all).size} distinct · ${switches} writer change(s)\n`);
  return switches;
}

describe('[#21113] two writers in two processes draw distinct numbers from one database', () => {
  it(`${WORKERS.length} x ${WRITES_PER_WORKER} creates -> ${WORKERS.length * WRITES_PER_WORKER} distinct, monotonic per writer, and the writers overlapped`, async (ctx) => {
    const observed: number[] = [];
    for (let i = 0; i < MAX_ROUNDS; i++) {
      const switches = await round();
      observed.push(switches);
      if (switches >= 2) return;
    }
    ctx.skip(
      `NOT MEASURED: in ${MAX_ROUNDS} round(s) the two processes never overlapped on this box ` +
        `(writer changes per round: ${observed.join(', ')}); every round's numbers were distinct and complete, ` +
        `but a serial run cannot vouch for the atomic statement, so this is a skip, not a pass.`,
    );
  }, 300_000);
});
