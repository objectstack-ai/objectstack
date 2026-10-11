// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Locale resolution for `sendTemplate` (#7731).
//
// The bug these pin: with an i18n bundle (`en-US` + `zh-CN` rows under one
// name) a send that named NO locale rendered zh-CN — on two consecutive fresh
// boots — because the loader's no-locale query was an unordered `limit: 1` and
// the service's en-US fallback only ran when a locale HAD been named. Both
// seams are covered here, and the determinism assertions run the same bundle
// in both declaration orders, because "returns en-US on this machine today" is
// the property the old code also had. The loader now reads `email_template`
// metadata from the registry (ADR-0131 D6/D10) instead of `sys_email_template`
// rows; its rule is the one these pinned against the row loader, unchanged.

import { describe, it, expect } from 'vitest';
import { EmailService, DEFAULT_TEMPLATE_LOCALE, type EmailTemplateRow, type TemplateLoader } from './email-service.js';
import { createRegistryEmailTemplateLoader } from './template-loader.js';
import { EmailServicePlugin } from './email-plugin.js';
import type { IEmailTransport, NormalizedEmailMessage, TransportSendResult } from '@objectstack/spec/contracts';

// ── harness ────────────────────────────────────────────────────────────────

class CaptureTransport implements IEmailTransport {
  public sent: NormalizedEmailMessage[] = [];
  async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
    this.sent.push(message);
    return { messageId: `msg-${this.sent.length}` };
  }
}

type Row = EmailTemplateRow & { id: string };

/** One `sys_email_template` row per locale of the `welcome` bundle. */
function row(locale: string, id = `row-${locale}`): Row {
  return {
    id,
    name: 'welcome',
    locale,
    subject: `[${locale}] Hello {{name}}`,
    body_html: `<p>[${locale}] Hi {{name}}</p>`,
    active: true,
  };
}

const EN = row('en-US');
const ZH = row('zh-CN');

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

/** The registry loader over a list answered in exactly the order it was handed in. */
function registryLoader(items: Array<Record<string, unknown>>) {
  return createRegistryEmailTemplateLoader({ registry: { listItems: () => items.map((i) => ({ ...i })) } });
}

/** A loader that ONLY does exact matches — no fallback of its own. */
function exactLoader(rows: Row[], calls: Array<string | undefined> = []): TemplateLoader & { calls: typeof calls } {
  return {
    calls,
    async load(name, locale) {
      calls.push(locale);
      return rows.find((r) => r.name === name && r.locale === locale) ?? null;
    },
  };
}

function serviceWith(loader: TemplateLoader) {
  const transport = new CaptureTransport();
  const svc = new EmailService({
    transport,
    defaultFrom: { address: 'no-reply@x.test' },
    templateLoader: loader,
  });
  return { svc, transport };
}

// ── the loader seam ────────────────────────────────────────────────────────

describe('the registry loader — no locale means en-US, not "first member"', () => {
  // The regression, both ways round: which member the list happens to carry
  // first is exactly the input the old code was reading.
  it.each([
    ['en-US declared first', [item('en-US'), item('zh-CN')]],
    ['zh-CN declared first', [item('zh-CN'), item('en-US')]],
  ])('resolves the en-US member when no locale is passed (%s)', async (_label, items) => {
    const found = await registryLoader(items).load('welcome', undefined);
    expect(found?.locale).toBe('en-US');
  });

  it('an explicit locale is an EXACT match — no fallback of the loader\'s own', async () => {
    const loader = registryLoader([item('en-US'), item('zh-CN')]);
    expect((await loader.load('welcome', 'zh-CN'))?.locale).toBe('zh-CN');
    // fr-FR has no member: the loader answers null and leaves the en-US
    // fallback to sendTemplate's ladder, where it is documented.
    expect(await loader.load('welcome', 'fr-FR')).toBeNull();
  });

  it('does no language-subtag folding: `en` is not `en-US`, in either direction', async () => {
    expect(await registryLoader([item('en-US')]).load('welcome', 'en')).toBeNull();
    expect(await registryLoader([item('en')]).load('welcome', 'en-US')).toBeNull();
  });

  it('resolves the same member on repeat calls when two packages declare one slot', async () => {
    const loader = registryLoader([
      item('en-US', { subject: 'A', _packageId: 'com.example.a' }),
      item('en-US', { subject: 'B', _packageId: 'com.example.b' }),
    ]);
    const first = await loader.load('welcome', undefined);
    const second = await loader.load('welcome', 'en-US');
    expect(first?.subject).toBe('A');
    expect(second?.subject).toBe('A');
  });

  describe('a bundle with no en-US member at all', () => {
    it.each([
      ['fr-FR declared first', [item('fr-FR'), item('zh-CN')]],
      ['zh-CN declared first', [item('zh-CN'), item('fr-FR')]],
    ])('falls back to the lowest locale tag, identically in both orders (%s)', async (_l, items) => {
      expect((await registryLoader(items).load('welcome', undefined))?.locale).toBe('fr-FR');
    });

    it('keeps a single-locale bundle working rather than resolving to nothing', async () => {
      expect((await registryLoader([item('zh-CN')]).load('welcome', undefined))?.locale).toBe('zh-CN');
    });
  });
});

