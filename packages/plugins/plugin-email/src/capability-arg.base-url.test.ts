// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The template context's `baseUrl` key: the deployment's address, so a
 * template can render an absolute link to a record or an app route
 * (`{{baseUrl}}/<object>/<id>`).
 *
 * The chain, env first as for `appName`: `OS_AUTH_URL` (legacy
 * `BETTER_AUTH_URL`) > `OS_BASE_URL` > `config.email.defaultTemplateContext.baseUrl`
 * > `http://localhost:<port>`, never ending in a slash. The env half mirrors
 * `os serve`'s own reader; the parity pin against it lives in
 * `@objectstack/cli` (`serve-email-base-url-parity.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import { resolveEmailCapabilityArg } from './capability-arg.js';
import { EmailService, type TemplateLoader, type EmailTemplateRow } from './email-service.js';
import type { IEmailTransport, NormalizedEmailMessage, TransportSendResult } from '@objectstack/spec/contracts';

function contextOf(cfgEmail: Record<string, any>, env: NodeJS.ProcessEnv): Record<string, unknown> {
  return resolveEmailCapabilityArg(cfgEmail, env).options.defaultTemplateContext as Record<string, unknown>;
}

const CONFIG = { defaultTemplateContext: { baseUrl: 'https://config.example.com' } };

describe('defaultTemplateContext.baseUrl — the deployment address chain', () => {
  it('OS_AUTH_URL wins over every other link', () => {
    expect(contextOf(CONFIG, {
      OS_AUTH_URL: 'https://auth.example.com',
      BETTER_AUTH_URL: 'https://legacy.example.com',
      OS_BASE_URL: 'https://base.example.com',
      OS_PORT: '4100',
    }).baseUrl).toBe('https://auth.example.com');
  });

  it('the legacy BETTER_AUTH_URL stands in for OS_AUTH_URL, over OS_BASE_URL (serve reads it so)', () => {
    expect(contextOf(CONFIG, {
      BETTER_AUTH_URL: 'https://legacy.example.com',
      OS_BASE_URL: 'https://base.example.com',
    }).baseUrl).toBe('https://legacy.example.com');
  });

  it('OS_BASE_URL wins over the config', () => {
    expect(contextOf(CONFIG, { OS_BASE_URL: 'https://base.example.com', OS_PORT: '4100' }).baseUrl)
      .toBe('https://base.example.com');
  });

  it('the config wins over the local default', () => {
    expect(contextOf(CONFIG, { OS_PORT: '4100' }).baseUrl).toBe('https://config.example.com');
  });

  it('with nothing set, the local default names the port serve listens on', () => {
    expect(contextOf({}, {}).baseUrl).toBe('http://localhost:3000');
    expect(contextOf({}, { PORT: '4200' }).baseUrl).toBe('http://localhost:4200');
    expect(contextOf({}, { OS_PORT: '4100', PORT: '4200' }).baseUrl).toBe('http://localhost:4100');
  });

  it('a trailing slash is trimmed, from every link', () => {
    expect(contextOf({}, { OS_AUTH_URL: 'https://auth.example.com/' }).baseUrl).toBe('https://auth.example.com');
    expect(contextOf({}, { OS_BASE_URL: 'https://base.example.com/app//' }).baseUrl)
      .toBe('https://base.example.com/app');
    expect(contextOf({ defaultTemplateContext: { baseUrl: 'https://config.example.com/' } }, {}).baseUrl)
      .toBe('https://config.example.com');
  });

  it('a set-but-empty OS_AUTH_URL is a value, as serve reads it — not skipped', () => {
    // `serve` resolves `OS_AUTH_URL=` to '' and warns at boot that the auth
    // base URL is unusable; the mirror takes the same answer rather than
    // inventing a second reading of the same variable.
    expect(contextOf(CONFIG, { OS_AUTH_URL: '', OS_BASE_URL: 'https://base.example.com' }).baseUrl).toBe('');
  });

  it('control: appName resolves exactly as before, beside it', () => {
    expect(contextOf(
      { appName: 'Key', defaultTemplateContext: { appName: 'Context', baseUrl: 'https://c.example.com' } },
      { OS_APP_NAME: 'Env', OS_BASE_URL: 'https://base.example.com' },
      ).appName).toBe('Env');
    expect(contextOf({ defaultTemplateContext: { appName: 'Context' } }, {}).appName).toBe('Context');
    expect(contextOf({}, {}).appName).toBe('ObjectStack');
  });
});

// ── what a template renders with it ─────────────────────────────────────────

class CaptureTransport implements IEmailTransport {
  public sent: NormalizedEmailMessage[] = [];
  async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
    this.sent.push(message);
    return { messageId: `msg-${this.sent.length}` };
  }
}

const recordLink: EmailTemplateRow = {
  name: 'crm.deal_assigned',
  locale: 'en-US',
  subject: 'Deal assigned',
  body_html: '<p>Open it at {{baseUrl}}/x/1</p>',
  body_text: 'Open it at {{baseUrl}}/x/1',
  active: true,
};

function serviceWith(env: NodeJS.ProcessEnv): EmailService {
  const loader: TemplateLoader = { async load(name) { return name === recordLink.name ? recordLink : null; } };
  const { defaultTemplateContext } = resolveEmailCapabilityArg({}, env).options as {
    defaultTemplateContext: Record<string, unknown>;
  };
  return new EmailService({
    transport: new CaptureTransport(),
    defaultFrom: { address: 'no-reply@x.com' },
    templateLoader: loader,
    defaultTemplateContext,
  });
}

describe('a template renders {{baseUrl}} as the absolute link', () => {
  it('produces the absolute link in every face', async () => {
    const out = await serviceWith({ OS_BASE_URL: 'https://crm.example.com/' })
      .renderTemplate({ template: 'crm.deal_assigned' });
    expect(out.text).toBe('Open it at https://crm.example.com/x/1');
    expect(out.html).toBe('<p>Open it at https://crm.example.com/x/1</p>');
  });

  it("a send's own data.baseUrl still wins over the resolved default", async () => {
    const out = await serviceWith({ OS_BASE_URL: 'https://crm.example.com' })
      .renderTemplate({ template: 'crm.deal_assigned', data: { baseUrl: 'https://tenant.example.com' } });
    expect(out.text).toBe('Open it at https://tenant.example.com/x/1');
  });
});
