// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A tracked BOOLEAN change in an activity summary reads as words in the
 * reader's language, not as the literals `false → true`.
 *
 * The measured sentence was a converted lead on a zh-CN console:
 * 「状态: 新建 → 已转化; 已转化: false → true」 — the select change beside it
 * already read through its option labels, the boolean fell through to its raw
 * value. The value now rides in the summary code as a boolean
 * (`ActivitySummaryValue.boolean`), and the composer renders it through this
 * plugin's `messages.*` catalogue (`activityValueTrue` / `activityValueFalse`)
 * in the locale it composes in: the write locale for the stored sentence, the
 * reader's negotiated locale on a read (the same path the verb templates take).
 * A boolean field that declares its own options keeps reading through them.
 *
 * Rows are written by the real audit writer, stored by a real SQLite driver
 * and read back through the real engine middleware chain under a caller
 * context carrying `locale`, as the REST door resolves it from
 * `Accept-Language` (the harness `activity-summary-reader-locale.integration.test.ts` uses).
 *
 * ⚠️ No test title states a value.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { II18nService } from '@objectstack/spec/contracts';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';
import { installDefaultOrganization } from './default-organization.testkit.js';
import { composeActivitySummary, readActivitySummaryMessage } from './activity-summary-message.js';

const HARNESS_PACKAGE = 'com.objectstack.audit.test.boolean-change-wording';
const LEAD = 'bw_lead';

const lead = {
  name: LEAD,
  label: 'Lead',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    status: {
      name: 'status', label: 'Status', type: 'select' as const, trackHistory: true,
      options: [{ value: 'new', label: 'New' }, { value: 'converted', label: 'Converted' }],
    },
    is_converted: { name: 'is_converted', label: 'Converted', type: 'boolean' as const, trackHistory: true },
    do_not_call: { name: 'do_not_call', label: 'Do Not Call', type: 'toggle' as const, trackHistory: true },
    /** A boolean that declares its own words: they win over the catalogue's. */
    is_hot: {
      name: 'is_hot', label: 'Hot', type: 'boolean' as const, trackHistory: true,
      options: [{ value: true, label: 'Hot' }, { value: false, label: 'Cold' }],
    },
  },
};

const SYS = { context: { isSystem: true } };
const READER = { userId: 'u_reader', tenantId: 'org_1', positions: ['org_member'] };
const reader = (locale?: string) => ({ context: { ...READER, ...(locale ? { locale } : {}) } });

type Row = Record<string, any>;

describe('a tracked boolean change reads as words in the reader\'s language', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let recordId: string;
  const rowIds: Record<'convert' | 'toggle' | 'declared', string> = {} as never;

  async function summaryOf(rowId: string, opts: Record<string, unknown>): Promise<string | undefined> {
    const rows = (await engine.find('sys_activity', { where: { id: rowId }, ...opts })) as Row[];
    return rows[0]?.summary;
  }

  const security = {
    async getReadableFields(object: string): Promise<string[] | undefined> {
      return Object.keys(((engine as any).getSchema(object)?.fields ?? {}) as Record<string, unknown>);
    },
    async getQueryableFields(object: string): Promise<string[] | undefined> {
      return security.getReadableFields(object);
    },
  };

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use({
      name: 'test.security-double',
      version: '0.0.0',
      init: async (ctx: any) => ctx.registerService('security', security),
      start: async () => {},
    } as any);
    await kernel.use(singlePostureTenancy());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(lead as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    // The app's language pack: object, field and option labels in zh-CN.
    kernel.getService<II18nService>('i18n').loadTranslations('zh-CN', {
      objects: {
        [LEAD]: {
          label: '线索',
          fields: {
            status: { label: '状态', options: { new: '新建', converted: '已转化' } },
            is_converted: { label: '已转化' },
            do_not_call: { label: '请勿致电' },
            is_hot: { label: '热度' },
          },
        },
      },
    });

    const created = (await engine.insert(
      LEAD,
      { name: 'Wren', status: 'new', is_converted: false, do_not_call: true, is_hot: false },
      SYS,
    )) as Row;
    recordId = String(created.id);
    await engine.update(LEAD, { status: 'converted', is_converted: true }, { where: { id: recordId }, ...SYS });
    await engine.update(LEAD, { do_not_call: false }, { where: { id: recordId }, ...SYS });
    await engine.update(LEAD, { is_hot: true }, { where: { id: recordId }, ...SYS });

    const rows = (await engine.find('sys_activity', {
      where: { object_name: LEAD, record_id: recordId, type: 'updated' },
      ...SYS,
    })) as Row[];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const changed = Object.keys(JSON.parse(row.metadata).new ?? {});
      if (changed.includes('is_converted')) rowIds.convert = row.id;
      else if (changed.includes('do_not_call')) rowIds.toggle = row.id;
      else rowIds.declared = row.id;
    }
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    }
  }, 30_000);

  it('a zh-CN reader reads the boolean change in zh-CN words beside the option labels', async () => {
    expect(await summaryOf(rowIds.convert, reader('zh-CN'))).toBe('状态: 新建 → 已转化; 已转化: 否 → 是');
    expect(await summaryOf(rowIds.toggle, reader('zh-CN'))).toBe('请勿致电: 是 → 否');
  });

  it('the stored sentence, and an en reader, read English words', async () => {
    expect(await summaryOf(rowIds.convert, SYS)).toBe('Status: New → Converted; Converted: No → Yes');
    expect(await summaryOf(rowIds.convert, reader('en-US'))).toBe('Status: New → Converted; Converted: No → Yes');
    expect(await summaryOf(rowIds.toggle, reader())).toBe('Do Not Call: Yes → No');
  });

  it('another platform language reads its own words', async () => {
    expect(await summaryOf(rowIds.convert, reader('ja-JP'))).not.toMatch(/\b(true|false)\b/);
    expect(await summaryOf(rowIds.convert, reader('ja-JP'))).not.toContain('Yes');
  });

  it('a boolean field that declares its own option labels keeps them', async () => {
    expect(await summaryOf(rowIds.declared, SYS)).toBe('Hot: Cold → Hot');
  });

  it('the stored code carries the boolean value itself, not only its English word', async () => {
    const [row] = (await engine.find('sys_activity', { where: { id: rowIds.convert }, ...SYS })) as Row[];
    const code = readActivitySummaryMessage(JSON.parse(row.metadata).summary_message);
    expect(code).not.toBeNull();
    const change = (code as any).changes.find((c: any) => c.field === 'is_converted');
    expect(change.from.boolean).toBe(false);
    expect(change.to.boolean).toBe(true);
  });

  it('a locale with no catalogue word keeps the writer\'s text', () => {
    const silent = {
      translate: () => undefined,
      locale: 'it-IT',
      getObjectDef: () => null,
    };
    expect(
      composeActivitySummary(
        {
          key: 'fieldChanges',
          object: LEAD,
          changes: [{ field: 'is_converted', from: { text: 'No', boolean: false }, to: { text: 'Yes', boolean: true } }],
        },
        silent,
      ),
    ).toBe('is_converted: No → Yes');
  });
});