// ── the service seam (email-service.ts ~:1121) ─────────────────────────────

describe('EmailService.sendTemplate — locale ladder', () => {
  it('asks for en-US by name when the caller named no locale', async () => {
    const loader = exactLoader([EN, ZH]);
    const { svc, transport } = serviceWith(loader);

    await svc.sendTemplate({ template: 'welcome', to: 'a@x.test', data: { name: 'Ada' } });

    expect(loader.calls).toEqual(['en-US']);
    expect(transport.sent[0].subject).toBe('[en-US] Hello Ada');
  });

  it('an explicit exact match is unaffected — one lookup, that locale', async () => {
    const loader = exactLoader([EN, ZH]);
    const { svc, transport } = serviceWith(loader);

    await svc.sendTemplate({ template: 'welcome', to: 'a@x.test', locale: 'zh-CN', data: { name: 'Ada' } });

    expect(loader.calls).toEqual(['zh-CN']);
    expect(transport.sent[0].subject).toBe('[zh-CN] Hello Ada');
  });

  it('an explicit locale with no row still falls back to en-US', async () => {
    const loader = exactLoader([EN, ZH]);
    const { svc, transport } = serviceWith(loader);

    await svc.sendTemplate({ template: 'welcome', to: 'a@x.test', locale: 'fr-FR', data: { name: 'Ada' } });

    expect(loader.calls).toEqual(['fr-FR', 'en-US']);
    expect(transport.sent[0].subject).toBe('[en-US] Hello Ada');
  });

  it('a no-locale send consults the loader\'s own answer only when en-US is missing', async () => {
    const loader = exactLoader([ZH]);
    const { svc } = serviceWith(loader);

    // The exact loader has no answer for `undefined`, so this send fails —
    // what it pins is the ORDER: en-US first, the loader's own answer last.
    await expect(svc.sendTemplate({ template: 'welcome', to: 'a@x.test', data: { name: 'Ada' } }))
      .rejects.toThrow('TEMPLATE_NOT_FOUND: welcome (locale=en-US)');
    expect(loader.calls).toEqual(['en-US', undefined]);
  });

  it('an explicit locale is NOT widened to "any row" when neither it nor en-US exists', async () => {
    const loader = exactLoader([ZH]);
    const { svc } = serviceWith(loader);

    await expect(svc.sendTemplate({ template: 'welcome', to: 'a@x.test', locale: 'fr-FR', data: { name: 'Ada' } }))
      .rejects.toThrow('TEMPLATE_NOT_FOUND: welcome (locale=fr-FR)');
    expect(loader.calls).toEqual(['fr-FR', 'en-US']);
  });
});

// ── end to end: the reported reproduction ──────────────────────────────────

