// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `IEmailService.renderTemplate` (#9225) — the render-only face of the one
 * template resolver. Same `(name, locale)` ladder, same `{{var}}` renderer
 * (ADR-0053 format filters included) as `sendTemplate`, ZERO send path: no
 * transport call, no `sys_email` row, no queue.
 */

import { describe, it, expect } from 'vitest';
import { EmailService, type TemplateLoader, type EmailTemplateRow } from './email-service.js';
import type { IEmailTransport, NormalizedEmailMessage, TransportSendResult } from '@objectstack/spec/contracts';

class CaptureTransport implements IEmailTransport {
  public sent: NormalizedEmailMessage[] = [];
  async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
    this.sent.push(message);
    return { messageId: `msg-${this.sent.length}` };
  }
}

/** Exact-locale loader — the en-US fallback lives in the service's ladder. */
function makeLoader(rows: EmailTemplateRow[]): TemplateLoader {
  return {
    async load(name, locale) {
      if (locale === undefined) return rows.find((r) => r.name === name) ?? null;
      return rows.find((r) => r.name === name && r.locale === locale) ?? null;
    },
  };
}

function makeService(rows: EmailTemplateRow[]) {
  const transport = new CaptureTransport();
  const inserts: Array<Record<string, any>> = [];
  const svc = new EmailService({
    transport,
    defaultFrom: { address: 'no-reply@x.com' },
    templateLoader: makeLoader(rows),
    persistence: {
      async insert(row) { inserts.push(row); return { id: row.id }; },
      async update() { /* noop */ },
    },
  });
  return { svc, transport, inserts };
}

const enUs: EmailTemplateRow = {
  name: 'deal.won',
  locale: 'en-US',
  subject: 'Deal won: {{deal.name}}',
  body_html: '<p>Hi {{user.name}}, deal <b>{{deal.name}}</b> closed.</p>',
  body_text: 'Hi {{user.name}}, deal {{deal.name}} closed.',
  active: true,
};

const zhCn: EmailTemplateRow = {
  name: 'deal.won',
  locale: 'zh-CN',
  subject: '赢单:{{deal.name}}',
  body_html: '<p>{{user.name}},{{deal.name}} 已成交。</p>',
  active: true,
};

describe('EmailService.renderTemplate (#9225)', () => {
  it('renders subject/html/text from the resolved row WITHOUT sending — no transport call, no sys_email row', async () => {
    const { svc, transport, inserts } = makeService([enUs]);

    const out = await svc.renderTemplate({
      template: 'deal.won',
      data: { user: { name: 'Alice' }, deal: { name: 'Acme' } },
    });

    expect(out).toEqual({
      subject: 'Deal won: Acme',
      html: '<p>Hi Alice, deal <b>Acme</b> closed.</p>',
      text: 'Hi Alice, deal Acme closed.',
    });
    // Strictly render-only (the ruling's zero-send-path clause): nothing
    // reached the transport and nothing was persisted.
    expect(transport.sent).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('resolves the recipient locale exactly, and derives text from html when the row has no body_text', async () => {
    const { svc } = makeService([enUs, zhCn]);

    const out = await svc.renderTemplate({
      template: 'deal.won',
      locale: 'zh-CN',
      data: { user: { name: '张三' }, deal: { name: 'Acme' } },
    });

    expect(out.subject).toBe('赢单:Acme');
    expect(out.html).toBe('<p>张三,Acme 已成交。</p>');
    // zh-CN row declares no body_text → text is htmlToText(rendered html).
    expect(out.text).toBe('张三,Acme 已成交。');
  });

  it('falls back to en-US when the requested locale has no row (the documented ladder)', async () => {
    const { svc } = makeService([enUs, zhCn]);

    const out = await svc.renderTemplate({
      template: 'deal.won',
      locale: 'ja-JP',
      data: { user: { name: 'Yuki' }, deal: { name: 'Acme' } },
    });

    expect(out.subject).toBe('Deal won: Acme');
  });

  it('renders ADR-0053 format-filter holes with the input reference timezone', async () => {
    const tpl: EmailTemplateRow = {
      name: 'order.shipped',
      locale: 'en-US',
      subject: 'Shipped',
      body_html: '<p>Ships {{ shipAt | datetime }}</p>',
      body_text: 'Ships {{ shipAt | datetime }}',
      active: true,
    };
    const { svc } = makeService([tpl]);

    // 2026-06-02T01:30Z is still 2026-06-01 in America/New_York.
    const out = await svc.renderTemplate({
      template: 'order.shipped',
      data: { shipAt: '2026-06-02T01:30:00.000Z' },
      timezone: 'America/New_York',
    });

    expect(out.text).toContain('6/1/26'); // shifted to the NY calendar day
    expect(out.text).not.toContain('2026-06-02T01:30'); // not raw ISO
  });

  it('throws TEMPLATE_NOT_FOUND when no row matches (name, locale|en-US)', async () => {
    const { svc, transport } = makeService([enUs]);
    await expect(svc.renderTemplate({ template: 'no.such_template' }))
      .rejects.toThrow(/TEMPLATE_NOT_FOUND/);
    expect(transport.sent).toHaveLength(0);
  });

  it('throws TEMPLATE_INACTIVE for a resolvable but deactivated row', async () => {
    const { svc } = makeService([{ ...enUs, active: false }]);
    await expect(svc.renderTemplate({ template: 'deal.won' }))
      .rejects.toThrow(/TEMPLATE_INACTIVE/);
  });

  it('throws MISSING_VARIABLES naming the absent required variables', async () => {
    const tpl: EmailTemplateRow = {
      ...enUs,
      variables_json: JSON.stringify([
        { name: 'user.name', required: true },
        { name: 'deal.name', required: true },
      ]),
    };
    const { svc } = makeService([tpl]);
    await expect(svc.renderTemplate({ template: 'deal.won', data: { user: { name: 'Alice' } } }))
      .rejects.toThrow(/MISSING_VARIABLES: deal.name/);
  });

  it('throws VALIDATION_FAILED without a template name, and TEMPLATE_NOT_FOUND without a loader', async () => {
    const { svc } = makeService([enUs]);
    await expect(svc.renderTemplate({ template: '' }))
      .rejects.toThrow(/VALIDATION_FAILED: template name is required/);

    const bare = new EmailService({ transport: new CaptureTransport() });
    await expect(bare.renderTemplate({ template: 'deal.won' }))
      .rejects.toThrow(/TEMPLATE_NOT_FOUND: no templateLoader configured/);
  });
});
