// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0104 / #4797 — the CONSUMER half: byte deletion stops while a deviation
 * stands.
 *
 * The marker is the point of the card, but a marker with no consumer is worse
 * than nothing: the ledger would declare "this deployment deviated" and the
 * reclamation sweep would delete the bytes exactly as before, on a certificate
 * the deployment's own data has contradicted. Unconditional "record and warn"
 * was rejected for precisely that reason.
 *
 * So these tests are about which predicate the irreversible path reads. The
 * existing reap-guard tests already pin "gate closed ⇒ veto" with a stub
 * callback; what they cannot see is that the callback the storage plugin
 * actually supplies is the STRONGER one. A row that is `verified_at`-set,
 * `blocking: 0`, and carrying a deviation marker passes
 * `isDataMigrationVerified` and fails `mayActIrreversibly` — and it is the
 * second that must reach the byte delete. Wiring it back to the first is the
 * regression these pin.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isDataMigrationVerified,
  mayActIrreversibly,
  recordDataMigrationRun,
  type MigrationFlagEngine,
} from '@objectstack/platform-objects/system';
import { FILE_REFERENCES_MIGRATION_ID } from '@objectstack/spec/system';
import { createSysFileReapGuard, type AttachmentLifecycleEngine } from './attachment-lifecycle.js';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
const storage = () => ({ delete: vi.fn(async () => {}) }) as any;

/** A `sys_migration` row as a real `os migrate … --apply` leaves it. */
function verifiedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: FILE_REFERENCES_MIGRATION_ID,
    last_run_at: now,
    verified_at: now,
    applied_at: now,
    blocking: 0,
    advisory: 0,
    details: JSON.stringify({ scanned_records: 12_000 }),
    deviation_observed_at: null,
    deviation_detail: null,
    ...overrides,
  };
}

/** The ledger-reading surface both predicates run against. */
function ledgerEngine(rows: Array<Record<string, unknown>>) {
  const tables: Record<string, Array<Record<string, unknown>>> = { sys_migration: rows };
  const engine: MigrationFlagEngine & { tables: typeof tables } = {
    getObject: (name: string) => (name in tables ? { name } : undefined),
    async find(object, options: any) {
      const where = options?.where ?? {};
      return tables[object].filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    },
    async insert(object, data) {
      tables[object].push({ ...data });
      return data;
    },
    async update(object, data: any) {
      const row = tables[object].find((r) => r.id === data.id);
      if (row) Object.assign(row, data);
      return row;
    },
    tables,
  };
  return engine;
}

/** The file half of the sweep — enough for the reap guard's re-verification. */
function reapEngine() {
  const tables: Record<string, Array<Record<string, unknown>>> = { sys_attachment: [], sys_file: [] };
  const updates: Array<{ object: string; data: any }> = [];
  const engine: AttachmentLifecycleEngine & { updates: typeof updates } = {
    registerHook() {},
    async find(object, options: any) {
      const where = options?.where ?? {};
      return tables[object].filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    },
    async findOne(object, options: any) {
      const where = options?.where ?? {};
      return tables[object].find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null;
    },
    async update(object, data: any) {
      updates.push({ object, data });
      return data;
    },
    updates,
  } as any;
  return engine;
}

/** One released field file, tombstoned and past its grace window. */
const RELEASED_FIELD_FILE = {
  id: 'f1',
  key: 'user/f1.png',
  status: 'deleted',
  scope: 'user',
  ref_object: null,
  ref_id: null,
};

describe('the two predicates disagree exactly where it matters (#4797)', () => {
  it('a deviation on a verified row keeps the certificate and withdraws the irreversible half', async () => {
    const engine = ledgerEngine([verifiedRow({ deviation_observed_at: new Date().toISOString() })]);

    // Still certified — strict enforcement and tombstoning keep running.
    await expect(isDataMigrationVerified(engine, FILE_REFERENCES_MIGRATION_ID)).resolves.toBe(true);
    // But nothing may be deleted forever on it.
    await expect(mayActIrreversibly(engine, FILE_REFERENCES_MIGRATION_ID)).resolves.toBe(false);
  });

  it('an untouched certificate authorises both halves', async () => {
    const engine = ledgerEngine([verifiedRow()]);
    await expect(isDataMigrationVerified(engine, FILE_REFERENCES_MIGRATION_ID)).resolves.toBe(true);
    await expect(mayActIrreversibly(engine, FILE_REFERENCES_MIGRATION_ID)).resolves.toBe(true);
  });

  it('a row written before the column existed reads as "no deviation", not as unreadable', async () => {
    const legacy = verifiedRow();
    delete legacy.deviation_observed_at;
    delete legacy.deviation_detail;
    const engine = ledgerEngine([legacy]);
    // Upgrading the platform must not retroactively close a gate a deployment
    // earned; the marker only ever closes it on an OBSERVED deviation.
    await expect(mayActIrreversibly(engine, FILE_REFERENCES_MIGRATION_ID)).resolves.toBe(true);
  });
});

