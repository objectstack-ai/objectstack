// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#30955] Every data export the REST door streams leaves ONE run-level row in
// the compliance ledger — on a real boot, both halves composed: the door in
// `@objectstack/rest`'s `data-action-routes.ts` hands an export EVENT to the
// `audit` slot, and plugin-audit's `data-export-audit.ts` turns it into the
// row. Each half is pinned on its own (`export-integration.test.ts`,
// `data-export-audit.test.ts`); this file is the one place they meet with the
// real security gate, the real driver and the real ledger.
//
// ## The composition
//
// `bootStack` with the real `SecurityPlugin` and `AuditPlugin`. One synthetic
// object; one row of it carries a distinctive cell value. Two users: an
// EXPORTER whose set grants read + export on the object, and a READER whose
// set grants read only, so the export permission gate refuses it. The
// exporter's set also grants read + export on the ledger, for its own export.
//
// ## What is asserted
//
// - An ordinary export writes one row: `action: 'export'`, the object, no
//   record id, the exporter, the format and the row count.
// - An export of `sys_audit_log` itself writes one row about the ledger.
// - A truncated export (`limit` below the matching rows) records the truncation.
// - The row never carries an exported cell value: the value is IN the file
//   (filtered on, and searched for), and in no export row.
// - A refused export (`EXPORT_NOT_PERMITTED`) writes no row.
//
// The row is written after the file is finished, so a case reads the ledger
// until the row lands (bounded) instead of right after the response.
//
// Fixtures are synthetic. ⚠️ No test title states a value.
// `@objectstack/rest` and `@objectstack/plugin-audit` resolve through their
// BUILT output here, so a verdict on a change to either is a verdict on its
// last build.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { catalogPermissionSet } from './catalog-permission-set.js';

const OBJ = 'dex_note';
const LEDGER = 'sys_audit_log';
const SYS = { context: { isSystem: true } } as const;

/** A cell value no field name, operator or code in this file spells. */
const SECRET = 'Dx9-export-cell-value-7316';

const Note = ObjectSchema.create({
  name: OBJ,
  label: 'DEX Note',
  pluralLabel: 'DEX Notes',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true, searchable: true }),
    body: Field.text({ label: 'Body' }),
  },
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.data-export-audit-row',
    namespace: 'dex',
    version: '0.0.0',
    type: 'app',
    name: 'Data Export Audit Row Fixture',
    description: 'One object exported through the REST door, recorded on the compliance ledger.',
  },
  objects: [Note],
});

/** Read only: the export permission gate refuses this user. */
const readerSet = PermissionSetSchema.parse({
  name: 'dex_reader',
  label: 'DEX reader',
  objects: { [OBJ]: { allowRead: true } },
});
/** Read and export on the fixture object, and on the ledger. */
const exporterSet = PermissionSetSchema.parse({
  name: 'dex_exporter',
  label: 'DEX exporter',
  objects: {
    [OBJ]: { allowRead: true, allowExport: true },
    [LEDGER]: { allowRead: true, allowExport: true },
  },
});

