// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A mail hole whose formatter the whitelist does not name is refused at
 * render with `TEMPLATE_INVALID`. The renderer used to print the raw value in
 * its place (`{{ amount | curency:EUR }}` sent `1234.5`). Authoring refuses
 * such a hole first (`email-template-hole-grammar`, `@objectstack/lint`); this
 * is the guard for a template stored before that rule.
 *
 * Measured through the by-name doors, `EmailService.renderTemplate` and
 * `sendTemplate`, over all three faces.
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

const data = { amount: 1234.5, due: '2026-10-28' };

describe('a hole whose formatter the whitelist does not name', () => {
  it.each([
    ['subject', { subject: 'Due {{ amount | curency:EUR }}' }],
    ['body_html', { body_html: '<p>{{ amount | curency:EUR }}</p>' }],
    ['body_text', { body_text: 'Due {{ due | dat:long }}' }],
  ])('⭐ in %s: the render is refused with TEMPLATE_INVALID, naming the template and the formatter — never the raw value', async (_face, over) => {
    const { svc } = makeService([row('invoice.due', over)]);
    await expect(svc.renderTemplate({ template: 'invoice.due', data }))
      .rejects.toThrow(/^TEMPLATE_INVALID: email template invoice\.due \(locale=en-US\): the hole \{\{ /);
    await expect(svc.renderTemplate({ template: 'invoice.due', data })).rejects.toThrow('which is not a template formatter');
    await expect(svc.renderTemplate({ template: 'invoice.due', data })).rejects.toThrow('Known formatters: ');
  });

  it('sendTemplate refuses the same template and sends nothing', async () => {
    const { svc, sent } = makeService([row('invoice.due', { subject: 'Due {{ amount | curency:EUR }}' })]);
    await expect(svc.sendTemplate({ template: 'invoice.due', to: 'a@x.com', data }))
      .rejects.toThrow(/^TEMPLATE_INVALID: /);
    expect(sent).toEqual([]);
  });

  it('the corrected name renders in every face', async () => {
    const { svc } = makeService([row('invoice.due', {
      subject: 'Due {{ amount | currency:EUR }}',
      body_html: '<p>{{ amount | currency:EUR }}</p>',
      body_text: 'Due {{ due | date:iso }}',
    })]);
    expect(await svc.renderTemplate({ template: 'invoice.due', data }))
      .toEqual({ subject: 'Due €1,234.50', html: '<p>€1,234.50</p>', text: 'Due 2026-10-28' });
  });
});
