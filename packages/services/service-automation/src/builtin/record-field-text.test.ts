// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `create_record` / `update_record` field value MARKED as text is written in
 * the ORGANIZATION's language — ruling 6913660232 on objectstack#34062, letter
 * B, the executor half.
 *
 * The record keeps the sentence for everyone in the organization, so the
 * translated template is picked first (at
 * `flows.<flow>.records.<node_id>.fields.<field>`) and its `{{ }}` holes are
 * filled after (parameter 1), in the language the organization reads
 * (parameter 3): the Localization setting when somebody set it, else the app's
 * declared `i18n.defaultLocale`, else the authored text — never the language of
 * whoever started the run (parameter 2). A bare string is a literal and is
 * written as it is spelled (parameter 4); a missing translation writes the
 * authored text and the run completes (parameter 5).
 *
 * Every pin runs through the REAL in-memory `i18n` service, the plugin's own
 * `organizationLocaleReader` (the function `AutomationServicePlugin` wires) and
 * a real ObjectQL engine over a recording driver: the verdict is the row that
 * reaches the store.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { createMemoryI18n } from '@objectstack/core';
import type { AutomationContext } from '@objectstack/spec/contracts';

import { AutomationEngine } from '../engine.js';
import { i18nServiceReader, organizationLocaleReader } from '../plugin.js';
import { registerCrudNodes } from './crud-nodes.js';

function makeLogger(): any {
  const l: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {} };
  l.child = () => l;
  return l;
}

const AUTHORED = 'Auto-escalated: {{ record.priority }} priority';
const ZH = '自动升级：{{ record.priority }} 优先级';
const JA = '自動エスカレーション：{{ record.priority }} 優先度';

/** The organization's Localization row, as the `settings` service answers it. */
type SettingsAnswer = { value?: unknown; source?: string } | undefined | (() => never);

function settingsService(answer: SettingsAnswer) {
  const asked: Array<{ tenantId?: string }> = [];
  return {
    asked,
    async get(_ns: string, _key: string, ctx?: { tenantId?: string }) {
      asked.push(ctx ?? {});
      if (typeof answer === 'function') answer();
      return answer as { value?: unknown; source?: string } | undefined;
    },
  };
}

function makeRecordingDriver() {
  const writes: Array<{ op: 'create' | 'update'; data: Record<string, unknown> }> = [];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return []; },
    async findOne() { return { id: 'case_1' }; },
    async create(_o: string, data: Record<string, unknown>) { writes.push({ op: 'create', data: { ...data } }); return { id: 'case_1', ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { writes.push({ op: 'update', data: { ...data } }); return { id, ...data }; },
    async updateMany() { return 0; },
    async delete() { return true; }, async deleteMany() { return 0; }, async count() { return 0; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => driver.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, writes };
}

interface StackOptions {
  /** The app's declared `i18n.defaultLocale` (the memory service's default). */
  defaultLocale?: string;
  /** Translation bundles by locale. */
  bundles?: Record<string, Record<string, unknown>>;
  /** What the `settings` service answers for `localization.locale`; absent ⇒ no service. */
  settings?: SettingsAnswer;
}

async function makeStack(options: StackOptions = {}) {
  const logger = makeLogger();
  const ql = new ObjectQL({ logger });
  const { driver, writes } = makeRecordingDriver();
  ql.registerDriver(driver, true);
  await ql.init();
  ql.registry.registerObject({
    name: 'crm_case',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      priority: { name: 'priority', type: 'text' },
      status: { name: 'status', type: 'text' },
      escalation_reason: { name: 'escalation_reason', type: 'text' },
      internal_note: { name: 'internal_note', type: 'text' },
    },
  } as any, 'test');

  const i18n = createMemoryI18n();
  if (options.defaultLocale) i18n.setDefaultLocale(options.defaultLocale);
  for (const [locale, data] of Object.entries(options.bundles ?? {})) i18n.loadTranslations(locale, data);
  const settings = options.settings === undefined ? undefined : settingsService(options.settings);

  const services: Record<string, unknown> = { data: ql, i18n, ...(settings ? { settings } : {}) };
  const getService = (<T>(name: string): T => {
    if (name in services) return services[name] as T;
    throw new Error(`service '${name}' not registered`);
  }) as never;

  const automation = new AutomationEngine(logger);
  automation.setI18nServiceSource(i18nServiceReader({ getService }));
  automation.setOrganizationLocaleResolver(organizationLocaleReader({ getService }));
  registerCrudNodes(automation, { logger, getService: (n: string) => (n === 'data' ? ql : undefined) } as any);
  return { automation, writes, settings };
}

