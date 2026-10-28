// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A mail template's `{{ amount | currency }}` hole with no argument formats in
 * the tenant default currency the caller hands the send (`currency`, the
 * organization's `localization.currency`). With none, the render refuses with
 * `TEMPLATE_INVALID`, naming the template, the hole and the remedy, and
 * nothing is sent: the amount is never formatted in USD or any other guess.
 *
 * Measured through the by-name doors, `EmailService.renderTemplate` and
 * `sendTemplate`, over all three faces, and through the face renderers.
 */

import { describe, expect, it } from 'vitest';
import type { IEmailTransport, NormalizedEmailMessage, TransportSendResult } from '@objectstack/spec/contracts';
import type { EmailTemplateRow, TemplateLoader } from './index.js';
import { EmailService } from './email-service.js';
import { renderPlainTextTemplate, renderTemplate } from './template-engine.js';

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

const overdue = (locale: string): EmailTemplateRow => ({
  name: 'contract.overdue',
  locale,
  subject: 'Due {{ planned_amount | currency }}',
  body_html: '<p>{{ planned_amount | currency }} / {{{ planned_amount | currency }}}</p>',
  body_text: 'Due {{ planned_amount | currency }}',
  active: true,
});

const data = { planned_amount: 1234.5 };

describe('no argument: the tenant default currency the send carries', () => {
  it.each([
    ['en-US', 'CN¥1,234.50'],
    ['zh-CN', '¥1,234.50'],
  ])('renders every face in CNY for the %s row', async (locale, amount) => {
    const { svc } = makeService([overdue('en-US'), overdue('zh-CN')]);
    const out = await svc.renderTemplate({ template: 'contract.overdue', locale, data, currency: 'CNY' });
    expect(out).toEqual({ subject: `Due ${amount}`, html: `<p>${amount} / ${amount}</p>`, text: `Due ${amount}` });
  });

  it('sendTemplate delivers the amount in the tenant default', async () => {
    const { svc, sent } = makeService([overdue('en-US')]);
    await svc.sendTemplate({ template: 'contract.overdue', to: 'a@x.com', data, currency: 'EUR' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('Due €1,234.50');
  });

  it('a hole that names its code does not read the tenant default', async () => {
    const { svc } = makeService([{ ...overdue('en-US'), subject: 'Due {{ planned_amount | currency:EUR }}' }]);
    const out = await svc.renderTemplate({ template: 'contract.overdue', data, currency: 'CNY' });
    expect(out.subject).toBe('Due €1,234.50');
  });
});

describe('no argument and no tenant default: refused, nothing sent', () => {
  it.each([
    ['not supplied', undefined],
    ['lowercase', 'usd'],
  ])('renderTemplate refuses when the tenant default is %s, naming the template, the hole and the remedy', async (_label, currency) => {
    const { svc } = makeService([overdue('en-US')]);
    const render = svc.renderTemplate({ template: 'contract.overdue', data, ...(currency ? { currency } : {}) });
    await expect(render).rejects.toThrow(
      /^TEMPLATE_INVALID: email template contract\.overdue \(locale=en-US\): the hole \{\{ planned_amount \| currency \}\}/,
    );
    const message = await render.catch((e: Error) => e.message);
    expect(message).toContain('localization.currency');
    expect(message).toContain('currency:EUR');
    expect(message).not.toContain('$');
  });

  it('sendTemplate refuses the same template and sends nothing', async () => {
    const { svc, sent } = makeService([overdue('en-US')]);
    await expect(svc.sendTemplate({ template: 'contract.overdue', to: 'a@x.com', data })).rejects.toThrow(/^TEMPLATE_INVALID: /);
    expect(sent).toEqual([]);
  });

  it('refuses whatever the value: a send with no amount is refused too', async () => {
    const { svc } = makeService([overdue('en-US')]);
    await expect(svc.renderTemplate({ template: 'contract.overdue', data: {} })).rejects.toThrow(/^TEMPLATE_INVALID: /);
  });

  it('each face renderer refuses it, double- or triple-braced', () => {
    expect(() => renderTemplate('<p>{{ amt | currency }}</p>', { amt: 1 })).toThrow(/^TEMPLATE_INVALID: the hole \{\{ amt \| currency \}\}/);
    expect(() => renderTemplate('<p>{{{ amt | currency }}}</p>', { amt: 1 })).toThrow(/^TEMPLATE_INVALID: /);
    expect(() => renderPlainTextTemplate('Due {{ amt | currency }}', { amt: 1 })).toThrow(/^TEMPLATE_INVALID: /);
  });

  it('a template with no no-argument currency hole needs no tenant default', async () => {
    const { svc } = makeService([{ ...overdue('en-US'), subject: 'Due {{ planned_amount | currency:EUR }}', body_html: '<p>{{ planned_amount | number:2 }}</p>', body_text: 'x' }]);
    const out = await svc.renderTemplate({ template: 'contract.overdue', data });
    expect(out.subject).toBe('Due €1,234.50');
  });
});
