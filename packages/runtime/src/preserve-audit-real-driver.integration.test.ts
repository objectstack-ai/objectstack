// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Real-SQLite end-to-end for the `preserveAudit` seam (#3493 / #3549 / #3556).
 *
 * A "historical" import (`treatAsHistorical`) writes with `context.preserveAudit`
 * so it KEEPS the original `updated_at` and author-declared business `readonly`
 * fields (`closed_at`) instead of stamping-now / stripping them. The undo of such
 * an import mirrors that flag so restoring the captured pre-import snapshot rolls
 * the timeline BACK rather than re-stamping it (#3549 → fixed in #3556).
 *
 * Each half is already unit-tested in isolation — the engine's audit hook +
 * readonly-strip whitelist against a mock driver (objectql `plugin.integration`),
 * and the SQL driver's own `updated_at` force-stamp bypass against a directly-
 * supplied option (`driver-sql` `sql-driver-timestamp-format`). What NEITHER can
 * prove is the SEAM BETWEEN them: that `context.preserveAudit` set on an engine
 * write actually threads through `buildDriverOptions` into the driver's options
 * and defeats the REAL SQL `updated_at` force-stamp end-to-end. A mock/in-memory
 * driver echoes `data.updated_at` and never force-stamps, so it structurally
 * cannot catch a break in that thread. This wires the REAL {@link ObjectQL}
 * engine to the REAL {@link SqlDriver} (better-sqlite3, on-disk) and reads the
 * persisted row back to pin the whole path.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HISTORICAL = '2021-03-01T09:00:00.000Z';

const TICKET = {
  name: 'ticket',
  fields: {
    name: { type: 'text' },
    // Author-declared business readonly field — a case's close time. Normally
    // stripped on a client write; a historical import (preserveAudit) reinstates it.
    closed_at: { type: 'datetime', readonly: true },
  },
};

describe('preserveAudit end-to-end on a REAL SqlDriver (#3493 / #3549)', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  async function boot() {
    dir = mkdtempSync(join(tmpdir(), 'os-preserveaudit-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    await driver.initObjects([TICKET]); // create the real table + audit columns
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(TICKET as any);
    return engine;
  }

  const readOne = async (id: string): Promise<any> =>
    (await (engine as ObjectQL).find('ticket', { where: { id } }))[0];

  it('historical write: preserveAudit keeps the supplied updated_at AND the business readonly closed_at, through the SQL force-stamp', async () => {
    const e = await boot();
    const rec: any = await e.insert('ticket', { name: 'A' });
    const id = rec.id;

    await e.update(
      'ticket',
      { id, name: 'B', updated_at: HISTORICAL, closed_at: HISTORICAL },
      { context: { preserveAudit: true } } as any,
    );

    const row = await readOne(id);
    expect(row.name).toBe('B');
    // The engine threaded preserveAudit into the driver options, so the driver's
    // updated_at force-stamp was bypassed and the supplied instant survived to disk.
    expect(row.updated_at).toBe(HISTORICAL);
    // The engine's readonly-strip whitelist admitted the business readonly field,
    // and it was actually written by the real driver (not just echoed by a mock).
    expect(row.closed_at).toBe(HISTORICAL);
  });

  it('normal write (control): without preserveAudit the SQL driver force-stamps updated_at and the engine strips readonly closed_at', async () => {
    const e = await boot();
    const rec: any = await e.insert('ticket', { name: 'A' });
    const id = rec.id;

    await e.update(
      'ticket',
      { id, name: 'B', updated_at: HISTORICAL, closed_at: HISTORICAL },
      { context: {} } as any,
    );

    const row = await readOne(id);
    expect(row.name).toBe('B');
    expect(row.updated_at).toMatch(ISO_Z);
    expect(row.updated_at).not.toBe(HISTORICAL); // force-stamped "now", not the supplied instant
    expect(row.closed_at ?? null).toBeNull();     // readonly business field stripped — never reached the driver
  });

  it('undo capstone (#3549): restoring a captured pre-import snapshot under preserveAudit rolls updated_at BACK; without the flag it re-stamps now (the corruption #3556 prevents)', async () => {
    const e = await boot();
    const rec: any = await e.insert('ticket', { name: 'A' });
    const id = rec.id;
    const original = await readOne(id);
    expect(original.updated_at).toMatch(ISO_Z);

    // Ensure "now" is measurably later than the original insert stamp.
    await new Promise((r) => setTimeout(r, 5));

    // A historical import moves the row's recorded timeline to the historical instant.
    await e.update('ticket', { id, name: 'B', updated_at: HISTORICAL }, { context: { preserveAudit: true } } as any);
    expect((await readOne(id)).updated_at).toBe(HISTORICAL);

    // The pre-import snapshot the undo log captured (payload keys only).
    const before = { id, name: original.name, updated_at: original.updated_at };

    // Undo WITH preserveAudit (the #3556 fix): the original timeline is restored,
    // not re-stamped — the driver's force-stamp is bypassed on the restore write too.
    await e.update('ticket', before, { context: { preserveAudit: true, skipAutomations: true } } as any);
    expect((await readOne(id)).updated_at).toBe(original.updated_at);

    // Control — the SAME restore WITHOUT preserveAudit (the pre-#3556 behavior):
    // move the timeline again, then undo with a plain context. The SQL driver
    // force-stamps now, so the captured original is silently lost. This is exactly
    // the #3549 corruption the fix removes.
    await e.update('ticket', { id, name: 'B2', updated_at: HISTORICAL }, { context: { preserveAudit: true } } as any);
    await e.update('ticket', before, { context: { skipAutomations: true } } as any);
    const corrupted = await readOne(id);
    expect(corrupted.updated_at).toMatch(ISO_Z);
    expect(corrupted.updated_at).not.toBe(original.updated_at); // timeline NOT restored — the bug shape
  });
});