describe('sendTemplate over the real loader (the #7731 reproduction)', () => {
  it.each([
    ['en-US declared first', [item('en-US'), item('zh-CN')]],
    ['zh-CN declared first', [item('zh-CN'), item('en-US')]],
  ])('renders en-US for a no-locale send on a fresh boot (%s)', async (_l, items) => {
    const transport = new CaptureTransport();
    const svc = new EmailService({
      transport,
      defaultFrom: { address: 'no-reply@x.test' },
      templateLoader: registryLoader(items),
    });

    await svc.sendTemplate({ template: 'welcome', to: 'a@x.test', data: { name: 'Ada' } });

    expect(transport.sent[0].subject).toBe('[en-US] Hello Ada');
    expect(transport.sent[0].html).toContain('[en-US] Hi Ada');
  });

  it('still renders zh-CN when the caller asks for it', async () => {
    const transport = new CaptureTransport();
    const svc = new EmailService({
      transport,
      defaultFrom: { address: 'no-reply@x.test' },
      templateLoader: registryLoader([item('en-US'), item('zh-CN')]),
    });

    await svc.sendTemplate({ template: 'welcome', to: 'a@x.test', locale: 'zh-CN', data: { name: 'Ada' } });

    expect(transport.sent[0].subject).toBe('[zh-CN] Hello Ada');
  });
});

// ── the format filters' locale (#7801) ─────────────────────────────────────
//
// #7731 (above) made the no-locale send resolve the right ROW. It left the
// render pass' `renderOpts.locale` unset, so the locale-sensitive format
// filters (`{{ ts | datetime }}`, `{{ amt | number:2 }}`) fell through to
// `formatValue`'s own `?? 'en-US'` default instead of following the row. Two
// independent locale sources in one message; the maintainer ruled the row is
// the single authority and the split is a defect.
//
// NOTE for anyone re-reading the card: its stated symptom — "format filters
// render under the RUNTIME locale" — does not hold. `formatValue` hard-defaults
// to `en-US`, never to the host's locale, so the split is invisible while the
// row happens to BE en-US. It bites the other way round: a bundle with no en-US
// row resolves (say) zh-CN and renders en-US dates inside zh-CN body text.
// That is why the pin below that fails without the fix is the zh-CN one.

/** A row whose subject/body are made of locale-sensitive format filters. */
function fmtRow(locale: string): Row {
  return {
    id: `fmt-${locale}`,
    name: 'receipt',
    locale,
    subject: `[${locale}] {{ ts | datetime }}`,
    body_html: `<p>{{ amt | number:2 }}</p>`,
    active: true,
  };
}

const TS = '2026-03-05T14:30:00Z';
const AMT = 1234.5;
const FMT_DATA = { ts: TS, amt: AMT };

/** What `{{ ts | datetime }}` / `{{ amt | number:2 }}` render as under `locale`. */
function expected(locale: string) {
  return {
    when: new Intl.DateTimeFormat(locale, {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC',
    }).format(new Date(TS)),
    amount: new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(AMT),
  };
}

/**
 * Mirror of the template engine's HTML escaper — applied to the `html` face
 * only. The subject is a plain-text face and renders unescaped, so subject
 * expectations below compare the formatter output as-is.
 */
const esc = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

