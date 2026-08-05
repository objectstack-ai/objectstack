// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '../src/index.js';

/**
 * Autonumber persistence across a "restart" (#1603).
 *
 * The whole point of consolidating autonumber generation onto the driver's
 * `_objectstack_sequences` table (instead of the engine's in-memory counter)
 * is that the sequence SURVIVES a process restart and never re-mints a number
 * that was already issued. We prove that here with a FILE-backed sqlite DB and
 * two independent driver instances pointed at the same file: the second driver
 * (a fresh process, cold caches) must continue the sequence, not reset to 1.
 */
describe('SqlDriver auto_number — persistence across driver restart', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  const OBJECT = {
    name: 'contract',
    fields: {
      organization_id: { type: 'string' },
      contract_number: { type: 'autonumber', format: 'CTR-{0000}' },
      name: { type: 'string' },
    },
  };

  function newDriver(filename: string): SqlDriver {
    return new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
    });
  }

  it('continues the sequence from persisted state after the driver is torn down and recreated', async () => {
    dir = mkdtempSync(join(tmpdir(), 'objectstack-autonumber-'));
    const file = join(dir, 'data.sqlite');

    // ── "Process 1" ───────────────────────────────────────────────
    const d1 = newDriver(file);
    await d1.initObjects([OBJECT]);
    const a = await d1.create('contract', { organization_id: 'org_a', name: 'A1' });
    const b = await d1.create('contract', { organization_id: 'org_a', name: 'A2' });
    expect(a.contract_number).toBe('CTR-0001');
    expect(b.contract_number).toBe('CTR-0002');
    await d1.disconnect(); // simulate shutdown — in-memory counters are gone

    // ── "Process 2" — fresh driver, same file, cold caches ────────
    const d2 = newDriver(file);
    await d2.initObjects([OBJECT]);
    const c = await d2.create('contract', { organization_id: 'org_a', name: 'A3' });
    const e = await d2.create('contract', { organization_id: 'org_a', name: 'A4' });

    // The sequence MUST continue — a non-persistent counter would reset to
    // CTR-0001 (a duplicate) here.
    expect(c.contract_number).toBe('CTR-0003');
    expect(e.contract_number).toBe('CTR-0004');
    await d2.disconnect();
  });

  it('keeps per-tenant sequences independent across a restart', async () => {
    dir = mkdtempSync(join(tmpdir(), 'objectstack-autonumber-'));
    const file = join(dir, 'data.sqlite');

    const d1 = newDriver(file);
    await d1.initObjects([OBJECT]);
    await d1.create('contract', { organization_id: 'org_a', name: 'A1' }); // CTR-0001 (a)
    await d1.create('contract', { organization_id: 'org_a', name: 'A2' }); // CTR-0002 (a)
    await d1.create('contract', { organization_id: 'org_b', name: 'B1' }); // CTR-0001 (b)
    await d1.disconnect();

    const d2 = newDriver(file);
    await d2.initObjects([OBJECT]);
    const a3 = await d2.create('contract', { organization_id: 'org_a', name: 'A3' });
    const b2 = await d2.create('contract', { organization_id: 'org_b', name: 'B2' });
    expect(a3.contract_number).toBe('CTR-0003'); // org_a continues from 2
    expect(b2.contract_number).toBe('CTR-0002'); // org_b continues from 1
    await d2.disconnect();
  });
});
