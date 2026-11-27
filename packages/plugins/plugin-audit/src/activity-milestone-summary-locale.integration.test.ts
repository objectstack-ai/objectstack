// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37524] A fired activity milestone's timeline row reads in the READER's
 * language, through `objects.<object>._milestones.<field>.<value>.summary`.
 *
 * The rows are written by the real audit writer, stored by a real SQLite
 * driver and read back through the real engine middleware chain, under a caller
 * context whose `locale` is what the REST door resolves from `Accept-Language`
 * (the harness of `activity-summary-reader-locale.integration.test.ts`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { II18nService } from '@objectstack/spec/contracts';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const HARNESS_PACKAGE = 'com.objectstack.audit.test.milestone-summary-locale';
const DEAL = 'biz_deal';

const deal = {
  name: DEAL,
  label: 'Deal',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    stage: {
      name: 'stage',
      label: 'Stage',
      type: 'select' as const,
      options: [
        { value: 'open', label: 'Open' },
        { value: 'won', label: 'Won' },
        { value: 'lost', label: 'Lost' },
      ],
    },
    note: { name: 'note', label: 'Note', type: 'text' as const },
  },
  activityMilestones: [
    { field: 'stage', value: 'won', summary: 'Deal won: {name} ({stage})' },
    { field: 'stage', value: 'lost', summary: 'Deal lost: {name}, {note}' },
  ],
};

const SYS = { context: { isSystem: true } };
const READER = { userId: 'u_reader', tenantId: 'org_1', positions: ['org_member'] };
/** A reader the security service does not serve the deal's `note` field. */
const NOTE_HIDDEN = { userId: 'u_note_hidden', tenantId: 'org_1', positions: ['org_member'] };
const reader = (locale?: string, who: Record<string, unknown> = READER) => ({
  context: { ...who, ...(locale ? { locale } : {}) },
});

type Row = Record<string, any>;

describe('activity milestone summary — rendered in the reader\'s language (#37524)', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  const ids: Record<'won' | 'lost', { record: string; row: string }> = {} as never;

  async function rowOf(which: 'won' | 'lost', opts: Record<string, unknown>): Promise<Row | undefined> {
    const rows = (await engine.find('sys_activity', {
      where: { object_name: DEAL, record_id: ids[which].record },
      ...opts,
    })) as Row[];
    return rows.find((r) => r.id === ids[which].row);
  }

  const security = {
    async getReadableFields(object: string, context?: any): Promise<string[] | undefined> {
      const all = Object.keys(((engine as any).getSchema(object)?.fields ?? {}) as Record<string, unknown>);
      return context?.userId === NOTE_HIDDEN.userId && object === DEAL ? all.filter((f) => f !== 'note') : all;
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
    engine.registry.registerObject(deal as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    // The app's zh-CN pack: the milestones' templates, keyed by the pair that
    // fires each, and the option labels a `{stage}` token is named by.
    kernel.getService<II18nService>('i18n').loadTranslations('zh-CN', {
      objects: {
        [DEAL]: {
          label: '商机',
          fields: {
            stage: { label: '阶段', options: { open: '进行中', won: '赢单', lost: '输单' } },
          },
          _milestones: {
            stage: {
              won: { summary: '商机赢单：{name}（{stage}）' },
              lost: { summary: '商机输单：{name}，{note}' },
            },
          },
        },
      },
    });

    for (const [which, to] of [['won', 'won'], ['lost', 'lost']] as const) {
      const created = (await engine.insert(DEAL, { name: 'Acme', stage: 'open', note: 'budget cut' }, SYS)) as Row;
      const record = String(created.id);
      await engine.update(DEAL, { stage: to }, { where: { id: record }, ...SYS });
      const rows = (await engine.find('sys_activity', { where: { object_name: DEAL, record_id: record }, ...SYS })) as Row[];
      const fired = rows.find((r) => r.type !== 'created');
      expect(fired, `the ${which} milestone row`).toBeDefined();
      ids[which] = { record, row: String(fired!.id) };
    }
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    }
  }, 30_000);

  it('red first: a zh-CN reader reads the translated template, a select token by its zh-CN option label', async () => {
    expect((await rowOf('won', reader('zh-CN')))?.summary).toBe('商机赢单：Acme（赢单）');
  });

  it('stores the authored sentence, and serves it to an en reader, a read with no locale, and a locale with no entry', async () => {
    const authored = 'Deal won: Acme (Won)';
    expect((await rowOf('won', SYS))?.summary).toBe(authored);
    expect((await rowOf('won', reader('en-US')))?.summary).toBe(authored);
    expect((await rowOf('won', reader()))?.summary).toBe(authored);
    expect((await rowOf('won', reader('ja-JP')))?.summary).toBe(authored);
  });

  it('stores the milestone code for the system, and serves it to no other caller', async () => {
    const atRest = await rowOf('won', SYS);
    expect(JSON.parse(atRest!.metadata).summary_message).toEqual({
      key: 'activityMilestone',
      object: DEAL,
      field: 'stage',
      value: 'won',
      tokens: { name: { text: 'Acme' }, stage: { text: 'Won', option: 'won' } },
      names: ['name', 'stage'],
    });
    const served = await rowOf('won', reader('zh-CN'));
    expect(JSON.parse(served!.metadata)).not.toHaveProperty('summary_message');
  });

  it('the field redaction still judges the text: a reader not served a token\'s field gets no summary in any language', async () => {
    expect((await rowOf('lost', reader('zh-CN')))?.summary).toBe('商机输单：Acme，budget cut');
    const hidden = await rowOf('lost', reader('zh-CN', NOTE_HIDDEN));
    expect(hidden).toBeDefined();
    expect(hidden).not.toHaveProperty('summary');
  });

  // Last: it changes the app's pack for the rest of the file.
  it('[#37635] a row written before its template gained a token reads its stored sentence, not a hole', async () => {
    // The app adds `{note}` to the won milestone, with its translation. The
    // won row was written before: it holds no value for `note`.
    kernel.getService<II18nService>('i18n').loadTranslations('zh-CN', {
      objects: { [DEAL]: { _milestones: { stage: { won: { summary: '商机赢单：{name}（{stage}），备注：{note}' } } } } },
    });
    expect((await rowOf('won', reader('zh-CN')))?.summary).toBe('Deal won: Acme (Won)');
    // CONTROL: the lost row's template held `{note}` when it was written, so it still composes.
    expect((await rowOf('lost', reader('zh-CN')))?.summary).toBe('商机输单：Acme，budget cut');
  });
});
