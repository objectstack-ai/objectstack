// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A mail template's `{{ stage | option:opportunity.stage }}` hole prints the
 * select value as its option's label in EACH RECIPIENT's language (ruling F on
 * the option-label card, parameter 3, server half): the send builds a label
 * table per `object.field` the template names, in the send's locale, through
 * the translation path `GET /meta/object/:name` serves the object with, before
 * the synchronous render.
 *
 * - An `en-US` and a `zh-CN` recipient each read their own labels, on all three
 *   faces.
 * - A scheduled flow runs as the system: one `data` object, computed once, is
 *   sent to several recipients with no user and no organization in play, and
 *   each recipient still reads their own labels — the locale is the send's,
 *   never an execution context's.
 * - No recipient locale ⇒ the declared labels. A value outside the field's
 *   options prints as stored.
 * - A missing object, a missing field, a field with no options and a field
 *   whose option list is empty refuse the whole send `TEMPLATE_INVALID`, and
 *   nothing reaches the transport. With no label sources wired at all, the
 *   hole is refused `TEMPLATE_INVALID` too (never a bare `RangeError`).
 *
 * The table is pinned equal to `@objectstack/objectql`'s `readerOptionLabels`
 * — the path a formula's `label()` reads — for the same object, bundle and
 * locale, picklist-bound field included.
 */

import { describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import type { IEmailTransport, NormalizedEmailMessage, TransportSendResult } from '@objectstack/spec/contracts';
import type { EmailTemplateRow, TemplateLoader } from './index.js';
import { EmailService } from './email-service.js';
import { buildOptionLabelTable, type OptionLabelSources } from './option-label-table.js';
import { renderTemplate } from './template-engine.js';

const OPPORTUNITY = {
  name: 'opportunity',
  label: 'Opportunity',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    stage: {
      name: 'stage', label: 'Stage', type: 'select',
      options: [
        { value: 'needs_analysis', label: 'Needs Analysis' },
        { value: 'closed_won', label: 'Closed Won' },
      ],
    },
    tags: {
      name: 'tags', label: 'Tags', type: 'multiselect',
      options: [{ value: 'hot', label: 'Hot' }, { value: 'renewal', label: 'Renewal' }],
    },
    // Served with the shared list's options resolved onto it and `picklist` kept.
    region: {
      name: 'region', label: 'Region', type: 'select', picklist: 'sales_region',
      options: [{ value: 'apac', label: 'Asia Pacific' }, { value: 'emea', label: 'EMEA' }],
    },
    // Declares an option list with nothing in it.
    kind: { name: 'kind', label: 'Kind', type: 'select', options: [] },
  },
};

/** The i18n service the metadata route translates with: zh-CN labels, English fallback. */
function makeI18n() {
  const translations: Record<string, Record<string, unknown>> = {
    'zh-CN': {
      objects: {
        opportunity: {
          fields: {
            stage: { options: { needs_analysis: '需求分析', closed_won: '赢单' } },
            tags: { options: { hot: '热门', renewal: '续约' } },
          },
        },
      },
      picklists: { sales_region: { options: { apac: '亚太', emea: '欧洲中东非洲' } } },
    },
    en: {},
  };
  return {
    getLocales: () => Object.keys(translations),
    getTranslations: (locale: string) => translations[locale] ?? {},
    getFallbackLocale: () => 'en',
    getDefaultLocale: () => 'en',
  };
}

const SOURCES: OptionLabelSources = {
  getObject: (name) => (name === 'opportunity' ? OPPORTUNITY : undefined),
  i18n: makeI18n(),
};

const stalled = (overrides: Partial<EmailTemplateRow> = {}): EmailTemplateRow => ({
  name: 'deal.stalled',
  locale: 'en-US',
  subject: '{{ name }} is stalled at {{ stage | option:opportunity.stage }}',
  body_html: '<p>{{ stage | option:opportunity.stage }} / {{{ stage | option:opportunity.stage }}}</p>',
  body_text: 'Stage: {{ stage | option:opportunity.stage }}',
  active: true,
  ...overrides,
});

