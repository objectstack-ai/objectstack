// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24693] The at-rest rewrite of the mail-log bodies the audit writer copied
 * in clear before #24625 — pure planners, then the paged runner against a fake
 * engine. The rows are 18.0-shaped: the copies the 18.0 writer stored for a
 * `sys_email` create and a status update, and for a `sys_identity_email`
 * delete, on all four snapshot sides (`new_value`, `old_value`, and the two
 * halves of `sys_activity.metadata`).
 *
 * ⛔ The bodies here are sentinels, never a link, a token or a real mail body,
 * and no title or message names one.
 */

import { describe, expect, it, vi } from 'vitest';
// [engine-double-contract] A fake engine's update must refuse exactly what
// ObjectQL refuses — opened with the producer's own predicate, the shape
// `stored-metadata-body-migration.test.ts` takes.
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SECRET_MASK } from '@objectstack/objectql/core';
import { maskMailLogBodyCopy } from './mail-log-body-mask.js';
import {
  migrateMailLogBodyCopies,
  planMailLogBodyActivityRowPatch,
  planMailLogBodyAuditRowPatch,
  type MailLogBodyMigrationEngine,
} from './mail-log-body-migration.js';

type Row = Record<string, unknown>;

const TEXT = 'mail-body-sentinel-text';
const HTML = 'mail-body-sentinel-html';

/** A mail-log row as the 18.0 writer copied it whole (a create snapshot). */
const mailRow = (id: string, body: { text?: string | null; html?: string | null } = {}): Row => ({
  id,
  organization_id: 'org_1',
  to: '["someone@example.invalid"]',
  subject: 'Subject kept',
  status: 'sent',
  related_object: 'sys_user',
  related_id: 'usr_1',
  body_text: body.text === undefined ? TEXT : body.text,
  body_html: body.html === undefined ? HTML : body.html,
});

/** The 18.0 sys_audit_log rows: a create (new_value) and a delete (old_value) carry the body; a status update does not. */
const auditRows = (): Row[] => [
  { id: 'al_1', object_name: 'sys_email', action: 'create', record_id: 'em_1', old_value: null, new_value: JSON.stringify(mailRow('em_1')) },
  { id: 'al_2', object_name: 'sys_email', action: 'update', record_id: 'em_1', old_value: JSON.stringify({ status: 'queued' }), new_value: JSON.stringify({ status: 'sent' }) },
  { id: 'al_3', object_name: 'sys_identity_email', action: 'delete', record_id: 'ie_1', old_value: JSON.stringify(mailRow('ie_1')), new_value: null },
  // An update diff whose two halves both name a body column (a resend that re-rendered it).
  { id: 'al_4', object_name: 'sys_email', action: 'update', record_id: 'em_2', old_value: JSON.stringify({ body_text: TEXT }), new_value: JSON.stringify({ body_text: HTML }) },
  // Not a mail log: never touched, whatever its columns are called.
  { id: 'al_5', object_name: 'crm_note', action: 'create', record_id: 'n_1', old_value: null, new_value: JSON.stringify({ id: 'n_1', body_text: TEXT }) },
];

const TEXT_SOURCES = { summary: ['subject'], record_label: ['subject'] };

/** The 18.0 sys_activity rows: `metadata` is `{ old, new, …declaration }`. */
const activityRows = (): Row[] => [
  { id: 'ac_1', object_name: 'sys_email', record_id: 'em_1', summary: 'Created Email "Subject kept"', metadata: JSON.stringify({ old: null, new: mailRow('em_1'), _textSources: TEXT_SOURCES }) },
  { id: 'ac_2', object_name: 'sys_identity_email', record_id: 'ie_1', summary: 'Deleted', metadata: JSON.stringify({ old: mailRow('ie_1', { html: null }), new: null, _textSources: TEXT_SOURCES }) },
  { id: 'ac_3', object_name: 'sys_email', record_id: 'em_1', summary: 'Status: queued → sent', metadata: JSON.stringify({ old: { status: 'queued' }, new: { status: 'sent' }, _textSources: TEXT_SOURCES }) },
  { id: 'ac_4', object_name: 'crm_note', record_id: 'n_1', summary: 'Created', metadata: JSON.stringify({ old: null, new: { body_text: TEXT } }) },
];

