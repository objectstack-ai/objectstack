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
 * So this file spawns two child processes, each running the package's SOURCE
 * compiled by `tsx`, as `packages/spec`'s process-boundary pins do. For each round
 * the parent creates a fresh database, and each writer opens its own
 * `@libsql/client` connection to it — the native `file:` backend, which is
 * libSQL itself, the engine behind a Turso endpoint — drives its own
 * `TursoDriver` in REMOTE mode, and writes through `TursoDriver.create`. The
 * parent releases both writers with one `go` written to both pipes in the same
 * tick, once both have reported ready, so their statements contend on the
 * database's write lock rather than following each other through start-up.
 *
 * What is NOT measured here, said plainly: an HTTP `sqld` server. None runs in
 * this environment, and the transport's HTTP batching and retries are the
 * concern of the suites that mock `execute`. What a server adds is the network;
 * what decides atomicity is the statement, and the statement runs on the same
 * engine under the same lock here as there.
 *
 * # What the file waits on, and what it no longer waits on
 *
 * Measured at `d4aaeaf0e` on a 4-vCPU box, one round of the earlier shape
 * (writers spawned per round under `node --import tsx`, 200 writes each, the
 * default `synchronous = FULL`) took about 4.4 s: about 2.2 s to start each
 * writer and about 2.2 s of writes. Of a writer's start-up, the package's own
 * source took about 40 ms to compile; the rest was its dependencies' built code
 * (`@objectstack/driver-sql` and what it imports, `@objectstack/spec`,
 * `@libsql/client`), which loads in about 1.2 s under plain Node and about 2 s
 * under tsx's hook. The writes were fsync-bound: one `create` is three
 * statements (reserve, insert, read back), and a single writer took 5.9 ms per
 * `create` with fsync and 1.2 ms with `synchronous = OFF`. CI's hourly full
 * battery measured the file at up to 29.3 s, over 10 s in 6 of the 7 runs that
 * executed it, and every retry round paid both start-ups again.
 *
 * Three changes, none touching what is asserted:
 *
 * - The writers start ONCE per test and serve every round over stdin/stdout.
 *   A retry round therefore costs its writes, not two more process start-ups.
 * - A writer loads the driver's dependencies with plain Node first, then
 *   registers tsx and requires the source. The source is still compiled by
 *   tsx, and the dependencies are the same modules, loaded without the hook.
 * - Each writer sets `PRAGMA synchronous = OFF` on its own connection.
 *   `synchronous` decides only whether SQLite flushes to disk at a commit,
 *   which matters for a power cut and not for a throwaway temp file. The lock
 *   protocol is unchanged: the journal mode, the locks each statement takes and
 *   the busy timeout all stay as they were. What decides atomicity, two
 *   connections in two processes serialised by the database's write lock, is
 *   exactly what it was.
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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { TursoDriver } from './index.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PKG_ROOT = join(HERE, '..');
const DRIVER_ENTRY = fileURLToPath(new URL('./index.ts', import.meta.url));
/**
 * What the driver's source imports at runtime from `node_modules` (its type-only
 * imports are erased). The writer loads these BEFORE tsx is registered: they
 * are built code, not this package's source, and tsx's require hook roughly
 * doubles their load. A dependency missing from this list still loads, under
 * tsx, so the list is a cost, never a correctness, question.
 */
const PRELOADED_DEPENDENCIES = ['@libsql/client', '@objectstack/driver-sql', '@objectstack/spec/api', '@objectstack/spec/data'];

const WRITES_PER_WORKER = 200;
/** Rounds a loaded box gets to let the two writers overlap before the overlap evidence is declared NOT MEASURED. */
const MAX_ROUNDS = 3;
const WORKERS = ['A', 'B'] as const;
/** How long a writer may take to answer one command before the round fails with that writer's stderr. */
const REPLY_DEADLINE_MS = 60_000;

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
 * The writer. Loads the driver's dependencies with plain Node, then registers
 * tsx through its public CJS API and requires the driver's SOURCE, like the
 * test itself does — so the source is compiled by tsx, to CJS (this package
 * has no `"type": "module"`), and its requires of those dependencies are cache
 * hits. It pays that start-up once for every round. It reads one JSON command
 * per line on stdin and answers one JSON line on stdout:
 *
 * - `{ open: <db path> }` — connect to that round's database, register the
 *   schema (the tables already exist — the parent created them — so
 *   `initObjects` records metadata and runs no DDL), answer `{ ready }`.
 * - `{ go: <n> }` — write n records as fast as the database lets it,
 *   disconnect, answer the report.
 *
 * stdin closing ends the loop, and the process exits.
 */
const WORKER_SOURCE = `
  import { createRequire } from 'node:module';
  import { createInterface } from 'node:readline';
  const require = createRequire(${JSON.stringify(join(PKG_ROOT, 'package.json'))});
  for (const dependency of ${JSON.stringify(PRELOADED_DEPENDENCIES)}) require(dependency);
  require('tsx/cjs/api').register();
  const { TursoDriver } = require(${JSON.stringify(DRIVER_ENTRY)});
  const { createClient } = require('@libsql/client');
  const { OS_TEST_TAG } = process.env;
  const reply = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
  let driver = null;
  for await (const line of createInterface({ input: process.stdin })) {
    const command = JSON.parse(line);
    if (command.open) {
      const client = createClient({ url: 'file:' + command.open, timeout: 20000 });
      // No disk flush at commit: see "What the file waits on" in the parent.
      await client.execute('PRAGMA synchronous = OFF');
      driver = new TursoDriver({ url: 'libsql://concurrency.probe', client });
      await driver.connect();
      await driver.initObjects([${JSON.stringify(NUMBERED_OBJECT)}]);
      reply({ ready: OS_TEST_TAG });
    } else if (command.go) {
      const numbers = [];
      const errors = [];
      for (let i = 0; i < command.go; i++) {
        try {
          const row = await driver.create('crm_case', { organization_id: 'orgA', title: OS_TEST_TAG + '-' + i });
          numbers.push(row.case_number);
        } catch (e) {
          errors.push(String(e && e.message || e));
        }
      }
      await driver.disconnect();
      driver = null;
      reply({ tag: OS_TEST_TAG, pid: process.pid, numbers, errors });
    }
  }
`;