function makeService(rows: EmailTemplateRow[], sources: OptionLabelSources | null = SOURCES) {
  const sent: NormalizedEmailMessage[] = [];
  const transport: IEmailTransport = {
    async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
      sent.push(message);
      return { messageId: `msg-${sent.length}` };
    },
  };
  const templateLoader: TemplateLoader = {
    async load(name, locale) {
      return rows.find((r) => r.name === name && (locale === undefined || r.locale === locale)) ?? null;
    },
  };
  const svc = new EmailService({
    transport,
    defaultFrom: { address: 'no-reply@x.com' },
    templateLoader,
    persistence: {
      async insert(r) { return { id: r.id }; },
      async update() { /* noop */ },
    },
  });
  if (sources) svc.setOptionLabelSources(() => sources);
  return { svc, sent };
}

const data = { name: 'Acme renewal', stage: 'needs_analysis' };

describe('each recipient reads the option labels of their own language', () => {
  it.each([
    ['en-US', 'Needs Analysis'],
    ['zh-CN', '需求分析'],
  ])('renders every face with the %s labels', async (locale, label) => {
    const { svc } = makeService([stalled()]);
    const out = await svc.renderTemplate({ template: 'deal.stalled', locale, data });
    expect(out).toEqual({
      subject: `Acme renewal is stalled at ${label}`,
      html: `<p>${label} / ${label}</p>`,
      text: `Stage: ${label}`,
    });
  });

  it('a scheduled flow running as the system mails one computed payload to each recipient in their language', async () => {
    const { svc, sent } = makeService([stalled()]);
    // One `data` object, built once before the fan-out, as a notify's
    // templateData is; no `sentBy`, no organization: the system is sending.
    const payload = { name: 'Acme renewal', stage: 'closed_won' };
    for (const [to, locale] of [['ann@x.com', 'en-US'], ['li@x.com', 'zh-CN'], ['bo@x.com', 'en-US']] as const) {
      const res = await svc.sendTemplate({ template: 'deal.stalled', to, locale, data: payload });
      expect(res.status).toBe('sent');
    }
    expect(sent.map((m) => m.subject)).toEqual([
      'Acme renewal is stalled at Closed Won',
      'Acme renewal is stalled at 赢单',
      'Acme renewal is stalled at Closed Won',
    ]);
    expect(payload).toEqual({ name: 'Acme renewal', stage: 'closed_won' });
  });

  it('a send that names no locale reads the declared labels, whatever row it resolves to', async () => {
    const { svc } = makeService([stalled({ locale: 'zh-CN' })]);
    const out = await svc.renderTemplate({ template: 'deal.stalled', data });
    expect(out.text).toBe('Stage: Needs Analysis');
  });

  it('a value outside the field\'s options prints as stored; a multi-select prints each label', async () => {
    const { svc } = makeService([stalled({
      body_text: '{{ stage | option:opportunity.stage }} · {{ tags | option:opportunity.tags }}',
    })]);
    const out = await svc.renderTemplate({
      template: 'deal.stalled', locale: 'zh-CN', data: { ...data, stage: 'lost_to_rival', tags: ['hot', 'gone'] },
    });
    expect(out.text).toBe('lost_to_rival · 热门, gone');
  });

  it('a picklist-bound field reads the shared list\'s translation', async () => {
    const { svc } = makeService([stalled({ body_text: '{{ region | option:opportunity.region }}' })]);
    const zh = await svc.renderTemplate({ template: 'deal.stalled', locale: 'zh-CN', data: { region: 'apac' } });
    const en = await svc.renderTemplate({ template: 'deal.stalled', locale: 'en-US', data: { region: 'apac' } });
    expect([zh.text, en.text]).toEqual(['亚太', 'Asia Pacific']);
  });

  it('builds the table once per send, reading only the objects the holes name', async () => {
    const asked: string[] = [];
    const { svc } = makeService([stalled()], { ...SOURCES, getObject: (n) => { asked.push(n); return SOURCES.getObject(n); } });
    await svc.renderTemplate({ template: 'deal.stalled', locale: 'zh-CN', data });
    expect(asked).toEqual(['opportunity']);
  });
});

