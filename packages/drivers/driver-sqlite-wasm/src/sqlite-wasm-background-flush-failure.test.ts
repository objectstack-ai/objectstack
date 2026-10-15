// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteWasmDriver, WasmSqliteConnection } from './index.js';
import type { PersistMode } from './index.js';

/**
 * A flush nobody awaits — a write under `on-write`, the `debounced:` timer, a
 * transaction closing — has no caller to throw to. Left as a bare
 * `void this.flush()`, a failing one (ENOSPC, the data directory removed under a
 * live driver) reached the process as an `unhandledRejection`, which fails a
 * Vitest run and, under Node's default, terminates a host.
 *
 * The contract pinned here, per call site:
 *  - the failure is REPORTED once per failure episode, at `error`, naming the
 *    database file — never left to the process;
 *  - `dirty` stays set, so the next flush retries and lands once the cause is
 *    gone;
 *  - an AWAITED `flush()` / `close()` is unchanged: it still throws to its
 *    caller (the control).
 *
 * "No unhandled rejection" is asserted two ways. Each test attaches its own
 * `process.on('unhandledRejection')` listener and requires it saw nothing, which
 * keeps the assertion local to the test that owns the failing flush. And Vitest
 * itself fails the run on any unhandled rejection — that is the red this file
 * exists to prevent — so a regression cannot slip past by being caught late.
 */
