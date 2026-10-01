// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21120] The at-rest cleartext rewrite — pure planners, then the driven runner
 * against a fake engine. A `sys_metadata` datasource body copied into
 * `sys_audit_log.new_value` / `old_value` and `sys_activity.metadata` carried
 * credential material; these pins hold the rewrite that withholds it.
 */

import { describe, expect, it, vi } from 'vitest';
// [engine-double-contract] A fake engine's findOne and update must refuse exactly
// what ObjectQL refuses — each opened with the producer's own predicate, not a
// hand-mirrored check. `@objectstack/metadata-core` owns it (plugin-audit
// already depends on metadata-core; objectql does not depend on plugin-audit,
// so either source is legal and metadata-core is the shorter edge).
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import {
  migrateStoredMetadataBodyCopies,
  planAuditRowPatch,
  planActivityRowPatch,
  redactLedgerSnapshotBody,
  type StoredMetadataBodyMigrationEngine,
} from './stored-metadata-body-migration.js';

const CRED = 'at-rest-cred-51be';

/** The serialized metadata body as the audit copy holds it (a datasource body). */
const body = (cred = CRED) =>
  JSON.stringify({ name: 'ds', driver: 'turso', config: { url: 'libsql://db.turso.io', encryptionKey: cred } });

/** A create-snapshot ledger view: the whole sys_metadata row, type + metadata present. */
const createSnapshot = () => ({ id: 'm1', name: 'ds', type: 'datasource', scope: 'platform', metadata: body() });

describe('redactLedgerSnapshotBody', () => {
  it('withholds the credential from a snapshot carrying its own type', () => {
    const { changed, value } = redactLedgerSnapshotBody(createSnapshot());
    expect(changed).toBe(true);
    expect(JSON.stringify(value)).not.toContain(CRED);
    // Non-body columns survive.
    expect((value as Record<string, unknown>).type).toBe('datasource');
    expect((value as Record<string, unknown>).name).toBe('ds');
  });

  it('uses the typeHint when the snapshot subset carries no type (an update diff)', () => {
    const diffSubset = { metadata: body() };
    const withHint = redactLedgerSnapshotBody(diffSubset, 'datasource');
    expect(withHint.changed).toBe(true);
    expect(JSON.stringify(withHint.value)).not.toContain(CRED);
  });

  it('FAILS CLOSED: a body-bearing subset with no type and no hint drops the body', () => {
    const diffSubset = { metadata: body() };
    const { changed, value } = redactLedgerSnapshotBody(diffSubset);
    expect(changed).toBe(true);
    expect('metadata' in (value as object)).toBe(false);
  });

  it('leaves a snapshot that carries no body untouched', () => {
    const snap = { id: 'm1', type: 'datasource', name: 'ds' };
    expect(redactLedgerSnapshotBody(snap)).toEqual({ changed: false, value: snap });
  });
});

describe('planAuditRowPatch', () => {
  it('rewrites new_value (create) carrying a credential body', () => {
    const row = { id: 'a1', object_name: 'sys_metadata', record_id: 'm1', new_value: JSON.stringify(createSnapshot()), old_value: null };
    const patch = planAuditRowPatch(row);
    expect(patch).not.toBeNull();
    expect(patch!.new_value).toBeDefined();
    expect(String(patch!.new_value)).not.toContain(CRED);
  });

  it('returns null for an audit row whose values carry no body', () => {
    const row = { id: 'a2', new_value: JSON.stringify({ id: 'u1', name: 'Jane' }), old_value: null };
    expect(planAuditRowPatch(row)).toBeNull();
  });

  it('is idempotent — a redacted value is not rewritten again', () => {
    const row = { id: 'a1', new_value: JSON.stringify(createSnapshot()), old_value: null };
    const once = planAuditRowPatch(row)!;
    const redacted = { id: 'a1', new_value: once.new_value, old_value: null };
    expect(planAuditRowPatch(redacted)).toBeNull();
  });
});

describe('planActivityRowPatch', () => {
  it('rewrites the {old,new} pair in sys_activity.metadata', () => {
    const row = {
      id: 'ac1',
      object_name: 'sys_metadata',
      record_id: 'm1',
      metadata: JSON.stringify({ old: null, new: createSnapshot() }),
    };
    const patch = planActivityRowPatch(row);
    expect(patch).not.toBeNull();
    expect(patch!.metadata).not.toContain(CRED);
  });

  it('returns null when the activity metadata carries no body', () => {
    const row = { id: 'ac2', metadata: JSON.stringify({ old: null, new: { id: 'u1', name: 'Jane' } }) };
    expect(planActivityRowPatch(row)).toBeNull();
  });
});

