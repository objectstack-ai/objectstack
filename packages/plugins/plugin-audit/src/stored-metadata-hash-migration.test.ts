// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21207] Exit two, fork three, at rest: the copies already written carry no
 * stored content hash after `os migrate audit-metadata-bodies` runs.
 *
 * Before this card the audit writer copied a `sys_metadata` /
 * `sys_metadata_history` row's `checksum` (and the history row's
 * `previous_checksum`) into the ledger snapshot / diff and the activity copy,
 * and the protocol wrote both hashes of a refused optimistic-lock write into
 * the decision-audit note (`sys_metadata_audit.note`) — which the writer then
 * copied into the ledger again. The writers no longer do; the same operator-run
 * migration that withholds the copied body now also drops the two columns from
 * those copies and withholds the hashes in those notes. Dry run by default,
 * idempotent, and the history table stays the lineage.
 */

import { describe, expect, it, vi } from 'vitest';
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import {
  migrateStoredMetadataBodyCopies,
  planActivityRowPatch,
  planAuditRowPatch,
  planDecisionNotePatch,
  type StoredMetadataBodyMigrationEngine,
} from './stored-metadata-body-migration.js';

const HASH = `sha256:${'a'.repeat(64)}`;
const PARENT = `sha256:${'b'.repeat(64)}`;
const SHA256 = /sha256:[0-9a-f]{64}/;
const HASH_KEY = /"(previous_)?checksum"/;

const view = (label: string) => JSON.stringify({ name: 'v', type: 'grid', label });
const metaSnapshot = () => ({ id: 'm1', name: 'v', type: 'view', scope: 'platform', metadata: view('one'), checksum: HASH });
const historySnapshot = () => ({ id: 'h1', name: 'v', type: 'view', metadata: view('one'), checksum: HASH, previous_checksum: PARENT });
const conflictNote = `expected parent ${PARENT} but current is ${HASH}`;
const WITHHELD_NOTE = 'expected parent (withheld) but current is (withheld)';
/** The decision-audit `code` column's own vocabulary (ADR-0112 D6b), not an error code. */
const CONFLICT_CODE = 'metadata_conflict'; // adr0112-ok: D6b persisted audit column

describe('planAuditRowPatch / planActivityRowPatch — the hash columns leave the copy', () => {
  it('a sys_metadata create snapshot loses its checksum, and nothing else', () => {
    const row = { id: 'a1', object_name: 'sys_metadata', record_id: 'm1', new_value: JSON.stringify(metaSnapshot()), old_value: null };
    const patch = planAuditRowPatch(row);
    expect(patch).not.toBeNull();
    const rewritten = JSON.parse(String(patch!.new_value));
    expect(rewritten).toEqual({ id: 'm1', name: 'v', type: 'view', scope: 'platform', metadata: view('one') });
  });

  it('a sys_metadata_history snapshot loses both hash columns', () => {
    const row = { id: 'a2', object_name: 'sys_metadata_history', record_id: 'h1', new_value: JSON.stringify(historySnapshot()), old_value: null };
    const patch = planAuditRowPatch(row);
    expect(String(patch!.new_value)).not.toMatch(SHA256);
    expect(String(patch!.new_value)).not.toMatch(HASH_KEY);
  });

  it('an update diff loses the hash on both sides', () => {
    const row = {
      id: 'a3',
      object_name: 'sys_metadata',
      record_id: 'm1',
      old_value: JSON.stringify({ metadata: view('one'), checksum: PARENT }),
      new_value: JSON.stringify({ metadata: view('two'), checksum: HASH }),
    };
    const patch = planAuditRowPatch(row, 'view');
    expect(JSON.stringify(patch)).not.toMatch(SHA256);
    expect(JSON.parse(String(patch!.new_value)).metadata).toBe(view('two'));
  });

  it('the activity pair loses the hash on both halves', () => {
    const row = { id: 'ac1', object_name: 'sys_metadata_history', record_id: 'h1', metadata: JSON.stringify({ old: null, new: historySnapshot() }) };
    const patch = planActivityRowPatch(row);
    expect(patch!.metadata).not.toMatch(SHA256);
    expect(JSON.parse(patch!.metadata).new.name).toBe('v');
  });

  it('is idempotent, and leaves another object\'s checksum column alone', () => {
    const row = { id: 'a1', object_name: 'sys_metadata', record_id: 'm1', new_value: JSON.stringify(metaSnapshot()), old_value: null };
    const once = planAuditRowPatch(row)!;
    expect(planAuditRowPatch({ ...row, new_value: once.new_value })).toBeNull();
    const foreign = { id: 'a9', object_name: 'file_blob', record_id: 'f1', new_value: JSON.stringify({ id: 'f1', checksum: HASH }), old_value: null };
    expect(planAuditRowPatch(foreign)).toBeNull();
  });
});

