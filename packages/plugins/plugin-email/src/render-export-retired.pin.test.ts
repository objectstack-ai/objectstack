// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25190 — `renderTemplate`, the module function that took a template body
 * inline, is retired from this package's published entry (ruling 6335348115
 * on #25082, F2 B3; ADR-0087 `runtime-export-retired`). The hole-placement
 * rule judges a template where it is authored or published, and a body handed
 * straight to the function was never either, so it was the one door the rule
 * could not see. `IEmailService.renderTemplate` — the render-by-name method of
 * the same name — is a different door and stays.
 *
 * Pinned both ways: the entry no longer names it (the helpers beside it stay),
 * and a stored template still renders through the service, by name — the html
 * face with every hole encoded, the subject (a plain-text face) verbatim —
 * for both the render-only and the sending door.
 */

import { describe, it, expect } from 'vitest';
import type { IEmailTransport, NormalizedEmailMessage, TransportSendResult } from '@objectstack/spec/contracts';
import * as entry from './index.js';
import type { EmailTemplateRow, TemplateLoader } from './index.js';
import { EmailService } from './email-service.js';

const row: EmailTemplateRow = {
  name: 'deal.won',
  locale: 'en-US',
  subject: 'Won {{deal.name}}',
  body_html: '<h1>{{deal.name}}</h1>',
  active: true,
};

function makeService() {
  const sent: NormalizedEmailMessage[] = [];
  const transport: IEmailTransport = {
    async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
      sent.push(message);
      return { messageId: `msg-${sent.length}` };
    },
  };
  const templateLoader: TemplateLoader = {
    async load(name, locale) {
      return row.name === name && (locale === undefined || row.locale === locale) ? row : null;
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

describe('plugin-email entry: the body-taking renderer is retired (#25190)', () => {
  it('the published entry does not export renderTemplate', () => {
    expect('renderTemplate' in entry).toBe(false);
  });

  it('THE CONTROL: the entry still exports the helpers beside it and the stored-template wiring', () => {
    expect(typeof entry.requireVars).toBe('function');
    expect(typeof entry.htmlToText).toBe('function');
    expect(typeof entry.createRegistryEmailTemplateLoader).toBe('function');
    expect(typeof entry.EmailServicePlugin).toBe('function');
  });

  it('a stored template still renders by name through the service', async () => {
    const { svc, sent } = makeService();

    const out = await svc.renderTemplate({ template: 'deal.won', data: { deal: { name: 'A<b>' } } });
    expect(out.subject).toBe('Won A<b>');
    expect(out.html).toBe('<h1>A&lt;b&gt;</h1>');

    await svc.sendTemplate({ template: 'deal.won', to: 'ada@example.com', data: { deal: { name: 'A<b>' } } });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Won A<b>');
    expect(sent[0].html).toBe('<h1>A&lt;b&gt;</h1>');
  });
});