describe('migrateStoredMetadataBodyCopies (driven)', () => {
  function fakeEngine(rows: Record<string, Record<string, unknown>[]>): {
    engine: StoredMetadataBodyMigrationEngine;
    updates: Array<{ object: string; id: string; data: Record<string, unknown> }>;
  } {
    const updates: Array<{ object: string; id: string; data: Record<string, unknown> }> = [];
    // The REAL contract's shapes (`Pick<IDataEngine, …>`): `update(object, data,
    // options)` names the row by `data.id`, never a positional id.
    const engine: StoredMetadataBodyMigrationEngine = {
      async find(object) {
        return rows[object] ?? [];
      },
      async findOne(object, query) {
        // Refuse exactly what the real engine refuses (a non-selective findOne).
        assertEngineFindOnePredicate(object, query);
        if (object !== 'sys_metadata') return null;
        const id = (query as { where?: { id?: unknown } } | undefined)?.where?.id;
        return (rows.sys_metadata ?? []).find((r) => r.id === id) ?? null;
      },
      async update(object, data, options) {
        // Refuse exactly what the real engine's update dispatch refuses.
        // Every option key reaches the predicate — spread into a literal only so
        // the contract's options interface meets the predicate's indexed input.
        assertEngineUpdateDispatch(data, options === undefined ? undefined : { ...options });
        const { id, ...rest } = data as Record<string, unknown>;
        updates.push({ object, id: String(id), data: rest });
        return { id, ...rest };
      },
    };
    return { engine, updates };
  }

  const logger = { info: vi.fn(), warn: vi.fn() };

  it('dry run reports what it would rewrite and writes nothing', async () => {
    const { engine, updates } = fakeEngine({
      sys_audit_log: [{ id: 'a1', object_name: 'sys_metadata', record_id: 'm1', new_value: JSON.stringify(createSnapshot()), old_value: null }],
      sys_activity: [{ id: 'ac1', object_name: 'sys_metadata', record_id: 'm1', metadata: JSON.stringify({ old: null, new: createSnapshot() }) }],
    });
    const report = await migrateStoredMetadataBodyCopies(engine, logger, { apply: false });
    expect(report.rewritten).toBe(2);
    expect(updates).toHaveLength(0);
  });

  it('apply rewrites each affected row and the written data carries no credential', async () => {
    const { engine, updates } = fakeEngine({
      sys_audit_log: [{ id: 'a1', object_name: 'sys_metadata', record_id: 'm1', new_value: JSON.stringify(createSnapshot()), old_value: null }],
      sys_activity: [{ id: 'ac1', object_name: 'sys_metadata', record_id: 'm1', metadata: JSON.stringify({ old: null, new: createSnapshot() }) }],
    });
    const report = await migrateStoredMetadataBodyCopies(engine, logger, { apply: true });
    expect(report.rewritten).toBe(2);
    expect(report.failures).toBe(0);
    expect(updates).toHaveLength(2);
    // Each write names its row through `data.id` — the single-id form the engine reads.
    expect(updates.map((u) => `${u.object}/${u.id}`).sort()).toEqual(['sys_activity/ac1', 'sys_audit_log/a1']);
    for (const u of updates) expect(JSON.stringify(u.data)).not.toContain(CRED);
  });

  it('is idempotent — a second apply over the rewritten rows rewrites nothing', async () => {
    const auditRow = { id: 'a1', object_name: 'sys_metadata', record_id: 'm1', new_value: JSON.stringify(createSnapshot()), old_value: null };
    const { engine } = fakeEngine({ sys_audit_log: [auditRow], sys_activity: [] });
    const first = await migrateStoredMetadataBodyCopies(engine, logger, { apply: false });
    const patch = planAuditRowPatch(auditRow)!;
    auditRow.new_value = patch.new_value as string;
    const second = await migrateStoredMetadataBodyCopies(engine, logger, { apply: false });
    expect(first.rewritten).toBe(1);
    expect(second.rewritten).toBe(0);
  });
});