interface Writer {
  tag: string;
  send(command: Record<string, unknown>): void;
  /** The writer's next answer; rejects with its stderr if it dies or stays silent past the deadline. */
  next<T>(what: string): Promise<T>;
  /** Close stdin and wait for a clean exit; a writer that does not leave is killed. */
  stop(): Promise<void>;
}

function startWriter(tag: string): Writer {
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', WORKER_SOURCE],
    { cwd: PKG_ROOT, env: { ...process.env, OS_TEST_TAG: tag }, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const inbox: unknown[] = [];
  const waiting: Array<{ resolve: (m: unknown) => void; reject: (e: Error) => void }> = [];
  let failure: Error | null = null;
  let stderr = '';
  let pending = '';
  const fail = (e: Error) => {
    failure ??= e;
    while (waiting.length > 0) waiting.shift()!.reject(failure);
  };
  child.stderr.on('data', (d) => { stderr += String(d); });
  child.stdout.on('data', (d) => {
    pending += String(d);
    for (let nl = pending.indexOf('\n'); nl >= 0; nl = pending.indexOf('\n')) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch (e) {
        fail(new Error(`writer ${tag} wrote a line that is not a report: ${String(e)}\nline: ${line}\nstderr:\n${stderr}`));
        return;
      }
      const waiter = waiting.shift();
      if (waiter) waiter.resolve(message);
      else inbox.push(message);
    }
  });
  const exited = new Promise<number | null>((resolve) => child.on('close', resolve));
  child.on('error', fail);
  child.on('close', (code) => fail(new Error(`writer ${tag} exited ${code}\nstderr:\n${stderr}`)));
  return {
    tag,
    send: (command) => { child.stdin.write(JSON.stringify(command) + '\n'); },
    next: <T>(what: string) => {
      if (inbox.length > 0) return Promise.resolve(inbox.shift() as T);
      if (failure) return Promise.reject(failure);
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`writer ${tag} sent no ${what} within ${REPLY_DEADLINE_MS / 1000}s\nstderr:\n${stderr}`)),
          REPLY_DEADLINE_MS,
        );
        waiting.push({
          resolve: (m) => { clearTimeout(timer); resolve(m as T); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        });
      });
    },
    stop: async () => {
      child.stdin.end();
      const killer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      await exited;
      clearTimeout(killer);
    },
  };
}

/**
 * One round: a fresh database, both writers, the barrier, every hard pin.
 * Answers how many times the writer changed in the global order.
 */
async function round(writers: Writer[]): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'turso-autonumber-concurrency-'));
  dirs.push(dir);
  const dbPath = join(dir, 'shared.db');

  // The parent creates the schema through its own remote-mode driver, so
  // both writers find the tables and the unique index already there.
  const parentClient = createClient({ url: `file:${dbPath}`, timeout: 20000 });
  const parent = new TursoDriver({ url: 'libsql://concurrency.probe', client: parentClient });
  await parent.connect();
  await parent.initObjects([NUMBERED_OBJECT as any]);

  // Release both only once both are connected and registered, so the
  // writes contend rather than queue behind connection set-up.
  const opened = Date.now();
  for (const w of writers) w.send({ open: dbPath });
  await Promise.all(writers.map((w) => w.next('ready')));
  const released = Date.now();
  for (const w of writers) w.send({ go: WRITES_PER_WORKER });
  const reports = await Promise.all(writers.map((w) => w.next<WorkerReport>('report')));
  const written = Date.now();

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
  // The phase times say where a slow run went: "ready" includes both process
  // start-ups on the first round only, "writes" is the contention itself.
  process.stdout.write(
    `[turso-remote-autonumber-concurrency] pids ${pids.join('/')} · ${total} writes · ${new Set(all).size} distinct · ` +
      `${switches} writer change(s) · ready ${released - opened}ms · writes ${written - released}ms\n`,
  );
  return switches;
}

describe('[#21113] two writers in two processes draw distinct numbers from one database', () => {
  it(`${WORKERS.length} x ${WRITES_PER_WORKER} creates -> ${WORKERS.length * WRITES_PER_WORKER} distinct, monotonic per writer, and the writers overlapped`, async (ctx) => {
    const writers = WORKERS.map(startWriter);
    const observed: number[] = [];
    try {
      for (let i = 0; i < MAX_ROUNDS; i++) {
        const switches = await round(writers);
        observed.push(switches);
        if (switches >= 2) return;
      }
    } finally {
      await Promise.all(writers.map((w) => w.stop()));
    }
    ctx.skip(
      `NOT MEASURED: in ${MAX_ROUNDS} round(s) the two processes never overlapped on this box ` +
        `(writer changes per round: ${observed.join(', ')}); every round's numbers were distinct and complete, ` +
        `but a serial run cannot vouch for the atomic statement, so this is a skip, not a pass.`,
    );
  }, 300_000);
});