describe('sendTemplate — format filters follow the RESOLVED ROW\'s locale (#7801)', () => {
  // Pin (a) of the ruling. Passes on `main` too, vacuously: with the locale
  // unset the formatters' own default is also en-US. Kept because it is the
  // half of the ruling a future "just drop the locale again" change would
  // silently break once that default ever moves.
  it('a no-locale send resolving the en-US row formats en-US', async () => {
    const { svc, transport } = serviceWith(exactLoader([fmtRow('en-US'), fmtRow('zh-CN')]));

    await svc.sendTemplate({ template: 'receipt', to: 'a@x.test', timezone: 'UTC', data: FMT_DATA });

    const en = expected('en-US');
    expect(transport.sent[0].subject).toBe(`[en-US] ${en.when}`);
    expect(transport.sent[0].html).toContain(esc(en.amount));
  });

  // Pin (a), the direction that actually fails without the fix: the ladder's
  // last rung resolves a non-en-US row, and the body text and the numbers in
  // it must agree about which locale they are in.
  it('a no-locale send resolving a zh-CN row formats zh-CN, not en-US', async () => {
    const transport = new CaptureTransport();
    const svc = new EmailService({
      transport,
      defaultFrom: { address: 'no-reply@x.test' },
      // zh-CN-only bundle: no en-US member exists, so the ladder falls through
      // to the loader's own no-locale answer and lands on zh-CN.
      templateLoader: registryLoader([{
        name: 'receipt', label: 'Receipt', locale: 'zh-CN',
        subject: fmtRow('zh-CN').subject, bodyHtml: fmtRow('zh-CN').body_html,
      }]),
    });

    await svc.sendTemplate({ template: 'receipt', to: 'a@x.test', timezone: 'UTC', data: FMT_DATA });

    const zh = expected('zh-CN');
    expect(transport.sent[0].subject).toBe(`[zh-CN] ${zh.when}`);
    expect(transport.sent[0].subject).not.toContain(expected('en-US').when);
  });

  // Pin (b): the row is the authority only when the caller named NOBODY.
  it('an explicit input.locale still wins over the resolved row', async () => {
    const { svc, transport } = serviceWith(exactLoader([fmtRow('en-US'), fmtRow('de-DE')]));

    await svc.sendTemplate({
      template: 'receipt', to: 'a@x.test', locale: 'de-DE', timezone: 'UTC', data: FMT_DATA,
    });

    const de = expected('de-DE');
    expect(transport.sent[0].subject).toBe(`[de-DE] ${de.when}`);
    expect(transport.sent[0].html).toContain(esc(de.amount));
  });

  // Pin (b), the sharp edge: the caller's locale has no row, so the ladder
  // renders the en-US ROW — and the caller's locale must still drive the
  // filters. This is the assertion that stops the fix from over-reaching into
  // "the row always wins".
  it('an explicit locale with no row still formats in THAT locale, on the en-US row', async () => {
    const { svc, transport } = serviceWith(exactLoader([fmtRow('en-US')]));

    await svc.sendTemplate({
      template: 'receipt', to: 'a@x.test', locale: 'de-DE', timezone: 'UTC', data: FMT_DATA,
    });

    const de = expected('de-DE');
    expect(transport.sent[0].subject).toBe(`[en-US] ${de.when}`);
    expect(transport.sent[0].html).toContain(esc(de.amount));
  });

  // Falls out of binding to `preferred` (the trimmed spelling the ladder
  // resolved on) rather than to the raw `input.locale`: `Intl` throws a
  // RangeError on a padded tag, which would have taken the whole send down.
  it('a padded explicit locale renders rather than throwing out of Intl', async () => {
    const { svc, transport } = serviceWith(exactLoader([fmtRow('en-US'), fmtRow('de-DE')]));

    await svc.sendTemplate({
      template: 'receipt', to: 'a@x.test', locale: '  de-DE  ', timezone: 'UTC', data: FMT_DATA,
    });

    expect(transport.sent[0].subject).toBe(`[de-DE] ${expected('de-DE').when}`);
  });
});

// ── the wiring: the plugin must install THIS loader ────────────────────────

describe('EmailServicePlugin wiring', () => {
  async function bootWith(services: Record<string, unknown>) {
    const hooks: Record<string, Array<() => Promise<void> | void>> = {};
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getService: <T,>(name: string): T => {
        if (!(name in services)) throw new Error(`service '${name}' not registered`);
        return services[name] as T;
      },
      registerService: (name: string, svc: unknown) => { services[name] = svc; },
      hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
    };
    const plugin = new EmailServicePlugin({ persist: false });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
    for (const fn of hooks['kernel:ready'] ?? []) await fn();
    return (services.email as EmailService).options.templateLoader!;
  }

  it('installs the registry loader on kernel:ready, reading the ObjectQL registry on a host with no metadata door', async () => {
    const listed: string[] = [];
    const loader = await bootWith({
      manifest: { register: () => {} },
      objectql: { registry: { listItems: (type: string) => { listed.push(type); return [item('zh-CN'), item('en-US')]; } } },
    });

    expect((await loader.load('welcome', undefined))?.locale).toBe('en-US');
    expect(listed).toEqual(['email_template']);
  });

  it('reads the protocol\'s layered list when a metadata door is mounted — even one registered after kernel:ready', async () => {
    const services: Record<string, unknown> = {
      manifest: { register: () => {} },
      objectql: { registry: { listItems: () => [item('en-US', { subject: 'package wording' })] } },
    };
    const loader = await bootWith(services);
    services.protocol = {
      getMetaItemsForExecution: async () => ({ items: [item('en-US', { subject: 'environment wording' })] }),
    };

    expect((await loader.load('welcome', 'en-US'))?.subject).toBe('environment wording');
  });
});
