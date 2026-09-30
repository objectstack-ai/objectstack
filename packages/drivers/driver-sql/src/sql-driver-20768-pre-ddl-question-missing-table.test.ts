// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20768] A missing table read by a driver's own PRE-DDL question leaves the
 * warn channel. Nothing else does.
 *
 * ## The measured defect
 *
 * `objectstack dev --database file:NEW.sqlite` on `examples/app-crm` printed
 * one line on the first boot of a new database, on the driver's warn channel
 * (stderr):
 *
 * ```text
 * [sql-driver] DATABASE_ERROR — the backend refused a read on 'sys_migration' (SQLITE_ERROR) ...
 * select * from `sys_migration` where `id` = 'adr-0104-file-references' limit 1 - no such table: sys_migration
 * ```
 *
 * The read is the engine's migration-gate read. The ADR-0104 media-arm
 * resolver reaches it, and this driver asks that resolver at the start of its
 * first `initObjects`, before its schema pass has created any table. On a new
 * database the ledger is not there yet, the resolver answers "not moved", and
 * that answer is right. Only the log line was wrong.
 *
 * ## What this file pins, from the driver's side
 *
 * The engine-driven boot is pinned in `@objectstack/runtime`
 * (`first-boot-migration-gate-read.integration.test.ts`). Here the resolver is
 * a stand-in that reads the ledger the way the engine does: one row by id,
 * with a failed read answered as "not moved".
 *
 *  ① first boot: the question's read of a table that does not exist yet goes
 *    to `debug`, not `warn`. The resolver still gets the refusal envelope, and
 *    the arm is the one it always was.
 *  ② the same holds when the ledger is served by ANOTHER driver instance: the
 *    scope follows the async chain, not the instance.
 *  ③ second boot: the table exists, the read succeeds, nothing is logged, and
 *    the answer comes from the ledger row.
 *
 * Controls, each a refusal that must still warn:
 *
 *  ④ a malformed read on an EXISTING table, inside the question;
 *  ⑤ a missing table named by some OTHER relation (a view over a dropped
 *    table), inside the question;
 *  ⑥ a missing table read OUTSIDE the question.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import type { SqlDriverConfig } from './sql-driver.js';

const LEDGER = 'sys_migration';
const MIGRATION_ID = 'adr-0104-file-references';
/** The ledger's columns the engine's gate read looks at, as a stand-in object. */
const LEDGER_OBJECT = {
  name: LEDGER,
  fields: {
    last_run_at: { type: 'text' },
    verified_at: { type: 'text' },
    columns_moved_at: { type: 'text' },
    blocking: { type: 'number' },
  },
};
/** An app object with a media column: the column the arm decides the encoding of. */
const MEDIA_OBJECT = { name: 'os20768_doc', fields: { cover: { type: 'image' }, title: { type: 'text' } } };

type Line = { level: 'warn' | 'debug' | 'info' | 'error'; message: string };

/** Reads the arm the way every writer and every DDL branch reads it. */
class ArmProbe extends SqlDriver {
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

  get arm(): boolean {
    return (this as unknown as { fileColumnsMoved: boolean }).fileColumnsMoved;
  }

  databaseErrors(level: Line['level'], object: string): string[] {
    return this.lines
      .filter((l) => l.level === level && l.message.includes(`'${object}'`))
      .map((l) => l.message);
  }
}

const open: ArmProbe[] = [];
const dirs: string[] = [];

function newDatabaseFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-20768-'));
  dirs.push(dir);
  // Named but not created: the first driver to connect creates it, as a new
  // deployment's first boot does.
  return join(dir, 'new.sqlite');
}

function driver(filename: string): ArmProbe {
  const d = new ArmProbe({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
  } as SqlDriverConfig);
  open.push(d);
  return d;
}

/** A resolver shaped like the engine's: read one ledger row, a failure is "not moved". */
function ledgerResolver(ledger: SqlDriver, observed: { error?: any; row?: any; asked: number }) {
  return async (): Promise<boolean> => {
    observed.asked += 1;
    try {
      observed.row = await ledger.findOne(LEDGER, { where: { id: MIGRATION_ID } });
      return observed.row?.verified_at != null && observed.row?.columns_moved_at != null;
    } catch (e) {
      observed.error = e;
      return false;
    }
  };
}

