// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `{{ amount | currency:@currency_code }}` — one mail template formats each
 * record's amount in the currency whose ISO 4217 code the send's data holds.
 * Measured through the by-name doors, `EmailService.renderTemplate` and
 * `sendTemplate`, over all three faces, for records in two currencies and a
 * bundle in two locales.
 *
 * A code that is not there, or is not a code in three capital letters, is
 * refused with `TEMPLATE_INVALID` naming the template, the locale, the hole and
 * the value: the amount is never formatted in a default currency.
 */

import { describe, expect, it } from 'vitest';
import type { IEmailTransport, NormalizedEmailMessage, TransportSendResult } from '@objectstack/spec/contracts';
import type { EmailTemplateRow, TemplateLoader } from './index.js';
import { EmailService } from './email-service.js';

function makeService(rows: EmailTemplateRow[]) {
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
  return { svc, sent };
}

const faces = {
  subject: 'Instalment overdue: {{ planned_amount | currency:@currency_code }}',
  body_html: '<p>{{ contract.name }}: {{ planned_amount | currency:@contract.currency_code }}</p>',
  body_text: 'Due {{{ planned_amount | currency:@currency_code }}}',
};

/** One bundle, two locale rows, the same holes. */
const bundle: EmailTemplateRow[] = ['en-US', 'zh-CN'].map((locale) => ({
  name: 'contract.overdue',
  locale,
  active: true,
  ...faces,
}));

const record = (code: unknown) => ({
  planned_amount: 1234.5,
  currency_code: code,
  contract: { name: 'C-1', currency_code: code },
});

describe('one template, records in many currencies', () => {
  it.each([
    ['en-US', 'EUR', '€1,234.50'],
    ['en-US', 'CNY', 'CN¥1,234.50'],
    ['zh-CN', 'EUR', '€1,234.50'],
    ['zh-CN', 'CNY', '¥1,234.50'],
  ])('⭐ %s, a %s record: every face formats in the record\'s own currency', async (locale, code, money) => {
    const { svc } = makeService(bundle);
    expect(await svc.renderTemplate({ template: 'contract.overdue', locale, data: record(code) })).toEqual({
      subject: `Instalment overdue: ${money}`,
      html: `<p>C-1: ${money}</p>`,
      text: `Due ${money}`,
    });
  });

  it('sendTemplate delivers each record in its own currency through the same template', async () => {
    const { svc, sent } = makeService(bundle);
    await svc.sendTemplate({ template: 'contract.overdue', to: 'a@x.com', locale: 'en-US', data: record('EUR') });
    await svc.sendTemplate({ template: 'contract.overdue', to: 'b@x.com', locale: 'zh-CN', data: record('CNY') });
    expect(sent.map((m) => m.subject)).toEqual(['Instalment overdue: €1,234.50', 'Instalment overdue: ¥1,234.50']);
  });

  it('a null amount renders empty, as every formatted hole does, once the code resolves', async () => {
    const { svc } = makeService(bundle);
    const out = await svc.renderTemplate({ template: 'contract.overdue', locale: 'en-US', data: { ...record('EUR'), planned_amount: null } });
    expect(out.subject).toBe('Instalment overdue: ');
  });
});

describe('a code the data does not hold is refused, never formatted in USD', () => {
  it.each([
    ['an unresolvable path', { planned_amount: 1234.5, contract: { name: 'C-1' } }, 'missing'],
    ['a lowercase code', record('eur'), "'eur'"],
    ['a null code', record(null), 'null'],
  ])('⭐ %s: TEMPLATE_INVALID naming the template, the locale, the hole and the value', async (_label, data, shown) => {
    for (const locale of ['en-US', 'zh-CN']) {
      const { svc, sent } = makeService(bundle);
      const err = await svc.renderTemplate({ template: 'contract.overdue', locale, data }).then(
        () => { throw new Error('rendered'); },
        (e: Error) => e,
      );
      expect(err.message).toMatch(new RegExp(`^TEMPLATE_INVALID: email template contract\\.overdue \\(locale=${locale}\\): `));
      expect(err.message).toContain('{{ planned_amount | currency:@currency_code }}');
      expect(err.message).toContain(`is ${shown},`);
      expect(err.message).not.toMatch(/\$|US\$|USD 1/);
      await expect(svc.sendTemplate({ template: 'contract.overdue', to: 'a@x.com', locale, data }))
        .rejects.toThrow(/^TEMPLATE_INVALID: /);
      expect(sent).toEqual([]);
    }
  });

  it('the html face is judged on its own path too', async () => {
    const { svc } = makeService([{ ...bundle[0], subject: 'Notice', body_text: 'Notice' }]);
    await expect(svc.renderTemplate({ template: 'contract.overdue', data: { planned_amount: 1, contract: { currency_code: 'usd' } } }))
      .rejects.toThrow(/^TEMPLATE_INVALID: .*currency:@contract\.currency_code.*'usd'/);
  });
});

describe('the literal form and its refusals are unchanged', () => {
  it('a literal code still formats in that code whatever the data holds', async () => {
    const { svc } = makeService([{ name: 't', locale: 'en-US', active: true, subject: '{{ a | currency:EUR }}', body_html: '<p/>' }]);
    expect((await svc.renderTemplate({ template: 't', data: { a: 1, currency_code: 'CNY' } })).subject).toBe('€1.00');
  });

  it('a bare path is still refused at render', async () => {
    const { svc } = makeService([{ name: 't', locale: 'en-US', active: true, subject: '{{ a | currency:currency_code }}', body_html: '<p/>' }]);
    await expect(svc.renderTemplate({ template: 't', data: { a: 1, currency_code: 'EUR' } }))
      .rejects.toThrow(/^TEMPLATE_INVALID: .*never read as a path/);
  });
});