describe('the reclamation gate refuses to delete bytes while a deviation stands (#4797)', () => {
  it('vetoes the released field file, deletes nothing, and leaves the tombstone in place', async () => {
    const ledger = ledgerEngine([verifiedRow({ deviation_observed_at: new Date().toISOString() })]);
    const engine = reapEngine();
    const s = storage();
    // Wired exactly as `storage-service-plugin.ts` wires it.
    const guard = createSysFileReapGuard(engine, () => s, silentLogger(), () =>
      mayActIrreversibly(ledger, FILE_REFERENCES_MIGRATION_ID),
    );

    const confirmed = await guard('sys_file', [{ ...RELEASED_FIELD_FILE }]);

    // THE PIN. Before this change the same row was confirmed and its bytes
    // deleted, because the gate read `verified_at` alone.
    expect(confirmed).toEqual([]);
    expect(s.delete).not.toHaveBeenCalled();
    // Withholding permission is not the same as denying the release: the
    // tombstone stands, so the file is collected once the gate re-opens.
    expect(engine.updates).toHaveLength(0);
  });

  it('reaps the same row once the deviation is cleared — the gate is withheld, not revoked', async () => {
    const ledger = ledgerEngine([verifiedRow({ deviation_observed_at: new Date().toISOString() })]);
    const engine = reapEngine();
    const s = storage();
    const guard = createSysFileReapGuard(engine, () => s, silentLogger(), () =>
      mayActIrreversibly(ledger, FILE_REFERENCES_MIGRATION_ID),
    );

    expect(await guard('sys_file', [{ ...RELEASED_FIELD_FILE }])).toEqual([]);

    // The operator fixes the data and re-runs the migration — the documented
    // way back, and it must actually restore full authority or the escape
    // hatch has become the one-way door the ruling rejected.
    await recordDataMigrationRun(ledger, {
      migrationId: FILE_REFERENCES_MIGRATION_ID,
      passed: true,
      blocking: 0,
      applied: true,
      details: { scanned_records: 12_000 },
    });

    expect(await guard('sys_file', [{ ...RELEASED_FIELD_FILE }])).toEqual(['f1']);
    expect(s.delete).toHaveBeenCalledWith('user/f1.png');
  });

  it('still reaps ATTACHMENT-scope tombstones — they never rode on this flag', async () => {
    const ledger = ledgerEngine([verifiedRow({ deviation_observed_at: new Date().toISOString() })]);
    const engine = reapEngine();
    const s = storage();
    const guard = createSysFileReapGuard(engine, () => s, silentLogger(), () =>
      mayActIrreversibly(ledger, FILE_REFERENCES_MIGRATION_ID),
    );

    const confirmed = await guard('sys_file', [
      { id: 'a1', key: 'attachments/a1.bin', status: 'deleted', scope: 'attachments' },
    ]);

    // The deviation is evidence about ADR-0104 field-file values. Letting it
    // reach a lifecycle that never gated on the flag would be the borrowed-
    // evidence error in the other direction.
    expect(confirmed).toEqual(['a1']);
    expect(s.delete).toHaveBeenCalledWith('attachments/a1.bin');
  });
});

describe('a migration re-run clears the marker (#4797)', () => {
  it('clears it on a passing apply run and restores irreversible authority', async () => {
    const ledger = ledgerEngine([verifiedRow({
      deviation_observed_at: new Date().toISOString(),
      deviation_detail: JSON.stringify({ observed: 'lax-admitted-violating-value' }),
    })]);

    await expect(mayActIrreversibly(ledger, FILE_REFERENCES_MIGRATION_ID)).resolves.toBe(false);

    await recordDataMigrationRun(ledger, {
      migrationId: FILE_REFERENCES_MIGRATION_ID,
      passed: true,
      blocking: 0,
      applied: true,
    });

    const row = ledger.tables.sys_migration[0];
    expect(row.deviation_observed_at).toBeNull();
    expect(row.deviation_detail).toBeNull();
    await expect(mayActIrreversibly(ledger, FILE_REFERENCES_MIGRATION_ID)).resolves.toBe(true);
  });

  it('clears it on a FAILING run too — that run replaces the verdict wholesale', async () => {
    const ledger = ledgerEngine([verifiedRow({
      deviation_observed_at: new Date().toISOString(),
    })]);

    await recordDataMigrationRun(ledger, {
      migrationId: FILE_REFERENCES_MIGRATION_ID,
      passed: false,
      blocking: 4,
      applied: true,
    });

    const row = ledger.tables.sys_migration[0];
    expect(row.deviation_observed_at).toBeNull();
    // The gate is closed by the failure itself, not by a stale marker.
    expect(row.verified_at).toBeNull();
    await expect(mayActIrreversibly(ledger, FILE_REFERENCES_MIGRATION_ID)).resolves.toBe(false);
    await expect(isDataMigrationVerified(ledger, FILE_REFERENCES_MIGRATION_ID)).resolves.toBe(false);
  });
});
