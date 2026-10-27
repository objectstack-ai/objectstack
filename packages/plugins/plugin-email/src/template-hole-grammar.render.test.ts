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

  it('a literal code renders in that currency in every face, and no argument still renders USD', async () => {
    const { svc } = makeService([row('contract.overdue', {
      subject: 'Due {{ planned_amount | currency:EUR }}',
      body_html: '<p>{{ planned_amount | currency:EUR }} / {{ planned_amount | currency }}</p>',
      body_text: 'Due {{ planned_amount | currency:EUR }}',
    })]);
    const out = await svc.renderTemplate({ template: 'contract.overdue', data });
    expect(out).toEqual({ subject: 'Due €1,234.50', html: '<p>€1,234.50 / $1,234.50</p>', text: 'Due €1,234.50' });
  });
});
