// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The renderer reads `@objectstack/formula`'s mail hole grammar and refuses a
 * hole it refuses, rather than print a wrong value. Authoring refuses such a
 * hole first (`email-template-hole-grammar`, `@objectstack/lint`); this is the
 * guard for a template that reaches the renderer anyway — one stored before
 * the rule existed.
 *
 * Measured through the surviving by-name doors, `EmailService.renderTemplate`
 * and `sendTemplate`, over all three faces.
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
    async load(name) {
      return rows.find((r) => r.name === name) ?? null;
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

const row = (name: string, over: Partial<EmailTemplateRow>): EmailTemplateRow => ({
  name,
  locale: 'en-US',
  subject: 'Notice',
  body_html: '<p>Notice</p>',
  active: true,
  ...over,
});

const data = { planned_amount: 1234.5, currency_code: 'eur' };

describe('a hole that chains a second formatter', () => {
  it.each([
    ['subject', { subject: 'Paid {{ actual_amount | default:0 | number:2 }}' }],
    ['body_html', { body_html: '<p>{{ actual_amount | default:0 | number:2 }}</p>' }],
    ['body_text', { body_text: 'Paid {{ actual_amount | upper | lower }}' }],
  ])('⭐ in %s: the render is refused with TEMPLATE_INVALID, naming the one-formatter rule — never the literal text', async (_face, over) => {
    for (const actual_amount of [null, 71100]) {
      const { svc } = makeService([row('contract.paid', over)]);
      const render = svc.renderTemplate({ template: 'contract.paid', data: { actual_amount } });
      await expect(render).rejects.toThrow(/^TEMPLATE_INVALID: email template contract\.paid \(locale=en-US\): /);
      await expect(svc.renderTemplate({ template: 'contract.paid', data: { actual_amount } }))
        .rejects.toThrow('a hole takes one formatter');
    }
  });

  it('sendTemplate refuses the same template and sends nothing', async () => {
    const { svc, sent } = makeService([row('contract.paid', { body_html: '<p>{{ actual_amount | default:0 | number:2 }}</p>' })]);
    await expect(svc.sendTemplate({ template: 'contract.paid', to: 'a@x.com', data: { actual_amount: null } }))
      .rejects.toThrow(/^TEMPLATE_INVALID: /);
    expect(sent).toEqual([]);
  });

  it('one formatter per hole renders, and a `|` inside a quoted argument is its text', async () => {
    const { svc } = makeService([row('contract.paid', {
      subject: "Paid {{ actual_amount | default:'n/a | none' }}",
      body_html: '<p>{{ actual_amount | number:2 }}</p>',
    })]);
    expect(await svc.renderTemplate({ template: 'contract.paid', data: { actual_amount: null } }))
      .toMatchObject({ subject: 'Paid n/a | none', html: '<p></p>' });
    expect(await svc.renderTemplate({ template: 'contract.paid', data: { actual_amount: 71100 } }))
      .toMatchObject({ subject: 'Paid 71100', html: '<p>71,100.00</p>' });
  });
});

describe('a currency argument that is not a literal ISO 4217 code', () => {
  it.each([
    ['subject', { subject: 'Due {{ planned_amount | currency:currency_code }}' }],
    ['body_html', { body_html: '<p>{{ planned_amount | currency:currency_code }}</p>' }],
    ['body_text', { body_text: 'Due {{ planned_amount | currency:currency_code }}' }],
  ])('⭐ in %s: the render is refused with TEMPLATE_INVALID, naming the template and the rule — never USD', async (_face, over) => {
    const { svc } = makeService([row('contract.overdue', over)]);
    const render = svc.renderTemplate({ template: 'contract.overdue', data });
    await expect(render).rejects.toThrow(/^TEMPLATE_INVALID: email template contract\.overdue \(locale=en-US\): /);
    await expect(svc.renderTemplate({ template: 'contract.overdue', data })).rejects.toThrow(/ISO 4217/);
    await expect(svc.renderTemplate({ template: 'contract.overdue', data }))
      .rejects.toThrow('{{ planned_amount | currency:currency_code }}');
  });

  it('sendTemplate refuses the same template and sends nothing', async () => {
    const { svc, sent } = makeService([row('contract.overdue', { subject: 'Due {{ planned_amount | currency:currency_code }}' })]);
    await expect(svc.sendTemplate({ template: 'contract.overdue', to: 'a@x.com', data }))
      .rejects.toThrow(/^TEMPLATE_INVALID: /);
    expect(sent).toEqual([]);
  });

  it('a literal code renders in that currency in every face, and no argument renders the tenant default', async () => {
    const { svc } = makeService([row('contract.overdue', {
      subject: 'Due {{ planned_amount | currency:EUR }}',
      body_html: '<p>{{ planned_amount | currency:EUR }} / {{ planned_amount | currency }}</p>',
      body_text: 'Due {{ planned_amount | currency:EUR }}',
    })]);
    const out = await svc.renderTemplate({ template: 'contract.overdue', data, currency: 'CNY' });
    expect(out).toEqual({ subject: 'Due €1,234.50', html: '<p>€1,234.50 / CN¥1,234.50</p>', text: 'Due €1,234.50' });
  });
});
