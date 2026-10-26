// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A refusal a flow's write node meets is worded in the run's locale, as the
 * same refusal on a record door is.
 *
 * The record doors hand `ExecutionContext.locale` to the engine, and the
 * engine resolves the refusal's text through its ONE translation hook
 * (`ObjectQL#validationMessageContext`, bridged to the i18n service): an
 * authored rule's `objects.<o>._validations.<rule>.message`, the built-in
 * catalog, a `DELETE_RESTRICTED` sentence's labels. A flow run started by a
 * person carries that person's locale on `AutomationContext.locale` (the
 * `/actions` and trigger doors seed it), but the data nodes' context
 * (`resolveRunDataContext`) dropped it — so the engine translated nothing and
 * the run's `innerRefusal.message` (the `FLOW_FAILED` details member the doors
 * emit) came back in the authored English while the same request's screens
 * rendered in Chinese.
 *
 * The fix adds no translation of its own: the locale rides into the data
 * context and the engine's existing hook does the rest. So these tests drive a
 * REAL engine (ObjectQL + better-sqlite3) with a bundle on its i18n service,
 * and assert what the run hands its caller — for every flow node that writes:
 * `create_record`, `update_record`, `delete_record`, under both `runAs` arms.
 * A run with no locale keeps the authored text: nothing is translated for a
 * caller who asked for no language.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

function makeSqliteDriver() {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

const RULE_EN = 'Amount must not be negative.';
const RULE_ZH = '金额不能为负数。';

const crmAccount = {
  name: 'crm_account',
  label: 'Account',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
  },
};

/** An authored rule whose message the app's zh-CN bundle translates. */
const crmDeal = {
  name: 'crm_deal',
  label: 'Deal',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    amount: { name: 'amount', label: 'Amount', type: 'number' },
    account: { name: 'account', label: 'Account', type: 'lookup', reference: 'crm_account', deleteBehavior: 'restrict' },
  },
  validations: [{
    type: 'script',
    name: 'amount_not_negative',
    message: RULE_EN,
    condition: 'record.amount < 0',
    fields: ['amount'],
  }],
};

/** The app's zh-CN bundle, as an `II18nService` (a miss echoes the key back). */
const ZH_BUNDLE: Record<string, string> = {
  'objects.crm_deal._validations.amount_not_negative.message': RULE_ZH,
  'objects.crm_account.label': '客户',
  'objects.crm_deal.label': '商机',
  'objects.crm_deal.fields.account.label': '所属客户',
};
const zhI18n = {
  t: (key: string, locale: string) => (locale?.startsWith('zh') ? ZH_BUNDLE[key] ?? key : key),
};

const USER = { userId: 'usr_seller', tenantId: 'org_1', positions: [] as string[], permissions: [] as string[] };
const SYS = { isSystem: true } as const;

type RunAs = 'user' | 'system';

/** start → one write node → end. */
const oneNodeFlow = (name: string, runAs: RunAs, node: Record<string, unknown>) => ({
  name,
  label: name,
  type: 'autolaunched',
  runAs,
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'write', label: 'Write', ...node },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'write' },
    { id: 'e2', source: 'write', target: 'end' },
  ],
});

describe('a flow write node\'s refusal speaks the run\'s locale, as the record doors do', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;

  afterEach(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  async function boot() {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');

    const driver = makeSqliteDriver();
    await driver.connect();
    ql.registerDriver(driver, true);
    ql.registry.registerObject(crmAccount as any, 'locale-test', 'locale-test');
    ql.registry.registerObject(crmDeal as any, 'locale-test', 'locale-test');
    await ql.syncSchemas();
    await installDefaultOrganization(ql);
    ql.setI18nService(zhI18n as any);
  }

  /** Run `node` in a fresh flow; return the refused run's result. */
  async function refusedRun(runAs: RunAs, node: Record<string, unknown>, locale?: string) {
    const name = `write_${runAs}_${String(node.type)}_${locale ?? 'none'}`.replace(/-/g, '_').toLowerCase();
    automation.registerFlow(name, oneNodeFlow(name, runAs, node) as any);
    const res = await automation.execute(name, { ...USER, ...(locale ? { locale } : {}) });
    expect(res.success, `the write must be refused: ${JSON.stringify(res)}`).toBe(false);
    return res;
  }

  const createBad = { type: 'create_record', config: { objectName: 'crm_deal', fields: { name: 'D1', amount: -5 } } };

  for (const runAs of ['user', 'system'] as const) {
    describe(`runAs: '${runAs}'`, () => {
      it('create_record: the authored rule message arrives in zh-CN, as a POST to the record door answers', async () => {
        await boot();
        // The control: the record door's own answer for the same write.
        const door = await ql.insert('crm_deal', { name: 'D0', amount: -1 }, { context: { ...USER, locale: 'zh-CN' } })
          .then(() => undefined, (e: any) => String(e?.message));
        expect(door).toBe(RULE_ZH);

        const res = await refusedRun(runAs, createBad, 'zh-CN');
        expect(res.innerRefusal).toEqual({ code: 'VALIDATION_FAILED', message: RULE_ZH });
        expect(res.error).toBe(`Node 'write' failed: create_record(crm_deal) failed: ${RULE_ZH}`);
      });

      it('update_record: the same rule tripped by an update arrives in zh-CN', async () => {
        await boot();
        const deal = await ql.insert('crm_deal', { name: 'D2', amount: 10 }, { context: { ...USER } });
        const res = await refusedRun(runAs, {
          type: 'update_record',
          config: { objectName: 'crm_deal', filter: { id: String(deal.id) }, fields: { amount: -1 } },
        }, 'zh-CN');
        expect(res.innerRefusal).toEqual({ code: 'VALIDATION_FAILED', message: RULE_ZH });
        const after = await ql.findOne('crm_deal', { where: { id: deal.id }, context: SYS });
        expect(after!.amount, 'the refused update never landed').toBe(10);
      });

      it('delete_record: a DELETE_RESTRICTED refusal names the objects by their zh-CN labels', async () => {
        await boot();
        const account = await ql.insert('crm_account', { name: 'Acme' }, { context: { ...USER } });
        await ql.insert('crm_deal', { name: 'D3', amount: 1, account: account.id }, { context: { ...USER } });
        const res = await refusedRun(runAs, {
          type: 'delete_record',
          config: { objectName: 'crm_account', filter: { id: String(account.id) } },
        }, 'zh-CN');
        expect(res.innerRefusal?.code).toBe('DELETE_RESTRICTED');
        expect(res.innerRefusal?.message).toContain('客户');
        expect(res.innerRefusal?.message).toContain('商机');
        expect(res.innerRefusal?.message).not.toContain('crm_account');
      });

      it('no locale on the run: the authored text, untranslated', async () => {
        await boot();
        const res = await refusedRun(runAs, createBad);
        expect(res.innerRefusal).toEqual({ code: 'VALIDATION_FAILED', message: RULE_EN });
      });
    });
  }
});