type WriteNode = 'create_record' | 'update_record';

function escalationFlow(nodeType: WriteNode, fields: Record<string, unknown>) {
  const config: Record<string, unknown> = { objectName: 'crm_case', fields };
  if (nodeType === 'update_record') config.filter = { id: 'case_1' };
  return {
    name: 'case_escalation', label: 'Case Escalation', type: 'record_change',
    // A record-change run of a system write holds no trigger user; the write
    // runs as the system, as such a flow declares.
    runAs: 'system',
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { objectName: 'crm_case', triggerType: 'record-after-update' } },
      { id: 'set_reason', type: nodeType, label: 'Set reason', config },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'set_reason' },
      { id: 'e2', source: 'set_reason', target: 'end' },
    ],
  } as any;
}

const MARKED = { escalation_reason: { dialect: 'template', source: AUTHORED }, status: 'escalated' };
const ZH_BUNDLE = { flows: { case_escalation: { records: { set_reason: { fields: { escalation_reason: ZH } } } } } };
const JA_BUNDLE = { flows: { case_escalation: { records: { set_reason: { fields: { escalation_reason: JA } } } } } };

/** A record-change run: no user, no locale — the trigger's own context. */
const recordChange = (): AutomationContext => ({
  event: 'record-after-update', object: 'crm_case', tenantId: 'org_1',
  record: { id: 'case_1', priority: 'High' },
} as unknown as AutomationContext);

/** A run a person started (a button), carrying that person's own language. */
const startedBy = (locale: string): AutomationContext => ({
  userId: 'usr_ada', locale, tenantId: 'org_1',
  record: { id: 'case_1', priority: 'High' },
} as unknown as AutomationContext);

const NODE_TYPES: readonly WriteNode[] = ['create_record', 'update_record'];