/** Every stored string of `rows` that still holds a sentinel body in clear. */
const clearBodies = (rows: Row[]): number =>
  rows.filter((r) => r.object_name !== 'crm_note' && JSON.stringify(r).match(/mail-body-sentinel/)).length;

describe('maskMailLogBodyCopy — the writer\'s mask, the rewrite\'s mask', () => {
  it('masks a set body, keeps an unset one null, and invents no column', () => {
    const copy: Row = { subject: 's', body_text: TEXT, body_html: null };
    expect(maskMailLogBodyCopy('sys_email', copy)).toBe(true);
    expect(copy).toEqual({ subject: 's', body_text: SECRET_MASK, body_html: null });
  });

  it('is a no-op on a copy already masked, and on any other object', () => {
    const masked: Row = { body_text: SECRET_MASK, body_html: null };
    expect(maskMailLogBodyCopy('sys_identity_email', masked)).toBe(false);
    const other: Row = { body_text: TEXT };
    expect(maskMailLogBodyCopy('crm_note', other)).toBe(false);
    expect(other.body_text).toBe(TEXT);
  });
});

describe('planMailLogBodyAuditRowPatch', () => {
  it('masks a create\'s new_value and keeps every other key byte-identical', () => {
    const [create] = auditRows();
    const patch = planMailLogBodyAuditRowPatch(create!);
    expect(Object.keys(patch!)).toEqual(['new_value']);
    expect(patch!.new_value).toBe(JSON.stringify({ ...mailRow('em_1'), body_text: SECRET_MASK, body_html: SECRET_MASK }));
  });

  it('masks a delete\'s old_value, and both halves of an update diff that names a body', () => {
    const rows = auditRows();
    expect(Object.keys(planMailLogBodyAuditRowPatch(rows[2]!)!)).toEqual(['old_value']);
    const both = planMailLogBodyAuditRowPatch(rows[3]!)!;
    expect(JSON.parse(String(both.old_value))).toEqual({ body_text: SECRET_MASK });
    expect(JSON.parse(String(both.new_value))).toEqual({ body_text: SECRET_MASK });
  });

  it('leaves a body-free update diff and another object\'s row alone', () => {
    const rows = auditRows();
    expect(planMailLogBodyAuditRowPatch(rows[1]!)).toBeNull();
    expect(planMailLogBodyAuditRowPatch(rows[4]!)).toBeNull();
  });

  it('is idempotent: the rewritten row plans nothing', () => {
    const [create] = auditRows();
    const once = { ...create!, ...planMailLogBodyAuditRowPatch(create!) };
    expect(planMailLogBodyAuditRowPatch(once)).toBeNull();
  });
});

describe('planMailLogBodyActivityRowPatch', () => {
  it('masks each half of the pair and keeps the pair\'s other keys', () => {
    const [created, deleted] = activityRows();
    const a = JSON.parse(String(planMailLogBodyActivityRowPatch(created!)!.metadata));
    expect(a).toEqual({ old: null, new: { ...mailRow('em_1'), body_text: SECRET_MASK, body_html: SECRET_MASK }, _textSources: TEXT_SOURCES });
    const d = JSON.parse(String(planMailLogBodyActivityRowPatch(deleted!)!.metadata));
    expect(d.old).toEqual({ ...mailRow('ie_1', { html: null }), body_text: SECRET_MASK });
  });

  it('leaves a body-free pair, another object\'s row and a rewritten row alone', () => {
    const rows = activityRows();
    expect(planMailLogBodyActivityRowPatch(rows[2]!)).toBeNull();
    expect(planMailLogBodyActivityRowPatch(rows[3]!)).toBeNull();
    const once = { ...rows[0]!, ...planMailLogBodyActivityRowPatch(rows[0]!) };
    expect(planMailLogBodyActivityRowPatch(once)).toBeNull();
  });
});

