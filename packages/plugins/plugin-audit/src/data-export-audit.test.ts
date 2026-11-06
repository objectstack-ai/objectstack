// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30955] The `export` writer stores a REAL, READ-BACK ledger row for each
 * data export — and never an exported value.
 *
 * The slot cases boot the real composition this package ships in
 * (`ObjectQLPlugin` + `AuditPlugin` on a sqlite driver) and reach the writer
 * the way the REST export door does: through the `audit` service slot's
 * `recordDataExport`. Every assertion reads the row back through the engine,
 * for the reason `auth-event-audit.test.ts` records: every `sys_audit_log`
 * field is `readonly` and `validateRecord` skips readonly fields, so "the call
 * did not throw" is equally true when the row landed right, landed wrong, or
 * was never attempted. The door side — that the export door hands this writer
 * one event per export, and none for a refused request — is pinned in
 * `@objectstack/rest`'s `export-integration.test.ts`; the two halves together
 * on the showcase in the dogfood suite's `data-export-audit-row.dogfood.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';
import {
  DATA_EXPORT_AUDIT_ACTION,
  EXPORT_FILTER_SUMMARY_MAX_TERMS,
  buildDataExportAuditRow,
  createDataExportAuditWriter,
  summarizeExportFilter,
  type DataExportAuditEvent,
  type DataExportAuditWriter,
} from './data-export-audit.js';

const LEDGER = 'sys_audit_log';
const SYS = { isSystem: true } as const;

/**
 * A cell value no field name, operator or code in this file spells: the
 * no-value pins seed it into every value position an export request has.
 */
const SECRET = 'Zq7-export-cell-value-4411';

/** An export as the door hands it, completed; each case overrides what it is about. */
function exportEvent(overrides: Partial<DataExportAuditEvent> = {}): DataExportAuditEvent {
  return {
    context: { userId: 'u_exporter', tenantId: 'org_a' },
    objectName: 'dea_note',
    format: 'csv',
    rowCount: 2,
    limit: 10_000,
    requestedLimit: 10_000,
    limitCap: 50_000,
    truncated: false,
    outcome: 'succeeded',
    ...overrides,
  };
}

const metadataOf = (row: Record<string, unknown>): Record<string, any> => JSON.parse(String(row.metadata));

describe('[#30955] the export writer on the real `audit` slot', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let audit: DataExportAuditWriter;

  /** The export rows at rest, oldest first. */
  const exportRows = async (): Promise<Array<Record<string, any>>> =>
    (await engine.find(LEDGER, { where: { action: DATA_EXPORT_AUDIT_ACTION }, orderBy: [{ field: 'created_at', order: 'asc' }], context: SYS })) as Array<Record<string, any>>;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();
    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    await engine.syncSchemas();
    audit = kernel.getService<DataExportAuditWriter>('audit');
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('the slot carries the writer beside the other ledger ingresses', () => {
    expect(typeof audit.recordDataExport).toBe('function');
    expect(typeof (audit as any).recordAuthEvent).toBe('function');
    expect(typeof (audit as any).recordActionInvocation).toBe('function');
  });

  it('an export of an ordinary object writes ONE run-level row with its format and row count', async () => {
    const before = (await exportRows()).length;
    await audit.recordDataExport(exportEvent({ objectName: 'dea_note', format: 'xlsx', rowCount: 2 }));
    const rows = await exportRows();
    expect(rows).toHaveLength(before + 1);
    const row = rows[rows.length - 1];
    expect(row).toMatchObject({
      action: 'export',
      object_name: 'dea_note',
      record_id: null,
      user_id: 'u_exporter',
      actor: 'u_exporter',
      tenant_id: 'org_a',
    });
    expect(row.old_value ?? null).toBeNull();
    expect(row.new_value ?? null).toBeNull();
    expect(metadataOf(row)).toMatchObject({
      format: 'xlsx',
      row_count: 2,
      limit: 10_000,
      requested_limit: 10_000,
      limit_cap: 50_000,
      limit_capped: false,
      truncated: false,
      search: false,
      outcome: 'succeeded',
    });
  });

  it('an export of the ledger itself writes ONE row about the ledger', async () => {
    const before = (await exportRows()).length;
    await audit.recordDataExport(exportEvent({ objectName: LEDGER, format: 'json', rowCount: 7 }));
    const rows = await exportRows();
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]).toMatchObject({ action: 'export', object_name: LEDGER, record_id: null });
    expect(metadataOf(rows[rows.length - 1])).toMatchObject({ format: 'json', row_count: 7, outcome: 'succeeded' });
  });

  it('a truncated export records the truncation and that the 50k cap clipped the request', async () => {
    await audit.recordDataExport(exportEvent({ rowCount: 50_000, limit: 50_000, requestedLimit: 80_000, truncated: true }));
    const rows = await exportRows();
    expect(metadataOf(rows[rows.length - 1])).toMatchObject({
      row_count: 50_000,
      limit: 50_000,
      requested_limit: 80_000,
      limit_cap: 50_000,
      limit_capped: true,
      truncated: true,
    });
  });

  it('a failed export records its outcome, status and machine code', async () => {
    await audit.recordDataExport(exportEvent({ outcome: 'failed', status: 400, errorCode: 'INVALID_FIELD', rowCount: 0 }));
    const rows = await exportRows();
    expect(metadataOf(rows[rows.length - 1])).toMatchObject({
      outcome: 'failed',
      status: 400,
      error_code: 'INVALID_FIELD',
      row_count: 0,
    });
  });

  it('the row never carries an exported cell value: not the filter comparands, not the search term', async () => {
    await audit.recordDataExport(exportEvent({
      query: {
        filter: {
          name: SECRET,
          $or: [
            { code: { $in: [SECRET, `${SECRET}-2`] } },
            { owner: { email: { $contains: SECRET } } },
            { $not: { title: { $eq: SECRET } } },
          ],
        },
        search: SECRET,
        searchFields: ['name', 'code'],
      },
    }));
    const rows = await exportRows();
    const row = rows[rows.length - 1];
    // Every column of the stored row, the metadata included, as one string.
    expect(JSON.stringify(row)).not.toContain(SECRET);
    // …while what the request ASKED is recorded: which fields, which operators.
    const meta = metadataOf(row);
    expect(meta.filter).toEqual([
      { field: 'name', op: '$eq' },
      { field: 'code', op: '$in' },
      { field: 'owner.email', op: '$contains' },
      { field: 'title', op: '$eq' },
    ]);
    expect(meta.search).toBe(true);
    expect(meta.search_fields).toEqual(['name', 'code']);
  });
});