describe('a failing background flush', () => {
  const dirs: string[] = [];
  const conns: WasmSqliteConnection[] = [];
  const drivers: SqliteWasmDriver[] = [];
  let unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };

  beforeEach(() => {
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(async () => {
    process.off('unhandledRejection', onUnhandled);
    await Promise.all(conns.splice(0).map((c) => c.close().catch(() => {})));
    await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  interface Captured {
    errors: string[];
    warns: string[];
  }

  function capture(): { logger: { warn: (m: string) => void; error: (m: string) => void } } & Captured {
    const errors: string[] = [];
    const warns: string[] = [];
    return {
      errors,
      warns,
      logger: { warn: (m) => warns.push(m), error: (m) => errors.push(m) },
    };
  }

  /** A connection on a fresh file with one table, ready to take writes. */
  async function openConn(
    persist: PersistMode,
    logger: ConstructorParameters<typeof WasmSqliteConnection>[0]['logger'],
  ): Promise<{ conn: WasmSqliteConnection; dir: string; file: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'wasm-bgflush-'));
    dirs.push(dir);
    const file = join(dir, 'bg.db');
    const conn = new WasmSqliteConnection({ filename: file, persist, logger });
    conns.push(conn);
    await conn.open();
    conn.raw.run('CREATE TABLE t (id TEXT)');
    return { conn, dir, file };
  }

  /** What the connection's dialect does for a write: change the image, then mark it. */
  function write(conn: WasmSqliteConnection, id: string): void {
    conn.raw.run('INSERT INTO t VALUES (?)', [id]);
    conn.markDirty();
  }

  /**
   * Wait until every flush queued so far has settled, then give the handlers
   * chained after it and Node's rejection tracking their turn. The chain tail is
   * private, but it is the one deterministic "the background flush is over"
   * signal: a fixed sleep would be a race against the very thing being tested.
   */
  async function settled(conn: WasmSqliteConnection): Promise<void> {
    await (conn as unknown as { flushChain: Promise<void> | null }).flushChain;
    await new Promise((r) => setTimeout(r, 20));
  }

  function isDirty(conn: WasmSqliteConnection): boolean {
    return (conn as unknown as { dirty: boolean }).dirty;
  }

  /** Ids on disk, read through a second connection (the file as a fresh boot sees it). */
  async function idsOnDisk(file: string): Promise<string[]> {
    const reader = new WasmSqliteConnection({ filename: file, persist: 'on-disconnect' });
    conns.push(reader);
    await reader.open();
    const res = reader.raw.exec('SELECT id FROM t ORDER BY id');
    return (res[0]?.values ?? []).map((row) => String(row[0]));
  }

  // ── The three fire-and-forget sites ────────────────────────────────────────

  it('on-write: a write whose flush fails is reported, not rejected unhandled', async () => {
    const log = capture();
    const { conn, dir, file } = await openConn('on-write', log.logger);
    rmSync(dir, { recursive: true, force: true });

    write(conn, 'a');
    await settled(conn);

    expect(unhandled).toEqual([]);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]).toContain(file);
    expect(log.errors[0]).toContain('NOT on disk');
    expect(log.warns).toEqual([]);
    expect(isDirty(conn)).toBe(true);
  });

  it('debounced: the timer-driven flush that fails is reported, not rejected unhandled', async () => {
    const log = capture();
    const { conn, dir, file } = await openConn('debounced:5', log.logger);
    rmSync(dir, { recursive: true, force: true });

    write(conn, 'a');
    await vi.waitFor(() => {
      if (!(conn as unknown as { flushChain: unknown }).flushChain) {
        throw new Error('the debounced flush has not started');
      }
    });
    await settled(conn);

    expect(unhandled).toEqual([]);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]).toContain(file);
    expect(isDirty(conn)).toBe(true);
  });

  it('transaction close: the flush deferred past a COMMIT that fails is reported, not rejected unhandled', async () => {
    const log = capture();
    const { conn, dir, file } = await openConn('on-write', log.logger);
    rmSync(dir, { recursive: true, force: true });

    conn.noteTransactionControl('BEGIN');
    write(conn, 'a'); // wants a flush; deferred while the transaction is open
    expect((conn as unknown as { flushChain: unknown }).flushChain).toBeNull();
    conn.noteTransactionControl('COMMIT'); // the transaction closes: the deferred flush runs now
    await settled(conn);

    expect(unhandled).toEqual([]);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]).toContain(file);
    expect(isDirty(conn)).toBe(true);
  });

  // ── Retry, and one report per episode ──────────────────────────────────────

  it('dirty stays set: the next flush retries and lands once the cause is gone', async () => {
    const log = capture();
    const { conn, dir, file } = await openConn('on-write', log.logger);
    rmSync(dir, { recursive: true, force: true });

    write(conn, 'a');
    write(conn, 'b');
    await settled(conn);
    expect(isDirty(conn)).toBe(true);
    expect(existsSync(file)).toBe(false);

    mkdirSync(dir, { recursive: true }); // the cause is gone
    write(conn, 'c'); // the next write's background flush is the retry
    await settled(conn);

    expect(unhandled).toEqual([]);
    expect(isDirty(conn)).toBe(false);
    expect(await idsOnDisk(file)).toEqual(['a', 'b', 'c']); // nothing lost to the failed attempts
  });

  it('reports once per failure episode: not once per write, again after a flush has landed', async () => {
    const log = capture();
    const { conn, dir } = await openConn('on-write', log.logger);
    rmSync(dir, { recursive: true, force: true });

    write(conn, 'a');
    write(conn, 'b');
    write(conn, 'c');
    await settled(conn);
    expect(log.errors).toHaveLength(1); // three failed flushes, one line

    mkdirSync(dir, { recursive: true });
    await conn.flush(); // lands
    rmSync(dir, { recursive: true, force: true });
    write(conn, 'd');
    await settled(conn);

    expect(unhandled).toEqual([]);
    expect(log.errors).toHaveLength(2); // a new episode is a new report
  });

  // ── The report itself can never become the rejection ───────────────────────

  it('a logger with only warn still hears it, at warn', async () => {
    const warns: string[] = [];
    const { conn, dir, file } = await openConn('on-write', { warn: (m: string) => warns.push(m) });
    rmSync(dir, { recursive: true, force: true });

    write(conn, 'a');
    await settled(conn);

    expect(unhandled).toEqual([]);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(file);
  });

  it('a logger that throws does not turn the report into an unhandled rejection', async () => {
    const boom = (): never => {
      throw new Error('logger is down');
    };
    const { conn, dir } = await openConn('on-write', { warn: boom, error: boom });
    rmSync(dir, { recursive: true, force: true });

    write(conn, 'a');
    await settled(conn);

    expect(unhandled).toEqual([]);
    expect(isDirty(conn)).toBe(true);
  });

  // ── CONTROL: an awaited flush still throws to its caller ───────────────────

  it('CONTROL: an awaited flush() still rejects to its caller, and does not also log', async () => {
    const log = capture();
    const { conn, dir } = await openConn('on-disconnect', log.logger);
    rmSync(dir, { recursive: true, force: true });

    write(conn, 'a'); // on-disconnect: marks dirty, schedules nothing
    await expect(conn.flush()).rejects.toMatchObject({ code: 'ENOENT' });

    expect(unhandled).toEqual([]);
    expect(log.errors).toEqual([]); // the caller was told; no second voice
    expect(isDirty(conn)).toBe(true); // and a later flush still retries

    mkdirSync(dir, { recursive: true });
    await expect(conn.flush()).resolves.toBeUndefined();
    expect(isDirty(conn)).toBe(false);
  });

  it('CONTROL: close() still rejects to its caller when the final flush fails', async () => {
    const log = capture();
    const { conn, dir } = await openConn('on-disconnect', log.logger);
    rmSync(dir, { recursive: true, force: true });

    write(conn, 'a');
    await expect(conn.close()).rejects.toMatchObject({ code: 'ENOENT' });

    expect(unhandled).toEqual([]);
    expect(log.errors).toEqual([]);
  });

  // ── Through the driver: the shape of the dogfood race ──────────────────────

  it('driver on-write: the data directory removed under a live driver is reported, the public flush() still throws', async () => {
    const log = capture();
    const dir = mkdtempSync(join(tmpdir(), 'wasm-bgflush-drv-'));
    dirs.push(dir);
    const file = join(dir, 'drv.db');
    const driver = new SqliteWasmDriver({ filename: file, persist: 'on-write', logger: log.logger });
    drivers.push(driver);
    await driver.initObjects([{ name: 'acct', fields: { name: { type: 'string' } } }]);
    const knex = (driver as any).knex;
    await knex('acct').insert({ id: 'a1', name: 'A' });
    await driver.flush();
    expect(existsSync(file)).toBe(true);

    // The refused boot's driver is never torn down; the test's cleanup removes
    // the directory under it; the next write's flush meets the missing directory.
    rmSync(dir, { recursive: true, force: true });
    await knex('acct').insert({ id: 'a2', name: 'B' });
    const conn = await knex.client.acquireConnection();
    await knex.client.releaseConnection(conn);
    await settled(conn);

    expect(unhandled).toEqual([]);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]).toContain(file);
    await expect(driver.flush()).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