describe('migrateMailLogBodyCopies (driven, paged)', () => {
  /** A fake engine over two in-memory tables, answering the runner's keyset page query. */
  function fakeEngine(tables: Record<string, Row[]>, opts: { failRead?: string } = {}) {
    const reads: Array<{ object: string; limit: unknown }> = [];
    const engine: MailLogBodyMigrationEngine = {
      async find(object, query) {
        if (object === opts.failRead) throw new Error('read refused');
        const q = query as { where?: any; limit?: number };
        reads.push({ object, limit: q.limit });
        const where = q.where ?? {};
        const scope = where.$and ? where.$and[0] : where;
        const after = where.$and ? where.$and[1].id.$gt : undefined;
        const names: string[] = scope.object_name.$in;
        return (tables[object] ?? [])
          .filter((r) => names.includes(String(r.object_name)) && (after === undefined || String(r.id) > after))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
          .slice(0, q.limit)
          .map((r) => ({ ...r }));
      },
      async update(object, data, options) {
        // Refuse exactly what the real engine's update dispatch refuses.
        assertEngineUpdateDispatch(data, options === undefined ? undefined : { ...options });
        const { id, ...rest } = data as Row;
        const row = (tables[object] ?? []).find((r) => r.id === id);
        if (row) Object.assign(row, rest);
        return { id, ...rest };
      },
    };
    return { engine, reads };
  }
  const logger = () => ({ info: vi.fn(), warn: vi.fn() });

  it('a dry run counts the clear copies and writes nothing', async () => {
    const tables = { sys_audit_log: auditRows(), sys_activity: activityRows() };
    const before = JSON.stringify(tables);
    const { engine } = fakeEngine(tables);
    const report = await migrateMailLogBodyCopies(engine, logger());
    expect(report).toEqual({
      apply: false,
      byObject: { sys_audit_log: { scanned: 4, rewritten: 3 }, sys_activity: { scanned: 3, rewritten: 2 } },
      scanned: 7,
      rewritten: 5,
      failures: 0,
    });
    expect(JSON.stringify(tables)).toBe(before);
  });

  it('--apply leaves 0 clear copies, touches no other column or row, and a re-run is a no-op', async () => {
    const tables = { sys_audit_log: auditRows(), sys_activity: activityRows() };
    expect(clearBodies([...tables.sys_audit_log, ...tables.sys_activity])).toBe(5);
    const { engine } = fakeEngine(tables);
    const report = await migrateMailLogBodyCopies(engine, logger(), { apply: true, pageSize: 2 });
    expect(report.rewritten).toBe(5);
    expect(report.failures).toBe(0);
    expect(clearBodies([...tables.sys_audit_log, ...tables.sys_activity])).toBe(0);

    // Non-body fields: each row's every other column is byte-identical, and the
    // rows of another object are untouched entirely.
    const originals = new Map([...auditRows(), ...activityRows()].map((r) => [r.id, r]));
    for (const row of [...tables.sys_audit_log, ...tables.sys_activity]) {
      const original = originals.get(row.id)!;
      for (const key of Object.keys(original)) {
        if (['new_value', 'old_value', 'metadata'].includes(key)) continue;
        expect(row[key], `${String(row.id)}.${key}`).toBe(original[key]);
      }
    }
    expect(tables.sys_audit_log[4]).toEqual(auditRows()[4]);
    expect(tables.sys_activity[3]).toEqual(activityRows()[3]);

    const after = JSON.stringify(tables);
    const again = await migrateMailLogBodyCopies(engine, logger(), { apply: true, pageSize: 2 });
    expect(again.rewritten).toBe(0);
    expect(again.scanned).toBe(7);
    expect(JSON.stringify(tables)).toBe(after);
  });

  it('pages: every page is bounded and every mail-log copy is read exactly once', async () => {
    const tables = { sys_audit_log: auditRows(), sys_activity: activityRows() };
    const { engine, reads } = fakeEngine(tables);
    const report = await migrateMailLogBodyCopies(engine, logger(), { pageSize: 2 });
    expect(reads.every((r) => r.limit === 2)).toBe(true);
    expect(report.byObject.sys_audit_log!.scanned).toBe(4);
    expect(report.byObject.sys_activity!.scanned).toBe(3);
  });

  it('a table it cannot read is a failure, never a clean report', async () => {
    const tables = { sys_audit_log: auditRows(), sys_activity: activityRows() };
    const { engine } = fakeEngine(tables, { failRead: 'sys_activity' });
    const log = logger();
    const report = await migrateMailLogBodyCopies(engine, log, { apply: true });
    expect(report.failures).toBe(1);
    expect(report.byObject.sys_audit_log!.rewritten).toBe(3);
    // Counts only: no log line names a body.
    const lines = [...log.info.mock.calls, ...log.warn.mock.calls].flat().join('\n');
    expect(lines).not.toMatch(/mail-body-sentinel/);
  });
});