describe('planDecisionNotePatch — the decision-audit note and its copies', () => {
  it('withholds both hashes of a conflict note', () => {
    const patch = planDecisionNotePatch('sys_metadata_audit', { id: 'd1', code: CONFLICT_CODE, note: conflictNote });
    expect(patch).toEqual({ note: WITHHELD_NOTE });
  });

  it('keeps a null side as null', () => {
    const patch = planDecisionNotePatch('sys_metadata_audit', { id: 'd2', code: CONFLICT_CODE, note: `expected parent null but current is ${HASH}` });
    expect(patch).toEqual({ note: 'expected parent null but current is (withheld)' });
  });

  it('leaves every other note alone, and is idempotent', () => {
    expect(planDecisionNotePatch('sys_metadata_audit', { id: 'd3', code: 'ok', note: 'restored from version 2' })).toBeNull();
    expect(planDecisionNotePatch('sys_metadata_audit', { id: 'd4', code: CONFLICT_CODE, note: WITHHELD_NOTE })).toBeNull();
  });

  it('rewrites the ledger and activity copies of a conflict note', () => {
    const snapshot = { id: 'd1', type: 'view', name: 'v', operation: 'save', outcome: 'denied', code: CONFLICT_CODE, note: conflictNote };
    const audit = planDecisionNotePatch('sys_audit_log', {
      id: 'a5', object_name: 'sys_metadata_audit', record_id: 'd1', new_value: JSON.stringify(snapshot), old_value: null,
    });
    expect(String(audit!.new_value)).not.toMatch(SHA256);
    expect(JSON.parse(String(audit!.new_value)).note).toBe(WITHHELD_NOTE);
    const activity = planDecisionNotePatch('sys_activity', {
      id: 'ac5', object_name: 'sys_metadata_audit', record_id: 'd1', metadata: JSON.stringify({ old: null, new: snapshot }),
    });
    expect(String(activity!.metadata)).not.toMatch(SHA256);
  });
});

describe('migrateStoredMetadataBodyCopies — the content-hash copies (driven)', () => {
  function fakeEngine(rows: Record<string, Record<string, unknown>[]>) {
    const updates: Array<{ object: string; id: string; data: Record<string, unknown> }> = [];
    const engine: StoredMetadataBodyMigrationEngine = {
      async find(object) {
        return rows[object] ?? [];
      },
      async findOne(object, query) {
        assertEngineFindOnePredicate(object, query);
        const id = (query as { where?: { id?: unknown } } | undefined)?.where?.id;
        return (rows[object] ?? []).find((r) => r.id === id) ?? null;
      },
      async update(object, data, options) {
        assertEngineUpdateDispatch(data, options === undefined ? undefined : { ...options });
        const { id, ...rest } = data as Record<string, unknown>;
        updates.push({ object, id: String(id), data: rest });
        const target = (rows[object] ?? []).find((r) => r.id === id);
        if (target) Object.assign(target, rest);
        return { id, ...rest };
      },
    };
    return { engine, updates };
  }
  const logger = { info: vi.fn(), warn: vi.fn() };
  const fixture = () => ({
    sys_metadata: [{ id: 'm1', type: 'view', name: 'v' }],
    sys_audit_log: [
      { id: 'a1', object_name: 'sys_metadata', record_id: 'm1', new_value: JSON.stringify(metaSnapshot()), old_value: null },
      { id: 'a2', object_name: 'sys_metadata_audit', record_id: 'd1', new_value: JSON.stringify({ id: 'd1', code: CONFLICT_CODE, note: conflictNote }), old_value: null },
      { id: 'a3', object_name: 'file_blob', record_id: 'f1', new_value: JSON.stringify({ id: 'f1', checksum: HASH }), old_value: null },
    ],
    sys_activity: [{ id: 'ac1', object_name: 'sys_metadata_history', record_id: 'h1', metadata: JSON.stringify({ old: null, new: historySnapshot() }) }],
    sys_metadata_audit: [
      { id: 'd1', code: CONFLICT_CODE, note: conflictNote },
      { id: 'd2', code: 'ok', note: 'active' },
    ],
  });

  it('dry run counts every copy carrying a hash, per table, and writes nothing', async () => {
    const { engine, updates } = fakeEngine(fixture());
    const report = await migrateStoredMetadataBodyCopies(engine, logger, { apply: false });
    expect(updates).toHaveLength(0);
    expect(report.byObject.sys_audit_log!.rewritten).toBe(2);
    expect(report.byObject.sys_activity!.rewritten).toBe(1);
    expect(report.byObject.sys_metadata_audit!.rewritten).toBe(1);
    expect(report.rewritten).toBe(4);
  });

  it('--apply rewrites them, the written values carry no hash, and a second run finds nothing', async () => {
    const rows = fixture();
    const { engine, updates } = fakeEngine(rows);
    const first = await migrateStoredMetadataBodyCopies(engine, logger, { apply: true });
    expect(first.failures).toBe(0);
    expect(updates.map((u) => `${u.object}/${u.id}`).sort()).toEqual([
      'sys_activity/ac1', 'sys_audit_log/a1', 'sys_audit_log/a2', 'sys_metadata_audit/d1',
    ]);
    for (const u of updates) expect(JSON.stringify(u.data)).not.toMatch(SHA256);
    // Another object's checksum column was not touched.
    expect(String(rows.sys_audit_log[2]!.new_value)).toContain(HASH);

    const second = await migrateStoredMetadataBodyCopies(engine, logger, { apply: false });
    expect(second.rewritten).toBe(0);
  });
});

describe('the history change note that quotes a stored hash (#21207)', () => {
  it('a copied history snapshot keeps its note and withholds the quote, idempotently', () => {
    const snapshot = { ...historySnapshot(), change_note: `publish draft (hash ${HASH})` };
    const row = { id: 'a7', object_name: 'sys_metadata_history', record_id: 'h1', new_value: JSON.stringify(snapshot), old_value: null };
    const patch = planAuditRowPatch(row)!;
    const rewritten = JSON.parse(String(patch.new_value));
    expect(rewritten.change_note).toBe('publish draft (hash (withheld))');
    expect(String(patch.new_value)).not.toMatch(SHA256);
    expect(planAuditRowPatch({ ...row, new_value: patch.new_value })).toBeNull();
  });
});
