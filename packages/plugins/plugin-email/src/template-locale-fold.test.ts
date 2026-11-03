// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28880] The template locale ladder for a call that NAMES a locale is the
// platform's: the recipient's tag folded against the bundle's locales by
// `resolveBundleLocale` (exact → case-insensitive → base language → variant
// expansion), then the stack's declared fallback folded the same way, then
// `en-US`, then `TEMPLATE_NOT_FOUND`. Measured on `origin/main` (`b15b634c`)
// before this file: the service tried the named tag exactly, then `en-US`, so
// an `en-GB` or `zh-TW` recipient of an `en` + `zh-CN` bundle dead-lettered.
//
// Variant expansion picks the first base-language match in ascending tag
// order, so the answer does not depend on the order the list carries.
//
// The folding is the built-in registry loader's bundle read; a replacement
// loader that offers no locale list keeps the exact ladder (pinned last).

import { describe, it, expect } from 'vitest';
import type { IEmailTransport, NormalizedEmailMessage, TransportSendResult } from '@objectstack/spec/contracts';
import { EmailService, type EmailTemplateRow, type TemplateLoader } from './email-service.js';
import { createRegistryEmailTemplateLoader } from './template-loader.js';

class CaptureTransport implements IEmailTransport {
  public sent: NormalizedEmailMessage[] = [];
  async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
    this.sent.push(message);
    return { messageId: `msg-${this.sent.length}` };
  }
}

/** One `email_template` member of the `welcome` bundle, as the registry lists it. */
function item(locale: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'welcome',
    label: 'Welcome',
    locale,
    subject: `[${locale}] Hello {{name}}`,
    bodyHtml: `<p>[${locale}] Hi {{name}}</p>`,
    ...over,
  };
}

/** The real service over the real registry loader, with the stack's declared fallback (if any). */
function serviceOver(locales: string[], fallback?: string) {
  const transport = new CaptureTransport();
  const svc = new EmailService({
    transport,
    defaultFrom: { address: 'no-reply@x.test' },
    templateLoader: createRegistryEmailTemplateLoader({
      registry: { listItems: () => locales.map((l) => item(l)) },
    }),
  });
  if (fallback !== undefined) svc.setTemplateFallbackLocale(() => fallback);
  return { svc, transport };
}

async function sentLocale(locales: string[], locale: string | undefined, fallback?: string): Promise<string> {
  const { svc, transport } = serviceOver(locales, fallback);
  await svc.sendTemplate({ template: 'welcome', to: 'a@x.test', ...(locale ? { locale } : {}), data: { name: 'Ada' } });
  const subject = transport.sent[0]!.subject;
  return subject.slice(1, subject.indexOf(']'));
}

describe('[#28880] a named recipient locale is folded against the bundle', () => {
  it('en-GB reaches the en row', async () => {
    expect(await sentLocale(['en', 'zh-CN'], 'en-GB')).toBe('en');
  });

  it('zh-TW reaches the zh-CN row', async () => {
    expect(await sentLocale(['en', 'zh-CN'], 'zh-TW')).toBe('zh-CN');
  });

  it('zh reaches the zh-CN row', async () => {
    expect(await sentLocale(['en', 'zh-CN'], 'zh')).toBe('zh-CN');
  });

  it('a differently cased tag reaches its row', async () => {
    expect(await sentLocale(['en-US', 'zh-CN'], 'zh-cn')).toBe('zh-CN');
  });

  it('variant expansion takes the first base-language match in ascending tag order, whatever the list order', async () => {
    expect(await sentLocale(['zh-TW', 'zh-HK', 'zh-CN'], 'zh-MO')).toBe('zh-CN');
    expect(await sentLocale(['zh-CN', 'zh-HK', 'zh-TW'], 'zh-MO')).toBe('zh-CN');
  });

  it('an exact hit wins over every fold', async () => {
    expect(await sentLocale(['en', 'en-GB', 'zh-CN'], 'en-GB')).toBe('en-GB');
    expect(await sentLocale(['zh-CN', 'zh-TW'], 'zh-TW', 'zh-CN')).toBe('zh-TW');
  });
});

describe('[#28880] the declared fallback, then en-US, then TEMPLATE_NOT_FOUND', () => {
  it('with fallbackLocale zh-CN and no match, the zh-CN row is chosen before en-US', async () => {
    expect(await sentLocale(['en-US', 'zh-CN'], 'fr-FR', 'zh-CN')).toBe('zh-CN');
  });

  it('the declared fallback is folded by the same rules', async () => {
    expect(await sentLocale(['en-US', 'zh-CN'], 'fr-FR', 'zh')).toBe('zh-CN');
  });

  it('a declared fallback with no row of its own falls through to en-US', async () => {
    expect(await sentLocale(['en-US', 'zh-CN'], 'fr-FR', 'de-DE')).toBe('en-US');
  });

  it('with no fallback declared and no match, en-US', async () => {
    expect(await sentLocale(['en-US', 'zh-CN'], 'fr-FR')).toBe('en-US');
  });

  it('with nothing at all, TEMPLATE_NOT_FOUND, a permanent failure naming the template', async () => {
    const { svc } = serviceOver(['zh-CN'], 'de-DE');
    await expect(svc.sendTemplate({ template: 'welcome', to: 'a@x.test', locale: 'fr-FR', data: { name: 'Ada' } }))
      .rejects.toThrow(/^TEMPLATE_NOT_FOUND: welcome /);
  });
});

describe('[#28880] what does not change', () => {
  it('a no-locale call answers as today: en-US, then the lowest tag, never the declared fallback', async () => {
    expect(await sentLocale(['en-US', 'zh-CN'], undefined, 'zh-CN')).toBe('en-US');
    expect(await sentLocale(['de-DE', 'en-GB'], undefined, 'en-GB')).toBe('de-DE');
  });

  it('a replacement loader that offers no locale list keeps the exact ladder, declared fallback or not', async () => {
    const rows: EmailTemplateRow[] = ['en', 'zh-CN'].map((l) => ({
      name: 'welcome', locale: l, subject: `[${l}] Hello {{name}}`, body_html: '<p>x</p>', active: true,
    }));
    const calls: Array<string | undefined> = [];
    const exact: TemplateLoader = {
      async load(name, locale) {
        calls.push(locale);
        return rows.find((r) => r.name === name && r.locale === locale) ?? null;
      },
    };
    const svc = new EmailService({ transport: new CaptureTransport(), defaultFrom: { address: 'no-reply@x.test' }, templateLoader: exact });
    svc.setTemplateFallbackLocale(() => 'zh-CN');
    await expect(svc.sendTemplate({ template: 'welcome', to: 'a@x.test', locale: 'en-GB', data: { name: 'Ada' } }))
      .rejects.toThrow(/^TEMPLATE_NOT_FOUND: welcome /);
    expect(calls).toEqual(['en-GB', 'en-US']);
  });
});
