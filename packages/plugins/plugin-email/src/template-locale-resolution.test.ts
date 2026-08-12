// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Locale resolution for `sendTemplate` (#7731).
//
// The bug these pin: with an i18n bundle (`en-US` + `zh-CN` rows under one
// name) a send that named NO locale rendered zh-CN — on two consecutive fresh
// boots — because the loader's no-locale query was an unordered `limit: 1` and
// the service's en-US fallback only ran when a locale HAD been named. Both
// seams are covered here, and the determinism assertions run the same bundle
// through drivers that disagree about row order — including one that honours
// no ordering at all — because "returns en-US on this machine today" is the
// property the old code also had.

import { describe, it, expect } from 'vitest';
import { EmailService, DEFAULT_TEMPLATE_LOCALE, type EmailTemplateRow, type TemplateLoader } from './email-service.js';
import { createSysEmailTemplateLoader, type TemplateLoaderEngine } from './template-loader.js';
import { EMAIL_TEMPLATE_OBJECT } from './bootstrap-declared-email-templates.js';
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
const FR = row('fr-FR');

interface FakeEngineOptions {
  /** Emulate a driver that ignores `orderBy` and answers in storage order. */
  ignoreOrderBy?: boolean;
}

/**
 * A driver-ish engine: filters by `where`, applies `orderBy` when it honours
 * it, then `limit`. Rows are answered in the order they were handed in, so a
 * test can make "storage order" whatever it likes.
 */
