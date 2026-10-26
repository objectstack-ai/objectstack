// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26167] An activity summary reads in the READER's language, on the plugin's
 * read path.
 *
 * The workspace locale is left at its default (`en`), so the CRUD mirror stores
 * English sentences — the hotclm measurement: a zh-CN reader's 讨论 tab showed
 * `Created Contract "…"` although the plugin ships `创建了 {{object}} "{{label}}"`.
 * The rows are written by the real audit writer, stored by a real SQLite
 * driver, and read back through the real engine middleware chain under a
 * caller context whose `locale` is what the REST door resolves from
 * `Accept-Language`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { II18nService } from '@objectstack/spec/contracts';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const HARNESS_PACKAGE = 'com.objectstack.audit.test.summary-reader-locale';
const CONTRACT = 'biz_contract';

const contract = {
  name: CONTRACT,
  label: 'Contract',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    stage: {
      name: 'stage',
      label: 'Stage',
      type: 'select' as const,
      trackHistory: true,
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'signed', label: 'Signed' },
      ],
    },
    note: { name: 'note', label: 'Note', type: 'text' as const },
  },
};

const SYS = { context: { isSystem: true } };
const READER = { userId: 'u_reader', tenantId: 'org_1', positions: ['org_member'] };
/** A reader the security service does not serve the contract's `note` field. */
const NOTE_HIDDEN = { userId: 'u_note_hidden', tenantId: 'org_1', positions: ['org_member'] };
const reader = (locale?: string, who: Record<string, unknown> = READER) => ({
  context: { ...who, ...(locale ? { locale } : {}) },
});

type Row = Record<string, any>;

describe('sys_activity summary — rendered in the reader\'s language (#26167)', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let recordId: string;

  /** The record's activity rows as `opts`'s caller reads them, by activity row id. */
  async function read(opts: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<Row[]> {
    return (await engine.find('sys_activity', {
      where: { object_name: CONTRACT, record_id: recordId },
      ...extra,
      ...opts,
    } as any)) as Row[];
  }
  /** The three mirror rows' summaries — created, the tracked change, the named-field update — as `opts` reads them. */
  async function summaries(opts: Record<string, unknown>): Promise<Array<string | undefined>> {
    const rows = await read(opts);
    return [rowIds.created, rowIds.stage, rowIds.note].map((id) => rows.find((r) => r.id === id)?.summary);
  }
  const rowIds: Record<'created' | 'stage' | 'note', string> = {} as never;

  /** The double: a field the `NOTE_HIDDEN` reader is not served; everything else is. */
  const security = {
    async getReadableFields(object: string, context?: any): Promise<string[] | undefined> {
      const all = Object.keys(((engine as any).getSchema(object)?.fields ?? {}) as Record<string, unknown>);
      return context?.userId === NOTE_HIDDEN.userId && object === CONTRACT ? all.filter((f) => f !== 'note') : all;
    },
    async getQueryableFields(object: string, context?: any): Promise<string[] | undefined> {
      return security.getReadableFields(object, context);
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
    engine.registry.registerObject(contract as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    // The app's language pack: its object, field and option labels in zh-CN.
    // The plugin's own `messages.*` templates are loaded by AuditPlugin.
    kernel.getService<II18nService>('i18n').loadTranslations('zh-CN', {
      objects: {
        [CONTRACT]: {
          label: '合同',
          fields: {
            stage: { label: '阶段', options: { draft: '草稿', signed: '已签署' } },
            note: { label: '备注' },
          },
        },
      },
    });

    // Written as the system: the workspace locale is the default, `en`.
    const created = (await engine.insert(CONTRACT, { name: 'NDA', stage: 'draft' }, SYS as any)) as Row;
    recordId = String(created.id);
    await engine.update(CONTRACT, { stage: 'signed' }, { where: { id: recordId }, ...SYS } as any);
    await engine.update(CONTRACT, { note: 'countersigned' }, { where: { id: recordId }, ...SYS } as any);
    const atRest = await read(SYS);
    expect(atRest).toHaveLength(3);
    for (const row of atRest) {
      const meta = JSON.parse(row.metadata);
      if (row.type === 'created') rowIds.created = row.id;
      else if ('stage' in (meta.new ?? {})) rowIds.stage = row.id;
      else rowIds.note = row.id;
    }
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    }
  }, 30_000);

  it('red first: a zh-CN reader reads every row the en workspace wrote in zh-CN', async () => {
    expect(await summaries(reader('zh-CN'))).toEqual([
      '创建了 合同 "NDA"',
      '阶段: 草稿 → 已签署',
      '更新了 合同 "NDA"：备注',
    ]);
  });

  it('stores the English sentence, and serves it to an en reader and to a read with no locale', async () => {
    const english = ['Created Contract "NDA"', 'Stage: Draft → Signed', 'Updated Contract "NDA": Note'];
    expect(await summaries(SYS)).toEqual(english);
    expect(await summaries(reader('en-US'))).toEqual(english);
    expect(await summaries(reader())).toEqual(english);
  });

  it('negotiates the reader locale against the held packs (a bare `zh` reads the zh-CN pack)', async () => {
    expect((await summaries(reader('zh')))[0]).toBe('创建了 合同 "NDA"');
  });

  it('a reader locale with no template keeps the stored sentence', async () => {
    expect((await summaries(reader('fr-FR')))[0]).toBe('Created Contract "NDA"');
  });

  it('serves the code to no caller but the system, and composes when only `summary` is projected', async () => {
    const served = (await read(reader('zh-CN'))).find((r) => r.id === rowIds.created)!;
    expect(JSON.parse(served.metadata)).not.toHaveProperty('summary_message');
    const atRest = (await read(SYS)).find((r) => r.id === rowIds.created)!;
    expect(JSON.parse(atRest.metadata).summary_message).toEqual({
      key: 'activityCreated',
      object: CONTRACT,
      label: 'NDA',
    });

    const projected = await read(reader('zh-CN'), { where: { id: rowIds.created }, fields: ['summary'] });
    expect(projected).toEqual([{ summary: '创建了 合同 "NDA"' }]);
  });

  it('the field redaction still judges the composed text: a reader not served a named field gets no summary', async () => {
    expect(await summaries(reader('zh-CN', NOTE_HIDDEN))).toEqual([
      '创建了 合同 "NDA"',
      '阶段: 草稿 → 已签署',
      undefined,
    ]);
  });

  it('a row written before the change keeps its stored text for every reader', async () => {
    // The mirror's earlier shape: `metadata` exactly `{ old, new }`, no code.
    await engine.insert(
      'sys_activity',
      {
        type: 'created',
        timestamp: '2020-01-01T00:00:00.000Z',
        summary: 'Created Contract "NDA"',
        object_name: CONTRACT,
        record_id: recordId,
        record_label: 'NDA',
        metadata: JSON.stringify({ old: null, new: { name: 'NDA' } }),
      },
      SYS as any,
    );
    const legacy = (await read(reader('zh-CN'))).filter((r) => r.timestamp === '2020-01-01T00:00:00.000Z');
    expect(legacy.map((r) => r.summary)).toEqual(['Created Contract "NDA"']);
  });
});