describe.each(NODE_TYPES)('%s — a field value marked as text is written in the organization\'s language', (nodeType) => {
  it('a zh-CN app with no Localization row: a record-change run with no user writes the zh-CN translation, holes filled', async () => {
    const { automation, writes } = await makeStack({ defaultLocale: 'zh-CN', bundles: { 'zh-CN': ZH_BUNDLE }, settings: { value: 'en-US', source: 'default' } });
    automation.registerFlow('case_escalation', escalationFlow(nodeType, MARKED));

    const result = await automation.execute('case_escalation', recordChange());

    expect(result.success, result.error).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0].data.escalation_reason).toBe('自动升级：High 优先级');
  });

  it('a run a person started in en-US still writes the organization\'s zh-CN — never the starter\'s language', async () => {
    const { automation, writes } = await makeStack({
      defaultLocale: 'zh-CN',
      bundles: { 'zh-CN': ZH_BUNDLE, 'en-US': { flows: { case_escalation: { records: { set_reason: { fields: { escalation_reason: 'EN pick {{ record.priority }}' } } } } } } },
      settings: { value: 'en-US', source: 'default' },
    });
    automation.registerFlow('case_escalation', escalationFlow(nodeType, MARKED));

    const result = await automation.execute('case_escalation', startedBy('en-US'));

    expect(result.success, result.error).toBe(true);
    expect(writes[0].data.escalation_reason).toBe('自动升级：High 优先级');
  });

  it('a Localization setting somebody set wins over the app default, asked for the run\'s organization', async () => {
    const { automation, writes, settings } = await makeStack({
      defaultLocale: 'zh-CN', bundles: { 'zh-CN': ZH_BUNDLE, 'ja-JP': JA_BUNDLE }, settings: { value: 'ja-JP', source: 'tenant' },
    });
    automation.registerFlow('case_escalation', escalationFlow(nodeType, MARKED));

    const result = await automation.execute('case_escalation', recordChange());

    expect(result.success, result.error).toBe(true);
    expect(writes[0].data.escalation_reason).toBe('自動エスカレーション：High 優先度');
    expect(settings!.asked).toEqual([{ tenantId: 'org_1' }]);
  });

  it('CONTROL — the setting\'s `source: default` placeholder is not a choice: the app default answers', async () => {
    const { automation, writes } = await makeStack({
      defaultLocale: 'zh-CN', bundles: { 'zh-CN': ZH_BUNDLE, 'ja-JP': JA_BUNDLE }, settings: { value: 'ja-JP', source: 'default' },
    });
    automation.registerFlow('case_escalation', escalationFlow(nodeType, MARKED));

    await automation.execute('case_escalation', recordChange());

    expect(writes[0].data.escalation_reason).toBe('自动升级：High 优先级');
  });

  it('a missing translation writes the authored text, holes filled, and the run completes', async () => {
    const { automation, writes } = await makeStack({ defaultLocale: 'zh-CN', bundles: { 'zh-CN': { flows: {} } } });
    automation.registerFlow('case_escalation', escalationFlow(nodeType, MARKED));

    const result = await automation.execute('case_escalation', recordChange());

    expect(result.success, result.error).toBe(true);
    expect(writes[0].data.escalation_reason).toBe('Auto-escalated: High priority');
  });

  it('a bare string is the literal it spells: written verbatim, never translated', async () => {
    const { automation, writes } = await makeStack({
      defaultLocale: 'zh-CN',
      bundles: { 'zh-CN': { flows: { case_escalation: { records: { set_reason: { fields: { escalation_reason: ZH, status: '已升级', internal_note: '内部' } } } } } } },
    });
    automation.registerFlow('case_escalation', escalationFlow(nodeType, { ...MARKED, internal_note: 'Raised by hand' }));

    const result = await automation.execute('case_escalation', recordChange());

    expect(result.success, result.error).toBe(true);
    expect(writes[0].data.status).toBe('escalated');
    expect(writes[0].data.internal_note).toBe('Raised by hand');
    // CONTROL: the marked field beside them in the same write IS translated.
    expect(writes[0].data.escalation_reason).toBe('自动升级：High 优先级');
  });

  it('a Localization read that FAILS fails the node and writes nothing — a failed read is not "not set"', async () => {
    const { automation, writes } = await makeStack({
      defaultLocale: 'zh-CN', bundles: { 'zh-CN': ZH_BUNDLE }, settings: () => { throw new Error('settings store down'); },
    });
    automation.registerFlow('case_escalation', escalationFlow(nodeType, MARKED));

    const result = await automation.execute('case_escalation', recordChange());

    expect(result.success).toBe(false);
    expect(result.error).toContain(`${nodeType}: the organization's language could not be read (settings store down)`);
    expect(writes).toEqual([]);
  });

  it.each(['SETTINGS_UNKNOWN_NAMESPACE', 'SETTINGS_UNKNOWN_KEY'])(
    'a host that registers no Localization setting (%s) has none set: the app default answers and the run completes',
    async (code) => {
      const unregistered = Object.assign(new Error(`localization.locale is not registered (${code})`), { code });
      const { automation, writes } = await makeStack({
        defaultLocale: 'zh-CN', bundles: { 'zh-CN': ZH_BUNDLE }, settings: () => { throw unregistered; },
      });
      automation.registerFlow('case_escalation', escalationFlow(nodeType, MARKED));

      const result = await automation.execute('case_escalation', recordChange());

      expect(result.success, result.error).toBe(true);
      expect(writes).toHaveLength(1);
      expect(writes[0].data.escalation_reason).toBe('自动升级：High 优先级');
    },
  );

  it('CONTROL — any other settings failure with a code is still a failed read: the node fails and writes nothing', async () => {
    const locked = Object.assign(new Error('settings store down'), { code: 'SETTINGS_STORE_UNAVAILABLE' });
    const { automation, writes } = await makeStack({
      defaultLocale: 'zh-CN', bundles: { 'zh-CN': ZH_BUNDLE }, settings: () => { throw locked; },
    });
    automation.registerFlow('case_escalation', escalationFlow(nodeType, MARKED));

    const result = await automation.execute('case_escalation', recordChange());

    expect(result.success).toBe(false);
    expect(result.error).toContain(`${nodeType}: the organization's language could not be read (settings store down)`);
    expect(writes).toEqual([]);
  });

  it('CONTROL — a write that marks no text never reads the organization\'s language', async () => {
    const { automation, writes, settings } = await makeStack({
      defaultLocale: 'zh-CN', settings: () => { throw new Error('settings store down'); },
    });
    automation.registerFlow('case_escalation', escalationFlow(nodeType, { status: 'escalated' }));

    const result = await automation.execute('case_escalation', recordChange());

    expect(result.success, result.error).toBe(true);
    expect(writes[0].data.status).toBe('escalated');
    expect(settings!.asked).toEqual([]);
  });

  it('a single-brace token in the marked text is refused at registerFlow, located at the field, as a text slot', async () => {
    const { automation } = await makeStack({ defaultLocale: 'zh-CN' });
    expect(() => automation.registerFlow('case_escalation', escalationFlow(nodeType, {
      escalation_reason: { dialect: 'template', source: 'Escalated {record.priority}' },
    }))).toThrow(`node 'set_reason' (${nodeType}) ${nodeType} field text at config.fields.escalation_reason`);
  });
});