afterEach(async () => {
  while (open.length) await open.pop()?.disconnect().catch(() => {});
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('[#20768] a missing table read by the pre-DDL question is not a DATABASE_ERROR', () => {
  it('① first boot: the ledger read goes to debug; the resolver hears the refusal; the arm is unchanged', async () => {
    const d = driver(newDatabaseFile());
    const observed: { error?: any; row?: any; asked: number } = { asked: 0 };
    expect(d.setFileColumnsMovedResolver(ledgerResolver(d, observed))).toBe(true);

    await d.initObjects([LEDGER_OBJECT, MEDIA_OBJECT] as any);

    // The question was asked, and its read really was refused, with the envelope.
    expect(observed.asked).toBe(1);
    expect(observed.error?.code).toBe('DATABASE_ERROR');
    expect(observed.error?.status).toBe(500);
    // No warn line for the ledger ...
    expect(d.databaseErrors('warn', LEDGER)).toEqual([]);
    // ... and the demoted line exists: demoted, not deleted.
    const demoted = d.databaseErrors('debug', LEDGER);
    expect(demoted).toHaveLength(1);
    expect(demoted[0]).toContain('no such table');
    // The arm the resolver's answer set: "not moved", as before.
    expect(d.arm).toBe(false);
    // The schema pass went on to create the ledger.
    expect(await d.find(LEDGER, {})).toEqual([]);
  });

  it('② the scope follows the async chain: a ledger served by another driver instance is demoted too', async () => {
    const asker = driver(newDatabaseFile());
    const ledger = driver(newDatabaseFile());
    const observed: { error?: any; row?: any; asked: number } = { asked: 0 };
    asker.setFileColumnsMovedResolver(ledgerResolver(ledger, observed));

    await asker.initObjects([MEDIA_OBJECT] as any);

    expect(observed.error?.code).toBe('DATABASE_ERROR');
    expect(ledger.databaseErrors('warn', LEDGER)).toEqual([]);
    expect(ledger.databaseErrors('debug', LEDGER)).toHaveLength(1);
    expect(asker.arm).toBe(false);
  });

  it('③ second boot: the read succeeds, nothing is logged, and the answer comes from the ledger row', async () => {
    const file = newDatabaseFile();
    const first = driver(file);
    first.setFileColumnsMovedResolver(ledgerResolver(first, { asked: 0 }));
    await first.initObjects([LEDGER_OBJECT, MEDIA_OBJECT] as any);
    // Between boots, the column move is recorded, so the second boot's answer
    // can only be "moved" if its read reached the row.
    const now = new Date().toISOString();
    await first.create(
      LEDGER,
      { id: MIGRATION_ID, last_run_at: now, verified_at: now, columns_moved_at: now, blocking: 0 },
      { bypassTenantAudit: true },
    );
    await first.disconnect();

    const second = driver(file);
    const observed: { error?: any; row?: any; asked: number } = { asked: 0 };
    second.setFileColumnsMovedResolver(ledgerResolver(second, observed));
    await second.initObjects([LEDGER_OBJECT, MEDIA_OBJECT] as any);

    expect(observed.error).toBeUndefined();
    expect(observed.row?.id).toBe(MIGRATION_ID);
    expect(second.arm).toBe(true);
    expect(second.lines.filter((l) => l.message.includes('DATABASE_ERROR'))).toEqual([]);
    expect(second.databaseErrors('debug', LEDGER)).toEqual([]);
  });
});

describe('[#20768] CONTROLS — every other refusal still warns', () => {
  it('④ a malformed read on an EXISTING table, inside the question, still warns', async () => {
    const file = newDatabaseFile();
    const first = driver(file);
    await first.initObjects([LEDGER_OBJECT] as any);
    await first.disconnect();

    const d = driver(file);
    const observed: { error?: any; row?: any; asked: number } = { asked: 0 };
    // More bound variables than SQLite accepts in one statement: the backend
    // refuses the statement, and the table is there.
    const tooMany: NonNullable<DriverQuery['where']> = {
      id: { $in: Array.from({ length: 40_000 }, (_, i) => `k${i}`) },
    };
    d.setFileColumnsMovedResolver(async () => {
      observed.asked += 1;
      try {
        await d.find(LEDGER, { where: tooMany });
      } catch (e) {
        observed.error = e;
      }
      return false;
    });

    await d.initObjects([MEDIA_OBJECT] as any);

    expect(observed.asked).toBe(1);
    expect(observed.error?.code).toBe('DATABASE_ERROR');
    expect(observed.error?.status).toBe(500);
    const warned = d.databaseErrors('warn', LEDGER);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('DATABASE_ERROR');
    expect(d.databaseErrors('debug', LEDGER)).toEqual([]);
  });

  it('⑤ a missing table named by ANOTHER relation (a view over a dropped table), inside the question, still warns', async () => {
    const file = newDatabaseFile();
    const first = driver(file);
    await first.initObjects([LEDGER_OBJECT] as any);
    await first.execute('create table os20768_gone (id text primary key)');
    await first.execute('create view os20768_view as select * from os20768_gone');
    await first.execute('drop table os20768_gone');
    await first.disconnect();

    const d = driver(file);
    const observed: { error?: any; asked: number } = { asked: 0 };
    d.setFileColumnsMovedResolver(async () => {
      observed.asked += 1;
      try {
        await d.find('os20768_view', {});
      } catch (e) {
        observed.error = e;
      }
      return false;
    });

    await d.initObjects([MEDIA_OBJECT] as any);

    expect(observed.error?.code).toBe('DATABASE_ERROR');
    expect(observed.error?.status).toBe(500);
    expect(d.databaseErrors('warn', 'os20768_view')).toHaveLength(1);
    expect(d.databaseErrors('debug', 'os20768_view')).toEqual([]);
  });

  it('⑥ a missing table read OUTSIDE the question still warns', async () => {
    const d = driver(newDatabaseFile());
    d.setFileColumnsMovedResolver(ledgerResolver(d, { asked: 0 }));
    await d.initObjects([LEDGER_OBJECT] as any);
    // The question has been asked and answered; the scope is closed.
    let refusal: any;
    try {
      await d.find('os20768_never_created', {});
    } catch (e) {
      refusal = e;
    }
    expect(refusal?.code).toBe('DATABASE_ERROR');
    expect(refusal?.status).toBe(500);
    const warned = d.databaseErrors('warn', 'os20768_never_created');
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('no such table');
    expect(d.databaseErrors('debug', 'os20768_never_created')).toEqual([]);
  });
});