function fakeEngine(rows: Row[], options: FakeEngineOptions = {}) {
  const queries: Array<Record<string, any>> = [];
  const engine: TemplateLoaderEngine & { queries: typeof queries } = {
    queries,
    async find(object: string, query: Record<string, any>) {
      expect(object).toBe(EMAIL_TEMPLATE_OBJECT);
      queries.push(query);
      const where = (query.where ?? {}) as Record<string, unknown>;
      let out = rows.filter((r) => Object.entries(where).every(([k, v]) => (r as any)[k] === v));
      if (!options.ignoreOrderBy && Array.isArray(query.orderBy)) {
        out = [...out].sort((a, b) => {
          for (const { field, order } of query.orderBy as Array<{ field: string; order: string }>) {
            const av = String((a as any)[field] ?? '');
            const bv = String((b as any)[field] ?? '');
            if (av !== bv) return (av < bv ? -1 : 1) * (order === 'desc' ? -1 : 1);
          }
          return 0;
        });
      }
      return typeof query.limit === 'number' ? out.slice(0, query.limit) : out;
    },
  };
  return engine;
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

// ── the loader seam (email-plugin.ts ~:548) ────────────────────────────────

describe('createSysEmailTemplateLoader — no locale means en-US, not "first row"', () => {
  // The regression, both ways round: which row the store happens to hold
  // first is exactly the input the old code was reading.
  it.each([
    ['en-US stored first', [EN, ZH]],
    ['zh-CN stored first', [ZH, EN]],
  ])('resolves the en-US row when no locale is passed (%s)', async (_label, rows) => {
    const loader = createSysEmailTemplateLoader(fakeEngine(rows as Row[]));
    const found = await loader.load('welcome', undefined);
    expect(found?.locale).toBe('en-US');
  });

  it('pins en-US in the WHERE clause, so a driver that ignores orderBy still answers en-US', async () => {
    const engine = fakeEngine([ZH, EN], { ignoreOrderBy: true });
    const loader = createSysEmailTemplateLoader(engine);

    expect((await loader.load('welcome', undefined))?.locale).toBe('en-US');
    expect(engine.queries[0].where).toEqual({ name: 'welcome', locale: DEFAULT_TEMPLATE_LOCALE });
    // …and it never asks an unordered question.
    for (const q of engine.queries) expect(q.orderBy).toBeTruthy();
  });

  it('never sends the wire spelling `sort` — find() rejects it, so the tie-break must be orderBy', async () => {
    const engine = fakeEngine([EN, ZH]);
    await createSysEmailTemplateLoader(engine).load('welcome', undefined);
    for (const q of engine.queries) expect(q.sort).toBeUndefined();
  });

  it('an explicit locale is an EXACT match — no fallback of the loader\'s own', async () => {
    const loader = createSysEmailTemplateLoader(fakeEngine([EN, ZH]));
    expect((await loader.load('welcome', 'zh-CN'))?.locale).toBe('zh-CN');
    // fr-FR has no row: the loader answers null and leaves the en-US fallback
    // to sendTemplate's ladder, where it is documented.
    expect(await loader.load('welcome', 'fr-FR')).toBeNull();
  });

  it('resolves the same row on repeat calls, with duplicate rows for one locale', async () => {
    const dupes = [
      { ...row('en-US', 'row-b'), subject: 'B' },
      { ...row('en-US', 'row-a'), subject: 'A' },
    ];
    const loader = createSysEmailTemplateLoader(fakeEngine(dupes));
    const first = await loader.load('welcome', undefined);
    const second = await loader.load('welcome', 'en-US');
    expect(first?.subject).toBe('A');
    expect(second?.subject).toBe('A');
  });

  describe('a bundle with no en-US row at all', () => {
    it.each([
      ['fr-FR stored first', [FR, ZH]],
      ['zh-CN stored first', [ZH, FR]],
    ])('falls back to the lowest locale tag, identically in both storage orders (%s)', async (_l, rows) => {
      const loader = createSysEmailTemplateLoader(fakeEngine(rows as Row[]));
      expect((await loader.load('welcome', undefined))?.locale).toBe('fr-FR');
    });

    it('keeps a single-locale tenant working rather than resolving to nothing', async () => {
      const loader = createSysEmailTemplateLoader(fakeEngine([ZH]));
      expect((await loader.load('welcome', undefined))?.locale).toBe('zh-CN');
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
    ['en-US inserted first', [EN, ZH]],
    ['zh-CN inserted first', [ZH, EN]],
  ])('renders en-US for a no-locale send on a fresh boot (%s)', async (_l, rows) => {
    const transport = new CaptureTransport();
    const svc = new EmailService({
      transport,
      defaultFrom: { address: 'no-reply@x.test' },
      templateLoader: createSysEmailTemplateLoader(fakeEngine(rows as Row[])),
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
      templateLoader: createSysEmailTemplateLoader(fakeEngine([EN, ZH])),
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

/** Mirror of the template engine's escaper — the rendered output is escaped. */
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
    expect(transport.sent[0].subject).toBe(`[en-US] ${esc(en.when)}`);
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
      // zh-CN-only bundle: no en-US row exists, so the ladder falls through to
      // the loader's own no-locale answer and lands on zh-CN.
      templateLoader: createSysEmailTemplateLoader(fakeEngine([fmtRow('zh-CN')])),
    });

    await svc.sendTemplate({ template: 'receipt', to: 'a@x.test', timezone: 'UTC', data: FMT_DATA });

    const zh = expected('zh-CN');
    expect(transport.sent[0].subject).toBe(`[zh-CN] ${esc(zh.when)}`);
    expect(transport.sent[0].subject).not.toContain(esc(expected('en-US').when));
  });

  // Pin (b): the row is the authority only when the caller named NOBODY.
  it('an explicit input.locale still wins over the resolved row', async () => {
    const { svc, transport } = serviceWith(exactLoader([fmtRow('en-US'), fmtRow('de-DE')]));

    await svc.sendTemplate({
      template: 'receipt', to: 'a@x.test', locale: 'de-DE', timezone: 'UTC', data: FMT_DATA,
    });

    const de = expected('de-DE');
    expect(transport.sent[0].subject).toBe(`[de-DE] ${esc(de.when)}`);
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
    expect(transport.sent[0].subject).toBe(`[en-US] ${esc(de.when)}`);
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

    expect(transport.sent[0].subject).toBe(`[de-DE] ${esc(expected('de-DE').when)}`);
  });
});

// ── the wiring: the plugin must install THIS loader ────────────────────────

describe('EmailServicePlugin wiring', () => {
  it('installs the deterministic loader on kernel:ready', async () => {
    const rows = [ZH, EN];
    const engine = fakeEngine(rows);
    const hooks: Record<string, Array<() => Promise<void> | void>> = {};
    const services: Record<string, unknown> = {
      manifest: { register: () => {} },
      objectql: engine,
    };
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getService: <T,>(name: string): T => {
        if (!(name in services)) throw new Error(`service '${name}' not registered`);
        return services[name] as T;
      },
      registerService: (name: string, svc: unknown) => { services[name] = svc; },
      hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
    };

    const plugin = new EmailServicePlugin({ seedTemplates: false, persist: false });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
    for (const fn of hooks['kernel:ready'] ?? []) await fn();

    const service = services.email as EmailService;
    const loader = service.options.templateLoader;
    expect(loader).toBeTruthy();
    expect((await loader!.load('welcome', undefined))?.locale).toBe('en-US');
    expect(engine.queries[engine.queries.length - 1]?.where).toEqual({ name: 'welcome', locale: 'en-US' });
  });
});
