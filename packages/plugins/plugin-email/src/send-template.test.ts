// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailService, type TemplateLoader, type EmailTemplateRow } from './email-service.js';
import type { IEmailTransport, NormalizedEmailMessage, TransportSendResult } from '@objectstack/spec/contracts';

class CaptureTransport implements IEmailTransport {
  public sent: NormalizedEmailMessage[] = [];
  async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
    this.sent.push(message);
    return { messageId: `msg-${this.sent.length}` };
  }
}

function makeLoader(rows: EmailTemplateRow[]): TemplateLoader {
  return {
    async load(name, locale) {
      const exact = rows.find((r) => r.name === name && r.locale === locale);
      if (exact) return exact;
      const fb = rows.find((r) => r.name === name && r.locale === 'en-US');
      return fb || null;
    },
  };
}

describe('EmailService.sendTemplate', () => {
  const sampleTemplate: EmailTemplateRow = {
    name: 'auth.password_reset',
    locale: 'en-US',
    subject: 'Reset {{user.name}}',
    body_html: '<p>Hi {{user.name}}, <a href="{{{resetUrl}}}">reset</a></p>',
    body_text: 'Hi {{user.name}}, reset: {{resetUrl}}',
    active: true,
    variables_json: JSON.stringify([
      { name: 'user.name', required: true },
      { name: 'resetUrl', required: true },
    ]),
  };

  it('renders template + delivers via transport', async () => {
    const transport = new CaptureTransport();
    const svc = new EmailService({
      transport,
      defaultFrom: { address: 'no-reply@x.com' },
      templateLoader: makeLoader([sampleTemplate]),
    });

    const res = await svc.sendTemplate({
      template: 'auth.password_reset',
      to: 'alice@x.com',
      data: { user: { name: 'Alice' }, resetUrl: 'https://x.com/r/abc' },
    });

    expect(res.status).toBe('sent');
    expect(transport.sent).toHaveLength(1);
    const msg = transport.sent[0];
    expect(msg.subject).toBe('Reset Alice');
    expect(msg.html).toContain('Hi Alice');
    expect(msg.html).toContain('href="https://x.com/r/abc"');
    expect(msg.text).toContain('reset: https://x.com/r/abc');
  });

  it('renders a datetime hole in the input reference timezone (ADR-0053 Phase 2)', async () => {
    const transport = new CaptureTransport();
    const tpl: EmailTemplateRow = {
      name: 'order.shipped',
      locale: 'en-US',
      subject: 'Shipped',
      body_html: '<p>Ships {{ shipAt | datetime }}</p>',
      body_text: 'Ships {{ shipAt | datetime }}',
      active: true,
    };
    const svc = new EmailService({
      transport,
      defaultFrom: { address: 'no-reply@x.com' },
      templateLoader: makeLoader([tpl]),
    });

    // 2026-06-02T01:30Z → 2026-06-01 in America/New_York.
    await svc.sendTemplate({
      template: 'order.shipped',
      to: 'a@x.com',
      data: { shipAt: '2026-06-02T01:30:00Z' },
      timezone: 'America/New_York',
    });

    expect(transport.sent[0].html).toContain('6/1/26'); // shifted to NY day
    expect(transport.sent[0].html).not.toContain('2026-06-02T01:30'); // not raw ISO
  });

  it('throws TEMPLATE_NOT_FOUND when loader returns null', async () => {
    const svc = new EmailService({
      transport: new CaptureTransport(),
      defaultFrom: { address: 'no-reply@x.com' },
      templateLoader: makeLoader([]),
    });
    await expect(svc.sendTemplate({
      template: 'auth.unknown',
      to: 'a@x.com',
      data: {},
    })).rejects.toThrow(/TEMPLATE_NOT_FOUND/);
  });

  it('throws TEMPLATE_INACTIVE for active=false rows', async () => {
    const svc = new EmailService({
      transport: new CaptureTransport(),
      defaultFrom: { address: 'no-reply@x.com' },
      templateLoader: makeLoader([{ ...sampleTemplate, active: false }]),
    });
    await expect(svc.sendTemplate({
      template: 'auth.password_reset',
      to: 'a@x.com',
      data: { user: { name: 'A' }, resetUrl: 'https://x' },
    })).rejects.toThrow(/TEMPLATE_INACTIVE/);
  });

  it('throws MISSING_VARIABLES when required vars absent', async () => {
    const svc = new EmailService({
      transport: new CaptureTransport(),
      defaultFrom: { address: 'no-reply@x.com' },
      templateLoader: makeLoader([sampleTemplate]),
    });
    await expect(svc.sendTemplate({
      template: 'auth.password_reset',
      to: 'a@x.com',
      data: { user: { name: 'A' } }, // missing resetUrl
    })).rejects.toThrow(/MISSING_VARIABLES: resetUrl/);
  });

  it('falls back to en-US when requested locale missing', async () => {
    const transport = new CaptureTransport();
    const svc = new EmailService({
      transport,
      defaultFrom: { address: 'no-reply@x.com' },
      templateLoader: makeLoader([sampleTemplate]),
    });
    await svc.sendTemplate({
      template: 'auth.password_reset',
      to: 'a@x.com',
      locale: 'zh-CN',
      data: { user: { name: 'A' }, resetUrl: 'https://x' },
    });
    expect(transport.sent[0].subject).toBe('Reset A'); // en-US row used
  });

  it('uses template fromOverride when supplied', async () => {
    const transport = new CaptureTransport();
    const svc = new EmailService({
      transport,
      defaultFrom: { address: 'no-reply@x.com' },
      templateLoader: makeLoader([{
        ...sampleTemplate,
        from_address: 'security@x.com',
        from_name: 'Security Team',
      }]),
    });
    await svc.sendTemplate({
      template: 'auth.password_reset',
      to: 'a@x.com',
      data: { user: { name: 'A' }, resetUrl: 'https://x' },
    });
    expect(transport.sent[0].from).toBe('Security Team <security@x.com>');
  });

  it('merges defaultTemplateContext into data', async () => {
    const transport = new CaptureTransport();
    const svc = new EmailService({
      transport,
      defaultFrom: { address: 'no-reply@x.com' },
      templateLoader: makeLoader([{
        ...sampleTemplate,
        subject: '{{appName}}: reset',
        body_html: '<p>{{appName}}</p>',
        variables_json: '[]',
      }]),
      defaultTemplateContext: { appName: 'Acme' },
    });
    await svc.sendTemplate({
      template: 'auth.password_reset',
      to: 'a@x.com',
      data: {},
    });
    expect(transport.sent[0].subject).toBe('Acme: reset');
    expect(transport.sent[0].html).toContain('Acme');
  });

  it('throws if no templateLoader configured', async () => {
    const svc = new EmailService({
      transport: new CaptureTransport(),
      defaultFrom: { address: 'no-reply@x.com' },
    });
    await expect(svc.sendTemplate({
      template: 'x',
      to: 'a@x.com',
      data: {},
    })).rejects.toThrow(/templateLoader/);
  });

  it('auto-derives plain text from HTML when body_text omitted', async () => {
    const transport = new CaptureTransport();
    const svc = new EmailService({
      transport,
      defaultFrom: { address: 'no-reply@x.com' },
      templateLoader: makeLoader([{
        ...sampleTemplate,
        body_text: null,
      }]),
    });
    await svc.sendTemplate({
      template: 'auth.password_reset',
      to: 'a@x.com',
      data: { user: { name: 'A' }, resetUrl: 'https://x' },
    });
    expect(transport.sent[0].text).toContain('Hi A');
    expect(transport.sent[0].text).not.toContain('<a href');
  });
});

