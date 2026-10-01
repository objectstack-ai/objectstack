// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20821] A missing table whose DDL THIS driver deferred leaves the warn
 * channel. Nothing else does.
 *
 * ## The measured defect
 *
 * `os migrate plan --database-url file:ABSENT.sqlite` boots with the driver's
 * DDL deferred (`setDeferredDdl(true)`), so the plan can list every table as
 * `create_table` instead of creating it. The same boot then reads
 * `sys_metadata` (four readers), `sys_metadata_activation` and `sys_migration`,
 * every one of which the plan has just listed as not existing yet. Each read
 * was refused, each reader already answered from the refusal, and each refusal
 * also printed a `[sql-driver] DATABASE_ERROR` line on the warn channel: six
 * alarms on a dry run where nothing was wrong.
 *
 * ## What this file pins, from the driver's side
 *
 * The command-level pin lives in `@objectstack/cli`
 * (`src/commands/migrate/plan.deferred-reads.integration.test.ts`). Here the
 * three conditions are exercised one at a time, each against a real SQLite
 * file, and every case asserts the refusal itself is unchanged: the caller
 * still gets the ADR-0112 envelope (`DATABASE_ERROR`, `500`).
 *
 *  ① DDL deferred, table in this driver's deferred set, table missing: the
 *    refusal goes to `debug`, not `warn`. After the deferred work is flushed
 *    the table exists and the same read answers with nothing logged.
 *
 * Controls, each a refusal that must still warn:
 *
 *  ② a malformed read on an EXISTING table whose DDL is deferred (the backend
 *    refuses the statement, and the table is there);
 *  ③ a missing table that is NOT in the deferred set, on the same deferred
 *    driver (nobody in this boot declared it, so its absence is information).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import type { SqlDriverConfig } from './sql-driver.js';

/** An object this boot declares, standing in for `sys_metadata` and its peers. */
const DEFERRED = { name: 'os20821_deferred', fields: { name: { type: 'text' }, state: { type: 'text' } } };
/** A table nothing in the boot declares. */
const UNDECLARED = 'os20821_undeclared';

type Line = { level: 'warn' | 'debug' | 'info' | 'error'; message: string };

class LineProbe extends SqlDriver {
  readonly lines: Line[] = [];

  constructor(config: SqlDriverConfig) {
    super(config);
    // Arrow closures on purpose: this sink records, it is not the receiver test
    // (`logger-receiver-detach.test.ts` owns that).
    (this as unknown as { logger: Record<Line['level'], (m: string) => void> }).logger = {
      warn: (m) => this.lines.push({ level: 'warn', message: String(m) }),
      debug: (m) => this.lines.push({ level: 'debug', message: String(m) }),
      info: (m) => this.lines.push({ level: 'info', message: String(m) }),
      error: (m) => this.lines.push({ level: 'error', message: String(m) }),
    };
  }

  linesFor(level: Line['level'], object: string): string[] {
    return this.lines
      .filter((l) => l.level === level && l.message.includes(`'${object}'`))
      .map((l) => l.message);
  }
}

const open: LineProbe[] = [];
const dirs: string[] = [];

function databaseFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-20821-'));
  dirs.push(dir);
  return join(dir, 'app.sqlite');
}

function driver(filename: string): LineProbe {
  const d = new LineProbe({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
  } as SqlDriverConfig);
  open.push(d);
  return d;
}

/** A driver booted the way `os migrate plan` boots it: DDL deferred, objects declared. */
async function deferredDriver(filename: string): Promise<LineProbe> {
  const d = driver(filename);
  d.setDeferredDdl(true);
  await d.initObjects([DEFERRED] as any);
  expect(d.deferredSchemaObjectCount).toBe(1);
  return d;
}

async function refusalOf(read: () => Promise<unknown>): Promise<any> {
  try {
    await read();
  } catch (e) {
    return e;
  }
  throw new Error('expected the backend to refuse this read');
}

afterEach(async () => {
  while (open.length) await open.pop()?.disconnect().catch(() => {});
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('[#20821] a missing table whose DDL this driver deferred is not a DATABASE_ERROR', () => {
  it('① deferred and missing: the read goes to debug, the caller still gets the envelope, and the flush ends it', async () => {
    const d = await deferredDriver(databaseFile());

    const refusal = await refusalOf(() => d.find(DEFERRED.name, { where: { state: 'active' } }));

    expect(refusal?.code).toBe('DATABASE_ERROR');
    expect(refusal?.status).toBe(500);
    expect(d.linesFor('warn', DEFERRED.name)).toEqual([]);
    // Demoted, not deleted: the dialect text is still on the debug channel.
    const demoted = d.linesFor('debug', DEFERRED.name);
    expect(demoted).toHaveLength(1);
    expect(demoted[0]).toContain('no such table');

    // `os migrate apply` flushes the deferred work: the table now exists and
    // the same read answers, with nothing logged at any level.
    await d.flushDeferredSchemaDdl();
    const before = d.lines.length;
    expect(await d.find(DEFERRED.name, { where: { state: 'active' } })).toEqual([]);
    expect(d.lines.slice(before).filter((l) => l.message.includes(`'${DEFERRED.name}'`))).toEqual([]);
  });
});

describe('[#20821] CONTROLS — every other refusal on a deferred driver still warns', () => {
  it('② a malformed read on an EXISTING table whose DDL is deferred still warns', async () => {
    const file = databaseFile();
    const first = driver(file);
    await first.initObjects([DEFERRED] as any);
    await first.disconnect();

    const d = await deferredDriver(file);
    // More bound variables than SQLite accepts in one statement: the backend
    // refuses the statement, and the table is there.
    const tooMany: NonNullable<DriverQuery['where']> = {
      id: { $in: Array.from({ length: 40_000 }, (_, i) => `k${i}`) },
    };

    const refusal = await refusalOf(() => d.find(DEFERRED.name, { where: tooMany }));

    expect(refusal?.code).toBe('DATABASE_ERROR');
    expect(refusal?.status).toBe(500);
    const warned = d.linesFor('warn', DEFERRED.name);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('DATABASE_ERROR');
    expect(d.linesFor('debug', DEFERRED.name)).toEqual([]);
  });

  it('③ a missing table OUTSIDE the deferred set, on the same deferred driver, still warns', async () => {
    const d = await deferredDriver(databaseFile());

    const refusal = await refusalOf(() => d.find(UNDECLARED, {}));

    expect(refusal?.code).toBe('DATABASE_ERROR');
    expect(refusal?.status).toBe(500);
    const warned = d.linesFor('warn', UNDECLARED);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('no such table');
    expect(d.linesFor('debug', UNDECLARED)).toEqual([]);
  });
});