type Row = Record<string, any>;
const metadataOf = (row: Row): Record<string, any> => JSON.parse(String(row.metadata));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('[#30955] every export the REST door streams leaves one run-level ledger row', () => {
  let stack: VerifyStack;
  let ql: any;
  const token: Record<'exporter' | 'reader', string> = { exporter: '', reader: '' };
  let exporterId = '';

  const exportRows = async (): Promise<Row[]> =>
    ql.find(LEDGER, { where: { action: 'export' }, ...SYS });

  /**
   * Run one export and return the export rows it left. The row lands after the
   * file is finished, so the ledger is read until `expect` rows are new (or
   * the bound passes), then once more after a settle, so a second row would
   * be counted too.
   */
  const exportAndRead = async (who: keyof typeof token, path: string, expectNew: number) => {
    const before = new Set((await exportRows()).map((r) => String(r.id)));
    const res = await stack.apiAs(token[who], 'GET', path);
    const text = await res.text();
    const fresh = async () => (await exportRows()).filter((r) => !before.has(String(r.id)));
    for (let i = 0; i < 100 && (await fresh()).length < expectNew; i++) await sleep(20);
    await sleep(150);
    return { status: res.status, text, rows: await fresh() };
  };

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, readerSet, exporterSet],
        fallbackPermissionSet: readerSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    token.reader = await stack.signUp('dex-reader@verify.test');
    token.exporter = await stack.signUp('dex-exporter@verify.test');
    exporterId = String((await ql.findOne('sys_user', { where: { email: 'dex-exporter@verify.test' }, ...SYS }))?.id ?? '');
    expect(exporterId).not.toBe('');
    expect(await catalogPermissionSet(ql, exporterSet.name), 'fixture set served by the security catalog').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: exporterId, permission_set: exporterSet.name }, SYS);

    await ql.insert(OBJ, { name: 'Note one', body: 'plain' }, SYS);
    await ql.insert(OBJ, { name: 'Note two', body: 'plain' }, SYS);
    await ql.insert(OBJ, { name: SECRET, body: 'carries the value' }, SYS);
  }, 180_000);

  afterAll(async () => {
    if (stack) await stack.stop();
  });

  it('an export of an ordinary object writes ONE row naming the object, the exporter, the format and the row count', async () => {
    const { status, text, rows } = await exportAndRead('exporter', `/data/${OBJ}/export?format=json`, 1);
    expect(status, text).toBe(200);
    expect(JSON.parse(text)).toHaveLength(3);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'export', object_name: OBJ, user_id: exporterId });
    expect(rows[0].record_id ?? null).toBeNull();
    expect(metadataOf(rows[0])).toMatchObject({ format: 'json', row_count: 3, truncated: false, outcome: 'succeeded' });
  });

  it('a csv export writes ONE row with its own format', async () => {
    const { status, rows } = await exportAndRead('exporter', `/data/${OBJ}/export?format=csv`, 1);
    expect(status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(metadataOf(rows[0])).toMatchObject({ format: 'csv', row_count: 3 });
  });

  it('an export of the ledger itself writes ONE row about the ledger', async () => {
    const { status, text, rows } = await exportAndRead('exporter', `/data/${LEDGER}/export?format=json`, 1);
    expect(status, text).toBe(200);
    // The file is the ledger, and it already holds the earlier cases' export
    // rows (the json export renders the action by its option label).
    const actions = (JSON.parse(text) as Row[]).map((r) => String(r.action).toLowerCase());
    expect(actions.filter((a) => a === 'export').length).toBeGreaterThanOrEqual(2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'export', object_name: LEDGER });
    expect(rows[0].record_id ?? null).toBeNull();
    expect(metadataOf(rows[0])).toMatchObject({ format: 'json', outcome: 'succeeded' });
  });

  it('a truncated export records the truncation', async () => {
    const { status, text, rows } = await exportAndRead('exporter', `/data/${OBJ}/export?format=json&limit=1`, 1);
    expect(status).toBe(200);
    expect(JSON.parse(text)).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(metadataOf(rows[0])).toMatchObject({ row_count: 1, limit: 1, truncated: true });
  });

  it('the row never carries an exported cell value: filtered on, the value is in the file and in no row', async () => {
    const filter = encodeURIComponent(JSON.stringify({ name: SECRET }));
    const { status, text, rows } = await exportAndRead('exporter', `/data/${OBJ}/export?format=json&filter=${filter}`, 1);
    expect(status, text).toBe(200);
    expect(text, 'armed: the value was exported').toContain(SECRET);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(SECRET);
    expect(metadataOf(rows[0])).toMatchObject({ row_count: 1, filter: [{ field: 'name', op: '$eq' }], search: false });
  });

  it('the row never carries the search term: searched for, the value is in the file and the row says only that a search ran', async () => {
    const { status, text, rows } = await exportAndRead('exporter', `/data/${OBJ}/export?format=json&search=${encodeURIComponent(SECRET)}`, 1);
    expect(status, text).toBe(200);
    expect(text, 'armed: the value was exported').toContain(SECRET);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(SECRET);
    expect(metadataOf(rows[0])).toMatchObject({ row_count: 1, search: true });
  });

  it('a refused export (no export permission) writes no row', async () => {
    const { status, text, rows } = await exportAndRead('reader', `/data/${OBJ}/export?format=json`, 0);
    expect(status, text).toBe(403);
    expect(text).toContain('EXPORT_NOT_PERMITTED');
    expect(rows).toEqual([]);
    // Control: the same door, the same object, an exporter — one row.
    const control = await exportAndRead('exporter', `/data/${OBJ}/export?format=json`, 1);
    expect(control.rows).toHaveLength(1);
  });

  it('no export row anywhere in the ledger carries the cell value', async () => {
    expect(JSON.stringify(await exportRows())).not.toContain(SECRET);
  });
});