describe('a table that cannot be built refuses the whole send', () => {
  it.each([
    ['an object nothing serves', '{{ stage | option:deal.stage }}', /names the object `deal`, which resolves to no object/],
    ['a field the object does not have', '{{ stage | option:opportunity.phase }}', /names the field `phase`, which the object `opportunity` does not have/],
    ['a field with no options', '{{ name | option:opportunity.name }}', /names the field `opportunity\.name`, which declares no options/],
    ['a field whose option list is empty', '{{ kind | option:opportunity.kind }}', /names the field `opportunity\.kind`, which declares no options/],
  ])('%s: TEMPLATE_INVALID, nothing sent', async (_label, hole, sentence) => {
    // The refused hole sits in the body only: the subject alone would render.
    const { svc, sent } = makeService([stalled({ body_text: `Stage: ${hole}` })]);
    const send = svc.sendTemplate({ template: 'deal.stalled', to: 'ann@x.com', locale: 'zh-CN', data });
    await expect(send).rejects.toThrow(/^TEMPLATE_INVALID: email template deal\.stalled \(locale=en-US\): the hole /);
    await expect(send).rejects.toThrow(sentence);
    expect(sent).toHaveLength(0);
  });

  it('a send with no label sources wired is refused TEMPLATE_INVALID, not a bare RangeError', async () => {
    const { svc, sent } = makeService([stalled()], null);
    const send = svc.sendTemplate({ template: 'deal.stalled', to: 'ann@x.com', locale: 'zh-CN', data });
    await expect(send).rejects.toThrow(
      /^TEMPLATE_INVALID: email template deal\.stalled \(locale=en-US\): the hole \{\{ stage \| option:opportunity\.stage \}\} prints the option labels of `opportunity\.stage`, and no label table/,
    );
    expect(sent).toHaveLength(0);
  });

  it('the renderer refuses an empty table for the hole\'s field', () => {
    expect(() => renderTemplate('{{ stage | option:opportunity.stage }}', data, { optionLabels: { 'opportunity.stage': {} } }))
      .toThrow(/^TEMPLATE_INVALID: the hole \{\{ stage \| option:opportunity\.stage \}\} prints the option labels of `opportunity\.stage`, and the label table for that field holds no option/);
  });

  it('a template with no option hole never asks for the sources', async () => {
    const { svc } = makeService([stalled({ subject: 'Hi', body_html: '<p>{{ name }}</p>', body_text: '{{ name }}' })], {
      getObject: () => { throw new Error('asked'); },
    });
    await expect(svc.renderTemplate({ template: 'deal.stalled', locale: 'zh-CN', data })).resolves.toMatchObject({ text: 'Acme renewal' });
  });
});

describe('the table is the one a formula\'s label() reads', () => {
  /** The engine serving OPPORTUNITY, with a formula reading `label(record.stage)` and the same i18n service. */
  async function servingEngine() {
    const engine = new ObjectQL();
    const driver = {
      name: 'memory', version: '0.0.0', supports: {},
      async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
      async find() { return []; }, async findOne() { return null; }, async count() { return 0; },
      async create(_o: string, row: Record<string, unknown>) { return { id: 'o1', ...row }; },
      async update() { return null; }, async delete() { return true; },
      async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
      async commit() {}, async rollback() {},
    };
    engine.registerDriver(driver as never, true);
    await engine.init();
    const { region: _region, kind: _kind, ...fields } = OPPORTUNITY.fields;
    engine.registry.registerObject({
      ...OPPORTUNITY,
      fields: {
        ...fields,
        stage_label: {
          name: 'stage_label', label: 'Stage label', type: 'formula',
          expression: { dialect: 'cel', source: 'label(record.stage)' },
        },
      },
    } as never, 'test');
    engine.setI18nService(makeI18n() as never);
    return engine;
  }

  it.each([['zh-CN'], ['zh'], ['en-US'], [undefined]])('a stage reads alike in mail and in label() for locale %s', async (locale) => {
    const engine = await servingEngine();
    const sources: OptionLabelSources = { getObject: (n) => engine.getObject(n), i18n: makeI18n() };
    const table = buildOptionLabelTable(['{{ stage | option:opportunity.stage }}'], locale, sources)!;
    for (const stage of ['needs_analysis', 'closed_won']) {
      const row = await engine.insert('opportunity', { name: 'x', stage }, locale ? { context: { locale } as never } : undefined) as Record<string, unknown>;
      expect(table['opportunity.stage'][stage]).toBe(row.stage_label);
    }
  });
});
