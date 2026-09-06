// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16028] The `isSqlite` override, pinned DIRECTLY — the one thing that makes
 * this transport answer `"sqlite"` when something outside the driver asks which
 * SQL it speaks.
 *
 * ## Why this file exists
 *
 * `SqlDriver.dialectName` is public for exactly one consumer:
 * `service-analytics` compiles its own statements (an analytics `where`, an
 * ADR-0021 D-C read scope, the `/analytics/sql` echo) and needs the same
 * per-dialect construct choices the driver makes. Answering `'sqlite'` is what
 * routes `$icontains` onto `lower(col) GLOB lower(?)`; answering `'unknown'`
 * routes it onto the residue arm instead.
 *
 * The base class derives that answer by STRING-MATCHING `config.client` against
 * {@link SqlDriver}'s emission sets — and this transport passes a knex Client
 * CLASS, which is no string at all. So the correct answer here is produced by
 * one three-line override and by nothing else.
 *
 * ⚠️ #16028 measured that override at **0 direct test hits**: the only cover was
 * an indirect row-set pin (#15684), which would keep passing if the override
 * moved, because the ROWS come out the same either way — the driver runs its own
 * SQL through its own SQLite. What changes silently is the answer handed to a
 * package that compiles SQL for a DIFFERENT engine. That is the gap this file
 * closes, and it is the reason the control below is not decoration: it shows the
 * base class answering `'unknown'` for this exact config, so the pin above is a
 * measurement of the override rather than of the class hierarchy.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';

import { SqliteWasmDriver } from '../src/index.js';

/** Nothing here connects — but every knex instance built is still torn down. */
const opened: Array<{ disconnect(): Promise<void> }> = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.disconnect().catch(() => {})));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const track = <T extends { disconnect(): Promise<void> }>(d: T): T => {
  opened.push(d);
  return d;
};

describe('[#16028] SqliteWasmDriver names its dialect', () => {
  it('answers "sqlite" — the answer service-analytics compiles against', () => {
    // Read WITHOUT connecting, deliberately: `service-analytics` asks this
    // while BUILDING a statement, so an answer that needed a live pool would
    // arrive after the SQL it decides.
    expect(track(new SqliteWasmDriver({ filename: ':memory:' })).dialectName).toBe('sqlite');
  });

  it('…on a file-backed database too, and with persistence on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wasm-dialect-'));
    dirs.push(dir);
    const file = join(dir, 'test.db');
    expect(track(new SqliteWasmDriver({ filename: file })).dialectName).toBe('sqlite');
    expect(track(new SqliteWasmDriver({ filename: file, persist: 'on-write' })).dialectName).toBe('sqlite');
  });

  it('the client is a CLASS, so no string table could have answered it', () => {
    // The override's premise, asserted rather than assumed: if this ever became
    // a string knex spelling, the base class would answer on its own and the
    // override would be dead code rather than the load-bearing line it is.
    const client = (SqliteWasmDriver.toKnexConfig({ filename: ':memory:' }) as { client: unknown }).client;
    expect(typeof client).toBe('function');
    expect(typeof client).not.toBe('string');
  });

  it('CONTROL: the base class answers "unknown" for this very config', () => {
    // Delete `isSqlite` from the subclass and this is what `service-analytics`
    // would be told — #16028's residue arm, which for `$icontains` emitted a
    // statement SQLite cannot parse at all until that card. This is what makes
    // the pin above a measurement of the OVERRIDE rather than of the hierarchy.
    const base = track(new SqlDriver(SqliteWasmDriver.toKnexConfig({ filename: ':memory:', pool: { min: 0, max: 1 } })));
    expect(base.dialectName).toBe('unknown');
  });
});