describe('ResendTransport', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('POSTs JSON with bearer auth and returns messageId', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'res-123' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    globalThis.fetch = fetchSpy as any;
    const { ResendTransport } = await import('./transports/resend.js');
    const t = new ResendTransport('sk_test_key');
    const res = await t.send({
      to: ['a@x.com'],
      from: 'no-reply@x.com',
      subject: 'Hi',
      text: 'body',
    });
    expect(res.messageId).toBe('res-123');
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as any;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer sk_test_key');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ to: ['a@x.com'], from: 'no-reply@x.com', subject: 'Hi', text: 'body' });
  });

  it('throws on non-2xx', async () => {
    globalThis.fetch = (async () => new Response('bad key', { status: 401 })) as any;
    const { ResendTransport } = await import('./transports/resend.js');
    const t = new ResendTransport('bad');
    await expect(t.send({ to: ['a@x.com'], from: 'b@x.com', subject: 's', text: 'x' }))
      .rejects.toThrow(/Resend 401/);
  });

  it('throws when constructor called with empty apiKey', async () => {
    const { ResendTransport } = await import('./transports/resend.js');
    expect(() => new ResendTransport('')).toThrow(/apiKey is required/);
  });
});

describe('PostmarkTransport', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('POSTs Postmark-shaped JSON and returns MessageID', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ MessageID: 'pm-9' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    globalThis.fetch = fetchSpy as any;
    const { PostmarkTransport } = await import('./transports/postmark.js');
    const t = new PostmarkTransport({ apiKey: 'tok', messageStream: 'broadcast' });
    const res = await t.send({
      to: ['a@x.com', 'b@x.com'],
      from: 'no-reply@x.com',
      subject: 'Hi',
      html: '<p>x</p>',
    });
    expect(res.messageId).toBe('pm-9');
    const [url, init] = fetchSpy.mock.calls[0] as any;
    expect(url).toBe('https://api.postmarkapp.com/email');
    expect(init.headers['X-Postmark-Server-Token']).toBe('tok');
    const body = JSON.parse(init.body);
    expect(body.To).toBe('a@x.com, b@x.com');
    expect(body.MessageStream).toBe('broadcast');
    expect(body.HtmlBody).toBe('<p>x</p>');
  });
});

describe('makeTransport factory', () => {
  it('builds LogTransport for log provider', async () => {
    const { makeTransport } = await import('./transports/index.js');
    const { LogTransport } = await import('./email-service.js');
    expect(makeTransport({ provider: 'log' })).toBeInstanceOf(LogTransport);
  });

  it('rejects resend/postmark without apiKey', async () => {
    const { makeTransport } = await import('./transports/index.js');
    expect(() => makeTransport({ provider: 'resend' })).toThrow(/apiKey/);
    expect(() => makeTransport({ provider: 'postmark' })).toThrow(/apiKey/);
  });
});