describe('[#30955] the filter summary keeps names and operators, never a comparand', () => {
  it('reads the array dialect: comparison nodes, logic words and a list of conditions', () => {
    expect(summarizeExportFilter(['and', ['status', '=', SECRET], ['or', ['amount', '>', 5], ['code', 'in', [SECRET]]]])).toEqual({
      terms: [
        { field: 'status', op: '=' },
        { field: 'amount', op: '>' },
        { field: 'code', op: 'in' },
      ],
      omitted: 0,
    });
    expect(summarizeExportFilter([['a', '=', SECRET], 'or', ['b', 'contains', SECRET]]).terms).toEqual([
      { field: 'a', op: '=' },
      { field: 'b', op: 'contains' },
    ]);
  });

  it('records a field position that is not a machine-name path, and an operator token of no operator shape, as `?`', () => {
    const { terms } = summarizeExportFilter({ [SECRET]: 1, ok_field: { [`$${SECRET}`]: 1 } });
    expect(terms).toEqual([
      { field: '?', op: '$eq' },
      { field: 'ok_field', op: '?' },
    ]);
    expect(JSON.stringify(terms)).not.toContain(SECRET);
  });

  it('is bounded: terms past the bound are counted, not recorded', () => {
    const filter = Object.fromEntries(Array.from({ length: EXPORT_FILTER_SUMMARY_MAX_TERMS + 8 }, (_, i) => [`f_${i}`, SECRET]));
    const { terms, omitted } = summarizeExportFilter(filter);
    expect(terms).toHaveLength(EXPORT_FILTER_SUMMARY_MAX_TERMS);
    expect(omitted).toBe(8);
    const row = buildDataExportAuditRow(exportEvent({ query: { filter } }));
    expect(metadataOf(row).filter_terms_omitted).toBe(8);
  });

  it('de-duplicates a repeated term', () => {
    expect(summarizeExportFilter({ $or: [{ a: 1 }, { a: 2 }, { a: { $eq: 3 } }] }).terms).toEqual([{ field: 'a', op: '$eq' }]);
  });
});

describe('[#30955] the row attributes the export the way the other ledger rows do', () => {
  it('an agent-performed export names the client and the delegating user', () => {
    const row = buildDataExportAuditRow(exportEvent({
      context: { userId: 'u_human', tenantId: 'org_a', performedBy: { clientId: 'client_agent' } as any },
    }));
    expect(metadataOf(row)).toMatchObject({ performed_by: 'client_agent', on_behalf_of: 'u_human' });
  });

  it('a service principal with no user is the actor', () => {
    const row = buildDataExportAuditRow(exportEvent({ context: { actor: 'svc:nightly', tenantId: 'org_a' } as any }));
    expect(row).toMatchObject({ user_id: null, actor: 'svc:nightly' });
  });

  it('a ledger with no `actor` column gets no `actor` key', () => {
    const row = buildDataExportAuditRow(exportEvent(), () => false);
    expect('actor' in row).toBe(false);
  });
});

describe('[#30955] a lost row is loud, once per cause, and never throws', () => {
  it('reports a refused ledger write at `error`, then `debug` for the same cause', async () => {
    const refusal = Object.assign(new Error('ledger refused'), { code: 'SQLITE_READONLY' });
    const engine = { insert: vi.fn(async () => { throw refusal; }) } as any;
    const logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const writer = createDataExportAuditWriter({ getEngine: () => engine, logger });

    await expect(writer.recordDataExport(exportEvent({ query: { filter: { name: SECRET }, search: SECRET } }))).resolves.toBeUndefined();
    await expect(writer.recordDataExport(exportEvent())).resolves.toBeUndefined();

    expect(engine.insert).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0][0])).toMatch(/^Data-export audit write FAILED/);
    expect(logger.debug).toHaveBeenCalledTimes(1);
    // The report names the object and the cause — never the export's query.
    expect(JSON.stringify([...logger.error.mock.calls, ...logger.debug.mock.calls])).not.toContain(SECRET);
  });

  it('writes nothing, and says nothing, with no engine to write to', async () => {
    const logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const writer = createDataExportAuditWriter({ getEngine: () => undefined, logger });
    await expect(writer.recordDataExport(exportEvent())).resolves.toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
