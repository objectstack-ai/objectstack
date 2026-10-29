// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A mail hole whose text after the `|` is not a formatter name
 * (`{{ due | date-long }}`, `{{ x | two words }}`) is refused at render with
 * `TEMPLATE_INVALID`. The renderer used to print the hole to the reader as
 * written. Authoring refuses such a hole first (`email-template-hole-grammar`,
 * `@objectstack/lint`); this is the guard for a template stored before that
 * rule. A formatter part the in-app dialect accepts renders here the way that
 * dialect reads it (`currency :EUR`, `default:it's`).
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

const data = { amount: 1234.5, due: '2026-10-28', note: '' };

describe('a hole whose text after the `|` is not a formatter name', () => {
  it.each([
    ['subject', { subject: 'Due {{ due | date-long }}' }],
    ['body_html', { body_html: '<p>{{ amount | two words }}</p>' }],
    ['body_text', { body_text: 'Due {{ due | }}' }],
  ])('⭐ in %s: the render is refused with TEMPLATE_INVALID, naming the template and the shape — never the hole as written', async (_face, over) => {
    const { svc } = makeService([row('invoice.due', over)]);
    await expect(svc.renderTemplate({ template: 'invoice.due', data }))
      .rejects.toThrow(/^TEMPLATE_INVALID: email template invoice\.due \(locale=en-US\): the hole \{\{ /);
    await expect(svc.renderTemplate({ template: 'invoice.due', data }))
      .rejects.toThrow('a formatter is one word, optionally followed by `:` and its argument');
  });

  it('sendTemplate refuses the same template and sends nothing', async () => {
    const { svc, sent } = makeService([row('invoice.due', { subject: 'Due {{ due | date-long }}' })]);
    await expect(svc.sendTemplate({ template: 'invoice.due', to: 'a@x.com', data }))
      .rejects.toThrow(/^TEMPLATE_INVALID: /);
    expect(sent).toEqual([]);
  });

  it('a formatter part the in-app dialect accepts renders the way it reads it, in every face', async () => {
    const { svc } = makeService([row('invoice.due', {
      subject: 'Due {{ amount | currency :EUR }}',
      body_html: "<p>{{ note | default:it's }}</p>",
      body_text: 'Due {{ due | date :iso }}, {{ note | default:"n/a" }}',
    })]);
    expect(await svc.renderTemplate({ template: 'invoice.due', data }))
      .toEqual({ subject: 'Due €1,234.50', html: '<p>it&#39;s</p>', text: 'Due 2026-10-28, n/a' });
  });
});
