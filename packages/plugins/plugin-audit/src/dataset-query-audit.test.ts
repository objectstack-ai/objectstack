// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `dataset_query` writer stores a REAL, READ-BACK ledger row for each
 * dataset query of an opted-in dataset, and never a filtered value.
 *
 * The cases boot the real composition this package ships in
 * (`ObjectQLPlugin` + `AuditPlugin` on a sqlite driver). Every assertion reads
 * the row back through the engine, for the reason `data-export-audit.test.ts`
 * records: every `sys_audit_log` field is `readonly` and `validateRecord`
 * skips readonly fields, so "the call did not throw" is equally true when the
 * row landed right, landed wrong, or was never attempted. The door side (the
 * analytics dataset door hands one event per query that reached the read, and
 * none for a refused one) is pinned in `@objectstack/rest`'s
 * `analytics-dataset-query-audit.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';
import {
  DATASET_QUERY_AUDIT_ACTION,
  buildDatasetQueryAuditRow,
  createDatasetQueryAuditWriter,
  type DatasetQueryAuditEvent,
} from './dataset-query-audit.js';

const LEDGER = 'sys_audit_log';
const SYS = { isSystem: true } as const;

/** A value no field name, operator or code in this file spells. */
const SECRET = 'Zq7-dataset-filter-value-5521';

/** A query as the door hands it, completed; each case overrides what it is about. */
function queryEvent(overrides: Partial<DatasetQueryAuditEvent> = {}): DatasetQueryAuditEvent {
  return {
    context: { userId: 'u_analyst', tenantId: 'org_a' },
    datasetName: 'sales',
    objectName: 'opportunity',
    dimensions: ['region'],
    measures: ['revenue'],
    readQuery: { filter: { stage: SECRET, amount: { $gte: 1000 } } },
    rowCount: 3,
    outcome: 'succeeded',
    ...overrides,
  };
}

const metadataOf = (row: Record<string, unknown>): Record<string, any> => JSON.parse(String(row.metadata));

async function bootKernel(plugin: AuditPlugin): Promise<{ kernel: ObjectKernel; engine: ObjectQL }> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } });
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(plugin);
  await kernel.bootstrap();
  const engine = kernel.getService<ObjectQL>('objectql');
  const driver = new SqliteWasmDriver({ filename: ':memory:' });
  await driver.connect();
  engine.registerDriver(driver, true);
  await engine.syncSchemas();
  return { kernel, engine };
}

const queryRows = async (engine: ObjectQL): Promise<Array<Record<string, any>>> =>
  (await engine.find(LEDGER, {
    where: { action: DATASET_QUERY_AUDIT_ACTION },
    orderBy: [{ field: 'created_at', order: 'asc' }],
    context: SYS,
  })) as Array<Record<string, any>>;

describe('the dataset_query writer over the real ledger', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;

  beforeAll(async () => {
    ({ kernel, engine } = await bootKernel(new AuditPlugin()));
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('one query of an opted-in dataset writes ONE run-level row naming who, which dataset, the selection and the row count', async () => {
    const writer = createDatasetQueryAuditWriter({ getEngine: () => engine, datasets: ['sales'] });
    const before = (await queryRows(engine)).length;
    writer.recordDatasetQuery(queryEvent());
    await writer.flush();
    const rows = await queryRows(engine);
    expect(rows).toHaveLength(before + 1);
    const row = rows[rows.length - 1];
    expect(row).toMatchObject({
      action: 'dataset_query',
      object_name: 'opportunity',
      record_id: null,
      user_id: 'u_analyst',
      actor: 'u_analyst',
      tenant_id: 'org_a',
    });
    expect(row.old_value ?? null).toBeNull();
    expect(row.new_value ?? null).toBeNull();
    expect(metadataOf(row)).toEqual({
      dataset: 'sales',
      dataset_package: null,
      dimensions: ['region'],
      measures: ['revenue'],
      filter: [
        { field: 'stage', op: '$eq' },
        { field: 'amount', op: '$gte' },
      ],
      row_count: 3,
      outcome: 'succeeded',
    });
    await writer.stop();
  });

  it('names the package holding the dataset, and a served draft, so two holders of one name are two different rows', async () => {
    const writer = createDatasetQueryAuditWriter({ getEngine: () => engine, datasets: ['sales'] });
    writer.recordDatasetQuery(queryEvent({ datasetPackage: 'com.acme.crm', rowCount: 31 }));
    writer.recordDatasetQuery(queryEvent({ datasetPackage: 'com.acme.ops', preview: true, rowCount: 32 }));
    await writer.flush();
    const rows = (await queryRows(engine)).map(metadataOf).filter((m) => m.row_count === 31 || m.row_count === 32)
      // One batch, one instant: ordered by what each query returned, not by insert order.
      .sort((a, b) => a.row_count - b.row_count);
    expect(rows.map((m) => [m.dataset, m.dataset_package, m.preview])).toEqual([
      ['sales', 'com.acme.crm', undefined],
      ['sales', 'com.acme.ops', true],
    ]);
    await writer.stop();
  });

  it('a dataset that is not opted in writes no row', async () => {
    const writer = createDatasetQueryAuditWriter({ getEngine: () => engine, datasets: ['pipeline'] });
    const before = (await queryRows(engine)).length;
    writer.recordDatasetQuery(queryEvent({ datasetName: 'sales' }));
    await writer.flush();
    expect(writer.pending()).toBe(0);
    expect(await queryRows(engine)).toHaveLength(before);
    await writer.stop();
  });

  it('with no dataset opted in (the default) a query writes no row and the writer buffers nothing', async () => {
    const writer = createDatasetQueryAuditWriter({ getEngine: () => engine, datasets: [] });
    const before = (await queryRows(engine)).length;
    writer.recordDatasetQuery(queryEvent());
    expect(writer.pending()).toBe(0);
    await writer.flush();
    expect(await queryRows(engine)).toHaveLength(before);
    expect(writer.auditedDatasets).toEqual([]);
  });

  it('a query that failed after the read started writes ONE row with outcome failed, its status and machine code', async () => {
    const writer = createDatasetQueryAuditWriter({ getEngine: () => engine, datasets: ['sales'] });
    const before = (await queryRows(engine)).length;
    writer.recordDatasetQuery(queryEvent({ outcome: 'failed', rowCount: 0, status: 503, errorCode: 'SERVICE_UNAVAILABLE' }));
    await writer.flush();
    const rows = await queryRows(engine);
    expect(rows).toHaveLength(before + 1);
    expect(metadataOf(rows[rows.length - 1])).toMatchObject({
      dataset: 'sales',
      row_count: 0,
      outcome: 'failed',
      status: 503,
      error_code: 'SERVICE_UNAVAILABLE',
    });
    await writer.stop();
  });

  it('records no filtered value: every comparand position of the filter is dropped unread', async () => {
    const writer = createDatasetQueryAuditWriter({ getEngine: () => engine, datasets: ['sales'] });
    writer.recordDatasetQuery(queryEvent({
      readQuery: {
        filter: {
          $or: [{ stage: { $in: [SECRET, `${SECRET}-2`] } }, { name: { $contains: SECRET } }],
          owner: { name: SECRET },
        },
      },
    }));
    await writer.flush();
    const rows = await queryRows(engine);
    const row = rows[rows.length - 1];
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(metadataOf(row).filter).toEqual([
      { field: 'stage', op: '$in' },
      { field: 'name', op: '$contains' },
      { field: 'owner.name', op: '$eq' },
    ]);
    await writer.stop();
  });

  it('stamps the QUERY instant, not the flush instant', async () => {
    const queriedAt = new Date('2026-01-02T03:04:05.000Z');
    const writer = createDatasetQueryAuditWriter({ getEngine: () => engine, datasets: ['sales'], now: () => queriedAt });
    writer.recordDatasetQuery(queryEvent({ datasetName: 'sales', rowCount: 9 }));
    await writer.flush();
    const rows = await queryRows(engine);
    const row = rows.find((r) => metadataOf(r).row_count === 9)!;
    expect(new Date(row.created_at).toISOString()).toBe(queriedAt.toISOString());
    await writer.stop();
  });

  it('enqueue returns before the ledger write: the row lands on the flush, off the request path', async () => {
    const writer = createDatasetQueryAuditWriter({ getEngine: () => engine, datasets: ['sales'] });
    const before = (await queryRows(engine)).length;
    const returned = writer.recordDatasetQuery(queryEvent({ rowCount: 11 }));
    expect(returned).toBeUndefined();
    expect(writer.pending()).toBe(1);
    expect(await queryRows(engine)).toHaveLength(before);
    await writer.flush();
    expect(await queryRows(engine)).toHaveLength(before + 1);
    await writer.stop();
  });

  it('a lost batch is reported at error once per cause and never throws to the caller', async () => {
    const logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const failing = { insert: async () => { throw Object.assign(new Error('disk full'), { code: 'SQLITE_FULL' }); } } as any;
    const writer = createDatasetQueryAuditWriter({ getEngine: () => failing, datasets: ['sales'], logger });
    writer.recordDatasetQuery(queryEvent());
    await writer.flush();
    writer.recordDatasetQuery(queryEvent());
    await writer.flush();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0][0])).toMatch(/Dataset-query audit write FAILED/);
    await writer.stop();
  });
});

describe('the dataset_query opt-in through AuditPlugin and the `audit` slot', () => {
  it('a dataset named in datasetQueryAudit.datasets writes its row through the slot; another dataset writes none', async () => {
    const { kernel, engine } = await bootKernel(
      new AuditPlugin({ datasetQueryAudit: { datasets: ['sales'], flushIntervalMs: 1 } }),
    );
    try {
      const audit = kernel.getService<{ recordDatasetQuery(e: DatasetQueryAuditEvent): void }>('audit');
      expect(typeof audit.recordDatasetQuery).toBe('function');
      audit.recordDatasetQuery(queryEvent({ datasetName: 'pipeline', rowCount: 21 }));
      audit.recordDatasetQuery(queryEvent({ datasetName: 'sales', rowCount: 22 }));
      await vi.waitFor(async () => {
        expect((await queryRows(engine)).map((r) => metadataOf(r).dataset)).toEqual(['sales']);
      }, { timeout: 5_000 });
    } finally {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 120_000);

  it('an AuditPlugin with no datasetQueryAudit option writes no dataset_query row', async () => {
    const { kernel, engine } = await bootKernel(new AuditPlugin());
    try {
      const audit = kernel.getService<{ recordDatasetQuery(e: DatasetQueryAuditEvent): void }>('audit');
      audit.recordDatasetQuery(queryEvent());
      await new Promise((r) => setTimeout(r, 50));
      expect(await queryRows(engine)).toHaveLength(0);
    } finally {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 120_000);
});

describe('[#33694] an in-product AI query is marked on the dataset_query row by the CRUD mirror\'s rule', () => {
  const PERFORMER_KEYS = ['performed_by', 'on_behalf_of', 'conversation_id', 'confirmation_id'];
  const QUERIED_AT = new Date('2026-11-17T00:00:00.000Z');
  const aiQuery = (performedBy: Record<string, string>) =>
    queryEvent({ context: { userId: 'u_analyst', tenantId: 'org_a', performedBy } as any });

  it('an AI-performed query records the agent, the person, the conversation and the confirmation', () => {
    const row = buildDatasetQueryAuditRow(
      aiQuery({ agentId: 'sales_assistant', conversationId: 'conv_1', confirmationId: 'pend_1' }),
      QUERIED_AT,
    );
    expect(row.user_id).toBe('u_analyst');
    expect(metadataOf(row)).toMatchObject({
      performed_by: 'sales_assistant',
      on_behalf_of: 'u_analyst',
      conversation_id: 'conv_1',
      confirmation_id: 'pend_1',
    });
  });

  it('CONTROL: an OAuth client — alone, or beside an agent — is the performer, with no conversation or confirmation', () => {
    const envelopes: Array<Record<string, string>> = [
      { clientId: 'client_agent', conversationId: 'conv_1', confirmationId: 'pend_1' },
      { clientId: 'client_agent', agentId: 'sales_assistant', conversationId: 'conv_1', confirmationId: 'pend_1' },
    ];
    for (const performedBy of envelopes) {
      const meta = metadataOf(buildDatasetQueryAuditRow(aiQuery(performedBy), QUERIED_AT));
      expect(meta).toMatchObject({ performed_by: 'client_agent', on_behalf_of: 'u_analyst' });
      expect(meta).not.toHaveProperty('conversation_id');
      expect(meta).not.toHaveProperty('confirmation_id');
    }
  });

  it('CONTROL: a person\'s own query carries no performer key at all', () => {
    const meta = metadataOf(buildDatasetQueryAuditRow(queryEvent(), QUERIED_AT));
    for (const key of PERFORMER_KEYS) expect(meta).not.toHaveProperty(key);
  });
});
